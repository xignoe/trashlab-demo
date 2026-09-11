// Checklist 6.6: agent proposals for an annual increase. Agent drafts. Rules authorize. You approve.
// Nothing here publishes.
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { TODAY } from './dates';
import { resolvePrice } from './engine';
import { approveProposals, monthsBetween, planApproval, proposalEffectiveFrom, proposeIncreases, rowStatus, unproposedAccounts, type ProposalRow } from './agentProposals';
import { lobDrafts, versionHistory } from '../lib/ratebook';

const state = () => useStore.getState();
const rows = () => proposeIncreases({ onDate: TODAY });
const row = (id: string): ProposalRow => {
  const r = rows().find((x) => x.accountId === id);
  if (!r) throw new Error(`no proposal for ${id}`);
  return r;
};

beforeEach(() => state().reset());

describe('proposeIncreases (6.1)', () => {
  it('acct_bakery proposes its 4 percent escalator with action none', () => {
    const r = row('acct_bakery');
    expect(r.proposedPct).toBe(4);
    expect(r.contractEligibility).toBe('contract escalator 4% due 2027-01-01');
    expect(r.eligibilityKind).toBe('escalatorScheduled');
    expect(r.action).toEqual({ kind: 'none', label: 'none' });
    expect(r.currentMonthlyCents).toBe(36900); // 19800 + 17100 contract prices
    expect(r.proposedMonthlyCents).toBe(20592 + 17784);
    expect(r.proposedEffective).toBe('2027-01-01');
    expect(r.monthsSinceLastIncrease).toBe(8); // contract_bakery termStart 2026-01-01
    expect(r.lastIncrease).toEqual({ date: '2026-01-01', source: 'contract', id: 'contract_bakery' });
    expect(r.marginPct).toBeLessThan(20);
  });

  it('acct_fl_003 proposes an escalator entry on its locked contract', () => {
    const r = row('acct_fl_003');
    expect(r.contractEligibility).toBe('contract, no escalator, locked until 2026-12-31');
    expect(r.proposedPct).toBe(0);
    expect(r.proposedMonthlyCents).toBe(r.currentMonthlyCents);
    expect(r.marginPct).toBe(19.1); // $209 against $169.10 full cost, below the 20 percent floor
    expect(r.escalatorPct).toBe(6);
    expect(r.action).toEqual({
      kind: 'escalator',
      contractId: 'contract_fl_003',
      escalator: { kind: 'fixedPct', pct: 6, anniversary: '2027-01-01' },
      label: 'escalator entry on contract_fl_003',
    });
  });

  it('acct_res_001 proposes a draft RateVersion for the rate line it resolves to', () => {
    const r = row('acct_res_001');
    expect(r.contractEligibility).toBe('no contract, eligible');
    expect(r.proposedPct).toBe(4);
    expect(r.currentMonthlyCents).toBe(2900);
    expect(r.proposedMonthlyCents).toBe(3016);
    expect(r.monthsSinceLastIncrease).toBe(20); // rv_res_96_open_weekly effective 2025-01-01
    expect(r.churnRisk).toBe('medium');
    expect(r.action.kind).toBe('draftRateVersion');
    expect(r.action.label).toBe('draft RateVersion for cat_res_96, zone_open, weekly');
    expect(r.rationale).toMatch(/^20 months since the last increase \(rv_res_96_open_weekly, 2025-01-01\), 56\.1% margin/);
  });

  it('residential margins land near 55 percent at the default assumptions, not below zero', () => {
    const res = rows().filter((r) => r.lob === 'residential' && r.accountId.startsWith('acct_res_0'));
    expect(res).toHaveLength(30);
    for (const r of res) {
      expect(r.marginPct).toBeGreaterThan(50);
      expect(r.marginPct).toBeLessThan(62);
    }
  });

  it('churn risk placeholder: pastDue high, autopay low, else medium', () => {
    expect(row('acct_res_maple').churnRisk).toBe('high');
    expect(row('acct_res_003').churnRisk).toBe('low');
    expect(row('acct_fl_005').churnRisk).toBe('medium');
    expect(row('acct_res_maple').rationale).toContain('(placeholder: past due)');
  });

  it('a lapsed contract is named but the account is eligible on the ratebook', () => {
    const r = row('acct_fl_004');
    expect(r.contractEligibility).toBe('no contract, eligible');
    expect(r.lapsedContract).toEqual({ id: 'contract_fl_004', termEnd: '2026-08-31', overridePriceCents: 20900 });
    expect(r.action.label).toBe('draft RateVersion for cat_fl_3yd, all zones, 2x');
    expect(r.rationale).toMatch(/^Lapsed contract contract_fl_004 ended 2026-08-31/);
  });

  it('rows are billable accounts only, ranked with work to approve first', () => {
    const all = rows();
    expect(all.map((r) => r.accountId)).not.toContain('acct_res_kerr'); // suspended
    expect(all.map((r) => r.accountId)).not.toContain('acct_res_holt'); // item held
    expect(unproposedAccounts({ onDate: TODAY })).toEqual([{ accountId: 'acct_res_kerr', name: 'Kerr', status: 'suspended' }]);
    const firstNone = all.findIndex((r) => r.action.kind === 'none');
    expect(all.slice(firstNone).every((r) => r.action.kind === 'none')).toBe(true);
    expect(all.slice(firstNone).map((r) => r.accountId).sort()).toEqual(['acct_bakery', 'acct_fl_001', 'acct_fl_002']);
  });

  it('dates: months between and the notice-respecting effective date', () => {
    expect(monthsBetween('2025-01-01', '2026-09-10')).toBe(20);
    expect(monthsBetween('2026-01-01', '2026-09-10')).toBe(8);
    expect(monthsBetween('2026-09-11', '2026-09-10')).toBe(0);
    expect(proposalEffectiveFrom('2026-09-10')).toBe('2026-11-01');
    expect(proposalEffectiveFrom('2026-09-01')).toBe('2026-10-01');
  });
});

