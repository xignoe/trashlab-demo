/**
 * Surface-only engine helpers for the account view (box 2A.1). The prototype's own engine (account/src/store/engine.ts)
 * is gone: pricing, charges, recurring and event generation, balances, and allocation all run through the canonical
 * engine in src/store/engine.ts, in its trailing-db form (addendum C2), so a preview can run on a shadow db without
 * touching the store. What stays here is only what the account view needs on top: the price explanation chain, the
 * next-run preview for one account, the service change plan, and the hold and reinstatement rules.
 *
 * Nothing in this file writes the store. The account slice (src/store/slices/account.ts) commits what these return
 * through mutateDb.
 */
import type { Db } from '../../../store/db'
import {
  allocate as engineAllocate, computeCharge, findAccount, generateEventCharges, generateRecurringCharges,
  invoiceBalance, resolvePrice, setChargeIdGenerator, unappliedFor,
  type AllocateInput, type ResolvedPrice, type ResolvePriceInput,
} from '../../../store/engine'
import { dayOf } from '../../../store/engine'
import { cadenceOf, isDue, nextCycleDate as cycleAfter, periodFor, type CadenceOf, type Period } from '../../../store/cycles'
import type { BillingAccount, Charge, Container, Frequency, PaymentAllocation, RateVersion, ServiceItem, WorkOrder } from '../../../types'
import { today } from './clock'
import { byId, withRows } from './db'
import { nextId, nextSerial } from './ids'
import type { OfficeRequestDraft, ServiceChangeArgs, ServiceChangePlan } from './types'

// ---------------------------------------------------------------------------------------------
// Labels and errors
// ---------------------------------------------------------------------------------------------

/** The account view's wording for frequencies ("2x per week"), as the prototype printed them. */
export const FREQUENCY_LABEL: Record<Frequency, string> = {
  weekly: 'weekly',
  eow: 'every other week',
  '2x': '2x per week',
  '3x': '3x per week',
  '4x': '4x per week',
  '5x': '5x per week',
  '6x': '6x per week',
  onCall: 'on call',
}

/** A plan or action the account surface refuses (a change that cannot be billed or dispatched, a bad allocation). */
export class EngineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EngineError'
  }
}

function must<T>(row: T | undefined, what: string): T {
  if (!row) throw new EngineError(`${what} not found`)
  return row
}

// ---------------------------------------------------------------------------------------------
// Cycles (the canonical calendar in src/store/cycles.ts)
// ---------------------------------------------------------------------------------------------

/** Whether cycleDate is a billing boundary for this account (canonical isDue). */
export function isCycleBoundary(account: CadenceOf, cycleDate: string): boolean {
  return isDue(account, cycleDate)
}

/** The period one run on cycleDate bills (addendum C14): cycleDate to cycleDate plus the cycle length (canonical periodFor). */
export function billingPeriod(account: Pick<BillingAccount, 'cycle'>, cycleDate: string): Period {
  return periodFor(account, cycleDate)
}

/** The account's next cycle date strictly after `from` (default today); undefined for perJob accounts. */
export function nextCycleDate(account: CadenceOf, from: string = today()): string | undefined {
  if (account.cycle === 'perJob') return undefined
  return cycleAfter(account, from)
}

// ---------------------------------------------------------------------------------------------
// Preview charge ids
// ---------------------------------------------------------------------------------------------

/**
 * Run fn with the canonical engine minting throwaway preview charge ids (chg_ac_preview_N). A preview renders on every
 * store change; with the default generator every render would advance billing's chg_bl_ counter, so billing's next run
 * would get different ids depending on how long someone looked at an account. Billing's own prior-cycle comparison
 * uses the same swap (src/store/slices/billing.ts computePriorChanges).
 */
export function withPreviewChargeIds<T>(fn: () => T): T {
  let n = 0
  setChargeIdGenerator(() => `chg_ac_preview_${++n}`)
  try {
    return fn()
  } finally {
    setChargeIdGenerator()
  }
}

