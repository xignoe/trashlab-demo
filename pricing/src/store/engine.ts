// Pricing engine. Signatures match SHARED_CONTRACT.md "## Engine functions" exactly.
//
// Every function is pure over an EngineState (the read-only tables it needs). The state is an optional
// trailing parameter that defaults to the live zustand store, so callers in the UI write
// resolvePrice({ ... }) and the blast-radius preview writes resolvePrice({ ... }, stateWithDraftsPublished)
// to see "after" without mutating the store. The contract argument objects are unchanged.
//
// Phase 2 fills resolvePrice, computeCharge, and generateRecurringCharges. generateEventCharges,
// postInvoices, and allocate stay as throwing stubs: the pricing surface never posts an invoice or
// touches a payment, and the account tracker surface owns those bodies. Their signatures are kept so
// the merge sees the same six exports everywhere.
import type {
  BillingAccount, Charge, Contract, FeeRule, Frequency, Invoice, LineType, Party, PaymentAllocation,
  RateVersion, ServiceCatalog, ServiceItem, Site, TaxRule, Zone,
} from '../types';
import { useStore } from './store';
import { addDays, addMonths, dateOnly, within, yyyymmdd } from './dates';

/** The tables the engine reads. The zustand state satisfies this structurally. */
export interface EngineState {
  accounts: BillingAccount[];
  parties: Party[];
  sites: Site[];
  zones: Zone[];
  catalog: ServiceCatalog[];
  serviceItems: ServiceItem[];
  rateVersions: RateVersion[];
  feeRules: FeeRule[];
  taxRules: TaxRule[];
  contracts: Contract[];
}

/** Picks only the engine tables out of a wider object (for example the zustand state with its actions). */
export function toEngineState(s: EngineState): EngineState {
  return {
    accounts: s.accounts,
    parties: s.parties,
    sites: s.sites,
    zones: s.zones,
    catalog: s.catalog,
    serviceItems: s.serviceItems,
    rateVersions: s.rateVersions,
    feeRules: s.feeRules,
    taxRules: s.taxRules,
    contracts: s.contracts,
  };
}

const liveState = (): EngineState => useStore.getState();

export interface ResolvePriceArgs {
  catalogId: string;
  frequency: Frequency;
  zoneId?: string;
  accountId?: string;
  onDate: string;
}

export interface ResolvePriceResult {
  priceCents: number;
  rateVersionId?: string;
  contractId?: string;
  ruleWon: Charge['pricing']['ruleWon'];
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
  description?: string;
  pricing?: Charge['pricing'];
  /** Optional stable id. Defaults to ch_<source id>_<period start or servicedOn>. */
  id?: string;
}

export interface AllocateArgs {
  sourceType: PaymentAllocation['sourceType'];
  sourceId: string;
  invoiceIds: string[];
  cents: number[];
}

const notImplemented = (name: string): never => {
  throw new Error(`${name} not implemented`);
};

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  weekly: 'weekly',
  eow: 'every other week',
  '2x': '2x weekly',
  '3x': '3x weekly',
  onCall: 'on call',
};

/** Months of service one recurring charge covers for a billing cycle. Quarterly bills three months in
 *  advance; monthly, net30 (billed monthly in arrears), and perJob (one haul per cycle) bill one. */
export function cycleMonths(cycle: BillingAccount['cycle']): number {
  return cycle === 'quarterly' ? 3 : 1;
}

/** Contracts that can speak for an account: the one on account.contractId first, then any other contract
 *  row pointing at the account. */
function contractsFor(accountId: string, state: EngineState): Contract[] {
  const account = state.accounts.find((a) => a.id === accountId);
  const rows = state.contracts.filter((c) => c.accountId === accountId || (account?.contractId !== undefined && c.id === account.contractId));
  return rows.sort((a, b) => Number(b.id === account?.contractId) - Number(a.id === account?.contractId));
}

/** Newest applicable RateVersion first: latest effectiveFrom, then an exact frequency match over a
 *  frequency-agnostic row, then latest publishedAt. */
function newestFirst(frequency: Frequency) {
  return (a: RateVersion, b: RateVersion): number => {
    const byDate = dateOnly(b.effectiveFrom).localeCompare(dateOnly(a.effectiveFrom));
    if (byDate !== 0) return byDate;
    const exact = Number(b.frequency === frequency) - Number(a.frequency === frequency);
    if (exact !== 0) return exact;
    return (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '');
  };
}

