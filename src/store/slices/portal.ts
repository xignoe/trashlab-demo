/**
 * Portal slice (Phase 2, box 2C.2). Moved from portal/src/store/useStore.ts.
 *
 * Writes to db, always through get().mutateDb(fn, patch):
 *   requests, workOrders, payments, allocations, charges (the approved extra pickup charge), and on BillingAccount the
 *   autopay flag, paymentMethodOnFile, and the pastDue <-> active status flip after a payment (PORT_DECISIONS.md 8).
 * Stays in this slice (portal-local, addendum B3), shapes exported for Phase 3, which routes them to their owners:
 *   holds          -> account's hold drawer: the account view offers "Apply hold" on the portal's vacationHold Request
 *                     and confirms through account's changeAccountStatus (box 3.3; a status change is an office call)
 *   pendingChanges -> the record of a cart change portalChangeCart already applied through account's
 *                     changeServiceItem (box 3.3)
 *   quoteRequests  -> pricing's quote workbench (storefront and pricing own Quote)
 *   paymentMethods -> the processor token and last four the contract has no field for
 * plus portalSession (signed-in account and site) and portalLog (every portal write, oldest first).
 *
 * Keys: the four data tables use the names the checklist gives them. Everything else is prefixed `portal` so no
 * generic action name (placeHold, recordPayment, setAutopay) can collide with account's or storefront's slice.
 * Portal-minted ids carry the `_p` infix (addendum C12, ../../surfaces/portal/lib/ids.ts).
 */
import type { BillingAccount, Charge, InvoiceDelivery, Payment, PaymentAllocation, Quote, Request, WorkOrder } from '../../types'
import type { Db } from '../db'
import { allocate } from '../engine'
import { stamp, today } from '../clock'
import { nextPortalId, nextPortalIds } from '../../surfaces/portal/lib/ids'
import { DELIVERY_CONTACT, normalizeContact } from '../../surfaces/portal/lib/deliveryContact'
import { checkHoldPolicy, nextCycleStart } from '../../surfaces/portal/lib/engine'
import { addDays, nextBusinessDay10am, nextRouteDay } from '../../surfaces/portal/lib/clock'
import {
  holdableServiceItems, invoiceOpenBalance, missedPickupLookup, routeForSite, serviceItemsForSite, sitesForAccount,
  type QuoteMaterial,
} from '../../surfaces/portal/lib/selectors'
import type { PaymentMethodKind } from '../../surfaces/portal/lib/paymentToken'
import type { SliceCreator } from './types'

// ---------------------------------------------------------------------------
// Portal-local tables. Phase 3 reads these shapes; keep them stable.
// ---------------------------------------------------------------------------

/** Who is signed in to the portal and which of their sites every screen shows. */
export interface PortalSession {
  accountId: string
  siteId: string
}

/** One portal write. `stub:` actions name a write another surface owns (the merge routes them). */
export interface PortalLogEntry {
  at: string
  action: string
  ids: string[]
}

/**
 * A saved, tokenized payment method, one row per account (portal DECISIONS.md entry 25). The contract only records
 * `paymentMethodOnFile: 'card' | 'ach'` on the account. Never holds a card number, expiry, CVC, or bank account number.
 */
export interface PaymentMethod {
  accountId: string
  kind: PaymentMethodKind
  last4: string
  tokenId: string
  brand: string
  savedAt: string
}

/**
 * A vacation hold the customer placed on one service item (portal DECISIONS.md entries 5, 33, 37). ServiceItem has
 * status held but no hold dates, so the range lives here. Account applies it to ServiceItem.status (Phase 3, box 3.3).
 * The matching Request (kind vacationHold) is found by site and range in its note.
 */
export interface Hold {
  id: string
  serviceItemId: string
  /** First held day, YYYY-MM-DD. */
  start: string
  /** Last held day, YYYY-MM-DD. */
  end: string
}

/**
 * A proposed cart size change (portal DECISIONS.md entry 38). The portal never ends or adds a ServiceItem; account
 * turns this into the ServiceItem change (Phase 3, box 3.3, and scenario 7).
 */
