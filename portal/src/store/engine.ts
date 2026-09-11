// Pricing and charge engine. Signatures are fixed by SHARED_CONTRACT.md; do not change them.
// The engine reads whichever tables are bound (the zustand store once it loads, the raw seed in tests)
// so a mutation in the store is visible to the next resolvePrice or computeCharge call.

import type {
  BillingAccount, Charge, Frequency, Invoice, LineType, PaymentAllocation, RateVersion,
} from '../types';
import { seed, type Seed } from '../seed';
import { newId } from './ids';
import { TODAY, addDays, parseISO, toISODate } from './clock';

export type Tables = Seed;

let tablesProvider: () => Tables = () => seed;

/** Point the engine at a live table set (the store does this once). Tests can rebind to a fixture. */
export function bindTables(provider: () => Tables): void {
  tablesProvider = provider;
}

export function tables(): Tables {
  return tablesProvider();
}

/** Round half up on a positive cents value. Every percent fee and tax uses this. */
export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

function pct(cents: number, rate: number): number {
  return roundHalfUp((cents * rate) / 100);
}

// ---------------------------------------------------------------------------
// resolvePrice
// ---------------------------------------------------------------------------

export interface ResolvePriceArgs {
  catalogId: string;
  frequency?: Frequency;
  zoneId: string;
  accountId: string;
  onDate: string;
}

export interface ResolvedPrice {
  priceCents: number;
  rateVersionId?: string;
  contractId?: string;
  ruleWon: Charge['pricing']['ruleWon'];
}

function latestVersionNotAfter(versions: RateVersion[], onDate: string): RateVersion | undefined {
  const day = onDate.slice(0, 10);
  return versions
    .filter((v) => v.status === 'published' && v.effectiveFrom.slice(0, 10) <= day)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0))[0];
}

/**
 * Precedence: contract override for this account and catalog (frequency must match when the override names one)
 * > published RateVersion matching zone and frequency > published RateVersion with no zone > throw.
 * Within a tier the version whose effectiveFrom is latest but not after onDate wins.
 */
export function resolvePrice(args: ResolvePriceArgs): ResolvedPrice {
  const { catalogId, frequency, zoneId, accountId, onDate } = args;
  const db = tables();
  const day = onDate.slice(0, 10);

  const account = db.accounts.find((a) => a.id === accountId);
  const contracts = db.contracts.filter(
    (c) => c.accountId === accountId || (account?.contractId && c.id === account.contractId),
  );
  for (const contract of contracts) {
    const inTerm = contract.termStart.slice(0, 10) <= day && day <= contract.termEnd.slice(0, 10);
    if (!inTerm) continue;
    const override = contract.overrides.find(
      (o) => o.catalogId === catalogId && (o.frequency === undefined || o.frequency === frequency),
    );
    if (override) {
      return { priceCents: override.priceCents, contractId: contract.id, ruleWon: 'contractOverride' };
    }
  }

  const forCatalog = db.rateVersions.filter((v) => v.catalogId === catalogId);
  const frequencyMatches = (v: RateVersion) => v.frequency === undefined || v.frequency === frequency;

  const zoneVersion = latestVersionNotAfter(
    forCatalog.filter((v) => v.zoneId === zoneId && frequencyMatches(v)),
    onDate,
  );
  if (zoneVersion) {
    return { priceCents: zoneVersion.priceCents, rateVersionId: zoneVersion.id, ruleWon: 'zoneRate' };
  }

  const standardVersion = latestVersionNotAfter(
    forCatalog.filter((v) => v.zoneId === undefined && frequencyMatches(v)),
    onDate,
  );
  if (standardVersion) {
    return { priceCents: standardVersion.priceCents, rateVersionId: standardVersion.id, ruleWon: 'standardRate' };
  }

  throw new Error(
    `No published rate for ${catalogId}${frequency ? ` at ${frequency}` : ''} in ${zoneId} on ${day}`,
  );
}

