// Builds the priced residential offer for a zone and route. Pure: reads state, returns an Offer.
// The offer is priced against a provisional account and site overlaid on the state, so resolvePrice
// and computeCharge run exactly as they will for the real account, before any record exists.
import type { BillingAccount, Charge, Frequency, Site } from '../types';
import { addMonths, dayBefore, nextServiceDays, TODAY, type RouteDay } from './clock';
import { computeCharge, resolvePrice, type EngineState, type ResolvedPrice } from './engine';
import { roundHalfUp } from './money';
import { snapshot, type StoreTables } from './store';

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

export type OfferState = EngineState & Pick<StoreTables, 'routes'>;

/** State with a provisional account and site so the engine can price an address that has no records yet. */
export function withProvisionalSite(state: OfferState, zoneId: string, routeId: string): OfferState {
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
  const site: Site = { id: OFFER_SITE_ID, accountId: OFFER_ACCOUNT_ID, address: 'offer', zoneId, routeId };
  return {
    ...state,
    accounts: { ...state.accounts, [OFFER_ACCOUNT_ID]: account },
    sites: { ...state.sites, [OFFER_SITE_ID]: site },
  };
}

/** Rejects zones the storefront cannot price and returns the route. */
function checkServiceable(args: OfferArgs, state: OfferState) {
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
  return { zone, route };
}

/**
 * Prices already-selected lines for a zone, route, and start date. buildOffer and the held-quote
 * approval both end here, so a preserved quote produces the same Charge shapes as a fresh offer.
 */
export function assembleOffer(
  input: { zoneId: string; routeId: string; startDate?: string; lines: PricedLine[]; business?: false },
  state: OfferState = snapshot(),
): Offer {
  const { zone, route } = checkServiceable({ ...input, cartCatalogId: '', extraCart: false, recycling: false }, state);
  const startDateOptions = nextServiceDays(route.day, 2, TODAY);
  const startDate = input.startDate ?? startDateOptions[0];
  const period = { start: startDate, end: addMonths(startDate, 3) };
  const priced = withProvisionalSite(state, zone.id, route.id);

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
    recurringMonthlyEquivalentCents: roundHalfUp(recurringQuarterlyCents / 3),
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

/** The selected residential lines, priced by resolvePrice on the start date. */
export function selectLines(
  args: Pick<OfferArgs, 'zoneId' | 'cartCatalogId' | 'extraCart' | 'recycling'>,
  onDate: string,
  state: EngineState,
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
    const pricing = resolvePrice({ catalogId, frequency, zoneId: args.zoneId, accountId, onDate }, state);
    return { catalogId, qty: 1, frequency, priceCents: pricing.priceCents, pricing };
  });
}

/**
 * The storefront's priced offer: one recurring line per selected item, first-cycle Charges for the
 * quarter starting on startDate, a one-time delivery fee Charge, and the totals the price panel shows.
 * Throws for a franchise or unserved zone or a business buyer; marks provisional on a boundary zone.
 */
export function buildOffer(args: OfferArgs, state: OfferState = snapshot()): Offer {
  const { route } = checkServiceable(args, state);
  const startDate = args.startDate ?? nextServiceDays(route.day, 1, TODAY)[0];
  const lines = selectLines(args, startDate, state);
  return assembleOffer({ zoneId: args.zoneId, routeId: route.id, startDate, lines }, state);
}

export function frequencyLabel(f: Frequency): string {
  switch (f) {
    case 'weekly': return 'weekly';
    case 'eow': return 'every other week';
    case '2x': return 'twice a week';
    case '3x': return 'three times a week';
    case 'onCall': return 'on call';
  }
}
