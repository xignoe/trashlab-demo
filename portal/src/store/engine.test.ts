import { beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../seed';
import {
  allocate, bindTables, computeCharge, cycleEnd, generateEventCharges, generateRecurringCharges,
  monthsInPeriod, nextCycleStart, nextInvoicePeriod, postInvoices, resolvePrice,
} from './engine';
import { resetIds } from './ids';
import type { BillingAccount, Charge } from '../types';

const maple = () => seed.accounts.find((a) => a.id === 'acct_res_maple')!;
const oakridge = () => seed.accounts.find((a) => a.id === 'acct_pm_oakridge')!;

beforeEach(() => {
  bindTables(() => seed);
  resetIds();
});

describe('resolvePrice', () => {
  it('zone rate wins for Maple on the 2026 version', () => {
    const r = resolvePrice({
      catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_maple', onDate: '2026-09-10',
    });
    expect(r).toEqual({ priceCents: 2900, rateVersionId: 'rv_res_96_2026', ruleWon: 'zoneRate' });
  });

  it('contract override wins for the bakery with ruleWon contractOverride', () => {
    const r = resolvePrice({
      catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', accountId: 'acct_bakery', onDate: '2026-09-10',
    });
    expect(r).toEqual({ priceCents: 19800, contractId: 'contract_bakery', ruleWon: 'contractOverride' });
  });

  it('an older onDate picks the 2025 version', () => {
    const r = resolvePrice({
      catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_maple', onDate: '2025-06-15',
    });
    expect(r.rateVersionId).toBe('rv_res_96_2025');
    expect(r.priceCents).toBe(2700);
  });

  it('unknown catalog throws', () => {
    expect(() =>
      resolvePrice({ catalogId: 'cat_nope', zoneId: 'zone_open', accountId: 'acct_res_maple', onDate: '2026-09-10' }),
    ).toThrow(/No published rate/);
  });

  it('a version with no frequency matches any frequency (roll off)', () => {
    const r = resolvePrice({
      catalogId: 'cat_ro_20yd', frequency: 'onCall', zoneId: 'zone_open', accountId: 'acct_ro_homeowner', onDate: '2026-09-14',
    });
    expect(r.priceCents).toBe(57500);
    expect(r.rateVersionId).toBe('rv_ro_20yd_2026');
  });

  it('cat_res_extra_pickup is retired (addendum D5)', () => {
    expect(seed.catalog.some((c) => c.id === 'cat_res_extra_pickup')).toBe(false);
    expect(() =>
      resolvePrice({ catalogId: 'cat_res_extra_pickup', zoneId: 'zone_open', accountId: 'acct_res_maple', onDate: '2026-09-14' }),
    ).toThrow(/No published rate/);
  });

  it('falls through to a zone-less version as standardRate', () => {
    bindTables(() => ({
      ...seed,
      rateVersions: [
        ...seed.rateVersions,
        { id: 'rv_std', catalogId: 'cat_std', priceCents: 500, effectiveFrom: '2026-01-01', status: 'published' },
      ],
    }));
    const r = resolvePrice({ catalogId: 'cat_std', zoneId: 'zone_boundary', accountId: 'acct_res_maple', onDate: '2026-09-10' });
    expect(r).toEqual({ priceCents: 500, rateVersionId: 'rv_std', ruleWon: 'standardRate' });
  });
});

describe('computeCharge', () => {
  it('Maple cat_res_96 monthly recurring: base 2900, fuel 203, env 100, tax 217, total 3420', () => {
    const c = computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'recurring', baseCents: 2900,
      period: { start: '2026-10-01', end: '2026-10-31' }, source: { type: 'serviceItem', id: 'si_maple_96' },
      catalogId: 'cat_res_96', frequency: 'weekly',
    });
    expect(c.fees).toEqual([
      { feeRuleId: 'fee_fuel_7pct', cents: 203 },
      { feeRuleId: 'fee_env_1', cents: 100 },
    ]);
    expect(c.taxCents).toBe(217);
    expect(c.totalCents).toBe(3420);
    expect(c.status).toBe('proposed');
    expect(c.evidenceIds).toEqual([]);
    expect(c.pricing).toEqual({ rateVersionId: 'rv_res_96_2026', ruleWon: 'zoneRate' });
    expect(c.id).toMatch(/^chg_p/);
    expect(c.period).toEqual({ start: '2026-10-01', end: '2026-10-31' });
  });

  it('a lateFee line has no fees and no tax', () => {
    const c = computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'lateFee', baseCents: 1000,
      servicedOn: '2026-09-10', source: { type: 'manual', id: 'hauler_piedmont' },
    });
    expect(c.fees).toEqual([]);
    expect(c.taxCents).toBe(0);
    expect(c.totalCents).toBe(1000);
    expect(c.pricing.ruleWon).toBe('standardRate');
  });

  it('a taxExempt account gets taxCents 0', () => {
    bindTables(() => ({
      ...seed,
      accounts: seed.accounts.map((a) => (a.id === 'acct_res_maple' ? { ...a, taxExempt: true } : a)),
    }));
    const c = computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'recurring', baseCents: 2900,
      period: { start: '2026-10-01', end: '2026-10-31' }, source: { type: 'serviceItem', id: 'si_maple_96' },
      catalogId: 'cat_res_96', frequency: 'weekly',
    });
    expect(c.taxCents).toBe(0);
    expect(c.totalCents).toBe(2900 + 203 + 100);
  });

  it('an event line gets fuel but not env', () => {
    const c = computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'event', baseCents: 2500,
      servicedOn: '2026-09-14', source: { type: 'manual', id: 'eventRates.extraPickup' },
    });
    expect(c.catalogId).toBeUndefined();
    expect(c.fees).toEqual([{ feeRuleId: 'fee_fuel_7pct', cents: 175 }]);
    expect(c.taxCents).toBe(187);
    expect(c.totalCents).toBe(2862);
  });

  it('addendum C5: a quarterly line carries the flat env fee once per month (Maple Q3 96 gal is 10261)', () => {
    const c = computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'recurring', baseCents: 2900 * 3,
      period: { start: '2026-07-01', end: '2026-09-30' }, source: { type: 'serviceItem', id: 'si_maple_96' },
      catalogId: 'cat_res_96', frequency: 'weekly',
    });
    expect(c.fees).toEqual([
      { feeRuleId: 'fee_fuel_7pct', cents: 609 },
      { feeRuleId: 'fee_env_1', cents: 300 },
    ]);
    expect(c.taxCents).toBe(652);
    expect(c.totalCents).toBe(10261);
    expect(monthsInPeriod({ start: '2026-10-01', end: '2026-12-31' })).toBe(3);
    expect(monthsInPeriod({ start: '2026-12-01', end: '2027-02-28' })).toBe(3);
    expect(monthsInPeriod(undefined)).toBe(1);
  });

  it('a franchise zone site is taxed at 7% (addendum C8)', () => {
    expect(seed.taxRules.map((t) => t.zoneId).sort()).toEqual(['zone_boundary', 'zone_franchise', 'zone_open']);
  });

  it('reproduces the seeded Maple Q3 charges exactly', () => {
    const seeded = seed.charges.filter((c) => c.id.startsWith('chg_maple_q3_') && c.lineType === 'recurring');
    for (const s of seeded) {
      const item = seed.serviceItems.find((i) => i.id === s.source.id)!;
      const c = computeCharge({
        accountId: s.accountId, siteId: s.siteId, lineType: 'recurring', baseCents: s.baseCents,
        period: s.period!, source: s.source, catalogId: s.catalogId, frequency: item.frequency,
      });
      expect(c.fees).toEqual(s.fees);
      expect(c.taxCents).toBe(s.taxCents);
      expect(c.totalCents).toBe(s.totalCents);
      expect(c.pricing).toEqual(s.pricing);
    }
  });

  it('every charge carries base, fees, tax, source, and ruleWon (invariant 2)', () => {
    const c: Charge = computeCharge({
      accountId: 'acct_pm_oakridge', siteId: 'site_oak_2', lineType: 'recurring', baseCents: 18000,
      period: { start: '2026-09-01', end: '2026-09-30' }, source: { type: 'serviceItem', id: 'si_oak_2' },
      catalogId: 'cat_fl_2yd', frequency: '2x',
    });
    expect(typeof c.baseCents).toBe('number');
    expect(Array.isArray(c.fees)).toBe(true);
    expect(typeof c.taxCents).toBe('number');
    expect(c.source).toEqual({ type: 'serviceItem', id: 'si_oak_2' });
    expect(c.pricing.ruleWon).toBe('zoneRate');
  });
});

