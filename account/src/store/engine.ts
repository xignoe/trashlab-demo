// Billing and pricing engine for the account view. Signatures follow prompts/SHARED_CONTRACT.md.
//
// Every function that reads state is pure over an EntityState snapshot passed as the trailing
// argument (defaulting to the live store), so previewNextRun and Phase 4's before-and-after
// preview can run on a shadow copy without touching the store. Store actions in useStore.ts
// wrap the functions that produce new rows and append them; nothing here mutates its input.
//
// Money is integer cents rounded half up with Math.round at the point a fee or tax is computed.
// Runtime ids carry the `ac` infix (addendum C12). Dates are ISO strings from clock.ts. History is never deleted: closing a ServiceItem sets
// effectiveTo and status, and every collection only ever grows.

import type {
  BillingAccount, Charge, Container, Contract, CreditMemo, FeeRule, Frequency, Invoice, LineType, Payment,
  PaymentAllocation, RateVersion, Request, ServiceCatalog, ServiceEvent, ServiceItem, TaxRule, WorkOrder,
} from '../types';
import { seed, type PricedException } from '../seed';
import { TODAY, addDays, daysBetween, startOfNextMonth, startOfNextQuarter } from './clock';
import { listOf, useStore, type Collection, type EntityState } from './useStore';

// ---------------------------------------------------------------------------------------------
// Constants and small helpers
// ---------------------------------------------------------------------------------------------

/**
 * Cents charged per ServiceEvent exception, read from state.eventRates (src/seed/eventRates.json,
 * addendum B4) rather than an engine constant. notOut has no rate and never produces a charge.
 */
export function eventRateCents(exception: NonNullable<ServiceEvent['exception']>, state: EntityState = live()): number {
  if (exception === 'notOut') return 0;
  return state.eventRates[exception as PricedException] ?? 0;
}

const EXCEPTION_LABEL: Record<NonNullable<ServiceEvent['exception']>, string> = {
  extraBags: 'Loose bag fee',
  overload: 'Overload fee',
  contamination: 'Contamination fee',
  dryRun: 'Dry run fee',
  notOut: 'Not out',
};

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  weekly: 'weekly',
  eow: 'every other week',
  '2x': '2x per week',
  '3x': '3x per week',
  onCall: 'on call',
};

export class PriceNotFound extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PriceNotFound';
  }
}

export class AllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AllocationError';
  }
}

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

/** Half-up rounding to integer cents. */
export function roundCents(n: number): number {
  return Math.round(n);
}

// Fresh ids for rows created at runtime (addendum C12). Every runtime id carries the account
// surface infix `ac` (si_ac_0097, wo_ac_0008, pay_ac_0031, ch_ac_0902) so it can never collide with
// another surface's ids at merge. Each prefix's counter starts above the highest numeric suffix any
// seed id with that prefix carries, so a runtime id also never shadows a seed id.
export const RUNTIME_ID_INFIX = 'ac';
let seedSuffixMax: Map<string, number> | undefined;

/** Highest trailing number on any seed id with this prefix (ch_fl_008_0901 counts as 901 for `ch`); 0 when none. */
export function highestSeedSuffix(prefix: string): number {
  if (!seedSuffixMax) {
    seedSuffixMax = new Map();
    for (const rows of Object.values(seed)) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows as { id?: unknown }[]) {
        if (typeof row.id !== 'string') continue;
        const m = /^([a-z]+)_.*?(\d+)$/.exec(row.id);
        if (m) seedSuffixMax.set(m[1], Math.max(seedSuffixMax.get(m[1]) ?? 0, Number(m[2])));
      }
    }
  }
  return seedSuffixMax.get(prefix) ?? 0;
}

const counters: Record<string, number> = {};
const formatId = (prefix: string, n: number) => `${prefix}_${RUNTIME_ID_INFIX}_${String(n).padStart(4, '0')}`;

/** Allocates the next runtime id for a prefix. */
export function newId(prefix: string): string {
  counters[prefix] = (counters[prefix] ?? highestSeedSuffix(prefix)) + 1;
  return formatId(prefix, counters[prefix]);
}

/** The id newId(prefix) would return next, without consuming it (drawer previews show the exact id confirm will write). */
export function peekId(prefix: string): string {
  return formatId(prefix, (counters[prefix] ?? highestSeedSuffix(prefix)) + 1);
}

/** Serials for containers created at runtime, in the seed's PD-CART / PD-FL / PD-RO pattern with a 9xxx block the seed never uses. */
let serialSeq = 9000;
const serialPrefix = (catalog: ServiceCatalog) => (catalog.unit === 'cart' ? 'PD-CART' : catalog.unit === 'box' ? 'PD-RO' : 'PD-FL');
function newSerial(catalog: ServiceCatalog): string {
  serialSeq += 1;
  return `${serialPrefix(catalog)}-${serialSeq}`;
}
function peekSerial(catalog: ServiceCatalog): string {
  return `${serialPrefix(catalog)}-${serialSeq + 1}`;
}

function live(): EntityState {
  return useStore.getState();
}

function must<T>(row: T | undefined, what: string): T {
  if (!row) throw new EngineError(`${what} not found`);
  return row;
}

