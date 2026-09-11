/**
 * Billing slice (real, Phase 1). Moved from billing/src/store/useStore.ts: the billing run's UI state and the actions
 * the billing run and payments screens call. The db itself lives in the core store (./types.ts CoreState), and every
 * db write here goes through get().mutateDb(fn), with the UI fields that change alongside it passed as its patch.
 *
 * Engine writers stay pure: actions commit through appendCharges, applyPosting, and applyWaive (billing DECISIONS.md
 * entry 23b). The engine is bound to the live store by useStore.ts, not here, so this creator has no side effects.
 */
import type { Charge, Invoice, Payment, PaymentAllocation, RateVersion, WaivedCharge } from '../../types'
import { withEngineDb, type Db } from '../db'
import {
  allocate, appendCharges, applyPosting, computeCharge, formatId, generateEventCharges, generateRecurringCharges,
  intakeAllocations, intakeCharges, invoiceBalance, maxIdSuffix, postInvoices, setChargeIdGenerator,
} from '../engine'
import { setToday, stamp, today } from '../clock'
import { addDays, addMonths, cadenceOf, daysBetween, priorCycleDate, wholeMonths } from '../cycles'
import { applyWaive, waiveCharge } from '../waive'
import {
  applyUnappliedThroughAccount, publishRateVersionThroughPricing, type ApplyUnappliedInput, type RateVersionStubInput,
} from '../stubs'
import { accountName, cleanApprovalPreview, nextRunDate, nextUndecidedAfter, queueItems, rateChangePreview, uncoveredDueAccounts } from '../selectors'
import type { ChargeEdit, PriorChange, RunRecord, StoreData, Tab } from '../state'
import type { SliceCreator } from './types'

export const DEFAULT_CYCLE_DATE = '2026-10-01'

/**
 * One billing group's part of the cycle (addendum P): runCycle, bulkApproveClean, and post then touch only the group's
 * members. Omitted, they cover every account, as before.
 */
export interface RunScope {
  groupId?: string
}

/** The members of the scoped group, or undefined for the whole cycle. Throws for an unknown group. */
function scopeOf(db: Db, opts?: RunScope): Set<string> | undefined {
  if (!opts?.groupId) return undefined
  if (!db.billingGroups.some(g => g.id === opts.groupId)) throw new Error(`Unknown billing group ${opts.groupId}`)
  return new Set(db.accounts.filter(a => a.billingGroupId === opts.groupId).map(a => a.id))
}
export const DEFAULT_ACTOR = 'M. Alvarez'

