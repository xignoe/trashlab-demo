import { beforeEach, describe, expect, it } from 'vitest';
import { buildOffer } from '../offer';
import { useStore } from '../store';

beforeEach(() => useStore.getState().reset());

const single = () => buildOffer({ zoneId: 'zone_open', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false });

describe('buildOffer', () => {
  it('dueToday for the single-cart offer is $129.36', () => {
    const o = single();
    expect(o.dueTodayCents).toBe(12936);
    expect(o.recurringQuarterlyCents).toBe(10261);
    expect(o.recurringMonthlyEquivalentCents).toBe(3420);
    expect(o.feeBreakdown).toEqual({ base: 8700, delivery: 2500, fuel: 609, environmental: 300, tax: 827 });
    expect(o.startDateOptions).toEqual(['2026-09-15', '2026-09-22']);
    expect(o.startDate).toBe('2026-09-15');
    expect(o.cartArrives).toBe('2026-09-14');
    expect(o.period).toEqual({ start: '2026-09-15', end: '2026-12-15' });
    expect(o.provisional).toBe(false);
    expect(o.charges).toHaveLength(2);
    expect(o.lines[0]).toMatchObject({ catalogId: 'cat_res_96', frequency: 'weekly', monthlyCents: 2900, quarterlyCents: 8700 });
    expect(o.lines[0].pricing).toEqual({ priceCents: 2900, rateVersionId: 'rv_res_96_open_weekly', ruleWon: 'zoneRate' });
    expect(o.deliveryCharge).toMatchObject({ lineType: 'fee', baseCents: 2500, taxCents: 175, totalCents: 2675, pricing: { ruleWon: 'zoneRate' } });
    expect(o.rules).toEqual({
      zoneId: 'zone_open', zoneName: 'Piedmont open market', routeId: 'route_tue_res', routeDay: 'Tue',
      rateVersions: [{ catalogId: 'cat_res_96', rateVersionId: 'rv_res_96_open_weekly', ruleWon: 'zoneRate' }],
      feeRuleIds: ['fee_fuel_7pct', 'fee_env_1'], taxRuleId: 'tax_open',
    });
  });

  it('honours the chosen start date', () => {
    const o = buildOffer({ zoneId: 'zone_open', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false, startDate: '2026-09-22' });
    expect(o.startDate).toBe('2026-09-22');
    expect(o.cartArrives).toBe('2026-09-21');
    expect(o.period.end).toBe('2026-12-22');
    expect(o.dueTodayCents).toBe(12936);
  });

  it('adds a second cart and recycling as their own priced lines', () => {
    const second = buildOffer({ zoneId: 'zone_open', routeId: 'route_mon_res', cartCatalogId: 'cat_res_96', extraCart: true, recycling: false });
    expect(second.lines.map((l) => l.catalogId)).toEqual(['cat_res_96', 'cat_res_extra_cart']);
    expect(second.lines[1].charge).toMatchObject({ baseCents: 2700, taxCents: 202, totalCents: 3391 });
    expect(second.recurringQuarterlyCents).toBe(10261 + 3391);
    expect(second.dueTodayCents).toBe(10261 + 3391 + 2675);
    expect(second.startDateOptions).toEqual(['2026-09-14', '2026-09-21']);

    const recycling = buildOffer({ zoneId: 'zone_open', routeId: 'route_tue_res', cartCatalogId: 'cat_res_64', extraCart: false, recycling: true });
    expect(recycling.lines.map((l) => `${l.catalogId}:${l.frequency}`)).toEqual(['cat_res_64:weekly', 'cat_res_recycling:eow']);
    expect(recycling.lines[0].charge).toMatchObject({ baseCents: 7800, totalCents: 7800 + 546 + 300 + 584 });
    expect(recycling.lines[1].charge).toMatchObject({ baseCents: 3600, fees: [{ feeRuleId: 'fee_fuel_7pct', cents: 252 }, { feeRuleId: 'fee_env_1', cents: 300 }], taxCents: 270, totalCents: 4422 });
  });

  it('marks a boundary zone provisional and prices it from the boundary zone rate (addendum C4)', () => {
    const o = buildOffer({ zoneId: 'zone_boundary', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false });
    expect(o.provisional).toBe(true);
    expect(o.lines[0].pricing).toEqual({ priceCents: 3100, rateVersionId: 'rv_res_96_boundary_weekly', ruleWon: 'zoneRate' });
    expect(o.lines[0].charge).toMatchObject({ baseCents: 9300, fees: [{ feeRuleId: 'fee_fuel_7pct', cents: 651 }, { feeRuleId: 'fee_env_1', cents: 300 }], taxCents: 697, totalCents: 10948 });
    expect(o.deliveryCharge).toMatchObject({ baseCents: 2500, taxCents: 175, totalCents: 2675 });
    expect(o.recurringQuarterlyCents).toBe(10948);
    expect(o.dueTodayCents).toBe(13623);
    expect(o.rules.taxRuleId).toBe('tax_boundary');
    // Boundary is priced higher than open, never equal to it.
    expect(o.dueTodayCents).toBeGreaterThan(single().dueTodayCents);
  });

  it('throws a clear error for a franchise zone, an unserved zone, and a business buyer', () => {
    expect(() => buildOffer({ zoneId: 'zone_franchise', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false })).toThrow(/franchise agreement/);
    expect(() => buildOffer({ zoneId: 'zone_notserved', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false })).toThrow(/no service/);
    expect(() => buildOffer({ zoneId: 'zone_open', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false, business: true as unknown as false })).toThrow(/Commercial/);
    expect(() => buildOffer({ zoneId: 'zone_open', routeId: 'route_tue_res', cartCatalogId: 'cat_fl_2yd', extraCart: false, recycling: false })).toThrow(/Cart size/);
  });

  it('is pure: building an offer writes nothing to the store', () => {
    const before = JSON.stringify(useStore.getState());
    single();
    expect(JSON.stringify(useStore.getState())).toBe(before);
    expect(useStore.getState().accounts.acct_offer).toBeUndefined();
  });
});
