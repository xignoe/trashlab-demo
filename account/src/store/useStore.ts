import { create } from 'zustand';
import { seed, type EventRates, type SeedData } from '../seed';
import type {
  BillingAccount, Charge, Container, Contract, CreditMemo, FeeRule, Hauler, Invoice, Party, Payment,
  PaymentAllocation, ProcessorBatch, Quote, RateVersion, Request, Route, ScaleTicket, ServiceCatalog,
  ServiceEvent, ServiceItem, Site, TaxRule, WaivedCharge, WorkOrder, Zone,
} from '../types';
import { TODAY } from './clock';
import {
  allocate as engineAllocate,
  buildReinstatementFee,
  itemStatusForAccountStatus,
  newId,
  planServiceChange,
  postInvoices as enginePostInvoices,
  statusAfterReinstatement,
  withRows,
  type AllocateArgs,
  type OfficeRequestDraft,
  type ServiceChangeArgs,
  type ServiceChangePlan,
} from './engine';

/** Keyed collection: lookup by id plus insertion order for stable rendering. */
export interface Collection<T> {
  byId: Record<string, T>;
  ids: string[];
}

export function toCollection<T extends { id: string }>(rows: T[]): Collection<T> {
  const byId: Record<string, T> = {};
  const ids: string[] = [];
  for (const row of rows) {
    if (!(row.id in byId)) ids.push(row.id);
    byId[row.id] = row;
  }
  return { byId, ids };
}

export function listOf<T>(c: Collection<T>): T[] {
  return c.ids.map((id) => c.byId[id]);
}

/** The data half of the store. Engine functions are pure over this shape, so a shadow copy works as well as the live store. */
export interface EntityState {
  haulers: Collection<Hauler>;
  parties: Collection<Party>;
  billingAccounts: Collection<BillingAccount>;
  sites: Collection<Site>;
  zones: Collection<Zone>;
  routes: Collection<Route>;
  serviceCatalog: Collection<ServiceCatalog>;
  containers: Collection<Container>;
  serviceItems: Collection<ServiceItem>;
  rateVersions: Collection<RateVersion>;
  feeRules: Collection<FeeRule>;
  taxRules: Collection<TaxRule>;
  contracts: Collection<Contract>;
  quotes: Collection<Quote>;
  workOrders: Collection<WorkOrder>;
  serviceEvents: Collection<ServiceEvent>;
  scaleTickets: Collection<ScaleTicket>;
  charges: Collection<Charge>;
  /** Keyed by chargeId (the contract gives WaivedCharge no id of its own). Append-only, no delete action exists (invariant 5). */
  waivedCharges: Collection<WaivedCharge & { id: string }>;
  invoices: Collection<Invoice>;
  creditMemos: Collection<CreditMemo>;
  payments: Collection<Payment>;
  /** Append-only list; the contract gives PaymentAllocation no id and one source may hit one invoice more than once. */
  paymentAllocations: PaymentAllocation[];
  processorBatches: Collection<ProcessorBatch>;
  requests: Collection<Request>;
  /** Cents per priced ServiceEvent exception, from src/seed/eventRates.json (addendum B4). generateEventCharges reads it. */
  eventRates: EventRates;
}

/**
 * A customer request the office took (by phone, usually) and acted on. Surface-local: Portal owns
 * Request rows (shared/OWNERSHIP.md), so the account surface records its side here instead of in
 * `requests`, and the open items panel lists each note beside the WorkOrder it produced. Not part
 * of the merge store (addendum B3).
 */
export interface OfficeNote extends OfficeRequestDraft {
  id: string;
  at: string;
}

/**
 * A money write the office made in this session that the stub QuickBooks sync has not picked up yet: a new
 * Payment, a new CreditMemo, or a new set of PaymentAllocations. Surface-local, like officeNotes: the QuickBooks
 * chip reads it so an allocation of an older payment (whose receivedAt predates the last sync) still goes stale.
 */
export interface LedgerWrite {
  id: string;
  accountId: string;
  kind: 'payment' | 'creditMemo' | 'allocation';
  /** The Payment or CreditMemo written or allocated. */
  sourceId: string;
  cents: number;
  at: string;
}

/** Why the office suspended an account (Phase 6). The contract gives BillingAccount no reason field. */
export type SuspensionReason = 'nonPayment' | 'customerRequest';

