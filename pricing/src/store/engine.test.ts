import { describe, expect, it } from 'vitest';
import { cloneSeed } from '../seed';
import type { RateVersion } from '../types';
import { computeCharge, generateRecurringCharges, resolvePrice, toEngineState, wholeMonthsIn, type EngineState } from './engine';

const fresh = (): EngineState => toEngineState(cloneSeed());

const withRates = (extra: RateVersion[]): EngineState => {
  const s = fresh();
  return { ...s, rateVersions: [...s.rateVersions, ...extra] };
};

describe('resolvePrice precedence', () => {
  it('contract override beats the zone rate for the contracted account', () => {
    const r = resolvePrice({ catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', accountId: 'acct_bakery', onDate: '2026-09-10' }, fresh());
    expect(r).toEqual({ priceCents: 19800, contractId: 'contract_bakery', ruleWon: 'contractOverride' });
  });

  it('the same item without a contract falls to the standard rate', () => {
    const r = resolvePrice({ catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', accountId: 'acct_fl_005', onDate: '2026-09-10' }, fresh());
    expect(r).toEqual({ priceCents: 22000, rateVersionId: 'rv_fl_3yd_2x', ruleWon: 'standardRate' });
  });

  it('a lapsed contract does not win; the term end is inclusive', () => {
    const args = { catalogId: 'cat_fl_3yd', frequency: '2x' as const, zoneId: 'zone_open', accountId: 'acct_fl_004' };
    expect(resolvePrice({ ...args, onDate: '2026-09-10' }, fresh())).toEqual({ priceCents: 22000, rateVersionId: 'rv_fl_3yd_2x', ruleWon: 'standardRate' });
    expect(resolvePrice({ ...args, onDate: '2026-08-31' }, fresh())).toEqual({ priceCents: 20900, contractId: 'contract_fl_004', ruleWon: 'contractOverride' });
    expect(resolvePrice({ ...args, onDate: '2025-08-31' }, fresh()).ruleWon).toBe('standardRate');
  });

  it('an override for a different frequency does not apply, an override with no frequency does', () => {
    const s = fresh();
    expect(resolvePrice({ catalogId: 'cat_fl_3yd', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_bakery', onDate: '2026-09-10' }, s)).toEqual({
      priceCents: 12500,
      rateVersionId: 'rv_fl_3yd_weekly',
      ruleWon: 'standardRate',
    });
    const contracts = s.contracts.map((c) =>
      c.id === 'contract_bakery' ? { ...c, overrides: [...c.overrides, { catalogId: 'cat_fl_3yd', priceCents: 11000 }] } : c,
    );
    expect(resolvePrice({ catalogId: 'cat_fl_3yd', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_bakery', onDate: '2026-09-10' }, { ...s, contracts })).toEqual({
      priceCents: 11000,
      contractId: 'contract_bakery',
      ruleWon: 'contractOverride',
    });
  });

  it('zone rate beats standard rate; standard is used when the zone has no rate', () => {
    const s = withRates([
      { id: 'rv_res_96_std_weekly', catalogId: 'cat_res_96', frequency: 'weekly', priceCents: 2500, effectiveFrom: '2025-01-01', status: 'published', publishedAt: '2024-12-10T09:00:00' },
    ]);
    expect(resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_001', onDate: '2026-09-10' }, s)).toEqual({
      priceCents: 2900,
      rateVersionId: 'rv_res_96_open_weekly',
      ruleWon: 'zoneRate',
    });
    expect(resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_franchise', onDate: '2026-09-10' }, s)).toEqual({
      priceCents: 2500,
      rateVersionId: 'rv_res_96_std_weekly',
      ruleWon: 'standardRate',
    });
  });

  it('uses the version whose effectiveFrom is latest but not after onDate', () => {
    const args = { catalogId: 'cat_res_96', frequency: 'weekly' as const, zoneId: 'zone_open' };
    expect(resolvePrice({ ...args, onDate: '2024-06-01' }, fresh())).toMatchObject({ priceCents: 2700, rateVersionId: 'rv_res_96_open_weekly_2024' });
    expect(resolvePrice({ ...args, onDate: '2024-12-31' }, fresh())).toMatchObject({ priceCents: 2700, rateVersionId: 'rv_res_96_open_weekly_2024' });
    expect(resolvePrice({ ...args, onDate: '2025-01-01' }, fresh())).toMatchObject({ priceCents: 2900, rateVersionId: 'rv_res_96_open_weekly' });
    const s = withRates([
      { id: 'rv_res_96_open_weekly_future', catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 9900, effectiveFrom: '2027-01-01', status: 'published', publishedAt: '2026-09-01T09:00:00' },
    ]);
    expect(resolvePrice({ ...args, onDate: '2026-09-10' }, s).priceCents).toBe(2900);
    expect(resolvePrice({ ...args, onDate: '2027-01-01' }, s).priceCents).toBe(9900);
  });

  it('ignores drafts even when their effectiveFrom is newer', () => {
    const s = withRates([
      { id: 'rv_res_96_open_weekly_draft', catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 3100, effectiveFrom: '2026-01-01', status: 'draft', supersedesId: 'rv_res_96_open_weekly' },
    ]);
    expect(resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', onDate: '2026-09-10' }, s)).toMatchObject({
      priceCents: 2900,
      rateVersionId: 'rv_res_96_open_weekly',
    });
  });

  it('throws when nothing is published for the item', () => {
    expect(() => resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_franchise', onDate: '2026-09-10' }, fresh())).toThrow('No published rate for cat_res_96');
    expect(() => resolvePrice({ catalogId: 'cat_res_96', frequency: '3x', zoneId: 'zone_open', onDate: '2026-09-10' }, fresh())).toThrow('No published rate for cat_res_96');
    expect(() => resolvePrice({ catalogId: 'cat_fl_2yd', frequency: 'weekly', onDate: '2024-06-01' }, fresh())).toThrow('No published rate for cat_fl_2yd');
  });
});

describe('computeCharge fee base and tax', () => {
  const recurring = { accountId: 'acct_res_001', siteId: 'site_res_001', lineType: 'recurring' as const, source: { type: 'manual' as const, id: 'test' } };

  it('7 percent fuel on base, environmental flat and untaxed, tax on base plus taxable fees', () => {
    const c = computeCharge({ ...recurring, baseCents: 2900, servicedOn: '2026-09-10', catalogId: 'cat_res_96' }, fresh());
    expect(c.baseCents).toBe(2900);
    expect(c.fees).toEqual([
      { feeRuleId: 'fee_fuel_7pct', cents: 203 },
      { feeRuleId: 'fee_env_1', cents: 100 },
    ]);
    expect(c.taxCents).toBe(217); // 7 percent of 2900 + 203, the $1 environmental fee is not taxed
    expect(c.totalCents).toBe(3420);
    expect(c.pricing).toEqual({ ruleWon: 'manualException' });
    expect(c.status).toBe('proposed');
    expect(c.id).toBe('ch_test_20260910');
  });

  it('rounds each step to whole cents', () => {
    const c = computeCharge({ ...recurring, baseCents: 1234, servicedOn: '2026-09-10' }, fresh());
    expect(c.fees[0].cents).toBe(86); // 86.38
    expect(c.taxCents).toBe(92); // (1234 + 86) * 0.07 = 92.4
    expect(c.totalCents).toBe(1234 + 86 + 100 + 92);
  });

  it('event lines get fuel but not the environmental fee, and tax on base plus fuel', () => {
    const c = computeCharge({ ...recurring, lineType: 'event', baseCents: 1500, servicedOn: '2026-09-07' }, fresh());
    expect(c.fees).toEqual([{ feeRuleId: 'fee_fuel_7pct', cents: 105 }]);
    expect(c.taxCents).toBe(112); // 1605 * 0.07 = 112.35
    expect(c.totalCents).toBe(1717);
  });

  it('taxExempt account skips tax but keeps fees', () => {
    const s = fresh();
    const state = { ...s, accounts: s.accounts.map((a) => (a.id === 'acct_res_001' ? { ...a, taxExempt: true } : a)) };
    const c = computeCharge({ ...recurring, baseCents: 2900, servicedOn: '2026-09-10' }, state);
    expect(c.fees.map((f) => f.cents)).toEqual([203, 100]);
    expect(c.taxCents).toBe(0);
    expect(c.totalCents).toBe(3203);
  });

  it('late fees carry no fees and are never taxed', () => {
    const c = computeCharge({ ...recurring, lineType: 'lateFee', baseCents: 1000, servicedOn: '2026-09-10' }, fresh());
    expect(c.fees).toEqual([]);
    expect(c.taxCents).toBe(0);
    expect(c.totalCents).toBe(1000);
  });

  it('a zone without a tax rule produces no tax', () => {
    const c = computeCharge({ accountId: 'acct_res_001', siteId: 'site_missing', lineType: 'recurring', baseCents: 2900, servicedOn: '2026-09-10', source: { type: 'manual', id: 'x' } }, fresh());
    expect(c.taxCents).toBe(0);
  });

  it('uses the pricing argument when given', () => {
    const c = computeCharge({ ...recurring, baseCents: 2900, servicedOn: '2026-09-10', pricing: { rateVersionId: 'rv_res_96_open_weekly', ruleWon: 'zoneRate' } }, fresh());
    expect(c.pricing).toEqual({ rateVersionId: 'rv_res_96_open_weekly', ruleWon: 'zoneRate' });
  });
});

describe('flat fees on multi-month charges (addendum C5 through C1)', () => {
  it("acct_res_maple's quarterly cat_res_96 charge on 2026-10-01 carries fee_env_1 once per month", () => {
    const maple96 = generateRecurringCharges({ cycleDate: '2026-10-01' }, fresh()).find(
      (c) => c.accountId === 'acct_res_maple' && c.catalogId === 'cat_res_96',
    )!;
    expect(maple96.period).toEqual({ start: '2026-10-01', end: '2026-12-31' });
    expect(maple96.baseCents).toBe(8700);
    expect(maple96.fees).toEqual([
      { feeRuleId: 'fee_fuel_7pct', cents: 609 },
      { feeRuleId: 'fee_env_1', cents: 300 },
    ]);
    expect(maple96.taxCents).toBe(652); // 7 percent of 8700 + 609; the environmental fee is not taxed
    expect(maple96.totalCents).toBe(10261);
  });

  it('the monthly worked example is unchanged at 3420', () => {
    const c = computeCharge(
      { accountId: 'acct_res_001', siteId: 'site_res_001', lineType: 'recurring', baseCents: 2900, period: { start: '2026-10-01', end: '2026-10-31' }, source: { type: 'manual', id: 'we' } },
      fresh(),
    );
    expect(c.fees).toEqual([
      { feeRuleId: 'fee_fuel_7pct', cents: 203 },
      { feeRuleId: 'fee_env_1', cents: 100 },
    ]);
    expect(c.totalCents).toBe(3420);
  });

  it('counts whole months in a period', () => {
    expect(wholeMonthsIn({ start: '2026-10-01', end: '2026-12-31' })).toBe(3);
    expect(wholeMonthsIn({ start: '2026-10-01', end: '2026-10-31' })).toBe(1);
    expect(wholeMonthsIn({ start: '2026-02-01', end: '2026-02-28' })).toBe(1);
    expect(wholeMonthsIn({ start: '2026-09-10', end: '2026-09-20' })).toBe(1);
  });
});

describe('generateRecurringCharges', () => {
  it('skips suspended accounts and held items, bills quarterly accounts for three months', () => {
    const charges = generateRecurringCharges({ cycleDate: '2026-10-01' }, fresh());
    expect(charges.some((c) => c.accountId === 'acct_res_kerr')).toBe(false);
    expect(charges.some((c) => c.accountId === 'acct_res_holt')).toBe(false);

    const maple = charges.filter((c) => c.accountId === 'acct_res_maple');
    expect(maple.map((c) => [c.catalogId, c.baseCents, c.totalCents])).toEqual([
      ['cat_res_96', 8700, 10261],
      ['cat_res_extra_cart', 2700, 3391],
      ['cat_res_recycling', 3600, 4422],
    ]);
    expect(maple[0].period).toEqual({ start: '2026-10-01', end: '2026-12-31' });
    expect(maple[0].source).toEqual({ type: 'serviceItem', id: 'si_res_maple_96' });
    expect(maple[0].pricing).toEqual({ rateVersionId: 'rv_res_96_open_weekly', ruleWon: 'zoneRate' });

    const bakery = charges.filter((c) => c.accountId === 'acct_bakery');
    expect(bakery.map((c) => [c.baseCents, c.pricing])).toEqual([
      [19800, { contractId: 'contract_bakery', ruleWon: 'contractOverride' }],
      [17100, { contractId: 'contract_bakery', ruleWon: 'contractOverride' }],
    ]);
    expect(bakery[0].period).toEqual({ start: '2026-10-01', end: '2026-10-31' });
  });

  it('suspending an account removes its charges from the run (invariant 4)', () => {
    const s = fresh();
    const before = generateRecurringCharges({ cycleDate: '2026-10-01' }, s).filter((c) => c.accountId === 'acct_res_001');
    expect(before).toHaveLength(1);
    const suspended = { ...s, accounts: s.accounts.map((a) => (a.id === 'acct_res_001' ? { ...a, status: 'suspended' as const } : a)) };
    const after = generateRecurringCharges({ cycleDate: '2026-10-01' }, suspended).filter((c) => c.accountId === 'acct_res_001');
    expect(after).toHaveLength(0);
  });

  it('every charge carries base, fees, tax, source, and ruleWon (invariant 2)', () => {
    const charges = generateRecurringCharges({ cycleDate: '2026-10-01' }, fresh());
    expect(charges.length).toBeGreaterThan(40);
    for (const c of charges) {
      expect(typeof c.baseCents).toBe('number');
      expect(Array.isArray(c.fees)).toBe(true);
      expect(typeof c.taxCents).toBe('number');
      expect(c.source.type).toBe('serviceItem');
      expect(['contractOverride', 'zoneRate', 'standardRate', 'manualException']).toContain(c.pricing.ruleWon);
      expect(c.totalCents).toBe(c.baseCents + c.fees.reduce((a, f) => a + f.cents, 0) + c.taxCents);
    }
    expect(new Set(charges.map((c) => c.id)).size).toBe(charges.length);
  });

  it('does not bill an item before its effectiveFrom or after its effectiveTo', () => {
    const s = fresh();
    const items = s.serviceItems.map((si) => (si.id === 'si_res_001_cart' ? { ...si, effectiveTo: '2026-09-30' } : si));
    const run = generateRecurringCharges({ cycleDate: '2026-10-01' }, { ...s, serviceItems: items });
    expect(run.some((c) => c.source.id === 'si_res_001_cart')).toBe(false);
    const only = { ...s, serviceItems: s.serviceItems.filter((si) => si.id === 'si_res_001_cart') };
    expect(generateRecurringCharges({ cycleDate: '2024-01-01' }, only)).toEqual([]); // effective 2024-02-01
    expect(generateRecurringCharges({ cycleDate: '2024-02-01' }, only)).toHaveLength(1);
  });
});
