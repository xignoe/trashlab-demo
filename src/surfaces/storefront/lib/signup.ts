// Instant signup for an open (or approved boundary) address. planSignup assembles every record and authorizes the
// card without writing anything; the storefront slice then commits applySignup(db, records) in one mutateDb, so a
// declined card throws before the write and nothing lands.
//
// What a signup writes (CHECKLIST.md 2D.2, addendum C13): one Party, one BillingAccount, one Site, and per selected
// line one ServiceItem, one Container (the cart), and one deliver WorkOrder; the first-cycle Charges, approved, one
// recurring per line plus the delivery fee; and one settled card Payment for dueTodayCents. Every id carries `_sf_`.
import type { SeedAddress } from '../../../seed';
import type { Db } from '../../../store/db';
import type { BillingAccount, Charge, Container, Party, Payment, ServiceItem, Site, WorkOrder } from '../../../types';
import { dayBefore } from './clock';
import type { MintId } from './ids';
import type { Offer } from './offer';
import { authorizeToken } from './payments';
import { formatAddress } from './serviceability';
import type { Contact } from './types';
import type { SfView } from './view';

export interface SignupArgs {
  offer: Offer;
  contact: Contact;
  addressId: string;
  /** What the buyer agreed to on the checkout screen. */
  consent: { autopay: boolean };
  /** From the slice's sfTokenizeCard. Charged for offer.dueTodayCents. */
  tokenId: string;
}

export interface SignupResult {
  accountId: string;
  siteId: string;
  partyId: string;
  serviceItemIds: string[];
  containerIds: string[];
  workOrderIds: string[];
  /** Every approved first-cycle Charge: the recurring lines in offer order, then the delivery fee. */
  chargeIds: string[];
  paymentId: string;
  /** dayBefore(startDate): the deliver WorkOrder date. */
  cartArrives: string;
  /** startDate: the first route day. */
  firstPickup: string;
}

export interface SignupRecords {
  party: Party;
  account: BillingAccount;
  site: Site;
  serviceItems: ServiceItem[];
  containers: Container[];
  workOrders: WorkOrder[];
  charges: Charge[];
  payment: Payment;
}

export interface SignupPlan {
  records: SignupRecords;
  result: SignupResult;
}

export interface PlanSignupInput {
  offer: Offer;
  contact: Contact;
  address: SeedAddress;
  autopay: boolean;
  tokenId: string;
  /** Site access notes (the boundary intake's delivery notes). */
  accessNotes?: string;
}

/** Builds every record an instant signup creates, without writing anything. Throws on a declined card. */
export function planSignup(input: PlanSignupInput, view: SfView, mint: MintId): SignupPlan {
  const { offer, contact, address } = input;
  if (address.zoneId !== offer.zoneId) {
    throw new Error(`Offer zone ${offer.zoneId} does not match address zone ${address.zoneId}`);
  }
  const route = view.routes[offer.routeId];
  if (!route) throw new Error(`Unknown route ${offer.routeId}`);
  if (!contact.name.trim() || !contact.email.trim()) throw new Error('Contact name and email are required');

  const accountId = mint('acct');
  // Authorize first so a decline throws before any other id is spent. The payment is exactly the approved charges'
  // total, so billing's first invoice for this account is fully paid once the payment is allocated (addendum C13).
  const payment = authorizeToken(input.tokenId, offer.dueTodayCents, accountId, view.paymentTokens, mint);

  const party: Party = { id: mint('party'), name: contact.name.trim(), kind: 'homeowner' };
  const account: BillingAccount = {
    id: accountId,
    payerPartyId: party.id,
    cycle: 'quarterly',
    billedInAdvance: true,
    autopay: input.autopay,
    paymentMethodOnFile: 'card',
    status: 'active',
    deliveryMethod: 'email',
    taxExempt: false,
  };
  const site: Site = {
    id: mint('site'),
    accountId,
    occupantPartyId: party.id,
    address: formatAddress(address),
    zoneId: address.zoneId,
    routeId: route.id,
    ...(input.accessNotes?.trim() ? { accessNotes: input.accessNotes.trim() } : {}),
  };

  const serviceItems: ServiceItem[] = [];
  const containers: Container[] = [];
  const workOrders: WorkOrder[] = [];
  const charges: Charge[] = [];
  const cartArrives = dayBefore(offer.startDate);

  for (const line of offer.lines) {
    const itemId = mint('si');
    const cartId = mint('cart');
    // The driver scans the real cart's serial at delivery; until then the serial is a placeholder named after the id.
    const container: Container = {
      id: cartId,
      serial: `SF-${cartId.slice(-4)}`,
      catalogId: line.catalogId,
      siteId: site.id,
      assignedFrom: cartArrives,
    };
    const item: ServiceItem = {
      id: itemId,
      siteId: site.id,
      catalogId: line.catalogId,
      qty: line.qty,
      frequency: line.frequency,
      containerIds: [cartId],
      effectiveFrom: offer.startDate,
      status: 'active',
    };
    serviceItems.push(item);
    containers.push(container);
    workOrders.push({
      id: mint('wo'),
      siteId: site.id,
      kind: 'deliver',
      status: 'scheduled',
      scheduledFor: cartArrives,
      serviceItemId: item.id,
      containerId: cartId,
    });
    charges.push({
      ...line.charge,
      id: mint('chg'),
      accountId,
      siteId: site.id,
      source: { type: 'serviceItem', id: item.id },
      status: 'approved',
    });
  }

  const primaryItem = serviceItems[0];
  charges.push({
    ...offer.deliveryCharge,
    id: mint('chg'),
    accountId,
    siteId: site.id,
    source: { type: 'serviceItem', id: primaryItem.id },
    status: 'approved',
  });

  return {
    records: { party, account, site, serviceItems, containers, workOrders, charges, payment },
    result: {
      accountId,
      siteId: site.id,
      partyId: party.id,
      serviceItemIds: serviceItems.map((s) => s.id),
      containerIds: containers.map((c) => c.id),
      workOrderIds: workOrders.map((w) => w.id),
      chargeIds: charges.map((c) => c.id),
      paymentId: payment.id,
      cartArrives,
      firstPickup: offer.startDate,
    },
  };
}

/** The Db with a signup's records appended (new arrays, nothing mutated). The slice commits it through mutateDb. */
export function applySignup(db: Db, records: SignupRecords): Db {
  return {
    ...db,
    parties: [...db.parties, records.party],
    accounts: [...db.accounts, records.account],
    sites: [...db.sites, records.site],
    serviceItems: [...db.serviceItems, ...records.serviceItems],
    containers: [...db.containers, ...records.containers],
    workOrders: [...db.workOrders, ...records.workOrders],
    charges: [...db.charges, ...records.charges],
    payments: [...db.payments, records.payment],
  };
}