/** Whole months covered by an inclusive period of full calendar months. */
export function monthsInPeriod(period: { start: string; end: string }): number {
  const y = (iso: string) => Number(iso.slice(0, 4));
  const m = (iso: string) => Number(iso.slice(5, 7));
  return (y(period.end) - y(period.start)) * 12 + (m(period.end) - m(period.start)) + 1;
}

function accountOfSite(siteId: string, state: EntityState): BillingAccount {
  const site = must(state.sites.byId[siteId], `Site ${siteId}`);
  return must(state.billingAccounts.byId[site.accountId], `BillingAccount ${site.accountId}`);
}

function contractFor(accountId: string, state: EntityState): Contract | undefined {
  const account = state.billingAccounts.byId[accountId];
  if (account?.contractId && state.contracts.byId[account.contractId]) return state.contracts.byId[account.contractId];
  return listOf(state.contracts).find((c) => c.accountId === accountId);
}

// ---------------------------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------------------------

export interface ResolvePriceArgs {
  catalogId: string;
  frequency: Frequency;
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

/** Published versions for the catalog whose effectiveFrom is not after onDate, latest first. */
function candidateVersions(catalogId: string, onDate: string, state: EntityState): RateVersion[] {
  return listOf(state.rateVersions)
    .filter((rv) => rv.catalogId === catalogId && rv.status === 'published' && rv.effectiveFrom <= onDate)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0));
}

function findRateVersion(args: ResolvePriceArgs, state: EntityState): { version: RateVersion; ruleWon: 'zoneRate' | 'standardRate' } | undefined {
  const candidates = candidateVersions(args.catalogId, args.onDate, state);
  const frequencyMatches = (rv: RateVersion) => rv.frequency === undefined || rv.frequency === args.frequency;
  const zone = candidates.find((rv) => rv.zoneId === args.zoneId && frequencyMatches(rv));
  if (zone) return { version: zone, ruleWon: 'zoneRate' };
  const standard = candidates.find((rv) => rv.zoneId === undefined && frequencyMatches(rv));
  if (standard) return { version: standard, ruleWon: 'standardRate' };
  return undefined;
}

function findContractOverride(args: ResolvePriceArgs, state: EntityState) {
  const contract = contractFor(args.accountId, state);
  if (!contract) return undefined;
  if (args.onDate < contract.termStart || args.onDate > contract.termEnd) return undefined;
  const override = contract.overrides.find(
    (o) => o.catalogId === args.catalogId && (o.frequency === undefined || o.frequency === args.frequency),
  );
  return override ? { contract, override } : undefined;
}

/**
 * Contract override for this account and catalog > published RateVersion matching zone and
 * frequency > published RateVersion with no zone > throw PriceNotFound. Among matching versions
 * the one whose effectiveFrom is latest but not after onDate wins.
 */
export function resolvePrice(args: ResolvePriceArgs, state: EntityState = live()): ResolvedPrice {
  const hit = findContractOverride(args, state);
  if (hit) return { priceCents: hit.override.priceCents, contractId: hit.contract.id, ruleWon: 'contractOverride' };
  const rate = findRateVersion(args, state);
  if (rate) return { priceCents: rate.version.priceCents, rateVersionId: rate.version.id, ruleWon: rate.ruleWon };
  throw new PriceNotFound(`No published price for ${args.catalogId} ${args.frequency} in ${args.zoneId} on ${args.onDate}`);
}

export interface PriceExplanation {
  ruleWon: Charge['pricing']['ruleWon'];
  priceCents: number;
  catalogId: string;
  zoneId: string;
  frequency: Frequency;
  onDate: string;
  contractOverride?: {
    contractId: string;
    priceCents: number;
    frequency?: Frequency;
    reason?: string;
    pctBelowRateCard?: number;
    termStart: string;
    termEnd: string;
  };
  /** The rate card version that won, or that would have won had the contract not. */
  rateVersion?: {
    id: string;
    priceCents: number;
    effectiveFrom: string;
    publishedAt?: string;
    zoneId?: string;
    frequency?: Frequency;
    ruleWon: 'zoneRate' | 'standardRate';
  };
  /** The version rateVersion superseded, when present. */
  priorVersion?: { id: string; priceCents: number; effectiveFrom: string; publishedAt?: string };
}

