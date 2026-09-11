/**
 * Selectors for the billing run screen. Pure functions of StoreData: every number on the page comes from
 * here, never from the components. They read the db passed in and never touch the engine binding.
 */
import type { BillingAccount, Charge, Container, Invoice, PaymentAllocation, Route, ScaleTicket, ServiceEvent, ServiceItem, WaivedCharge, WorkOrder } from '../types'
import type { Db } from './db'
import type { ChargeEdit, PriorChange, RunRecord, StoreData } from './state'
import { eventRates, exceptionLabel, isBillableException, nextInvoiceNumber, overageTons, type BillableException } from './engine'
import { cadenceOf, isDue, nextCycleDate, priorCycleDate, shortDate, wholeMonths } from './cycles'
import { fmt } from './money'
import { suggestFor, tenureMonths, type Suggestion } from './suggest'
import { waivesForAccount } from './waive'

// ---------------------------------------------------------------------------
// Queue vocabulary
// ---------------------------------------------------------------------------

/**
 * extraDays: a roll-off box kept past its included days (Phase 3.7b). proposedCharge: an intake charge that arrived
 * proposed from another surface, such as account's reinstatement fee (Phase 3.2 intake rule).
 */
export type QueueKind = BillableException | 'overage' | 'extraDays' | 'proposedCharge' | 'serviceChange' | 'rateChange'

export const KIND_LABEL: Record<QueueKind, string> = {
  extraBags: 'Extra bags',
  overload: 'Overload',
  contamination: 'Contamination',
  dryRun: 'Dry run',
  overage: 'Overage',
  extraDays: 'Extra days',
  proposedCharge: 'Proposed charge',
  serviceChange: 'Service change',
  rateChange: 'Rate change',
}

/** Field events first, then weight and rental days, then charges other surfaces proposed, then the recurring changes, which are the lowest risk. */
const KIND_ORDER: QueueKind[] = ['contamination', 'dryRun', 'overload', 'extraBags', 'overage', 'extraDays', 'proposedCharge', 'serviceChange', 'rateChange']

/** Where an item stands. undecided is the only state that blocks posting. */
export type Decision = 'undecided' | 'approved' | 'edited' | 'waived' | 'posted'

export const DECISION_LABEL: Record<Decision, string> = {
  undecided: 'Proposed',
  approved: 'Approved',
  edited: 'Edited',
  waived: 'Waived',
  posted: 'Posted',
}

export interface QueueItem {
  chargeId: string
  charge: Charge
  kind: QueueKind
  kindLabel: string
  accountId: string
  accountName: string
  siteId: string
  siteAddress: string
  routeId?: string
  /** "Mon residential" style label, or "No route". */
  routeLabel: string
  decision: Decision
  decided: boolean
  suggestion: Suggestion
  /** Set for recurring items: why the line differs from the prior cycle. */
  change?: PriorChange
  /** Latest edit on the charge, when a person changed the amount. */
  edit?: ChargeEdit
}

// ---------------------------------------------------------------------------
// Lookups (tolerant: selectors never throw on a missing row)
// ---------------------------------------------------------------------------

export function currentRun(state: Pick<StoreData, 'runs' | 'cycleDate'>): RunRecord | undefined {
  return state.runs[state.cycleDate]
}

export function accountName(db: Db, accountId: string): string {
  const account = db.accounts.find(a => a.id === accountId)
  const party = account ? db.parties.find(p => p.id === account.payerPartyId) : undefined
  return party?.name ?? accountId
}

const LOB_LABEL: Record<Route['lob'], string> = { residential: 'residential', frontload: 'frontload', rolloff: 'rolloff' }

export function routeLabel(route: Route | undefined): string {
  return route ? `${route.day} ${LOB_LABEL[route.lob]}` : 'No route'
}

/** The latest edit row for a charge (the sidecar keeps every edit; the first original base rides along). */
export function latestEdit(edits: ChargeEdit[], chargeId: string): ChargeEdit | undefined {
  for (let i = edits.length - 1; i >= 0; i--) if (edits[i].chargeId === chargeId) return edits[i]
  return undefined
}

export function decisionOf(charge: Charge, edit: ChargeEdit | undefined): Decision {
  switch (charge.status) {
    case 'posted': return 'posted'
    case 'waived': return 'waived'
    case 'approved': return edit ? 'edited' : 'approved'
    default: return 'undecided'
  }
}

