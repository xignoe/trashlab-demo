/**
 * Adding and removing an account, as pure plans over the db (the office's own intake, beside the storefront's signup).
 * Nothing here writes; the account slice commits what these return.
 *
 * Removing follows invariant 5 and the hauler's answer to it (DECISIONS.md, "delete if clean, else close"):
 * - An account that has never carried money (no charge, invoice, payment, credit memo, driver event, scale ticket, or
 *   contract) is a typo or a duplicate, so a delete removes its own rows: the account, its sites,
 *   service items, containers, work orders, requests, and the payer party when nothing else names it.
 * - Any other account is closed, never deleted: planCloseAccount ends its service lines, raises one recovery work
 *   order for the containers still out, and suspends the account. Every invoice, payment, credit, and waive stays.
 * A closed account is one that is suspended with no service line left un-ended (isClosedAccount); nothing in the
 * frozen BillingAccount says "closed", and this pair of facts is what closing writes.
 */
import type {
  BillingAccount, Container, Frequency, Party, Request, ServiceItem, Site, WorkOrder,
} from '../../../types'
import type { Db } from '../../../store/db'
import { dayOf, resolvePrice } from '../../../store/engine'
import { addDays, nextWeekday, today } from './clock'
import { byId } from './db'
import { EngineError } from './engine'
import { nextId, nextSerial } from './ids'

// ---------------------------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------------------------

export interface NewServiceDraft {
  catalogId: string
  qty: number
  frequency: Frequency
  /** First day the line bills; the container is delivered the day before. */
  startOn: string
}

export interface NewAccountDraft {
  payerName: string
  kind: Party['kind']
  address: string
  zoneId: string
  routeId?: string
  cycle: BillingAccount['cycle']
  billedInAdvance: boolean
  deliveryMethod: BillingAccount['deliveryMethod']
  autopay: boolean
  paymentMethodOnFile?: BillingAccount['paymentMethodOnFile']
  taxExempt: boolean
  accessNotes?: string
  poNumber?: string
  /** The first service line, or undefined for an account with no service yet. */
  service?: NewServiceDraft
}

export interface AddAccountPlan {
  party: Party
  account: BillingAccount
  site: Site
  item?: ServiceItem
  container?: Container
  workOrder?: WorkOrder
  /** Monthly price of the first line at its start date, for the preview. */
  priceCents?: number
  priceError?: string
}

/** The first thing wrong with the draft, in the order the form reads, or undefined when it is ready to add. */
export function addAccountError(draft: NewAccountDraft, db: Db): string | undefined {
  if (!draft.payerName.trim()) return 'A payer name is required'
  if (!draft.address.trim()) return 'A service address is required'
  if (!byId(db.zones, draft.zoneId)) return `Unknown zone ${draft.zoneId}`
  const zone = byId(db.zones, draft.zoneId)!
  if (zone.serviceability === 'notServed') return `${zone.name} is not served`
  if (draft.routeId && !byId(db.routes, draft.routeId)) return `Unknown route ${draft.routeId}`
  if (draft.service) {
    if (!byId(db.catalog, draft.service.catalogId)) return `Unknown service ${draft.service.catalogId}`
    if (!Number.isInteger(draft.service.qty) || draft.service.qty < 1) return 'Quantity must be a whole number of one or more'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.service.startOn)) return 'Pick a start date'
    if (draft.service.startOn < today()) return 'Service cannot start in the past'
  }
  const name = draft.payerName.trim().toLowerCase()
  const addr = draft.address.trim().toLowerCase()
  const twin = db.sites.find(s => s.address.trim().toLowerCase() === addr)
  if (twin) {
    const holder = byId(db.accounts, twin.accountId)
    const payer = holder ? byId(db.parties, holder.payerPartyId) : undefined
    if (payer && payer.name.trim().toLowerCase() === name) return `${payer.name} already has an account at this address (${twin.accountId})`
  }
  return undefined
}

