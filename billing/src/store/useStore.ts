/**
 * The billing store. Holds the Db plus UI state and exposes the actions the billing run screen calls.
 *
 * On create it binds the engine to the live state (setEngineDb(() => get().db)), so every engine read
 * (computeCharge, postInvoices, waiveCharge) sees the current store. Engine writers stay pure: actions
 * commit through appendCharges, applyPosting, and applyWaive (DECISIONS.md entry 23b).
 */
import { create } from 'zustand'
import type { Charge, Invoice, PaymentAllocation, RateVersion, WaivedCharge } from '../types'
import { loadSeed } from '../seed'
import { setEngineDb, withEngineDb, type Db } from './db'
import {
  appendCharges, applyPosting, computeCharge, generateEventCharges, generateRecurringCharges, postInvoices,
  setChargeIdGenerator,
} from './engine'
import { setToday, stamp, today } from './clock'
import { addMonths, nextCycleDate, priorCycleDate, wholeMonths } from './cycles'
import { applyWaive, waiveCharge } from './waive'
import { applyUnappliedStub, publishRateVersionStub, type ApplyUnappliedInput, type RateVersionStubInput } from './stubs'
import { cleanApprovalPreview, nextUndecidedAfter, queueItems } from './selectors'
import type { ChargeEdit, PriorChange, RunRecord, StoreData, Tab } from './state'

export const DEFAULT_CYCLE_DATE = '2026-10-01'
export const DEFAULT_ACTOR = 'M. Alvarez'

export interface StoreActions {
  /** Generate recurring and event charges for cycleDate, append them as proposed, and record the prior-cycle diff. */
  runCycle(): RunRecord
  /** Approve a proposed charge. When it was the selected item, selection moves to the next undecided one. */
  approve(chargeId: string): void
  /** The charge editAmount would produce, without committing anything (the edit form shows it before confirming). */
  previewEdit(chargeId: string, newBaseCents: number): Charge
  /** Re-price a proposed or approved charge at a new base through computeCharge. An edit is a decision: the charge ends approved. */
  editAmount(chargeId: string, newBaseCents: number, reason: string): Charge
  waive(chargeId: string, reason: WaivedCharge['reason'], note?: string): void
  /** Approve every proposed charge in the run that is not a queue item. Queue items are never touched. */
  bulkApproveClean(): { count: number; cents: number }
  /** Post every approved charge in the run. Refuses while any queue item is undecided. */
  post(): Invoice[]
  /** Pricing owns publishing; this stands in until merge (src/store/stubs.ts). */
  publishRateVersionStub(input: RateVersionStubInput): RateVersion
  /**
   * Account owns applying a payment; this stands in until merge (src/store/stubs.ts). Runs allocate() on the
   * local store and commits the rows. Throws the engine's error on over-allocation, and nothing is written.
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
  /** Reload the seed, clear all UI state, and return the engine clock to TODAY (tests and a dev reset). */
  reset(): void
}

export type StoreState = StoreData & StoreActions

export function initialData(): StoreData {
  return {
    db: loadSeed(),
    cycleDate: DEFAULT_CYCLE_DATE,
    activeTab: 'run',
    selectedChargeId: null,
    runs: {},
    edits: [],
    actor: DEFAULT_ACTOR,
    leftOnAccount: {},
  }
}

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
    if (account && !priorDateByAccount.has(account.id)) priorDateByAccount.set(account.id, priorCycleDate(account, cycleDate))
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