describe('planApproval and approveProposals (6.4)', () => {
  it('deduplicates drafts: approving every row creates 7 drafts covering 39 accounts and 1 escalator entry', () => {
    const all = rows();
    const plan = planApproval(all, all.map((r) => r.accountId), state().rateVersions, TODAY);
    expect(plan.drafts).toHaveLength(7);
    expect(plan.coveredAccountIds).toHaveLength(39);
    expect(plan.escalators).toEqual([{ accountId: 'acct_fl_003', contractId: 'contract_fl_003', escalator: { kind: 'fixedPct', pct: 6, anniversary: '2027-01-01' } }]);
    expect(plan.alreadyScheduled.sort()).toEqual(['acct_bakery', 'acct_fl_001', 'acct_fl_002']);
    expect(plan.summary).toBe('Creates 7 draft rate versions covering 39 accounts and writes 1 contract escalator entry. Nothing publishes.');
    const res96 = plan.drafts.find((d) => d.key === 'cat_res_96|zone_open|weekly')!;
    expect(res96.args).toEqual({ catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 3016, effectiveFrom: '2026-11-01', supersedesId: 'rv_res_96_open_weekly' });
  });

  it('approving one residential row still states everyone the rate line moves', () => {
    const plan = planApproval(rows(), ['acct_res_001'], state().rateVersions, TODAY);
    expect(plan.drafts).toHaveLength(1);
    // 28 generic 96 gal accounts plus maple; Kerr is suspended and Holt is held.
    expect(plan.coveredAccountIds).toHaveLength(29);
    expect(plan.summary).toBe('Creates 1 draft rate version covering 29 accounts. Nothing publishes.');
  });

  it('approving all never changes any RateVersion status to published', () => {
    const before = state().rateVersions;
    const publishedBefore = before.filter((rv) => rv.status === 'published');
    // Any call to publish from this path fails the test.
    useStore.setState({ publishRateVersions: () => { throw new Error('the agent panel must never publish'); } });

    const all = rows();
    const result = approveProposals({ accountIds: all.map((r) => r.accountId), onDate: TODAY });

    const after = state().rateVersions;
    const publishedAfter = after.filter((rv) => rv.status === 'published');
    expect(publishedAfter).toHaveLength(publishedBefore.length);
    publishedBefore.forEach((rv) => expect(after).toContain(rv)); // same objects, untouched
    expect(result.drafts).toHaveLength(7);
    for (const d of result.drafts) {
      expect(d.status).toBe('draft');
      expect(d.publishedAt).toBeUndefined();
      expect(after.find((rv) => rv.id === d.id)).toBe(d);
    }
    expect(state().agentDraftIds.sort()).toEqual(result.drafts.map((d) => d.id).sort());
    // Today's prices are unchanged: drafts are never considered by resolvePrice.
    expect(resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_001', onDate: '2026-11-01' }).priceCents).toBe(2900);
  });

  it('writes the escalator on contract_fl_003, leaves bakery alone, and a second approve writes nothing new', () => {
    const bakery = state().contracts.find((c) => c.id === 'contract_bakery');
    const all = rows();
    approveProposals({ accountIds: all.map((r) => r.accountId), onDate: TODAY });
    expect(state().contracts.find((c) => c.id === 'contract_fl_003')!.escalator).toEqual({ kind: 'fixedPct', pct: 6, anniversary: '2027-01-01' });
    expect(state().contracts.find((c) => c.id === 'contract_bakery')).toBe(bakery);
    expect(state().contracts).toHaveLength(5); // no contract created: fl_004 gets a ratebook draft, not a contract

    const again = rows();
    expect(again.find((r) => r.accountId === 'acct_fl_003')!.action.kind).toBe('none'); // now already scheduled
    expect(rowStatus(again.find((r) => r.accountId === 'acct_res_001')!, state().rateVersions).kind).toBe('draftPending');
    const second = approveProposals({ accountIds: again.map((r) => r.accountId), onDate: TODAY });
    expect(second.drafts).toHaveLength(0);
    expect(second.contracts).toHaveLength(0);
    expect(second.plan.alreadyPending).toHaveLength(7);
    expect(state().rateVersions.filter((rv) => rv.status === 'draft')).toHaveLength(7);
  });

  it('agent drafts land where the Phase 4 drafts tray and history drawer read them (6.5)', () => {
    approveProposals({ accountIds: ['acct_res_001'], onDate: TODAY });
    const tray = lobDrafts(state(), 'residential');
    expect(tray.map((d) => d.draft.id)).toEqual(['rv_res_96_open_weekly_20261101']);
    expect(tray[0].supersedes?.id).toBe('rv_res_96_open_weekly');
    const history = versionHistory(state(), { catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly' }, TODAY);
    expect(history[0].version).toMatchObject({ id: 'rv_res_96_open_weekly_20261101', status: 'draft', priceCents: 3016 });
    expect(history.find((h) => h.version.id === 'rv_res_96_open_weekly')).toMatchObject({ isCurrent: true, version: { status: 'published', priceCents: 2900 } });
  });

  it('a rate line with a pending bulk draft is left alone', () => {
    const [bulk] = state().createBulkIncreaseDrafts({ lob: 'residential', pct: 4, effectiveFrom: '2026-10-01' });
    const plan = planApproval(rows(), ['acct_res_001'], state().rateVersions, TODAY);
    expect(plan.drafts).toHaveLength(0);
    expect(plan.alreadyPending[0]).toMatchObject({ key: 'cat_res_96|zone_open|weekly' });
    expect(plan.alreadyPending[0].draftIds).toContain(bulk.id);
    expect(plan.summary).toBe('Nothing to write. Nothing publishes.');
  });
});
