// Pure preview helpers for the publish step. Nothing here writes to the store: "after" is computed against
// a copy of the rateVersions table in which the chosen drafts are treated as published.
import type { Charge, Frequency, RateVersion } from '../types';
import { generateRecurringCharges, resolvePrice, toEngineState, type EngineState, type ResolvePriceResult } from './engine';
import { useStore } from './store';
import { dateOnly, within } from './dates';

export interface InvoicePreview {
  accountId: string;
  onDate: string;
  lines: Charge[];
  subtotalCents: number;
  feeCents: number;
  taxCents: number;
  totalCents: number;
}

export interface PreviewInvoiceArgs {
  accountId: string;
  onDate: string;
  /** Overrides the rateVersions table for this run (for example drafts treated as published). */
  rateVersions?: RateVersion[];
  /** Base state; defaults to the live store. */
  state?: EngineState;
}

const baseState = (state?: EngineState): EngineState => toEngineState(state ?? useStore.getState());

function accountScope(accountId: string, state: EngineState, rateVersions?: RateVersion[]): EngineState {
  const siteIds = new Set(state.sites.filter((s) => s.accountId === accountId).map((s) => s.id));
  return {
    ...state,
    rateVersions: rateVersions ?? state.rateVersions,
    serviceItems: state.serviceItems.filter((si) => siteIds.has(si.siteId)),
  };
}

/** Runs the recurring generation for one account on onDate, optionally against an overriding rateVersions
 *  array, and totals the lines. subtotalCents is the sum of base cents (service lines before fees and tax). */
export function previewInvoice(args: PreviewInvoiceArgs): InvoicePreview {
  const state = accountScope(args.accountId, baseState(args.state), args.rateVersions);
  const lines = generateRecurringCharges({ cycleDate: args.onDate }, state);
  const sum = (f: (c: Charge) => number) => lines.reduce((acc, c) => acc + f(c), 0);
  return {
    accountId: args.accountId,
    onDate: dateOnly(args.onDate),
    lines,
    subtotalCents: sum((c) => c.baseCents),
    feeCents: sum((c) => c.fees.reduce((a, f) => a + f.cents, 0)),
    taxCents: sum((c) => c.taxCents),
    totalCents: sum((c) => c.totalCents),
  };
}

export interface MovedAccount {
  accountId: string;
  name: string;
  beforeMonthlyCents: number;
  afterMonthlyCents: number;
}

export interface ExcludedContractAccount {
  accountId: string;
  name: string;
  contractId: string;
  reason: string;
  coveredCatalogIds: string[];
  protected: boolean;
  note: string;
}

export interface RepresentativeAccount {
  accountId: string;
  name: string;
  before: InvoicePreview;
  after: InvoicePreview;
  /** True when every line prices the same before and after (for example a contract override held). */
  unchanged: boolean;
}

export interface BlastRadius {
  draftIds: string[];
  /** The date both sides were priced on: the later of onDate and the latest draft effectiveFrom, so every
   *  draft in the set is live on the "after" side. */
  evaluatedOn: string;
  movedAccounts: MovedAccount[];
  excludedContractAccounts: ExcludedContractAccount[];
  representativeAccounts: RepresentativeAccount[];
  /** Sum over movedAccounts of after minus before, in base service cents per month. */
  totalMonthlyDeltaCents: number;
}

export interface BlastRadiusArgs {
  draftIds: string[];
  onDate: string;
  state?: EngineState;
}

export const REPRESENTATIVE_ACCOUNT_IDS = ['acct_res_maple', 'acct_res_001', 'acct_bakery'] as const;

const BILLABLE = new Set(['active', 'pastDue']);

function partyName(accountId: string, state: EngineState): string {
  const account = state.accounts.find((a) => a.id === accountId);
  return state.parties.find((p) => p.id === account?.payerPartyId)?.name ?? accountId;
}

function catalogName(catalogId: string, state: EngineState): string {
  return state.catalog.find((c) => c.id === catalogId)?.name ?? catalogId;
}

interface ActiveItem {
  itemId: string;
  catalogId: string;
  frequency: Frequency;
  qty: number;
  zoneId: string;
}

/** Active items on an account's sites, effective on the date. */
function activeItems(accountId: string, onDate: string, state: EngineState): ActiveItem[] {
  const sites = state.sites.filter((s) => s.accountId === accountId);
  const out: ActiveItem[] = [];
  for (const site of sites) {
    for (const si of state.serviceItems) {
      if (si.siteId !== site.id || si.status !== 'active') continue;
      if (dateOnly(si.effectiveFrom) > onDate) continue;
      if (si.effectiveTo !== undefined && dateOnly(si.effectiveTo) < onDate) continue;
      out.push({ itemId: si.id, catalogId: si.catalogId, frequency: si.frequency, qty: si.qty, zoneId: site.zoneId });
    }
  }
  return out;
}

function tryResolve(item: ActiveItem, accountId: string, onDate: string, state: EngineState): ResolvePriceResult | null {
  try {
    return resolvePrice({ catalogId: item.catalogId, frequency: item.frequency, zoneId: item.zoneId, accountId, onDate }, state);
  } catch {
    return null;
  }
}

