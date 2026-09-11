// CANONICAL types.ts for the TrashLab MVP. Source: prompts/SHARED_CONTRACT.md, section "src/types.ts".
// This copy lives in shared/ and is the one the merge uses. Every surface src/types.ts must be byte-identical to it below this header.
// Do not edit locally. Changes go through shared/CONTRACT_ADDENDUM.md.

export type LOB = 'residential' | 'frontload' | 'rolloff';
export type Frequency = 'weekly' | 'eow' | '2x' | '3x' | '4x' | '5x' | '6x' | 'onCall';
export type LineType = 'recurring' | 'event' | 'fee' | 'lateFee';

export interface Hauler {
  id: string;
  name: string;
  policy: {
    proration: 'none' | 'nextCycle' | 'daily';
    lateFeeCents: number;
    lateFeeDay: number;
    graceMissedPickups: number;
    suspendAfterDays: number;
    reinstatementFeeCents: number;
  };
}

export interface Party {
  id: string;
  name: string;
  kind: 'homeowner' | 'business' | 'contractor' | 'propertyManager' | 'hoa';
}

export interface BillingAccount {
  id: string;
  payerPartyId: string;
  /** daily and weekly come from a billing group's schedule (addendum Q). */
  cycle: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'perJob' | 'net30';
  billedInAdvance: boolean;
  autopay: boolean;
  paymentMethodOnFile?: 'card' | 'ach';
  status: 'active' | 'pastDue' | 'suspended' | 'hold';
  /** How the customer wants their invoices. */
  deliveryMethod: InvoiceDelivery;
  /** Where invoices go by email, text, and printed mail. The customer gives the one their deliveryMethod needs. */
  invoiceEmail?: string;
  invoicePhone?: string;
  mailingAddress?: string;
  taxExempt: boolean;
  contractId?: string;
  /** The billing group the account is billed with; its cycle follows the group's. Absent: billed on its own terms. */
  billingGroupId?: string;
}

/** How an invoice reaches the customer: printed and mailed, emailed, texted as a pay link, or posted to the portal. */
export type InvoiceDelivery = 'email' | 'mail' | 'text' | 'portal';

/** How often a billing group bills. */
export type BillingFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly';

/**
 * When a billing group bills (addendum Q): every `every` days, weeks, months, or quarters, stepping from startDate. The
 * start date sets the weekday for a weekly group and the day of the month for a monthly or quarterly one (the 31st
 * falls back to a short month's last day). It is an anchor: bill dates before it follow the same pattern.
 */
export interface BillingSchedule {
  frequency: BillingFrequency;
  every: number;
  startDate: string;
}

/**
 * Customers billed together (addendum P, reshaped by addendum Q): every member bills on the group's schedule and terms,
 * and gets invoices the group's way unless the group lets customers choose.
 */
export interface BillingGroup {
  id: string;
  name: string;
  schedule: BillingSchedule;
  /** Days from the invoice date to the due date. */
  termsDays: number;
  /** How the group's invoices go out. */
  delivery: InvoiceDelivery;
  /** When true a member (or the office for them) may pick another delivery; when false every member uses `delivery`. */
  customerChoice: boolean;
  note?: string;
}

export interface Site {
  id: string;
  accountId: string;
  occupantPartyId?: string;
  address: string;
  zoneId: string;
  routeId?: string;
  accessNotes?: string;
  poNumber?: string;
  /** Road miles from the hauler's yard. Location fee rules with a distance band only match a site that carries it. */
  milesFromYard?: number;
  /** The hauler's other stops within a quarter mile. Density fee rules only match a site that carries it. */
  neighborStops?: number;
  /** Where the site is, for zones drawn on the map (GeoZone). A site with no coordinates is in no drawn zone. */
  lat?: number;
  lng?: number;
}

export interface Zone {
  id: string;
  name: string;
  serviceability: 'open' | 'franchise' | 'boundary' | 'notServed';
  taxRatePct: number;
  franchiseFeePct: number;
  deliveryFeeCents: number;
  publicPricing: boolean;
}

export interface Route {
  id: string;
  day: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri';
  lob: LOB;
  stopSiteIds: string[];
  capacityStops: number;
}

