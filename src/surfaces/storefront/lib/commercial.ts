// Commercial quote request with an instant estimate. The buyer lists one or more containers (size, count, material,
// pickups); every line the published rate card covers is priced right away by the canonical engine (resolvePrice and
// computeCharge against a provisional site, as offer.ts does), and anything it does not cover says why a person prices
// it instead. The request is saved as a draft commercialRequest Quote carrying the estimated unit prices; pricing's
// quote workbench confirms or replaces them (priceCommercialRequest, OWNERSHIP.md). estimateCommercial and
// planCommercialRequest are pure; the storefront slice commits the plan.
import { computeCharge, resolvePrice, type ResolvedPrice } from '../../../store/engine';
import type { BillingAccount, Charge, Container, Frequency, Party, Quote, ServiceCatalog, ServiceItem, Site, WorkOrder } from '../../../types';
import { addHours, addMonths, dayBefore, nextBusinessDay, now, today } from './clock';
import type { MintId } from './ids';
import { frequencyLabel, OFFER_ACCOUNT_ID, OFFER_SITE_ID, withProvisionalSite } from './offer';
import { formatAddress, matchAddress } from './serviceability';
import type { Contact, QuoteIntake } from './types';
import type { SfView } from './view';

/** What the agent says when it hands a commercial request to a person. */
export const COMMERCIAL_NO_PRICE_REASON =
  'Commercial pricing depends on material, frequency, and access, so a person confirms it with you.';

export const COMMERCIAL_EXPIRY_DAYS = 30;

export const COMMERCIAL_MATERIALS = [
  'trash',
  'cardboard',
  'mixed recycling',
  'food scraps',
  'construction debris',
  'wood waste',
  'metal',
  'yard waste',
  'other',
] as const;
export type CommercialMaterial = (typeof COMMERCIAL_MATERIALS)[number];

/** Front load containers, emptied on a schedule. */
export const FRONTLOAD_CONTAINER_IDS = ['cat_fl_2yd', 'cat_fl_3yd', 'cat_fl_4yd', 'cat_fl_6yd', 'cat_fl_8yd'] as const;
/** Rolloff boxes and the compactor, hauled and swapped when the buyer calls. */
export const ROLLOFF_CONTAINER_IDS = ['cat_ro_10yd', 'cat_ro_20yd', 'cat_ro_30yd', 'cat_ro_40yd', 'cat_ro_compactor_30yd'] as const;
export const COMPACTOR_ID = 'cat_ro_compactor_30yd';
/** Every container size the commercial form offers. */
export const COMMERCIAL_CONTAINER_IDS: readonly string[] = [...FRONTLOAD_CONTAINER_IDS, ...ROLLOFF_CONTAINER_IDS];
/** A 3 yd front load of wood waste is its own catalog item with its own rate. */
const WOOD_CONTAINER_ID = 'cat_fl_3yd_wood';

export const FRONTLOAD_FREQUENCIES: Frequency[] = ['eow', 'weekly', '2x', '3x', '4x', '5x', '6x'];
export const ROLLOFF_FREQUENCIES: Frequency[] = ['onCall'];
export const COMMERCIAL_FREQUENCIES: Frequency[] = [...FRONTLOAD_FREQUENCIES, ...ROLLOFF_FREQUENCIES];

export const BUSINESS_TYPES = [
  'Restaurant or food service',
  'Retail store',
  'Office',
  'Construction or contractor',
  'Manufacturing or warehouse',
  'Medical or dental',
  'Apartments or property management',
  'School, church, or nonprofit',
  'Other',
] as const;

export type ServiceTerm = 'ongoing' | 'project';
export const SERVICE_TERMS: { id: ServiceTerm; label: string; description: string }[] = [
  { id: 'ongoing', label: 'Ongoing service', description: 'Regular pickups on a schedule' },
  { id: 'project', label: 'One-time project', description: 'A rolloff for a cleanout or build' },
];

export const COMMERCIAL_EXTRAS = [
  { id: 'lock', label: 'Lock bar' },
  { id: 'casters', label: 'Wheels (casters)' },
  { id: 'enclosure', label: 'Enclosure or gate we open' },
] as const;

export const MAX_COMMERCIAL_LINES = 6;
export const MAX_LINE_QTY = 10;

export interface CommercialLine {
  catalogId: string;
  qty: number;
  material: string;
  frequency: Frequency;
}

export const DEFAULT_COMMERCIAL_LINE: CommercialLine = { catalogId: FRONTLOAD_CONTAINER_IDS[0], qty: 1, material: 'trash', frequency: 'weekly' };