export const useStore = create<StoreState>()((set, get) => {
  // Engine reads always see the current store.
  setEngineDb(() => get().db)

  return {
    ...initialData(),

    runCycle() {
      const { cycleDate, runs } = get()
      const previous = runs[cycleDate]
      let db = get().db

      // Re-running a cycle replaces its proposed set. Decided rows (approved, waived, posted) stay, and the
      // engine skips them. Regenerated rows keep the id of the row they replace so selection stays put.
      const reuse = new Map<string, string>()
      if (previous) {
        const inRun = new Set(previous.chargeIds)
        for (const c of db.charges) if (inRun.has(c.id) && c.status === 'proposed') reuse.set(sourceKey(c), c.id)
        const stale = new Set(reuse.values())
        db = { ...db, charges: db.charges.filter(c => !stale.has(c.id)) }
      }

      const generated = withEngineDb(db, () => [...generateRecurringCharges({ cycleDate }), ...generateEventCharges()])
      const fresh = generated.map(c => {
        const id = reuse.get(sourceKey(c))
        return id ? { ...c, id } : c
      })
      const next = appendCharges(db, fresh)

      const changed = computePriorChanges(next, cycleDate, fresh.filter(c => c.lineType === 'recurring'))
      const existing = new Set(next.charges.map(c => c.id))
      const keptIds = (previous?.chargeIds ?? []).filter(id => existing.has(id))
      const keptChanges = Object.fromEntries(Object.entries(previous?.changedFromPrior ?? {}).filter(([id]) => existing.has(id)))
      const chargeIds = [...new Set([...keptIds, ...fresh.map(c => c.id)])]

      const run: RunRecord = {
        cycleDate,
        ranAt: stamp(),
        chargeIds,
        changedFromPrior: { ...keptChanges, ...changed },
        postedInvoiceIds: previous?.postedInvoiceIds ?? [],
      }
      const nextRuns = { ...runs, [cycleDate]: run }
      const first = queueItems({ ...get(), db: next, runs: nextRuns }).find(i => !i.decided)
      const selected = get().selectedChargeId
      set({
        db: next,
        runs: nextRuns,
        selectedChargeId: selected && existing.has(selected) && chargeIds.includes(selected) ? selected : first?.chargeId ?? null,
      })
      return run
    },

    approve(chargeId) {
      const state = get()
      const c = requireCharge(state.db, chargeId)
      if (c.status !== 'proposed') throw new Error(`Cannot approve ${chargeId}: status is ${c.status}`)
      const selectedChargeId = selectionAfterDecision(state, chargeId)
      set(s => ({ db: setStatus(s.db, new Set([chargeId]), 'approved'), selectedChargeId }))
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
      set(s => ({ db: appendCharges(s.db, [updated]), edits: [...s.edits, edit], selectedChargeId }))
      return updated
    },

    waive(chargeId, reason, note) {
      const state = get()
      const result = waiveCharge({ chargeId, reason, note, by: state.actor, at: stamp() })
      const selectedChargeId = selectionAfterDecision(state, chargeId)
      set(s => ({ db: applyWaive(s.db, result), selectedChargeId }))
    },

    bulkApproveClean() {
      const { chargeIds, count, cents } = cleanApprovalPreview(get())
      if (count > 0) set(s => ({ db: setStatus(s.db, new Set(chargeIds), 'approved') }))
      return { count, cents }
    },

    post() {
      const state = get()
      const run = state.runs[state.cycleDate]
      if (!run) throw new Error('Run the cycle before posting')
      const open = queueItems(state).filter(i => !i.decided)
      if (open.length > 0) throw new Error(`Cannot post: ${open.length} queue item${open.length === 1 ? ' is' : 's are'} undecided`)
      const inRun = new Set(run.chargeIds)
      const ids = state.db.charges.filter(c => inRun.has(c.id) && c.status === 'approved').map(c => c.id)
      const invoices = postInvoices({ chargeIds: ids })
      set(s => ({
        db: applyPosting(s.db, invoices),
        runs: { ...s.runs, [run.cycleDate]: { ...run, postedInvoiceIds: [...run.postedInvoiceIds, ...invoices.map(i => i.id)] } },
      }))
      return invoices
    },

    publishRateVersionStub(input) {
      const row = publishRateVersionStub(get().db, input)
      set(s => ({ db: { ...s.db, rateVersions: [...s.db.rateVersions, row] } }))
      return row
    },

    applyUnapplied(input) {
      const rows = applyUnappliedStub(get().db, input)
      set(s => {
        const leftOnAccount = { ...s.leftOnAccount }
        delete leftOnAccount[input.paymentId]
        return { db: { ...s.db, allocations: [...s.db.allocations, ...rows] }, leftOnAccount }
      })
      return rows
    },

    leaveOnAccount(paymentId) {
      if (!get().db.payments.some(p => p.id === paymentId)) throw new Error(`Unknown payment ${paymentId}`)
      set(s => ({ leftOnAccount: { ...s.leftOnAccount, [paymentId]: stamp() } }))
    },

    advanceCycle() {
      setToday(addMonths(today(), 1))
      set(s => ({ cycleDate: nextCycleDate({ cycle: 'monthly' }, s.cycleDate), selectedChargeId: null, activeTab: 'run' }))
    },

    selectCharge(chargeId) {
      set({ selectedChargeId: chargeId })
    },

    setActiveTab(tab) {
      set({ activeTab: tab })
    },

    reset() {
      setToday()
      set(initialData())
    },
  }
})