export interface BillingActions {
  /** Generate recurring and event charges for cycleDate, append them as proposed, and record the prior-cycle diff. */
  runCycle(opts?: RunScope): RunRecord
  /**
   * Undo runCycle for the current cycle before anything is posted: the charges the run generated are removed along with
   * any approvals or edits made on them, and the cycle reads as not run. Intake charges (written by another surface)
   * stay as they are. Throws, writing nothing, once the run has posted an invoice or when one of its charges is
   * waived, because a WaivedCharge is never deleted (invariant 5). Returns how many charges went and how many of
   * them had been decided.
   */
  cancelRun(): { removed: number; decided: number }
  /** Approve a proposed charge. When it was the selected item, selection moves to the next undecided one. */
  approve(chargeId: string): void
  /** The charge editAmount would produce, without committing anything (the edit form shows it before confirming). */
  previewEdit(chargeId: string, newBaseCents: number): Charge
  /** Re-price a proposed or approved charge at a new base through computeCharge. An edit is a decision: the charge ends approved. */
  editAmount(chargeId: string, newBaseCents: number, reason: string): Charge
  waive(chargeId: string, reason: WaivedCharge['reason'], note?: string): void
  /** Approve every proposed charge in the run that is not a queue item. Queue items are never touched. */
  bulkApproveClean(opts?: RunScope): { count: number; cents: number }
  /**
   * Approve every undecided rate change in the queue as one decision (box 4.6). A rate change is a recurring line the
   * run priced at a RateVersion the owner published since the prior cycle; its evidence is the publish itself, so the
   * office confirms the group once instead of one row at a time. Every other queue item stays undecided.
   */
  approveRateChanges(): { count: number; cents: number }
  /**
   * "Charge card on file" on a posted invoice (box 4.5a). For an account whose paymentMethodOnFile is card, creates a
   * settled card Payment for the invoice's open balance and applies it through the canonical allocate(). Only a
   * person's click calls this; posting never charges a card (invariant 7). Throws, writing nothing, when the invoice is
   * not posted, is already paid, or the account has no card on file.
   */
  chargeCardOnFile(invoiceId: string): { payment: Payment; allocations: PaymentAllocation[] }
  /** Post every approved charge in the run. Refuses while any queue item is undecided. */
  post(opts?: RunScope): Invoice[]
  /**
   * Publish one rate line through pricing, which owns publishing (src/store/stubs.ts, box 3.6). Pricing writes the row
   * once, with its own id and publish record; this action writes nothing itself. Throws pricing's validation errors.
   * The name is kept from Phase 1 because the billing surface and the runbook call it by that name.
   */
  publishRateVersionStub(input: RateVersionStubInput): RateVersion
  /**
   * Apply a payment's unapplied cash through account's allocatePayment, which owns the write (src/store/stubs.ts,
   * box 3.6). Account validates and writes the rows once; this action only clears billing's own leftOnAccount marker.
   * Throws account's or the engine's error on a bad allocation, and nothing is written.
   */
  applyUnapplied(input: ApplyUnappliedInput): PaymentAllocation[]
  /** Record that a person chose to keep a payment's unapplied cash on the account. Changes no balance. */
  leaveOnAccount(paymentId: string): void
  /**
   * Move cycleDate to the next month start and the engine clock forward one month (DECISIONS.md entry 41), so the
   * next run is worked, stamped, and posted in the month before its cycle date, as the October run is on Sep 10.
   */
  advanceCycle(): void
  selectCharge(chargeId: string | null): void
  setActiveTab(tab: Tab): void
}

/** The billing run's UI state: everything in StoreData except db, which the core store owns. */
export type BillingData = Omit<StoreData, 'db'>

export type BillingSlice = BillingData & BillingActions

/** Fresh billing UI state: the October cycle, the run tab, nothing selected, no runs. */
export function initialBillingData(): BillingData {
  return {
    cycleDate: DEFAULT_CYCLE_DATE,
    activeTab: 'run',
    selectedChargeId: null,
    runs: {},
    edits: [],
    actor: DEFAULT_ACTOR,
    leftOnAccount: {},
    cardCharges: {},
  }
}

/** Payments created by "Charge card on file" carry billing's prefix (addendum C12), numbered after the highest in db. */
export const CARD_PAYMENT_ID_PREFIX = 'pay_bl_'

/** Identifies what a charge bills for, so a re-run can keep the id of the row it replaces. */
function sourceKey(c: Charge): string {
  return `${c.source.type}:${c.source.id}:${c.period?.start ?? c.servicedOn ?? ''}`
}

function monthly(c: Charge, qty: number): number {
  const months = c.period ? wholeMonths(c.period) : 1
  return Math.round(c.baseCents / Math.max(1, qty * months))
}

/**
 * Prior-cycle comparison (DECISIONS.md entry 5). For each account billed in this run, generateRecurringCharges
 * runs for that account's prior cycle date on a throwaway clone with no charges (so nothing is skipped as
 * already billed) and throwaway ids. A recurring charge is flagged when its service item was absent from the
 * prior run, when its rate version or contract differs, or when its total differs.
 */