/** Would this draft be the row an item resolves to if no contract stood in the way? */
function draftCovers(draft: RateVersion, item: ActiveItem): boolean {
  return (
    draft.catalogId === item.catalogId &&
    (draft.frequency === undefined || draft.frequency === item.frequency) &&
    (draft.zoneId === undefined || draft.zoneId === item.zoneId)
  );
}

/** Who moves, who is protected, and what three representative invoices look like before and after the
 *  drafts are published. An account is moved only when at least one of its active items resolves to a
 *  draft version after publish and did not resolve to a contract override before. Monthly cents are base
 *  service cents per month (qty times resolved price, no cycle multiplier, before fees and tax). */
export function blastRadius(args: BlastRadiusArgs): BlastRadius {
  const state = baseState(args.state);
  const draftIds = [...new Set(args.draftIds)];
  const drafts = draftIds.map((id) => {
    const rv = state.rateVersions.find((r) => r.id === id);
    if (!rv) throw new Error(`Unknown rate version ${id}`);
    if (rv.status !== 'draft') throw new Error(`${id} is already published`);
    return rv;
  });
  const draftIdSet = new Set(draftIds);

  const latestEffective = drafts.reduce((max, d) => (dateOnly(d.effectiveFrom) > max ? dateOnly(d.effectiveFrom) : max), '');
  const evaluatedOn = latestEffective > dateOnly(args.onDate) ? latestEffective : dateOnly(args.onDate);

  const afterRates = state.rateVersions.map((rv) =>
    draftIdSet.has(rv.id) ? ({ ...rv, status: 'published', publishedAt: evaluatedOn } as RateVersion) : rv,
  );
  const afterState: EngineState = { ...state, rateVersions: afterRates };

  const movedAccounts: MovedAccount[] = [];
  for (const account of state.accounts) {
    if (!BILLABLE.has(account.status)) continue;
    const items = activeItems(account.id, evaluatedOn, state);
    if (items.length === 0) continue;
    let before = 0;
    let after = 0;
    let moved = false;
    for (const item of items) {
      const b = tryResolve(item, account.id, evaluatedOn, state);
      const a = tryResolve(item, account.id, evaluatedOn, afterState);
      before += (b?.priceCents ?? 0) * item.qty;
      after += (a?.priceCents ?? 0) * item.qty;
      if (a?.rateVersionId !== undefined && draftIdSet.has(a.rateVersionId) && b?.ruleWon !== 'contractOverride') moved = true;
    }
    if (moved) {
      movedAccounts.push({ accountId: account.id, name: partyName(account.id, state), beforeMonthlyCents: before, afterMonthlyCents: after });
    }
  }
  movedAccounts.sort(
    (x, y) => y.afterMonthlyCents - y.beforeMonthlyCents - (x.afterMonthlyCents - x.beforeMonthlyCents) || x.accountId.localeCompare(y.accountId),
  );

  const excludedContractAccounts: ExcludedContractAccount[] = state.contracts.map((contract) => {
    const accountId = contract.accountId;
    const isProtected = within(evaluatedOn, contract.termStart, contract.termEnd);
    const coveredCatalogIds = [...new Set(contract.overrides.map((o) => o.catalogId))];
    const reasons = [...new Set(contract.overrides.map((o) => o.reason).filter((r): r is string => !!r))];
    const items = activeItems(accountId, evaluatedOn, state);
    const inScope = items.filter((item) => drafts.some((d) => draftCovers(d, item)));
    const covered = inScope.filter((item) =>
      contract.overrides.some((o) => o.catalogId === item.catalogId && (o.frequency === undefined || o.frequency === item.frequency)),
    );
    const uncovered = inScope.filter((item) => !covered.includes(item));
    const names = (rows: ActiveItem[]) => [...new Set(rows.map((r) => catalogName(r.catalogId, state)))].join(' and ');

    let note: string;
    if (!isProtected) note = `contract ended ${dateOnly(contract.termEnd)}, no longer protected`;
    else if (covered.length > 0 && uncovered.length === 0) note = `override covers ${names(covered)}`;
    else if (covered.length > 0) note = `override covers ${names(covered)}; ${names(uncovered)} is not covered and moves`;
    else if (inScope.length > 0) note = `override does not cover ${names(inScope)}, that item moves`;
    else note = "no service in this draft's scope, contract still protects it";

    return {
      accountId,
      name: partyName(accountId, state),
      contractId: contract.id,
      reason: reasons.join('; '),
      coveredCatalogIds,
      protected: isProtected,
      note,
    };
  });

  const representativeAccounts: RepresentativeAccount[] = REPRESENTATIVE_ACCOUNT_IDS.map((accountId) => {
    const before = previewInvoice({ accountId, onDate: evaluatedOn, state });
    const after = previewInvoice({ accountId, onDate: evaluatedOn, state, rateVersions: afterRates });
    const key = (p: InvoicePreview) => JSON.stringify(p.lines.map((l) => [l.source.id, l.baseCents, l.totalCents, l.pricing]));
    return { accountId, name: partyName(accountId, state), before, after, unchanged: key(before) === key(after) };
  });

  const totalMonthlyDeltaCents = movedAccounts.reduce((sum, m) => sum + (m.afterMonthlyCents - m.beforeMonthlyCents), 0);

  return { draftIds, evaluatedOn, movedAccounts, excludedContractAccounts, representativeAccounts, totalMonthlyDeltaCents };
}