/** The pickup choices a container takes: a schedule for front load, on call for rolloff. */
export function frequenciesFor(item: Pick<ServiceCatalog, 'lob'> | undefined): Frequency[] {
  return item?.lob === 'rolloff' ? ROLLOFF_FREQUENCIES : FRONTLOAD_FREQUENCIES;
}

/** The containers a term offers: a one-time project is a rolloff (the compactor is ongoing only). */
export function containersFor(term: ServiceTerm): readonly string[] {
  return term === 'project' ? ROLLOFF_CONTAINER_IDS.filter((id) => id !== COMPACTOR_ID) : COMMERCIAL_CONTAINER_IDS;
}

/** The catalog item a line is quoted on: a 3 yd front load of wood waste uses the wood container. */
export function quotedCatalogId(line: Pick<CommercialLine, 'catalogId' | 'material'>): string {
  return line.catalogId === 'cat_fl_3yd' && line.material === 'wood waste' ? WOOD_CONTAINER_ID : line.catalogId;
}

// ---------------------------------------------------------------------------
// Estimate
// ---------------------------------------------------------------------------

export interface EstimateTotals {
  baseCents: number;
  fuelCents: number;
  environmentalCents: number;
  taxCents: number;
  totalCents: number;
}

interface LineEstimateBase {
  line: CommercialLine;
  catalogId: string;
  item: ServiceCatalog;
  /** Front load is a monthly price; rolloff is a price per haul. */
  basis: 'monthly' | 'perHaul';
}
export type LineEstimate =
  | (LineEstimateBase & { priced: true; unitCents: number; charge: Charge; pricing: ResolvedPrice })
  | (LineEstimateBase & { priced: false; reason: string });

export interface CommercialEstimate {
  /** Set when nothing can be estimated at this address (no address, not served, franchise, and so on). */
  blocker?: string;
  lines: LineEstimate[];
  monthly?: EstimateTotals;
  perHaul?: EstimateTotals;
  /** The one-time delivery charge, with tax, when anything was priced. */
  delivery?: Charge;
  /** Every line priced. */
  complete: boolean;
}

/** What the receipt keeps of the estimate. */
export interface EstimateSummary {
  monthlyCents?: number;
  perHaulCents?: number;
  deliveryCents?: number;
  pricedLines: number;
  totalLines: number;
}

const PERSON_MATERIAL: Record<string, string> = {
  'food scraps': 'Food scraps run on a separate organics route.',
  other: 'A person needs to know more about this material.',
};
const HEAVY_FOR_FRONTLOAD = new Set(['construction debris', 'metal', 'yard waste']);

function lineReason(line: CommercialLine, item: ServiceCatalog): string | undefined {
  if (item.id === COMPACTOR_ID) return 'Compactors are sized and priced on site.';
  const material = PERSON_MATERIAL[line.material];
  if (material) return material;
  if (item.lob === 'frontload' && HEAVY_FOR_FRONTLOAD.has(line.material)) {
    return `${capitalize(line.material)} is heavy, so front load service for it is priced by weight.`;
  }
  if (item.lob === 'frontload' && line.material === 'wood waste' && line.catalogId !== 'cat_fl_3yd') {
    return 'Wood waste has a published rate only in a 3 yd container.';
  }
  return undefined;
}

function zoneBlocker(address: string, view: SfView): { blocker?: string; zoneId: string; routeId?: string } {
  if (!address.trim()) return { blocker: 'Enter the business address to see an estimate.', zoneId: '' };
  const match = matchAddress(address, view);
  const zoneId = match.zone.id;
  switch (match.branch) {
    case 'notServed':
      return { blocker: 'We could not match this address to a route yet, so a person will price it.', zoneId };
    case 'franchise':
      return { blocker: 'This address is in a city franchise area, so a person will price it.', zoneId };
    case 'boundary':
      return { blocker: 'This address is at the edge of our service area, so a person will price it.', zoneId };
  }
  if (!match.zone.publicPricing) return { blocker: `Prices in ${match.zone.name} are set with you directly.`, zoneId };
  return { zoneId, routeId: match.route?.id };
}

function totalsOf(charges: Charge[], view: SfView): EstimateTotals | undefined {
  if (charges.length === 0) return undefined;
  const t: EstimateTotals = { baseCents: 0, fuelCents: 0, environmentalCents: 0, taxCents: 0, totalCents: 0 };
  for (const c of charges) {
    t.baseCents += c.baseCents;
    t.taxCents += c.taxCents;
    t.totalCents += c.totalCents;
    for (const fee of c.fees) {
      if (view.feeRules[fee.feeRuleId]?.kind === 'percent') t.fuelCents += fee.cents;
      else t.environmentalCents += fee.cents;
    }
  }
  return t;
}