function kindOf(charge: Charge, db: Db, change: PriorChange | undefined): QueueKind | undefined {
  if (charge.source.type === 'scaleTicket') return 'overage'
  if (charge.source.type === 'serviceItem' && charge.lineType === 'event' && charge.period) return 'extraDays'
  if (charge.source.type === 'serviceEvent') {
    const event = db.serviceEvents.find(e => e.id === charge.source.id)
    return isBillableException(event?.exception) ? event.exception : undefined
  }
  if (change) return change.kind === 'serviceChange' ? 'serviceChange' : 'rateChange'
  return undefined
}

function dateOf(charge: Charge): string {
  return charge.servicedOn ?? charge.period?.start ?? ''
}

// ---------------------------------------------------------------------------
// Suggestions for recurring changes (event and overage lines use suggestFor as is)
// ---------------------------------------------------------------------------

function pricedBy(charge: Charge): string {
  if (charge.pricing.contractId) return `contract ${charge.pricing.contractId}`
  if (charge.pricing.rateVersionId) return `rate version ${charge.pricing.rateVersionId}`
  return charge.pricing.ruleWon
}

/** suggestFor plus the prior-cycle reason for recurring items, so the agent explains the change it is flagging. */
export function suggestionFor(charge: Charge, db: Db, change: PriorChange | undefined): Suggestion {
  if (!change || charge.lineType !== 'recurring') return suggestFor(charge, db)
  const item = db.serviceItems.find(si => si.id === charge.source.id)
  const catalogName = db.catalog.find(c => c.id === charge.catalogId)?.name ?? charge.catalogId ?? 'service'
  if (change.kind === 'serviceChange') {
    const proration = db.hauler[0]?.policy.proration ?? 'none'
    const started = item ? `started ${shortDate(item.effectiveFrom)}` : 'is new since the prior cycle'
    const prorationNote = proration === 'none'
      ? ' Hauler proration is none, so the partial month before this cycle is not billed.'
      : ''
    return {
      action: 'approve',
      confidence: 'medium',
      rationale: `First invoice after a service change: ${catalogName} (${charge.source.id}) ${started}, priced by ${pricedBy(charge)}.${prorationNote}`,
      evidenceIds: [charge.source.id, ...(charge.pricing.rateVersionId ? [charge.pricing.rateVersionId] : [])],
    }
  }
  if (change.kind === 'rateChange') {
    const from = change.priorMonthlyCents !== undefined ? fmt(change.priorMonthlyCents) : 'the prior price'
    const to = change.newMonthlyCents !== undefined ? fmt(change.newMonthlyCents) : 'the new price'
    const versions = change.priorRateVersionId && change.newRateVersionId
      ? `Rate version ${change.newRateVersionId} replaced ${change.priorRateVersionId}`
      : `Pricing moved to ${pricedBy(charge)}`
    return {
      action: 'approve',
      confidence: 'high',
      rationale: `${versions}: ${from} to ${to} a month for ${catalogName}. The line follows the published rate card on the period start.`,
      evidenceIds: [change.newRateVersionId, change.priorRateVersionId].filter((x): x is string => Boolean(x)),
    }
  }
  return {
    action: 'review',
    confidence: 'low',
    rationale: `${change.reason} on ${catalogName} with no rate version change; a person should confirm why the amount moved.`,
    evidenceIds: [charge.source.id],
  }
}

// ---------------------------------------------------------------------------
// queueItems
// ---------------------------------------------------------------------------

/**
 * Every event charge in the current run (exception events and overages) plus every recurring charge that
 * changed from the prior cycle, each with its suggestion. Decided items stay in the list with their status;
 * undecided rows sort first, then by kind, date, and account.
 */
export function queueItems(state: Pick<StoreData, 'db' | 'runs' | 'cycleDate' | 'edits'>): QueueItem[] {
  const run = currentRun(state)
  if (!run) return []
  const { db } = state
  const byId = new Map(db.charges.map(c => [c.id, c]))
  const intakeDecisions = new Set(run.intakeDecisionIds ?? [])
  const items: QueueItem[] = []
  for (const id of run.chargeIds) {
    const charge = byId.get(id)
    if (!charge) continue
    const change = run.changedFromPrior[id]
    const intakeDecision = intakeDecisions.has(id)
    if (!intakeDecision && charge.lineType !== 'event' && !change) continue
    const kind = intakeDecision ? 'proposedCharge' : kindOf(charge, db, change)
    if (!kind) continue
    const site = db.sites.find(s => s.id === charge.siteId)
    const route = site?.routeId ? db.routes.find(r => r.id === site.routeId) : undefined
    const edit = latestEdit(state.edits, id)
    const decision = decisionOf(charge, edit)
    items.push({
      chargeId: id,
      charge,
      kind,
      kindLabel: KIND_LABEL[kind],
      accountId: charge.accountId,
      accountName: accountName(db, charge.accountId),
      siteId: charge.siteId,
      siteAddress: site?.address ?? charge.siteId,
      routeId: route?.id,
      routeLabel: routeLabel(route),
      decision,
      decided: decision !== 'undecided',
      suggestion: suggestionFor(charge, db, change),
      change,
      edit,
    })
  }
  return items.sort((a, b) =>
    Number(a.decided) - Number(b.decided)
    || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
    || dateOf(a.charge).localeCompare(dateOf(b.charge))
    || a.accountName.localeCompare(b.accountName)
    || a.chargeId.localeCompare(b.chargeId))
}

