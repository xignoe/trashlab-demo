// previewInvoice, blastRadius, and the store actions they depend on.
import { beforeEach, describe, expect, it } from 'vitest';
import { blastRadius, previewInvoice } from './preview';
import { useStore } from './store';

describe('previewInvoice', () => {
  beforeEach(() => useStore.getState().reset());

  it('totals the recurring lines for one account and does not touch the store', () => {
    const before = structuredClone(useStore.getState().rateVersions);
    const p = previewInvoice({ accountId: 'acct_res_maple', onDate: '2026-10-01' });
    expect(p.lines.map((l) => l.source.id)).toEqual(['si_res_maple_96', 'si_res_maple_extra', 'si_res_maple_recycling']);
    expect(p).toMatchObject({ subtotalCents: 15000, feeCents: 1950, taxCents: 1124, totalCents: 18074 });
    expect(useStore.getState().rateVersions).toEqual(before);
    expect(useStore.getState().charges.some((c) => c.id.startsWith('ch_si_res_maple'))).toBe(false);
  });

  it('prices against an overriding rateVersions array', () => {
    const rates = useStore.getState().rateVersions.map((rv) => (rv.id === 'rv_res_96_open_weekly' ? { ...rv, priceCents: 4000 } : rv));
    const p = previewInvoice({ accountId: 'acct_res_001', onDate: '2026-10-01', rateVersions: rates });
    expect(p.lines[0].baseCents).toBe(4000 * 3);
    expect(previewInvoice({ accountId: 'acct_res_001', onDate: '2026-10-01' }).lines[0].baseCents).toBe(2900 * 3);
  });

  it('a suspended account previews to nothing', () => {
    const p = previewInvoice({ accountId: 'acct_res_kerr', onDate: '2026-10-01' });
    expect(p.lines).toEqual([]);
    expect(p.totalCents).toBe(0);
  });
});

