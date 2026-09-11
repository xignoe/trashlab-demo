// Builds the priced residential offer for a zone and route. Pure: reads a view, returns an Offer.
//
// Every price comes from the canonical engine (src/store/engine.ts): resolvePrice against the Db's rateVersions
// (billing's seed, addendum C4) and computeCharge for the fee and tax stack (addenda C5 to C8). The offer is priced
// against a provisional account and site appended to a copy of the Db, so resolvePrice and computeCharge run exactly
// as they will for the real account, before any record exists. The live Db is never touched.
import type { Db } from '../../../store/db';
import { computeCharge, resolvePrice, type ResolvedPrice } from '../../../store/engine';
import type { BillingAccount, Charge, Frequency, Site } from '../../../types';
import { addMonths, dayBefore, nextServiceDays, today, type RouteDay } from './clock';
import type { SfView } from './view';

export const OFFER_ACCOUNT_ID = 'acct_offer';
export const OFFER_SITE_ID = 'site_offer';

export const CART_CATALOG_IDS = ['cat_res_96', 'cat_res_64'] as const;
export const EXTRA_CART_CATALOG_ID = 'cat_res_extra_cart';
export const RECYCLING_CATALOG_ID = 'cat_res_recycling';

export interface OfferArgs {
  zoneId: string;
  routeId?: string;
  cartCatalogId: string;
  extraCart: boolean;
  recycling: boolean;
  /** One of startDateOptions. Defaults to the first option. */
  startDate?: string;
  /** Commercial buyers never get an instant price; passing true throws. */
  business?: false;
}

/** A selected catalog item with its resolved monthly price. */
export interface PricedLine {
  catalogId: string;
  qty: number;
  frequency: Frequency;
  /** Monthly price from resolvePrice (or a preserved quote line). */
  priceCents: number;
  pricing: ResolvedPrice;
}

export interface OfferLine extends PricedLine {
  name: string;
  monthlyCents: number;
  quarterlyCents: number;
  /** The first-cycle recurring Charge for this line, status proposed. */
  charge: Charge;
}

export interface FeeBreakdown {
  base: number;
  delivery: number;
  fuel: number;
  environmental: number;
  tax: number;
}

export interface OfferRules {
  zoneId: string;
  zoneName: string;
  routeId: string;
  routeDay: RouteDay;
  rateVersions: { catalogId: string; rateVersionId?: string; contractId?: string; ruleWon: ResolvedPrice['ruleWon'] }[];
  feeRuleIds: string[];
  taxRuleId?: string;
}

export interface Offer {
  zoneId: string;
  zoneName: string;
  routeId: string;
  routeDay: RouteDay;
  cadence: 'quarterly';
  startDate: string;
  startDateOptions: string[];
  cartArrives: string;
  period: { start: string; end: string };
  /** True on a boundary zone: the price is real but the address needs a person to confirm. */
  provisional: boolean;
  lines: OfferLine[];
  deliveryCharge: Charge;
  /** Every first-cycle Charge: the recurring lines then the delivery fee. */
  charges: Charge[];
  dueTodayCents: number;
  recurringQuarterlyCents: number;
  recurringMonthlyEquivalentCents: number;
  feeBreakdown: FeeBreakdown;
  rules: OfferRules;
}

/** What pricing reads: the Db for the engine, keyed tables for names and rules. */
export type OfferState = Pick<SfView, 'db' | 'zones' | 'routes' | 'catalog' | 'feeRules' | 'taxRules'>;

/** A copy of the Db with a provisional account and site, so the engine can price an address that has no records yet. */
export function withProvisionalSite(db: Db, zoneId: string, routeId?: string): Db {
  const account: BillingAccount = {
    id: OFFER_ACCOUNT_ID,
    payerPartyId: 'party_offer',
    cycle: 'quarterly',
    billedInAdvance: true,
    autopay: false,
    status: 'active',
    deliveryMethod: 'email',
    taxExempt: false,
  };
  const site: Site = { id: OFFER_SITE_ID, accountId: OFFER_ACCOUNT_ID, address: 'offer', zoneId, ...(routeId ? { routeId } : {}) };
  return {
    ...db,
    accounts: [...db.accounts.filter((a) => a.id !== OFFER_ACCOUNT_ID), account],
    sites: [...db.sites.filter((s) => s.id !== OFFER_SITE_ID), site],
  };
}

