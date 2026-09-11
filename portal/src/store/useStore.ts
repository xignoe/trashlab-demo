// One zustand store: every seed table as an array keyed like a Postgres table, the portal session, and a
// mutation log. Mutations are methods on the store and every one of them appends to the log. Locked invoices
// and posted charges are never mutated; the guards below throw instead of silently editing them.

import { create } from 'zustand';
import type {
  BillingAccount, Charge, Invoice, Payment, PaymentAllocation, Quote, Request, ServiceItem, WorkOrder,
} from '../types';
import { seed } from '../seed';
import { allocate, bindTables, checkHoldPolicy, nextCycleStart, type Tables } from './engine';
import { newId } from './ids';
import {
  sitesForAccount, invoiceOpenBalance, holdableServiceItems, routeForSite, missedPickupLookup, serviceItemsForSite,
  type QuoteMaterial,
} from './selectors';
import { TODAY, addDays, nextBusinessDay10am, nextRouteDay } from './clock';
import type { PaymentMethodKind } from '../lib/paymentToken';

export interface Session {
  accountId: string;
  siteId: string;
}

export interface LogEntry {
  at: string;
  action: string;
  ids: string[];
}

/**
 * Portal-local table (DECISIONS.md entry 25). The contract only records `paymentMethodOnFile: 'card' | 'ach'`
 * on the account; the portal needs a last four and a processor token to show and charge a saved method.
 * One row per account. Never holds a card number, expiry, CVC, or bank account number.
 */
export interface PaymentMethod {
  accountId: string;
  kind: PaymentMethodKind;
  last4: string;
  tokenId: string;
  brand: string;
  savedAt: string;
}

const SEED_PAYMENT_METHODS: PaymentMethod[] = [
  { accountId: 'acct_res_maple', kind: 'card', last4: '4242', tokenId: 'tok_seed_maple', brand: 'Visa', savedAt: '2026-04-09T14:20:00' },
  { accountId: 'acct_pm_oakridge', kind: 'ach', last4: '6710', tokenId: 'tok_seed_oakridge', brand: 'Checking', savedAt: '2025-11-03T10:00:00' },
  { accountId: 'acct_res_holt', kind: 'card', last4: '1881', tokenId: 'tok_seed_holt', brand: 'Mastercard', savedAt: '2026-01-12T08:30:00' },
  { accountId: 'acct_ro_homeowner', kind: 'card', last4: '0093', tokenId: 'tok_seed_ro', brand: 'Visa', savedAt: '2026-08-07T16:45:00' },
];

/**
 * Portal-local table (DECISIONS.md entry 5 and 33). ServiceItem has status held but no hold dates, so the
 * requested range lives here, one row per held service item.
 */
export interface Hold {
  id: string;
  serviceItemId: string;
  start: string;
  end: string;
}

/**
 * Portal-local table (DECISIONS.md, Phase 4). OWNERSHIP.md: a portal cart change is a Request that account turns
 * into a ServiceItem change, so the portal never ends or adds a ServiceItem. proposeCartChange() records the
 * proposal here: which item changes, to what catalog item, from which date, and the swap order and request.
 */
export interface PendingChange {
  id: string;
  serviceItemId: string;
  fromCatalogId: string;
  toCatalogId: string;
  /** Next cycle start: hauler proration is none, so the new size bills from here. */
  effectiveFrom: string;
  requestId: string;
  workOrderId: string;
}

/** What requestServiceItemHold() hands to account: the items to hold and the range. The portal writes nothing on ServiceItem. */
export interface ServiceItemHoldRequest {
  accountId: string;
  serviceItemIds: string[];
  start: string;
  end: string;
}

export interface BookExtraPickupInput {
  accountId: string;
  siteId: string;
  /** The Charge from computeCharge for the extra pickup, still status proposed. */
  charge: Charge;
  method: Payment['method'];
  /** Next route day for the site. */
  scheduledFor: string;
  serviceItemId?: string;
  containerId?: string;
}

export interface PlaceHoldInput {
  accountId: string;
  siteId: string;
  start: string;
  end: string;
}

export interface ChangeCartInput {
  accountId: string;
  siteId: string;
  /** The active cart ServiceItem being replaced. */
  serviceItemId: string;
  /** The catalog id of the new cart size. */
  toCatalogId: string;
}

