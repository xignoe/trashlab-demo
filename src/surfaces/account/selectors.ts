/**
 * Surface-only view models for the account view, ported from account/src/store/selectors.ts (box 2A.1). Nothing here
 * writes the store and nothing here is a contract type: every shape is assembled from the merged Db (billing's table
 * names: accounts, catalog, allocations, hauler) plus the account slice's sidecars.
 *
 * Every engine call goes to the canonical engine through ./lib/engine.ts in its trailing-db form, so previews run on a
 * shadow db. React reads these through hooks that subscribe to db, the sidecars, and the engine clock separately and
 * memoize on those references (zustand v5 re-renders in a loop when a selector builds a fresh object on every call).
 */
import { useMemo } from 'react'
import { useStore } from '../../store/useStore'
import type { Db } from '../../store/db'
import { dayOf, resolvePrice, type ResolvedPrice } from '../../store/engine'
import type {
  BillingAccount, Charge, Container, Contract, CreditMemo, Frequency, Hauler, Invoice, Party, Payment,
  PaymentAllocation, Request, Route, ScaleTicket, ServiceCatalog, ServiceEvent, ServiceItem, Site, WorkOrder, Zone,
} from '../../types'
import { addDays, daysBetween, nextWeekday, startOfMonth, today, weekdayOf } from './lib/clock'
import { cadenceOf } from '../../store/cycles'
import { byId, withRows } from './lib/db'
import {
  EngineError, FREQUENCY_LABEL, accountBalance, accountInvoices, allocateChecked, billingPeriod, buildReinstatementFee,
  explainPrice, isCycleBoundary, isNoOpChange, nextCycleDate, openBalance, pastDue, planServiceChange, previewNextRun,
  reinstatementFeeCents, statusAfterReinstatement, unallocatedCents,
  type NextRunPreview, type PriceExplanation,
} from './lib/engine'
import { nextId } from './lib/ids'
import { isClosedAccount } from './lib/lifecycle'
import type { LedgerWrite, ServiceChangeArgs, ServiceChangePlan, StatusChange, SuspensionReason } from './lib/types'

/** The five accounts pinned in the rail, in the order the checklist names them. Account ids are shared across seeds. */
export const FOCUS_ACCOUNT_IDS = ['acct_res_maple', 'acct_bakery', 'acct_pm_oakridge', 'acct_contractor_hale', 'acct_res_kerr'] as const

/** The stub QuickBooks sync: anything posted or settled after this date has not reached the ledger. */
export const LAST_QUICKBOOKS_SYNC = '2026-09-08'

export const FIELD_HISTORY_DAYS = 14

/** The account slice's sidecars, as the selectors read them. */
export interface AccountSidecars {
  ledgerWrites: LedgerWrite[]
  statusChanges: StatusChange[]
}

const NO_SIDECARS: AccountSidecars = { ledgerWrites: [], statusChanges: [] }

/**
 * Of the given charges, the ones the office proposed: a manual source and the account surface's `_ac_` id (the
 * reinstatement fee). Since box 3.6 they live in db.charges as proposed, where billing's next run takes them as
 * decisions; this only picks them out for a label, so nothing is ever counted twice.
 */
export function officeProposedCharges(charges: Charge[]): Charge[] {
  return charges.filter(c => c.status === 'proposed' && c.source.type === 'manual' && c.id.includes('_ac_'))
}

// ---------------------------------------------------------------------------------------------
// View model shapes
// ---------------------------------------------------------------------------------------------

export interface ServiceLineView {
  item: ServiceItem
  catalog: ServiceCatalog
  containers: Container[]
  /** resolvePrice on today; undefined when no published price exists (priceError says why). */
  resolved?: ResolvedPrice
  priceError?: string
  /** Monthly for recurring lines, per haul for on-call roll-off. */
  per: 'month' | 'haul'
}

export interface SiteView {
  site: Site
  occupant?: Party
  zone?: Zone
  route?: Route
  lines: ServiceLineView[]
  activeLines: ServiceLineView[]
  endedLines: ServiceLineView[]
}

export interface SyncStatus {
  state: 'inSync' | 'stale'
  reason: string
}

export interface FieldEventView {
  event: ServiceEvent
  site?: Site
  route?: Route
}

export interface InvoiceView {
  invoice: Invoice
  openCents: number
  paidCents: number
  isPastDue: boolean
  daysLate: number
}

export interface PaymentView {
  payment: Payment
  allocations: (PaymentAllocation & { invoice?: Invoice })[]
  unappliedCents: number
}

export interface CreditMemoView {
  memo: CreditMemo
  allocations: (PaymentAllocation & { invoice?: Invoice })[]
  unappliedCents: number
}

export interface WorkOrderView {
  workOrder: WorkOrder
  site?: Site
  container?: Container
  item?: ServiceItem
  catalog?: ServiceCatalog
  isOpen: boolean
}

export interface RequestView {
  request: Request
  site?: Site
  workOrder?: WorkOrder
  isOpen: boolean
}

export interface NextInvoiceView {
  date?: string
  /**
   * previewNextRun's total: the lines the run would generate plus every charge already proposed or approved on the
   * account and not yet invoiced (the office's reinstatement fee included). A suspended account generates nothing
   * (invariant 4), so only the already proposed charges remain.
   */
  estimateCents: number
  lines: Charge[]
  preview: NextRunPreview
  /** The subset of preview.proposed the office proposed (the reinstatement fee), for its label. Already counted. */
  officeProposed: Charge[]
}

export interface AccountView {
  account: BillingAccount
  payer: Party
  hauler?: Hauler
  sites: SiteView[]
  balance: number
  pastDue: number
  lastPayment?: Payment
  nextInvoice: NextInvoiceView
  invoices: InvoiceView[]
  openInvoices: InvoiceView[]
  payments: PaymentView[]
  creditMemos: CreditMemoView[]
  unappliedCredits: CreditMemoView[]
  unappliedPayments: PaymentView[]
  /** Credit memo cents on the account not yet applied to an invoice (header money strip). */
  unappliedCreditCents: number
  /** Payment cents received but not yet applied to an invoice. */
  unappliedPaymentCents: number
  contract?: Contract
  fieldEvents: FieldEventView[]
  workOrders: WorkOrderView[]
  openWorkOrders: WorkOrderView[]
  requests: RequestView[]
  openRequests: RequestView[]
  /** Hold, suspend, resume, and reinstate changes the office made this session, oldest first. */
  statusChanges: StatusChange[]
  sync: { dispatch: SyncStatus; billing: SyncStatus; quickbooks: SyncStatus }
}

// ---------------------------------------------------------------------------------------------
// Builders (pure over Db)
// ---------------------------------------------------------------------------------------------

export function sitesOf(accountId: string, db: Db): Site[] {
  return db.sites.filter(s => s.accountId === accountId)
}

function itemsOfSite(siteId: string, db: Db): ServiceItem[] {
  return db.serviceItems.filter(si => si.siteId === siteId)
}

export function buildServiceLine(item: ServiceItem, site: Site, db: Db): ServiceLineView {
  const catalog = byId(db.catalog, item.catalogId)
  const containers = item.containerIds.map(id => byId(db.containers, id)).filter((c): c is Container => Boolean(c))
  const line: ServiceLineView = {
    item,
    catalog: catalog ?? { id: item.catalogId, lob: 'residential', name: item.catalogId, sizeLabel: '', unit: 'cart', public: false },
    containers,
    per: item.frequency === 'onCall' ? 'haul' : 'month',
  }
  // A line that has not started yet is priced on its start date, the price its first invoice bills (a portal cart change
  // starting Oct 1 shows the Oct 1 rate, not today's); a line already in force is priced today.
  const now = today()
  const startsOn = dayOf(item.effectiveFrom)
  const onDate = startsOn > now ? startsOn : now
  try {
    line.resolved = resolvePrice({ catalogId: item.catalogId, frequency: item.frequency, zoneId: site.zoneId, accountId: site.accountId, onDate }, db)
  } catch (err) {
    line.priceError = err instanceof Error ? err.message : String(err)
  }
  return line
}

export function buildSiteView(site: Site, db: Db): SiteView {
  const lines = itemsOfSite(site.id, db).map(item => buildServiceLine(item, site, db))
  return {
    site,
    occupant: byId(db.parties, site.occupantPartyId),
    zone: byId(db.zones, site.zoneId),
    route: byId(db.routes, site.routeId),
    lines,
    activeLines: lines.filter(l => l.item.status !== 'ended'),
    endedLines: lines.filter(l => l.item.status === 'ended'),
  }
}

function allocationsFor(sourceType: PaymentAllocation['sourceType'], sourceId: string, db: Db) {
  return db.allocations
    .filter(a => a.sourceType === sourceType && a.sourceId === sourceId)
    .map(a => ({ ...a, invoice: byId(db.invoices, a.invoiceId) }))
}