export interface ServiceCatalog {
  id: string;
  lob: LOB;
  name: string;
  sizeLabel: string;
  unit: 'cart' | 'container' | 'box';
  rolloff?: {
    includedTons: number;
    includedDays: number;
    extraDayCents: number;
    overageCentsPerTon: number;
    /** Days after includedDays before extra days start to bill. Absent means 0. */
    graceDays?: number;
    /** The box must be swapped or pulled after this many days on site. Informational; nothing bills it. */
    maxRentalDays?: number;
    /** A haul bills at least this many tons, so a light load still pays the minimum. */
    minBilledTons?: number;
    /** Steeper per-ton rates for heavy overages. */
    overageTiers?: OverageTier[];
  };
  public: boolean;
  /** The owner's category (ServiceCategory.id). Its LOB decides how billing treats the service. */
  categoryId?: string;
  /** What one unit of the price buys. Absent: month for recurring service, haul for roll-off. */
  priceUnit?: 'month' | 'pickup' | 'haul' | 'ton' | 'day' | 'item' | 'oneTime';
  /** The dimensions this service's rates are keyed by (PricingDimension ids), in column order. */
  pricedBy?: string[];
  /** A number field (PricingDimension of type number) the price is multiplied by, e.g. collections per month. */
  quantityField?: string;
  description?: string;
}

/** Tons over the allowance past aboveTons bill at centsPerTon instead of the base overage rate. */
export interface OverageTier {
  aboveTons: number;
  centsPerTon: number;
}

/**
 * A roll-off material. Exactly one is `standard`: it is priced by the size's published haul RateVersion and the
 * catalog's rolloff terms. Every other material is priced by RolloffRate cells in the size by material matrix.
 * ticketCodes are the ScaleTicket.material values that map to it.
 */
export interface RolloffMaterial {
  id: string;
  name: string;
  ticketCodes: string[];
  handling: 'standard' | 'accepted' | 'restricted' | 'prohibited';
  heavy?: boolean;
  /** Heavy loads may only be filled to this share of the box. */
  maxFillPct?: number;
  /** What the disposal facility charges the hauler per ton, for margin. */
  disposalCentsPerTon?: number;
  note?: string;
}

/** One cell of the roll-off size by material matrix. A new price is a new row with supersedesId; rows are never edited. */
export interface RolloffRate {
  id: string;
  catalogId: string;
  materialId: string;
  /** False: this material is not accepted in this size. */
  available: boolean;
  /** Added to the size's published haul price. */
  haulDeltaCents: number;
  includedTons: number;
  overageCentsPerTon: number;
  overageTiers?: OverageTier[];
  minBilledTons?: number;
  effectiveFrom: string;
  publishedAt?: string;
  supersedesId?: string;
}

/**
 * A dimension a rate or an adjustment can be keyed by (pricing model, DECISIONS.md entry 65). source says where the
 * engine reads a line's value: a field of the line (zone, frequency, service, category, lob, cycle, dayOfWeek,
 * material), the line's account or site (assignments), or the quote (input, asked when pricing; billing uses the
 * default). Built-in dimensions list their values from their own tables; the others carry values a person manages.
 */
export interface PricingDimension {
  id: string;
  name: string;
  source: 'zone' | 'geoZone' | 'frequency' | 'service' | 'category' | 'lob' | 'cycle' | 'dayOfWeek' | 'material' | 'account' | 'site' | 'serviceLine' | 'input';
  /**
   * What a person enters (custom fields, DECISIONS.md entry 68). choice: one of the values. number: a number in unit,
   * matched to the value (band) whose min to max contains it. yesNo: values yes and no. text: kept for reference,
   * never priced. Absent means choice.
   */
  type?: 'choice' | 'number' | 'yesNo' | 'text';
  /** number fields: what the number counts, e.g. "collections per month", "lbs", "cubic yards". */
  unit?: string;
  /** For a number field each value is a band: min inclusive, max exclusive, either open. */
  values: { id: string; label: string; min?: number; max?: number }[];
  /** The value a line has when nothing assigns one: an account with no tier is standard. A number field's default number. */
  defaultValueId?: string;
  /** account, site, and serviceLine fields: account, site, or service item id to the value id (a number field's number). */
  assignments?: Record<string, string>;
  description?: string;
  builtIn?: boolean;
}

/** A group of services the owner defines. Its LOB decides how billing treats the services in it. */
export interface ServiceCategory {
  id: string;
  name: string;
  lob: LOB;
  description?: string;
}

/**
 * A zone drawn on the map (DECISIONS.md entry 69): a polygon around a city, a neighborhood, or a stretch of county. A
 * site is in the first zone, in list order, whose polygon contains its coordinates; a site outside every polygon is in
 * none. Rates and adjustments key on it through the built-in field geoZone. Separate from Zone, which is the zone type
 * (open market, boundary, franchise, not served) that decides serviceability and tax.
 */
