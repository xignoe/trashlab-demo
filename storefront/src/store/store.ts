// The zustand store: every seed table as a keyed collection, plus two storefront-only tables
// (quoteIntake and paymentTokens) that the shared contract does not define (see DECISIONS.md, Phase 2).
// Transactions (signup.ts, held.ts, commercial.ts, payments.ts) assemble their records first and
// commit them in exactly one setState so each is atomic.
import { create } from 'zustand';
import { seed, type SeedAddress } from '../seed';
import { NOW } from './clock';
import type {
  BillingAccount, Charge, Container, Contract, CreditMemo, FeeRule, Hauler, Invoice, Party, Payment,
  PaymentAllocation, ProcessorBatch, Quote, RateVersion, Request, Route, ScaleTicket, ServiceCatalog,
  ServiceEvent, ServiceItem, Site, TaxRule, WaivedCharge, WorkOrder, Zone,
} from '../types';

export type Keyed<T> = Record<string, T>;

/** Who to reach about a signup or request. "phone" is the mobile number the UI collects. */
export interface Contact {
  name: string;
  email: string;
  phone?: string;
}

/** A tokenized card. Brand, last4, expiry only; a PAN is never accepted or stored. */
export interface PaymentToken {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  createdAt: string;
}

/** Storefront intake details that sit beside a Quote (the contract's Quote has no contact or notes). */
export interface QuoteIntake {
  quoteId: string;
  contact: Contact;
  addressId?: string;
  startDate?: string;
  deliveryNotes?: string;
  photoName?: string;
  material?: string;
  accessNotes?: string;
  /** Set when the boundary intake asked for autopay. Approval defaults to false without it. */
  autopay?: boolean;
  declineReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface StoreTables {
  hauler: Hauler;
  parties: Keyed<Party>;
  accounts: Keyed<BillingAccount>;
  sites: Keyed<Site>;
  zones: Keyed<Zone>;
  routes: Keyed<Route>;
  catalog: Keyed<ServiceCatalog>;
  containers: Keyed<Container>;
  serviceItems: Keyed<ServiceItem>;
  rateVersions: Keyed<RateVersion>;
  feeRules: Keyed<FeeRule>;
  taxRules: Keyed<TaxRule>;
  contracts: Keyed<Contract>;
  quotes: Keyed<Quote>;
  workOrders: Keyed<WorkOrder>;
  serviceEvents: Keyed<ServiceEvent>;
  scaleTickets: Keyed<ScaleTicket>;
  charges: Keyed<Charge>;
  invoices: Keyed<Invoice>;
  payments: Keyed<Payment>;
  /** Keyed by `${sourceId}:${invoiceId}` because PaymentAllocation has no id. */
  allocations: Keyed<PaymentAllocation>;
  batches: Keyed<ProcessorBatch>;
  creditMemos: Keyed<CreditMemo>;
  /** Keyed by chargeId because WaivedCharge has no id. Rows are never deleted. */
  waivedCharges: Keyed<WaivedCharge>;
  requests: Keyed<Request>;
  addresses: Keyed<SeedAddress>;
  quoteIntake: Keyed<QuoteIntake>;
  paymentTokens: Keyed<PaymentToken>;
}

export interface StoreState extends StoreTables {
  /** Put every table back to the seed. The id counter keeps counting so ids never repeat in a session. */
  reset(): void;
}

/** Tokens and intake rows for the seed quotes. They live here, not in src/seed, because the contract has no such tables. */
const SEED_PAYMENT_TOKENS: PaymentToken[] = [
  { id: 'tok_ridge_4242', brand: 'visa', last4: '4242', expMonth: 8, expYear: 2029, createdAt: '2026-09-08T10:00:00-04:00' },
];

const SEED_QUOTE_INTAKE: QuoteIntake[] = [
  {
    quoteId: 'quote_held_ridge',
    contact: { name: 'Priya Ridgeway', email: 'priya.ridgeway@example.com', phone: '404-555-0142' },
    addressId: 'addr_boundary',
    startDate: '2026-09-15',
    deliveryNotes: 'Gravel drive past the mailbox cluster, leave the cart by the second gate.',
    photoName: 'ridge-hollow-driveway.jpg',
    createdAt: '2026-09-08T10:00:00-04:00',
  },
  {
    quoteId: 'quote_bakery_request',
    contact: { name: 'Sam Okafor', email: 'sam@sunrisebakery.example.com', phone: '404-555-0177' },
    material: 'cardboard',
    accessNotes: 'Enclosure behind the loading dock, gate code 4471',
    createdAt: '2026-09-09T15:30:00-04:00',
  },
];

function keyBy<T>(rows: T[], key: (row: T) => string): Keyed<T> {
  const out: Keyed<T> = {};
  for (const row of rows) out[key(row)] = row;
  return out;
}

const byId = <T extends { id: string }>(rows: T[]) => keyBy(rows, (r) => r.id);

/** A fresh deep copy of the seed as keyed tables, so no transaction can ever mutate the imported JSON. */
export function buildSeedTables(): StoreTables {
  const s = structuredClone(seed);
  return {
    hauler: s.hauler,
    parties: byId(s.parties),
    accounts: byId(s.accounts),
    sites: byId(s.sites),
    zones: byId(s.zones),
    routes: byId(s.routes),
    catalog: byId(s.catalog),
    containers: byId(s.containers),
    serviceItems: byId(s.serviceItems),
    rateVersions: byId(s.rateVersions),
    feeRules: byId(s.feeRules),
    taxRules: byId(s.taxRules),
    contracts: byId(s.contracts),
    quotes: byId(s.quotes),
    workOrders: byId(s.workOrders),
    serviceEvents: byId(s.serviceEvents),
    scaleTickets: byId(s.scaleTickets),
    charges: byId(s.charges),
    invoices: byId(s.invoices),
    payments: byId(s.payments),
    allocations: keyBy(s.allocations, (a) => `${a.sourceId}:${a.invoiceId}`),
    batches: byId(s.batches),
    creditMemos: byId(s.creditMemos),
    waivedCharges: keyBy(s.waivedCharges, (w) => w.chargeId),
    requests: byId(s.requests),
    addresses: byId(s.addresses),
    quoteIntake: keyBy(structuredClone(SEED_QUOTE_INTAKE), (q) => q.quoteId),
    paymentTokens: byId(structuredClone(SEED_PAYMENT_TOKENS)),
  };
}

export const useStore = create<StoreState>()((set) => ({
  ...buildSeedTables(),
  reset: () => set(buildSeedTables()),
}));

/** Current tables, for engine calls and read-only lookups outside React. */
export const snapshot = (): StoreTables => useStore.getState();

let counter = 0;

/**
 * Monotonic id helper. Ids look like `party_sf_0001`; the `sf` segment marks records the storefront
 * created this session, so they can never collide with seed ids and the Phase 6 inspector can filter them.
 */
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_sf_${String(counter).padStart(4, '0')}`;
}

/** Array view of a keyed table. */
export function values<T>(table: Keyed<T>): T[] {
  return Object.values(table);
}

/** Ids of every seed record, for "created this session" filters. Computed once. */
export const SEED_IDS: ReadonlySet<string> = (() => {
  const t = buildSeedTables();
  const ids = new Set<string>();
  const tables: Keyed<unknown>[] = [
    t.parties, t.accounts, t.sites, t.zones, t.routes, t.catalog, t.containers, t.serviceItems, t.rateVersions,
    t.feeRules, t.taxRules, t.contracts, t.quotes, t.workOrders, t.serviceEvents, t.scaleTickets, t.charges,
    t.invoices, t.payments, t.allocations, t.batches, t.creditMemos, t.waivedCharges, t.requests, t.addresses,
    t.quoteIntake, t.paymentTokens,
  ];
  for (const table of tables) for (const key of Object.keys(table)) ids.add(key);
  ids.add(t.hauler.id);
  return ids;
})();

/** Exported so transaction modules can stamp createdAt without importing the clock separately. */
export const nowIso = (): string => NOW;