/** Full precedence chain behind resolvePrice, for the price source popover. */
export function explainPrice(args: ResolvePriceArgs, state: EntityState = live()): PriceExplanation {
  const resolved = resolvePrice(args, state);
  const out: PriceExplanation = {
    ruleWon: resolved.ruleWon,
    priceCents: resolved.priceCents,
    catalogId: args.catalogId,
    zoneId: args.zoneId,
    frequency: args.frequency,
    onDate: args.onDate,
  };
  const hit = findContractOverride(args, state);
  if (hit) {
    out.contractOverride = {
      contractId: hit.contract.id,
      priceCents: hit.override.priceCents,
      frequency: hit.override.frequency,
      reason: hit.override.reason,
      pctBelowRateCard: hit.override.pctBelowRateCard,
      termStart: hit.contract.termStart,
      termEnd: hit.contract.termEnd,
    };
  }
  const rate = findRateVersion(args, state);
  if (rate) {
    const v = rate.version;
    out.rateVersion = {
      id: v.id, priceCents: v.priceCents, effectiveFrom: v.effectiveFrom, publishedAt: v.publishedAt,
      zoneId: v.zoneId, frequency: v.frequency, ruleWon: rate.ruleWon,
    };
    const prior = v.supersedesId ? state.rateVersions.byId[v.supersedesId] : undefined;
    if (prior) out.priorVersion = { id: prior.id, priceCents: prior.priceCents, effectiveFrom: prior.effectiveFrom, publishedAt: prior.publishedAt };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Charges
// ---------------------------------------------------------------------------------------------

export type ComputeChargeArgs = {
  accountId: string;
  siteId: string;
  lineType: LineType;
  baseCents: number;
  source: Charge['source'];
  catalogId?: string;
  description: string;
  pricing?: Charge['pricing'];
} & ({ servicedOn: string; period?: undefined } | { period: { start: string; end: string }; servicedOn?: undefined });

function feeCents(rule: FeeRule, lineType: LineType, baseCents: number, months: number): number | undefined {
  if (!rule.appliesTo.includes(lineType)) return undefined;
  if (rule.kind === 'percent') return roundCents((baseCents * rule.value) / 100);
  // Flat fees apply once per month covered by a period charge, once for a dated charge.
  return roundCents(rule.value * months);
}

/**
 * Applies FeeRules whose appliesTo includes lineType (percent on baseCents, flat once per month in
 * the period or once for a servicedOn charge), then the TaxRule for the site's zone on base plus
 * taxable fees. taxExempt accounts skip tax and lateFee lines are never taxed. Returns a proposed
 * Charge with a fresh id and empty evidenceIds; pricing comes from the caller (manualException
 * when the caller gives none).
 */
export function computeCharge(args: ComputeChargeArgs, state: EntityState = live()): Charge {
  const account = must(state.billingAccounts.byId[args.accountId], `BillingAccount ${args.accountId}`);
  const site = must(state.sites.byId[args.siteId], `Site ${args.siteId}`);
  const months = args.period ? Math.max(1, monthsInPeriod(args.period)) : 1;
  const baseCents = roundCents(args.baseCents);

  const fees: Charge['fees'] = [];
  let taxableFees = 0;
  for (const rule of listOf(state.feeRules)) {
    const cents = feeCents(rule, args.lineType, baseCents, months);
    if (cents === undefined) continue;
    fees.push({ feeRuleId: rule.id, cents });
    if (rule.taxable) taxableFees += cents;
  }

  let taxCents = 0;
  if (!account.taxExempt && args.lineType !== 'lateFee') {
    const rule: TaxRule | undefined = listOf(state.taxRules).find((t) => t.zoneId === site.zoneId && t.appliesTo.includes(args.lineType));
    if (rule) taxCents = roundCents(((baseCents + taxableFees) * rule.ratePct) / 100);
  }

  const feeTotal = fees.reduce((s, f) => s + f.cents, 0);
  const charge: Charge = {
    id: newId('ch'),
    accountId: args.accountId,
    siteId: args.siteId,
    lineType: args.lineType,
    catalogId: args.catalogId,
    description: args.description,
    source: args.source,
    baseCents,
    fees,
    taxCents,
    totalCents: baseCents + feeTotal + taxCents,
    pricing: args.pricing ?? { ruleWon: 'manualException' },
    status: 'proposed',
    evidenceIds: [],
  };
  if (args.period) charge.period = args.period;
  else charge.servicedOn = args.servicedOn;
  return charge;
}

/** Whether cycleDate is a billing boundary for this account's cycle. */
export function isCycleBoundary(account: BillingAccount, cycleDate: string): boolean {
  const month = Number(cycleDate.slice(5, 7));
  const day = cycleDate.slice(8, 10);
  if (day !== '01') return false;
  switch (account.cycle) {
    case 'monthly':
    case 'net30':
      return true;
    case 'quarterly':
      return month === 1 || month === 4 || month === 7 || month === 10;
    case 'perJob':
      return false;
  }
}

/**
 * The period one run on cycleDate bills (addendum C14): cycleDate to cycleDate plus the cycle length,
 * for every account. billedInAdvance no longer changes the period, so a net30 account's Oct 1 run
 * bills Oct 1 to Oct 31 (net30 only sets the due date).
 */
export function billingPeriod(account: BillingAccount, cycleDate: string): { start: string; end: string } {
  const months = account.cycle === 'quarterly' ? 3 : 1;
  let end = cycleDate;
  for (let i = 0; i < months; i++) end = startOfNextMonth(end);
  return { start: cycleDate, end: addDays(end, -1) };
}

/**
 * Advance billing per BillingAccount.cycle. Pure over state. Suspended accounts produce nothing
 * (invariant 4). Items are billed for the full period when they are in force at the period start
 * (proration none: an item ending mid-period is not credited, one starting mid-period waits for
 * the next cycle). onCall items are dated hauls and never recur. A line already charged for the
 * same item and period start is not produced twice.
 */
export function generateRecurringCharges({ cycleDate }: { cycleDate: string }, state: EntityState = live()): Charge[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cycleDate)) throw new EngineError(`cycleDate must be YYYY-MM-DD, got ${cycleDate}`);
  const out: Charge[] = [];
  const existing = new Set(
    listOf(state.charges)
      .filter((c) => c.lineType === 'recurring' && c.source.type === 'serviceItem' && c.period)
      .map((c) => `${c.source.id}|${c.period!.start}`),
  );
  const sitesByAccount = new Map<string, string[]>();
  for (const site of listOf(state.sites)) {
    const list = sitesByAccount.get(site.accountId) ?? [];
    list.push(site.id);
    sitesByAccount.set(site.accountId, list);
  }
  const itemsBySite = new Map<string, ServiceItem[]>();
  for (const item of listOf(state.serviceItems)) {
    const list = itemsBySite.get(item.siteId) ?? [];
    list.push(item);
    itemsBySite.set(item.siteId, list);
  }

  for (const account of listOf(state.billingAccounts)) {
    if (account.status === 'suspended') continue;
    if (!isCycleBoundary(account, cycleDate)) continue;
    const period = billingPeriod(account, cycleDate);
    const months = monthsInPeriod(period);
    for (const siteId of sitesByAccount.get(account.id) ?? []) {
      const site = state.sites.byId[siteId];
      for (const item of itemsBySite.get(siteId) ?? []) {
        if (item.frequency === 'onCall') continue;
        if (item.effectiveFrom > period.start) continue;
        // The effective window decides, not the status flag: an item closed with an effectiveTo later
        // in the period is still in force at the period start and bills the full period (no proration).
        const endedBefore = item.effectiveTo !== undefined ? item.effectiveTo <= period.start : item.status === 'ended';
        if (endedBefore) continue;
        if (existing.has(`${item.id}|${period.start}`)) continue;
        const catalog = must(state.serviceCatalog.byId[item.catalogId], `ServiceCatalog ${item.catalogId}`);
        const price = resolvePrice(
          { catalogId: item.catalogId, frequency: item.frequency, zoneId: site.zoneId, accountId: account.id, onDate: cycleDate },
          state,
        );
        const qtyLabel = item.qty > 1 ? ` x${item.qty}` : '';
        const charge = computeCharge(
          {
            accountId: account.id,
            siteId,
            lineType: 'recurring',
            catalogId: item.catalogId,
            description: `${catalog.name}${qtyLabel}, ${FREQUENCY_LABEL[item.frequency]}, ${period.start} to ${period.end}`,
            source: { type: 'serviceItem', id: item.id },
            period,
            baseCents: price.priceCents * item.qty * months,
            pricing: { rateVersionId: price.rateVersionId, contractId: price.contractId, ruleWon: price.ruleWon },
          },
          state,
        );
        out.push(charge);
      }
    }
  }
  return out;
}