export interface PendingChange {
  id: string
  serviceItemId: string
  fromCatalogId: string
  toCatalogId: string
  /** Next cycle start: hauler proration is none, so the new size bills from here. */
  effectiveFrom: string
  /** The cartChange Request, status scheduled. */
  requestId: string
  /** The swap WorkOrder on the next route day. */
  workOrderId: string
}

/** What requestServiceItemHold() hands to account: the items to hold and the range. */
export interface ServiceItemHoldRequest {
  accountId: string
  serviceItemIds: string[]
  start: string
  end: string
}

/**
 * A commercial quote draft the portal cannot write to db.quotes (portal DECISIONS.md entry 44). The quote is
 * Quote-shaped (kind commercialRequest, status draft, priceCents 0) so pricing can take it as is.
 */
export interface QuoteRequest {
  /** The same id as quote.id. */
  id: string
  quote: Quote
  accountId: string
  siteId: string
  material: QuoteMaterial
  accessNotes?: string
  /** The quote Request, status open. */
  requestId: string
  /** When a person promises to send the priced quote: next business day, 10:00. */
  followUpBy: string
}

// ---------------------------------------------------------------------------
// Action inputs
// ---------------------------------------------------------------------------

export interface BookExtraPickupInput {
  accountId: string
  siteId: string
  /** The quote from computeCharge (lineType event, source manual, base eventRates.extraPickup), still proposed. */
  charge: Charge
  method: Payment['method']
  /** Next route day for the site. */
  scheduledFor: string
  serviceItemId?: string
  containerId?: string
}

export interface PlaceHoldInput {
  accountId: string
  siteId: string
  start: string
  end: string
}

export interface ChangeCartInput {
  accountId: string
  siteId: string
  /** The active cart ServiceItem being replaced. */
  serviceItemId: string
  /** The catalog id of the new cart size. */
  toCatalogId: string
}

export interface RecordPaymentInput {
  accountId: string
  method: Payment['method']
  /** Which invoices to pay and how much of each, in order. */
  invoiceIds: string[]
  cents: number[]
  processorBatchId?: string
}

export interface RequestQuoteInput {
  accountId: string
  siteId: string
  catalogId: string
  qty: number
  frequency: Quote['lines'][number]['frequency']
  material: QuoteMaterial
  accessNotes?: string
}

export interface ReportMissedPickupInput {
  accountId: string
  siteId: string
  /** The route day the customer says was missed. */
  date: string
}

export type SubmitQuoteRequestInput = Omit<QuoteRequest, 'id' | 'quote'> & { quote: Omit<Quote, 'id'> }

// ---------------------------------------------------------------------------
// The slice
// ---------------------------------------------------------------------------

export interface PortalData {
  portalSession: PortalSession
  portalLog: PortalLogEntry[]
  paymentMethods: PaymentMethod[]
  holds: Hold[]
  pendingChanges: PendingChange[]
  quoteRequests: QuoteRequest[]
}