/** Precedence: contract override for this account and catalog (contract term must contain onDate, so a
 *  lapsed contract never wins) > published RateVersion matching zone and frequency > published RateVersion
 *  with no zone matching frequency > throw. Among candidates the version whose effectiveFrom is latest but
 *  not after onDate wins. Drafts are never considered. */
export function resolvePrice(args: ResolvePriceArgs, state: EngineState = liveState()): ResolvePriceResult {
  const { catalogId, frequency, zoneId, accountId } = args;
  const onDate = dateOnly(args.onDate);

  if (accountId) {
    for (const contract of contractsFor(accountId, state)) {
      if (!within(onDate, contract.termStart, contract.termEnd)) continue;
      const matching = contract.overrides.filter((o) => o.catalogId === catalogId && (o.frequency === undefined || o.frequency === frequency));
      // Later overrides win over earlier ones for the same item, so a renegotiation appended by
      // saveContractOverride takes effect while the earlier row stays in the contract as history.
      const exact = matching.filter((o) => o.frequency === frequency);
      const override = (exact.length ? exact : matching).at(-1);
      if (override) return { priceCents: override.priceCents, contractId: contract.id, ruleWon: 'contractOverride' };
    }
  }

  const published = state.rateVersions.filter(
    (rv) =>
      rv.status === 'published' &&
      rv.catalogId === catalogId &&
      dateOnly(rv.effectiveFrom) <= onDate &&
      (rv.frequency === undefined || rv.frequency === frequency),
  );
  const pick = (rows: RateVersion[]): RateVersion | undefined => [...rows].sort(newestFirst(frequency))[0];

  if (zoneId) {
    const zoned = pick(published.filter((rv) => rv.zoneId === zoneId));
    if (zoned) return { priceCents: zoned.priceCents, rateVersionId: zoned.id, ruleWon: 'zoneRate' };
  }
  const standard = pick(published.filter((rv) => rv.zoneId === undefined));
  if (standard) return { priceCents: standard.priceCents, rateVersionId: standard.id, ruleWon: 'standardRate' };

  throw new Error(`No published rate for ${catalogId}`);
}

/** Charge.pricing built from a resolvePrice result without undefined keys, so deep-equal comparisons of
 *  charges stay predictable. */
export function pricingOf(r: ResolvePriceResult): Charge['pricing'] {
  return {
    ...(r.rateVersionId !== undefined ? { rateVersionId: r.rateVersionId } : {}),
    ...(r.contractId !== undefined ? { contractId: r.contractId } : {}),
    ruleWon: r.ruleWon,
  };
}

/** Whole calendar months covered by an inclusive period: 2026-10-01..2026-12-31 is 3, 2026-10-01..2026-10-31
 *  is 1. A period shorter than a month still counts as 1 so a flat fee is never dropped. */
export function wholeMonthsIn(period: { start: string; end: string }): number {
  const endExclusive = addDays(period.end, 1);
  let n = 0;
  while (addMonths(period.start, n + 1) <= endExclusive) n += 1;
  return Math.max(1, n);
}

/** Applies FeeRules whose appliesTo includes lineType, then the TaxRule for the site's zone on base plus
 *  taxable fees. Account taxExempt skips tax. Late fees are never taxed. totalCents = base + fees + tax.
 *
 *  Fee base: a percent fee with base 'serviceLines' is taken on this charge's baseCents. A fee with base
 *  'allLines' is treated the same way here because computeCharge sees exactly one line; the distinction
 *  only matters for a whole-invoice fee, which this surface never creates (no seeded rule uses allLines
 *  since addendum C7). Flat fees are in cents, once per whole month of the charge's period (C5). */