describe('blastRadius', () => {
  beforeEach(() => useStore.getState().reset());

  it('4 percent residential increase: 31 accounts move, every contract account is listed, bakery unchanged', () => {
    const drafts = useStore.getState().createBulkIncreaseDrafts({ lob: 'residential', pct: 4, effectiveFrom: '2026-10-01' });
    const storeBefore = structuredClone(useStore.getState().rateVersions);
    const r = blastRadius({ draftIds: drafts.map((d) => d.id), onDate: '2026-09-10' });

    expect(r.evaluatedOn).toBe('2026-10-01');
    expect(r.movedAccounts).toHaveLength(31);
    const ids = r.movedAccounts.map((m) => m.accountId);
    expect(ids).toContain('acct_res_maple');
    expect(ids).toContain('acct_res_001');
    expect(ids).toContain('acct_res_030');
    expect(ids).not.toContain('acct_res_kerr'); // suspended
    expect(ids).not.toContain('acct_res_holt'); // item held
    expect(ids).not.toContain('acct_bakery');
    expect(ids).not.toContain('acct_fl_004'); // frontload, out of scope
    const maple = r.movedAccounts.find((m) => m.accountId === 'acct_res_maple')!;
    expect(maple).toEqual({ accountId: 'acct_res_maple', name: 'Maple Street Homeowner', beforeMonthlyCents: 5000, afterMonthlyCents: 5200 });
    expect(r.totalMonthlyDeltaCents).toBe(r.movedAccounts.reduce((s, m) => s + m.afterMonthlyCents - m.beforeMonthlyCents, 0));
    expect(r.totalMonthlyDeltaCents).toBeGreaterThan(0);

    const excluded = Object.fromEntries(r.excludedContractAccounts.map((e) => [e.accountId, e]));
    expect(Object.keys(excluded).sort()).toEqual(['acct_bakery', 'acct_fl_001', 'acct_fl_002', 'acct_fl_003', 'acct_fl_004']);
    expect(excluded.acct_bakery).toMatchObject({
      name: 'Sunrise Bakery',
      contractId: 'contract_bakery',
      reason: 'competitive match',
      coveredCatalogIds: ['cat_fl_3yd', 'cat_fl_3yd_wood'],
      protected: true,
      note: "no service in this draft's scope, contract still protects it",
    });
    expect(excluded.acct_fl_001.protected).toBe(true);
    expect(excluded.acct_fl_003.note).toBe("no service in this draft's scope, contract still protects it");
    expect(excluded.acct_fl_004).toMatchObject({ protected: false, note: 'contract ended 2026-08-31, no longer protected' });

    expect(r.representativeAccounts.map((a) => a.accountId)).toEqual(['acct_res_maple', 'acct_res_001', 'acct_bakery']);
    const [rMaple, rOne, rBakery] = r.representativeAccounts;
    expect(rMaple.before.totalCents).toBe(18074);
    expect(rMaple.after.totalCents).toBeGreaterThan(rMaple.before.totalCents);
    expect(rMaple.unchanged).toBe(false);
    expect(rOne.before.lines[0].pricing.rateVersionId).toBe('rv_res_96_open_weekly');
    expect(rOne.after.lines[0].pricing.rateVersionId).toBe(drafts.find((d) => d.supersedesId === 'rv_res_96_open_weekly')!.id);
    expect(rBakery.unchanged).toBe(true);
    expect(rBakery.after.totalCents).toBe(rBakery.before.totalCents);
    expect(rBakery.after.lines.every((l) => l.pricing.ruleWon === 'contractOverride')).toBe(true);

    // Preview is pure: drafts are still drafts and nothing else changed.
    expect(useStore.getState().rateVersions).toEqual(storeBefore);
    expect(useStore.getState().rateVersions.filter((rv) => rv.status === 'draft')).toHaveLength(8);
  });

  it('frontload increase: overrides cover in-scope items, a lapsed contract account moves', () => {
    const drafts = useStore.getState().createBulkIncreaseDrafts({ lob: 'frontload', pct: 4, effectiveFrom: '2026-10-01' });
    const r = blastRadius({ draftIds: drafts.map((d) => d.id), onDate: '2026-10-01' });
    const excluded = Object.fromEntries(r.excludedContractAccounts.map((e) => [e.accountId, e]));
    expect(excluded.acct_bakery.note).toBe('override covers 3 yd frontload and 3 yd frontload, wood waste');
    expect(excluded.acct_fl_001.note).toBe('override covers 3 yd frontload');
    expect(excluded.acct_fl_004).toMatchObject({ protected: false, note: 'contract ended 2026-08-31, no longer protected' });

    const ids = r.movedAccounts.map((m) => m.accountId);
    expect(ids).toContain('acct_fl_004');
    expect(ids).toContain('acct_pm_oakridge');
    expect(ids).toContain('acct_fl_005');
    expect(ids).not.toContain('acct_bakery');
    expect(ids).not.toContain('acct_fl_001');
    expect(ids).not.toContain('acct_res_001');
    expect(r.movedAccounts.find((m) => m.accountId === 'acct_fl_004')).toMatchObject({ beforeMonthlyCents: 22000, afterMonthlyCents: 22880 });
    expect(r.movedAccounts.find((m) => m.accountId === 'acct_pm_oakridge')).toMatchObject({ beforeMonthlyCents: 64000, afterMonthlyCents: 66560 });
    expect(r.representativeAccounts[2].unchanged).toBe(true);
  });

  it('a single draft that changes nothing moves nobody', () => {
    const d = useStore.getState().createDraftRateVersion({ catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 2900, effectiveFrom: '2026-10-01', supersedesId: 'rv_res_96_open_weekly' });
    const r = blastRadius({ draftIds: [d.id], onDate: '2026-10-01' });
    // Every billable account with an active 96 gal weekly cart in zone_open resolves to the draft, at the same price.
    const st = useStore.getState();
    const expected = st.accounts.filter((a) => (a.status === 'active' || a.status === 'pastDue') && st.sites.some((site) => site.accountId === a.id && site.zoneId === 'zone_open' && st.serviceItems.some((si) => si.siteId === site.id && si.status === 'active' && si.catalogId === 'cat_res_96' && si.frequency === 'weekly')));
    expect(expected.length).toBe(29);
    expect(r.movedAccounts.map((m) => m.accountId).sort()).toEqual(expected.map((a) => a.id).sort());
    expect(r.totalMonthlyDeltaCents).toBe(0);
  });

  it('rejects ids that are not pending drafts', () => {
    expect(() => blastRadius({ draftIds: ['rv_res_96_open_weekly'], onDate: '2026-10-01' })).toThrow('already published');
    expect(() => blastRadius({ draftIds: ['rv_nope'], onDate: '2026-10-01' })).toThrow('Unknown rate version');
  });
});