export interface GeoZone {
  id: string;
  name: string;
  /** Vertices in order, as [lat, lng]; the last joins the first. At least three. */
  polygon: [number, number][];
  /** A CSS color for the map. */
  color?: string;
  description?: string;
}

/** Hauler-wide roll-off rules. One row. */
export interface RolloffPolicy {
  id: string;
  /** How scale ticket tons are rounded, always up to the increment, before the allowance is taken off. */
  tonRounding: 'exact' | 'tenth' | 'quarter' | 'half' | 'whole';
  /** Hauls inside this radius from the yard carry no trip charge. */
  freeRadiusMiles: number;
  /** Per haul, per mile beyond the free radius. */
  tripCentsPerMile: number;
  /** Dump and return. */
  swapCents: number;
  relocationCents: number;
  /** Box blocked or not ready when the driver arrives. */
  dryRunCents: number;
  prohibitedItems: { id: string; name: string; cents: number }[];
}

export interface Container {
  id: string;
  serial: string;
  catalogId: string;
  siteId?: string;
  assignedFrom?: string;
}

export interface ServiceItem {
  id: string;
  siteId: string;
  catalogId: string;
  qty: number;
  frequency: Frequency;
  containerIds: string[];
  effectiveFrom: string;
  effectiveTo?: string;
  status: 'active' | 'held' | 'ended';
}

export interface RateVersion {
  id: string;
  catalogId: string;
  zoneId?: string;
  frequency?: Frequency;
  priceCents: number;
  effectiveFrom: string;
  status: 'draft' | 'published';
  publishedAt?: string;
  supersedesId?: string;
  /**
   * Extra dimension values this rate is keyed by beyond catalog, zone, and frequency (PricingDimension id to value
   * id). A rate matches a line only when the line has every one of them; among matches the most specific wins.
   */
  dims?: Record<string, string>;
  /**
   * Who the rate bills. 'everyone' (or absent): every line it matches, from effectiveFrom. 'newService': only service
   * that starts on or after effectiveFrom; a line already in service keeps the rate it had (DECISIONS.md entry 67).
   */
  appliesTo?: 'everyone' | 'newService';
}

/**
 * A fee, surcharge, or credit on a charge line. A negative value is a credit. The optional fields scope a rule and
 * give it a life; each one left out means "no restriction", so a rule with none of them applies as it always did.
 * A change is a new row with supersedesId, effective from a date; the old row gets effectiveTo and is kept.
 */
export interface FeeRule {
  id: string;
  name: string;
  kind: 'percent' | 'flat';
  value: number;
  base: 'serviceLines' | 'allLines';
  appliesTo: LineType[];
  taxable: boolean;
  category?: 'surcharge' | 'regulatory' | 'location' | 'credit';
  description?: string;
  status?: 'active' | 'paused';
  /** Conditions on any PricingDimension: the line's value must be one of the listed ids. Empty means any. */
  when?: Record<string, string[]>;
  /** Of the rules in one group that apply to a line, only the largest one (by size) is taken: discounts do not stack. */
  stackGroup?: string;
  /** Distance band from the yard in miles, min inclusive, max exclusive. Needs Site.milesFromYard. */
  minMiles?: number;
  maxMiles?: number;
  /** Density: at least this many stops within a quarter mile. Needs Site.neighborStops. */
  minNeighborStops?: number;
  /** Floor and cap on the size of the fee, in cents per month of the line (once for a line with no period). */
  minCents?: number;
  maxCents?: number;
  /** Skip lines a contract override priced: the contract price is all in. */
  exemptContracts?: boolean;
  effectiveFrom?: string;
  effectiveTo?: string;
  supersedesId?: string;
}

/** One tax layer for a zone. A zone's layers add up (state plus county plus city). Late fees are never taxed. */
export interface TaxRule {
  id: string;
  zoneId: string;
  ratePct: number;
  appliesTo: LineType[];
  name?: string;
  jurisdiction?: 'state' | 'county' | 'city' | 'district';
  /** Conditions on any PricingDimension, as on FeeRule. */
  when?: Record<string, string[]>;
  status?: 'active' | 'paused';
  effectiveFrom?: string;
  effectiveTo?: string;
  supersedesId?: string;
}

