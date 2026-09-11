// Pricing engine. Signatures are the shared contract's, verbatim in their first argument.
// Every function is pure: it reads the `state` it is handed (defaulting to the store snapshot) and
// returns values. Nothing here writes to the store.
import type { Charge, Frequency, Invoice, LineType, PaymentAllocation } from '../types';
import { wholeMonthsBetween } from './clock';
import { pctOf } from './money';
import { snapshot, type StoreTables } from './store';

/** The tables the engine reads. Any object with these keyed tables works, including a hypothetical overlay. */
export type EngineState = Pick<
  StoreTables,
  'accounts' | 'sites' | 'zones' | 'catalog' | 'rateVersions' | 'feeRules' | 'taxRules' | 'contracts'
>;

export type RuleWon = Charge['pricing']['ruleWon'];

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
  ruleWon: RuleWon;
}

const datePart = (iso: string) => iso.slice(0, 10);

/**
 * Precedence: contract override for this account and catalog, then a published RateVersion matching
 * zone and frequency, then a published RateVersion with no zone, else throw.
 * Among matching versions the one whose effectiveFrom is latest but not after onDate wins.
 */
export function resolvePrice(args: ResolvePriceArgs, state: EngineState = snapshot()): ResolvedPrice {
  const { catalogId, frequency, zoneId, accountId } = args;
  const onDate = datePart(args.onDate);

  for (const contract of Object.values(state.contracts)) {
    if (contract.accountId !== accountId) continue;
    if (datePart(contract.termStart) > onDate || datePart(contract.termEnd) < onDate) continue;
    const override = contract.overrides.find(
      (o) => o.catalogId === catalogId && (o.frequency === undefined || o.frequency === frequency),
    );
    if (override) {
      return { priceCents: override.priceCents, contractId: contract.id, ruleWon: 'contractOverride' };
    }
  }

  const candidates = Object.values(state.rateVersions).filter(
    (rv) =>
      rv.status === 'published' &&
      rv.catalogId === catalogId &&
      (rv.frequency === undefined || rv.frequency === frequency) &&
      datePart(rv.effectiveFrom) <= onDate,
  );
  const latest = (rows: typeof candidates) =>
    rows.reduce<(typeof rows)[number] | undefined>((best, rv) => {
      if (!best) return rv;
      if (rv.effectiveFrom > best.effectiveFrom) return rv;
      if (rv.effectiveFrom === best.effectiveFrom && (rv.publishedAt ?? '') > (best.publishedAt ?? '')) return rv;
      return best;
    }, undefined);

  const zoneRate = latest(candidates.filter((rv) => rv.zoneId === zoneId));
  if (zoneRate) return { priceCents: zoneRate.priceCents, rateVersionId: zoneRate.id, ruleWon: 'zoneRate' };

  const standardRate = latest(candidates.filter((rv) => rv.zoneId === undefined));
  if (standardRate) {
    return { priceCents: standardRate.priceCents, rateVersionId: standardRate.id, ruleWon: 'standardRate' };
  }

  throw new Error(`No published rate for ${catalogId} (${frequency}) in ${zoneId} on ${onDate}`);
}

export interface ComputeChargeArgs {
  accountId: string;
  siteId: string;
  lineType: LineType;
  baseCents: number;
  servicedOn?: string;
  period?: { start: string; end: string };
  source: Charge['source'];
  catalogId?: string;
  /** Optional extras beyond the contract's argument list; each has a safe default. */
  id?: string;
  description?: string;
  pricing?: Charge['pricing'];
}

/**
 * Applies the FeeRules whose appliesTo includes the line type, then the site zone's TaxRule on the base
 * plus taxable fees. Rounds half up at each step. Flat fees on a recurring line scale by the whole months
 * in `period` (default 1). Account taxExempt skips tax. Late fees are never taxed.
 */
export function computeCharge(args: ComputeChargeArgs, state: EngineState = snapshot()): Charge {
  const { accountId, siteId, lineType, baseCents, source, catalogId } = args;
  const site = state.sites[siteId];
  if (!site) throw new Error(`computeCharge: unknown site ${siteId}`);
  const account = state.accounts[accountId];
  if (!account) throw new Error(`computeCharge: unknown account ${accountId}`);

  const months = lineType === 'recurring' && args.period ? Math.max(1, wholeMonthsBetween(args.period.start, args.period.end)) : 1;

  const fees: Charge['fees'] = [];
  let taxableFees = 0;
  for (const rule of Object.values(state.feeRules)) {
    if (!rule.appliesTo.includes(lineType)) continue;
    let cents: number;
    if (rule.kind === 'percent') {
      const feeBase = rule.base === 'serviceLines' ? baseCents : baseCents + fees.reduce((s, f) => s + f.cents, 0);
      cents = pctOf(feeBase, rule.value);
    } else {
      cents = rule.value * months;
    }
    fees.push({ feeRuleId: rule.id, cents });
    if (rule.taxable) taxableFees += cents;
  }

  let taxCents = 0;
  if (lineType !== 'lateFee' && !account.taxExempt) {
    const taxRule = Object.values(state.taxRules).find((t) => t.zoneId === site.zoneId);
    if (taxRule && taxRule.appliesTo.includes(lineType)) {
      taxCents = pctOf(baseCents + taxableFees, taxRule.ratePct);
    }
  }

  const feeTotal = fees.reduce((s, f) => s + f.cents, 0);
  const when = args.period ? `${args.period.start} to ${args.period.end}` : args.servicedOn ?? '';
  const catalogName = catalogId ? state.catalog[catalogId]?.name ?? catalogId : lineType;

  return {
    id: args.id ?? `chg_${source.type}_${source.id}_${lineType}_${(args.period?.start ?? args.servicedOn ?? 'undated').slice(0, 10)}`,
    accountId,
    siteId,
    lineType,
    ...(catalogId ? { catalogId } : {}),
    description: args.description ?? (when ? `${catalogName}, ${when}` : catalogName),
    source,
    ...(args.period ? { period: args.period } : {}),
    ...(args.servicedOn ? { servicedOn: args.servicedOn } : {}),
    baseCents,
    fees,
    taxCents,
    totalCents: baseCents + feeTotal + taxCents,
    pricing: args.pricing ?? { ruleWon: 'manualException' },
    status: 'proposed',
    evidenceIds: [],
  };
}

export function generateRecurringCharges(_args: { cycleDate: string }): Charge[] {
  throw new Error('not implemented in storefront');
}

export function generateEventCharges(): Charge[] {
  throw new Error('not implemented in storefront');
}

export function postInvoices(_args: { chargeIds: string[] }): Invoice[] {
  throw new Error('not implemented in storefront');
}

export function allocate(_args: {
  sourceType: 'payment' | 'creditMemo';
  sourceId: string;
  invoiceIds: string[];
  cents: number[];
}): PaymentAllocation[] {
  throw new Error('not implemented in storefront');
}