/** Every row a new account writes, without writing any of them. Throws when the draft is not ready (addAccountError). */
export function planAddAccount(draft: NewAccountDraft, db: Db): AddAccountPlan {
  const bad = addAccountError(draft, db)
  if (bad) throw new EngineError(bad)

  const accountId = nextId('acct', db.accounts.map(a => a.id))
  const party: Party = { id: nextId('party', db.parties.map(p => p.id)), name: draft.payerName.trim(), kind: draft.kind }
  const account: BillingAccount = {
    id: accountId,
    payerPartyId: party.id,
    cycle: draft.cycle,
    billedInAdvance: draft.billedInAdvance,
    autopay: draft.autopay,
    ...(draft.paymentMethodOnFile ? { paymentMethodOnFile: draft.paymentMethodOnFile } : {}),
    status: 'active',
    deliveryMethod: draft.deliveryMethod,
    taxExempt: draft.taxExempt,
  }
  const site: Site = {
    id: nextId('site', db.sites.map(s => s.id)),
    accountId,
    occupantPartyId: party.id,
    address: draft.address.trim(),
    zoneId: draft.zoneId,
    ...(draft.routeId ? { routeId: draft.routeId } : {}),
    ...(draft.accessNotes?.trim() ? { accessNotes: draft.accessNotes.trim() } : {}),
    ...(draft.poNumber?.trim() ? { poNumber: draft.poNumber.trim() } : {}),
  }
  const plan: AddAccountPlan = { party, account, site }
  if (!draft.service) return plan

  const catalog = byId(db.catalog, draft.service.catalogId)!
  const cartArrives = addDays(draft.service.startOn, -1)
  const container: Container = {
    id: nextId('cart', db.containers.map(c => c.id)),
    serial: nextSerial(catalog, db.containers),
    catalogId: catalog.id,
    siteId: site.id,
    assignedFrom: cartArrives,
  }
  const item: ServiceItem = {
    id: nextId('si', db.serviceItems.map(i => i.id)),
    siteId: site.id,
    catalogId: catalog.id,
    qty: draft.service.qty,
    frequency: draft.service.frequency,
    containerIds: [container.id],
    effectiveFrom: draft.service.startOn,
    status: 'active',
  }
  const workOrder: WorkOrder = {
    id: nextId('wo', db.workOrders.map(w => w.id)),
    siteId: site.id,
    kind: 'deliver',
    status: 'open',
    scheduledFor: cartArrives,
    serviceItemId: item.id,
    containerId: container.id,
  }
  plan.item = item
  plan.container = container
  plan.workOrder = workOrder
  try {
    plan.priceCents = resolvePrice(
      { catalogId: catalog.id, frequency: item.frequency, zoneId: site.zoneId, accountId, onDate: item.effectiveFrom },
      db,
    ).priceCents * item.qty
  } catch (err) {
    plan.priceError = err instanceof Error ? err.message : String(err)
  }
  return plan
}

/** The first route day on or after `from` for a route, for the form's suggested start date. */
export function firstServiceDay(routeId: string | undefined, db: Db, from: string = today()): string {
  const route = byId(db.routes, routeId)
  return route ? nextWeekday(from, route.day) : from
}

// ---------------------------------------------------------------------------------------------
// Remove: delete when clean, close otherwise
// ---------------------------------------------------------------------------------------------

/** What an account carries that a delete would have to take with it. Anything above zero means close, not delete. */
export interface AccountHistory {
  invoices: number
  charges: number
  payments: number
  creditMemos: number
  serviceEvents: number
  scaleTickets: number
  contracts: number
}

export interface RemoveAccountPlan {
  accountId: string
  name: string
  /** True when the account carries no financial or field history at all, so its own rows may be removed. */
  canDelete: boolean
  history: AccountHistory
  /** Plain sentences saying what stops a delete, in the order to show them. */
  blockers: string[]
  /** Rows a delete removes (empty when canDelete is false). */
  deletes: {
    siteIds: string[]
    itemIds: string[]
    containerIds: string[]
    workOrderIds: string[]
    requestIds: string[]
    /** The payer, when no other account or site still names it. */
    partyIds: string[]
  }
  /** Rows a close writes. */
  closes: {
    effectiveFrom: string
    items: ServiceItem[]
    /** Containers still at the site, which the recovery work order collects. Container rows themselves are not changed. */
    recoverContainers: Container[]
    recovery?: WorkOrder
    account: BillingAccount
    openRequests: Request[]
  }
  /** Money the customer still owes; closing never writes it off. */
  openBalanceCents: number
  pastDueCents: number
}

export function isClosedAccount(account: BillingAccount, items: ServiceItem[]): boolean {
  return account.status === 'suspended' && items.length > 0 && items.every(i => i.status === 'ended')
}