export function buildInvoiceView(invoice: Invoice, db: Db): InvoiceView {
  const openCents = openBalance(invoice.id, db)
  const now = today()
  const due = dayOf(invoice.dueAt)
  const isPastDue = openCents > 0 && due < now
  return {
    invoice,
    openCents,
    paidCents: invoice.totalCents - openCents,
    isPastDue,
    daysLate: isPastDue ? daysBetween(due, now) : 0,
  }
}

/**
 * Sync chips are deterministic stubs (prototype DECISIONS.md, Phases 3 to 6):
 * dispatch is stale while a WorkOrder on the account is still `open`, or when a `scheduled` one has no date or a date
 * in the past without being marked done;
 * billing is stale when any Charge on the account is still proposed in db.charges (billing's run, or the office's
 * reinstatement fee waiting for the next run);
 * QuickBooks is stale when a posted Invoice or settled Payment is dated after the last stub sync, or when the office
 * wrote a payment, credit, or allocation this session (buildQuickbooksSync).
 */
export function buildSync(
  accountId: string,
  siteIds: string[],
  db: Db,
  ledgerWrites: LedgerWrite[] = [],
): AccountView['sync'] {
  const now = today()
  const mine = db.workOrders.filter(wo => siteIds.includes(wo.siteId))
  const unscheduled = mine.filter(wo => wo.status === 'open')
  const overdue = mine.find(wo => wo.status === 'scheduled' && (!wo.scheduledFor || dayOf(wo.scheduledFor) < now))
  const dispatch: SyncStatus = unscheduled.length
    ? {
        state: 'stale',
        reason:
          unscheduled.length === 1
            ? `Work order ${unscheduled[0].id} for ${unscheduled[0].scheduledFor} is open and not yet scheduled on a route`
            : `${unscheduled.length} work orders are open and not yet scheduled on a route (${unscheduled.map(w => w.id).join(', ')})`,
      }
    : overdue
      ? {
          state: 'stale',
          reason: overdue.scheduledFor
            ? `Work order ${overdue.id} was scheduled for ${overdue.scheduledFor} and is not marked done`
            : `Work order ${overdue.id} is scheduled with no date`,
        }
      : { state: 'inSync', reason: 'Every work order is scheduled on a route or done' }

  const proposed = db.charges.filter(c => c.accountId === accountId && c.status === 'proposed')
  const office = officeProposedCharges(proposed)
  const others = proposed.length - office.length
  const billing: SyncStatus = office.length
    ? {
        state: 'stale',
        reason: `${office.map(c => `${c.description} ${c.id}`).join(', ')} proposed by the office, waiting for a billing decision${
          others ? `; ${others} more proposed ${others === 1 ? 'charge' : 'charges'} not yet on an invoice` : ''
        }`,
      }
    : proposed.length
      ? { state: 'stale', reason: `${proposed.length} proposed ${proposed.length === 1 ? 'charge' : 'charges'} not yet on an invoice` }
      : { state: 'inSync', reason: 'No proposed charges waiting for a billing run' }

  return { dispatch, billing, quickbooks: buildQuickbooksSync(accountId, db, ledgerWrites) }
}

const LEDGER_KIND_WORDS: Record<LedgerWrite['kind'], string> = {
  payment: 'payment',
  creditMemo: 'credit memo',
  allocation: 'allocation',
}

/**
 * QuickBooks chip: stale when a posted Invoice or settled Payment is dated after the last stub sync, or when the
 * office wrote a payment, credit memo, or allocation this session (ledgerWrites sidecar). The sidecar wins the reason
 * because it is the office's own unsynced work: "Payment not yet synced".
 */
export function buildQuickbooksSync(accountId: string, db: Db, ledgerWrites: LedgerWrite[] = []): SyncStatus {
  const mine = ledgerWrites.filter(w => w.accountId === accountId)
  if (mine.length) {
    const last = mine[mine.length - 1]
    const what = last.kind === 'allocation' ? `allocation of ${last.sourceId}` : `${LEDGER_KIND_WORDS[last.kind]} ${last.sourceId}`
    const lead = mine.some(w => w.kind === 'payment' || (w.kind === 'allocation' && w.sourceId.startsWith('pay')))
      ? 'Payment not yet synced'
      : 'Credit not yet synced'
    return {
      state: 'stale',
      reason: `${lead}: ${mine.length === 1 ? what : `${mine.length} ledger changes, latest the ${what}`} recorded ${last.at}, after the last sync on ${LAST_QUICKBOOKS_SYNC}`,
    }
  }
  const lateInvoice = db.invoices.find(i => i.accountId === accountId && i.postedAt && dayOf(i.postedAt) > LAST_QUICKBOOKS_SYNC)
  const latePayment = db.payments.find(p => p.accountId === accountId && p.status === 'settled' && dayOf(p.receivedAt) > LAST_QUICKBOOKS_SYNC)
  return lateInvoice
    ? { state: 'stale', reason: `Invoice ${lateInvoice.number} posted ${dayOf(lateInvoice.postedAt!)} after the last sync on ${LAST_QUICKBOOKS_SYNC}` }
    : latePayment
      ? { state: 'stale', reason: `Payment ${latePayment.id} settled ${latePayment.receivedAt} after the last sync on ${LAST_QUICKBOOKS_SYNC}` }
      : { state: 'inSync', reason: `Ledger matches QuickBooks as of the last sync on ${LAST_QUICKBOOKS_SYNC}` }
}

export function buildFieldEvents(siteIds: string[], db: Db): FieldEventView[] {
  const now = today()
  const from = addDays(now, -FIELD_HISTORY_DAYS)
  return db.serviceEvents
    .filter(ev => siteIds.includes(ev.siteId) && dayOf(ev.date) >= from && dayOf(ev.date) <= now)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1))
    .map(event => ({ event, site: byId(db.sites, event.siteId), route: byId(db.routes, event.routeId) }))
}

const WO_OPEN: WorkOrder['status'][] = ['open', 'scheduled']
const REQ_OPEN: Request['status'][] = ['open', 'scheduled']

function byDateDesc<T>(pick: (t: T) => string) {
  return (a: T, b: T) => (pick(a) < pick(b) ? 1 : pick(a) > pick(b) ? -1 : 0)
}

export function buildWorkOrders(siteIds: string[], db: Db): WorkOrderView[] {
  return db.workOrders
    .filter(wo => siteIds.includes(wo.siteId))
    .map((workOrder): WorkOrderView => {
      const item = byId(db.serviceItems, workOrder.serviceItemId)
      return {
        workOrder,
        site: byId(db.sites, workOrder.siteId),
        container: byId(db.containers, workOrder.containerId),
        item,
        catalog: item ? byId(db.catalog, item.catalogId) : undefined,
        isOpen: WO_OPEN.includes(workOrder.status),
      }
    })
    .sort((a, b) => Number(b.isOpen) - Number(a.isOpen) || byDateDesc<WorkOrderView>(w => w.workOrder.scheduledFor)(a, b))
}

export function buildRequests(accountId: string, db: Db): RequestView[] {
  return db.requests
    .filter(r => r.accountId === accountId)
    .map((request): RequestView => ({
      request,
      site: byId(db.sites, request.siteId),
      workOrder: byId(db.workOrders, request.workOrderId),
      isOpen: REQ_OPEN.includes(request.status),
    }))
    .sort((a, b) => Number(b.isOpen) - Number(a.isOpen))
}

/** A vacation hold the customer asked for in the portal, ready for the hold drawer (box 3.3). */
export interface PortalHoldDraft {
  /** The portal's vacationHold Request; the drawer's confirm names it, so no second Request is written. */
  requestId: string
  siteId: string
  /** First and last held day, from the portal's hold rows. */
  start: string
  end: string
  /** What the drawer applies: the hold starts on the first held day and service resumes the day after the last. */
  effectiveFrom: string
  resumeOn: string
  /** The portal's hold rows (one per held item) this draft stands for. */
  holdIds: string[]
}