/** Rejects zones the storefront cannot price and returns the zone and route. */
function checkServiceable(args: Pick<OfferArgs, 'zoneId' | 'routeId' | 'business'>, state: OfferState) {
  if (args.business) throw new Error('Commercial service is priced by a person, not the storefront');
  const zone = state.zones[args.zoneId];
  if (!zone) throw new Error(`Unknown zone ${args.zoneId}`);
  if (zone.serviceability === 'franchise') {
    throw new Error(`${zone.name} is served under a franchise agreement; the storefront cannot price it`);
  }
  if (zone.serviceability === 'notServed') throw new Error(`${zone.name}: no service at this address`);
  if (!args.routeId) throw new Error('No route for this address');
  const route = state.routes[args.routeId];
  if (!route) throw new Error(`Unknown route ${args.routeId}`);
  return { zone, route: route as typeof route & { day: RouteDay } };
}

/**
 * Prices already-selected lines for a zone, route, and start date. buildOffer and the held-quote approval both end
 * here, so a preserved quote produces the same Charge shapes as a fresh offer.
 */
export function assembleOffer(
  input: { zoneId: string; routeId: string; startDate?: string; lines: PricedLine[]; business?: false },
  state: OfferState,
): Offer {
  const { zone, route } = checkServiceable(input, state);
  const startDateOptions = nextServiceDays(route.day, 2, today());
  const startDate = input.startDate ?? startDateOptions[0];
  // Billing's convention (Phase 3.2b, request R3): a period ends on its last day inclusive, so a Sep 15 start covers
  // Sep 15 to Dec 14 and the next period starts Dec 15.
  const period = { start: startDate, end: dayBefore(addMonths(startDate, 3)) };
  const priced = withProvisionalSite(state.db, zone.id, route.id);

  const lines: OfferLine[] = input.lines.map((line) => {
    const item = state.catalog[line.catalogId];
    if (!item) throw new Error(`Unknown catalog item ${line.catalogId}`);
    const monthlyCents = line.priceCents * line.qty;
    const baseCents = monthlyCents * 3;
    const charge = computeCharge(
      {
        id: `chg_offer_${line.catalogId}`,
        accountId: OFFER_ACCOUNT_ID,
        siteId: OFFER_SITE_ID,
        lineType: 'recurring',
        catalogId: line.catalogId,
        frequency: line.frequency,
        baseCents,
        period,
        source: { type: 'serviceItem', id: `offer:${line.catalogId}` },
        description: `${item.name}, ${frequencyLabel(line.frequency)}, ${period.start} to ${period.end}`,
        pricing: {
          ...(line.pricing.rateVersionId ? { rateVersionId: line.pricing.rateVersionId } : {}),
          ...(line.pricing.contractId ? { contractId: line.pricing.contractId } : {}),
          ruleWon: line.pricing.ruleWon,
        },
      },
      priced,
    );
    return { ...line, name: item.name, monthlyCents, quarterlyCents: baseCents, charge };
  });

  const primary = lines[0];
  if (!primary) throw new Error('An offer needs at least one line');
  const deliveryCharge = computeCharge(
    {
      id: 'chg_offer_delivery',
      accountId: OFFER_ACCOUNT_ID,
      siteId: OFFER_SITE_ID,
      lineType: 'fee',
      catalogId: primary.catalogId,
      baseCents: zone.deliveryFeeCents,
      servicedOn: dayBefore(startDate),
      source: { type: 'serviceItem', id: `offer:${primary.catalogId}` },
      description: `One-time cart delivery, ${zone.name}`,
      pricing: { ruleWon: 'zoneRate' },
    },
    priced,
  );

  const recurringCharges = lines.map((l) => l.charge);
  const charges = [...recurringCharges, deliveryCharge];
  const recurringQuarterlyCents = recurringCharges.reduce((s, c) => s + c.totalCents, 0);
  const dueTodayCents = charges.reduce((s, c) => s + c.totalCents, 0);

  const feeBreakdown: FeeBreakdown = { base: 0, delivery: deliveryCharge.baseCents, fuel: 0, environmental: 0, tax: 0 };
  for (const c of charges) {
    if (c.lineType === 'recurring') feeBreakdown.base += c.baseCents;
    feeBreakdown.tax += c.taxCents;
    for (const fee of c.fees) {
      const rule = state.feeRules[fee.feeRuleId];
      if (rule?.kind === 'percent') feeBreakdown.fuel += fee.cents;
      else feeBreakdown.environmental += fee.cents;
    }
  }

  const taxRule = Object.values(state.taxRules).find((t) => t.zoneId === zone.id);
  const feeRuleIds = Array.from(new Set(charges.flatMap((c) => c.fees.map((f) => f.feeRuleId))));

  return {
    zoneId: zone.id,
    zoneName: zone.name,
    routeId: route.id,
    routeDay: route.day,
    cadence: 'quarterly',
    startDate,
    startDateOptions,
    cartArrives: dayBefore(startDate),
    period,
    provisional: zone.serviceability === 'boundary',
    lines,
    deliveryCharge,
    charges,
    dueTodayCents,
    recurringQuarterlyCents,
    // Addendum C6: Math.round on cents, half up.
    recurringMonthlyEquivalentCents: Math.round(recurringQuarterlyCents / 3),
    feeBreakdown,
    rules: {
      zoneId: zone.id,
      zoneName: zone.name,
      routeId: route.id,
      routeDay: route.day,
      rateVersions: lines.map((l) => ({
        catalogId: l.catalogId,
        ...(l.pricing.rateVersionId ? { rateVersionId: l.pricing.rateVersionId } : {}),
        ...(l.pricing.contractId ? { contractId: l.pricing.contractId } : {}),
        ruleWon: l.pricing.ruleWon,
      })),
      feeRuleIds,
      ...(taxRule ? { taxRuleId: taxRule.id } : {}),
    },
  };
}

