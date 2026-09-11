import { describe, expect, it } from 'vitest';
import { cloneSeed } from '../seed';
import { toEngineState } from '../store/engine';
import { TODAY } from '../store/dates';
import { catalogGroups, feeRuleSentence, taxRuleSentence, versionHistory } from './ratebook';
import { formatCents } from './money';

const state = () => toEngineState({ ...cloneSeed() });

describe('money', () => {
  it('formats integer cents', () => {
    expect(formatCents(2900)).toBe('$29.00');
    expect(formatCents(203)).toBe('$2.03');
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(-150)).toBe('-$1.50');
  });
});

describe('catalogGroups', () => {
  it('lists one line per (zone, frequency) with the version resolvePrice picks today', () => {
    const groups = catalogGroups(state(), 'residential', TODAY);
    expect(groups.map((g) => g.item.id)).toEqual(['cat_res_96', 'cat_res_64', 'cat_res_extra_cart', 'cat_res_recycling']);
    const res96 = groups[0].lines;
    expect(res96.map((l) => `${l.zoneId}/${l.frequency}`)).toEqual(['zone_open/weekly', 'zone_boundary/weekly']);
    expect(res96[0].current?.id).toBe('rv_res_96_open_weekly');
    expect(res96[0].current?.priceCents).toBe(2900);
    expect(res96[0].effectiveToday).toBe(true);
    expect(res96[0].ruleWon).toBe('zoneRate');
    expect(res96[0].versionCount).toBe(2);
    expect(res96[0].drafts).toEqual([]);
  });

  it('shows standard rate lines for frontload and drafts beside the published version', () => {
    const s = state();
    s.rateVersions = [
      ...s.rateVersions,
      { id: 'rv_fl_3yd_2x_draft', catalogId: 'cat_fl_3yd', frequency: '2x', priceCents: 22880, effectiveFrom: '2026-10-01', status: 'draft', supersedesId: 'rv_fl_3yd_2x' },
    ];
    const fl3 = catalogGroups(s, 'frontload', TODAY).find((g) => g.item.id === 'cat_fl_3yd')!;
    const twoX = fl3.lines.find((l) => l.frequency === '2x')!;
    expect(twoX.zoneId).toBeUndefined();
    expect(twoX.ruleWon).toBe('standardRate');
    expect(twoX.current?.id).toBe('rv_fl_3yd_2x');
    expect(twoX.drafts.map((d) => d.id)).toEqual(['rv_fl_3yd_2x_draft']);
  });
});

describe('versionHistory', () => {
  it('is newest first with a superseded-by back link and never mutates the input', () => {
    const s = state();
    const rows = versionHistory(s, { catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly' }, TODAY);
    expect(rows.map((r) => r.version.id)).toEqual(['rv_res_96_open_weekly', 'rv_res_96_open_weekly_2024']);
    expect(rows[0].isCurrent).toBe(true);
    expect(rows[0].version.supersedesId).toBe('rv_res_96_open_weekly_2024');
    expect(rows[1].supersededBy).toBe('rv_res_96_open_weekly');
    expect(rows[1].version.priceCents).toBe(2700);
  });
});

describe('rule sentences', () => {
  it('spell out base, appliesTo, and taxability', () => {
    const s = state();
    expect(feeRuleSentence(s.feeRules[0])).toBe('Fuel surcharge: 7% of service lines, applies to recurring and event, taxable');
    expect(feeRuleSentence(s.feeRules[1])).toBe('Environmental fee: $1.00 flat per line, applies to recurring, not taxable');
    expect(taxRuleSentence(s.taxRules[0])).toBe('zone_open: 7% on recurring, event, fee. Never on late fees');
  });
});

describe('Phase 4 selectors', () => {
  it('firstOfNextMonth rolls to the first of the following month, including across a year end', async () => {
    const { firstOfNextMonth } = await import('../store/dates');
    expect(firstOfNextMonth('2026-09-10')).toBe('2026-10-01');
    expect(firstOfNextMonth('2026-12-31')).toBe('2027-01-01');
    expect(firstOfNextMonth('2026-01-01')).toBe('2026-02-01');
  });

  it('dollarsToCents stores integer cents and rejects anything that is not a dollar amount', async () => {
    const { dollarsToCents } = await import('../components/NewDraftForm');
    expect(dollarsToCents('29.99')).toBe(2999);
    expect(dollarsToCents('$1,234.5')).toBe(123450);
    expect(dollarsToCents('30')).toBe(3000);
    expect(dollarsToCents('abc')).toBeNull();
    expect(dollarsToCents('1.234')).toBeNull();
    expect(dollarsToCents('')).toBeNull();
  });

  it('lobDrafts lists only the lob\'s pending drafts with the version each supersedes, and a published future version shows as scheduled', async () => {
    const { lobDrafts } = await import('./ratebook');
    const { useStore } = await import('../store/store');
    useStore.getState().reset();
    const created = useStore.getState().createBulkIncreaseDrafts({ lob: 'residential', pct: 4, effectiveFrom: '2026-10-01' });
    const engine = toEngineState(useStore.getState());
    const res = lobDrafts(engine, 'residential');
    expect(res).toHaveLength(8);
    expect(res.map((d) => d.draft.id).sort()).toEqual(created.map((d) => d.id).sort());
    expect(res[0].item.id).toBe('cat_res_96');
    expect(res[0].draft.zoneId).toBe('zone_open');
    expect(res[0].supersedes?.id).toBe('rv_res_96_open_weekly');
    expect(res.every((d) => d.supersedes !== undefined && d.draft.supersedesId === d.supersedes.id)).toBe(true);
    expect(lobDrafts(engine, 'frontload')).toEqual([]);
    expect(lobDrafts(engine, 'rolloff')).toEqual([]);

    // Before publish the line shows the draft; after publish the future dated version is "scheduled", the
    // current price is still what resolvePrice returns today, and the superseded version is untouched.
    const before = catalogGroups(engine, 'residential', TODAY)[0].lines[0];
    expect(before.drafts).toHaveLength(1);
    expect(before.scheduled).toEqual([]);
    const old = useStore.getState().rateVersions.find((rv) => rv.id === 'rv_res_96_open_weekly')!;
    useStore.getState().publishRateVersions({ draftIds: created.map((d) => d.id), publishedAt: '2026-09-10T12:00:00Z' });
    const after = catalogGroups(toEngineState(useStore.getState()), 'residential', TODAY)[0].lines[0];
    expect(after.drafts).toEqual([]);
    expect(after.current?.id).toBe('rv_res_96_open_weekly');
    expect(after.current?.priceCents).toBe(2900);
    expect(after.scheduled.map((rv) => [rv.priceCents, rv.effectiveFrom, rv.status, rv.supersedesId])).toEqual([[3016, '2026-10-01', 'published', 'rv_res_96_open_weekly']]);
    expect(useStore.getState().rateVersions.find((rv) => rv.id === 'rv_res_96_open_weekly')).toBe(old);
    expect(lobDrafts(toEngineState(useStore.getState()), 'residential')).toEqual([]);
    useStore.getState().reset();
  });
});