// ---------------------------------------------------------------------------------------------
// Pricing explanation
// ---------------------------------------------------------------------------------------------

export interface PriceExplanation {
  ruleWon: Charge['pricing']['ruleWon']
  priceCents: number
  catalogId: string
  zoneId: string
  frequency: Frequency
  onDate: string
  contractOverride?: {
    contractId: string
    priceCents: number
    frequency?: Frequency
    reason?: string
    pctBelowRateCard?: number
    termStart: string
    termEnd: string
  }
  /** The rate card version that won, or that would have won had the contract not. */
  rateVersion?: {
    id: string
    priceCents: number
    effectiveFrom: string
    publishedAt?: string
    zoneId?: string
    frequency?: Frequency
    ruleWon: 'zoneRate' | 'standardRate'
  }
  /** The version rateVersion superseded, when present. */
  priorVersion?: { id: string; priceCents: number; effectiveFrom: string; publishedAt?: string }
}

/**
 * The full precedence chain behind the canonical resolvePrice, for the "why this price" inset. The winner is the
 * canonical call itself. The rate card a contract beat is the canonical call again on a copy of the db with no
 * contracts, so the chain can never disagree with what billing charges.
 */
export function explainPrice(args: ResolvePriceInput, db: Db): PriceExplanation {
  const resolved = resolvePrice(args, db)
  const out: PriceExplanation = {
    ruleWon: resolved.ruleWon,
    priceCents: resolved.priceCents,
    catalogId: args.catalogId,
    zoneId: args.zoneId,
    frequency: args.frequency,
    onDate: args.onDate,
  }
  if (resolved.contractId) {
    const contract = byId(db.contracts, resolved.contractId)
    const override = contract?.overrides.find(o => o.catalogId === args.catalogId && (o.frequency === undefined || o.frequency === args.frequency))
    if (contract && override) {
      out.contractOverride = {
        contractId: contract.id,
        priceCents: override.priceCents,
        frequency: override.frequency,
        reason: override.reason,
        pctBelowRateCard: override.pctBelowRateCard,
        termStart: contract.termStart,
        termEnd: contract.termEnd,
      }
    }
  }
  let rate: ResolvedPrice | undefined
  try {
    rate = resolved.rateVersionId ? resolved : resolvePrice(args, { ...db, contracts: [] })
  } catch {
    rate = undefined
  }
  const v: RateVersion | undefined = rate?.rateVersionId ? byId(db.rateVersions, rate.rateVersionId) : undefined
  if (rate && v) {
    out.rateVersion = {
      id: v.id,
      priceCents: v.priceCents,
      effectiveFrom: v.effectiveFrom,
      publishedAt: v.publishedAt,
      zoneId: v.zoneId,
      frequency: v.frequency,
      ruleWon: rate.ruleWon === 'standardRate' ? 'standardRate' : 'zoneRate',
    }
    const prior = byId(db.rateVersions, v.supersedesId)
    if (prior) out.priorVersion = { id: prior.id, priceCents: prior.priceCents, effectiveFrom: prior.effectiveFrom, publishedAt: prior.publishedAt }
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Next billing run preview
// ---------------------------------------------------------------------------------------------

/**
 * The db narrowed to one account: its account row, sites, service events, and scale tickets. The canonical generators
 * walk every account; narrowing keeps a preview to one account's work, and every other table (charges, catalog, rates,
 * contracts, fees, taxes, work orders, containers) stays whole so dedup and pricing read exactly what billing reads.
 */
export function scopedDb(db: Db, accountId: string): Db {
  const account = must(byId(db.accounts, accountId), `BillingAccount ${accountId}`)
  const sites = db.sites.filter(s => s.accountId === accountId)
  const siteIds = new Set(sites.map(s => s.id))
  const woSite = new Map(db.workOrders.map(w => [w.id, w.siteId]))
  return {
    ...db,
    accounts: [account],
    sites,
    serviceEvents: db.serviceEvents.filter(e => siteIds.has(e.siteId)),
    scaleTickets: db.scaleTickets.filter(t => siteIds.has(woSite.get(t.workOrderId) ?? '')),
  }
}

export interface NextRunPreview {
  cycleDate: string | undefined
  recurring: Charge[]
  events: Charge[]
  /** Charges already in the db for this account that are proposed or approved and not yet invoiced (billing's run). */
  proposed: Charge[]
  totalCents: number
}

/**
 * What the next billing run would produce for one account, computed without touching the store: the canonical
 * generateRecurringCharges for the account's next cycle date plus generateEventCharges, on the narrowed db, with
 * preview ids. A recurring line whose item and period start already has a Charge in the db (billing ran the cycle
 * and the line waits proposed) is left to `proposed`, so nothing is counted twice.
 */
export function previewNextRun(accountId: string, db: Db): NextRunPreview {
  const account = must(byId(db.accounts, accountId), `BillingAccount ${accountId}`)
  const cycleDate = nextCycleDate(cadenceOf(account, db.billingGroups))
  const scoped = scopedDb(db, accountId)
  const existing = new Set(db.charges.filter(c => c.period).map(c => `${c.source.type}|${c.source.id}|${dayOf(c.period!.start)}`))
  const { recurring, events } = withPreviewChargeIds(() => ({
    recurring: cycleDate
      ? generateRecurringCharges({ cycleDate }, scoped).filter(c => !existing.has(`${c.source.type}|${c.source.id}|${c.period?.start}`))
      : [],
    events: generateEventCharges(scoped),
  }))
  const proposed = db.charges.filter(c => c.accountId === accountId && (c.status === 'proposed' || c.status === 'approved'))
  const totalCents = [...recurring, ...events, ...proposed].reduce((s, c) => s + c.totalCents, 0)
  return { cycleDate, recurring, events, proposed, totalCents }
}

// ---------------------------------------------------------------------------------------------
// Balances and allocation (canonical invoiceBalance, unappliedFor, allocate)
// ---------------------------------------------------------------------------------------------

/** Invoice total minus every allocation against it (canonical invoiceBalance). */
export function openBalance(invoiceId: string, db: Db): number {
  return invoiceBalance(invoiceId, db)
}

export function accountInvoices(accountId: string, db: Db) {
  return db.invoices.filter(i => i.accountId === accountId)
}

/** Sum of open balances across the account's invoices. */
export function accountBalance(accountId: string, db: Db): number {
  return accountInvoices(accountId, db).reduce((s, i) => s + openBalance(i.id, db), 0)
}

/** Open balances of invoices whose due date is before today. */
export function pastDue(accountId: string, db: Db): number {
  const now = today()
  return accountInvoices(accountId, db)
    .filter(i => dayOf(i.dueAt) < now)
    .reduce((s, i) => s + openBalance(i.id, db), 0)
}

/** Cents of a payment or credit memo not yet allocated (canonical unappliedFor). */
export function unallocatedCents(_sourceType: PaymentAllocation['sourceType'], sourceId: string, db: Db): number {
  return unappliedFor(sourceId, db)
}

export type AllocateArgs = AllocateInput

/**
 * The canonical allocate(), plus the checks the account prototype made that the engine leaves to its callers: the
 * source exists, a returned payment is never applied, there is something to allocate, and every invoice belongs to the
 * source's account. Throws; returns the rows without writing.
 */
export function allocateChecked(args: AllocateArgs, db: Db): PaymentAllocation[] {
  const source = args.sourceType === 'payment' ? byId(db.payments, args.sourceId) : byId(db.creditMemos, args.sourceId)
  if (!source) throw new EngineError(`${args.sourceType} ${args.sourceId} does not exist`)
  if (args.sourceType === 'payment' && 'status' in source && source.status === 'returned') throw new EngineError(`Payment ${args.sourceId} was returned`)
  if (args.invoiceIds.length === 0) throw new EngineError('Nothing to allocate')
  for (const invoiceId of args.invoiceIds) {
    const inv = byId(db.invoices, invoiceId)
    if (!inv) throw new EngineError(`Invoice ${invoiceId} does not exist`)
    if (inv.accountId !== source.accountId) throw new EngineError(`Invoice ${inv.number} belongs to another account`)
  }
  return engineAllocate(args, db)
}

// ---------------------------------------------------------------------------------------------
// Service changes (invariant 3)
// ---------------------------------------------------------------------------------------------

/** True when a change would leave the replaced item exactly as it is (same catalog, qty, and frequency). */
export function isNoOpChange(args: ServiceChangeArgs, db: Db): boolean {
  const old = byId(db.serviceItems, args.replaceItemId)
  return Boolean(old && old.catalogId === args.catalogId && old.qty === args.qty && old.frequency === args.frequency)
}

/**
 * Plans a service change without writing: the old item closed (effectiveTo = effectiveFrom, status ended, never
 * deleted), the new active item with a fresh container, and a WorkOrder (swap when replacing a cart or container of the
 * same unit, otherwise deliver) scheduled for effectiveFrom. Ids come from the rows they join (lib/ids.ts), so the
 * plan a drawer previews carries exactly the ids its confirm writes. Throws EngineError for a change that cannot be
 * billed or dispatched: a catalog outside the site's line of business, an item with no published price on its
 * effective date, a date on or before the replaced item's start, a quantity below 1, or a change that changes nothing.
 */
export function planServiceChange(args: ServiceChangeArgs, db: Db): ServiceChangePlan {
  const site = must(byId(db.sites, args.siteId), `Site ${args.siteId}`)
  const catalog = must(byId(db.catalog, args.catalogId), `ServiceCatalog ${args.catalogId}`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.effectiveFrom)) throw new EngineError('Effective date must be YYYY-MM-DD')
  if (args.scheduleOn !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(args.scheduleOn)) throw new EngineError('Work order date must be YYYY-MM-DD')
  if (args.scheduleOn !== undefined && args.scheduleOn > args.effectiveFrom) throw new EngineError('The work order must be on or before the effective date')
  if (!Number.isInteger(args.qty) || args.qty < 1) throw new EngineError('Quantity must be a whole number of at least 1')
  const route = byId(db.routes, site.routeId)
  if (route && route.lob !== catalog.lob) throw new EngineError(`${catalog.name} is ${catalog.lob}; ${site.address} is on a ${route.lob} route`)
  const oldItemRow = args.replaceItemId ? must(byId(db.serviceItems, args.replaceItemId), `ServiceItem ${args.replaceItemId}`) : undefined
  if (oldItemRow && oldItemRow.siteId !== site.id) throw new EngineError(`ServiceItem ${oldItemRow.id} is not at ${site.id}`)
  if (oldItemRow?.status === 'ended') throw new EngineError(`ServiceItem ${oldItemRow.id} already ended`)
  if (oldItemRow && args.effectiveFrom <= dayOf(oldItemRow.effectiveFrom)) {
    throw new EngineError(`Effective date must be after ${oldItemRow.id} started on ${dayOf(oldItemRow.effectiveFrom)}`)
  }
  if (isNoOpChange(args, db)) throw new EngineError('Nothing changes: pick a different service, quantity, or frequency')
  let price: ResolvedPrice
  try {
    price = resolvePrice({ catalogId: catalog.id, frequency: args.frequency, zoneId: site.zoneId, accountId: site.accountId, onDate: args.effectiveFrom }, db)
  } catch {
    throw new EngineError(`No published price for ${catalog.name}, ${FREQUENCY_LABEL[args.frequency]}, on ${args.effectiveFrom}`)
  }
  const oldCatalog = oldItemRow ? byId(db.catalog, oldItemRow.catalogId) : undefined

  const oldItem: ServiceItem | undefined = oldItemRow ? { ...oldItemRow, effectiveTo: args.effectiveFrom, status: 'ended' } : undefined
  const container: Container = {
    id: nextId('cont', db.containers.map(c => c.id)),
    serial: nextSerial(catalog, db.containers),
    catalogId: catalog.id,
    siteId: site.id,
    assignedFrom: args.scheduleOn ?? args.effectiveFrom,
  }
  const newItem: ServiceItem = {
    id: nextId('si', db.serviceItems.map(s => s.id)),
    siteId: site.id,
    catalogId: catalog.id,
    qty: args.qty,
    frequency: args.frequency,
    containerIds: [container.id],
    effectiveFrom: args.effectiveFrom,
    status: 'active',
  }
  const workOrder: WorkOrder = {
    id: nextId('wo', db.workOrders.map(w => w.id)),
    siteId: site.id,
    kind: oldCatalog && oldCatalog.unit === catalog.unit ? 'swap' : 'deliver',
    status: 'open',
    scheduledFor: args.scheduleOn ?? args.effectiveFrom,
    serviceItemId: newItem.id,
    containerId: container.id,
  }
  if (args.requestId) workOrder.requestId = args.requestId
  const officeRequest: OfficeRequestDraft = {
    kind: 'cartChange',
    accountId: site.accountId,
    siteId: site.id,
    workOrderId: workOrder.id,
    createdVia: args.createdVia ?? 'phone',
    note: args.note ?? (oldItemRow && oldCatalog ? `Change ${oldCatalog.name} to ${catalog.name}, effective ${args.effectiveFrom}` : `Add ${catalog.name}, effective ${args.effectiveFrom}`),
  }
  const nextDb = withRows(db, {
    serviceItems: oldItem ? [oldItem, newItem] : [newItem],
    containers: [container],
    workOrders: [workOrder],
  })
  return { oldItem, newItem, container, workOrder, officeRequest, price, nextDb }
}

// ---------------------------------------------------------------------------------------------
// Holds, suspensions, reinstatement (invariant 4)
// ---------------------------------------------------------------------------------------------

/**
 * The item status an account status puts in place. A suspension holds every non-ended item. A vacation hold leaves
 * items active: the canonical engine bills only active items, and the hauler does not prorate or credit vacation weeks,
 * so a hold keeps billing (the prototype's rule, and how billing's seed carries acct_res_holt). Everything else is active.
 */
export function itemStatusForAccountStatus(status: BillingAccount['status']): ServiceItem['status'] {
  return status === 'suspended' ? 'held' : 'active'
}

/** What an account returns to when a hold or suspension ends: pastDue while any invoice is past due, else active. */
export function statusAfterReinstatement(accountId: string, db: Db): 'active' | 'pastDue' {
  return pastDue(accountId, db) > 0 ? 'pastDue' : 'active'
}

/** The hauler's reinstatement fee in cents (Piedmont Disposal: 2500). */
export function reinstatementFeeCents(db: Db): number {
  return db.hauler[0]?.policy.reinstatementFeeCents ?? 0
}

/**
 * The reinstatement fee as a proposed Charge, built by the canonical computeCharge (lineType fee, source manual, status
 * proposed) at the account's first site, dated `on`. `sourceId` names the office record that caused it (the
 * reinstatement's status change id); `id` is the chg_ac_ id the caller reserved. Pure. The slice writes it to
 * db.charges as proposed, on no invoice and in no run, so billing's next run takes it as a decision (box 3.6).
 */
export function buildReinstatementFee(
  { accountId, sourceId, id, on = today() }: { accountId: string; sourceId: string; id: string; on?: string },
  db: Db,
): Charge {
  findAccount(accountId, db)
  const site = must(db.sites.find(s => s.accountId === accountId), `a Site on ${accountId}`)
  const hauler = db.hauler[0]
  return computeCharge(
    {
      id,
      accountId,
      siteId: site.id,
      lineType: 'fee',
      source: { type: 'manual', id: sourceId },
      servicedOn: on,
      baseCents: reinstatementFeeCents(db),
      description: `Reinstatement fee, ${hauler?.name ?? 'hauler'} policy`,
      pricing: { ruleWon: 'manualException' },
    },
    db,
  )
}
