// Agent proposals: annual increase (checklist 6.1 and 6.4).
//
// Agent drafts. Rules authorize. You approve. Nothing here publishes.
//
// proposeIncreases is a pure function over the engine tables: one row per billable account with active
// service items, priced with resolvePrice and costed with costToServe at DEFAULT_ASSUMPTIONS. planApproval
// turns a set of approved rows into the writes they would make (deduplicated draft RateVersions and
// Contract escalator entries) so the panel can state them before anything runs. approveProposals applies a
// plan through the store's own actions. No function in this file calls publishRateVersions, and none
// writes a RateVersion other than by createDraftRateVersion.
import type { BillingAccount, Contract, Frequency, LOB, RateVersion } from '../types';
import { FREQUENCY_LABEL, resolvePrice, toEngineState, type EngineState, type ResolvePriceResult } from './engine';
import { useStore, type CreateDraftRateVersionArgs } from './store';
import { DEFAULT_ASSUMPTIONS, costToServe, type CostAssumptions } from './costToServe';
import { addDays, dateOnly, firstOfNextMonth, within } from './dates';
import { contractsOfAccount } from './contracts';
import { defaultMaterial } from '../lib/quote';
import { formatCents } from '../lib/money';

/** Standard annual increase for an account with no contract. */
export const STANDARD_INCREASE_PCT = 4;
/** Increase proposed when margin is below MARGIN_FLOOR_PCT. */
export const LOW_MARGIN_INCREASE_PCT = 6;
export const MARGIN_FLOOR_PCT = 20;
/** Days of notice a customer gets before a proposed ratebook increase takes effect. Drafts start on the
 *  first of the month at least this far out (2026-11-01 from 2026-09-10). */
export const PROPOSAL_NOTICE_DAYS = 30;

export type ChurnRisk = 'low' | 'medium' | 'high';
export type EligibilityKind = 'eligible' | 'escalatorScheduled' | 'locked';

export interface ProposalItem {
  catalogId: string;
  catalogName: string;
  frequency: Frequency;
  zoneId: string;
  qty: number;
  /** Per unit per month, from resolvePrice on onDate. */
  priceCents: number;
  ruleWon: ResolvePriceResult['ruleWon'];
  rateVersionId?: string;
  contractId?: string;
  /** Full cost to serve per unit per month at the default assumptions. */
  costCents: number;
}

/** One (catalogId, zoneId, frequency) rate line a no-contract account resolves to. */
export interface RateGroup {
  key: string;
  catalogId: string;
  zoneId?: string;
  frequency?: Frequency;
  /** The published RateVersion the account resolves to today; a draft supersedes it. */
  rateVersionId: string;
  currentPriceCents: number;
}

export type ProposalAction =
  | { kind: 'draftRateVersion'; groups: RateGroup[]; label: string }
  | { kind: 'escalator'; contractId: string; escalator: NonNullable<Contract['escalator']>; label: string }
  | { kind: 'none'; label: 'none' };

export interface ProposalRow {
  accountId: string;
  name: string;
  lob: LOB;
  accountStatus: BillingAccount['status'];
  items: ProposalItem[];
  currentMonthlyCents: number;
  costMonthlyCents: number;
  /** (current - cost) / current, one decimal. */
  marginPct: number;
  monthsSinceLastIncrease: number;
  /** Where monthsSinceLastIncrease was measured from. */
  lastIncrease: { date: string; source: 'rateVersion' | 'contract'; id: string };
  contractEligibility: string;
  eligibilityKind: EligibilityKind;
  /** The contract in force on onDate, when there is one. */
  contract?: Contract;
  /** The account's contract that has ended, when it has no contract in force. Shown, never written. */
  lapsedContract?: { id: string; termEnd: string; overridePriceCents?: number };
  churnRisk: ChurnRisk;
  churnBasis: string;
  /** Percent that takes effect: the scheduled escalator pct, 0 while a price is locked, else 4 or 6. */
  proposedPct: number;
  proposedMonthlyCents: number;
  /** When proposedMonthlyCents would take effect. */
  proposedEffective: string;
  /** For a locked contract: the fixed escalator approving would schedule at termEnd + 1 day. */
  escalatorPct?: number;
  rationale: string;
  action: ProposalAction;
}

export interface ProposeIncreasesArgs {
  onDate: string;
  assumptions?: CostAssumptions;
}

