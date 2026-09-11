// The prototype's engine.test.ts, retargeted: the storefront's engine.ts is deleted (addendum C1), so these prove the
// canonical resolvePrice and computeCharge give the storefront's rules on billing's seed, through the storefront's
// provisional account and site.
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../../store/db';
import { computeCharge, resolvePrice } from '../../../store/engine';
import { useStore } from '../../../store/useStore';
import type { RateVersion } from '../../../types';
import { OFFER_ACCOUNT_ID, OFFER_SITE_ID, withProvisionalSite } from '../lib/offer';

const QUARTER = { start: '2026-09-15', end: '2026-12-14' };
const TODAY = '2026-09-10';
const db = (): Db => useStore.getState().db;

beforeEach(() => useStore.getState().reset());

describe('resolvePrice precedence (canonical engine, addendum C3)', () => {
  it('contract override for the account and catalog wins', () => {
    const r = resolvePrice({ catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', accountId: 'acct_bakery', onDate: TODAY }, db());
    expect(r).toEqual({ priceCents: 19800, contractId: 'contract_bakery', ruleWon: 'contractOverride' });
  });

  it('a published RateVersion matching zone and frequency is next', () => {
    const r = resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: OFFER_ACCOUNT_ID, onDate: TODAY }, db());
    expect(r).toMatchObject({ priceCents: 2900, ruleWon: 'zoneRate' });
    expect(db().rateVersions.find((rv) => rv.id === r.rateVersionId)).toMatchObject({ catalogId: 'cat_res_96', zoneId: 'zone_open' });
  });

  it('zone_boundary resolves from its own seeded row, not a fallback (addendum C4)', () => {
    const r = resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_boundary', accountId: OFFER_ACCOUNT_ID, onDate: TODAY }, db());
    expect(r.ruleWon).toBe('zoneRate');
    expect(db().rateVersions.find((rv) => rv.id === r.rateVersionId)?.zoneId).toBe('zone_boundary');
    const residential = new Set(db().catalog.filter((c) => c.lob === 'residential').map((c) => c.id));
    expect(db().rateVersions.filter((v) => residential.has(v.catalogId) && !v.zoneId)).toEqual([]);
  });

  it('falls back to a zone-less version for a zone with no seeded row, then throws', () => {
    // The seed has no zone-less residential rows, so the fallback is proven with a fixture row here.
    const std: RateVersion = { id: 'rv_test_std_96', catalogId: 'cat_res_96', frequency: 'weekly', priceCents: 2950, effectiveFrom: '2025-01-01', status: 'published', publishedAt: '2024-12-10T09:00:00-04:00' };
    const args = { catalogId: 'cat_res_96', frequency: 'weekly' as const, zoneId: 'zone_franchise', accountId: OFFER_ACCOUNT_ID, onDate: TODAY };
    expect(() => resolvePrice(args, db())).toThrow(/No published rate/);
    const withStd = { ...db(), rateVersions: [...db().rateVersions, std] };
    expect(resolvePrice(args, withStd)).toEqual({ priceCents: 2950, rateVersionId: 'rv_test_std_96', ruleWon: 'standardRate' });
    // A named zone with its own row still wins over the fixture.
    expect(resolvePrice({ ...args, zoneId: 'zone_open' }, withStd).ruleWon).toBe('zoneRate');
    expect(() =>
      resolvePrice({ catalogId: 'cat_ro_20yd', frequency: 'weekly', zoneId: 'zone_boundary', accountId: OFFER_ACCOUNT_ID, onDate: TODAY }, db()),
    ).toThrow(/No published rate/);
  });

  it('picks the version whose effectiveFrom is latest but not after onDate, ignoring drafts', () => {
    const future: RateVersion = { id: 'rv_test_future', catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 3100, effectiveFrom: '2026-10-01', status: 'published', publishedAt: '2026-09-01T00:00:00-04:00' };
    const draft: RateVersion = { id: 'rv_test_draft', catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 9999, effectiveFrom: '2026-01-01', status: 'draft' };
    const next = { ...db(), rateVersions: [...db().rateVersions, future, draft] };
    const args = { catalogId: 'cat_res_96', frequency: 'weekly' as const, zoneId: 'zone_open', accountId: OFFER_ACCOUNT_ID };
    expect(resolvePrice({ ...args, onDate: '2026-09-15' }, next).priceCents).toBe(2900);
    expect(resolvePrice({ ...args, onDate: '2026-10-01' }, next)).toMatchObject({ priceCents: 3100, rateVersionId: 'rv_test_future' });
    expect(resolvePrice({ ...args, onDate: '2027-03-01' }, next).priceCents).toBe(3100);
  });

  it('ignores a contract before its term starts, and auto-renews one that lapsed (addendum I1, Phase 3.7f)', () => {
    const notYet = { ...db(), contracts: db().contracts.map((c) => (c.id === 'contract_bakery' ? { ...c, termStart: '2026-10-01' } : c)) };
    const early = resolvePrice({ catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', accountId: 'acct_bakery', onDate: TODAY }, notYet);
    expect(early.ruleWon).not.toBe('contractOverride');
    expect(early.contractId).toBeUndefined();
    const lapsed = { ...db(), contracts: db().contracts.map((c) => (c.id === 'contract_bakery' ? { ...c, termEnd: '2026-06-30' } : c)) };
    const r = resolvePrice({ catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', accountId: 'acct_bakery', onDate: TODAY }, lapsed);
    expect(r).toMatchObject({ ruleWon: 'contractOverride', contractId: 'contract_bakery', priceCents: 19800, renewedOn: '2026-07-01' });
  });
});

describe('computeCharge fee stack through the provisional site', () => {
  const priced = () => withProvisionalSite(db(), 'zone_open', 'route_tue_res');

  it('a mid-month 96 gal quarter is base $87.00, fuel $6.09, environmental $3.00 (3 months by month arithmetic, Phase 3.2a), tax $6.52, total $102.61', () => {
    const c = computeCharge(
      { id: 'chg_test', accountId: OFFER_ACCOUNT_ID, siteId: OFFER_SITE_ID, lineType: 'recurring', catalogId: 'cat_res_96', baseCents: 8700, period: QUARTER, source: { type: 'serviceItem', id: 'si_test' }, pricing: { ruleWon: 'zoneRate' } },
      priced(),
    );
    expect(c.baseCents).toBe(8700);
    expect(c.fees).toEqual([{ feeRuleId: 'fee_fuel_7pct', cents: 609 }, { feeRuleId: 'fee_env_1', cents: 300 }]);
    expect(c.taxCents).toBe(652);
    expect(c.totalCents).toBe(10261);
    expect(c).toMatchObject({ status: 'proposed', evidenceIds: [], lineType: 'recurring', period: QUARTER, source: { type: 'serviceItem', id: 'si_test' }, pricing: { ruleWon: 'zoneRate' } });
  });

  it('a calendar quarter (Oct 1 to Dec 31) takes the environmental fee three times, $102.61 (addendum C5)', () => {
    const c = computeCharge(
      { id: 'chg_test', accountId: OFFER_ACCOUNT_ID, siteId: OFFER_SITE_ID, lineType: 'recurring', catalogId: 'cat_res_96', baseCents: 8700, period: { start: '2026-10-01', end: '2026-12-31' }, source: { type: 'serviceItem', id: 'si_test' }, pricing: { ruleWon: 'zoneRate' } },
      priced(),
    );
    expect(c.fees).toEqual([{ feeRuleId: 'fee_fuel_7pct', cents: 609 }, { feeRuleId: 'fee_env_1', cents: 300 }]);
    expect(c.totalCents).toBe(10261);
  });

  it('the delivery fee charge is $25.00 plus $1.75 tax with no fee rules', () => {
    const c = computeCharge(
      { id: 'chg_test', accountId: OFFER_ACCOUNT_ID, siteId: OFFER_SITE_ID, lineType: 'fee', baseCents: 2500, servicedOn: '2026-09-14', source: { type: 'serviceItem', id: 'si_test' }, pricing: { ruleWon: 'zoneRate' } },
      priced(),
    );
    expect(c.fees).toEqual([]);
    expect(c.taxCents).toBe(175);
    expect(c.totalCents).toBe(2675);
  });

  it('flat recurring fees take one month without a period', () => {
    const c = computeCharge({ id: 'chg_test', accountId: OFFER_ACCOUNT_ID, siteId: OFFER_SITE_ID, lineType: 'recurring', baseCents: 2900, servicedOn: TODAY, source: { type: 'manual', id: 'x' } }, priced());
    expect(c.fees).toEqual([{ feeRuleId: 'fee_fuel_7pct', cents: 203 }, { feeRuleId: 'fee_env_1', cents: 100 }]);
    expect(c.pricing).toEqual({ ruleWon: 'manualException' });
  });

  it('skips tax for a taxExempt account and never taxes a late fee', () => {
    const exemptDb = { ...priced(), accounts: priced().accounts.map((a) => (a.id === OFFER_ACCOUNT_ID ? { ...a, taxExempt: true } : a)) };
    const exempt = computeCharge({ id: 'chg_test', accountId: OFFER_ACCOUNT_ID, siteId: OFFER_SITE_ID, lineType: 'recurring', baseCents: 8700, period: QUARTER, source: { type: 'manual', id: 'x' } }, exemptDb);
    expect(exempt.taxCents).toBe(0);
    expect(exempt.totalCents).toBe(8700 + 609 + 300);
    const late = computeCharge({ id: 'chg_test', accountId: OFFER_ACCOUNT_ID, siteId: OFFER_SITE_ID, lineType: 'lateFee', baseCents: 1000, servicedOn: TODAY, source: { type: 'manual', id: 'x' } }, priced());
    expect(late.fees).toEqual([]);
    expect(late.taxCents).toBe(0);
    expect(late.totalCents).toBe(1000);
  });

  it('rounds half up at each step (addendum C6)', () => {
    const c = computeCharge({ id: 'chg_test', accountId: OFFER_ACCOUNT_ID, siteId: OFFER_SITE_ID, lineType: 'event', baseCents: 1005, servicedOn: TODAY, source: { type: 'serviceEvent', id: 'x' } }, priced());
    expect(c.fees).toEqual([{ feeRuleId: 'fee_fuel_7pct', cents: 70 }]); // 70.35
    expect(c.taxCents).toBe(75); // 7% of 1075 = 75.25
  });

  it('pricing through a provisional site leaves the live Db untouched', () => {
    const before = db();
    priced();
    expect(db()).toBe(before);
    expect(before.sites.some((s) => s.id === OFFER_SITE_ID)).toBe(false);
  });
});