// ---------------------------------------------------------------------------
// computeCharge
// ---------------------------------------------------------------------------

export type ComputeChargeArgs = {
  accountId: string;
  siteId: string;
  lineType: LineType;
  baseCents: number;
  source: Charge['source'];
  catalogId?: string;
  /** Used only to resolve the pricing block when catalogId is given. */
  frequency?: Frequency;
  description?: string;
} & ({ servicedOn: string; period?: undefined } | { period: { start: string; end: string }; servicedOn?: undefined });

/**
 * Whole calendar months a charge period covers (2026-07-01..2026-09-30 is 3). A servicedOn line, or no period, is 1.
 * Periods start on the 1st and end on a month end, so counting calendar months is exact.
 */
export function monthsInPeriod(period?: { start: string; end: string }): number {
  if (!period) return 1;
  const [sy, sm] = period.start.slice(0, 7).split('-').map(Number);
  const [ey, em] = period.end.slice(0, 7).split('-').map(Number);
  return Math.max(1, (ey - sy) * 12 + (em - sm) + 1);
}

/**
 * Applies every FeeRule whose appliesTo includes lineType (percent fees use baseCents when base is serviceLines,
 * flat fees once per whole month in the period, addendum C5), then the site zone's TaxRule on base plus taxable fees.
 * Account taxExempt skips tax. Late fees are never taxed. Fees and tax are fixed here, never at invoice time.
 */
export function computeCharge(args: ComputeChargeArgs): Charge {
  const db = tables();
  const { accountId, siteId, lineType, baseCents, source, catalogId, frequency } = args;
  const account = db.accounts.find((a) => a.id === accountId);
  if (!account) throw new Error(`Unknown account ${accountId}`);
  const site = db.sites.find((s) => s.id === siteId);
  if (!site) throw new Error(`Unknown site ${siteId}`);
  if (!Number.isInteger(baseCents) || baseCents < 0) throw new Error('baseCents must be a non-negative integer');

  const fees: Charge['fees'] = [];
  for (const rule of db.feeRules) {
    if (!rule.appliesTo.includes(lineType)) continue;
    // Addendum C5: a flat fee applies once per whole month in the charge's period (a quarterly line carries 3x).
    const cents = rule.kind === 'percent' ? pct(baseCents, rule.value) : rule.value * monthsInPeriod(args.period);
    fees.push({ feeRuleId: rule.id, cents });
  }

  let taxCents = 0;
  const taxRule = db.taxRules.find((t) => t.zoneId === site.zoneId);
  if (taxRule && !account.taxExempt && lineType !== 'lateFee') {
    let taxable = 0;
    if (taxRule.appliesTo.includes(lineType)) taxable += baseCents;
    if (taxRule.appliesTo.includes('fee')) {
      for (const f of fees) {
        const rule = db.feeRules.find((r) => r.id === f.feeRuleId);
        if (rule?.taxable) taxable += f.cents;
      }
    }
    taxCents = pct(taxable, taxRule.ratePct);
  }

  const feeTotal = fees.reduce((sum, f) => sum + f.cents, 0);
  const totalCents = baseCents + feeTotal + taxCents;

  const onDate = args.servicedOn ?? args.period.start;
  let pricing: Charge['pricing'] = { ruleWon: 'standardRate' };
  if (catalogId) {
    const resolved = resolvePrice({ catalogId, frequency, zoneId: site.zoneId, accountId, onDate });
    pricing = { ruleWon: resolved.ruleWon };
    if (resolved.rateVersionId) pricing.rateVersionId = resolved.rateVersionId;
    if (resolved.contractId) pricing.contractId = resolved.contractId;
  }

  const catalog = catalogId ? db.catalog.find((c) => c.id === catalogId) : undefined;
  const description =
    args.description ??
    (catalog ? `${catalog.name}${frequency ? `, ${frequencyLabel(frequency)}` : ''}` : `${lineType} line`);

  const charge: Charge = {
    id: newId('chg'),
    accountId,
    siteId,
    lineType,
    description,
    source,
    baseCents,
    fees,
    taxCents,
    totalCents,
    pricing,
    status: 'proposed',
    evidenceIds: [],
  };
  if (catalogId) charge.catalogId = catalogId;
  if (args.period) charge.period = { ...args.period };
  if (args.servicedOn) charge.servicedOn = args.servicedOn;
  return charge;
}