const BILLABLE = new Set<BillingAccount['status']>(['active', 'pastDue']);

const increased = (cents: number, pct: number): number => Math.round((cents * (100 + pct)) / 100);

export const rateGroupKey = (g: { catalogId: string; zoneId?: string; frequency?: Frequency }): string =>
  `${g.catalogId}|${g.zoneId ?? ''}|${g.frequency ?? ''}`;

/** Whole calendar months from `from` to `to`: 2025-01-01 to 2026-09-10 is 20. */
export function monthsBetween(from: string, to: string): number {
  const [y1, m1, d1] = dateOnly(from).split('-').map(Number);
  const [y2, m2, d2] = dateOnly(to).split('-').map(Number);
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
}

/** effectiveFrom for an agent drafted ratebook increase: first of the month at least PROPOSAL_NOTICE_DAYS out. */
export const proposalEffectiveFrom = (onDate: string): string => firstOfNextMonth(addDays(onDate, PROPOSAL_NOTICE_DAYS - 1));

/** Placeholder churn signal, labelled as such everywhere it is shown: pastDue high, autopay low, else medium. */
export function churnRiskFor(account: BillingAccount): { risk: ChurnRisk; basis: string } {
  if (account.status === 'pastDue') return { risk: 'high', basis: 'past due' };
  if (account.autopay) return { risk: 'low', basis: 'on autopay' };
  return { risk: 'medium', basis: 'no autopay, current' };
}

function partyName(account: BillingAccount, state: EngineState): string {
  return state.parties.find((p) => p.id === account.payerPartyId)?.name ?? account.id;
}

function zoneName(zoneId: string | undefined, state: EngineState): string {
  if (!zoneId) return 'all zones';
  return state.zones.find((z) => z.id === zoneId)?.name ?? zoneId;
}

/** "cat_res_96, zone_open, weekly" in the checklist's "<catalog, zone, frequency>" shape. */
export function groupLabel(g: Pick<RateGroup, 'catalogId' | 'zoneId' | 'frequency'>): string {
  return `${g.catalogId}, ${g.zoneId ?? 'all zones'}, ${g.frequency ?? 'any frequency'}`;
}

/** Contracts in force on the date, the one account.contractId names first. */
function contractInForce(state: EngineState, account: BillingAccount, onDate: string): Contract | undefined {
  return contractsOfAccount(state, account.id)
    .filter((c) => within(onDate, c.termStart, c.termEnd))
    .sort((a, b) => Number(b.id === account.contractId) - Number(a.id === account.contractId))[0];
}

function lapsedFor(state: EngineState, account: BillingAccount, onDate: string, items: ProposalItem[]): ProposalRow['lapsedContract'] {
  const ended = contractsOfAccount(state, account.id)
    .filter((c) => dateOnly(c.termEnd) < onDate)
    .sort((a, b) => dateOnly(b.termEnd).localeCompare(dateOnly(a.termEnd)))[0];
  if (!ended) return undefined;
  const override = ended.overrides.filter((o) => items.some((i) => i.catalogId === o.catalogId && (o.frequency === undefined || o.frequency === i.frequency))).at(-1);
  return { id: ended.id, termEnd: dateOnly(ended.termEnd), ...(override ? { overridePriceCents: override.priceCents } : {}) };
}

function activeItemsOf(state: EngineState, accountId: string, onDate: string): { catalogId: string; frequency: Frequency; qty: number; zoneId: string }[] {
  const out: { catalogId: string; frequency: Frequency; qty: number; zoneId: string }[] = [];
  for (const site of state.sites) {
    if (site.accountId !== accountId) continue;
    for (const si of state.serviceItems) {
      if (si.siteId !== site.id || si.status !== 'active') continue;
      if (dateOnly(si.effectiveFrom) > onDate) continue;
      if (si.effectiveTo !== undefined && dateOnly(si.effectiveTo) < onDate) continue;
      out.push({ catalogId: si.catalogId, frequency: si.frequency, qty: si.qty, zoneId: site.zoneId });
    }
  }
  return out;
}

const pctText = (n: number): string => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

/** One row per billable (active or pastDue) account with active service items on onDate, ranked: rows with
 *  something to approve first, then lowest margin first. Suspended and hold accounts are left out (see
 *  unproposedAccounts); an item with no published rate is skipped rather than crashing the panel. */
