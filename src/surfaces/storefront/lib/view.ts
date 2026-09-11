// A keyed, read-only view of the one Db plus the storefront slice's sidecars. The storefront code looks rows up by
// id (catalog[id], zones[id]) the way the prototype's keyed store did; the Db stores arrays (billing's table shape,
// addendum C1). viewOf builds the keyed tables once per Db object and returns the same view object for the same
// (db, quoteIntake, paymentTokens), so React selectors that return it are stable and cheap.
//
// Engine calls take view.db (the canonical engine's trailing db, addendum C2). Nothing here writes: every write goes
// through the storefront slice's actions and get().mutateDb.
import type { Db } from '../../../store/db';
import { ADDRESSES, type SeedAddress } from '../../../seed';
import { tenantById } from '../../../tenants';
import type {
  BillingAccount, Charge, Container, Contract, FeeRule, Hauler, Party, Payment, Quote, RateVersion, Route,
  ServiceCatalog, ServiceItem, Site, TaxRule, WorkOrder, Zone,
} from '../../../types';
import type { Keyed, PaymentToken, QuoteIntake } from './types';

/** What a view is built from: the store's db and the storefront slice's two sidecars. */
export interface SfSource {
  db: Db;
  quoteIntake: Keyed<QuoteIntake>;
  paymentTokens: Keyed<PaymentToken>;
  /** The signed-in hauler, which decides the address book. Absent means the seeded hauler's. */
  tenantId?: string;
}

export interface DbTables {
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
  charges: Keyed<Charge>;
  payments: Keyed<Payment>;
}

export interface SfView extends DbTables {
  /** The Db itself, for engine calls. */
  db: Db;
  /** The storefront-local address book (src/seed/addresses.json, addendum B3). Not a Db table. */
  addresses: Keyed<SeedAddress>;
  quoteIntake: Keyed<QuoteIntake>;
  paymentTokens: Keyed<PaymentToken>;
}

function byId<T extends { id: string }>(rows: readonly T[]): Keyed<T> {
  const out: Keyed<T> = {};
  for (const row of rows) out[row.id] = row;
  return out;
}

/** The seeded hauler's address book, keyed. The default when a caller names no tenant. */
export const ADDRESS_BOOK: Keyed<SeedAddress> = byId(ADDRESSES);

/**
 * Each hauler's address book, keyed and built once.
 *
 * The address book stands in for a geocoder and is never a Db table (addendum B3), but it still belongs to one
 * hauler: the storefront must not offer a New Jersey address to a Georgia hauler's buyer. It is resolved from the
 * view's tenant rather than held in a module variable, because a module variable is state outside the store, and
 * anything that switched it would leak into every other reader in the process.
 */
const addressBooks = new Map<string, Keyed<SeedAddress>>();

function addressBookFor(tenantId: string | undefined): Keyed<SeedAddress> {
  if (!tenantId) return ADDRESS_BOOK;
  let book = addressBooks.get(tenantId);
  if (!book) {
    book = byId(tenantById(tenantId).addresses);
    addressBooks.set(tenantId, book);
  }
  return book;
}

function tablesOf(db: Db): DbTables {
  const hauler = db.hauler[0];
  if (!hauler) throw new Error('The Db has no hauler row');
  return {
    hauler,
    parties: byId(db.parties),
    accounts: byId(db.accounts),
    sites: byId(db.sites),
    zones: byId(db.zones),
    routes: byId(db.routes),
    catalog: byId(db.catalog),
    containers: byId(db.containers),
    serviceItems: byId(db.serviceItems),
    rateVersions: byId(db.rateVersions),
    feeRules: byId(db.feeRules),
    taxRules: byId(db.taxRules),
    contracts: byId(db.contracts),
    quotes: byId(db.quotes),
    workOrders: byId(db.workOrders),
    charges: byId(db.charges),
    payments: byId(db.payments),
  };
}

interface Entry {
  tables: DbTables;
  views: WeakMap<Keyed<QuoteIntake>, WeakMap<Keyed<PaymentToken>, SfView>>;
}

const cache = new WeakMap<Db, Entry>();

/** The keyed view for a store state (or any { db, quoteIntake, paymentTokens }). Same inputs, same object. */
export function viewOf(src: SfSource): SfView {
  let entry = cache.get(src.db);
  if (!entry) {
    entry = { tables: tablesOf(src.db), views: new WeakMap() };
    cache.set(src.db, entry);
  }
  let byTokens = entry.views.get(src.quoteIntake);
  if (!byTokens) {
    byTokens = new WeakMap();
    entry.views.set(src.quoteIntake, byTokens);
  }
  let view = byTokens.get(src.paymentTokens);
  if (!view) {
    view = { ...entry.tables, db: src.db, addresses: addressBookFor(src.tenantId), quoteIntake: src.quoteIntake, paymentTokens: src.paymentTokens };
    byTokens.set(src.paymentTokens, view);
  }
  return view;
}