// ---------------------------------------------------------------------------
// batchSummary
// ---------------------------------------------------------------------------

export interface BatchSummary {
  /** Distinct accounts with at least one non-waived charge in this run (one invoice each at posting). */
  invoicesToGenerate: number
  /** Invoice accounts with no undecided queue item. */
  clean: number
  /** Accounts with at least one undecided queue item. */
  needDecisions: number
  /** Sum of undecided queue item totals. */
  dollarsAtIssueCents: number
  // Extras for the header pill and the ready-to-post card.
  ran: boolean
  queueCount: number
  undecidedCount: number
  /** Sum of non-waived charge totals in this run. */
  runTotalCents: number
  /** Sum of non-waived charge totals on clean accounts. */
  cleanTotalCents: number
  postedInvoiceCount: number
  /** Sum of totals on invoices posted from this run. */
  postedTotalCents: number
  /** True once the run has posted and every charge in it is posted or waived. */
  allPosted: boolean
}

export function batchSummary(state: Pick<StoreData, 'db' | 'runs' | 'cycleDate' | 'edits'>): BatchSummary {
  const run = currentRun(state)
  const empty: BatchSummary = {
    invoicesToGenerate: 0, clean: 0, needDecisions: 0, dollarsAtIssueCents: 0,
    ran: false, queueCount: 0, undecidedCount: 0, runTotalCents: 0, cleanTotalCents: 0, postedInvoiceCount: 0,
    postedTotalCents: 0, allPosted: false,
  }
  if (!run) return empty
  const byId = new Map(state.db.charges.map(c => [c.id, c]))
  const charges = run.chargeIds.map(id => byId.get(id)).filter((c): c is Charge => c !== undefined)
  const billable = charges.filter(c => c.status !== 'waived')
  const invoiceAccounts = new Set(billable.map(c => c.accountId))

  const queue = queueItems(state)
  const undecided = queue.filter(i => !i.decided)
  const needAccounts = new Set(undecided.map(i => i.accountId))
  const cleanAccounts = [...invoiceAccounts].filter(a => !needAccounts.has(a))
  const cleanSet = new Set(cleanAccounts)

  return {
    invoicesToGenerate: invoiceAccounts.size,
    clean: cleanAccounts.length,
    needDecisions: needAccounts.size,
    dollarsAtIssueCents: undecided.reduce((s, i) => s + i.charge.totalCents, 0),
    ran: true,
    queueCount: queue.length,
    undecidedCount: undecided.length,
    runTotalCents: billable.reduce((s, c) => s + c.totalCents, 0),
    cleanTotalCents: billable.filter(c => cleanSet.has(c.accountId)).reduce((s, c) => s + c.totalCents, 0),
    postedInvoiceCount: run.postedInvoiceIds.length,
    postedTotalCents: postedTotal(state.db, run.postedInvoiceIds),
    allPosted: run.postedInvoiceIds.length > 0 && charges.every(c => c.status === 'posted' || c.status === 'waived'),
  }
}

function postedTotal(db: Db, invoiceIds: string[]): number {
  const ids = new Set(invoiceIds)
  return db.invoices.filter(i => ids.has(i.id)).reduce((s, i) => s + i.totalCents, 0)
}

// ---------------------------------------------------------------------------
// customerContext
// ---------------------------------------------------------------------------

export interface CustomerContext {
  accountId: string
  accountName: string
  tenureMonths: number
  /** Posted invoice totals minus every allocation against them. */
  balanceCents: number
  openInvoiceCount: number
  /** Waives recorded before this run (waives on charges in the current run are excluded). */
  priorWaives: { count: number; cents: number }
  status: BillingAccount['status']
  autopay: boolean
  paymentMethodOnFile?: BillingAccount['paymentMethodOnFile']
  cycle: BillingAccount['cycle']
}