/** Both ways to remove one account, costed against the current db. Throws for an unknown account. */
export function planRemoveAccount(db: Db, accountId: string, opts: { effectiveFrom?: string } = {}): RemoveAccountPlan {
  const account = byId(db.accounts, accountId)
  if (!account) throw new EngineError(`Account ${accountId} does not exist`)
  const party = byId(db.parties, account.payerPartyId)
  const sites = db.sites.filter(s => s.accountId === accountId)
  const siteIds = sites.map(s => s.id)
  const items = db.serviceItems.filter(i => siteIds.includes(i.siteId))
  // A container with no site is in the yard, so it belongs to no account.
  const containers = db.containers.filter(c => c.siteId !== undefined && siteIds.includes(c.siteId))
  const workOrders = db.workOrders.filter(w => siteIds.includes(w.siteId))
  const workOrderIds = new Set(workOrders.map(w => w.id))
  const requests = db.requests.filter(r => r.accountId === accountId)
  const invoices = db.invoices.filter(i => i.accountId === accountId)

  const history: AccountHistory = {
    invoices: invoices.length,
    charges: db.charges.filter(c => c.accountId === accountId).length,
    payments: db.payments.filter(p => p.accountId === accountId).length,
    creditMemos: db.creditMemos.filter(m => m.accountId === accountId).length,
    serviceEvents: db.serviceEvents.filter(e => siteIds.includes(e.siteId)).length,
    // A scale ticket names the work order it was weighed on, not the site.
    scaleTickets: db.scaleTickets.filter(t => workOrderIds.has(t.workOrderId)).length,
    contracts: db.contracts.filter(c => c.accountId === accountId || c.id === account.contractId).length,
  }
  const blockers: string[] = []
  const say = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
  if (history.invoices) blockers.push(say(history.invoices, 'invoice'))
  if (history.charges) blockers.push(say(history.charges, 'charge'))
  if (history.payments) blockers.push(say(history.payments, 'payment'))
  if (history.creditMemos) blockers.push(say(history.creditMemos, 'credit memo'))
  if (history.serviceEvents) blockers.push(say(history.serviceEvents, 'service event'))
  if (history.scaleTickets) blockers.push(say(history.scaleTickets, 'scale ticket'))
  if (history.contracts) blockers.push(say(history.contracts, 'contract'))

  const openBalanceCents = invoices.reduce(
    (sum, inv) => sum + inv.totalCents - db.allocations.filter(a => a.invoiceId === inv.id).reduce((s, a) => s + a.cents, 0),
    0,
  )
  const now = today()
  const pastDueCents = invoices
    .filter(inv => dayOf(inv.dueAt) < now)
    .reduce((sum, inv) => sum + inv.totalCents - db.allocations.filter(a => a.invoiceId === inv.id).reduce((s, a) => s + a.cents, 0), 0)

  const canDelete = blockers.length === 0
  // The payer goes with the account only when it is nobody else's payer and occupies no other site.
  const partyIds = party
    && !db.accounts.some(a => a.id !== accountId && a.payerPartyId === party.id)
    && !db.sites.some(s => !siteIds.includes(s.id) && s.occupantPartyId === party.id)
    ? [party.id]
    : []

  const effectiveFrom = opts.effectiveFrom ?? now
  const endingItems = items
    .filter(i => i.status !== 'ended')
    .map((i): ServiceItem => ({ ...i, status: 'ended', effectiveTo: effectiveFrom }))
  const outContainerIds = new Set(endingItems.flatMap(i => i.containerIds))
  const outContainers = containers.filter(c => outContainerIds.has(c.id))
  const site = sites[0]
  const recovery: WorkOrder | undefined = outContainers.length && site
    ? {
        id: nextId('wo', db.workOrders.map(w => w.id)),
        siteId: site.id,
        kind: 'recovery',
        status: 'open',
        scheduledFor: firstServiceDay(site.routeId, db, effectiveFrom),
        ...(endingItems[0] ? { serviceItemId: endingItems[0].id } : {}),
        ...(outContainers.length === 1 ? { containerId: outContainers[0].id } : {}),
      }
    : undefined

  return {
    accountId,
    name: party?.name ?? accountId,
    canDelete,
    history,
    blockers,
    deletes: canDelete
      ? {
          siteIds,
          itemIds: items.map(i => i.id),
          containerIds: containers.map(c => c.id),
          workOrderIds: workOrders.map(w => w.id),
          requestIds: requests.map(r => r.id),
          partyIds,
        }
      : { siteIds: [], itemIds: [], containerIds: [], workOrderIds: [], requestIds: [], partyIds: [] },
    closes: {
      effectiveFrom,
      items: endingItems,
      recoverContainers: outContainers,
      recovery,
      account: { ...account, status: 'suspended', autopay: false },
      openRequests: requests.filter(r => r.status === 'open' || r.status === 'scheduled'),
    },
    openBalanceCents,
    pastDueCents,
  }
}