/** The portal writes its vacationHold note as "Vacation hold <start> to <end>, pickups resume <date>". */
const PORTAL_HOLD_NOTE = /^Vacation hold (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/

/**
 * The hold drawer draft for an open vacationHold Request the customer filed in the portal: the range from the portal's
 * own hold rows at that site (portal slice `holds`), matched to the range the Request names. Undefined for any other
 * request, or when no hold row backs it.
 */
export function portalHoldDraft(
  request: Request,
  db: Db,
  holds: readonly { id: string; serviceItemId: string; start: string; end: string }[],
): PortalHoldDraft | undefined {
  if (request.kind !== 'vacationHold' || request.createdVia !== 'portal' || !REQ_OPEN.includes(request.status)) return undefined
  const m = PORTAL_HOLD_NOTE.exec(request.note ?? '')
  if (!m) return undefined
  const [, start, end] = m
  const itemIds = new Set(db.serviceItems.filter(i => i.siteId === request.siteId).map(i => i.id))
  const rows = holds.filter(h => itemIds.has(h.serviceItemId) && h.start === start && h.end === end)
  if (rows.length === 0) return undefined
  return { requestId: request.id, siteId: request.siteId, start, end, effectiveFrom: start, resumeOn: addDays(end, 1), holdIds: rows.map(h => h.id) }
}

/** The account's contract: the one its contractId names, else the first contract on the account. */
export function contractOf(account: BillingAccount, db: Db): Contract | undefined {
  return (account.contractId ? byId(db.contracts, account.contractId) : undefined) ?? db.contracts.find(c => c.accountId === account.id)
}

export function buildAccountView(accountId: string, db: Db, sidecars: Partial<AccountSidecars> = {}): AccountView | undefined {
  const side = { ...NO_SIDECARS, ...sidecars }
  const account = byId(db.accounts, accountId)
  if (!account) return undefined
  const payer = byId(db.parties, account.payerPartyId) ?? { id: account.payerPartyId, name: account.payerPartyId, kind: 'homeowner' as const }
  const sites = sitesOf(accountId, db).map(s => buildSiteView(s, db))
  const siteIds = sites.map(s => s.site.id)

  const invoices = accountInvoices(accountId, db)
    .map(inv => buildInvoiceView(inv, db))
    .sort(byDateDesc<InvoiceView>(v => v.invoice.issuedAt))
  const payments = db.payments
    .filter(p => p.accountId === accountId)
    .map((payment): PaymentView => ({
      payment,
      allocations: allocationsFor('payment', payment.id, db),
      unappliedCents: unallocatedCents('payment', payment.id, db),
    }))
    .sort(byDateDesc<PaymentView>(v => v.payment.receivedAt))
  const creditMemos = db.creditMemos
    .filter(m => m.accountId === accountId)
    .map((memo): CreditMemoView => ({
      memo,
      allocations: allocationsFor('creditMemo', memo.id, db),
      unappliedCents: unallocatedCents('creditMemo', memo.id, db),
    }))
    .sort(byDateDesc<CreditMemoView>(v => v.memo.at))

  const preview = previewNextRun(accountId, db)
  const officeProposed = officeProposedCharges(preview.proposed)
  const workOrders = buildWorkOrders(siteIds, db)
  const requests = buildRequests(accountId, db)

  return {
    account,
    payer,
    hauler: db.hauler[0],
    sites,
    balance: accountBalance(accountId, db),
    pastDue: pastDue(accountId, db),
    lastPayment: payments.find(p => p.payment.status !== 'returned')?.payment,
    nextInvoice: {
      date: preview.cycleDate,
      estimateCents: preview.totalCents,
      lines: [...preview.recurring, ...preview.events, ...preview.proposed],
      preview,
      officeProposed,
    },
    invoices,
    openInvoices: invoices.filter(v => v.openCents > 0),
    payments,
    creditMemos,
    unappliedCredits: creditMemos.filter(m => m.unappliedCents > 0),
    unappliedPayments: payments.filter(p => p.unappliedCents > 0),
    contract: contractOf(account, db),
    fieldEvents: buildFieldEvents(siteIds, db),
    workOrders,
    openWorkOrders: workOrders.filter(w => w.isOpen),
    requests,
    openRequests: requests.filter(r => r.isOpen),
    statusChanges: side.statusChanges.filter(c => c.accountId === accountId),
    unappliedCreditCents: creditMemos.reduce((sum, m) => sum + Math.max(0, m.unappliedCents), 0),
    unappliedPaymentCents: payments.reduce((sum, p) => sum + (p.payment.status === 'returned' ? 0 : Math.max(0, p.unappliedCents)), 0),
    sync: buildSync(accountId, siteIds, db, side.ledgerWrites),
  }
}

// ---------------------------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------------------------

/**
 * The store fields the account view reads, each subscribed on its own so every selector returns a stable reference.
 * The engine clock is module state; reading it through the store (as the persona bar does) re-renders on Next cycle.
 */
export function useAccountData(): { db: Db; sidecars: AccountSidecars; now: string } {
  const db = useStore(s => s.db)
  const accountEdits = useStore(s => s.accountEdits)
  const now = useStore(() => today())
  const sidecars = useMemo(
    () => ({ ledgerWrites: accountEdits.ledgerWrites, statusChanges: accountEdits.statusChanges }),
    [accountEdits],
  )
  return { db, sidecars, now }
}

/** The whole account view for one account. Re-computes whenever db, a sidecar, or the clock changes (invariant 3 in the UI). */
export function useAccountView(accountId: string): AccountView | undefined {
  const { db, sidecars, now } = useAccountData()
  // `now` is a dependency so a moved clock recomputes due dates and the next cycle; the builders read today() directly.
  return useMemo(() => buildAccountView(accountId, db, sidecars), [accountId, db, sidecars, now])
}

// ---------------------------------------------------------------------------------------------
// Price explanation
// ---------------------------------------------------------------------------------------------

export interface PriceExplanationView {
  explanation?: PriceExplanation
  error?: string
  /** Plain-words sentence for the inset headline. */
  summary: string
  /** Supporting sentences, in order. */
  details: string[]
}

function dollars(cents: number): string {
  const abs = Math.abs(cents)
  return `$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`
}

function longDate(iso?: string): string {
  if (!iso) return ''
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${months[m - 1]} ${d}, ${y}`
}

/** Runs explainPrice for a service line and turns the precedence chain into office prose. */
export function explainServiceLine(line: ServiceLineView, site: Site, db: Db): PriceExplanationView {
  const args = { catalogId: line.item.catalogId, frequency: line.item.frequency, zoneId: site.zoneId, accountId: site.accountId, onDate: today() }
  let explanation: PriceExplanation
  try {
    explanation = explainPrice(args, db)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return { error, summary: 'No published price for this line.', details: [error] }
  }
  const zone = byId(db.zones, site.zoneId)
  const zoneName = zone?.name ?? site.zoneId
  const freq = FREQUENCY_LABEL[line.item.frequency]
  const per = line.per === 'haul' ? 'per haul' : 'per month'
  const details: string[] = []
  let summary: string

  const rv = explanation.rateVersion
  const rateSentence = rv
    ? `${rv.ruleWon === 'zoneRate' ? 'Zone rate' : 'Standard rate'} ${rv.id} for ${rv.zoneId ? zoneName : 'all zones'}, ${rv.frequency ? FREQUENCY_LABEL[rv.frequency] : 'any frequency'}: ${dollars(rv.priceCents)} effective ${longDate(rv.effectiveFrom)}${rv.publishedAt ? `, published ${longDate(rv.publishedAt)}` : ''}.`
    : 'No published rate card version matches this catalog item, zone, and frequency.'

  if (explanation.contractOverride) {
    const o = explanation.contractOverride
    const pct = o.pctBelowRateCard !== undefined ? `, ${o.pctBelowRateCard}% below rate card` : ''
    const why = o.reason ? ` for "${o.reason}"` : ''
    summary = rv
      ? `Contract ${o.contractId} override of ${dollars(o.priceCents)} ${per} won over the ${dollars(rv.priceCents)} ${rv.ruleWon === 'zoneRate' ? 'zone' : 'standard'} rate${pct}${why}.`
      : `Contract ${o.contractId} override of ${dollars(o.priceCents)} ${per} won${pct}${why}; no rate card version exists to compare against.`
    details.push(`Override applies to ${line.catalog.name}${o.frequency ? `, ${FREQUENCY_LABEL[o.frequency]}` : ', any frequency'} inside the term ${longDate(o.termStart)} to ${longDate(o.termEnd)}. After the term the rate card wins again.`)
    details.push(`Rate card it beat: ${rateSentence}`)
  } else if (rv) {
    summary = `No contract override on this account. ${rv.ruleWon === 'zoneRate' ? 'Zone rate' : 'Standard rate'} ${rv.id} won: ${dollars(rv.priceCents)} ${per}, effective ${longDate(rv.effectiveFrom)}${rv.publishedAt ? `, published ${longDate(rv.publishedAt)}` : ''}.`
    details.push(`Matched ${zoneName} (${site.zoneId}) and ${freq}${rv.frequency ? '' : ' (version has no frequency, so it matches any)'}${rv.zoneId ? '' : '; no zone-specific version exists, so the standard version applies'}.`)
  } else {
    summary = `Price ${dollars(explanation.priceCents)} ${per}, rule ${explanation.ruleWon}.`
  }

  if (explanation.priorVersion) {
    const p = explanation.priorVersion
    details.push(`It replaced ${p.id} at ${dollars(p.priceCents)} (effective ${longDate(p.effectiveFrom)}${p.publishedAt ? `, published ${longDate(p.publishedAt)}` : ''}), which is why the price changed on the ${longDate(rv?.effectiveFrom)} invoice.`)
  }

  return { explanation, summary, details }
}

// ---------------------------------------------------------------------------------------------
// Contract card
// ---------------------------------------------------------------------------------------------

export interface ContractOverrideView {
  catalog?: ServiceCatalog
  catalogId: string
  frequency?: Frequency
  priceCents: number
  pctBelowRateCard?: number
  reason?: string
  /** The rate card price the override sits below, when one is published. */
  rateCardCents?: number
  escalatedCents?: number
}

export interface ContractView {
  contract: Contract
  daysUntilTermEnd: number
  noticeBy: string
  noticeDaysLeft: number
  nextAnniversary?: string
  overrides: ContractOverrideView[]
  /**
   * Start of the auto-renewed term, when the canonical resolvePrice has auto-renewed this contract for today (addendum
   * I1): the contract card then says "Auto-renewed on <date>". Absent while the contract is in its signed term.
   */
  renewedOn?: string
}

/**
 * The first anniversary strictly after today. Addendum B1: the anniversary is a full ISO date (the first escalation,
 * e.g. 2027-01-01); a date already past rolls forward a year at a time until it is after today.
 */
export function nextAnniversary(anniversary: string, from: string = today()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anniversary)) throw new EngineError(`Escalator anniversary must be YYYY-MM-DD, got ${anniversary}`)
  let year = Number(anniversary.slice(0, 4))
  const monthDay = anniversary.slice(4)
  while (`${year}${monthDay}` <= from) year += 1
  return `${year}${monthDay}`
}

export function buildContractView(contract: Contract, db: Db): ContractView {
  const now = today()
  const site = sitesOf(contract.accountId, db)[0]
  const pct = contract.escalator?.pct
  const overrides = contract.overrides.map((o): ContractOverrideView => {
    let rateCardCents: number | undefined
    if (site) {
      // The rate card the override sits below: the canonical resolvePrice with contracts set aside.
      const frequency = o.frequency ?? db.serviceItems.find(si => si.siteId === site.id && si.catalogId === o.catalogId)?.frequency ?? 'weekly'
      try {
        rateCardCents = resolvePrice({ catalogId: o.catalogId, frequency, zoneId: site.zoneId, accountId: contract.accountId, onDate: now }, { ...db, contracts: [] }).priceCents
      } catch {
        rateCardCents = undefined
      }
    }
    return {
      catalog: byId(db.catalog, o.catalogId),
      catalogId: o.catalogId,
      frequency: o.frequency,
      priceCents: o.priceCents,
      pctBelowRateCard: o.pctBelowRateCard,
      reason: o.reason,
      rateCardCents,
      escalatedCents: pct !== undefined ? Math.round(o.priceCents * (1 + pct / 100)) : undefined,
    }
  })
  // Ask the engine that bills, not a date comparison: resolvePrice names renewedOn only when this contract priced the
  // line under an auto-renewed term on today's date (addendum I1), and not when a newer contract replaced it (K3).
  let renewedOn: string | undefined
  if (site) {
    for (const o of contract.overrides) {
      const frequency = o.frequency ?? db.serviceItems.find(si => si.siteId === site.id && si.catalogId === o.catalogId)?.frequency ?? 'weekly'
      try {
        const r = resolvePrice({ catalogId: o.catalogId, frequency, zoneId: site.zoneId, accountId: contract.accountId, onDate: now }, db)
        if (r.contractId === contract.id && r.renewedOn) {
          renewedOn = r.renewedOn
          break
        }
      } catch {
        // No published rate for this item: the override cannot be resolved, so it says nothing about renewal.
      }
    }
  }
  const noticeBy = addDays(dayOf(contract.termEnd), -contract.renewalNoticeDays)
  return {
    contract,
    daysUntilTermEnd: daysBetween(now, contract.termEnd),
    noticeBy,
    noticeDaysLeft: daysBetween(now, noticeBy),
    nextAnniversary: contract.escalator ? nextAnniversary(contract.escalator.anniversary) : undefined,
    overrides,
    ...(renewedOn ? { renewedOn } : {}),
  }
}

// ---------------------------------------------------------------------------------------------
// Roll-off detail
// ---------------------------------------------------------------------------------------------

export interface ScaleTicketView {
  ticket: ScaleTicket
  tons: number
  overTons: number
  /** The proposed overage Charge from generateEventCharges, when the ticket is over cap and not yet charged. */
  overage?: Charge
}

export interface RolloffBoxView {
  container: Container
  site?: Site
  item?: ServiceItem
  catalog: ServiceCatalog
  deliveredOn?: string
  daysOut?: number
  includedDays: number
  extraDays: number
  /** The catalog's extraDayCents: what each day past includedDays bills at (addendum C11). */
  extraDayCents: number
  /** extraDays at extraDayCents, counted from delivery to today, the same count the engine bills (DECISIONS.md entry 38). */
  extraDaysCents: number
  /**
   * The extra-day Charge the next billing run would propose for this box, from the canonical generateEventCharges
   * (via previewNextRun), when there are extra days not yet on any Charge. Not in db.
   */
  extraDayCharge?: Charge
  /** The latest extra-day Charge already in db for this box, whatever its status: how far the extra days are billed. */
  extraDaysBilled?: Charge
  tickets: ScaleTicketView[]
}

export function buildRolloffBoxes(accountId: string, db: Db): RolloffBoxView[] {
  const now = today()
  const siteIds = sitesOf(accountId, db).map(s => s.id)
  const items = db.serviceItems.filter(si => siteIds.includes(si.siteId))
  const boxes: RolloffBoxView[] = []
  const events = previewNextRun(accountId, db).events
  for (const item of items) {
    const catalog = byId(db.catalog, item.catalogId)
    if (!catalog?.rolloff) continue
    const rolloff = catalog.rolloff
    for (const containerId of item.containerIds) {
      const container = byId(db.containers, containerId)
      if (!container) continue
      const deliver = db.workOrders
        .filter(wo => wo.kind === 'deliver' && wo.status === 'done' && wo.containerId === containerId)
        .sort(byDateDesc<WorkOrder>(w => w.completedAt ?? w.scheduledFor))[0]
      const deliveredOn = (deliver?.completedAt ?? deliver?.scheduledFor ?? container.assignedFrom)?.slice(0, 10)
      const daysOut = deliveredOn ? daysBetween(deliveredOn, now) : undefined
      const extraDays = daysOut !== undefined ? Math.max(0, daysOut - rolloff.includedDays) : 0
      // An extra-day Charge is the engine's event line for this box: sourced from its ServiceItem, carrying the box id
      // as evidence and the billed days as its period (generateEventCharges, DECISIONS.md entry 38).
      const isExtraDays = (c: Charge) =>
        c.lineType === 'event' && c.source.type === 'serviceItem' && c.source.id === item.id && c.period !== undefined && c.evidenceIds.includes(containerId)
      const extraDayCharge = events.find(isExtraDays)
      const extraDaysBilled = db.charges.filter(isExtraDays).sort((a, b) => a.period!.end.localeCompare(b.period!.end)).at(-1)
      const tickets = db.scaleTickets
        .filter(t => t.containerId === containerId)
        .map((ticket): ScaleTicketView => {
          const tons = ticket.netLbs / 2000
          return {
            ticket,
            tons,
            overTons: Math.max(0, tons - rolloff.includedTons),
            overage: events.find(c => c.source.type === 'scaleTicket' && c.source.id === ticket.id),
          }
        })
      boxes.push({
        container,
        site: byId(db.sites, item.siteId),
        item,
        catalog,
        deliveredOn,
        daysOut,
        includedDays: rolloff.includedDays,
        extraDays,
        extraDayCents: rolloff.extraDayCents,
        extraDaysCents: extraDays * rolloff.extraDayCents,
        ...(extraDayCharge ? { extraDayCharge } : {}),
        ...(extraDaysBilled ? { extraDaysBilled } : {}),
        tickets,
      })
    }
  }
  return boxes
}

export function hasRolloff(view: AccountView): boolean {
  return view.sites.some(s => s.lines.some(l => Boolean(l.catalog.rolloff)))
}

// ---------------------------------------------------------------------------------------------
// Rail: pinned accounts and search
// ---------------------------------------------------------------------------------------------

export interface AccountSummary {
  account: BillingAccount
  payer?: Party
  sites: Site[]
  /** First site address, for the rail line under the name. */
  address?: string
}

export function accountSummary(accountId: string, db: Db): AccountSummary | undefined {
  const account = byId(db.accounts, accountId)
  if (!account) return undefined
  const sites = sitesOf(accountId, db)
  return { account, payer: byId(db.parties, account.payerPartyId), sites, address: sites[0]?.address }
}

/** Case-insensitive match on payer name, account id, any site address, or any PO number. Empty query returns nothing. */
export function searchAccounts(query: string, db: Db, limit = 12): AccountSummary[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: AccountSummary[] = []
  for (const a of db.accounts) {
    const summary = accountSummary(a.id, db)
    if (!summary) continue
    const haystack = [
      summary.payer?.name ?? '',
      summary.account.id,
      ...summary.sites.map(s => s.address),
      ...summary.sites.map(s => s.poNumber ?? ''),
    ]
      .join(' ')
      .toLowerCase()
    if (haystack.includes(q)) out.push(summary)
    if (out.length >= limit) break
  }
  return out
}

export function useAccountSearch(query: string): AccountSummary[] {
  const db = useStore(s => s.db)
  return useMemo(() => searchAccounts(query, db), [query, db])
}

/**
 * The rail's pinned list: the five focus accounts, then every account a storefront signup or an approved held quote
 * created this session (ids with the storefront's `_sf_` infix, addendum C12), newest first, so a new customer is one
 * click away from the Office persona (box 3.1).
 */
export function pinnedAccountIds(db: Db): string[] {
  const signups = db.accounts.filter(a => a.id.includes('_sf_')).map(a => a.id).reverse()
  return [...FOCUS_ACCOUNT_IDS, ...signups]
}

export function usePinnedAccounts(): AccountSummary[] {
  const db = useStore(s => s.db)
  return useMemo(() => pinnedAccountIds(db).map(id => accountSummary(id, db)).filter((s): s is AccountSummary => Boolean(s)), [db])
}

// ---------------------------------------------------------------------------------------------
// Accounts table: one flat row per account
// ---------------------------------------------------------------------------------------------

export interface AccountRow {
  id: string
  name: string
  kind?: Party['kind']
  /** First site address. */
  address?: string
  siteCount: number
  /** Route day of the first routed site. */
  routeDay?: Route['day']
  status: BillingAccount['status']
  cycle: BillingAccount['cycle']
  autopay: boolean
  deliveryMethod: BillingAccount['deliveryMethod']
  /** Service items not ended, across every site. */
  serviceCount: number
  /**
   * Monthly recurring revenue: today's price x qty for every active, recurring (not on-call) line in force today, before
   * fees and tax, the same price x qty the billing run bills per month. Zero for a suspended account, which bills nothing.
   */
  monthlyRevenueCents: number
  /** Lines left out of monthlyRevenueCents because no published price resolves for them. */
  unpricedLines: number
  /** Closed by the office: suspended with every service line ended (isClosedAccount). */
  isClosed: boolean
  balanceCents: number
  pastDueCents: number
  /** Days since the oldest past-due invoice fell due; 0 when nothing is past due. */
  daysLate: number
  lastPaymentAt?: string
  /** Open or scheduled requests and work orders. */
  openItems: number
  /** Lower-cased name, id, addresses, and POs, for the search box. */
  haystack: string
}

function groupBy<T>(rows: readonly T[], key: (t: T) => string | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    if (k === undefined) continue
    const list = out.get(k)
    if (list) list.push(r)
    else out.set(k, [r])
  }
  return out
}

/**
 * Every account as one row. Indexes each table once, so the cost is linear in the db and the table stays fast at
 * thousands of accounts. Balances follow the engine: an invoice is open by its total less every allocation against it,
 * and past due when that open amount is above zero and its due day is before today.
 */
export function buildAccountRows(db: Db): AccountRow[] {
  const now = today()
  const parties = new Map(db.parties.map(p => [p.id, p]))
  const routes = new Map(db.routes.map(r => [r.id, r]))
  const sitesByAccount = groupBy(db.sites, s => s.accountId)
  const itemsBySite = groupBy(db.serviceItems, i => i.siteId)
  const invoicesByAccount = groupBy(db.invoices, i => i.accountId)
  const paymentsByAccount = groupBy(db.payments, p => p.accountId)
  const requestsByAccount = groupBy(db.requests, r => r.accountId)
  const workOrdersBySite = groupBy(db.workOrders, w => w.siteId)
  const allocated = new Map<string, number>()
  for (const a of db.allocations) allocated.set(a.invoiceId, (allocated.get(a.invoiceId) ?? 0) + a.cents)

  return db.accounts.map((account): AccountRow => {
    const payer = parties.get(account.payerPartyId)
    const sites = sitesByAccount.get(account.id) ?? []
    const accountItems: ServiceItem[] = []
    let serviceCount = 0
    let openItems = 0
    let monthlyRevenueCents = 0
    let unpricedLines = 0
    for (const site of sites) {
      for (const item of itemsBySite.get(site.id) ?? []) {
        accountItems.push(item)
        if (item.status !== 'ended') serviceCount += 1
        const inForce = dayOf(item.effectiveFrom) <= now && (item.effectiveTo === undefined || dayOf(item.effectiveTo) > now)
        if (account.status === 'suspended' || item.status !== 'active' || item.frequency === 'onCall' || !inForce) continue
        try {
          const price = resolvePrice({ catalogId: item.catalogId, frequency: item.frequency, zoneId: site.zoneId, accountId: account.id, onDate: now }, db)
          monthlyRevenueCents += price.priceCents * item.qty
        } catch {
          unpricedLines += 1
        }
      }
      for (const wo of workOrdersBySite.get(site.id) ?? []) if (WO_OPEN.includes(wo.status)) openItems += 1
    }
    for (const r of requestsByAccount.get(account.id) ?? []) if (REQ_OPEN.includes(r.status)) openItems += 1

    let balanceCents = 0
    let pastDueCents = 0
    let oldestDue: string | undefined
    for (const inv of invoicesByAccount.get(account.id) ?? []) {
      const open = inv.totalCents - (allocated.get(inv.id) ?? 0)
      balanceCents += open
      const due = dayOf(inv.dueAt)
      if (due < now) {
        pastDueCents += open
        if (open > 0 && (!oldestDue || due < oldestDue)) oldestDue = due
      }
    }

    let lastPaymentAt: string | undefined
    for (const p of paymentsByAccount.get(account.id) ?? []) {
      if (p.status !== 'returned' && (!lastPaymentAt || p.receivedAt > lastPaymentAt)) lastPaymentAt = p.receivedAt
    }

    const routed = sites.find(s => s.routeId && routes.has(s.routeId))
    const name = payer?.name ?? account.id
    return {
      id: account.id,
      name,
      kind: payer?.kind,
      address: sites[0]?.address,
      siteCount: sites.length,
      routeDay: routed ? routes.get(routed.routeId!)!.day : undefined,
      status: account.status,
      cycle: account.cycle,
      autopay: account.autopay,
      deliveryMethod: account.deliveryMethod,
      serviceCount,
      isClosed: isClosedAccount(account, accountItems),
      monthlyRevenueCents,
      unpricedLines,
      balanceCents,
      pastDueCents,
      daysLate: oldestDue ? daysBetween(oldestDue, now) : 0,
      lastPaymentAt,
      openItems,
      haystack: [name, account.id, ...sites.map(s => s.address), ...sites.map(s => s.poNumber ?? '')].join(' ').toLowerCase(),
    }
  })
}

export function useAccountRows(): AccountRow[] {
  const db = useStore(s => s.db)
  const now = useStore(() => today())
  // `now` is a dependency so a moved clock recomputes past due and days late.
  return useMemo(() => buildAccountRows(db), [db, now])
}

/** Weekday of the route serving a site, for meta lines ("Monday route"). */
export const ROUTE_DAY_LONG: Record<Route['day'], string> = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday' }

export function todayWeekday(): string {
  return weekdayOf(today())
}

// ---------------------------------------------------------------------------------------------
// Change service drawer: options and the pure before-and-after preview (invariant 3)
// ---------------------------------------------------------------------------------------------

const ALL_FREQUENCIES: Frequency[] = ['weekly', 'eow', '2x', '3x', '4x', '5x', '6x', 'onCall']

/** Default effective date for a service change: the next Monday after today (2026-09-14 on the demo clock). */
export function defaultChangeDate(): string {
  return nextWeekday(today(), 'Mon')
}

/** The site's line of business: its route's, else the first item's catalog, else residential. */
export function siteLob(site: Site, db: Db): ServiceCatalog['lob'] {
  const route = byId(db.routes, site.routeId)
  if (route) return route.lob
  const item = itemsOfSite(site.id, db)[0]
  return (item && byId(db.catalog, item.catalogId)?.lob) || 'residential'
}

/** Catalog entries a site can take, filtered to its line of business. */
export function catalogForSite(site: Site, db: Db): ServiceCatalog[] {
  const lob = siteLob(site, db)
  return db.catalog.filter(c => c.lob === lob)
}

/** Frequencies with a published price (or contract override) for this catalog at this site on the date. */
export function priceableFrequencies(catalogId: string, site: Site, onDate: string, db: Db): Frequency[] {
  return ALL_FREQUENCIES.filter(frequency => {
    try {
      resolvePrice({ catalogId, frequency, zoneId: site.zoneId, accountId: site.accountId, onDate }, db)
      return true
    } catch {
      return false
    }
  })
}

export interface ChangeLineView {
  item?: ServiceItem
  catalog: ServiceCatalog
  qty: number
  frequency: Frequency
  containers: Container[]
  price?: ResolvedPrice
  priceError?: string
  /** price times qty: per month for recurring lines, per haul for on-call. */
  lineCents?: number
  per: 'month' | 'haul'
}

export interface ServiceChangePreview {
  args: ServiceChangeArgs
  site: Site
  account: BillingAccount
  hauler?: Hauler
  /** The form matches the replaced item exactly; nothing to preview yet. */
  noop: boolean
  error?: string
  plan?: ServiceChangePlan
  oldLine?: ChangeLineView
  newLine?: ChangeLineView
  /** Containers the WorkOrder pulls (the replaced item's) and the one it drops. */
  pull: Container[]
  drop?: Container
  /** The billing cycle the effective date falls in, and whether the change lands mid-cycle. */
  currentCycle?: { period: { start: string; end: string }; midCycle: boolean; invoice?: Invoice }
  /** The first cycle date that bills the new line (proration none: the next boundary on or after effectiveFrom). */
  firstBilledOn?: string
  before: NextRunPreview
  after?: NextRunPreview
  deltaCents: number
  baseDeltaCents: number
}

function lineView(item: ServiceItem | undefined, catalogId: string, qty: number, frequency: Frequency, site: Site, onDate: string, db: Db): ChangeLineView | undefined {
  const catalog = byId(db.catalog, catalogId)
  if (!catalog) return undefined
  const view: ChangeLineView = {
    item,
    catalog,
    qty,
    frequency,
    containers: item ? item.containerIds.map(id => byId(db.containers, id)).filter((c): c is Container => Boolean(c)) : [],
    per: frequency === 'onCall' ? 'haul' : 'month',
  }
  try {
    view.price = resolvePrice({ catalogId, frequency, zoneId: site.zoneId, accountId: site.accountId, onDate }, db)
    view.lineCents = view.price.priceCents * qty
  } catch (err) {
    view.priceError = err instanceof Error ? err.message : String(err)
  }
  return view
}

/** The cycle boundary on or before a date: the 1st of the month, or of the quarter for quarterly accounts. */
function cycleStartOnOrBefore(account: BillingAccount, date: string): string | undefined {
  if (account.cycle === 'perJob') return undefined
  if (account.cycle === 'quarterly') {
    const m = Number(date.slice(5, 7))
    return `${date.slice(0, 4)}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`
  }
  return startOfMonth(date)
}

const sumBase = (charges: Charge[]) => charges.reduce((s, c) => s + c.baseCents, 0)

/**
 * Everything the Change service drawer shows before confirm, computed purely: the plan on a shadow db (its ids are the
 * ids confirm writes), the dispatch effect, the old and new price with sources, the mid-cycle note under proration
 * none, and previewNextRun before and after. Nothing here writes to the store.
 */
export function buildServiceChangePreview(args: ServiceChangeArgs, db: Db): ServiceChangePreview | undefined {
  const site = byId(db.sites, args.siteId)
  const account = site ? byId(db.accounts, site.accountId) : undefined
  if (!site || !account) return undefined
  const before = previewNextRun(account.id, db)
  const oldItem = byId(db.serviceItems, args.replaceItemId)
  const onDate = /^\d{4}-\d{2}-\d{2}$/.test(args.effectiveFrom) ? args.effectiveFrom : today()
  const out: ServiceChangePreview = {
    args,
    site,
    account,
    hauler: db.hauler[0],
    noop: isNoOpChange(args, db),
    oldLine: oldItem ? lineView(oldItem, oldItem.catalogId, oldItem.qty, oldItem.frequency, site, onDate, db) : undefined,
    newLine: lineView(undefined, args.catalogId, args.qty, args.frequency, site, onDate, db),
    pull: oldItem ? oldItem.containerIds.map(id => byId(db.containers, id)).filter((c): c is Container => Boolean(c)) : [],
    before,
    deltaCents: 0,
    baseDeltaCents: 0,
  }
  if (out.noop) return out

  let plan: ServiceChangePlan
  try {
    plan = planServiceChange(args, db)
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err)
    return out
  }
  out.plan = plan
  out.drop = plan.container

  const cycleStart = cycleStartOnOrBefore(account, plan.newItem.effectiveFrom)
  if (cycleStart) {
    const period = billingPeriod(account, cycleStart)
    const eff = plan.newItem.effectiveFrom
    const covering = oldItem
      ? db.charges.find(c => c.source.type === 'serviceItem' && c.source.id === oldItem.id && c.period && dayOf(c.period.start) <= eff && eff <= dayOf(c.period.end))
      : undefined
    out.currentCycle = {
      period,
      midCycle: eff !== cycleStart,
      invoice: covering ? db.invoices.find(i => i.chargeIds.includes(covering.id)) : undefined,
    }
    const cadence = cadenceOf(account, db.billingGroups)
    out.firstBilledOn = isCycleBoundary(cadence, eff) ? eff : nextCycleDate(cadence, eff)
  }

  const after = previewNextRun(account.id, plan.nextDb)
  out.after = after
  out.deltaCents = after.totalCents - before.totalCents
  out.baseDeltaCents = sumBase([...after.recurring, ...after.events, ...after.proposed]) - sumBase([...before.recurring, ...before.events, ...before.proposed])
  return out
}

// ---------------------------------------------------------------------------------------------
// Take a payment, allocate, issue credit (invariant 6): pure previews over a shadow db
// ---------------------------------------------------------------------------------------------

/**
 * Dollars typed by the office ("1,234.5", "$20", ".75") to integer cents, parsed from the string so no float
 * multiplication ever touches money. Returns undefined for anything that is not a non-negative amount with at most two
 * decimals. An empty string is undefined too; callers decide whether blank means zero.
 */
export function parseDollars(text: string): number | undefined {
  const t = text.trim().replace(/^\$/, '').replace(/,/g, '')
  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(t)
  if (!m || (m[1] === '' && (m[2] === undefined || m[2] === ''))) return undefined
  return Number(m[1] || '0') * 100 + Number((m[2] ?? '').padEnd(2, '0'))
}

/** Integer cents to the plain dollar string an input shows ("759.64"), no symbol or separators. */
export function centsToInput(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

/** The account's invoices with an open balance, oldest due first (then issued, then number). */
export function openInvoicesOldestFirst(accountId: string, db: Db): InvoiceView[] {
  return accountInvoices(accountId, db)
    .map(inv => buildInvoiceView(inv, db))
    .filter(v => v.openCents > 0)
    .sort(
      (a, b) =>
        a.invoice.dueAt.localeCompare(b.invoice.dueAt) ||
        a.invoice.issuedAt.localeCompare(b.invoice.issuedAt) ||
        a.invoice.number.localeCompare(b.invoice.number),
    )
}

/** Fills invoices oldest first until the amount runs out. Returns cents per invoice id (zero rows included). */
export function autoAllocateOldestFirst(invoices: { invoice: Invoice; openCents: number }[], amountCents: number): Record<string, number> {
  let left = Math.max(0, amountCents)
  const out: Record<string, number> = {}
  for (const v of invoices) {
    const take = Math.min(left, v.openCents)
    out[v.invoice.id] = take
    left -= take
  }
  return out
}

export interface AllocationRowView {
  invoice: Invoice
  isPastDue: boolean
  daysLate: number
  openBefore: number
  cents: number
  openAfter: number
  /** This row asks for more than the invoice has open. */
  over: boolean
}

export interface AllocationPreview {
  accountId: string
  sourceType: PaymentAllocation['sourceType']
  /** The Payment or CreditMemo being applied: the next id for a draft, the real id for an existing source. */
  sourceId: string
  /** Cents available to apply before this action (the draft amount, or an existing source's unallocated remainder). */
  availableCents: number
  allocatedCents: number
  /** availableCents minus allocatedCents; negative when over-allocated. */
  remainderCents: number
  rows: AllocationRowView[]
  /** The rows with cents above zero, exactly as confirm hands them to allocate(). */
  invoiceIds: string[]
  cents: number[]
  /** First problem in plain words (row over its balance, total over the amount), else the engine's error. */
  error?: string
  balanceBefore: number
  balanceAfter: number
  pastDueBefore: number
  pastDueAfter: number
  quickbooksBefore: SyncStatus
  quickbooksAfter: SyncStatus
}

function money$(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  return `${sign}${dollars(cents)}`
}

/** The ledgerWrites entry confirm will append, with the id it will get. */
function pendingWrite(ledgerWrites: LedgerWrite[], accountId: string, kind: LedgerWrite['kind'], sourceId: string, cents: number, offset = 0): LedgerWrite {
  return { id: nextId('lw', ledgerWrites.map(w => w.id), offset), accountId, kind, sourceId, cents, at: today() }
}

/**
 * The allocation table and its before-and-after. `base` is the db the source already exists in (for a draft payment, a
 * shadow with the draft appended). Runs the canonical allocate() (with the account's checks) on that db exactly as
 * confirm will, so a preview that shows no error is one confirm accepts. Nothing here writes.
 */
function previewAllocation(
  accountId: string,
  sourceType: PaymentAllocation['sourceType'],
  sourceId: string,
  availableCents: number,
  requested: Record<string, number>,
  before: Db,
  base: Db,
  ledgerWrites: LedgerWrite[],
  pendingWrites: LedgerWrite[],
): AllocationPreview {
  const open = openInvoicesOldestFirst(accountId, base)
  const rows: AllocationRowView[] = open.map(v => {
    const cents = Math.max(0, Math.round(requested[v.invoice.id] ?? 0))
    return {
      invoice: v.invoice,
      isPastDue: v.isPastDue,
      daysLate: v.daysLate,
      openBefore: v.openCents,
      cents,
      openAfter: v.openCents - cents,
      over: cents > v.openCents,
    }
  })
  const picked = rows.filter(r => r.cents > 0)
  const invoiceIds = picked.map(r => r.invoice.id)
  const cents = picked.map(r => r.cents)
  const allocatedCents = cents.reduce((s, c) => s + c, 0)

  let error: string | undefined
  const overRow = rows.find(r => r.over)
  if (overRow) error = `${overRow.invoice.number}: ${money$(overRow.cents)} is more than its open balance of ${money$(overRow.openBefore)}`
  else if (allocatedCents > availableCents) error = `Allocations total ${money$(allocatedCents)} but only ${money$(availableCents)} is available to apply`

  let after = base
  if (!error && picked.length) {
    try {
      after = withRows(base, { allocations: allocateChecked({ sourceType, sourceId, invoiceIds, cents }, base) })
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }
  const allocationWrite: LedgerWrite[] = picked.length && !error
    ? [pendingWrite(ledgerWrites, accountId, 'allocation', sourceId, allocatedCents, pendingWrites.length)]
    : []

  return {
    accountId,
    sourceType,
    sourceId,
    availableCents,
    allocatedCents,
    remainderCents: availableCents - allocatedCents,
    rows,
    invoiceIds,
    cents,
    error,
    balanceBefore: accountBalance(accountId, before),
    balanceAfter: accountBalance(accountId, after),
    pastDueBefore: pastDue(accountId, before),
    pastDueAfter: pastDue(accountId, after),
    quickbooksBefore: buildQuickbooksSync(accountId, before, ledgerWrites),
    quickbooksAfter: buildQuickbooksSync(accountId, after, [...ledgerWrites, ...pendingWrites, ...allocationWrite]),
  }
}

export interface PaymentDraft {
  accountId: string
  method: Payment['method']
  cents: number
  receivedAt: string
  /** Card processor reference; kept only when method is card (processorBatchId), dropped otherwise. */
  reference?: string
}

/** The Payment row confirm will write, with the id it will get. */
export function draftPayment(draft: PaymentDraft, db: Db): Payment {
  const payment: Payment = {
    id: nextId('pay', db.payments.map(p => p.id)),
    accountId: draft.accountId,
    method: draft.method,
    cents: draft.cents,
    receivedAt: draft.receivedAt,
    status: draft.method === 'card' || draft.method === 'ach' ? 'pending' : 'settled',
  }
  const ref = draft.reference?.trim()
  if (draft.method === 'card' && ref) payment.processorBatchId = ref
  return payment
}

export interface PaymentPreview extends AllocationPreview {
  payment: Payment
}

/** Take a payment: the draft Payment on a shadow db, then the allocation table against it. */
export function buildPaymentPreview(draft: PaymentDraft, requested: Record<string, number>, db: Db, ledgerWrites: LedgerWrite[] = []): PaymentPreview {
  const payment = draftPayment(draft, db)
  const shadow = withRows(db, { payments: [payment] })
  const paymentWrite = pendingWrite(ledgerWrites, draft.accountId, 'payment', payment.id, payment.cents)
  const preview = previewAllocation(draft.accountId, 'payment', payment.id, payment.cents, requested, db, shadow, ledgerWrites, [paymentWrite])
  return { ...preview, payment }
}

/** Allocate an existing unapplied Payment or CreditMemo: the same table, with the source's unallocated remainder. */
export function buildExistingAllocationPreview(
  sourceType: PaymentAllocation['sourceType'],
  sourceId: string,
  requested: Record<string, number>,
  db: Db,
  ledgerWrites: LedgerWrite[] = [],
): AllocationPreview | undefined {
  const source = sourceType === 'payment' ? byId(db.payments, sourceId) : byId(db.creditMemos, sourceId)
  if (!source) return undefined
  const available = unallocatedCents(sourceType, sourceId, db)
  return previewAllocation(source.accountId, sourceType, sourceId, available, requested, db, db, ledgerWrites, [])
}

export const CREDIT_REASONS = ['goodwill', 'missedPickup', 'billingError', 'salesPromise', 'operationalFault', 'other'] as const
export type CreditReason = (typeof CREDIT_REASONS)[number]

export interface CreditDraft {
  accountId: string
  cents: number
  reason: CreditReason
  note?: string
  /** Apply against this invoice; undefined leaves the credit unapplied on the account. */
  invoiceId?: string
}

export interface CreditPreview {
  memo: CreditMemo
  invoice?: InvoiceView
  openBefore?: number
  openAfter?: number
  error?: string
  balanceBefore: number
  balanceAfter: number
  pastDueBefore: number
  pastDueAfter: number
  unappliedCreditBefore: number
  unappliedCreditAfter: number
  quickbooksBefore: SyncStatus
  quickbooksAfter: SyncStatus
}

function unappliedCreditTotal(accountId: string, db: Db): number {
  return db.creditMemos
    .filter(m => m.accountId === accountId)
    .reduce((s, m) => s + Math.max(0, unallocatedCents('creditMemo', m.id, db)), 0)
}

/** Issue credit: the CreditMemo confirm will write (its id, by office, at today) and, with an invoice, its allocation. */
export function buildCreditPreview(draft: CreditDraft, db: Db, ledgerWrites: LedgerWrite[] = []): CreditPreview {
  const note = draft.note?.trim()
  const memo: CreditMemo = {
    id: nextId('cm', db.creditMemos.map(m => m.id)),
    accountId: draft.accountId,
    invoiceId: draft.invoiceId,
    cents: draft.cents,
    reason: note ? `${draft.reason}: ${note}` : draft.reason,
    by: 'office',
    at: today(),
  }
  const shadow = withRows(db, { creditMemos: [memo] })
  const writes: LedgerWrite[] = [pendingWrite(ledgerWrites, draft.accountId, 'creditMemo', memo.id, memo.cents)]
  let after = shadow
  let error: string | undefined
  const invoiceRow = byId(db.invoices, draft.invoiceId)
  const invoice = invoiceRow ? buildInvoiceView(invoiceRow, db) : undefined
  if (draft.invoiceId) {
    if (invoice && draft.cents > invoice.openCents) {
      error = `${invoice.invoice.number} has ${money$(invoice.openCents)} open; a ${money$(draft.cents)} credit is more than that. Lower the amount or leave it unapplied on the account.`
    } else {
      try {
        after = withRows(shadow, {
          allocations: allocateChecked({ sourceType: 'creditMemo', sourceId: memo.id, invoiceIds: [draft.invoiceId], cents: [draft.cents] }, shadow),
        })
        writes.push(pendingWrite(ledgerWrites, draft.accountId, 'allocation', memo.id, memo.cents, 1))
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
      }
    }
  }
  return {
    memo,
    invoice,
    openBefore: invoice?.openCents,
    openAfter: invoice && !error ? openBalance(invoice.invoice.id, after) : undefined,
    error,
    balanceBefore: accountBalance(draft.accountId, db),
    balanceAfter: accountBalance(draft.accountId, after),
    pastDueBefore: pastDue(draft.accountId, db),
    pastDueAfter: pastDue(draft.accountId, after),
    unappliedCreditBefore: unappliedCreditTotal(draft.accountId, db),
    unappliedCreditAfter: unappliedCreditTotal(draft.accountId, after),
    quickbooksBefore: buildQuickbooksSync(draft.accountId, db, ledgerWrites),
    quickbooksAfter: buildQuickbooksSync(draft.accountId, after, [...ledgerWrites, ...writes]),
  }
}

// ---------------------------------------------------------------------------------------------
// Hold or suspend, with the route stub (invariant 4)
// ---------------------------------------------------------------------------------------------

/** A route stop's outcome in the stub: the contract's ServiceEvent outcomes plus a display-only hold skip. */
export type StubOutcome = ServiceEvent['outcome'] | 'skippedHold'

export type HoldMode = 'hold' | 'suspend' | 'reinstate'

export interface HoldDraft {
  accountId: string
  mode: HoldMode
  /** First date the change applies to route stops. Default today; never before today. */
  effectiveFrom: string
  /** Holds: the date service resumes (required, after effectiveFrom). */
  resumeOn?: string
  /** Suspensions: non-payment or customer request. */
  reason?: SuspensionReason
}

export interface RouteStubStop {
  date: string
  /** recorded: a ServiceEvent from the field; projected: a future service day on the route. */
  kind: 'recorded' | 'projected'
  event?: ServiceEvent
  /** The outcome as things stand (for a recorded stop, what happened). */
  now: StubOutcome
  /** The outcome once the drafted change is confirmed. */
  after: StubOutcome
}

export interface RouteStubSite {
  site: Site
  route?: Route
  /** Stops on the same route that are not this site: the truck still runs for them. */
  otherStops: number
  stops: RouteStubStop[]
}

/** Projected service days per site in the stub, and recorded field stops shown before them. */
export const ROUTE_STUB_PROJECTED = 4
export const ROUTE_STUB_RECORDED = 2

/** The first date on or after `from` that falls on the route's day, then one a week. */
export function routeServiceDays(route: Route, from: string, count: number): string[] {
  const first = weekdayOf(from) === route.day ? from : nextWeekday(from, route.day)
  return Array.from({ length: count }, (_, i) => addDays(first, i * 7))
}

/** The open hold's resume date, when the office set one this session (seeded holds carry none the engine can read). */
function openHoldResumeOn(accountId: string, statusChanges: StatusChange[]): string | undefined {
  const last = [...statusChanges].reverse().find(c => c.accountId === accountId)
  return last?.kind === 'hold' ? last.resumeOn : undefined
}

/** What a future stop does under an account status (and, for a hold, its resume date). */
export function outcomeForStatus(status: BillingAccount['status'], date: string, resumeOn?: string): StubOutcome {
  if (status === 'suspended') return 'skippedSuspended'
  if (status === 'hold') return resumeOn && date >= resumeOn ? 'completed' : 'skippedHold'
  return 'completed'
}

function outcomeAfter(draft: HoldDraft, date: string, now: StubOutcome): StubOutcome {
  if (date < draft.effectiveFrom) return now
  if (draft.mode === 'suspend') return 'skippedSuspended'
  if (draft.mode === 'hold') return draft.resumeOn && date >= draft.resumeOn ? 'completed' : 'skippedHold'
  return 'completed'
}

/**
 * The route stub for each of the account's sites: the last two recorded field stops (what happened), then the next
 * four service days on the site's route from the effective date, each with its outcome now and after the drafted
 * change. Without a draft, `after` equals `now`. Pure over db.
 */
export function buildRouteStub(accountId: string, draft: HoldDraft | undefined, db: Db, statusChanges: StatusChange[] = []): RouteStubSite[] {
  const account = byId(db.accounts, accountId)
  if (!account) return []
  const now = today()
  const resumeOn = openHoldResumeOn(accountId, statusChanges)
  const from = draft?.effectiveFrom ?? now
  return sitesOf(accountId, db).map((site): RouteStubSite => {
    const route = byId(db.routes, site.routeId)
    const recorded = db.serviceEvents
      .filter(e => e.siteId === site.id && dayOf(e.date) <= now)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .slice(-ROUTE_STUB_RECORDED)
      .map((event): RouteStubStop => ({ date: dayOf(event.date), kind: 'recorded', event, now: event.outcome, after: event.outcome }))
    const projected = route
      ? routeServiceDays(route, from < now ? now : from, ROUTE_STUB_PROJECTED).map((date): RouteStubStop => {
          const current = outcomeForStatus(account.status, date, resumeOn)
          return { date, kind: 'projected', now: current, after: draft ? outcomeAfter(draft, date, current) : current }
        })
      : []
    return {
      site,
      route,
      otherStops: route ? route.stopSiteIds.filter(id => id !== site.id).length : 0,
      stops: [...recorded, ...projected],
    }
  })
}

export interface HoldItemEffect {
  item: ServiceItem
  catalog?: ServiceCatalog
  site: Site
  before: ServiceItem['status']
  after: ServiceItem['status']
}

export interface HoldPreview {
  draft: HoldDraft
  statusBefore: BillingAccount['status']
  statusAfter: BillingAccount['status']
  /** Every non-ended ServiceItem on the account, with its status before and after (effective dates never move). */
  items: HoldItemEffect[]
  routeStub: RouteStubSite[]
  /** Next run totals including the office's proposed charges, before and after (after includes a new reinstatement fee). */
  nextRunBeforeCents: number
  nextRunAfterCents: number
  nextRunAfterLines: number
  cycleDate?: string
  /** Hauler policy fee (2500), noted as due on reinstatement for a suspension. */
  reinstatementFeeCents: number
  /** Reinstating a suspension: the fee Charge proposeReinstatementFee() will add to the sidecar. */
  fee?: Charge
  billingBefore: SyncStatus
  billingAfter: SyncStatus
  /** The db after confirm, for anything else a drawer wants to compare. */
  nextDb: Db
  error?: string
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** Validation for a hold draft; undefined when it can be confirmed. */
export function holdDraftError(draft: HoldDraft, db: Db): string | undefined {
  const account = byId(db.accounts, draft.accountId)
  if (!account) return `No account ${draft.accountId}`
  const now = today()
  const inForce = account.status === 'suspended' || account.status === 'hold'
  if (draft.mode === 'reinstate' && !inForce) return 'The account is not on hold or suspended'
  if (draft.mode !== 'reinstate' && inForce) return `The account is already ${account.status === 'hold' ? 'on hold' : 'suspended'}; resume or reinstate it first`
  if (!ISO_DAY.test(draft.effectiveFrom)) return 'Effective date must be a date'
  if (draft.effectiveFrom < now) return `Effective date cannot be before today (${now})`
  if (draft.mode === 'hold') {
    if (!draft.resumeOn || !ISO_DAY.test(draft.resumeOn)) return 'A vacation hold needs a resume date'
    if (draft.resumeOn <= draft.effectiveFrom) return 'The resume date must be after the hold starts'
  }
  if (draft.mode === 'suspend' && !draft.reason) return 'Choose why the account is being suspended'
  return undefined
}

/** The status change id and fee charge id the next reinstatement will take (preview and confirm agree). */
export function nextReinstatementIds(db: Db, sidecars: Partial<AccountSidecars> = {}): { statusChangeId: string; feeId: string } {
  return {
    statusChangeId: nextId('sc', (sidecars.statusChanges ?? []).map(c => c.id)),
    feeId: nextId('chg', db.charges.map(c => c.id)),
  }
}

/**
 * Everything the Hold or suspend drawer shows before confirm, computed on a shadow db: the status and item flips the
 * slice will make, the route stub with each stop's outcome now and after, the next billing run before and after (a
 * suspension empties it, invariant 4; a hold leaves it unchanged, no proration), and for a reinstated suspension the
 * proposed fee through the canonical computeCharge. Pure: nothing is written.
 */
export function buildHoldPreview(draft: HoldDraft, db: Db, sidecars: Partial<AccountSidecars> = {}): HoldPreview {
  const account = byId(db.accounts, draft.accountId)
  if (!account) throw new EngineError(`BillingAccount ${draft.accountId} not found`)
  const error = holdDraftError(draft, db)
  const statusBefore = account.status
  const statusAfter: BillingAccount['status'] =
    draft.mode === 'hold' ? 'hold' : draft.mode === 'suspend' ? 'suspended' : statusAfterReinstatement(draft.accountId, db)
  const itemAfter: ServiceItem['status'] = statusAfter === 'suspended' ? 'held' : 'active'

  const sites = sitesOf(draft.accountId, db)
  const items: HoldItemEffect[] = sites.flatMap(site =>
    itemsOfSite(site.id, db)
      .filter(item => item.status !== 'ended')
      .map(item => ({ item, catalog: byId(db.catalog, item.catalogId), site, before: item.status, after: itemAfter })),
  )
  const ids = nextReinstatementIds(db, sidecars)
  const fee =
    draft.mode === 'reinstate' && statusBefore === 'suspended'
      ? buildReinstatementFee({ accountId: draft.accountId, sourceId: ids.statusChangeId, id: ids.feeId }, db)
      : undefined
  // The db after confirm: the status and item flips, plus the reinstatement fee as the proposed Charge the slice writes.
  const nextDb = withRows(db, {
    accounts: [{ ...account, status: statusAfter }],
    serviceItems: items.filter(e => e.before !== e.after).map(e => ({ ...e.item, status: e.after })),
    charges: fee ? [fee] : undefined,
  })
  const before = previewNextRun(draft.accountId, db)
  const after = previewNextRun(draft.accountId, nextDb)
  const siteIds = sites.map(s => s.id)

  return {
    draft,
    statusBefore,
    statusAfter,
    items,
    routeStub: buildRouteStub(draft.accountId, draft, db, sidecars.statusChanges ?? []),
    nextRunBeforeCents: before.totalCents,
    nextRunAfterCents: after.totalCents,
    nextRunAfterLines: after.recurring.length + after.events.length + after.proposed.length,
    cycleDate: before.cycleDate,
    reinstatementFeeCents: reinstatementFeeCents(db),
    fee,
    billingBefore: buildSync(draft.accountId, siteIds, db).billing,
    billingAfter: buildSync(draft.accountId, siteIds, nextDb).billing,
    nextDb,
    error,
  }
}