export function customerContext(state: Pick<StoreData, 'db' | 'runs' | 'cycleDate'>, accountId: string): CustomerContext | undefined {
  const { db } = state
  const account = db.accounts.find(a => a.id === accountId)
  if (!account) return undefined
  let balanceCents = 0
  let openInvoiceCount = 0
  for (const inv of db.invoices) {
    if (inv.accountId !== accountId || !(inv.locked || inv.postedAt)) continue
    const allocated = db.allocations.filter(a => a.invoiceId === inv.id).reduce((s, a) => s + a.cents, 0)
    const open = inv.totalCents - allocated
    balanceCents += open
    if (open > 0) openInvoiceCount += 1
  }
  const inRun = new Set(currentRun(state)?.chargeIds ?? [])
  const prior = waivesForAccount(db, accountId).filter(w => !inRun.has(w.charge.id))
  return {
    accountId,
    accountName: accountName(db, accountId),
    tenureMonths: tenureMonths(db, accountId),
    balanceCents,
    openInvoiceCount,
    priorWaives: { count: prior.length, cents: prior.reduce((s, w) => s + w.charge.totalCents, 0) },
    status: account.status,
    autopay: account.autopay,
    paymentMethodOnFile: account.paymentMethodOnFile,
    cycle: account.cycle,
  }
}

// ---------------------------------------------------------------------------
// chargeDetail: everything the detail panel shows for one charge
// ---------------------------------------------------------------------------

export interface AmountLine {
  label: string
  cents: number
}

export type Evidence =
  | { type: 'event'; event: ServiceEvent; label: string }
  | { type: 'ticket'; ticket: ScaleTicket; workOrder?: WorkOrder; netTons: number; overTons: number; includedTons: number; overageCentsPerTon: number }
  | {
    type: 'recurring'
    serviceItem?: ServiceItem
    catalogName: string
    before?: { monthlyCents?: number; totalCents?: number; rateVersionId?: string }
    after: { monthlyCents: number; totalCents: number; rateVersionId?: string; contractId?: string }
    change?: PriorChange
  }
  | {
    type: 'extraDays'
    serviceItem?: ServiceItem
    container?: Container
    workOrder?: WorkOrder
    deliveredOn?: string
    period: { start: string; end: string }
    days: number
    includedDays: number
    extraDayCents: number
  }
  | { type: 'none' }

export interface ChargeDetail {
  charge: Charge
  item?: QueueItem
  lines: AmountLine[]
  evidence: Evidence
  policy: string
  context?: CustomerContext
  /** The WaivedCharge row when the charge was waived. */
  waived?: WaivedCharge
}

function monthlyOf(charge: Charge, qty: number): number {
  const months = charge.period ? wholeMonths(charge.period) : 1
  return Math.round(charge.baseCents / Math.max(1, qty * months))
}