export function computeCharge(args: ComputeChargeArgs, state: EngineState = liveState()): Charge {
  const { accountId, siteId, lineType, source, catalogId } = args;
  const baseCents = Math.round(args.baseCents);
  const account = state.accounts.find((a) => a.id === accountId);
  const site = state.sites.find((s) => s.id === siteId);

  const feeRules = state.feeRules.filter((r) => r.appliesTo.includes(lineType));
  // Addendum C5 (bound here through C1): a flat fee applies once per whole month in the charge's period,
  // so a quarterly recurring charge carries fee_env_1 three times (300). A charge with no period is one month.
  const months = args.period ? wholeMonthsIn(args.period) : 1;
  const fees = feeRules.map((r) => ({
    feeRuleId: r.id,
    cents: r.kind === 'percent' ? Math.round((baseCents * r.value) / 100) : Math.round(r.value) * months,
  }));
  const feeCents = fees.reduce((sum, f) => sum + f.cents, 0);

  let taxCents = 0;
  if (lineType !== 'lateFee' && !account?.taxExempt) {
    const rule = state.taxRules.find((t) => t.zoneId === site?.zoneId && t.appliesTo.includes(lineType));
    if (rule) {
      const taxableFees = fees
        .filter((f) => feeRules.find((r) => r.id === f.feeRuleId)?.taxable)
        .reduce((sum, f) => sum + f.cents, 0);
      taxCents = Math.round(((baseCents + taxableFees) * rule.ratePct) / 100);
    }
  }

  const dateKey = args.period?.start ?? args.servicedOn;
  const item = catalogId ? state.catalog.find((c) => c.id === catalogId) : undefined;
  const description = args.description ?? (item ? item.name : `${lineType} charge`);

  return {
    id: args.id ?? `ch_${source.id}_${dateKey ? yyyymmdd(dateKey) : 'undated'}`,
    accountId,
    siteId,
    lineType,
    ...(catalogId !== undefined ? { catalogId } : {}),
    description,
    source: { type: source.type, id: source.id },
    ...(args.period ? { period: { start: args.period.start, end: args.period.end } } : {}),
    ...(args.servicedOn !== undefined ? { servicedOn: args.servicedOn } : {}),
    baseCents,
    fees,
    taxCents,
    totalCents: baseCents + feeCents + taxCents,
    pricing: args.pricing ?? { ruleWon: 'manualException' },
    status: 'proposed',
    evidenceIds: [],
  };
}

/** Advance billing per BillingAccount.cycle, from active ServiceItems.
 *  For every active ServiceItem (effective on cycleDate) on an active or pastDue account: resolve the price
 *  on cycleDate, multiply by qty and by cycleMonths (3 for quarterly), and build a recurring Charge with
 *  the ServiceItem as source. Suspended and hold accounts and held or ended items produce nothing.
 *  Charges are returned, never stored. An item with no published rate throws (resolvePrice), on purpose:
 *  a silent hole in a bill run is the persona's failure mode. */
export function generateRecurringCharges(args: { cycleDate: string }, state: EngineState = liveState()): Charge[] {
  const cycleDate = dateOnly(args.cycleDate);
  const out: Charge[] = [];
  for (const item of state.serviceItems) {
    if (item.status !== 'active') continue;
    if (dateOnly(item.effectiveFrom) > cycleDate) continue;
    if (item.effectiveTo !== undefined && dateOnly(item.effectiveTo) < cycleDate) continue;
    const site = state.sites.find((s) => s.id === item.siteId);
    if (!site) continue;
    const account = state.accounts.find((a) => a.id === site.accountId);
    if (!account || (account.status !== 'active' && account.status !== 'pastDue')) continue;

    const months = cycleMonths(account.cycle);
    const price = resolvePrice(
      { catalogId: item.catalogId, frequency: item.frequency, zoneId: site.zoneId, accountId: account.id, onDate: cycleDate },
      state,
    );
    const period = { start: cycleDate, end: addDays(addMonths(cycleDate, months), -1) };
    const catalogItem = state.catalog.find((c) => c.id === item.catalogId);
    const qtyLabel = item.qty > 1 ? `${item.qty} x ` : '';
    const description = `${qtyLabel}${catalogItem?.name ?? item.catalogId}, ${FREQUENCY_LABEL[item.frequency]}, ${period.start} to ${period.end}`;

    out.push(
      computeCharge(
        {
          accountId: account.id,
          siteId: site.id,
          lineType: 'recurring',
          baseCents: price.priceCents * item.qty * months,
          period,
          source: { type: 'serviceItem', id: item.id },
          catalogId: item.catalogId,
          description,
          pricing: pricingOf(price),
        },
        state,
      ),
    );
  }
  return out;
}

/** From ServiceEvents with exceptions and ScaleTickets where netLbs/2000 exceeds includedTons.
 *  Not implemented on the pricing surface: this surface never bills events. */
export function generateEventCharges(): Charge[] {
  return notImplemented('generateEventCharges');
}

/** Sets locked true; posting is irreversible; corrections are CreditMemos.
 *  Not implemented on the pricing surface: this surface never posts an invoice. */
export function postInvoices(_args: { chargeIds: string[] }): Invoice[] {
  return notImplemented('postInvoices');
}

/** Allocation is many-to-many.
 *  Not implemented on the pricing surface: this surface never touches a payment. */
export function allocate(_args: AllocateArgs): PaymentAllocation[] {
  return notImplemented('allocate');
}