export interface Contract {
  id: string;
  accountId: string;
  termStart: string;
  termEnd: string;
  renewalNoticeDays: number;
  overrides: {
    catalogId: string;
    frequency?: Frequency;
    priceCents: number;
    reason?: string;
    pctBelowRateCard?: number;
  }[];
  escalator?: {
    kind: 'fixedPct' | 'cpi';
    pct: number;
    anniversary: string;
  };
}

export interface Quote {
  id: string;
  kind: 'residentialSignup' | 'commercialRequest';
  address: string;
  zoneId?: string;
  lines: {
    catalogId: string;
    qty: number;
    frequency: Frequency;
    priceCents: number;
  }[];
  dueTodayCents: number;
  recurringCents: number;
  status: 'draft' | 'held' | 'accepted' | 'declined' | 'expired';
  holdReason?: string;
  holdDeadline?: string;
  expiresAt: string;
  paymentTokenId?: string;
  createdVia: 'storefront' | 'agent' | 'phone';
}

export interface WorkOrder {
  id: string;
  siteId: string;
  kind: 'deliver' | 'swap' | 'remove' | 'extraPickup' | 'recovery' | 'dumpAndReturn';
  status: 'open' | 'scheduled' | 'done' | 'cancelled';
  scheduledFor: string;
  serviceItemId?: string;
  containerId?: string;
  requestId?: string;
  completedAt?: string;
}

export interface ServiceEvent {
  id: string;
  siteId: string;
  routeId: string;
  date: string;
  outcome: 'completed' | 'missed' | 'blocked' | 'skippedSuspended';
  exception?: 'extraBags' | 'overload' | 'contamination' | 'dryRun' | 'notOut';
  photoUrl?: string;
  note?: string;
  driver: string;
}

export interface ScaleTicket {
  id: string;
  workOrderId: string;
  containerId: string;
  facility: string;
  material: string;
  grossLbs: number;
  tareLbs: number;
  netLbs: number;
  ticketedAt: string;
}

export interface Charge {
  id: string;
  accountId: string;
  siteId: string;
  lineType: LineType;
  catalogId?: string;
  description: string;
  source: {
    type: 'serviceItem' | 'serviceEvent' | 'scaleTicket' | 'manual';
    id: string;
  };
  period?: {
    start: string;
    end: string;
  };
  servicedOn?: string;
  baseCents: number;
  fees: {
    feeRuleId: string;
    cents: number;
  }[];
  taxCents: number;
  totalCents: number;
  pricing: {
    rateVersionId?: string;
    contractId?: string;
    ruleWon: 'contractOverride' | 'zoneRate' | 'standardRate' | 'manualException';
  };
  status: 'proposed' | 'approved' | 'waived' | 'posted';
  evidenceIds: string[];
}

export interface WaivedCharge {
  chargeId: string;
  reason: 'goodwill' | 'salesPromise' | 'insufficientEvidence' | 'operationalFault' | 'immaterial';
  note?: string;
  by: string;
  at: string;
}

export interface Invoice {
  id: string;
  accountId: string;
  number: string;
  chargeIds: string[];
  subtotalCents: number;
  feeCents: number;
  taxCents: number;
  totalCents: number;
  issuedAt: string;
  dueAt: string;
  postedAt?: string;
  locked: boolean;
  deliveredVia: InvoiceDelivery;
}

export interface CreditMemo {
  id: string;
  accountId: string;
  invoiceId?: string;
  cents: number;
  reason: string;
  by: string;
  at: string;
}

export interface Payment {
  id: string;
  accountId: string;
  method: 'check' | 'card' | 'ach' | 'autopay' | 'cash';
  cents: number;
  receivedAt: string;
  processorBatchId?: string;
  status: 'pending' | 'settled' | 'returned';
}

export interface PaymentAllocation {
  sourceType: 'payment' | 'creditMemo';
  sourceId: string;
  invoiceId: string;
  cents: number;
}

export interface ProcessorBatch {
  id: string;
  depositedAt: string;
  grossCents: number;
  feeCents: number;
  netCents: number;
  paymentIds: string[];
}

export interface Request {
  id: string;
  accountId: string;
  siteId: string;
  kind:
    | 'extraPickup' | 'vacationHold' | 'cartChange' | 'missedPickup' | 'quote'
    | 'damagedCart' | 'bulkyItem' | 'addCart' | 'stopService' | 'billingQuestion' | 'other';
  status: 'open' | 'scheduled' | 'done' | 'declined';
  createdVia: 'portal' | 'phone' | 'agent' | 'storefront';
  workOrderId?: string;
  note?: string;
}