export interface PortalActions {
  /** Sign in as another account; the site becomes that account's first site. */
  portalSwitchAccount(accountId: string): void
  /** Show another site of the signed-in account. */
  portalSetSite(siteId: string): void
  /** File a Request (the handoff card, a dispute, a note to the office). */
  portalAddRequest(input: Omit<Request, 'id'> & { id?: string }): Request
  /** Schedule a WorkOrder (OWNERSHIP.md: portal creates extraPickup and recovery orders). */
  portalAddWorkOrder(input: Omit<WorkOrder, 'id'> & { id?: string }): WorkOrder
  /** Write BillingAccount.autopay. */
  portalSetAutopay(accountId: string, autopay: boolean): void
  /** The customer's own choice of how invoices reach them (addendum P): BillingAccount.deliveryMethod, and where they
   *  go. Email, text, and mail need `contact` (email address, mobile number, mailing address) unless one is on file. */
  portalSetDeliveryMethod(accountId: string, method: InvoiceDelivery, contact?: string): void
  /** Save or replace the account's tokenized method and keep BillingAccount.paymentMethodOnFile in step. */
  portalSavePaymentMethod(input: Omit<PaymentMethod, 'savedAt'>): PaymentMethod
  /** Payment plus allocations in one commit, then the status flip. Throws before writing when any allocation is bad. */
  portalRecordPayment(input: RecordPaymentInput): { payment: Payment; allocations: PaymentAllocation[] }
  /** pastDue once any invoice is open past its due date, active when none is. Suspended and hold are office calls. */
  portalRefreshAccountStatus(accountId: string): BillingAccount['status']
  /** Prepaid extra pickup: approved Charge, settled unallocated Payment, scheduled Request and WorkOrder. */
  portalBookExtraPickup(input: BookExtraPickupInput): { charge: Charge; payment: Payment; request: Request; workOrder: WorkOrder }
  /** Stub for account's ServiceItem hold: logs the items and range, never touches ServiceItem or BillingAccount. */
  portalRequestServiceItemHold(input: ServiceItemHoldRequest): ServiceItemHoldRequest
  /** Stub for account's ServiceItem change: records the proposal in pendingChanges. */
  portalProposeCartChange(input: Omit<PendingChange, 'id'>): PendingChange
  /** Vacation hold: a holds row per active item, the stubbed ServiceItem hold, and a scheduled Request. */
  portalPlaceHold(input: PlaceHoldInput): { holds: Hold[]; request: Request }
  /** Cart size change, no proration: a scheduled Request, a swap WorkOrder, and a pendingChanges row effective next cycle. */
  portalChangeCart(input: ChangeCartInput): { pendingChange: PendingChange; workOrder: WorkOrder; request: Request }
  /** A missed ServiceEvent: a recovery WorkOrder the next business day and a scheduled missedPickup Request. */
  portalReportMissedPickup(input: ReportMissedPickupInput): { workOrder: WorkOrder; request: Request }
  /** Stub for pricing's Quote write: records a Quote-shaped draft in quoteRequests, never in db.quotes. */
  portalSubmitQuoteRequest(input: SubmitQuoteRequestInput): QuoteRequest
  /** Commercial quote request: the stubbed Quote draft plus an open quote Request naming the quote id. */
  portalRequestQuote(input: RequestQuoteInput): { quoteRequest: QuoteRequest; request: Request }
}

export type PortalSlice = PortalData & PortalActions

/** Maple is who every portal runbook starts as. Account and site ids are shared across all five seeds (addendum D1). */
export const DEFAULT_PORTAL_ACCOUNT_ID = 'acct_res_maple'
export const DEFAULT_PORTAL_SITE_ID = 'site_maple'

/**
 * Saved methods the prototype seeded in its store (portal DECISIONS.md entry 25). Billing's seed records
 * paymentMethodOnFile only for Holt and the roll off homeowner, so Maple's and Oakridge's rows are ahead of the seed
 * until the manager adds the flag ("Requests from portal port" item 2).
 */
export const SEED_PAYMENT_METHODS: readonly PaymentMethod[] = [
  { accountId: 'acct_res_maple', kind: 'card', last4: '4242', tokenId: 'tok_seed_maple', brand: 'Visa', savedAt: '2026-04-09T14:20:00' },
  { accountId: 'acct_pm_oakridge', kind: 'ach', last4: '6710', tokenId: 'tok_seed_oakridge', brand: 'Checking', savedAt: '2025-11-03T10:00:00' },
  { accountId: 'acct_res_holt', kind: 'card', last4: '1881', tokenId: 'tok_seed_holt', brand: 'Mastercard', savedAt: '2026-01-12T08:30:00' },
  { accountId: 'acct_ro_homeowner', kind: 'card', last4: '0093', tokenId: 'tok_seed_ro', brand: 'Visa', savedAt: '2026-08-07T16:45:00' },
]

/** Fresh portal state: Maple signed in on her one site, the seeded methods, no holds, changes, quotes, or log. */
export function initialPortalData(): PortalData {
  return {
    portalSession: { accountId: DEFAULT_PORTAL_ACCOUNT_ID, siteId: DEFAULT_PORTAL_SITE_ID },
    portalLog: [],
    paymentMethods: SEED_PAYMENT_METHODS.map(m => ({ ...m })),
    holds: [],
    pendingChanges: [],
    quoteRequests: [],
  }
}