// ---------------------------------------------------------------------------
// allocate
// ---------------------------------------------------------------------------

export interface AllocateArgs {
  sourceType: PaymentAllocation['sourceType'];
  sourceId: string;
  invoiceIds: string[];
  cents: number[];
}

/** Open balance of an invoice given the bound tables: total minus every allocation already applied to it. */
export function openBalance(invoice: Invoice): number {
  const applied = tables()
    .allocations.filter((a) => a.invoiceId === invoice.id)
    .reduce((sum, a) => sum + a.cents, 0);
  return invoice.totalCents - applied;
}

/**
 * Builds one PaymentAllocation per invoice. Throws when any amount exceeds that invoice's open balance,
 * when the lists disagree in length, or when an amount is not a positive integer. Does not write anything;
 * the store's addAllocations does that, so a bad allocation never half-applies.
 */
export function allocate(args: AllocateArgs): PaymentAllocation[] {
  const { sourceType, sourceId, invoiceIds, cents } = args;
  if (invoiceIds.length !== cents.length) throw new Error('invoiceIds and cents must be the same length');
  if (invoiceIds.length === 0) throw new Error('Nothing to allocate');
  const db = tables();
  const out: PaymentAllocation[] = [];
  for (let i = 0; i < invoiceIds.length; i++) {
    const invoice = db.invoices.find((inv) => inv.id === invoiceIds[i]);
    if (!invoice) throw new Error(`Unknown invoice ${invoiceIds[i]}`);
    const amount = cents[i];
    if (!Number.isInteger(amount) || amount <= 0) throw new Error(`Allocation to ${invoice.id} must be a positive integer`);
    const open = openBalance(invoice);
    if (amount > open) {
      throw new Error(`Allocation of ${amount} to ${invoice.id} exceeds its open balance of ${open}`);
    }
    out.push({ sourceType, sourceId, invoiceId: invoice.id, cents: amount });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Office-side generators. The portal never runs these; the signatures are kept so the merge sees one contract.
// ---------------------------------------------------------------------------

export function generateRecurringCharges(_args: { cycleDate: string }): Charge[] {
  throw new Error('not implemented in portal');
}

export function generateEventCharges(): Charge[] {
  throw new Error('not implemented in portal');
}

export function postInvoices(_args: { chargeIds: string[] }): Invoice[] {
  throw new Error('not implemented in portal');
}

// ---------------------------------------------------------------------------
// Cycle math shared by the Overview estimate and the request flows
// ---------------------------------------------------------------------------

/** Months covered by one invoice for this account's cycle. perJob accounts are billed per work order, not on a cycle. */
export function monthsInCycle(account: BillingAccount): number {
  switch (account.cycle) {
    case 'quarterly':
      return 3;
    case 'monthly':
    case 'net30':
      return 1;
    case 'perJob':
      return 0;
  }
}

/**
 * First day of the next billing cycle after fromDate: the first of next month for monthly and net30,
 * the first day of the next calendar quarter for quarterly. perJob accounts have no cycle and get the next month.
 */
export function nextCycleStart(account: BillingAccount, fromDate: string = TODAY): string {
  const d = parseISO(fromDate);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (account.cycle === 'quarterly') {
    const nextQuarterMonth = (Math.floor(m / 3) + 1) * 3;
    return toISODate(new Date(Date.UTC(y, nextQuarterMonth, 1)));
  }
  return toISODate(new Date(Date.UTC(y, m + 1, 1)));
}

/** Last day of the cycle that starts on cycleStart. */
export function cycleEnd(account: BillingAccount, cycleStart: string): string {
  const d = parseISO(cycleStart);
  const months = Math.max(1, monthsInCycle(account));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  return addDays(toISODate(end), -1);
}

/**
 * The service period the next invoice will cover. Accounts billed in advance are invoiced for the cycle that
 * starts next; accounts billed in arrears (Oakridge, net30) are invoiced for the cycle that is running now.
 */
export function nextInvoicePeriod(account: BillingAccount, fromDate: string = TODAY): { start: string; end: string } {
  const upcoming = nextCycleStart(account, fromDate);
  if (account.billedInAdvance) return { start: upcoming, end: cycleEnd(account, upcoming) };
  const d = parseISO(fromDate);
  const months = Math.max(1, monthsInCycle(account));
  const currentStartMonth = Math.floor(d.getUTCMonth() / months) * months;
  const start = toISODate(new Date(Date.UTC(d.getUTCFullYear(), currentStartMonth, 1)));
  return { start, end: cycleEnd(account, start) };
}

export function frequencyLabel(frequency: Frequency): string {
  switch (frequency) {
    case 'weekly':
      return 'weekly';
    case 'eow':
      return 'every other week';
    case '2x':
      return '2x weekly';
    case '3x':
      return '3x weekly';
    case 'onCall':
      return 'on call';
  }
}

// ---------------------------------------------------------------------------
// Vacation hold policy (DECISIONS.md entry 5: Hauler.policy has no hold fields, so the constants live here)
// ---------------------------------------------------------------------------

export const HOLD_POLICY = { minDays: 7, maxDays: 90 } as const;

export const HOLD_POLICY_TEXT = `Holds must be at least ${HOLD_POLICY.minDays} days and at most ${HOLD_POLICY.maxDays} days`;

export interface HoldCheck {
  ok: boolean;
  /** Whole days from start to end (end minus start). */
  days: number;
  /** Plain-words reason when the range is not allowed. */
  reason?: string;
}

/** Whole days between two ISO dates, end minus start. Negative when end is before start. */
export function daysBetween(start: string, end: string): number {
  const ms = parseISO(end).getTime() - parseISO(start).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * Checks a requested hold range against HOLD_POLICY. Both dates must be on or after tomorrow, the end must be
 * after the start, and the length must fall inside [minDays, maxDays]. Returns the first failing reason.
 */
export function checkHoldPolicy(start: string, end: string, today: string = TODAY): HoldCheck {
  const tomorrow = addDays(today, 1);
  const days = daysBetween(start, end);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return { ok: false, days: 0, reason: 'Pick both a start and an end date' };
  }
  if (start < tomorrow) return { ok: false, days, reason: `The hold must start on or after ${tomorrow}` };
  if (end <= start) return { ok: false, days, reason: 'The hold must end after it starts' };
  if (days < HOLD_POLICY.minDays) {
    return { ok: false, days, reason: `This hold is ${days} day${days === 1 ? '' : 's'}, shorter than the ${HOLD_POLICY.minDays} day minimum` };
  }
  if (days > HOLD_POLICY.maxDays) {
    return { ok: false, days, reason: `This hold is ${days} days, longer than the ${HOLD_POLICY.maxDays} day maximum` };
  }
  return { ok: true, days };
}

// ---------------------------------------------------------------------------
// Missed pickup window (Phase 5). Hauler.policy has no reporting window, so the constant lives here like HOLD_POLICY.
// ---------------------------------------------------------------------------

/** A missed pickup can be reported for a route day in the last 21 days, TODAY included (portal-local, DECISIONS.md entry 47). */
export const MISSED_PICKUP_WINDOW_DAYS = 21;

/** The earliest and latest dates the missed pickup date picker allows. */
export function missedPickupWindow(today: string = TODAY): { min: string; max: string } {
  return { min: addDays(today, -MISSED_PICKUP_WINDOW_DAYS), max: today };
}