/**
 * Event charges, pure over state: one per ServiceEvent with a priced exception, one overage per
 * ScaleTicket whose net tons exceed the catalog's includedTons, and one extra-day line per rolloff
 * box out longer than includedDays (from the completed deliver WorkOrder to TODAY). A source that
 * already has a Charge is skipped. Suspended accounts never produce event charges (invariant 4).
 */
export function generateEventCharges(state: EntityState = live()): Charge[] {
  const out: Charge[] = [];
  const charges = listOf(state.charges);
  const charged = new Set(charges.map((c) => `${c.source.type}|${c.source.id}`));
  const extraDaysCharged = new Set(
    charges.filter((c) => c.lineType === 'event' && c.description.startsWith('Extra days')).flatMap((c) => c.evidenceIds),
  );
  const suspended = (siteId: string) => accountOfSite(siteId, state).status === 'suspended';

  // ServiceEvents with exceptions. dryRun events carry outcome blocked, so key on the exception only.
  for (const ev of listOf(state.serviceEvents)) {
    if (!ev.exception) continue;
    const cents = eventRateCents(ev.exception, state);
    if (cents <= 0) continue;
    if (charged.has(`serviceEvent|${ev.id}`)) continue;
    if (suspended(ev.siteId)) continue;
    const account = accountOfSite(ev.siteId, state);
    const charge = computeCharge(
      {
        accountId: account.id,
        siteId: ev.siteId,
        lineType: 'event',
        description: `${EXCEPTION_LABEL[ev.exception]}, ${ev.date}${ev.note ? `, ${ev.note}` : ''}`,
        source: { type: 'serviceEvent', id: ev.id },
        servicedOn: ev.date,
        baseCents: cents,
        pricing: { ruleWon: 'manualException' },
      },
      state,
    );
    out.push({ ...charge, evidenceIds: ev.photoUrl ? [ev.id] : [] });
  }

  // ScaleTickets over the included tonnage.
  for (const ticket of listOf(state.scaleTickets)) {
    if (charged.has(`scaleTicket|${ticket.id}`)) continue;
    const wo = must(state.workOrders.byId[ticket.workOrderId], `WorkOrder ${ticket.workOrderId}`);
    const container = must(state.containers.byId[ticket.containerId], `Container ${ticket.containerId}`);
    const catalog = must(state.serviceCatalog.byId[container.catalogId], `ServiceCatalog ${container.catalogId}`);
    if (!catalog.rolloff) continue;
    if (suspended(wo.siteId)) continue;
    const tons = ticket.netLbs / 2000;
    const overTons = tons - catalog.rolloff.includedTons;
    if (overTons <= 0) continue;
    const account = accountOfSite(wo.siteId, state);
    const charge = computeCharge(
      {
        accountId: account.id,
        siteId: wo.siteId,
        lineType: 'event',
        catalogId: catalog.id,
        description: `Tonnage overage, ${container.serial}, ${tons.toFixed(2)} tons against ${catalog.rolloff.includedTons} included, ${ticket.facility}`,
        source: { type: 'scaleTicket', id: ticket.id },
        servicedOn: ticket.ticketedAt.slice(0, 10),
        baseCents: roundCents(overTons * catalog.rolloff.overageCentsPerTon),
        pricing: { ruleWon: 'standardRate' },
      },
      state,
    );
    out.push({ ...charge, evidenceIds: [ticket.id] });
  }

  // Rolloff boxes out longer than the included days, measured from the completed deliver WorkOrder.
  const workOrders = listOf(state.workOrders);
  for (const wo of workOrders) {
    if (wo.kind !== 'deliver' || wo.status !== 'done' || !wo.containerId) continue;
    if (extraDaysCharged.has(wo.id)) continue;
    const container = must(state.containers.byId[wo.containerId], `Container ${wo.containerId}`);
    const catalog = must(state.serviceCatalog.byId[container.catalogId], `ServiceCatalog ${container.catalogId}`);
    if (!catalog.rolloff) continue;
    if (suspended(wo.siteId)) continue;
    const deliveredOn = (wo.completedAt ?? wo.scheduledFor).slice(0, 10);
    const removed = workOrders.some(
      (w) => w.kind === 'remove' && w.status === 'done' && w.containerId === wo.containerId && (w.completedAt ?? w.scheduledFor) >= deliveredOn,
    );
    if (removed) continue;
    const daysOut = daysBetween(deliveredOn, TODAY);
    const over = daysOut - catalog.rolloff.includedDays;
    if (over <= 0) continue;
    const account = accountOfSite(wo.siteId, state);
    const charge = computeCharge(
      {
        accountId: account.id,
        siteId: wo.siteId,
        lineType: 'event',
        catalogId: catalog.id,
        description: `Extra days, ${container.serial}, ${daysOut} days out against ${catalog.rolloff.includedDays} included, ${over} extra at ${catalog.rolloff.extraDayCents} cents`,
        source: { type: 'serviceItem', id: wo.serviceItemId ?? '' },
        servicedOn: TODAY,
        baseCents: over * catalog.rolloff.extraDayCents,
        pricing: { ruleWon: 'standardRate' },
      },
      state,
    );
    out.push({ ...charge, evidenceIds: [wo.id] });
  }

  return out;
}