describe('store actions', () => {
  beforeEach(() => useStore.getState().reset());

  it('createDraftRateVersion appends a draft with a readable unique id', () => {
    const s = useStore.getState();
    const a = s.createDraftRateVersion({ catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 3016.4, effectiveFrom: '2026-10-01', supersedesId: 'rv_res_96_open_weekly' });
    expect(a).toEqual({ id: 'rv_res_96_open_weekly_20261001', catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 3016, effectiveFrom: '2026-10-01', status: 'draft', supersedesId: 'rv_res_96_open_weekly' });
    const b = useStore.getState().createDraftRateVersion({ catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 3100, effectiveFrom: '2026-10-01' });
    expect(b.id).toBe('rv_res_96_open_weekly_20261001_2');
    expect(b).not.toHaveProperty('supersedesId');
    expect(useStore.getState().rateVersions).toHaveLength(17);
  });

  it('createBulkIncreaseDrafts targets only the latest published version per group', () => {
    const drafts = useStore.getState().createBulkIncreaseDrafts({ lob: 'residential', pct: 4, effectiveFrom: '2026-10-01' });
    expect(drafts.map((d) => d.supersedesId).sort()).toEqual([
      'rv_res_64_boundary_weekly', 'rv_res_64_open_weekly', 'rv_res_96_boundary_weekly', 'rv_res_96_open_weekly',
      'rv_res_extra_boundary_weekly', 'rv_res_extra_open_weekly', 'rv_res_recycling_boundary_eow', 'rv_res_recycling_open_eow',
    ]);
    expect(drafts.some((d) => d.supersedesId === 'rv_res_96_open_weekly_2024')).toBe(false);
    expect(drafts.find((d) => d.supersedesId === 'rv_res_64_open_weekly')!.priceCents).toBe(2704);
    expect(drafts.find((d) => d.supersedesId === 'rv_res_extra_open_weekly')!.priceCents).toBe(936);
    const ro = useStore.getState().createBulkIncreaseDrafts({ lob: 'rolloff', pct: 2.5, effectiveFrom: '2026-10-01' });
    expect(ro).toHaveLength(1);
    expect(ro[0]).toMatchObject({ catalogId: 'cat_ro_20yd', priceCents: 58938, supersedesId: 'rv_ro_20yd' }); // 57500 * 1.025 = 58937.5
    expect(ro[0]).not.toHaveProperty('zoneId');
  });

  it('publishRateVersions publishes only pending drafts and discardDraft removes only drafts', () => {
    const s = useStore.getState();
    const d = s.createDraftRateVersion({ catalogId: 'cat_fl_2yd', frequency: 'weekly', priceCents: 16500, effectiveFrom: '2026-10-01', supersedesId: 'rv_fl_2yd_weekly' });
    const old = useStore.getState().rateVersions.find((rv) => rv.id === 'rv_fl_2yd_weekly')!;
    const published = useStore.getState().publishRateVersions({ draftIds: [d.id, 'rv_fl_2yd_weekly'], publishedAt: '2026-09-10T16:00:00' });
    expect(published).toHaveLength(1);
    expect(published[0]).toEqual({ ...d, status: 'published', publishedAt: '2026-09-10T16:00:00' });
    expect(useStore.getState().rateVersions.find((rv) => rv.id === 'rv_fl_2yd_weekly')).toBe(old);
    expect(useStore.getState().rateVersions.find((rv) => rv.id === d.id)!.status).toBe('published');

    useStore.getState().discardDraft({ id: d.id });
    expect(useStore.getState().rateVersions.find((rv) => rv.id === d.id)).toBeDefined(); // published rows are never removed
    const d2 = useStore.getState().createDraftRateVersion({ catalogId: 'cat_fl_2yd', frequency: 'weekly', priceCents: 17000, effectiveFrom: '2026-11-01' });
    useStore.getState().discardDraft({ id: d2.id });
    expect(useStore.getState().rateVersions.find((rv) => rv.id === d2.id)).toBeUndefined();
  });

  it('saveContractOverride creates a one year contract for an account without one', () => {
    const c = useStore.getState().saveContractOverride({ accountId: 'acct_fl_005', catalogId: 'cat_fl_2yd', frequency: 'weekly', priceCents: 15000, reason: 'volume', pctBelowRateCard: 6.3 });
    expect(c).toEqual({
      id: 'contract_acct_fl_005_20260910',
      accountId: 'acct_fl_005',
      termStart: '2026-09-10',
      termEnd: '2027-09-10',
      renewalNoticeDays: 60,
      overrides: [{ catalogId: 'cat_fl_2yd', frequency: 'weekly', priceCents: 15000, reason: 'volume', pctBelowRateCard: 6.3 }],
    });
    // Decision 81: pricing never writes BillingAccount; resolvePrice finds the contract by Contract.accountId.
    expect(useStore.getState().accounts.find((a) => a.id === 'acct_fl_005')!.contractId).toBeUndefined();
    expect(useStore.getState().contracts).toHaveLength(6);

    // Same day, same item: replaced within the contract created today.
    const c2 = useStore.getState().saveContractOverride({ accountId: 'acct_fl_005', catalogId: 'cat_fl_2yd', frequency: 'weekly', priceCents: 14500, reason: 'volume, revised', pctBelowRateCard: 9.4 });
    expect(c2.id).toBe(c.id);
    expect(c2.overrides).toHaveLength(1);
    expect(c2.overrides[0].priceCents).toBe(14500);
    expect(useStore.getState().contracts).toHaveLength(6);
  });

  it('saveContractOverride appends to an older contract and the newest override wins', () => {
    const c = useStore.getState().saveContractOverride({ accountId: 'acct_bakery', catalogId: 'cat_fl_3yd', frequency: '2x', priceCents: 19000, reason: 'renewal match', pctBelowRateCard: 13.6 });
    expect(c.id).toBe('contract_bakery');
    expect(c.overrides).toHaveLength(3);
    expect(c.overrides[0].priceCents).toBe(19800); // history kept
    expect(c.overrides[2]).toEqual({ catalogId: 'cat_fl_3yd', frequency: '2x', priceCents: 19000, reason: 'renewal match', pctBelowRateCard: 13.6 });
    expect(c.termStart).toBe('2026-01-01');
    expect(useStore.getState().contracts).toHaveLength(5);
    const p = previewInvoice({ accountId: 'acct_bakery', onDate: '2026-10-01' });
    expect(p.lines.find((l) => l.catalogId === 'cat_fl_3yd')!.baseCents).toBe(19000);
  });

  it('saveQuote appends a quote with createdVia agent', () => {
    const q = useStore.getState().saveQuote({
      id: 'quote_test_1',
      kind: 'commercialRequest',
      address: '88 Commerce Way',
      zoneId: 'zone_open',
      lines: [{ catalogId: 'cat_fl_3yd', qty: 1, frequency: '2x', priceCents: 19800 }],
      dueTodayCents: 0,
      recurringCents: 19800,
      status: 'draft',
      expiresAt: '2026-10-10T23:59:59',
      createdVia: 'storefront',
    });
    expect(q.createdVia).toBe('agent');
    expect(useStore.getState().quotes.at(-1)).toEqual(q);
    expect(useStore.getState().quotes).toHaveLength(3);
  });

  it('reset restores the seed', () => {
    useStore.getState().createBulkIncreaseDrafts({ lob: 'residential', pct: 4, effectiveFrom: '2026-10-01' });
    useStore.getState().reset();
    expect(useStore.getState().rateVersions).toHaveLength(15);
  });
});