/** The selected residential lines, priced by the canonical resolvePrice on the start date. */
export function selectLines(
  args: Pick<OfferArgs, 'zoneId' | 'cartCatalogId' | 'extraCart' | 'recycling'>,
  onDate: string,
  state: Pick<OfferState, 'db' | 'catalog'>,
  accountId: string = OFFER_ACCOUNT_ID,
): PricedLine[] {
  const cart = state.catalog[args.cartCatalogId];
  if (!cart || cart.lob !== 'residential' || !CART_CATALOG_IDS.includes(args.cartCatalogId as (typeof CART_CATALOG_IDS)[number])) {
    throw new Error(`Cart size must be one of ${CART_CATALOG_IDS.join(', ')}`);
  }
  const wanted: { catalogId: string; frequency: Frequency }[] = [{ catalogId: args.cartCatalogId, frequency: 'weekly' }];
  if (args.extraCart) wanted.push({ catalogId: EXTRA_CART_CATALOG_ID, frequency: 'weekly' });
  if (args.recycling) wanted.push({ catalogId: RECYCLING_CATALOG_ID, frequency: 'eow' });
  return wanted.map(({ catalogId, frequency }) => {
    const pricing = resolvePrice({ catalogId, frequency, zoneId: args.zoneId, accountId, onDate }, state.db);
    return { catalogId, qty: 1, frequency, priceCents: pricing.priceCents, pricing };
  });
}

/**
 * The storefront's priced offer: one recurring line per selected item, first-cycle Charges for the quarter starting
 * on startDate, a one-time delivery fee Charge, and the totals the price panel shows. Throws for a franchise or
 * unserved zone or a business buyer; marks provisional on a boundary zone.
 */
export function buildOffer(args: OfferArgs, state: OfferState): Offer {
  const { route } = checkServiceable(args, state);
  const startDate = args.startDate ?? nextServiceDays(route.day, 1, today())[0];
  const lines = selectLines(args, startDate, state);
  return assembleOffer({ zoneId: args.zoneId, routeId: route.id, startDate, lines }, state);
}

/** Storefront copy for a frequency ("every other week"); billing's own labels read "2x weekly". */
export function frequencyLabel(f: Frequency): string {
  switch (f) {
    case 'weekly': return 'weekly';
    case 'eow': return 'every other week';
    case '2x': return 'twice a week';
    case '3x': return 'three times a week';
    case '4x': return 'four times a week';
    case '5x': return 'five times a week';
    case '6x': return 'six times a week';
    case 'onCall': return 'on call';
  }
}