export function chargeDetail(state: Pick<StoreData, 'db' | 'runs' | 'cycleDate' | 'edits'>, chargeId: string | null): ChargeDetail | undefined {
  if (!chargeId) return undefined
  const { db } = state
  const charge = db.charges.find(c => c.id === chargeId)
  if (!charge) return undefined
  const item = queueItems(state).find(i => i.chargeId === chargeId)

  const lines: AmountLine[] = [{ label: 'Base', cents: charge.baseCents }]
  for (const fee of charge.fees) {
    lines.push({ label: db.feeRules.find(r => r.id === fee.feeRuleId)?.name ?? fee.feeRuleId, cents: fee.cents })
  }
  lines.push({ label: 'Tax', cents: charge.taxCents })

  let evidence: Evidence = { type: 'none' }
  let policy = `Priced as ${charge.pricing.ruleWon}.`

  if (charge.source.type === 'serviceEvent') {
    const event = db.serviceEvents.find(e => e.id === charge.source.id)
    if (event && isBillableException(event.exception)) {
      evidence = { type: 'event', event, label: exceptionLabel(event.exception) }
      policy = `Event rate table: ${exceptionLabel(event.exception).toLowerCase()} is a flat ${fmt(eventRates[event.exception])} per event (eventRates.${event.exception}), plus fuel and tax. Rule ${charge.pricing.ruleWon}.`
    }
  } else if (charge.source.type === 'scaleTicket') {
    const ticket = db.scaleTickets.find(t => t.id === charge.source.id)
    const cat = db.catalog.find(c => c.id === charge.catalogId)
    if (ticket && cat?.rolloff) {
      const netTons = ticket.netLbs / 2000
      const overTons = overageTons(ticket.netLbs, cat.rolloff.includedTons)
      evidence = {
        type: 'ticket', ticket, workOrder: db.workOrders.find(w => w.id === ticket.workOrderId),
        netTons, overTons, includedTons: cat.rolloff.includedTons, overageCentsPerTon: cat.rolloff.overageCentsPerTon,
      }
      policy = `Overage formula on ${cat.name}: (net tons minus ${cat.rolloff.includedTons} t included cap) x ${fmt(cat.rolloff.overageCentsPerTon)} per ton. ${netTons.toFixed(2)} t minus ${cat.rolloff.includedTons} t is ${overTons.toFixed(2)} t, so ${fmt(charge.baseCents)} base. Rule ${charge.pricing.ruleWon}.`
    }
  } else if (item?.kind === 'extraDays' && charge.period) {
    const serviceItem = db.serviceItems.find(si => si.id === charge.source.id)
    const cat = db.catalog.find(c => c.id === charge.catalogId)
    const containerId = charge.evidenceIds.find(id => db.containers.some(c => c.id === id))
    const container = containerId ? db.containers.find(c => c.id === containerId) : undefined
    const workOrder = db.workOrders.find(w => charge.evidenceIds.includes(w.id))
    const days = cat?.rolloff?.extraDayCents ? Math.round(charge.baseCents / cat.rolloff.extraDayCents) : 0
    if (cat?.rolloff) {
      evidence = {
        type: 'extraDays', serviceItem, container, workOrder,
        deliveredOn: workOrder ? (workOrder.completedAt ?? workOrder.scheduledFor).slice(0, 10) : container?.assignedFrom?.slice(0, 10),
        period: charge.period, days, includedDays: cat.rolloff.includedDays, extraDayCents: cat.rolloff.extraDayCents,
      }
      policy = `Extra-day formula on ${cat.name}: ${cat.rolloff.includedDays} days are included from delivery, then ${fmt(cat.rolloff.extraDayCents)} a day. ${days} day${days === 1 ? '' : 's'} (${shortDate(charge.period.start)} to ${shortDate(charge.period.end)}) is ${fmt(charge.baseCents)} base. Rule ${charge.pricing.ruleWon}.`
    }
  } else if (item?.kind === 'proposedCharge') {
    policy = `Proposed outside the run (${charge.source.type} ${charge.source.id}) and taken in by this run as intake; nothing bills it until a person approves it. Rule ${charge.pricing.ruleWon}.`
  } else if (charge.lineType === 'recurring') {
    const serviceItem = db.serviceItems.find(si => si.id === charge.source.id)
    const qty = serviceItem?.qty ?? 1
    const months = charge.period ? wholeMonths(charge.period) : 1
    const catalogName = db.catalog.find(c => c.id === charge.catalogId)?.name ?? charge.catalogId ?? 'service'
    const change = item?.change
    evidence = {
      type: 'recurring',
      serviceItem,
      catalogName,
      before: change && change.kind !== 'serviceChange'
        ? { monthlyCents: change.priorMonthlyCents, totalCents: change.priorTotalCents, rateVersionId: change.priorRateVersionId }
        : undefined,
      after: { monthlyCents: monthlyOf(charge, qty), totalCents: charge.totalCents, rateVersionId: charge.pricing.rateVersionId, contractId: charge.pricing.contractId },
      change,
    }
    const source = charge.pricing.contractId
      ? `Contract ${charge.pricing.contractId}`
      : charge.pricing.rateVersionId ? `Rate version ${charge.pricing.rateVersionId}` : 'Rate card'
    policy = `${source}, rule ${charge.pricing.ruleWon}: ${fmt(monthlyOf(charge, qty))} a month x ${qty} x ${months} month${months === 1 ? '' : 's'}, resolved on the period start.`
  }

  const edit = item?.edit ?? latestEdit(state.edits, chargeId)
  if (edit) policy += ` Edited from ${fmt(edit.originalBaseCents)} base: ${edit.reason}.`

  const waived = db.waivedCharges.find(w => w.chargeId === chargeId)
  return { charge, item, lines, evidence, policy, context: customerContext(state, charge.accountId), waived }
}

// ---------------------------------------------------------------------------
// Header facts
// ---------------------------------------------------------------------------

/** Latest service event date on record: the run bills exceptions through this day. */
export function eventsThrough(db: Db): string | undefined {
  let max: string | undefined
  for (const e of db.serviceEvents) if (max === undefined || e.date > max) max = e.date
  return max?.slice(0, 10)
}

/**
 * The next bill run date after `after` (addendum Q): the earliest date any billing account bills, on its group's
 * schedule or its own cycle. With every group on the 1st this is the next month's 1st, as it always was.
 */
