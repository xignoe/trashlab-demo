// Phase 4 scenario (checklist 4.10) run through the same store actions and selectors the Ratebook uses:
// bulk 4 percent residential increase, blast radius, publish with a fixed Eastern publishedAt, then the
// history chain and the posted invoice.
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { toEngineState } from './engine';
import { blastRadius } from './preview';
import { TODAY } from './dates';
import { lobDrafts, versionHistory } from '../lib/ratebook';
import { publishedAtFor } from '../pages/Ratebook';
import { NOTE_STYLE, noteKind } from '../components/PublishPreviewModal';
import type { Contract } from '../types';

beforeEach(() => useStore.getState().reset());

describe('Phase 4 publish flow', () => {
  it('publishedAt is TODAY at a fixed Eastern time, one minute later per publish', () => {
    expect(publishedAtFor(0)).toBe('2026-09-10T09:00:00-04:00');
    expect(publishedAtFor(1)).toBe('2026-09-10T09:01:00-04:00');
  });

  it('bulk 4 percent residential: preview, publish, history keeps the old version, invoice unchanged', () => {
    const store = useStore.getState();
    const invoiceBefore = structuredClone(store.invoices.find((i) => i.id === 'inv_res_maple_0001')!);
    const oldRv = store.rateVersions.find((rv) => rv.id === 'rv_res_96_open_weekly')!;
    const oldSnapshot = structuredClone(oldRv);

    store.createBulkIncreaseDrafts({ lob: 'residential', pct: 4, effectiveFrom: '2026-10-01' });
    const pending = lobDrafts(toEngineState(useStore.getState()), 'residential');
    expect(pending.length).toBeGreaterThan(0);

    const r = blastRadius({ draftIds: pending.map((p) => p.draft.id), onDate: TODAY });
    expect(r.evaluatedOn).toBe('2026-10-01');
    expect(r.movedAccounts).toHaveLength(31);
    expect(r.movedAccounts.map((m) => m.accountId)).toContain('acct_res_maple');
    expect(r.movedAccounts.map((m) => m.accountId)).not.toContain('acct_res_holt');
    expect(r.movedAccounts.map((m) => m.accountId)).not.toContain('acct_res_kerr');

    const byAccount = new Map(r.excludedContractAccounts.map((e) => [e.accountId, e]));
    for (const id of ['acct_bakery', 'acct_fl_001', 'acct_fl_002', 'acct_fl_003']) {
      expect(byAccount.get(id)?.protected, id).toBe(true);
      expect(byAccount.get(id)?.note, id).toBe("no service in this draft's scope, contract still protects it");
    }
    expect(byAccount.get('acct_fl_004')).toMatchObject({ protected: false, note: 'contract ended 2026-08-31, no longer protected' });

    const bakery = r.representativeAccounts.find((a) => a.accountId === 'acct_bakery')!;
    expect(bakery.unchanged).toBe(true);
    expect(bakery.after.lines.every((l) => l.pricing.ruleWon === 'contractOverride')).toBe(true);
    expect(r.totalMonthlyDeltaCents).toBe(r.movedAccounts.reduce((s, m) => s + m.afterMonthlyCents - m.beforeMonthlyCents, 0));

    const published = useStore.getState().publishRateVersions({ draftIds: r.draftIds, publishedAt: publishedAtFor(0) });
    expect(published).toHaveLength(pending.length);

    const history = versionHistory(toEngineState(useStore.getState()), { catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly' }, TODAY);
    const ids = history.map((h) => h.version.id);
    expect(ids).toEqual(['rv_res_96_open_weekly_20261001', 'rv_res_96_open_weekly', 'rv_res_96_open_weekly_2024']);
    expect(history[0].version).toMatchObject({ status: 'published', priceCents: 3016, supersedesId: 'rv_res_96_open_weekly', publishedAt: '2026-09-10T09:00:00-04:00' });
    expect(history[1].version).toBe(oldRv);
    expect(history[1].version).toEqual(oldSnapshot);
    expect(history[1].supersededBy).toBe('rv_res_96_open_weekly_20261001');

    const invoiceAfter = useStore.getState().invoices.find((i) => i.id === 'inv_res_maple_0001')!;
    expect(invoiceAfter).toEqual(invoiceBefore);
    expect(invoiceAfter.totalCents).toBe(8745);
    expect(lobDrafts(toEngineState(useStore.getState()), 'residential')).toHaveLength(0);
  });
});

describe('Protected by contract: all four note kinds', () => {
  const term = { termStart: '2026-01-01', termEnd: '2027-12-31', renewalNoticeDays: 60 };
  const override = (catalogId: string, frequency: Contract['overrides'][number]['frequency']) => ({ catalogId, frequency, priceCents: 2500, reason: 'test hold', pctBelowRateCard: 10 });

  it('blastRadius writes covers, does-not-cover, partly-covered, out-of-scope and lapsed notes, and the modal maps each to its own pill', () => {
    const store = useStore.getState();
    store.createBulkIncreaseDrafts({ lob: 'residential', pct: 4, effectiveFrom: '2026-10-01' });
    const base = toEngineState(useStore.getState());
    const extra: Contract[] = [
      // Covers acct_res_001's only item (96 gal cart, weekly): protected, does not move.
      { id: 'contract_t_001', accountId: 'acct_res_001', ...term, overrides: [override('cat_res_96', 'weekly')] },
      // Covers only frontload for a residential account: the in-scope cart is not covered and moves.
      { id: 'contract_t_002', accountId: 'acct_res_002', ...term, overrides: [override('cat_fl_3yd', '2x')] },
      // Covers Maple's 96 gal cart but not the extra cart or recycling: partly protected.
      { id: 'contract_t_maple', accountId: 'acct_res_maple', ...term, overrides: [override('cat_res_96', 'weekly')] },
    ];
    const state = { ...base, contracts: [...base.contracts, ...extra] };
    const draftIds = lobDrafts(state, 'residential').map((d) => d.draft.id);
    const r = blastRadius({ draftIds, onDate: TODAY, state });
    const note = (id: string) => r.excludedContractAccounts.find((e) => e.contractId === id)!;

    expect(note('contract_t_001')).toMatchObject({ protected: true, note: 'override covers 96 gal cart' });
    expect(note('contract_t_002').note).toMatch(/^override does not cover .+, that item moves$/);
    expect(note('contract_t_maple').note).toMatch(/^override covers 96 gal cart; .+ is not covered and moves$/);
    expect(note('contract_bakery').note).toBe("no service in this draft's scope, contract still protects it");
    expect(note('contract_fl_004')).toMatchObject({ protected: false, note: 'contract ended 2026-08-31, no longer protected' });

    const moved = new Set(r.movedAccounts.map((m) => m.accountId));
    expect(moved.has('acct_res_001')).toBe(false);
    expect(moved.has('acct_res_002')).toBe(true);
    expect(moved.has('acct_res_maple')).toBe(true);

    const kinds = ['contract_t_001', 'contract_t_002', 'contract_bakery', 'contract_fl_004'].map((id) => noteKind(note(id)));
    expect(kinds).toEqual(['covers', 'moves', 'outOfScope', 'lapsed']);
    expect(noteKind(note('contract_t_maple'))).toBe('moves');
    expect(new Set(kinds.map((k) => NOTE_STYLE[k].pill)).size).toBe(4);
  });
});