/**
 * One account status change the office made in this session (Phase 6): hold, suspend, resume, or reinstate.
 * Surface-local, like officeNotes: BillingAccount has no field for the reason, the effective date, or the resume
 * date, so they live here. A reinstatement fee names its status change as the Charge's manual source id.
 */
export interface StatusChange {
  id: string;
  accountId: string;
  kind: 'hold' | 'suspend' | 'resume' | 'reinstate';
  from: BillingAccount['status'];
  to: BillingAccount['status'];
  effectiveFrom: string;
  /** Holds only: the date service resumes. */
  resumeOn?: string;
  /** Suspensions only. */
  reason?: SuspensionReason;
  note?: string;
  /** ServiceItems flipped between active and held by this change. */
  itemIds: string[];
  at: string;
}

/** Surface-local sidecars kept next to the contract entities. Engine functions never read these. */
export interface SidecarState {
  officeNotes: OfficeNote[];
  ledgerWrites: LedgerWrite[];
  /**
   * Charges the account surface proposes but may not write (billing owns the Charge table, shared/OWNERSHIP.md):
   * today only the reinstatement fee, built by computeCharge with status proposed. The next-run panel lists them and
   * the billing sync chip goes stale while any exist for the account.
   */
  proposedCharges: Charge[];
  statusChanges: StatusChange[];
}

export interface TakePaymentArgs {
  accountId: string;
  method: Payment['method'];
  cents: number;
  receivedAt?: string;
  /** Card reference or batch id; only meaningful for card payments. */
  processorBatchId?: string;
  /** Optional allocation applied in the same action; validated before anything is written. */
  allocations?: { invoiceIds: string[]; cents: number[] };
}

export interface IssueCreditMemoArgs {
  accountId: string;
  cents: number;
  reason: string;
  note?: string;
  /** When given, the credit is allocated against this invoice; otherwise it stays unapplied on the account. */
  invoiceId?: string;
  by?: string;
}

export interface SetAccountStatusOptions {
  /** Free text from the office, kept on the status change and (for holds) the vacationHold office note. */
  note?: string;
  /** For holds: the site the vacationHold note names (default the account's first site). */
  siteId?: string;
  createdVia?: Request['createdVia'];
  /** Default TODAY. */
  effectiveFrom?: string;
  /** Holds: the date service resumes. */
  resumeOn?: string;
  /** Suspensions: non-payment or customer request. */
  reason?: SuspensionReason;
}

export interface ReinstateResult {
  account: BillingAccount;
  statusChange: StatusChange;
  /** Present when the account was suspended: the proposed reinstatement fee now in the proposedCharges sidecar. */
  fee?: Charge;
}

export interface StoreActions {
  resetToSeed: () => void;
  /**
   * Closes the old item (effectiveTo, status ended; never deleted), inserts the new one, its container and a
   * WorkOrder, then records the office note through recordOfficeRequest(). Writes no Request. Returns the plan.
   */
  changeServiceItem: (args: ServiceChangeArgs) => ServiceChangePlan;
  /** Stub for the Request a portal would own: appends an OfficeNote to the surface-local sidecar. */
  recordOfficeRequest: (draft: OfficeRequestDraft) => OfficeNote;
  /**
   * Appends a Payment (settled for check and cash, pending for card and ach) and, when allocations are given, its
   * PaymentAllocations, validated by one engine allocate() call on a shadow state first: nothing is written on failure.
   */
  takePayment: (args: TakePaymentArgs) => Payment;
  /** Appends a CreditMemo and, when an invoice is chosen, allocates it. */
  issueCreditMemo: (args: IssueCreditMemoArgs) => CreditMemo;
  /**
   * Sets the account status and flips its non-ended ServiceItems between active and held (effective dates untouched),
   * then records a StatusChange. A hold records its vacationHold through recordOfficeRequest(); no Request is written.
   */
  setAccountStatus: (accountId: string, status: BillingAccount['status'], opts?: SetAccountStatusOptions) => BillingAccount;
  /**
   * Ends a hold or suspension: status back to pastDue when anything is past due, else active, items back to active.
   * A suspension's reinstatement also proposes the reinstatement fee through proposeReinstatementFee().
   */
  reinstateAccount: (accountId: string, opts?: { note?: string }) => ReinstateResult;
  /** Stub for the Charge billing would write: builds the reinstatement fee and appends it to the proposedCharges sidecar. */
  proposeReinstatementFee: (accountId: string, sourceId: string) => Charge;
  /** Validates with the engine and appends the allocations (and a ledgerWrites entry for the QuickBooks chip). */
  allocate: (args: AllocateArgs) => PaymentAllocation[];
  /** Builds locked invoices for the charges and marks them posted. */
  postInvoices: (args: { chargeIds: string[] }) => Invoice[];
  /** Appends proposed or approved charges produced by the engine (for example a reinstatement fee). */
  appendCharges: (charges: Charge[]) => void;
  /** Appends a WaivedCharge row and marks the charge waived. Rows are never removed. */
  waiveCharge: (args: { chargeId: string; reason: WaivedCharge['reason']; note?: string; by?: string }) => WaivedCharge;
  /** Moves an open WorkOrder to scheduled, or a scheduled one to done. Never removes it. */
  setWorkOrderStatus: (workOrderId: string, status: WorkOrder['status']) => WorkOrder;
}