/**
 * Prices each line from the published rate card. Front load lines are one month of service (fuel, the flat
 * environmental fee, and tax on top, addenda C5 to C8); rolloff lines are one haul (fuel and tax). A line with no
 * published rate, or one that needs a person, carries the reason instead of a price.
 */
export function estimateCommercial(args: { address: string; lines: CommercialLine[] }, view: SfView, onDate: string = today()): CommercialEstimate {
  const { blocker, zoneId, routeId } = zoneBlocker(args.address, view);
  const db = blocker ? view.db : withProvisionalSite(view.db, zoneId, routeId);
  const period = { start: onDate, end: dayBefore(addMonths(onDate, 1)) };

  const lines: LineEstimate[] = args.lines.map((line, i) => {
    const catalogId = quotedCatalogId(line);
    const item = view.catalog[catalogId] ?? view.catalog[line.catalogId];
    if (!item) throw new Error(`Unknown catalog item ${line.catalogId}`);
    const base = { line, catalogId, item, basis: item.lob === 'rolloff' ? ('perHaul' as const) : ('monthly' as const) };
    const reason = blocker ? 'Priced by a person for this address.' : lineReason(line, item);
    if (reason) return { ...base, priced: false, reason };

    let pricing: ResolvedPrice;
    try {
      pricing = resolvePrice({ catalogId, frequency: line.frequency, zoneId, accountId: OFFER_ACCOUNT_ID, onDate }, db);
    } catch {
      return { ...base, priced: false, reason: `No published rate yet for a ${item.sizeLabel} ${frequencyLabel(line.frequency)}.` };
    }
    const charge = computeCharge(
      {
        id: `chg_estimate_${i}`,
        accountId: OFFER_ACCOUNT_ID,
        siteId: OFFER_SITE_ID,
        lineType: base.basis === 'perHaul' ? 'event' : 'recurring',
        catalogId,
        frequency: line.frequency,
        baseCents: pricing.priceCents * line.qty,
        ...(base.basis === 'perHaul' ? { servicedOn: onDate } : { period }),
        source: { type: 'serviceItem', id: `estimate:${catalogId}` },
        description: `${line.qty} x ${item.name}, ${frequencyLabel(line.frequency)}`,
        pricing: {
          ...(pricing.rateVersionId ? { rateVersionId: pricing.rateVersionId } : {}),
          ...(pricing.contractId ? { contractId: pricing.contractId } : {}),
          ruleWon: pricing.ruleWon,
        },
      },
      db,
    );
    return { ...base, priced: true, unitCents: pricing.priceCents, charge, pricing };
  });

  const priced = lines.filter((l): l is Extract<LineEstimate, { priced: true }> => l.priced);
  const monthly = totalsOf(priced.filter((l) => l.basis === 'monthly').map((l) => l.charge), view);
  const perHaul = totalsOf(priced.filter((l) => l.basis === 'perHaul').map((l) => l.charge), view);
  const zone = view.zones[zoneId];
  const delivery =
    priced.length > 0 && zone
      ? computeCharge(
          {
            id: 'chg_estimate_delivery',
            accountId: OFFER_ACCOUNT_ID,
            siteId: OFFER_SITE_ID,
            lineType: 'fee',
            catalogId: priced[0].catalogId,
            baseCents: zone.deliveryFeeCents,
            servicedOn: onDate,
            source: { type: 'serviceItem', id: `estimate:${priced[0].catalogId}` },
            description: `One-time container delivery, ${zone.name}`,
            pricing: { ruleWon: 'zoneRate' },
          },
          db,
        )
      : undefined;

  return {
    ...(blocker ? { blocker } : {}),
    lines,
    ...(monthly ? { monthly } : {}),
    ...(perHaul ? { perHaul } : {}),
    ...(delivery ? { delivery } : {}),
    complete: lines.length > 0 && priced.length === lines.length,
  };
}

