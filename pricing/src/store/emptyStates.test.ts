// Checklist 7.7 (empty and error states) and 7.8 (agent confirm label). Pure store and helper tests; the
// components read exactly these values.
import { beforeEach, describe, expect, it } from 'vitest';
import { isNoChangeDraft, useStore } from './store';
import { toEngineState } from './engine';
import { blastRadius } from './preview';
import { TODAY } from './dates';
import { approveButtonLabel, approveProposals, planApproval, proposeIncreases } from './agentProposals';
import { safeResolve } from '../lib/quote';

const state = () => useStore.getState();
beforeEach(() => state().reset());

describe('a draft with no changes cannot be published (7.7)', () => {
  it('isNoChangeDraft is true only when the draft repeats the superseded price', () => {
    const same = state().createDraftRateVersion({ catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 2900, effectiveFrom: '2026-10-01', supersedesId: 'rv_res_96_open_weekly' });
    const changed = state().createDraftRateVersion({ catalogId: 'cat_res_64', zoneId: 'zone_open', frequency: 'weekly', priceCents: 2700, effectiveFrom: '2026-10-01', supersedesId: 'rv_res_64_open_weekly' });
    const newLine = state().createDraftRateVersion({ catalogId: 'cat_res_96', zoneId: 'zone_franchise', frequency: 'weekly', priceCents: 3300, effectiveFrom: '2026-10-01' });
    const rvs = state().rateVersions;
    expect(isNoChangeDraft(same, rvs)).toBe(true);
    expect(isNoChangeDraft(changed, rvs)).toBe(false);
    expect(isNoChangeDraft(newLine, rvs)).toBe(false);
    expect(isNoChangeDraft(rvs.find((rv) => rv.id === 'rv_res_96_open_weekly')!, rvs)).toBe(false); // published rows are never "drafts"
  });

  it('publishRateVersions leaves a no-change draft as a draft and publishes the rest', () => {
    const same = state().createDraftRateVersion({ catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 2900, effectiveFrom: '2026-10-01', supersedesId: 'rv_res_96_open_weekly' });
    const changed = state().createDraftRateVersion({ catalogId: 'cat_res_64', zoneId: 'zone_open', frequency: 'weekly', priceCents: 2700, effectiveFrom: '2026-10-01', supersedesId: 'rv_res_64_open_weekly' });
    const before = state().rateVersions.find((rv) => rv.id === 'rv_res_96_open_weekly');
    const out = state().publishRateVersions({ draftIds: [same.id, changed.id], publishedAt: `${TODAY}T09:00:00-04:00` });
    expect(out.map((rv) => rv.id)).toEqual([changed.id]);
    expect(state().rateVersions.find((rv) => rv.id === same.id)?.status).toBe('draft');
    expect(state().rateVersions.find((rv) => rv.id === 'rv_res_96_open_weekly')).toBe(before);
  });
});

describe('publish preview with zero moved accounts (7.7)', () => {
  it('a zone_boundary draft moves nobody: no account is billed in zone_boundary', () => {
    const d = state().createDraftRateVersion({ catalogId: 'cat_res_96', zoneId: 'zone_boundary', frequency: 'weekly', priceCents: 3200, effectiveFrom: '2026-10-01', supersedesId: 'rv_res_96_boundary_weekly' });
    const r = blastRadius({ draftIds: [d.id], onDate: TODAY });
    expect(r.movedAccounts).toEqual([]);
    expect(r.totalMonthlyDeltaCents).toBe(0);
    expect(r.draftIds).toEqual([d.id]);
  });
});

describe('resolvePrice throw is caught for the quote workbench (7.7)', () => {
  it('safeResolve returns the error instead of throwing', () => {
    const out = safeResolve({ catalogId: 'cat_fl_3yd_wood', frequency: 'weekly', zoneId: 'zone_open', onDate: TODAY }, toEngineState(state()));
    expect(out).toEqual({ ok: false, error: 'No published rate for cat_fl_3yd_wood' });
  });
});

describe('agent confirm label matches its plan (7.8)', () => {
  const plan = (ids: string[]) => planApproval(proposeIncreases({ onDate: TODAY }), ids, state().rateVersions, TODAY);

  it('escalator only, drafts only, both, and nothing', () => {
    expect(approveButtonLabel(plan(['acct_fl_003']))).toBe('Approve, write escalator only');
    expect(approveButtonLabel(plan(['acct_res_001']))).toBe('Approve, create drafts only');
    expect(approveButtonLabel(plan(['acct_res_001', 'acct_fl_003']))).toBe('Approve, create drafts and escalators');
    expect(approveButtonLabel(plan(['acct_bakery']))).toBe('Nothing to approve');
  });

  it('no label ever says publish, and approving the mixed plan publishes nothing', () => {
    for (const ids of [['acct_fl_003'], ['acct_res_001'], ['acct_res_001', 'acct_fl_003'], ['acct_bakery']]) {
      expect(approveButtonLabel(plan(ids)).toLowerCase()).not.toContain('publish');
    }
    const publishedBefore = state().rateVersions.filter((rv) => rv.status === 'published').map((rv) => rv.id);
    const r = approveProposals({ accountIds: ['acct_res_001', 'acct_fl_003'], onDate: TODAY });
    expect(r.drafts.length).toBeGreaterThan(0);
    expect(r.contracts.length).toBe(1);
    expect(state().rateVersions.filter((rv) => rv.status === 'published').map((rv) => rv.id)).toEqual(publishedBefore);
  });
});