/** monthly and net30: the 1st of next month; quarterly: the next quarter start; perJob: undefined. */
export function nextCycleDate(account: BillingAccount, today: string = TODAY): string | undefined {
  switch (account.cycle) {
    case 'monthly':
    case 'net30':
      return startOfNextMonth(today);
    case 'quarterly':
      return startOfNextQuarter(today);
    case 'perJob':
      return undefined;
  }
}

export interface NextRunPreview {
  cycleDate: string | undefined;
  recurring: Charge[];
  events: Charge[];
  /** Charges already in the store for this account that are proposed or approved and not yet invoiced. */
  proposed: Charge[];
  totalCents: number;
}

/** What the next billing run would produce for one account, computed without touching the store. */
export function previewNextRun(accountId: string, state: EntityState = live()): NextRunPreview {
  const account = must(state.billingAccounts.byId[accountId], `BillingAccount ${accountId}`);
  const cycleDate = nextCycleDate(account, TODAY);
  const recurring = cycleDate ? generateRecurringCharges({ cycleDate }, state).filter((c) => c.accountId === accountId) : [];
  const events = generateEventCharges(state).filter((c) => c.accountId === accountId);
  const proposed = listOf(state.charges).filter((c) => c.accountId === accountId && (c.status === 'proposed' || c.status === 'approved'));
  const totalCents = [...recurring, ...events, ...proposed].reduce((s, c) => s + c.totalCents, 0);
  return { cycleDate, recurring, events, proposed, totalCents };
}

// ---------------------------------------------------------------------------------------------
// Invoices, balances, allocations
// ---------------------------------------------------------------------------------------------

function nextInvoiceNumber(state: EntityState, offset: number): string {
  const year = TODAY.slice(0, 4);
  let max = 0;
  for (const inv of listOf(state.invoices)) {
    const m = /^PD-(\d{4})-(\d+)$/.exec(inv.number);
    if (m && m[1] === year) max = Math.max(max, Number(m[2]));
  }
  return `PD-${year}-${String(max + 1 + offset).padStart(4, '0')}`;
}

/** Addendum C9: net30 is due issuedAt + 30 days; monthly, quarterly, and perJob issuedAt + 15. */
export function dueDateFor(account: BillingAccount, issuedAt: string): string {
  return addDays(issuedAt, account.cycle === 'net30' ? 30 : 15);
}

/**
 * Groups charges by account and builds one locked Invoice per account, issued TODAY, due per
 * dueDateFor (+30 days for net30, +15 otherwise). Pure: returns the invoices; the store action appends them and
 * marks the charges posted. Charges already posted or waived are refused.
 */