export type StoreState = EntityState & SidecarState & StoreActions;

export function stateFromSeed(data: SeedData): EntityState {
  return {
    haulers: toCollection(data.haulers),
    parties: toCollection(data.parties),
    billingAccounts: toCollection(data.billingAccounts),
    sites: toCollection(data.sites),
    zones: toCollection(data.zones),
    routes: toCollection(data.routes),
    serviceCatalog: toCollection(data.serviceCatalog),
    containers: toCollection(data.containers),
    serviceItems: toCollection(data.serviceItems),
    rateVersions: toCollection(data.rateVersions),
    feeRules: toCollection(data.feeRules),
    taxRules: toCollection(data.taxRules),
    contracts: toCollection(data.contracts),
    quotes: toCollection(data.quotes),
    workOrders: toCollection(data.workOrders),
    serviceEvents: toCollection(data.serviceEvents),
    scaleTickets: toCollection(data.scaleTickets),
    charges: toCollection(data.charges),
    waivedCharges: toCollection(data.waivedCharges.map((w) => ({ ...w, id: w.chargeId }))),
    invoices: toCollection(data.invoices),
    creditMemos: toCollection(data.creditMemos),
    payments: toCollection(data.payments),
    paymentAllocations: [...data.paymentAllocations],
    processorBatches: toCollection(data.processorBatches),
    requests: toCollection(data.requests),
    eventRates: { ...data.eventRates },
  };
}

const ENTITY_KEYS: (keyof EntityState)[] = [
  'haulers', 'parties', 'billingAccounts', 'sites', 'zones', 'routes', 'serviceCatalog', 'containers', 'serviceItems',
  'rateVersions', 'feeRules', 'taxRules', 'contracts', 'quotes', 'workOrders', 'serviceEvents', 'scaleTickets', 'charges',
  'waivedCharges', 'invoices', 'creditMemos', 'payments', 'paymentAllocations', 'processorBatches', 'requests', 'eventRates',
];

/** Only the data keys of the store, so an engine call never sees or copies the action closures. */
export function entities(s: StoreState): EntityState {
  const out = {} as Record<keyof EntityState, unknown>;
  for (const k of ENTITY_KEYS) out[k] = s[k];
  return out as EntityState;
}

const sumCents = (rows: { cents: number }[]) => rows.reduce((s, r) => s + r.cents, 0);

function ledgerWrite(accountId: string, kind: LedgerWrite['kind'], sourceId: string, cents: number): LedgerWrite {
  return { id: newId('lw'), accountId, kind, sourceId, cents, at: TODAY };
}