function entry(action: string, ids: string[]): PortalLogEntry {
  return { at: stamp(), action, ids }
}

function requireAccount(db: Db, accountId: string): BillingAccount {
  const account = db.accounts.find(a => a.id === accountId)
  if (!account) throw new Error(`Unknown account ${accountId}`)
  return account
}

function requireSiteOn(db: Db, siteId: string, accountId: string) {
  const site = db.sites.find(s => s.id === siteId)
  if (!site || site.accountId !== accountId) throw new Error(`Site ${siteId} is not on account ${accountId}`)
  return site
}

/**
 * The status an account should have after a payment. Only active and pastDue move; suspended and hold are office
 * decisions (portal DECISIONS.md entry 28). Returns the db with the flip applied and the log line, if any.
 */
function withDerivedStatus(db: Db, accountId: string): { db: Db; log?: PortalLogEntry } {
  const account = requireAccount(db, accountId)
  if (account.status === 'suspended' || account.status === 'hold') return { db }
  const on = today()
  const anyPastDue = db.invoices.some(i => i.accountId === accountId && i.dueAt.slice(0, 10) < on && invoiceOpenBalance(db, i.id) > 0)
  const next: BillingAccount['status'] = anyPastDue ? 'pastDue' : 'active'
  if (next === account.status) return { db }
  return {
    db: { ...db, accounts: db.accounts.map(a => (a.id === accountId ? { ...a, status: next } : a)) },
    log: entry(`accountStatus:${account.status}->${next}`, [accountId]),
  }
}