export function computePriorChanges(db: Db, cycleDate: string, recurring: Charge[]): Record<string, PriorChange> {
  const out: Record<string, PriorChange> = {}
  if (recurring.length === 0) return out

  const accounts = new Map(db.accounts.map(a => [a.id, a]))
  const priorDateByAccount = new Map<string, string>()
  for (const c of recurring) {
    const account = accounts.get(c.accountId)
    if (account && !priorDateByAccount.has(account.id)) priorDateByAccount.set(account.id, priorCycleDate(cadenceOf(account, db.billingGroups), cycleDate))
  }

  const clone: Db = { ...db, charges: [] }
  const priorBySource = new Map<string, Charge>()
  let n = 0
  setChargeIdGenerator(() => `chg_bl_prior_${++n}`)
  try {
    withEngineDb(clone, () => {
      for (const date of new Set(priorDateByAccount.values())) {
        for (const p of generateRecurringCharges({ cycleDate: date })) {
          if (priorDateByAccount.get(p.accountId) === date) priorBySource.set(p.source.id, p)
        }
      }
    })
  } finally {
    setChargeIdGenerator()
  }

  for (const c of recurring) {
    const qty = db.serviceItems.find(si => si.id === c.source.id)?.qty ?? 1
    const prior = priorBySource.get(c.source.id)
    if (!prior) {
      out[c.id] = { kind: 'serviceChange', reason: 'first invoice after service change', newMonthlyCents: monthly(c, qty), newRateVersionId: c.pricing.rateVersionId }
      continue
    }
    const priorMonthly = monthly(prior, qty)
    const newMonthly = monthly(c, qty)
    const common = {
      priorTotalCents: prior.totalCents,
      priorBaseCents: prior.baseCents,
      priorMonthlyCents: priorMonthly,
      newMonthlyCents: newMonthly,
      priorRateVersionId: prior.pricing.rateVersionId,
      newRateVersionId: c.pricing.rateVersionId,
    }
    if (prior.pricing.rateVersionId !== c.pricing.rateVersionId || prior.pricing.contractId !== c.pricing.contractId) {
      out[c.id] = { kind: 'rateChange', reason: `rate version changed ${priorMonthly} to ${newMonthly}`, ...common }
    } else if (prior.totalCents !== c.totalCents) {
      out[c.id] = { kind: 'amountChange', reason: `amount changed ${prior.totalCents} to ${c.totalCents}`, ...common }
    }
  }
  return out
}

/**
 * After a decision on chargeId: when it was the selected item, select the next undecided queue item (or keep it
 * selected when none is left, so the person sees what they decided). Reads the state before the decision lands.
 */
function selectionAfterDecision(state: StoreData, chargeId: string): string | null {
  if (state.selectedChargeId !== chargeId) return state.selectedChargeId
  return nextUndecidedAfter(state, chargeId) ?? chargeId
}

/** Validate an edit and re-price the charge at newBaseCents through computeCharge (same id, manualException). */
function repriced(db: Db, chargeId: string, newBaseCents: number): Charge {
  const c = requireCharge(db, chargeId)
  if (c.status !== 'proposed' && c.status !== 'approved') throw new Error(`Cannot edit ${chargeId}: status is ${c.status}`)
  if (!Number.isInteger(newBaseCents) || newBaseCents < 0) throw new Error(`New amount must be non-negative integer cents, got ${newBaseCents}`)
  // computeCharge reads the bound db, so fees and tax follow the current rules.
  return withEngineDb(db, () => computeCharge({
    id: c.id,
    accountId: c.accountId,
    siteId: c.siteId,
    lineType: c.lineType,
    baseCents: newBaseCents,
    servicedOn: c.servicedOn,
    period: c.period,
    source: c.source,
    catalogId: c.catalogId,
    description: c.description,
    pricing: { ...c.pricing, ruleWon: 'manualException' },
    evidenceIds: c.evidenceIds,
    status: 'approved',
  }))
}

function requireCharge(db: Db, chargeId: string): Charge {
  const c = db.charges.find(x => x.id === chargeId)
  if (!c) throw new Error(`Unknown charge ${chargeId}`)
  return c
}

function setStatus(db: Db, ids: Set<string>, status: Charge['status']): Db {
  return { ...db, charges: db.charges.map(c => (ids.has(c.id) ? { ...c, status } : c)) }
}