export const useStore = create<StoreState>()((set, get) => ({
  ...stateFromSeed(seed),
  officeNotes: [],
  ledgerWrites: [],
  proposedCharges: [],
  statusChanges: [],

  resetToSeed: () => set({ ...stateFromSeed(seed), officeNotes: [], ledgerWrites: [], proposedCharges: [], statusChanges: [] }),

  changeServiceItem: (args) => {
    const state = entities(get());
    const plan = planServiceChange(args, state);
    set(withRows(state, {
      serviceItems: plan.oldItem ? [plan.oldItem, plan.newItem] : [plan.newItem],
      containers: [plan.container],
      workOrders: [plan.workOrder],
    }));
    get().recordOfficeRequest(plan.officeRequest);
    return plan;
  },

  recordOfficeRequest: (draft) => {
    const note: OfficeNote = { ...draft, id: newId('note'), at: TODAY };
    set({ officeNotes: [...get().officeNotes, note] });
    return note;
  },

  takePayment: (args) => {
    const state = entities(get());
    if (!state.billingAccounts.byId[args.accountId]) throw new Error(`BillingAccount ${args.accountId} not found`);
    if (!Number.isInteger(args.cents) || args.cents <= 0) throw new Error('Payment cents must be a positive whole number');
    const payment: Payment = {
      id: newId('pay'),
      accountId: args.accountId,
      method: args.method,
      cents: args.cents,
      receivedAt: args.receivedAt ?? TODAY,
      status: args.method === 'card' || args.method === 'ach' ? 'pending' : 'settled',
    };
    if (args.method === 'card' && args.processorBatchId) payment.processorBatchId = args.processorBatchId;
    // Validate the allocation against a shadow state that already holds the payment; nothing is written on failure.
    const shadow = withRows(state, { payments: [payment] });
    const allocations = args.allocations
      ? engineAllocate({ sourceType: 'payment', sourceId: payment.id, invoiceIds: args.allocations.invoiceIds, cents: args.allocations.cents }, shadow)
      : [];
    const writes = [ledgerWrite(args.accountId, 'payment', payment.id, payment.cents)];
    if (allocations.length) writes.push(ledgerWrite(args.accountId, 'allocation', payment.id, sumCents(allocations)));
    set({ ...withRows(state, { payments: [payment], paymentAllocations: allocations }), ledgerWrites: [...get().ledgerWrites, ...writes] });
    return payment;
  },

  issueCreditMemo: (args) => {
    const state = entities(get());
    if (!state.billingAccounts.byId[args.accountId]) throw new Error(`BillingAccount ${args.accountId} not found`);
    if (!Number.isInteger(args.cents) || args.cents <= 0) throw new Error('Credit cents must be a positive whole number');
    const memo: CreditMemo = {
      id: newId('cm'),
      accountId: args.accountId,
      invoiceId: args.invoiceId,
      cents: args.cents,
      reason: args.note ? `${args.reason}: ${args.note}` : args.reason,
      by: args.by ?? 'office',
      at: TODAY,
    };
    const shadow = withRows(state, { creditMemos: [memo] });
    const allocations = args.invoiceId
      ? engineAllocate({ sourceType: 'creditMemo', sourceId: memo.id, invoiceIds: [args.invoiceId], cents: [args.cents] }, shadow)
      : [];
    const writes = [ledgerWrite(args.accountId, 'creditMemo', memo.id, memo.cents)];
    if (allocations.length) writes.push(ledgerWrite(args.accountId, 'allocation', memo.id, sumCents(allocations)));
    set({ ...withRows(state, { creditMemos: [memo], paymentAllocations: allocations }), ledgerWrites: [...get().ledgerWrites, ...writes] });
    return memo;
  },

  setAccountStatus: (accountId, status, opts) => {
    const state = entities(get());
    const account = state.billingAccounts.byId[accountId];
    if (!account) throw new Error(`BillingAccount ${accountId} not found`);
    const effectiveFrom = opts?.effectiveFrom ?? TODAY;
    if (status === 'hold' && opts?.resumeOn && opts.resumeOn <= effectiveFrom) throw new Error('A hold must resume after it starts');
    const next: BillingAccount = { ...account, status };
    const siteIds = listOf(state.sites).filter((s) => s.accountId === accountId).map((s) => s.id);
    const itemStatus = itemStatusForAccountStatus(status);
    const items = listOf(state.serviceItems)
      .filter((si) => siteIds.includes(si.siteId) && si.status !== 'ended' && si.status !== itemStatus)
      .map((si): ServiceItem => ({ ...si, status: itemStatus }));
    const kind: StatusChange['kind'] =
      status === 'hold' ? 'hold' : status === 'suspended' ? 'suspend' : account.status === 'hold' ? 'resume' : 'reinstate';
    const change: StatusChange = {
      id: newId('sc'),
      accountId,
      kind,
      from: account.status,
      to: status,
      effectiveFrom,
      resumeOn: status === 'hold' ? opts?.resumeOn : undefined,
      reason: status === 'suspended' ? opts?.reason : undefined,
      note: opts?.note,
      itemIds: items.map((i) => i.id),
      at: TODAY,
    };
    set({ ...withRows(state, { billingAccounts: [next], serviceItems: items }), statusChanges: [...get().statusChanges, change] });
    // Portal owns Request rows (shared/OWNERSHIP.md): the phone vacationHold goes to the officeNotes sidecar.
    if (status === 'hold') {
      const window = opts?.resumeOn ? `from ${effectiveFrom}, resume ${opts.resumeOn}` : `from ${effectiveFrom}, no resume date`;
      get().recordOfficeRequest({
        kind: 'vacationHold',
        accountId,
        siteId: opts?.siteId ?? siteIds[0] ?? '',
        createdVia: opts?.createdVia ?? 'phone',
        note: opts?.note ? `Vacation hold ${window}. ${opts.note}` : `Vacation hold ${window}`,
      });
    }
    return next;
  },

  reinstateAccount: (accountId, opts) => {
    const before = get().billingAccounts.byId[accountId];
    if (!before) throw new Error(`BillingAccount ${accountId} not found`);
    if (before.status !== 'suspended' && before.status !== 'hold') throw new Error(`BillingAccount ${accountId} is ${before.status}, not on hold or suspended`);
    const target = statusAfterReinstatement(accountId, entities(get()));
    const account = get().setAccountStatus(accountId, target, { note: opts?.note });
    const changes = get().statusChanges;
    const statusChange = changes[changes.length - 1];
    const fee = before.status === 'suspended' ? get().proposeReinstatementFee(accountId, statusChange.id) : undefined;
    return { account, statusChange, fee };
  },

  proposeReinstatementFee: (accountId, sourceId) => {
    const fee = buildReinstatementFee({ accountId, sourceId }, entities(get()));
    set({ proposedCharges: [...get().proposedCharges, fee] });
    return fee;
  },

  allocate: (args) => {
    const state = entities(get());
    const rows = engineAllocate(args, state);
    const source = args.sourceType === 'payment' ? state.payments.byId[args.sourceId] : state.creditMemos.byId[args.sourceId];
    set({
      paymentAllocations: [...state.paymentAllocations, ...rows],
      ledgerWrites: [...get().ledgerWrites, ledgerWrite(source.accountId, 'allocation', args.sourceId, sumCents(rows))],
    });
    return rows;
  },

  postInvoices: (args) => {
    const state = entities(get());
    const invoices = enginePostInvoices(args, state);
    const posted = args.chargeIds.map((id): Charge => ({ ...state.charges.byId[id], status: 'posted' }));
    set(withRows(state, { invoices, charges: posted }));
    return invoices;
  },

  appendCharges: (charges) => {
    const state = entities(get());
    for (const c of charges) if (state.charges.byId[c.id]) throw new Error(`Charge ${c.id} already exists`);
    set(withRows(state, { charges }));
  },

  waiveCharge: ({ chargeId, reason, note, by }) => {
    const state = entities(get());
    const charge = state.charges.byId[chargeId];
    if (!charge) throw new Error(`Charge ${chargeId} not found`);
    if (charge.status === 'posted') throw new Error(`Charge ${chargeId} is posted; correct it with a CreditMemo`);
    if (state.waivedCharges.byId[chargeId]) throw new Error(`Charge ${chargeId} is already waived`);
    const row: WaivedCharge = { chargeId, reason, note, by: by ?? 'office', at: TODAY };
    const waivedCharges = toCollection([...listOf(state.waivedCharges), { ...row, id: chargeId }]);
    set({ ...withRows(state, { charges: [{ ...charge, status: 'waived' }] }), waivedCharges });
    return row;
  },

  setWorkOrderStatus: (workOrderId, status) => {
    const state = entities(get());
    const wo = state.workOrders.byId[workOrderId];
    if (!wo) throw new Error(`WorkOrder ${workOrderId} not found`);
    const next: WorkOrder = { ...wo, status };
    if (status === 'done' && !next.completedAt) next.completedAt = TODAY;
    set(withRows(state, { workOrders: [next] }));
    return next;
  },
}));
