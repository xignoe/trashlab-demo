// Instant signup for an open (or approved boundary) address. Every record is assembled first by the
// pure planSignup, the card is authorized, and then one setState writes all of it. A declined card
// throws before the setState, so nothing is written.
import type { SeedAddress } from '../seed';
import type { BillingAccount, Charge, Party, Payment, ServiceItem, Site, WorkOrder } from '../types';
import { dayBefore } from './clock';
import type { Offer } from './offer';
import { authorizeToken } from './payments';
import { formatAddress } from './serviceability';
import { nextId, useStore, type Contact, type StoreTables } from './store';

export interface SignupArgs {
  offer: Offer;
  contact: Contact;
  addressId: string;
  /** What the buyer agreed to on the checkout screen. */
  consent: { autopay: boolean };
  /** From tokenizeCard. Charged for offer.dueTodayCents. */
  tokenId: string;
}

export interface SignupResult {
  accountId: string;
  siteId: string;
  partyId: string;
  serviceItemIds: string[];
  workOrderIds: string[];
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
  workOrders: WorkOrder[];
  charges: Charge[];
  payment: Payment;
  routeId: string;
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
  /** Amount to charge; defaults to offer.dueTodayCents. A held quote charges its own preserved number. */
  chargeCents?: number;
}

/** Builds every record an instant signup creates, without writing anything. Throws on a declined card. */
export function planSignup(input: PlanSignupInput, state: StoreTables): SignupPlan {
  const { offer, contact, address } = input;
  if (address.zoneId !== offer.zoneId) {
    throw new Error(`Offer zone ${offer.zoneId} does not match address zone ${address.zoneId}`);
  }
  const route = state.routes[offer.routeId];
  if (!route) throw new Error(`Unknown route ${offer.routeId}`);
  if (!contact.name.trim() || !contact.email.trim()) throw new Error('Contact name and email are required');

  const accountId = nextId('acct');
  // Authorize first so a decline throws before any other id is spent.
  const payment = authorizeToken(input.tokenId, input.chargeCents ?? offer.dueTodayCents, accountId, state);

  const party: Party = { id: nextId('party'), name: contact.name.trim(), kind: 'homeowner' };
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
    id: nextId('site'),
    accountId,
    occupantPartyId: party.id,
    address: formatAddress(address),
    zoneId: address.zoneId,
    routeId: route.id,
    ...(input.accessNotes?.trim() ? { accessNotes: input.accessNotes.trim() } : {}),
  };

  const serviceItems: ServiceItem[] = [];
  const workOrders: WorkOrder[] = [];
  const charges: Charge[] = [];
  const cartArrives = dayBefore(offer.startDate);

  for (const line of offer.lines) {
    const item: ServiceItem = {
      id: nextId('si'),
      siteId: site.id,
      catalogId: line.catalogId,
      qty: line.qty,
      frequency: line.frequency,
      containerIds: [],
      effectiveFrom: offer.startDate,
      status: 'active',
    };
    serviceItems.push(item);
    workOrders.push({
      id: nextId('wo'),
      siteId: site.id,
      kind: 'deliver',
      status: 'scheduled',
      scheduledFor: cartArrives,
      serviceItemId: item.id,
    });
    charges.push({
      ...line.charge,
      id: nextId('chg'),
      accountId,
      siteId: site.id,
      source: { type: 'serviceItem', id: item.id },
      status: 'approved',
    });
  }

  const primaryItem = serviceItems[0];
  charges.push({
    ...offer.deliveryCharge,
    id: nextId('chg'),
    accountId,
    siteId: site.id,
    source: { type: 'serviceItem', id: primaryItem.id },
    status: 'approved',
  });

  return {
    records: { party, account, site, serviceItems, workOrders, charges, payment, routeId: route.id },
    result: {
      accountId,
      siteId: site.id,
      partyId: party.id,
      serviceItemIds: serviceItems.map((s) => s.id),
      workOrderIds: workOrders.map((w) => w.id),
      chargeIds: charges.map((c) => c.id),
      paymentId: payment.id,
      cartArrives,
      firstPickup: offer.startDate,
    },
  };
}

/** The partial state a signup plan writes. Callers spread it into their own single setState. */
export function signupPatch(records: SignupRecords, s: StoreTables): Partial<StoreTables> {
  const route = s.routes[records.routeId];
  return {
    parties: { ...s.parties, [records.party.id]: records.party },
    accounts: { ...s.accounts, [records.account.id]: records.account },
    sites: { ...s.sites, [records.site.id]: records.site },
    serviceItems: { ...s.serviceItems, ...Object.fromEntries(records.serviceItems.map((r) => [r.id, r])) },
    workOrders: { ...s.workOrders, ...Object.fromEntries(records.workOrders.map((r) => [r.id, r])) },
    charges: { ...s.charges, ...Object.fromEntries(records.charges.map((r) => [r.id, r])) },
    payments: { ...s.payments, [records.payment.id]: records.payment },
    routes: {
      ...s.routes,
      [route.id]: { ...route, stopSiteIds: [...route.stopSiteIds, records.site.id] },
    },
  };
}

/**
 * Creates Party, BillingAccount, Site, one ServiceItem and one deliver WorkOrder per line, the approved
 * first-cycle Charges, and a settled card Payment, and adds the site to the route, atomically.
 */
export function completeInstantSignup(args: SignupArgs): SignupResult {
  const state = useStore.getState();
  const address = state.addresses[args.addressId];
  if (!address) throw new Error(`Unknown address ${args.addressId}`);
  const plan = planSignup(
    { offer: args.offer, contact: args.contact, address, autopay: args.consent.autopay, tokenId: args.tokenId },
    state,
  );
  useStore.setState((s) => signupPatch(plan.records, s));
  return plan.result;
}