export function postInvoices({ chargeIds }: { chargeIds: string[] }, state: EntityState = live()): Invoice[] {
  const byAccount = new Map<string, Charge[]>();
  for (const id of chargeIds) {
    const charge = must(state.charges.byId[id], `Charge ${id}`);
    if (charge.status === 'posted') throw new EngineError(`Charge ${id} is already posted`);
    if (charge.status === 'waived') throw new EngineError(`Charge ${id} is waived`);
    const list = byAccount.get(charge.accountId) ?? [];
    list.push(charge);
    byAccount.set(charge.accountId, list);
  }
  const invoices: Invoice[] = [];
  let offset = 0;
  for (const [accountId, lines] of byAccount) {
    const account = must(state.billingAccounts.byId[accountId], `BillingAccount ${accountId}`);
    const subtotalCents = lines.reduce((s, c) => s + c.baseCents, 0);
    const feeCentsTotal = lines.reduce((s, c) => s + c.fees.reduce((f, x) => f + x.cents, 0), 0);
    const taxCents = lines.reduce((s, c) => s + c.taxCents, 0);
    invoices.push({
      id: newId('inv'),
      accountId,
      number: nextInvoiceNumber(state, offset++),
      chargeIds: lines.map((c) => c.id),
      subtotalCents,
      feeCents: feeCentsTotal,
      taxCents,
      totalCents: subtotalCents + feeCentsTotal + taxCents,
      issuedAt: TODAY,
      dueAt: dueDateFor(account, TODAY),
      postedAt: TODAY,
      locked: true,
      deliveredVia: account.deliveryMethod,
    });
  }
  return invoices;
}

/** Invoice total minus every PaymentAllocation against it (payments and credit memos alike). */
export function openBalance(invoiceId: string, state: EntityState = live()): number {
  const invoice = must(state.invoices.byId[invoiceId], `Invoice ${invoiceId}`);
  const applied = state.paymentAllocations.filter((a) => a.invoiceId === invoiceId).reduce((s, a) => s + a.cents, 0);
  return invoice.totalCents - applied;
}

export function accountInvoices(accountId: string, state: EntityState = live()): Invoice[] {
  return listOf(state.invoices).filter((i) => i.accountId === accountId);
}

/** Sum of open balances across the account's invoices. */
export function accountBalance(accountId: string, state: EntityState = live()): number {
  return accountInvoices(accountId, state).reduce((s, i) => s + openBalance(i.id, state), 0);
}

/** Open balances of invoices whose dueAt is before TODAY. */
export function pastDue(accountId: string, state: EntityState = live()): number {
  return accountInvoices(accountId, state)
    .filter((i) => i.dueAt < TODAY)
    .reduce((s, i) => s + openBalance(i.id, state), 0);
}

/** Cents of a payment or credit memo not yet allocated to any invoice. */
export function unallocatedCents(sourceType: PaymentAllocation['sourceType'], sourceId: string, state: EntityState = live()): number {
  const source: Payment | CreditMemo | undefined = sourceType === 'payment' ? state.payments.byId[sourceId] : state.creditMemos.byId[sourceId];
  const total = must(source, `${sourceType} ${sourceId}`).cents;
  const applied = state.paymentAllocations
    .filter((a) => a.sourceType === sourceType && a.sourceId === sourceId)
    .reduce((s, a) => s + a.cents, 0);
  return total - applied;
}

export interface AllocateArgs {
  sourceType: PaymentAllocation['sourceType'];
  sourceId: string;
  invoiceIds: string[];
  cents: number[];
}

/**
 * Validates and returns the allocations for one source across several invoices; the store action
 * appends them. Many-to-many by construction (invariant 6): several sources may hit one invoice.
 * Rejects a missing source, mismatched lengths, non-positive or over-balance cents, and a sum
 * above the source's unallocated remainder. Throws AllocationError; nothing is written on failure.
 */