describe('allocate', () => {
  it('splits one source across several invoices', () => {
    const out = allocate({
      sourceType: 'payment', sourceId: 'pay_new', invoiceIds: ['inv_maple_2026q3', 'inv_oak_2026_09'], cents: [8745, 100],
    });
    expect(out).toEqual([
      { sourceType: 'payment', sourceId: 'pay_new', invoiceId: 'inv_maple_2026q3', cents: 8745 },
      { sourceType: 'payment', sourceId: 'pay_new', invoiceId: 'inv_oak_2026_09', cents: 100 },
    ]);
  });

  it('throws when cents exceed the open balance', () => {
    expect(() =>
      allocate({ sourceType: 'payment', sourceId: 'pay_new', invoiceIds: ['inv_maple_2026q3'], cents: [8746] }),
    ).toThrow(/exceeds its open balance of 8745/);
  });

  it('throws on a fully paid invoice, a mismatched list, or a non-positive amount', () => {
    expect(() =>
      allocate({ sourceType: 'payment', sourceId: 'p', invoiceIds: ['inv_maple_2026q2'], cents: [1] }),
    ).toThrow(/exceeds/);
    expect(() => allocate({ sourceType: 'payment', sourceId: 'p', invoiceIds: ['inv_maple_2026q3'], cents: [] })).toThrow(/same length/);
    expect(() => allocate({ sourceType: 'payment', sourceId: 'p', invoiceIds: ['inv_maple_2026q3'], cents: [0] })).toThrow(/positive/);
  });
});