export function summarizeEstimate(e: CommercialEstimate): EstimateSummary {
  return {
    ...(e.monthly ? { monthlyCents: e.monthly.totalCents } : {}),
    ...(e.perHaul ? { perHaulCents: e.perHaul.totalCents } : {}),
    ...(e.delivery ? { deliveryCents: e.delivery.totalCents } : {}),
    pricedLines: e.lines.filter((l) => l.priced).length,
    totalLines: e.lines.length,
  };
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface CommercialRequestArgs {
  /** The typed address; matched with matchAddress for the zone. */
  address: string;
  lines: CommercialLine[];
  businessType?: string;
  term?: ServiceTerm;
  /** Preferred start, an ISO date. */
  startDate?: string;
  extras?: string[];
  accessNotes: string;
  contact: Contact;
}

export interface CommercialRequestResult {
  quoteId: string;
  /** The next business day after today, when a person confirms the written price. */
  replyBy: string;
  expiresAt: string;
  estimate: EstimateSummary;
}

function checkLine(line: CommercialLine, view: SfView, index: number): void {
  const n = `Container ${index + 1}`;
  const item = view.catalog[line.catalogId];
  if (!item || !COMMERCIAL_CONTAINER_IDS.includes(line.catalogId)) throw new Error(`${n}: container size must be a front load or rolloff catalog item`);
  if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > MAX_LINE_QTY) throw new Error(`${n}: quantity must be 1 to ${MAX_LINE_QTY}`);
  if (!line.material.trim()) throw new Error(`${n}: material is required`);
  if (!frequenciesFor(item).includes(line.frequency)) throw new Error(`${n}: frequency ${line.frequency} does not fit a ${item.name}`);
}