export function allocate(args: AllocateArgs, state: EntityState = live()): PaymentAllocation[] {
  const { sourceType, sourceId, invoiceIds, cents } = args;
  const source = sourceType === 'payment' ? state.payments.byId[sourceId] : state.creditMemos.byId[sourceId];
  if (!source) throw new AllocationError(`${sourceType} ${sourceId} does not exist`);
  if (sourceType === 'payment' && (source as Payment).status === 'returned') throw new AllocationError(`Payment ${sourceId} was returned`);
  if (invoiceIds.length !== cents.length) throw new AllocationError('invoiceIds and cents must have the same length');
  if (invoiceIds.length === 0) throw new AllocationError('Nothing to allocate');
  const remainder = unallocatedCents(sourceType, sourceId, state);
  let sum = 0;
  const perInvoice = new Map<string, number>();
  const out: PaymentAllocation[] = [];
  invoiceIds.forEach((invoiceId, i) => {
    const amount = cents[i];
    const invoice = state.invoices.byId[invoiceId];
    if (!invoice) throw new AllocationError(`Invoice ${invoiceId} does not exist`);
    if (invoice.accountId !== source.accountId) throw new AllocationError(`Invoice ${invoiceId} belongs to another account`);
    if (!Number.isInteger(amount) || amount <= 0) throw new AllocationError(`Allocation to ${invoiceId} must be a positive whole number of cents`);
    const already = perInvoice.get(invoiceId) ?? 0;
    const open = openBalance(invoiceId, state) - already;
    if (amount > open) throw new AllocationError(`Allocation of ${amount} to ${invoiceId} exceeds its open balance of ${open}`);
    perInvoice.set(invoiceId, already + amount);
    sum += amount;
    out.push({ sourceType, sourceId, invoiceId, cents: amount });
  });
  if (sum > remainder) throw new AllocationError(`Allocations total ${sum} but only ${remainder} is unallocated on ${sourceId}`);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Service changes and shadow state (pure planning; the store commits)
// ---------------------------------------------------------------------------------------------

/** A new state with the given rows upserted. Order is preserved for existing ids; new ids append. */
export function withRows(
  state: EntityState,
  rows: Partial<{
    serviceItems: ServiceItem[]; containers: Container[]; workOrders: WorkOrder[]; requests: Request[];
    charges: Charge[]; invoices: Invoice[]; payments: Payment[]; creditMemos: CreditMemo[];
    billingAccounts: BillingAccount[]; paymentAllocations: PaymentAllocation[];
  }>,
): EntityState {
  const next: EntityState = { ...state };
  const merge = <T extends { id: string }>(c: Collection<T>, add: T[] | undefined): Collection<T> => {
    if (!add || add.length === 0) return c;
    const byId = { ...c.byId };
    const ids = [...c.ids];
    for (const row of add) {
      if (!(row.id in byId)) ids.push(row.id);
      byId[row.id] = row;
    }
    return { byId, ids };
  };
  next.serviceItems = merge(state.serviceItems, rows.serviceItems);
  next.containers = merge(state.containers, rows.containers);
  next.workOrders = merge(state.workOrders, rows.workOrders);
  next.requests = merge(state.requests, rows.requests);
  next.charges = merge(state.charges, rows.charges);
  next.invoices = merge(state.invoices, rows.invoices);
  next.payments = merge(state.payments, rows.payments);
  next.creditMemos = merge(state.creditMemos, rows.creditMemos);
  next.billingAccounts = merge(state.billingAccounts, rows.billingAccounts);
  if (rows.paymentAllocations?.length) next.paymentAllocations = [...state.paymentAllocations, ...rows.paymentAllocations];
  return next;
}
export interface ServiceChangeArgs {
  siteId: string;
  /** The item being replaced (omit when adding a line). */
  replaceItemId?: string;
  catalogId: string;
  qty: number;
  frequency: Frequency;
  effectiveFrom: string;
  /** How the customer asked; recorded on the office note, default phone. */
  createdVia?: Request['createdVia'];
  note?: string;
}

/**
 * The customer request behind an office change, as the office recorded it. Portal owns Request rows
 * (shared/OWNERSHIP.md), so the account surface never writes `requests`; the store keeps this in its
 * surface-local `officeNotes` sidecar through recordOfficeRequest().
 */
export interface OfficeRequestDraft {
  kind: Request['kind'];
  accountId: string;
  siteId: string;
  workOrderId?: string;
  createdVia: Request['createdVia'];
  note: string;
}

export interface ServiceChangePlan {
  oldItem?: ServiceItem;
  newItem: ServiceItem;
  container: Container;
  workOrder: WorkOrder;
  /** The phone cartChange the office took, for recordOfficeRequest(). Not a Request row. */
  officeRequest: OfficeRequestDraft;
  /** resolvePrice for the new item on its effective date; the plan refuses an item with no published price. */
  price: ResolvedPrice;
  /** The state after the change, for before-and-after previews. */
  nextState: EntityState;
}

/** True when a change would leave the replaced item exactly as it is (same catalog, qty, and frequency). */
export function isNoOpChange(args: ServiceChangeArgs, state: EntityState = live()): boolean {
  const old = args.replaceItemId ? state.serviceItems.byId[args.replaceItemId] : undefined;
  return Boolean(old && old.catalogId === args.catalogId && old.qty === args.qty && old.frequency === args.frequency);
}

/**
 * Plans a service change without writing: the old item closed (effectiveTo = effectiveFrom, status
 * ended, never deleted), the new active item with a fresh container, and a WorkOrder (swap when
 * replacing a cart or container of the same unit, otherwise deliver) scheduled for effectiveFrom.
 * The store's changeServiceItem commits the plan and records the office note. Throws EngineError
 * for a change that cannot be billed or dispatched: a catalog outside the site's line of business, an
 * item with no published price on its effective date, a date on or before the replaced item's start,
 * or a change that changes nothing. `preview` peeks ids instead of consuming them, so a drawer can
 * show the WorkOrder id that confirm will write.
 */
export function planServiceChange(args: ServiceChangeArgs, state: EntityState = live(), opts: { preview?: boolean } = {}): ServiceChangePlan {
  const id = opts.preview ? peekId : newId;
  const serial = opts.preview ? peekSerial : newSerial;
  const site = must(state.sites.byId[args.siteId], `Site ${args.siteId}`);
  const catalog = must(state.serviceCatalog.byId[args.catalogId], `ServiceCatalog ${args.catalogId}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.effectiveFrom)) throw new EngineError('Effective date must be YYYY-MM-DD');
  if (!Number.isInteger(args.qty) || args.qty < 1) throw new EngineError('Quantity must be a whole number of at least 1');
  const route = site.routeId ? state.routes.byId[site.routeId] : undefined;
  if (route && route.lob !== catalog.lob) throw new EngineError(`${catalog.name} is ${catalog.lob}; ${site.address} is on a ${route.lob} route`);
  const oldItemRow = args.replaceItemId ? must(state.serviceItems.byId[args.replaceItemId], `ServiceItem ${args.replaceItemId}`) : undefined;
  if (oldItemRow && oldItemRow.siteId !== site.id) throw new EngineError(`ServiceItem ${oldItemRow.id} is not at ${site.id}`);
  if (oldItemRow?.status === 'ended') throw new EngineError(`ServiceItem ${oldItemRow.id} already ended`);
  if (oldItemRow && args.effectiveFrom <= oldItemRow.effectiveFrom) {
    throw new EngineError(`Effective date must be after ${oldItemRow.id} started on ${oldItemRow.effectiveFrom}`);
  }
  if (isNoOpChange(args, state)) throw new EngineError('Nothing changes: pick a different service, quantity, or frequency');
  let price: ResolvedPrice;
  try {
    price = resolvePrice(
      { catalogId: catalog.id, frequency: args.frequency, zoneId: site.zoneId, accountId: site.accountId, onDate: args.effectiveFrom },
      state,
    );
  } catch (err) {
    if (err instanceof PriceNotFound) throw new EngineError(`No published price for ${catalog.name}, ${FREQUENCY_LABEL[args.frequency]}, on ${args.effectiveFrom}`);
    throw err;
  }
  const oldCatalog = oldItemRow ? state.serviceCatalog.byId[oldItemRow.catalogId] : undefined;

  const oldItem: ServiceItem | undefined = oldItemRow ? { ...oldItemRow, effectiveTo: args.effectiveFrom, status: 'ended' } : undefined;
  const container: Container = {
    id: id('cont'),
    serial: serial(catalog),
    catalogId: catalog.id,
    siteId: site.id,
    assignedFrom: args.effectiveFrom,
  };
  const newItem: ServiceItem = {
    id: id('si'),
    siteId: site.id,
    catalogId: catalog.id,
    qty: args.qty,
    frequency: args.frequency,
    containerIds: [container.id],
    effectiveFrom: args.effectiveFrom,
    status: 'active',
  };
  const workOrder: WorkOrder = {
    id: id('wo'),
    siteId: site.id,
    kind: oldCatalog && oldCatalog.unit === catalog.unit ? 'swap' : 'deliver',
    status: 'open',
    scheduledFor: args.effectiveFrom,
    serviceItemId: newItem.id,
    containerId: container.id,
  };
  const officeRequest: OfficeRequestDraft = {
    kind: 'cartChange',
    accountId: site.accountId,
    siteId: site.id,
    workOrderId: workOrder.id,
    createdVia: args.createdVia ?? 'phone',
    note: args.note ?? (oldItemRow && oldCatalog ? `Change ${oldCatalog.name} to ${catalog.name}, effective ${args.effectiveFrom}` : `Add ${catalog.name}, effective ${args.effectiveFrom}`),
  };

  const nextState = withRows(state, {
    serviceItems: oldItem ? [oldItem, newItem] : [newItem],
    containers: [container],
    workOrders: [workOrder],
  });
  return { oldItem, newItem, container, workOrder, officeRequest, price, nextState };
}

/** Item statuses a hold or suspension puts in place, and what reinstatement restores. */
export function itemStatusForAccountStatus(status: BillingAccount['status']): ServiceItem['status'] {
  return status === 'suspended' || status === 'hold' ? 'held' : 'active';
}

// ---------------------------------------------------------------------------------------------
// Holds, suspensions, reinstatement (Phase 6, invariant 4)
// ---------------------------------------------------------------------------------------------

/** What an account returns to when a hold or suspension ends: pastDue while any invoice is past due, else active. */
export function statusAfterReinstatement(accountId: string, state: EntityState = live()): 'active' | 'pastDue' {
  return pastDue(accountId, state) > 0 ? 'pastDue' : 'active';
}

/** The hauler's reinstatement fee in cents (Piedmont Disposal: 2500). */
export function reinstatementFeeCents(state: EntityState = live()): number {
  return listOf(state.haulers)[0]?.policy.reinstatementFeeCents ?? 0;
}

/**
 * The reinstatement fee as a proposed Charge, built through computeCharge (lineType fee, source manual, status
 * proposed) at the account's first site, dated `on`. `sourceId` names the office record that caused it (the
 * reinstatement's status change id). Pure: the caller decides where the Charge lives. Billing owns Charge writes
 * (shared/OWNERSHIP.md), so the account store keeps it in a surface-local proposedCharges sidecar.
 */
export function buildReinstatementFee(
  { accountId, sourceId, on = TODAY }: { accountId: string; sourceId: string; on?: string },
  state: EntityState = live(),
): Charge {
  must(state.billingAccounts.byId[accountId], `BillingAccount ${accountId}`);
  const site = must(listOf(state.sites).find((s) => s.accountId === accountId), `a Site on ${accountId}`);
  const hauler = listOf(state.haulers)[0];
  return computeCharge(
    {
      accountId,
      siteId: site.id,
      lineType: 'fee',
      source: { type: 'manual', id: sourceId },
      servicedOn: on,
      baseCents: reinstatementFeeCents(state),
      description: `Reinstatement fee, ${hauler?.name ?? 'hauler'} policy`,
      pricing: { ruleWon: 'manualException' },
    },
    state,
  );
}