describe('office-side generators keep their signatures', () => {
  it('throw not implemented in portal', () => {
    expect(() => generateRecurringCharges({ cycleDate: '2026-10-01' })).toThrow('not implemented in portal');
    expect(() => generateEventCharges()).toThrow('not implemented in portal');
    expect(() => postInvoices({ chargeIds: [] })).toThrow('not implemented in portal');
  });
});

describe('cycle math', () => {
  it('quarterly next cycle starts on the next calendar quarter', () => {
    expect(nextCycleStart(maple(), '2026-09-10')).toBe('2026-10-01');
    expect(nextCycleStart(maple())).toBe('2026-10-01'); // defaults to TODAY
    expect(nextCycleStart(maple(), '2026-12-31')).toBe('2027-01-01');
    expect(cycleEnd(maple(), '2026-10-01')).toBe('2026-12-31');
  });

  it('monthly and net30 next cycle starts on the first of next month', () => {
    const monthly: BillingAccount = { ...maple(), cycle: 'monthly' };
    expect(nextCycleStart(monthly, '2026-09-10')).toBe('2026-10-01');
    expect(nextCycleStart(oakridge(), '2026-09-10')).toBe('2026-10-01');
  });

  it('next invoice period is the next cycle in advance and the running cycle in arrears', () => {
    expect(nextInvoicePeriod(maple(), '2026-09-10')).toEqual({ start: '2026-10-01', end: '2026-12-31' });
    expect(nextInvoicePeriod(oakridge(), '2026-09-10')).toEqual({ start: '2026-09-01', end: '2026-09-30' });
  });
});