export function nextRunDate(db: Pick<Db, 'accounts' | 'billingGroups'>, after: string): string {
  let best: string | undefined
  for (const a of db.accounts) {
    if (a.status === 'suspended' || a.cycle === 'perJob') continue
    const d = nextCycleDate(cadenceOf(a, db.billingGroups), after)
    if (!best || d < best) best = d
  }
  return best ?? nextCycleDate({ cycle: 'monthly' }, after)
}

/**
 * For a cycle run on only some billing groups (addendum P): the accounts due on cycleDate that no run has covered yet.
 * Empty when the cycle has not run, or once a run covered everyone.
 */
export function uncoveredDueAccounts(state: Pick<StoreData, 'db' | 'runs' | 'cycleDate'>): BillingAccount[] {
  const run = state.runs[state.cycleDate]
  if (!run || run.ranAll !== false) return []
  const ran = new Set(run.groupIds ?? [])
  return state.db.accounts.filter(a =>
    a.status !== 'suspended'
    && isDue(cadenceOf(a, state.db.billingGroups), state.cycleDate)
    && !(a.billingGroupId && ran.has(a.billingGroupId)))
}

/** "Monthly and quarterly in advance": the cadences due on cycleDate among accounts that bill. */
export function dueCadenceLabel(db: Db, cycleDate: string): string {
  type Due = 'daily' | 'weekly' | 'monthly' | 'quarterly'
  const due = new Set<Due>()
  for (const a of db.accounts) {
    if (a.status === 'suspended' || !isDue(cadenceOf(a, db.billingGroups), cycleDate)) continue
    due.add(a.cycle === 'quarterly' || a.cycle === 'weekly' || a.cycle === 'daily' ? a.cycle : 'monthly')
  }
  const parts = (['daily', 'weekly', 'monthly', 'quarterly'] as const).filter(x => due.has(x))
  if (parts.length === 0) return 'No recurring cadence due'
  const text = parts.join(' and ')
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} in advance`
}

// ---------------------------------------------------------------------------
// Waived charges by reason (the leakage card body). Every WaivedCharge on record, joined to its charge.
// ---------------------------------------------------------------------------

export const WAIVE_REASON_LABEL: Record<WaivedCharge['reason'], string> = {
  goodwill: 'Goodwill',
  salesPromise: 'Sales promise',
  insufficientEvidence: 'Insufficient evidence',
  operationalFault: 'Operational fault',
  immaterial: 'Immaterial',
}

export interface WaivedBreakdown {
  totalCents: number
  count: number
  rows: { key: WaivedCharge['reason']; label: string; count: number; cents: number }[]
}

export function waivedByReason(db: Db): WaivedBreakdown {
  const byId = new Map(db.charges.map(c => [c.id, c]))
  const acc = new Map<WaivedCharge['reason'], { count: number; cents: number }>()
  let totalCents = 0
  for (const w of db.waivedCharges) {
    const cents = byId.get(w.chargeId)?.totalCents ?? 0
    totalCents += cents
    const row = acc.get(w.reason) ?? { count: 0, cents: 0 }
    row.count += 1
    row.cents += cents
    acc.set(w.reason, row)
  }
  const rows = [...acc.entries()]
    .map(([key, v]) => ({ key, label: WAIVE_REASON_LABEL[key], ...v }))
    .sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label))
  return { totalCents, count: db.waivedCharges.length, rows }
}

// ---------------------------------------------------------------------------
// Phase 5: decisions, bulk approve, posting, posted invoices, leakage
// ---------------------------------------------------------------------------

type RunState = Pick<StoreData, 'db' | 'runs' | 'cycleDate' | 'edits'>

/**
 * The undecided queue item that follows chargeId in queue order, wrapping to the top, never chargeId itself.
 * Call it on the state before the decision lands so "next" means the row below the one just decided.
 */
export function nextUndecidedAfter(state: RunState, chargeId: string): string | undefined {
  const items = queueItems(state)
  const idx = items.findIndex(i => i.chargeId === chargeId)
  const open = (i: QueueItem) => !i.decided && i.chargeId !== chargeId
  return (items.slice(idx + 1).find(open) ?? items.slice(0, Math.max(0, idx)).find(open))?.chargeId
}

export interface CleanApprovalPreview {
  chargeIds: string[]
  count: number
  cents: number
}

/** What "Bulk approve clean" would approve: every proposed charge in the run that is not a queue item. */
export function cleanApprovalPreview(state: RunState): CleanApprovalPreview {
  const run = currentRun(state)
  if (!run) return { chargeIds: [], count: 0, cents: 0 }
  const queued = new Set(queueItems(state).map(i => i.chargeId))
  const byId = new Map(state.db.charges.map(c => [c.id, c]))
  const targets = run.chargeIds
    .map(id => byId.get(id))
    .filter((c): c is Charge => c !== undefined && c.status === 'proposed' && !queued.has(c.id))
  return { chargeIds: targets.map(c => c.id), count: targets.length, cents: targets.reduce((s, c) => s + c.totalCents, 0) }
}

export interface RateChangePreview {
  /** Undecided queue items of kind rateChange, still proposed, in queue order. */
  chargeIds: string[]
  count: number
  cents: number
  /** Undecided queue items that are not rate changes: they stay one decision each. */
  otherUndecided: number
}

/** What "Approve N rate changes" would approve (box 4.6): every undecided rate change in the queue, nothing else. */
export function rateChangePreview(state: RunState): RateChangePreview {
  const undecided = queueItems(state).filter(i => !i.decided)
  const rates = undecided.filter(i => i.kind === 'rateChange' && i.charge.status === 'proposed')
  return {
    chargeIds: rates.map(i => i.chargeId),
    count: rates.length,
    cents: rates.reduce((s, i) => s + i.charge.totalCents, 0),
    otherUndecided: undecided.length - rates.length,
  }
}

export interface PostPreview {
  /** True when nothing in the queue is undecided and at least one approved charge is waiting. */
  ready: boolean
  undecidedCount: number
  /** Proposed charges outside the queue that bulk approve has not reached yet; they are left off the invoices. */
  unapprovedCleanCount: number
  chargeIds: string[]
  invoiceCount: number
  totalCents: number
  firstNumber?: string
  lastNumber?: string
  rows: { accountId: string; accountName: string; chargeCount: number; totalCents: number }[]
}

/** What "Post invoices" would create: one invoice per account from every approved charge in the run. */
export function postPreview(state: RunState): PostPreview {
  const run = currentRun(state)
  const undecidedCount = queueItems(state).filter(i => !i.decided).length
  const empty: PostPreview = { ready: false, undecidedCount, unapprovedCleanCount: 0, chargeIds: [], invoiceCount: 0, totalCents: 0, rows: [] }
  if (!run) return empty
  const byId = new Map(state.db.charges.map(c => [c.id, c]))
  const approved = run.chargeIds.map(id => byId.get(id)).filter((c): c is Charge => c !== undefined && c.status === 'approved')
  const byAccount = new Map<string, { chargeCount: number; totalCents: number }>()
  for (const c of approved) {
    const row = byAccount.get(c.accountId) ?? { chargeCount: 0, totalCents: 0 }
    row.chargeCount += 1
    row.totalCents += c.totalCents
    byAccount.set(c.accountId, row)
  }
  const rows = [...byAccount.entries()]
    .map(([accountId, v]) => ({ accountId, accountName: accountName(state.db, accountId), ...v }))
    .sort((a, b) => a.accountName.localeCompare(b.accountName))
  const invoiceCount = rows.length
  return {
    ready: undecidedCount === 0 && invoiceCount > 0,
    undecidedCount,
    unapprovedCleanCount: cleanApprovalPreview(state).count,
    chargeIds: approved.map(c => c.id),
    invoiceCount,
    totalCents: approved.reduce((s, c) => s + c.totalCents, 0),
    firstNumber: invoiceCount > 0 ? nextInvoiceNumber(state.db, 0) : undefined,
    lastNumber: invoiceCount > 0 ? nextInvoiceNumber(state.db, invoiceCount - 1) : undefined,
    rows,
  }
}

export interface PostedInvoiceLine {
  chargeId: string
  description: string
  baseCents: number
  totalCents: number
  rateVersionId?: string
  contractId?: string
  ruleWon: Charge['pricing']['ruleWon']
}

export interface PostedInvoiceRow {
  invoice: Invoice
  accountName: string
  lines: PostedInvoiceLine[]
  /** Every allocation against the invoice (a signup's prepayment applied at posting shows here). */
  allocations: PaymentAllocation[]
  /** Total minus every allocation. */
  balanceCents: number
}

/** Invoices posted from the run for cycleDate, by invoice number, each with its locked lines and what has been applied. */
export function postedInvoices(state: Pick<StoreData, 'db' | 'runs'>, cycleDate: string): PostedInvoiceRow[] {
  const run = state.runs[cycleDate]
  if (!run) return []
  const ids = new Set(run.postedInvoiceIds)
  const byId = new Map(state.db.charges.map(c => [c.id, c]))
  return state.db.invoices
    .filter(i => ids.has(i.id))
    .sort((a, b) => a.number.localeCompare(b.number))
    .map(invoice => ({
      invoice,
      accountName: accountName(state.db, invoice.accountId),
      allocations: state.db.allocations.filter(a => a.invoiceId === invoice.id),
      balanceCents: invoice.totalCents - state.db.allocations.filter(a => a.invoiceId === invoice.id).reduce((s, a) => s + a.cents, 0),
      lines: invoice.chargeIds.map(id => byId.get(id)).filter((c): c is Charge => c !== undefined).map(c => ({
        chargeId: c.id,
        description: c.description,
        baseCents: c.baseCents,
        totalCents: c.totalCents,
        rateVersionId: c.pricing.rateVersionId,
        contractId: c.pricing.contractId,
        ruleWon: c.pricing.ruleWon,
      })),
    }))
}

/** Cycle dates that have posted invoices, oldest first. */
export function postedCycleDates(state: Pick<StoreData, 'runs'>): string[] {
  return Object.values(state.runs).filter(r => r.postedInvoiceIds.length > 0).map(r => r.cycleDate).sort()
}

export type LeakageView = 'reason' | 'route' | 'account'

export interface LeakageRow {
  key: string
  label: string
  count: number
  cents: number
}

export interface LeakageCycle {
  cycleDate: string
  /** First day of the window, inclusive. */
  from: string
  /** Day after the window, exclusive (the cycle date itself). */
  to: string
  count: number
  cents: number
}

export interface Leakage {
  totalCents: number
  count: number
  /** Oldest cycle first; the last entry is the current cycle. */
  cycles: LeakageCycle[]
  from: string
  to: string
  byReason: LeakageRow[]
  byRoute: LeakageRow[]
  byAccount: LeakageRow[]
}

const MONTHLY = { cycle: 'monthly' } as const

/**
 * The waive window a cycle owns (DECISIONS.md entry 36): a cycle dated D is worked in the month before D, so it
 * owns every WaivedCharge whose at falls on or after the prior month start and before D. The October 1 cycle owns
 * waives recorded Sep 1 through Sep 30.
 */
export function cycleWindow(cycleDate: string): { from: string; to: string } {
  return { from: priorCycleDate(MONTHLY, cycleDate), to: cycleDate.slice(0, 10) }
}

function addRow(map: Map<string, LeakageRow>, key: string, label: string, cents: number) {
  const row = map.get(key) ?? { key, label, count: 0, cents: 0 }
  row.count += 1
  row.cents += cents
  map.set(key, row)
}

function sortedRows(map: Map<string, LeakageRow>): LeakageRow[] {
  return [...map.values()].sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label))
}

/**
 * Waived dollars over the last three cycles (the current cycle and the two before it), from WaivedCharge.at
 * and the cycle windows above, with breakdowns by reason, by route (charge site to site route), and by account.
 * Dollars are the waived charge totals. A waive made in the current cycle lands here as soon as it is recorded.
 */
export function leakage(state: Pick<StoreData, 'db' | 'cycleDate'>): Leakage {
  const { db } = state
  const current = state.cycleDate.slice(0, 10)
  const previous = priorCycleDate(MONTHLY, current)
  const dates = [priorCycleDate(MONTHLY, previous), previous, current]
  const cycles: LeakageCycle[] = dates.map(d => ({ cycleDate: d, ...cycleWindow(d), count: 0, cents: 0 }))
  const byCharge = new Map(db.charges.map(c => [c.id, c]))
  const reasons = new Map<string, LeakageRow>()
  const routes = new Map<string, LeakageRow>()
  const accounts = new Map<string, LeakageRow>()
  let totalCents = 0
  let count = 0
  for (const w of db.waivedCharges) {
    const day = w.at.slice(0, 10)
    const cycle = cycles.find(c => day >= c.from && day < c.to)
    if (!cycle) continue
    const charge = byCharge.get(w.chargeId)
    const cents = charge?.totalCents ?? 0
    cycle.count += 1
    cycle.cents += cents
    totalCents += cents
    count += 1
    addRow(reasons, w.reason, WAIVE_REASON_LABEL[w.reason], cents)
    const site = charge ? db.sites.find(s => s.id === charge.siteId) : undefined
    const route = site?.routeId ? db.routes.find(r => r.id === site.routeId) : undefined
    addRow(routes, route?.id ?? 'none', routeLabel(route), cents)
    const accountId = charge?.accountId ?? 'unknown'
    addRow(accounts, accountId, charge ? accountName(db, accountId) : 'Unknown account', cents)
  }
  return {
    totalCents,
    count,
    cycles,
    from: cycles[0].from,
    to: current,
    byReason: sortedRows(reasons),
    byRoute: sortedRows(routes),
    byAccount: sortedRows(accounts),
  }
}
