import { beforeEach, describe, expect, it } from 'vitest';
import type { Contract, RateVersion } from '../../types';
import { TODAY } from '../clock';
import { allocate, computeCharge, generateEventCharges, generateRecurringCharges, postInvoices, resolvePrice } from '../engine';
import { OFFER_ACCOUNT_ID, OFFER_SITE_ID, withProvisionalSite } from '../offer';
import { buildSeedTables, useStore } from '../store';

const QUARTER = { start: '2026-09-15', end: '2026-12-15' };

beforeEach(() => useStore.getState().reset());

describe('resolvePrice precedence', () => {
  it('contract override for the account and catalog wins', () => {
    const r = resolvePrice({ catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', accountId: 'acct_bakery', onDate: TODAY });
    expect(r).toEqual({ priceCents: 19800, contractId: 'contract_bakery', ruleWon: 'contractOverride' });
  });

  it('published RateVersion matching zone and frequency is next', () => {
    const r = resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_holt', onDate: TODAY });
    expect(r).toEqual({ priceCents: 2900, rateVersionId: 'rv_res_96_open_weekly', ruleWon: 'zoneRate' });
  });

  it('zone_boundary resolves from its own seeded row, not a fallback (addendum C4)', () => {
    const r = resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_boundary', accountId: OFFER_ACCOUNT_ID, onDate: TODAY });
    expect(r).toEqual({ priceCents: 3100, rateVersionId: 'rv_res_96_boundary_weekly', ruleWon: 'zoneRate' });
    const residential = new Set(Object.values(buildSeedTables().catalog).filter((c) => c.lob === 'residential').map((c) => c.id));
    expect(Object.values(buildSeedTables().rateVersions).filter((v) => residential.has(v.catalogId) && !v.zoneId)).toEqual([]);
  });

  it('falls back to a zone-less version for a zone with no seeded row, then throws', () => {
    // The seed has no zone-less residential rows, so the fallback is proven with a fixture row here.
    const state = buildSeedTables();
    const std: RateVersion = { id: 'rv_test_std_96', catalogId: 'cat_res_96', frequency: 'weekly', priceCents: 2950, effectiveFrom: '2025-01-01', status: 'published', publishedAt: '2024-12-10T09:00:00-04:00' };
    const args = { catalogId: 'cat_res_96', frequency: 'weekly' as const, zoneId: 'zone_franchise', accountId: OFFER_ACCOUNT_ID, onDate: TODAY };
    expect(() => resolvePrice(args, state)).toThrow(/No published rate/);
    state.rateVersions = { ...state.rateVersions, [std.id]: std };
    expect(resolvePrice(args, state)).toEqual({ priceCents: 2950, rateVersionId: 'rv_test_std_96', ruleWon: 'standardRate' });
    // A named zone with its own row still wins over the fixture.
    expect(resolvePrice({ ...args, zoneId: 'zone_open' }, state).rateVersionId).toBe('rv_res_96_open_weekly');
    expect(() =>
      resolvePrice({ catalogId: 'cat_ro_20yd', frequency: 'weekly', zoneId: 'zone_boundary', accountId: OFFER_ACCOUNT_ID, onDate: TODAY }),
    ).toThrow(/No published rate/);
  });

  it('picks the version whose effectiveFrom is latest but not after onDate, ignoring drafts', () => {
    const state = buildSeedTables();
    const future: RateVersion = { id: 'rv_test_future', catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 3100, effectiveFrom: '2026-10-01', status: 'published', publishedAt: '2026-09-01T00:00:00-04:00' };
    const draft: RateVersion = { id: 'rv_test_draft', catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 9999, effectiveFrom: '2026-01-01', status: 'draft' };
    state.rateVersions = { ...state.rateVersions, [future.id]: future, [draft.id]: draft };
    const args = { catalogId: 'cat_res_96', frequency: 'weekly' as const, zoneId: 'zone_open', accountId: OFFER_ACCOUNT_ID };
    expect(resolvePrice({ ...args, onDate: '2026-09-15' }, state).rateVersionId).toBe('rv_res_96_open_weekly');
    // The seeded 2024 row that rv_res_96_open_weekly supersedes still answers for dates before 2025.
    expect(resolvePrice({ ...args, onDate: '2024-06-01' }, state)).toMatchObject({ priceCents: 2700, rateVersionId: 'rv_res_96_open_weekly_2024' });
    expect(resolvePrice({ ...args, onDate: '2026-10-01' }, state)).toMatchObject({ priceCents: 3100, rateVersionId: 'rv_test_future' });
    expect(resolvePrice({ ...args, onDate: '2027-03-01' }, state).priceCents).toBe(3100);
  });

  it('ignores a contract that is out of term on onDate', () => {
    const state = buildSeedTables();
    const expired: Contract = { ...state.contracts.contract_bakery, termEnd: '2026-06-30' };
    state.contracts = { ...state.contracts, contract_bakery: expired };
    const r = resolvePrice({ catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', accountId: 'acct_bakery', onDate: TODAY }, state);
    expect(r).toMatchObject({ priceCents: 22000, ruleWon: 'zoneRate' });
  });
});

describe('computeCharge fee stack', () => {
  const state = () => withProvisionalSite(buildSeedTables(), 'zone_open', 'route_tue_res');

  it('a 96 gal quarter is base $87.00, fuel $6.09, environmental $3.00, tax $6.52, total $102.61', () => {
    const c = computeCharge(
      { accountId: OFFER_ACCOUNT_ID, siteId: OFFER_SITE_ID, lineType: 'recurring', catalogId: 'cat_res_96', baseCents: 8700, period: QUARTER, source: { type: 'serviceItem', id: 'si_test' }, pricing: { rateVersionId: 'rv_res_96_open_weekly', ruleWon: 'zoneRate' } },
      state(),
    );
    expect(c.baseCents).toBe(8700);
    expect(c.fees).toEqual([{ feeRuleId: 'fee_fuel_7pct', cents: 609 }, { feeRuleId: 'fee_env_1', cents: 300 }]);
    expect(c.taxCents).toBe(652);
    expect(c.totalCents).toBe(10261);
    expect(c).toMatchObject({ status: 'proposed', evidenceIds: [], lineType: 'recurring', period: QUARTER, source: { type: 'serviceItem', id: 'si_test' }, pricing: { ruleWon: 'zoneRate' } });
  });

  it('the delivery fee charge is $25.00 plus $1.75 tax with no fee rules', () => {
    const c = computeCharge(
      { accountId: OFFER_ACCOUNT_ID, siteId: OFFER_SITE_ID, lineType: 'fee', baseCents: 2500, servicedOn: '2026-09-14', source: { type: 'serviceItem', id: 'si_test' }, pricing: { ruleWon: 'zoneRate' } },
      state(),
    );
    expect(c.fees).toEqual([]);
    expect(c.taxCents).toBe(175);
    expect(c.totalCents).toBe(2675);
  });

  it('flat recurring fees default to one month without a period', () => {
    const c = computeCharge({ accountId: OFFER_ACCOUNT_ID, siteId: OFFER_SITE_ID, lineType: 'recurring', baseCents: 2900, servicedOn: TODAY, source: { type: 'manual', id: 'x' } }, state());
    expect(c.fees).toEqual([{ feeRuleId: 'fee_fuel_7pct', cents: 203 }, { feeRuleId: 'fee_env_1', cents: 100 }]);
    expect(c.pricing).toEqual({ ruleWon: 'manualException' });
  });

  it('skips tax for a taxExempt account and never taxes a late fee', () => {
    const s = state();
    s.accounts = { ...s.accounts, [OFFER_ACCOUNT_ID]: { ...s.accounts[OFFER_ACCOUNT_ID], taxExempt: true } };
    const exempt = computeCharge({ accountId: OFFER_ACCOUNT_ID, siteId: OFFER_SITE_ID, lineType: 'recurring', baseCents: 8700, period: QUARTER, source: { type: 'manual', id: 'x' } }, s);
    expect(exempt.taxCents).toBe(0);
    expect(exempt.totalCents).toBe(8700 + 609 + 300);
    const late = computeCharge({ accountId: OFFER_ACCOUNT_ID, siteId: OFFER_SITE_ID, lineType: 'lateFee', baseCents: 1000, servicedOn: TODAY, source: { type: 'manual', id: 'x' } }, state());
    expect(late.fees).toEqual([]);
    expect(late.taxCents).toBe(0);
    expect(late.totalCents).toBe(1000);
  });

  it('rounds half up at each step', () => {
    const c = computeCharge({ accountId: OFFER_ACCOUNT_ID, siteId: OFFER_SITE_ID, lineType: 'event', baseCents: 1005, servicedOn: TODAY, source: { type: 'serviceEvent', id: 'x' } }, state());
    expect(c.fees).toEqual([{ feeRuleId: 'fee_fuel_7pct', cents: 70 }]); // 70.35
    expect(c.taxCents).toBe(75); // 7% of 1075 = 75.25
  });
});

describe('billing-side engine functions', () => {
  it('throw not implemented in storefront', () => {
    expect(() => generateRecurringCharges({ cycleDate: TODAY })).toThrow('not implemented in storefront');
    expect(() => generateEventCharges()).toThrow('not implemented in storefront');
    expect(() => postInvoices({ chargeIds: [] })).toThrow('not implemented in storefront');
    expect(() => allocate({ sourceType: 'payment', sourceId: 'x', invoiceIds: [], cents: [] })).toThrow('not implemented in storefront');
  });
});