export interface RecordPaymentInput {
  accountId: string;
  method: Payment['method'];
  /** Which invoices to pay and how much of each, in order. */
  invoiceIds: string[];
  cents: number[];
  processorBatchId?: string;
}

/**
 * Portal-local table (DECISIONS.md, Phase 5). OWNERSHIP.md: storefront and pricing write Quote, so the portal never
 * adds a row to quotes. submitQuoteRequest() records a Quote-shaped draft here, next to the portal context the
 * Quote type has no field for (site, material, access notes), for pricing to pick up at the merge.
 */
export interface QuoteRequest {
  /** The same id as quote.id. */
  id: string;
  quote: Quote;
  accountId: string;
  siteId: string;
  material: QuoteMaterial;
  accessNotes?: string;
  requestId: string;
  /** When a person promises to send the priced quote: next business day, 10:00. */
  followUpBy: string;
}

export interface RequestQuoteInput {
  accountId: string;
  siteId: string;
  catalogId: string;
  qty: number;
  frequency: Quote['lines'][number]['frequency'];
  material: QuoteMaterial;
  accessNotes?: string;
}

export interface ReportMissedPickupInput {
  accountId: string;
  siteId: string;
  /** The route day the customer says was missed. */
  date: string;
}

export interface PortalState extends Tables {
  session: Session;
  log: LogEntry[];
  paymentMethods: PaymentMethod[];
  holds: Hold[];
  pendingChanges: PendingChange[];
  quoteRequests: QuoteRequest[];

  switchAccount(accountId: string): void;
  setSite(siteId: string): void;

  addRequest(input: Omit<Request, 'id'> & { id?: string }): Request;
  updateRequest(id: string, patch: Partial<Omit<Request, 'id' | 'accountId'>>): Request;
  addWorkOrder(input: Omit<WorkOrder, 'id'> & { id?: string }): WorkOrder;
  addPayment(input: Omit<Payment, 'id'> & { id?: string }): Payment;
  addAllocations(allocations: PaymentAllocation[]): PaymentAllocation[];
  addCharge(charge: Charge): Charge;
  setAutopay(accountId: string, autopay: boolean): void;
  setPaymentMethod(accountId: string, method: BillingAccount['paymentMethodOnFile']): void;
  /** Saves (or replaces) the account's tokenized method and keeps BillingAccount.paymentMethodOnFile in step. */
  savePaymentMethod(input: Omit<PaymentMethod, 'savedAt'>): PaymentMethod;
  /** Payment plus allocations in one step, then re-derives the account status. Throws before writing if any allocation is bad. */
  recordPayment(input: RecordPaymentInput): { payment: Payment; allocations: PaymentAllocation[] };
  /** pastDue becomes active once no invoice is past due; active becomes pastDue when one is. Suspended and hold are office calls. */
  refreshAccountStatus(accountId: string): BillingAccount['status'];
  updateServiceItem(id: string, patch: Partial<Omit<ServiceItem, 'id' | 'siteId'>>): ServiceItem;
  addServiceItem(input: Omit<ServiceItem, 'id'> & { id?: string }): ServiceItem;
  addQuote(input: Omit<Quote, 'id'> & { id?: string }): Quote;
  updateInvoice(id: string, patch: Partial<Omit<Invoice, 'id' | 'accountId'>>): Invoice;
  updateCharge(id: string, patch: Partial<Omit<Charge, 'id' | 'accountId'>>): Charge;
  addHold(input: Omit<Hold, 'id'> & { id?: string }): Hold;
  /** Office statuses (hold, suspended) are set here by the flows that own them; payments never touch them. */
  setAccountStatus(accountId: string, status: BillingAccount['status']): void;
  /** Prepaid extra pickup: approved Charge, settled Payment (no allocation), scheduled Request and WorkOrder. */
  bookExtraPickup(input: BookExtraPickupInput): { charge: Charge; payment: Payment; request: Request; workOrder: WorkOrder };
  /**
   * Stub for an owned write (OWNERSHIP.md: account owns ServiceItem status and account status). Records only a log
   * entry naming the items and range so the merge can route it to account; never touches ServiceItem or BillingAccount.
   */
  requestServiceItemHold(input: ServiceItemHoldRequest): ServiceItemHoldRequest;
  /**
   * Stub for an owned write (OWNERSHIP.md: account turns a cart change Request into a ServiceItem change). Records the
   * proposal in the portal-local pendingChanges table; never ends or adds a ServiceItem.
   */
  proposeCartChange(input: Omit<PendingChange, 'id'>): PendingChange;
  /** Vacation hold: a holds row per active item, the stubbed ServiceItem hold, and a scheduled Request. */
  placeHold(input: PlaceHoldInput): { holds: Hold[]; request: Request };
  /** Cart size change with no proration: a scheduled Request, a swap WorkOrder on the next route day, and a pendingChanges row effective next cycle start. */
  changeCart(input: ChangeCartInput): { pendingChange: PendingChange; workOrder: WorkOrder; request: Request };
  /**
   * Missed pickup whose ServiceEvent outcome is missed: a recovery WorkOrder on the next business day and a scheduled
   * missedPickup Request linked to it. Throws for any other outcome, outside the window, or a day already reported.
   */
  reportMissedPickup(input: ReportMissedPickupInput): { workOrder: WorkOrder; request: Request };
  /**
   * Stub for an owned write (OWNERSHIP.md: storefront and pricing write Quote). Records a Quote-shaped draft in the
   * portal-local quoteRequests table; never adds a row to quotes.
   */
  submitQuoteRequest(input: Omit<QuoteRequest, 'id' | 'quote'> & { quote: Omit<Quote, 'id'> }): QuoteRequest;
  /** Commercial quote request: the stubbed Quote draft plus an open quote Request whose note names the quote id. */
  requestQuote(input: RequestQuoteInput): { quoteRequest: QuoteRequest; request: Request };
}