export function proposeIncreases(args: ProposeIncreasesArgs, stateIn?: EngineState): ProposalRow[] {
  const state = toEngineState(stateIn ?? useStore.getState());
  const onDate = dateOnly(args.onDate);
  const assumptions = args.assumptions ?? DEFAULT_ASSUMPTIONS;
  const rows: ProposalRow[] = [];

  for (const account of state.accounts) {
    if (!BILLABLE.has(account.status)) continue;
    const raw = activeItemsOf(state, account.id, onDate);
    const items: ProposalItem[] = [];
    for (const it of raw) {
      const catalog = state.catalog.find((c) => c.id === it.catalogId);
      if (!catalog) continue;
      let price: ResolvePriceResult;
      try {
        price = resolvePrice({ catalogId: it.catalogId, frequency: it.frequency, zoneId: it.zoneId, accountId: account.id, onDate }, state);
      } catch {
        continue;
      }
      const cost = costToServe({ item: catalog, material: defaultMaterial(catalog), frequency: it.frequency, assumptions });
      items.push({
        catalogId: it.catalogId,
        catalogName: catalog.name,
        frequency: it.frequency,
        zoneId: it.zoneId,
        qty: it.qty,
        priceCents: price.priceCents,
        ruleWon: price.ruleWon,
        ...(price.rateVersionId !== undefined ? { rateVersionId: price.rateVersionId } : {}),
        ...(price.contractId !== undefined ? { contractId: price.contractId } : {}),
        costCents: cost.fullCostCents,
      });
    }
    if (items.length === 0) continue;

    const currentMonthlyCents = items.reduce((s, i) => s + i.priceCents * i.qty, 0);
    const costMonthlyCents = items.reduce((s, i) => s + i.costCents * i.qty, 0);
    const marginPct = currentMonthlyCents > 0 ? Math.round(((currentMonthlyCents - costMonthlyCents) / currentMonthlyCents) * 1000) / 10 : 0;
    const lowMargin = marginPct < MARGIN_FLOOR_PCT;
    const ratebookPct = lowMargin ? LOW_MARGIN_INCREASE_PCT : STANDARD_INCREASE_PCT;

    // Months since last increase: the latest effectiveFrom among the RateVersions its items resolve to, or
    // the termStart of the contract whose override prices an item.
    let lastIncrease: ProposalRow['lastIncrease'] | undefined;
    for (const i of items) {
      let candidate: ProposalRow['lastIncrease'] | undefined;
      if (i.contractId) {
        const c = state.contracts.find((cc) => cc.id === i.contractId);
        if (c) candidate = { date: dateOnly(c.termStart), source: 'contract', id: c.id };
      } else if (i.rateVersionId) {
        const rv = state.rateVersions.find((r) => r.id === i.rateVersionId);
        if (rv) candidate = { date: dateOnly(rv.effectiveFrom), source: 'rateVersion', id: rv.id };
      }
      if (candidate && (!lastIncrease || candidate.date > lastIncrease.date)) lastIncrease = candidate;
    }
    lastIncrease ??= { date: onDate, source: 'rateVersion', id: 'unknown' };
    const monthsSinceLastIncrease = monthsBetween(lastIncrease.date, onDate);

    const lobCounts = new Map<LOB, number>();
    for (const i of items) {
      const lob = state.catalog.find((c) => c.id === i.catalogId)!.lob;
      lobCounts.set(lob, (lobCounts.get(lob) ?? 0) + i.qty);
    }
    const lob = [...lobCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

    const { risk: churnRisk, basis: churnBasis } = churnRiskFor(account);
    const contract = contractInForce(state, account, onDate);
    const lapsedContract = contract ? undefined : lapsedFor(state, account, onDate, items);

    const since = `${monthsSinceLastIncrease} month${monthsSinceLastIncrease === 1 ? '' : 's'} since the last increase (${lastIncrease.id}, ${lastIncrease.date})`;
    const marginText = `${pctText(marginPct)} margin over ${formatCents(costMonthlyCents)} a month cost to serve${lowMargin ? `, below the ${MARGIN_FLOOR_PCT}% floor` : ''}`;
    const churnText = `churn risk ${churnRisk} (placeholder: ${churnBasis})`;

    let contractEligibility: string;
    let eligibilityKind: EligibilityKind;
    let proposedPct: number;
    let proposedMonthlyCents: number;
    let proposedEffective: string;
    let escalatorPct: number | undefined;
    let action: ProposalAction;
    let decision: string;

    if (contract?.escalator) {
      const esc = contract.escalator;
      contractEligibility = `contract escalator ${pctText(esc.pct)} due ${dateOnly(esc.anniversary)}`;
      eligibilityKind = 'escalatorScheduled';
      proposedPct = esc.pct;
      proposedMonthlyCents = items.reduce((s, i) => s + increased(i.priceCents, esc.pct) * i.qty, 0);
      proposedEffective = dateOnly(esc.anniversary);
      action = { kind: 'none', label: 'none' };
      decision = `${contract.id} already schedules ${pctText(esc.pct)} on ${dateOnly(esc.anniversary)}, so nothing new is written${lowMargin ? ' and the margin is one to raise at renewal' : ''}`;
    } else if (contract) {
      const anniversary = addDays(contract.termEnd, 1);
      contractEligibility = `contract, no escalator, locked until ${dateOnly(contract.termEnd)}`;
      eligibilityKind = 'locked';
      proposedPct = 0;
      proposedMonthlyCents = currentMonthlyCents;
      proposedEffective = anniversary;
      escalatorPct = ratebookPct;
      action = {
        kind: 'escalator',
        contractId: contract.id,
        escalator: { kind: 'fixedPct', pct: ratebookPct, anniversary },
        label: `escalator entry on ${contract.id}`,
      };
      decision = `the price is held until ${dateOnly(contract.termEnd)}, so propose 0% now and a ${pctText(ratebookPct)} fixed escalator on ${contract.id} from ${anniversary}`;
    } else {
      const groups = new Map<string, RateGroup>();
      for (const i of items) {
        if (!i.rateVersionId) continue;
        const rv = state.rateVersions.find((r) => r.id === i.rateVersionId);
        if (!rv) continue;
        const g: RateGroup = {
          key: rateGroupKey(rv),
          catalogId: rv.catalogId,
          ...(rv.zoneId !== undefined ? { zoneId: rv.zoneId } : {}),
          ...(rv.frequency !== undefined ? { frequency: rv.frequency } : {}),
          rateVersionId: rv.id,
          currentPriceCents: rv.priceCents,
        };
        groups.set(g.key, g);
      }
      const list = [...groups.values()];
      contractEligibility = 'no contract, eligible';
      eligibilityKind = 'eligible';
      proposedPct = ratebookPct;
      proposedMonthlyCents = items.reduce((s, i) => s + increased(i.priceCents, ratebookPct) * i.qty, 0);
      proposedEffective = proposalEffectiveFrom(onDate);
      action = list.length
        ? { kind: 'draftRateVersion', groups: list, label: `draft RateVersion for ${list.map((g) => groupLabel(g)).join('; ')}` }
        : { kind: 'none', label: 'none' };
      decision = `no contract, so propose ${pctText(ratebookPct)} on the ratebook from ${proposedEffective}`;
    }

    const lapsedText = lapsedContract
      ? `Lapsed contract ${lapsedContract.id} ended ${lapsedContract.termEnd}, so the account already bills at the ratebook${lapsedContract.overridePriceCents !== undefined ? ` instead of its ${formatCents(lapsedContract.overridePriceCents)} contract price` : ''}; `
      : '';
    // Starts with a digit or "Lapsed", so no capitalisation step is needed (and none would touch an id).
    const rationale = `${lapsedText}${since}, ${marginText}, ${churnText}: ${decision}.`;

    rows.push({
      accountId: account.id,
      name: partyName(account, state),
      lob,
      accountStatus: account.status,
      items,
      currentMonthlyCents,
      costMonthlyCents,
      marginPct,
      monthsSinceLastIncrease,
      lastIncrease,
      contractEligibility,
      eligibilityKind,
      ...(contract ? { contract } : {}),
      ...(lapsedContract ? { lapsedContract } : {}),
      churnRisk,
      churnBasis,
      proposedPct,
      proposedMonthlyCents,
      proposedEffective,
      ...(escalatorPct !== undefined ? { escalatorPct } : {}),
      rationale,
      action,
    });
  }

  return rows.sort(
    (a, b) =>
      Number(a.action.kind === 'none') - Number(b.action.kind === 'none') ||
      a.marginPct - b.marginPct ||
      a.name.localeCompare(b.name),
  );
}

/** Accounts with active items that get no proposal because they are not billable (suspended or hold). */
export function unproposedAccounts({ onDate }: { onDate: string }, stateIn?: EngineState): { accountId: string; name: string; status: BillingAccount['status'] }[] {
  const state = toEngineState(stateIn ?? useStore.getState());
  const d = dateOnly(onDate);
  return state.accounts
    .filter((a) => !BILLABLE.has(a.status) && activeItemsOf(state, a.id, d).length > 0)
    .map((a) => ({ accountId: a.id, name: partyName(a, state), status: a.status }));
}

// ---------------------------------------------------------------------------------------------------------
// Approval

export type RowStatus =
  /** Something to approve. */
  | { kind: 'open' }
  /** Every rate line the row resolves to already has a pending draft. */
  | { kind: 'draftPending'; draftIds: string[] }
  /** The contract already carries an escalator; nothing to write. */
  | { kind: 'alreadyScheduled' };

/** Pending drafts per rate group key. */
export function pendingDraftsByGroup(rateVersions: RateVersion[]): Map<string, RateVersion[]> {
  const out = new Map<string, RateVersion[]>();
  for (const rv of rateVersions) {
    if (rv.status !== 'draft') continue;
    const k = rateGroupKey(rv);
    out.set(k, [...(out.get(k) ?? []), rv]);
  }
  return out;
}

export function rowStatus(row: ProposalRow, rateVersions: RateVersion[]): RowStatus {
  if (row.action.kind === 'none') return { kind: 'alreadyScheduled' };
  if (row.action.kind === 'escalator') return { kind: 'open' };
  const pending = pendingDraftsByGroup(rateVersions);
  const ids: string[] = [];
  for (const g of row.action.groups) {
    const p = pending.get(g.key);
    if (!p?.length) return { kind: 'open' };
    ids.push(...p.map((rv) => rv.id));
  }
  return { kind: 'draftPending', draftIds: ids };
}

export interface PlannedDraft {
  key: string;
  args: CreateDraftRateVersionArgs;
  pct: number;
  currentPriceCents: number;
  /** Approved rows that asked for this rate line. */
  approvedAccountIds: string[];
  /** When the approved rows disagree on pct (4 against 6), the lowest wins and this is true. */
  pctConflict: boolean;
}

export interface ApprovalPlan {
  drafts: PlannedDraft[];
  /** Rate lines skipped because a draft is already pending there (from the bulk control or an earlier approval). */
  alreadyPending: { key: string; draftIds: string[]; label: string }[];
  escalators: { accountId: string; contractId: string; escalator: NonNullable<Contract['escalator']> }[];
  /** Approved rows with nothing to write (escalator already scheduled). */
  alreadyScheduled: string[];
  /** Rows that will be written for. */
  approvedAccountIds: string[];
  /** Every proposed account whose price the new drafts would move once published, approved or not: a
   *  RateVersion is a list price, so it moves everyone on that rate line. */
  coveredAccountIds: string[];
  summary: string;
}

/** What approving these rows would write. Drafts are deduplicated by (catalogId, zoneId, frequency) so many
 *  accounts on the same rate produce one draft, and a rate line with a pending draft is left alone. */
export function planApproval(allRows: ProposalRow[], accountIds: string[], rateVersions: RateVersion[], onDate: string): ApprovalPlan {
  const selected = new Set(accountIds);
  const pending = pendingDraftsByGroup(rateVersions);
  const drafts = new Map<string, PlannedDraft>();
  const alreadyPending = new Map<string, { key: string; draftIds: string[]; label: string }>();
  const escalators: ApprovalPlan['escalators'] = [];
  const alreadyScheduled: string[] = [];
  const approved: string[] = [];
  const effectiveFrom = proposalEffectiveFrom(dateOnly(onDate));

  for (const row of allRows) {
    if (!selected.has(row.accountId)) continue;
    const a = row.action;
    if (a.kind === 'none') {
      alreadyScheduled.push(row.accountId);
      continue;
    }
    if (a.kind === 'escalator') {
      escalators.push({ accountId: row.accountId, contractId: a.contractId, escalator: a.escalator });
      approved.push(row.accountId);
      continue;
    }
    let wrote = false;
    for (const g of a.groups) {
      const p = pending.get(g.key);
      if (p?.length) {
        alreadyPending.set(g.key, { key: g.key, draftIds: p.map((rv) => rv.id), label: groupLabel(g) });
        continue;
      }
      wrote = true;
      const cur = drafts.get(g.key);
      if (!cur) {
        drafts.set(g.key, {
          key: g.key,
          pct: row.proposedPct,
          currentPriceCents: g.currentPriceCents,
          approvedAccountIds: [row.accountId],
          pctConflict: false,
          args: {
            catalogId: g.catalogId,
            ...(g.zoneId !== undefined ? { zoneId: g.zoneId } : {}),
            ...(g.frequency !== undefined ? { frequency: g.frequency } : {}),
            priceCents: increased(g.currentPriceCents, row.proposedPct),
            effectiveFrom,
            supersedesId: g.rateVersionId,
          },
        });
      } else {
        const pct = Math.min(cur.pct, row.proposedPct);
        drafts.set(g.key, {
          ...cur,
          pct,
          pctConflict: cur.pctConflict || cur.pct !== row.proposedPct,
          approvedAccountIds: [...cur.approvedAccountIds, row.accountId],
          args: { ...cur.args, priceCents: increased(cur.currentPriceCents, pct) },
        });
      }
    }
    if (wrote) approved.push(row.accountId);
  }

  const draftKeys = new Set(drafts.keys());
  const coveredAccountIds = allRows
    .filter((r) => r.action.kind === 'draftRateVersion' && r.action.groups.some((g) => draftKeys.has(g.key)))
    .map((r) => r.accountId);

  const n = drafts.size;
  const m = coveredAccountIds.length;
  const k = escalators.length;
  const parts: string[] = [];
  if (n > 0) parts.push(`Creates ${n} draft rate version${n === 1 ? '' : 's'} covering ${m} account${m === 1 ? '' : 's'}`);
  if (k > 0) parts.push(`${n > 0 ? 'writes' : 'Writes'} ${k} contract escalator entr${k === 1 ? 'y' : 'ies'}`);
  const summary = parts.length ? `${parts.join(' and ')}. Nothing publishes.` : 'Nothing to write. Nothing publishes.';

  return {
    drafts: [...drafts.values()],
    alreadyPending: [...alreadyPending.values()],
    escalators,
    alreadyScheduled,
    approvedAccountIds: approved,
    coveredAccountIds,
    summary,
  };
}

/** The confirm button says what the approval will write (checklist 7.8). Nothing publishes in any case:
 *  the words are "create drafts" and "write escalator", never "publish". */
export function approveButtonLabel(plan: Pick<ApprovalPlan, 'drafts' | 'escalators'>): string {
  const drafts = plan.drafts.length > 0;
  const escalators = plan.escalators.length > 0;
  if (drafts && escalators) return 'Approve, create drafts and escalators';
  if (escalators) return 'Approve, write escalator only';
  if (drafts) return 'Approve, create drafts only';
  return 'Nothing to approve';
}

export interface ApprovalResult {
  plan: ApprovalPlan;
  drafts: RateVersion[];
  contracts: Contract[];
}

/** Applies planApproval through the store: createDraftRateVersion per planned draft, setContractEscalator
 *  per escalator entry, and records the new draft ids as agent drafts for the Ratebook status line. Never
 *  calls publishRateVersions. */
export function approveProposals({ accountIds, onDate, rows }: { accountIds: string[]; onDate: string; rows?: ProposalRow[] }): ApprovalResult {
  const store = useStore.getState();
  const allRows = rows ?? proposeIncreases({ onDate }, store);
  const plan = planApproval(allRows, accountIds, store.rateVersions, onDate);
  const drafts = plan.drafts.map((d) => useStore.getState().createDraftRateVersion(d.args));
  const contracts = plan.escalators.map((e) => useStore.getState().setContractEscalator({ accountId: e.accountId, escalator: e.escalator, today: onDate }));
  if (drafts.length) useStore.getState().markAgentDrafts(drafts.map((d) => d.id));
  return { plan, drafts, contracts };
}

/** Frequency label for a rate group, for the panel. */
export const groupFrequencyLabel = (g: Pick<RateGroup, 'frequency'>): string => (g.frequency ? FREQUENCY_LABEL[g.frequency] : 'any frequency');

export { zoneName };