export const createBillingSlice: SliceCreator<BillingSlice> = (set, get) => {
  return {
    ...initialBillingData(),

    runCycle(opts) {
      const { cycleDate, runs } = get()
      const previous = runs[cycleDate]
      let db = get().db
      const scope = scopeOf(db, opts)
      const inScope = (accountId: string) => !scope || scope.has(accountId)

      // Re-running a cycle replaces its proposed set. Decided rows (approved, waived, posted) stay, and the
      // engine skips them. Regenerated rows keep the id of the row they replace so selection stays put.
      // Intake rows are not the run's to regenerate: another surface wrote them, so they stay whatever their status.
      const previousIntake = new Set(previous?.intakeChargeIds ?? [])
      const reuse = new Map<string, string>()
      if (previous) {
        const inRun = new Set(previous.chargeIds)
        for (const c of db.charges) if (inRun.has(c.id) && c.status === 'proposed' && !previousIntake.has(c.id) && inScope(c.accountId)) reuse.set(sourceKey(c), c.id)
        const stale = new Set(reuse.values())
        db = { ...db, charges: db.charges.filter(c => !stale.has(c.id)) }
      }

      const generated = withEngineDb(db, () => [...generateRecurringCharges({ cycleDate }), ...generateEventCharges()]).filter(c => inScope(c.accountId))
      const fresh = generated.map(c => {
        const id = reuse.get(sourceKey(c))
        return id ? { ...c, id } : c
      })
      const next = appendCharges(db, fresh)

      // Intake (DECISIONS.md intake rule): proposed or approved charges on no invoice and in no run's chargeIds.
      const claimed = new Set([...Object.values(runs).flatMap(r => r.chargeIds), ...fresh.map(c => c.id)])
      const intake = intakeCharges({ claimedIds: claimed }, next).filter(c => inScope(c.accountId))

      const changed = computePriorChanges(next, cycleDate, fresh.filter(c => c.lineType === 'recurring'))
      const existing = new Set(next.charges.map(c => c.id))
      const keptIds = (previous?.chargeIds ?? []).filter(id => existing.has(id))
      const keptChanges = Object.fromEntries(Object.entries(previous?.changedFromPrior ?? {}).filter(([id]) => existing.has(id)))
      const chargeIds = [...new Set([...keptIds, ...fresh.map(c => c.id), ...intake.map(c => c.id)])]
      const intakeChargeIds = [...[...previousIntake].filter(id => existing.has(id)), ...intake.map(c => c.id)]
      const intakeDecisionIds = [
        ...(previous?.intakeDecisionIds ?? []).filter(id => existing.has(id)),
        ...intake.filter(c => c.status === 'proposed').map(c => c.id),
      ]

      const run: RunRecord = {
        cycleDate,
        ranAt: stamp(),
        chargeIds,
        changedFromPrior: { ...keptChanges, ...changed },
        postedInvoiceIds: previous?.postedInvoiceIds ?? [],
        intakeChargeIds,
        intakeDecisionIds,
        postedAllocations: previous?.postedAllocations ?? [],
        groupIds: opts?.groupId ? [...new Set([...(previous?.groupIds ?? []), opts.groupId])] : previous?.groupIds ?? [],
        ranAll: scope ? previous?.ranAll ?? false : true,
      }
      const nextRuns = { ...runs, [cycleDate]: run }
      const first = queueItems({ ...get(), db: next, runs: nextRuns }).find(i => !i.decided)
      const selected = get().selectedChargeId
      get().mutateDb(() => next, () => ({
        runs: nextRuns,
        selectedChargeId: selected && existing.has(selected) && chargeIds.includes(selected) ? selected : first?.chargeId ?? null,
      }))
      return run
    },

    approve(chargeId) {
      const state = get()
      const c = requireCharge(state.db, chargeId)
      if (c.status !== 'proposed') throw new Error(`Cannot approve ${chargeId}: status is ${c.status}`)
      const selectedChargeId = selectionAfterDecision(state, chargeId)
      get().mutateDb(db => setStatus(db, new Set([chargeId]), 'approved'), () => ({ selectedChargeId }))
    },

    previewEdit(chargeId, newBaseCents) {
      return repriced(get().db, chargeId, newBaseCents)
    },

    editAmount(chargeId, newBaseCents, reason) {
      const state = get()
      const { db, edits, actor } = state
      const c = requireCharge(db, chargeId)
      if (!reason.trim()) throw new Error('An edit needs a reason')
      const updated = repriced(db, chargeId, newBaseCents)
      const first = edits.find(e => e.chargeId === chargeId)
      const edit: ChargeEdit = {
        chargeId,
        originalBaseCents: first?.originalBaseCents ?? c.baseCents,
        originalTotalCents: first?.originalTotalCents ?? c.totalCents,
        newBaseCents,
        reason: reason.trim(),
        by: actor,
        at: stamp(),
      }
      const selectedChargeId = c.status === 'proposed' ? selectionAfterDecision(state, chargeId) : state.selectedChargeId
      get().mutateDb(db => appendCharges(db, [updated]), s => ({ edits: [...s.edits, edit], selectedChargeId }))
      return updated
    },

    waive(chargeId, reason, note) {
      const state = get()
      const result = waiveCharge({ chargeId, reason, note, by: state.actor, at: stamp() })
      const selectedChargeId = selectionAfterDecision(state, chargeId)
      get().mutateDb(db => applyWaive(db, result), () => ({ selectedChargeId }))
    },

    bulkApproveClean(opts) {
      const state = get()
      const scope = scopeOf(state.db, opts)
      const preview = cleanApprovalPreview(state)
      const byId = new Map(state.db.charges.map(c => [c.id, c]))
      const targets = scope ? preview.chargeIds.filter(id => scope.has(byId.get(id)?.accountId ?? '')) : preview.chargeIds
      const cents = scope ? targets.reduce((s, id) => s + (byId.get(id)?.totalCents ?? 0), 0) : preview.cents
      if (targets.length > 0) get().mutateDb(db => setStatus(db, new Set(targets), 'approved'))
      return { count: targets.length, cents }
    },

    approveRateChanges() {
      const state = get()
      const { chargeIds, count, cents } = rateChangePreview(state)
      if (count === 0) return { count, cents }
      const ids = new Set(chargeIds)
      // Selection leaves the group: the next undecided item that is not a rate change, else it stays where it was.
      const next = state.selectedChargeId && !ids.has(state.selectedChargeId)
        ? state.selectedChargeId
        : queueItems(state).find(i => !i.decided && !ids.has(i.chargeId))?.chargeId ?? state.selectedChargeId
      get().mutateDb(db => setStatus(db, ids, 'approved'), () => ({ selectedChargeId: next }))
      return { count, cents }
    },

    chargeCardOnFile(invoiceId) {
      const { db } = get()
      const invoice = db.invoices.find(i => i.id === invoiceId)
      if (!invoice) throw new Error(`Unknown invoice ${invoiceId}`)
      if (!invoice.locked && !invoice.postedAt) throw new Error(`${invoice.number} is not posted, so there is nothing to charge yet`)
      const account = db.accounts.find(a => a.id === invoice.accountId)
      const name = accountName(db, invoice.accountId)
      if (account?.paymentMethodOnFile !== 'card') throw new Error(`${name} has no card on file`)
      const open = invoiceBalance(invoiceId, db)
      if (open <= 0) throw new Error(`${invoice.number} is paid in full, so there is nothing to charge`)

      const payment: Payment = {
        id: formatId(CARD_PAYMENT_ID_PREFIX, maxIdSuffix(db.payments.map(p => p.id), CARD_PAYMENT_ID_PREFIX) + 1),
        accountId: invoice.accountId,
        method: 'card',
        cents: open,
        receivedAt: stamp(),
        status: 'settled',
      }
      const withPayment: Db = { ...db, payments: [...db.payments, payment] }
      // The canonical allocate() validates against the db that already holds the payment; it writes nothing itself.
      const allocations = allocate({ sourceType: 'payment', sourceId: payment.id, invoiceIds: [invoiceId], cents: [open] }, withPayment)
      get().mutateDb(
        () => ({ ...withPayment, allocations: [...withPayment.allocations, ...allocations] }),
        s => ({ cardCharges: { ...s.cardCharges, [payment.id]: { invoiceId, by: s.actor, at: payment.receivedAt } } }),
      )
      return { payment, allocations }
    },

    post(opts) {
      const state = get()
      const run = state.runs[state.cycleDate]
      if (!run) throw new Error('Run the cycle before posting')
      const scope = scopeOf(state.db, opts)
      const open = queueItems(state).filter(i => !i.decided && (!scope || scope.has(i.accountId)))
      if (open.length > 0) throw new Error(`Cannot post: ${open.length} queue item${open.length === 1 ? ' is' : 's are'} undecided`)
      // Run order, not db order: the run's own charges come first and intake after, so an account that is only intake
      // (a storefront signup) is numbered after every account the run itself billed, and the seed's invoice numbers do
      // not shift when a signup happened before the run. postPreview reads in the same order.
      const statusOf = new Map(state.db.charges.map(c => [c.id, c.status]))
      const accountOf = new Map(state.db.charges.map(c => [c.id, c.accountId]))
      const ids = run.chargeIds.filter(id => statusOf.get(id) === 'approved' && (!scope || scope.has(accountOf.get(id) ?? '')))
      const invoices = postInvoices({ chargeIds: ids })
      // Intake rule, second half: a settled prepayment on no allocation (pay_sf_*, pay_p*) is applied through the
      // canonical allocate() to the new invoice carrying the charges it prepaid, in the same update as the posting.
      const posted = applyPosting(state.db, invoices)
      const allocations = intakeAllocations({ invoices, intakeChargeIds: run.intakeChargeIds ?? [] }, posted)
      get().mutateDb(() => (allocations.length > 0 ? { ...posted, allocations: [...posted.allocations, ...allocations] } : posted), s => ({
        runs: {
          ...s.runs,
          [run.cycleDate]: {
            ...run,
            postedInvoiceIds: [...run.postedInvoiceIds, ...invoices.map(i => i.id)],
            postedAllocations: [...(run.postedAllocations ?? []), ...allocations],
          },
        },
      }))
      return invoices
    },

    // Both delegates write through the owner's action, so neither result is committed again here (R3F-1).
    publishRateVersionStub(input) {
      return publishRateVersionThroughPricing(get(), input)
    },

    applyUnapplied(input) {
      const rows = applyUnappliedThroughAccount(get(), input)
      if (input.paymentId in get().leftOnAccount) {
        set(s => {
          const leftOnAccount = { ...s.leftOnAccount }
          delete leftOnAccount[input.paymentId]
          return { leftOnAccount }
        })
      }
      return rows
    },

    leaveOnAccount(paymentId) {
      if (!get().db.payments.some(p => p.id === paymentId)) throw new Error(`Unknown payment ${paymentId}`)
      set(s => ({ leftOnAccount: { ...s.leftOnAccount, [paymentId]: stamp() } }))
    },

    advanceCycle() {
      // Addendum P: a cycle run for only some billing groups would leave the others unbilled for that date for good.
      const missed = uncoveredDueAccounts(get())
      if (missed.length > 0) {
        throw new Error(`${missed.length} ${missed.length === 1 ? 'account is' : 'accounts are'} due on ${get().cycleDate} and not billed yet. Run the rest of the cycle first.`)
      }
      // The next date any account bills (addendum Q): next month's 1st while every group bills on the 1st, sooner for a
      // weekly or daily group. The clock keeps the same lead: a month on for a month, the same days on otherwise.
      const { cycleDate, db } = get()
      const next = nextRunDate(db, cycleDate)
      setToday(next === addMonths(cycleDate, 1) ? addMonths(today(), 1) : addDays(today(), daysBetween(cycleDate, next)))
      set({ cycleDate: next, selectedChargeId: null, activeTab: 'run' })
    },

    cancelRun() {
      const { cycleDate, runs, db, edits } = get()
      const run = runs[cycleDate]
      if (!run) throw new Error(`The ${cycleDate} cycle has not run`)
      if (run.postedInvoiceIds.length > 0) throw new Error(`The ${cycleDate} run has posted invoices, so it cannot be cancelled; corrections are credit memos`)
      const intake = new Set(run.intakeChargeIds ?? [])
      const generated = new Set(run.chargeIds.filter(id => !intake.has(id)))
      const charges = db.charges.filter(c => generated.has(c.id))
      if (charges.some(c => c.status === 'waived' || db.waivedCharges.some(w => w.chargeId === c.id))) {
        throw new Error(`The ${cycleDate} run has waived charges, and a waive is never deleted, so the run cannot be cancelled`)
      }
      if (charges.some(c => c.status === 'posted')) throw new Error(`The ${cycleDate} run has posted charges, so it cannot be cancelled`)
      const decided = charges.filter(c => c.status !== 'proposed').length
      const rest = { ...runs }
      delete rest[cycleDate]
      get().mutateDb(
        current => ({ ...current, charges: current.charges.filter(c => !generated.has(c.id)) }),
        () => ({ runs: rest, edits: edits.filter(e => !generated.has(e.chargeId)), selectedChargeId: null }),
      )
      return { removed: charges.length, decided }
    },

    selectCharge(chargeId) {
      set({ selectedChargeId: chargeId })
    },

    setActiveTab(tab) {
      set({ activeTab: tab })
    },
  }
}