/** A commercialRequest Quote (draft, estimated unit prices where the rate card covers them) and its intake row. */
export function planCommercialRequest(
  args: CommercialRequestArgs,
  view: SfView,
  mint: MintId,
): { quote: Quote; intake: QuoteIntake; result: CommercialRequestResult } {
  if (args.lines.length === 0) throw new Error('Add at least one container');
  if (args.lines.length > MAX_COMMERCIAL_LINES) throw new Error(`At most ${MAX_COMMERCIAL_LINES} containers per request`);
  args.lines.forEach((line, i) => checkLine(line, view, i));
  if (!args.contact.name.trim() || !args.contact.email.trim()) throw new Error('Contact name and email are required');

  const at = now();
  const match = matchAddress(args.address, view);
  const estimate = estimateCommercial(args, view);
  const lines: Quote['lines'] = estimate.lines.map((l) => ({
    catalogId: l.catalogId,
    qty: l.line.qty,
    frequency: l.line.frequency,
    priceCents: l.priced ? l.unitCents : 0,
  }));
  const quote: Quote = {
    id: mint('quote'),
    kind: 'commercialRequest',
    address: match.address ? formatAddress(match.address) : args.address.trim(),
    zoneId: match.zone.id,
    lines,
    dueTodayCents: 0,
    // Pricing's convention (priceCommercialRequest): the sum of unit price times quantity.
    recurringCents: lines.reduce((sum, l) => sum + l.priceCents * l.qty, 0),
    status: 'draft',
    expiresAt: addHours(at, COMMERCIAL_EXPIRY_DAYS * 24),
    createdVia: 'storefront',
  };
  const materials = args.lines.map((l) => l.material.trim());
  const intake: QuoteIntake = {
    quoteId: quote.id,
    contact: { name: args.contact.name.trim(), email: args.contact.email.trim(), ...(args.contact.phone ? { phone: args.contact.phone } : {}) },
    ...(match.address ? { addressId: match.address.id } : {}),
    material: materials.filter((m, i) => materials.indexOf(m) === i).join(', '),
    lineMaterials: materials,
    ...(args.businessType ? { businessType: args.businessType } : {}),
    ...(args.term ? { term: args.term } : {}),
    ...(args.startDate ? { startDate: args.startDate } : {}),
    ...(args.extras && args.extras.length > 0 ? { extras: [...args.extras] } : {}),
    accessNotes: args.accessNotes.trim(),
    createdAt: at,
  };
  return {
    quote,
    intake,
    result: { quoteId: quote.id, replyBy: nextBusinessDay(today()), expiresAt: quote.expiresAt, estimate: summarizeEstimate(estimate) },
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// The office answers a request (Office approvals): price it and send it, then record the customer's answer.
// ---------------------------------------------------------------------------

export interface QuotedLine {
  catalogId: string;
  qty: number;
  frequency: Frequency;
  /** Monthly price per container (per haul for an on-call rolloff), in cents. */
  priceCents: number;
}

const normAddress = (s: string) => s.toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();

/** The existing account with a site at the quote's address, if the requester is already a customer. */
export function accountAtAddress(quote: Pick<Quote, 'address'>, view: Pick<SfView, 'db'>): string | undefined {
  const key = normAddress(quote.address);
  const first = normAddress(quote.address.split(',')[0] ?? '');
  const site = view.db.sites.find((s) => normAddress(s.address) === key || normAddress(s.address) === first);
  return site?.accountId;
}

/** Each line with the published rate for it (for the customer's contract when they have one), or none. */
export function rateCardPrices(quote: Quote, view: SfView, onDate: string = today()): (QuotedLine & { rateCents?: number })[] {
  const accountId = accountAtAddress(quote, view) ?? OFFER_ACCOUNT_ID;
  const zoneId = quote.zoneId ?? 'zone_open';
  return quote.lines.map((l) => {
    let rateCents: number | undefined;
    try {
      rateCents = resolvePrice({ catalogId: l.catalogId, frequency: l.frequency, zoneId, accountId, onDate }, view.db).priceCents;
    } catch {
      rateCents = undefined;
    }
    return { catalogId: l.catalogId, qty: l.qty, frequency: l.frequency, priceCents: l.priceCents, ...(rateCents !== undefined ? { rateCents } : {}) };
  });
}

/** A request the office may still price, decline, or record an answer on. */
export function openCommercialRequest(quote: Quote | undefined, quoteId: string): Quote {
  if (!quote) throw new Error(`Unknown quote ${quoteId}`);
  if (quote.kind !== 'commercialRequest') throw new Error(`${quoteId} is a ${quote.kind}, not a commercial request`);
  if (quote.status !== 'draft') throw new Error(`${quoteId} is ${quote.status}; only an open request can be answered`);
  return quote;
}

export function checkQuotedLines(lines: QuotedLine[]): void {
  if (lines.length === 0) throw new Error('A written price needs at least one line');
  for (const l of lines) {
    if (!(Number.isInteger(l.priceCents) && l.priceCents > 0)) throw new Error('Enter a price above $0 for every container');
  }
}

export interface CommercialAccountRecords {
  party: Party;
  account: BillingAccount;
  site: Site;
  serviceItems: ServiceItem[];
  containers: Container[];
  workOrders: WorkOrder[];
}

/**
 * The records for a new commercial customer when their quote is accepted: a business party, a monthly account billed
 * in advance, a site at the quoted address (its zone, and the address book's route or the first route for the
 * service), one active service item per quoted line with its containers, and a delivery work order per line on the
 * start date (the one the customer asked for, else the next business day). Prices are not on these records: the
 * accepted written price goes onto the account's contract through pricing, so billing charges exactly what was quoted.
 */
export function planCommercialAccount(quote: Quote, intake: QuoteIntake | undefined, view: SfView, mint: MintId): CommercialAccountRecords {
  const start = intake?.startDate && intake.startDate > today() ? intake.startDate : nextBusinessDay(today());
  const address = intake?.addressId ? view.addresses[intake.addressId] : undefined;
  const accountId = mint('acct');
  const party: Party = { id: mint('party'), name: intake?.contact.name.trim() || quote.address, kind: 'business' };
  const account: BillingAccount = {
    id: accountId, payerPartyId: party.id, cycle: 'monthly', billedInAdvance: true, autopay: false, status: 'active',
    deliveryMethod: 'email', taxExempt: false,
  };
  const firstLob = view.catalog[quote.lines[0]?.catalogId]?.lob;
  const routeId = address?.routeId ?? Object.values(view.routes).find((r) => r.lob === firstLob)?.id;
  const site: Site = {
    id: mint('site'), accountId, occupantPartyId: party.id, address: quote.address, zoneId: quote.zoneId ?? address?.zoneId ?? 'zone_open',
    ...(routeId ? { routeId } : {}),
    ...(intake?.accessNotes ? { accessNotes: intake.accessNotes } : {}),
  };
  const serviceItems: ServiceItem[] = [];
  const containers: Container[] = [];
  const workOrders: WorkOrder[] = [];
  for (const line of quote.lines) {
    const item = view.catalog[line.catalogId];
    const itemId = mint('si');
    const ids: string[] = [];
    for (let i = 0; i < line.qty; i += 1) {
      const id = mint(item?.lob === 'rolloff' ? 'box' : 'fl');
      ids.push(id);
      // The driver scans the real serial at delivery; until then it is a placeholder named after the id.
      containers.push({ id, serial: `SF-${id.slice(-4)}`, catalogId: line.catalogId, siteId: site.id, assignedFrom: start });
    }
    serviceItems.push({ id: itemId, siteId: site.id, catalogId: line.catalogId, qty: line.qty, frequency: line.frequency, containerIds: ids, effectiveFrom: start, status: 'active' });
    workOrders.push({ id: mint('wo'), siteId: site.id, kind: 'deliver', status: 'open', scheduledFor: start, serviceItemId: itemId });
  }
  return { party, account, site, serviceItems, containers, workOrders };
}
