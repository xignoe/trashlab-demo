// CANONICAL types.ts for the TrashLab MVP. Source: prompts/SHARED_CONTRACT.md, section "src/types.ts".
// This copy lives in shared/ and is the one the merge uses. Every surface src/types.ts must be byte-identical to it below this header.
// Do not edit locally. Changes go through shared/CONTRACT_ADDENDUM.md.

export type LOB = 'residential' | 'frontload' | 'rolloff';
export type Frequency = 'weekly' | 'eow' | '2x' | '3x' | 'onCall';
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
  cycle: 'monthly' | 'quarterly' | 'perJob' | 'net30';
  billedInAdvance: boolean;
  autopay: boolean;
  paymentMethodOnFile?: 'card' | 'ach';
  status: 'active' | 'pastDue' | 'suspended' | 'hold';
  deliveryMethod: 'email' | 'mail' | 'portal';
  taxExempt: boolean;
  contractId?: string;
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
  };
  public: boolean;
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
}

export interface FeeRule {
  id: string;
  name: string;
  kind: 'percent' | 'flat';
  value: number;
  base: 'serviceLines' | 'allLines';
  appliesTo: LineType[];
  taxable: boolean;
}

export interface TaxRule {
  id: string;
  zoneId: string;
  ratePct: number;
  appliesTo: LineType[];
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
  deliveredVia: 'email' | 'mail' | 'portal';
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
  kind: 'extraPickup' | 'vacationHold' | 'cartChange' | 'missedPickup' | 'quote';
  status: 'open' | 'scheduled' | 'done' | 'declined';
  createdVia: 'portal' | 'phone' | 'agent' | 'storefront';
  workOrderId?: string;
  note?: string;
}