export const DEFAULT_ACCOUNT_ID = 'acct_res_maple';

/** Wall-clock time on the fixed portal date, so the log is ordered but every date still agrees with TODAY. */
export function nowISO(): string {
  const t = new Date();
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  const ss = String(t.getSeconds()).padStart(2, '0');
  return `${TODAY}T${hh}:${mm}:${ss}`;
}

function firstSiteId(tablesLike: Tables, accountId: string): string {
  const sites = sitesForAccount(tablesLike, accountId);
  if (sites.length === 0) throw new Error(`Account ${accountId} has no sites`);
  return sites[0].id;
}

/** Deep-ish copy of the seed so store mutations never touch the imported JSON. */
function freshTables(): Tables {
  return JSON.parse(JSON.stringify(seed)) as Tables;
}

export function createPortalStore(initial: Tables = freshTables()) {
  return create<PortalState>()((set, get) => {
    const log = (action: string, ids: string[]) =>
      set((s) => ({ log: [...s.log, { at: nowISO(), action, ids }] }));

    return {
      ...initial,
      session: { accountId: DEFAULT_ACCOUNT_ID, siteId: firstSiteId(initial, DEFAULT_ACCOUNT_ID) },
      log: [],
      paymentMethods: SEED_PAYMENT_METHODS.map((m) => ({ ...m })),
      holds: [],
      pendingChanges: [],
      quoteRequests: [],

      switchAccount(accountId) {
        const s = get();
        if (!s.accounts.some((a) => a.id === accountId)) throw new Error(`Unknown account ${accountId}`);
        set({ session: { accountId, siteId: firstSiteId(s, accountId) } });
      },

      setSite(siteId) {
        const s = get();
        const site = s.sites.find((x) => x.id === siteId);
        if (!site) throw new Error(`Unknown site ${siteId}`);
        if (site.accountId !== s.session.accountId) throw new Error(`Site ${siteId} is not on the signed-in account`);
        set({ session: { ...s.session, siteId } });
      },

      addRequest(input) {
        const row: Request = { ...input, id: input.id ?? newId('req') };
        set((s) => ({ requests: [...s.requests, row] }));
        log('addRequest', [row.id]);
        return row;
      },

      updateRequest(id, patch) {
        const s = get();
        const existing = s.requests.find((r) => r.id === id);
        if (!existing) throw new Error(`Unknown request ${id}`);
        const row: Request = { ...existing, ...patch };
        set({ requests: s.requests.map((r) => (r.id === id ? row : r)) });
        log('updateRequest', [id]);
        return row;
      },

      addWorkOrder(input) {
        const row: WorkOrder = { ...input, id: input.id ?? newId('wo') };
        set((s) => ({ workOrders: [...s.workOrders, row] }));
        log('addWorkOrder', [row.id]);
        return row;
      },

      addPayment(input) {
        const row: Payment = { ...input, id: input.id ?? newId('pay') };
        set((s) => ({ payments: [...s.payments, row] }));
        log('addPayment', [row.id]);
        return row;
      },

      addAllocations(allocations) {
        if (allocations.length === 0) return [];
        set((s) => ({ allocations: [...s.allocations, ...allocations] }));
        log('addAllocations', allocations.map((a) => `${a.sourceId}->${a.invoiceId}:${a.cents}`));
        return allocations;
      },

      addCharge(charge) {
        if (charge.status === 'posted') throw new Error('The portal cannot create posted charges; posting is an office action');
        set((s) => ({ charges: [...s.charges, charge] }));
        log('addCharge', [charge.id]);
        return charge;
      },

      setAutopay(accountId, autopay) {
        const s = get();
        if (!s.accounts.some((a) => a.id === accountId)) throw new Error(`Unknown account ${accountId}`);
        set({ accounts: s.accounts.map((a) => (a.id === accountId ? { ...a, autopay } : a)) });
        log(autopay ? 'setAutopay:on' : 'setAutopay:off', [accountId]);
      },

      setPaymentMethod(accountId, method) {
        const s = get();
        if (!s.accounts.some((a) => a.id === accountId)) throw new Error(`Unknown account ${accountId}`);
        set({
          accounts: s.accounts.map((a) => {
            if (a.id !== accountId) return a;
            const next = { ...a };
            if (method === undefined) delete next.paymentMethodOnFile;
            else next.paymentMethodOnFile = method;
            return next;
          }),
        });
        log('setPaymentMethod', [accountId, method ?? 'none']);
      },

      savePaymentMethod(input) {
        const s = get();
        if (!s.accounts.some((a) => a.id === input.accountId)) throw new Error(`Unknown account ${input.accountId}`);
        if (!/^tok_/.test(input.tokenId)) throw new Error('A payment method must be saved from a processor token');
        if (!/^\d{4}$/.test(input.last4)) throw new Error('last4 must be four digits');
        const row: PaymentMethod = { ...input, savedAt: nowISO() };
        set({
          paymentMethods: [...s.paymentMethods.filter((m) => m.accountId !== input.accountId), row],
          accounts: s.accounts.map((a) => (a.id === input.accountId ? { ...a, paymentMethodOnFile: input.kind } : a)),
        });
        log('savePaymentMethod', [input.accountId, input.tokenId, `${input.kind}:${input.last4}`]);
        return row;
      },

      recordPayment(input) {
        const s = get();
        const total = input.cents.reduce((sum, c) => sum + c, 0);
        if (total <= 0) throw new Error('A payment must be for a positive amount');
        const paymentId = newId('pay');
        // Validate every allocation against the live open balances before anything is written.
        const allocations = allocate({ sourceType: 'payment', sourceId: paymentId, invoiceIds: input.invoiceIds, cents: input.cents });
        for (const id of input.invoiceIds) {
          const inv = s.invoices.find((i) => i.id === id);
          if (inv?.accountId !== input.accountId) throw new Error(`Invoice ${id} is not on account ${input.accountId}`);
        }
        const payment: Payment = {
          id: paymentId, accountId: input.accountId, method: input.method, cents: total, receivedAt: nowISO(), status: 'settled',
        };
        if (input.processorBatchId) payment.processorBatchId = input.processorBatchId;
        s.addPayment(payment);
        s.addAllocations(allocations);
        get().refreshAccountStatus(input.accountId);
        return { payment, allocations };
      },

      refreshAccountStatus(accountId) {
        const s = get();
        const account = s.accounts.find((a) => a.id === accountId);
        if (!account) throw new Error(`Unknown account ${accountId}`);
        if (account.status === 'suspended' || account.status === 'hold') return account.status;
        const anyPastDue = s.invoices.some(
          (i) => i.accountId === accountId && i.dueAt.slice(0, 10) < TODAY && invoiceOpenBalance(s, i.id) > 0,
        );
        const next: BillingAccount['status'] = anyPastDue ? 'pastDue' : 'active';
        if (next !== account.status) {
          set({ accounts: s.accounts.map((a) => (a.id === accountId ? { ...a, status: next } : a)) });
          log(`accountStatus:${account.status}->${next}`, [accountId]);
        }
        return next;
      },

      updateServiceItem(id, patch) {
        const s = get();
        const existing = s.serviceItems.find((i) => i.id === id);
        if (!existing) throw new Error(`Unknown service item ${id}`);
        const row: ServiceItem = { ...existing, ...patch };
        set({ serviceItems: s.serviceItems.map((i) => (i.id === id ? row : i)) });
        log('updateServiceItem', [id]);
        return row;
      },

      addServiceItem(input) {
        const row: ServiceItem = { ...input, id: input.id ?? newId('si') };
        set((s) => ({ serviceItems: [...s.serviceItems, row] }));
        log('addServiceItem', [row.id]);
        return row;
      },

      addQuote(input) {
        const row: Quote = { ...input, id: input.id ?? newId('quote') };
        set((s) => ({ quotes: [...s.quotes, row] }));
        log('addQuote', [row.id]);
        return row;
      },

      updateInvoice(id, patch) {
        const s = get();
        const existing = s.invoices.find((i) => i.id === id);
        if (!existing) throw new Error(`Unknown invoice ${id}`);
        if (existing.locked) throw new Error(`Invoice ${id} is posted and locked; corrections are credit memos, never edits`);
        const row: Invoice = { ...existing, ...patch };
        set({ invoices: s.invoices.map((i) => (i.id === id ? row : i)) });
        log('updateInvoice', [id]);
        return row;
      },

      updateCharge(id, patch) {
        const s = get();
        const existing = s.charges.find((c) => c.id === id);
        if (!existing) throw new Error(`Unknown charge ${id}`);
        if (existing.status === 'posted') throw new Error(`Charge ${id} is posted and cannot change`);
        const row: Charge = { ...existing, ...patch };
        set({ charges: s.charges.map((c) => (c.id === id ? row : c)) });
        log('updateCharge', [id]);
        return row;
      },

      addHold(input) {
        const row: Hold = { ...input, id: input.id ?? newId('hold') };
        set((s) => ({ holds: [...s.holds, row] }));
        log('addHold', [row.id, row.serviceItemId, `${row.start}..${row.end}`]);
        return row;
      },

      setAccountStatus(accountId, status) {
        const s = get();
        const account = s.accounts.find((a) => a.id === accountId);
        if (!account) throw new Error(`Unknown account ${accountId}`);
        if (account.status === status) return;
        set({ accounts: s.accounts.map((a) => (a.id === accountId ? { ...a, status } : a)) });
        log(`accountStatus:${account.status}->${status}`, [accountId]);
      },

      bookExtraPickup(input) {
        const s = get();
        const { accountId, siteId, charge, method, scheduledFor } = input;
        if (charge.accountId !== accountId || charge.siteId !== siteId) throw new Error('Charge does not belong to this account and site');
        if (charge.status !== 'proposed') throw new Error('Only a proposed charge can be booked');
        if (charge.totalCents <= 0) throw new Error('An extra pickup must have a positive total');
        // The Charge is approved by the customer paying it in full up front; the office posts it on the next invoice run.
        const approved: Charge = { ...charge, status: 'approved' };
        s.addCharge(approved);
        // A prepaid Payment with no allocation: there is no invoice yet, so it shows as not yet applied in payment history.
        const payment = s.addPayment({ accountId, method, cents: approved.totalCents, receivedAt: nowISO(), status: 'settled' });
        const request = s.addRequest({
          accountId, siteId, kind: 'extraPickup', status: 'scheduled', createdVia: 'portal',
          note: `Extra pickup on ${scheduledFor}, prepaid ${payment.id}, charge ${approved.id}`,
        });
        const wo: Omit<WorkOrder, 'id'> = { siteId, kind: 'extraPickup', status: 'scheduled', scheduledFor, requestId: request.id };
        if (input.serviceItemId) wo.serviceItemId = input.serviceItemId;
        if (input.containerId) wo.containerId = input.containerId;
        const workOrder = s.addWorkOrder(wo);
        const linked = s.updateRequest(request.id, { workOrderId: workOrder.id });
        return { charge: approved, payment, request: linked, workOrder };
      },

      requestServiceItemHold(input) {
        log('stub:requestServiceItemHold', [input.accountId, ...input.serviceItemIds, `${input.start}..${input.end}`]);
        return { ...input, serviceItemIds: [...input.serviceItemIds] };
      },

      proposeCartChange(input) {
        const s = get();
        if (s.pendingChanges.some((p) => p.serviceItemId === input.serviceItemId)) {
          throw new Error(`Service item ${input.serviceItemId} already has a pending change`);
        }
        const row: PendingChange = { ...input, id: newId('chgreq') };
        set((st) => ({ pendingChanges: [...st.pendingChanges, row] }));
        log('stub:proposeCartChange', [row.id, row.serviceItemId, `${row.fromCatalogId}->${row.toCatalogId}@${row.effectiveFrom}`]);
        return row;
      },

      placeHold(input) {
        const s = get();
        const { accountId, siteId, start, end } = input;
        const site = s.sites.find((x) => x.id === siteId);
        if (!site || site.accountId !== accountId) throw new Error(`Site ${siteId} is not on account ${accountId}`);
        const policy = checkHoldPolicy(start, end, TODAY);
        if (!policy.ok) throw new Error(policy.reason);
        const active = holdableServiceItems(s, siteId, TODAY);
        if (active.length === 0) throw new Error('No active service at this site to hold');
        // Portal-local rows only. The ServiceItem status change and any account status change are account's writes.
        const holds = active.map((item) => s.addHold({ serviceItemId: item.id, start, end }));
        s.requestServiceItemHold({ accountId, serviceItemIds: active.map((i) => i.id), start, end });
        const route = routeForSite(s, siteId);
        const resumes = route ? nextRouteDay(route.day, end) : addDays(end, 1);
        const request = s.addRequest({
          accountId, siteId, kind: 'vacationHold', status: 'scheduled', createdVia: 'portal',
          note: `Vacation hold ${start} to ${end}, pickups resume ${resumes}`,
        });
        return { holds, request };
      },

      changeCart(input) {
        const s = get();
        const { accountId, siteId, serviceItemId, toCatalogId } = input;
        const account = s.accounts.find((a) => a.id === accountId);
        if (!account) throw new Error(`Unknown account ${accountId}`);
        const current = s.serviceItems.find((i) => i.id === serviceItemId);
        if (!current || current.siteId !== siteId) throw new Error(`Service item ${serviceItemId} is not at site ${siteId}`);
        if (current.status !== 'active') throw new Error('Only an active service can change size');
        if (current.catalogId === toCatalogId) throw new Error('That is already the current cart size');
        if (!s.catalog.some((c) => c.id === toCatalogId)) throw new Error(`Unknown catalog item ${toCatalogId}`);
        if (s.pendingChanges.some((p) => p.serviceItemId === serviceItemId)) throw new Error('This cart already has a pending change');
        const route = routeForSite(s, siteId);
        if (!route) throw new Error('No route serves this site');
        const effectiveFrom = nextCycleStart(account, TODAY);
        const swapDay = nextRouteDay(route.day, TODAY);
        const request = s.addRequest({
          accountId, siteId, kind: 'cartChange', status: 'scheduled', createdVia: 'portal',
          note: `Change ${current.catalogId} to ${toCatalogId}, effective ${effectiveFrom}, cart swap on ${swapDay}`,
        });
        const wo: Omit<WorkOrder, 'id'> = { siteId, kind: 'swap', status: 'scheduled', scheduledFor: swapDay, serviceItemId: current.id, requestId: request.id };
        if (current.containerIds[0]) wo.containerId = current.containerIds[0];
        const workOrder = s.addWorkOrder(wo);
        const linked = s.updateRequest(request.id, { workOrderId: workOrder.id });
        const pendingChange = get().proposeCartChange({
          serviceItemId: current.id, fromCatalogId: current.catalogId, toCatalogId, effectiveFrom, requestId: request.id, workOrderId: workOrder.id,
        });
        return { pendingChange, workOrder, request: linked };
      },

      reportMissedPickup(input) {
        const s = get();
        const { accountId, siteId, date } = input;
        const site = s.sites.find((x) => x.id === siteId);
        if (!site || site.accountId !== accountId) throw new Error(`Site ${siteId} is not on account ${accountId}`);
        const lookup = missedPickupLookup(s, siteId, date, TODAY);
        if (lookup.existing) throw new Error(`Already reported as ${lookup.existing.id}`);
        if (lookup.kind !== 'missed') throw new Error(`No recovery for a ${lookup.kind} lookup on ${lookup.date}`);
        const { event, recoveryOn } = lookup;
        const request = s.addRequest({
          accountId, siteId, kind: 'missedPickup', status: 'scheduled', createdVia: 'portal',
          note: `Missed pickup on ${lookup.date} (${event.id}, driver note: ${event.note ?? 'none'}), recovery on ${recoveryOn}`,
        });
        const wo: Omit<WorkOrder, 'id'> = { siteId, kind: 'recovery', status: 'scheduled', scheduledFor: recoveryOn, requestId: request.id };
        const item = serviceItemsForSite(s, siteId).find((i) => i.status === 'active');
        if (item) {
          wo.serviceItemId = item.id;
          if (item.containerIds[0]) wo.containerId = item.containerIds[0];
        }
        const workOrder = s.addWorkOrder(wo);
        return { workOrder, request: s.updateRequest(request.id, { workOrderId: workOrder.id }) };
      },

      submitQuoteRequest(input) {
        const quote: Quote = { ...input.quote, id: newId('quote') };
        const row: QuoteRequest = { ...input, id: quote.id, quote };
        set((st) => ({ quoteRequests: [...st.quoteRequests, row] }));
        log('stub:submitQuoteRequest', [row.id, row.siteId, row.requestId]);
        return row;
      },

      requestQuote(input) {
        const s = get();
        const { accountId, siteId, catalogId, qty, frequency, material } = input;
        const site = s.sites.find((x) => x.id === siteId);
        if (!site || site.accountId !== accountId) throw new Error(`Site ${siteId} is not on account ${accountId}`);
        const cat = s.catalog.find((c) => c.id === catalogId);
        if (!cat || cat.lob !== 'frontload') throw new Error(`${catalogId} is not a front load container`);
        if (!Number.isInteger(qty) || qty < 1) throw new Error('Quantity must be a whole number of at least 1');
        const followUpBy = nextBusinessDay10am(TODAY);
        // Mint the request id first so the quote draft and the request can name each other.
        const requestId = newId('req');
        const draft: Omit<Quote, 'id'> = {
          kind: 'commercialRequest', address: site.address, zoneId: site.zoneId,
          lines: [{ catalogId, qty, frequency, priceCents: 0 }],
          dueTodayCents: 0, recurringCents: 0, status: 'draft',
          expiresAt: `${addDays(TODAY, 30)}T23:59:59`,
          // The createdVia union has no portal value; agent is the closest non-storefront channel (DECISIONS.md).
          createdVia: 'agent',
        };
        const qrInput: Parameters<PortalState['submitQuoteRequest']>[0] = { quote: draft, accountId, siteId, material, requestId, followUpBy };
        const notes = input.accessNotes?.trim();
        if (notes) qrInput.accessNotes = notes;
        const quoteRequest = s.submitQuoteRequest(qrInput);
        const request = get().addRequest({
          id: requestId, accountId, siteId, kind: 'quote', status: 'open', createdVia: 'portal',
          note: `Quote ${quoteRequest.id}: ${qty} x ${cat.name}, ${material}, ${frequency}. Priced by a person by ${followUpBy}`,
        });
        return { quoteRequest, request };
      },
    };
  });
}

export const useStore = createPortalStore();

// The engine reads live tables from this store from here on, so a portal mutation (a new work order, a new
// allocation) is visible to the next resolvePrice, computeCharge, or allocate call.
bindTables(() => useStore.getState());