export const createPortalSlice: SliceCreator<PortalSlice> = (set, get) => ({
  ...initialPortalData(),

  portalSwitchAccount(accountId) {
    const { db } = get()
    requireAccount(db, accountId)
    const sites = sitesForAccount(db, accountId)
    if (sites.length === 0) throw new Error(`Account ${accountId} has no sites`)
    set({ portalSession: { accountId, siteId: sites[0].id } })
  },

  portalSetSite(siteId) {
    const { db, portalSession } = get()
    const site = db.sites.find(s => s.id === siteId)
    if (!site) throw new Error(`Unknown site ${siteId}`)
    if (site.accountId !== portalSession.accountId) throw new Error(`Site ${siteId} is not on the signed-in account`)
    set({ portalSession: { ...portalSession, siteId } })
  },

  portalAddRequest(input) {
    const { db } = get()
    if (input.id && db.requests.some(r => r.id === input.id)) throw new Error(`Request ${input.id} already exists`)
    const row: Request = { ...input, id: input.id ?? nextPortalId('req', db.requests.map(r => r.id)) }
    get().mutateDb(d => ({ ...d, requests: [...d.requests, row] }), s => ({ portalLog: [...s.portalLog, entry('addRequest', [row.id])] }))
    return row
  },

  portalAddWorkOrder(input) {
    const { db } = get()
    if (input.id && db.workOrders.some(w => w.id === input.id)) throw new Error(`Work order ${input.id} already exists`)
    const row: WorkOrder = { ...input, id: input.id ?? nextPortalId('wo', db.workOrders.map(w => w.id)) }
    get().mutateDb(d => ({ ...d, workOrders: [...d.workOrders, row] }), s => ({ portalLog: [...s.portalLog, entry('addWorkOrder', [row.id])] }))
    return row
  },

  portalSetDeliveryMethod(accountId, method, contact) {
    const account = requireAccount(get().db, accountId)
    if (!(['email', 'mail', 'text', 'portal'] as InvoiceDelivery[]).includes(method)) throw new Error(`Unknown delivery method ${method}`)
    const group = account.billingGroupId ? get().db.billingGroups.find(g => g.id === account.billingGroupId) : undefined
    if (group && !group.customerChoice && method !== group.delivery) throw new Error(`Your billing group sends every invoice one way (${group.delivery}); call the office to change it`)
    // Email, text, and mail need somewhere to send the invoice (DECISIONS.md 70): the one given, else the one on file.
    const need = DELIVERY_CONTACT[method]
    const value = need ? (contact !== undefined ? normalizeContact(method, contact) : account[need.field]) : undefined
    if (need && !value) throw new Error(`Add your ${need.label.toLowerCase()} to get invoices by ${method}`)
    if (account.deliveryMethod === method && (!need || account[need.field] === value)) return
    get().mutateDb(
      d => ({ ...d, accounts: d.accounts.map(a => (a.id === accountId ? { ...a, deliveryMethod: method, ...(need ? { [need.field]: value } : {}) } : a)) }),
      s => ({ portalLog: [...s.portalLog, entry(`setDeliveryMethod:${method}`, [accountId])] }),
    )
  },

  portalSetAutopay(accountId, autopay) {
    requireAccount(get().db, accountId)
    get().mutateDb(
      d => ({ ...d, accounts: d.accounts.map(a => (a.id === accountId ? { ...a, autopay } : a)) }),
      s => ({ portalLog: [...s.portalLog, entry(autopay ? 'setAutopay:on' : 'setAutopay:off', [accountId])] }),
    )
  },

  portalSavePaymentMethod(input) {
    requireAccount(get().db, input.accountId)
    if (!/^tok_/.test(input.tokenId)) throw new Error('A payment method must be saved from a processor token')
    if (!/^\d{4}$/.test(input.last4)) throw new Error('last4 must be four digits')
    const row: PaymentMethod = { ...input, savedAt: stamp() }
    get().mutateDb(
      d => ({ ...d, accounts: d.accounts.map(a => (a.id === input.accountId ? { ...a, paymentMethodOnFile: input.kind } : a)) }),
      s => ({
        paymentMethods: [...s.paymentMethods.filter(m => m.accountId !== input.accountId), row],
        portalLog: [...s.portalLog, entry('savePaymentMethod', [input.accountId, input.tokenId, `${input.kind}:${input.last4}`])],
      }),
    )
    return row
  },

  portalRecordPayment(input) {
    const { db } = get()
    requireAccount(db, input.accountId)
    const total = input.cents.reduce((sum, c) => sum + c, 0)
    if (total <= 0) throw new Error('A payment must be for a positive amount')
    for (const id of input.invoiceIds) {
      const inv = db.invoices.find(i => i.id === id)
      if (inv?.accountId !== input.accountId) throw new Error(`Invoice ${id} is not on account ${input.accountId}`)
    }
    const payment: Payment = {
      id: nextPortalId('pay', db.payments.map(p => p.id)),
      accountId: input.accountId,
      method: input.method,
      cents: total,
      receivedAt: stamp(),
      status: 'settled',
    }
    if (input.processorBatchId) payment.processorBatchId = input.processorBatchId
    // Allocate against a draft that already holds the payment, so the canonical allocate() checks its unapplied
    // cents and each invoice's open balance. It throws before anything is written.
    const draft: Db = { ...db, payments: [...db.payments, payment] }
    const allocations = allocate({ sourceType: 'payment', sourceId: payment.id, invoiceIds: input.invoiceIds, cents: input.cents }, draft)
    const flipped = withDerivedStatus({ ...draft, allocations: [...draft.allocations, ...allocations] }, input.accountId)
    get().mutateDb(() => flipped.db, s => ({
      portalLog: [
        ...s.portalLog,
        entry('addPayment', [payment.id]),
        entry('addAllocations', allocations.map(a => `${a.sourceId}->${a.invoiceId}:${a.cents}`)),
        ...(flipped.log ? [flipped.log] : []),
      ],
    }))
    return { payment, allocations }
  },

  portalRefreshAccountStatus(accountId) {
    const flipped = withDerivedStatus(get().db, accountId)
    if (flipped.log) get().mutateDb(() => flipped.db, s => ({ portalLog: [...s.portalLog, flipped.log!] }))
    return requireAccount(flipped.db, accountId).status
  },

  portalBookExtraPickup(input) {
    const { db } = get()
    const { accountId, siteId, charge, method, scheduledFor } = input
    const account = requireAccount(db, accountId)
    requireSiteOn(db, siteId, accountId)
    // Invariant 4: a suspended account never gets a charge or a payment, whatever the screen allowed.
    if (account.status === 'suspended' || account.status === 'hold') throw new Error(`Account ${accountId} is ${account.status}; an extra pickup goes to a person`)
    if (charge.accountId !== accountId || charge.siteId !== siteId) throw new Error('Charge does not belong to this account and site')
    if (charge.status !== 'proposed') throw new Error('Only a proposed charge can be booked')
    if (charge.totalCents <= 0) throw new Error('An extra pickup must have a positive total')

    // Approved by the customer paying it in full (the storefront's first-cycle charges follow the same rule,
    // addendum C13). Billing posts it on the next run and applies this payment then (Phase 3).
    const approved: Charge = { ...charge, id: nextPortalId('chg', db.charges.map(c => c.id)), status: 'approved' }
    const payment: Payment = {
      id: nextPortalId('pay', db.payments.map(p => p.id)), accountId, method, cents: approved.totalCents, receivedAt: stamp(), status: 'settled',
    }
    const requestId = nextPortalId('req', db.requests.map(r => r.id))
    const workOrder: WorkOrder = { id: nextPortalId('wo', db.workOrders.map(w => w.id)), siteId, kind: 'extraPickup', status: 'scheduled', scheduledFor, requestId }
    if (input.serviceItemId) workOrder.serviceItemId = input.serviceItemId
    if (input.containerId) workOrder.containerId = input.containerId
    const request: Request = {
      id: requestId, accountId, siteId, kind: 'extraPickup', status: 'scheduled', createdVia: 'portal', workOrderId: workOrder.id,
      note: `Extra pickup on ${scheduledFor}, prepaid ${payment.id}, charge ${approved.id}`,
    }
    get().mutateDb(
      d => ({
        ...d,
        charges: [...d.charges, approved],
        payments: [...d.payments, payment],
        requests: [...d.requests, request],
        workOrders: [...d.workOrders, workOrder],
      }),
      s => ({
        portalLog: [
          ...s.portalLog,
          entry('addCharge', [approved.id]), entry('addPayment', [payment.id]), entry('addRequest', [request.id]), entry('addWorkOrder', [workOrder.id]),
        ],
      }),
    )
    return { charge: approved, payment, request, workOrder }
  },

  portalRequestServiceItemHold(input) {
    set(s => ({ portalLog: [...s.portalLog, entry('stub:requestServiceItemHold', [input.accountId, ...input.serviceItemIds, `${input.start}..${input.end}`])] }))
    return { ...input, serviceItemIds: [...input.serviceItemIds] }
  },

  portalProposeCartChange(input) {
    const { pendingChanges } = get()
    if (pendingChanges.some(p => p.serviceItemId === input.serviceItemId)) throw new Error(`Service item ${input.serviceItemId} already has a pending change`)
    const row: PendingChange = { ...input, id: nextPortalId('chgreq', pendingChanges.map(p => p.id)) }
    set(s => ({
      pendingChanges: [...s.pendingChanges, row],
      portalLog: [...s.portalLog, entry('stub:proposeCartChange', [row.id, row.serviceItemId, `${row.fromCatalogId}->${row.toCatalogId}@${row.effectiveFrom}`])],
    }))
    return row
  },

  portalPlaceHold(input) {
    const state = get()
    const { accountId, siteId, start, end } = input
    const db = state.db
    requireSiteOn(db, siteId, accountId)
    const policy = checkHoldPolicy(start, end, today())
    if (!policy.ok) throw new Error(policy.reason)
    const active = holdableServiceItems({ ...db, holds: state.holds }, siteId, today())
    if (active.length === 0) throw new Error('No active service at this site to hold')
    // Portal rows only. The ServiceItem status change and any account status change are account's writes.
    const ids = nextPortalIds('hold', state.holds.map(h => h.id), active.length)
    const holds: Hold[] = active.map((item, i) => ({ id: ids[i], serviceItemId: item.id, start, end }))
    const route = routeForSite(db, siteId)
    const resumes = route ? nextRouteDay(route.day, end) : addDays(end, 1)
    const request: Request = {
      id: nextPortalId('req', db.requests.map(r => r.id)), accountId, siteId, kind: 'vacationHold', status: 'scheduled', createdVia: 'portal',
      note: `Vacation hold ${start} to ${end}, pickups resume ${resumes}`,
    }
    const stub: ServiceItemHoldRequest = { accountId, serviceItemIds: active.map(i => i.id), start, end }
    get().mutateDb(d => ({ ...d, requests: [...d.requests, request] }), s => ({
      holds: [...s.holds, ...holds],
      portalLog: [
        ...s.portalLog,
        ...holds.map(h => entry('addHold', [h.id, h.serviceItemId, `${h.start}..${h.end}`])),
        entry('stub:requestServiceItemHold', [stub.accountId, ...stub.serviceItemIds, `${start}..${end}`]),
        entry('addRequest', [request.id]),
      ],
    }))
    return { holds, request }
  },

  portalChangeCart(input) {
    const state = get()
    const db = state.db
    const { accountId, siteId, serviceItemId, toCatalogId } = input
    const account = requireAccount(db, accountId)
    const current = db.serviceItems.find(i => i.id === serviceItemId)
    if (!current || current.siteId !== siteId) throw new Error(`Service item ${serviceItemId} is not at site ${siteId}`)
    requireSiteOn(db, siteId, accountId)
    // A cart with a change waiting has already been ended by account, so say so before the active check does.
    if (state.pendingChanges.some(p => p.serviceItemId === serviceItemId)) throw new Error('This cart already has a pending change')
    if (current.status !== 'active') throw new Error('Only an active service can change size')
    if (current.catalogId === toCatalogId) throw new Error('That is already the current cart size')
    if (!db.catalog.some(c => c.id === toCatalogId)) throw new Error(`Unknown catalog item ${toCatalogId}`)
    const route = routeForSite(db, siteId)
    if (!route) throw new Error('No route serves this site')
    const effectiveFrom = nextCycleStart(account, today())
    const swapDay = nextRouteDay(route.day, today())
    const requestId = nextPortalId('req', db.requests.map(r => r.id))
    const note = `Change ${current.catalogId} to ${toCatalogId}, effective ${effectiveFrom}, cart swap on ${swapDay}`

    // Box 3.3: account owns ServiceItem changes (OWNERSHIP.md), so the portal's cart change drives account's
    // changeServiceItem. It ends the old cart at the next cycle start (the hauler does not prorate), starts the new size
    // there, and schedules the swap WorkOrder on the next route day, answering this Request. It throws before writing
    // anything (no published price, a bad date), so nothing below runs on failure.
    const plan = get().changeServiceItem({
      siteId, replaceItemId: current.id, catalogId: toCatalogId, qty: current.qty, frequency: current.frequency, effectiveFrom,
      scheduleOn: swapDay <= effectiveFrom ? swapDay : undefined, createdVia: 'portal', note, requestId,
    })
    const workOrder = plan.workOrder
    const request: Request = {
      id: requestId, accountId, siteId, kind: 'cartChange', status: 'scheduled', createdVia: 'portal', workOrderId: workOrder.id, note,
    }
    const pendingChange: PendingChange = {
      id: nextPortalId('chgreq', state.pendingChanges.map(p => p.id)), serviceItemId: current.id, fromCatalogId: current.catalogId, toCatalogId,
      effectiveFrom, requestId, workOrderId: workOrder.id,
    }
    get().mutateDb(d => ({ ...d, requests: [...d.requests, request] }), s => ({
      pendingChanges: [...s.pendingChanges, pendingChange],
      portalLog: [
        ...s.portalLog,
        entry('addRequest', [request.id]),
        entry('account:changeServiceItem', [current.id, plan.newItem.id, workOrder.id]),
        entry('addPendingChange', [pendingChange.id, pendingChange.serviceItemId, `${pendingChange.fromCatalogId}->${toCatalogId}@${effectiveFrom}`]),
      ],
    }))
    return { pendingChange, workOrder, request }
  },

  portalReportMissedPickup(input) {
    const db = get().db
    const { accountId, siteId, date } = input
    requireSiteOn(db, siteId, accountId)
    // Maple's field events are seed rows since box 3.7a retired the portal's fallback file, so the lookup reads db.
    const lookup = missedPickupLookup(db, siteId, date, today())
    if (lookup.existing) throw new Error(`Already reported as ${lookup.existing.id}`)
    if (lookup.kind !== 'missed') throw new Error(`No recovery for a ${lookup.kind} lookup on ${lookup.date}`)
    const { event, recoveryOn } = lookup
    const requestId = nextPortalId('req', db.requests.map(r => r.id))
    const workOrder: WorkOrder = {
      id: nextPortalId('wo', db.workOrders.map(w => w.id)), siteId, kind: 'recovery', status: 'scheduled', scheduledFor: recoveryOn, requestId,
    }
    const item = serviceItemsForSite(db, siteId).find(i => i.status === 'active')
    if (item) {
      workOrder.serviceItemId = item.id
      if (item.containerIds[0]) workOrder.containerId = item.containerIds[0]
    }
    const request: Request = {
      id: requestId, accountId, siteId, kind: 'missedPickup', status: 'scheduled', createdVia: 'portal', workOrderId: workOrder.id,
      note: `Missed pickup on ${lookup.date} (${event.id}, driver note: ${event.note ?? 'none'}), recovery on ${recoveryOn}`,
    }
    get().mutateDb(d => ({ ...d, requests: [...d.requests, request], workOrders: [...d.workOrders, workOrder] }), s => ({
      portalLog: [...s.portalLog, entry('addRequest', [request.id]), entry('addWorkOrder', [workOrder.id])],
    }))
    return { workOrder, request }
  },

  portalSubmitQuoteRequest(input) {
    const state = get()
    const id = nextPortalId('quote', [...state.quoteRequests.map(q => q.id), ...state.db.quotes.map(q => q.id)])
    const row: QuoteRequest = { ...input, id, quote: { ...input.quote, id } }
    set(s => ({
      quoteRequests: [...s.quoteRequests, row],
      portalLog: [...s.portalLog, entry('stub:submitQuoteRequest', [row.id, row.siteId, row.requestId])],
    }))
    return row
  },

  portalRequestQuote(input) {
    const db = get().db
    const { accountId, siteId, catalogId, qty, frequency, material } = input
    const site = requireSiteOn(db, siteId, accountId)
    const cat = db.catalog.find(c => c.id === catalogId)
    if (!cat || cat.lob !== 'frontload') throw new Error(`${catalogId} is not a front load container`)
    if (!Number.isInteger(qty) || qty < 1) throw new Error('Quantity must be a whole number of at least 1')
    const followUpBy = nextBusinessDay10am(today())
    // Mint the request id first so the quote draft and the request can name each other.
    const requestId = nextPortalId('req', db.requests.map(r => r.id))
    const draft: Omit<Quote, 'id'> = {
      kind: 'commercialRequest', address: site.address, zoneId: site.zoneId,
      lines: [{ catalogId, qty, frequency, priceCents: 0 }],
      dueTodayCents: 0, recurringCents: 0, status: 'draft',
      expiresAt: `${addDays(today(), 30)}T23:59:59`,
      // Quote.createdVia has no portal value; agent is the closest non-storefront channel (portal DECISIONS.md 44).
      createdVia: 'agent',
    }
    const qrInput: SubmitQuoteRequestInput = { quote: draft, accountId, siteId, material, requestId, followUpBy }
    const notes = input.accessNotes?.trim()
    if (notes) qrInput.accessNotes = notes
    const quoteRequest = get().portalSubmitQuoteRequest(qrInput)
    const request = get().portalAddRequest({
      id: requestId, accountId, siteId, kind: 'quote', status: 'open', createdVia: 'portal',
      note: `Quote ${quoteRequest.id}: ${qty} x ${cat.name}, ${material}, ${frequency}. Priced by a person by ${followUpBy}`,
    })
    return { quoteRequest, request }
  },
})
