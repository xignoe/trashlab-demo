// buildOffer on the merged seed (billing's). Every price is the canonical resolvePrice against billing's rateVersions
// and the canonical computeCharge fee stack (box 2D.3). Since Phase 3 the figures match the prototype again: the first
// period ends on its last day inclusive (Sep 15 to Dec 14, Phase 3.2b), the canonical wholeMonths counts it as 3 months
// so the environmental fee is $3.00 (Phase 3.2a), and zone_boundary has its own higher rate rows (Phase 3.7c).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setToday } from '../../../store/clock';
import { useStore } from '../../../store/useStore';
import { buildOffer } from '../lib/offer';
import { viewOf } from '../lib/view';

const view = () => viewOf(useStore.getState());
beforeEach(() => useStore.getState().reset());
afterEach(() => setToday());

const single = () => buildOffer({ zoneId: 'zone_open', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false }, view());

/** The rate version billing's seed publishes for a catalog item in a zone (ids are billing's, never hard-coded). */
const seedRow = (catalogId: string, zoneId: string) =>
  useStore.getState().db.rateVersions.find((rv) => rv.catalogId === catalogId && rv.zoneId === zoneId && rv.effectiveFrom <= '2026-09-15' && rv.status === 'published')!;

describe('buildOffer', () => {
  it('dueToday for the single-cart offer is $129.36 (prototype $129.36; Phase 3.2a counts Sep 15 to Dec 14 as 3 months)', () => {
    const o = single();
    expect(o.dueTodayCents).toBe(12936);
    expect(o.recurringQuarterlyCents).toBe(10261);
    expect(o.recurringMonthlyEquivalentCents).toBe(3420);
    expect(o.feeBreakdown).toEqual({ base: 8700, delivery: 2500, fuel: 609, environmental: 300, tax: 827 });
    expect(o.startDateOptions).toEqual(['2026-09-15', '2026-09-22']);
    expect(o.startDate).toBe('2026-09-15');
    expect(o.cartArrives).toBe('2026-09-14');
    expect(o.period).toEqual({ start: '2026-09-15', end: '2026-12-14' });
    expect(o.provisional).toBe(false);
    expect(o.charges).toHaveLength(2);
    expect(o.lines[0]).toMatchObject({ catalogId: 'cat_res_96', frequency: 'weekly', monthlyCents: 2900, quarterlyCents: 8700 });
    const rv = seedRow('cat_res_96', 'zone_open');
    expect(o.lines[0].pricing).toEqual({ priceCents: 2900, rateVersionId: rv.id, ruleWon: 'zoneRate' });
    expect(o.lines[0].charge).toMatchObject({ baseCents: 8700, fees: [{ feeRuleId: 'fee_fuel_7pct', cents: 609 }, { feeRuleId: 'fee_env_1', cents: 300 }], taxCents: 652, totalCents: 10261 });
    expect(o.deliveryCharge).toMatchObject({ lineType: 'fee', baseCents: 2500, taxCents: 175, totalCents: 2675, pricing: { ruleWon: 'zoneRate' } });
    expect(o.rules).toEqual({
      zoneId: 'zone_open', zoneName: view().zones.zone_open.name, routeId: 'route_tue_res', routeDay: 'Tue',
      rateVersions: [{ catalogId: 'cat_res_96', rateVersionId: rv.id, ruleWon: 'zoneRate' }],
      feeRuleIds: ['fee_fuel_7pct', 'fee_env_1'], taxRuleId: view().db.taxRules.find((t) => t.zoneId === 'zone_open')!.id,
    });
  });

  it('honours the chosen start date', () => {
    const o = buildOffer({ zoneId: 'zone_open', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false, startDate: '2026-09-22' }, view());
    expect(o.startDate).toBe('2026-09-22');
    expect(o.cartArrives).toBe('2026-09-21');
    expect(o.period.end).toBe('2026-12-21');
    expect(o.dueTodayCents).toBe(12936);
  });

  it('adds a second cart and recycling as their own priced lines', () => {
    const second = buildOffer({ zoneId: 'zone_open', routeId: 'route_mon_res', cartCatalogId: 'cat_res_96', extraCart: true, recycling: false }, view());
    expect(second.lines.map((l) => l.catalogId)).toEqual(['cat_res_96', 'cat_res_extra_cart']);
    expect(second.lines[1].charge).toMatchObject({ baseCents: 2700, taxCents: 202, totalCents: 3391 });
    expect(second.recurringQuarterlyCents).toBe(13652);
    expect(second.dueTodayCents).toBe(16327);
    expect(second.startDateOptions).toEqual(['2026-09-14', '2026-09-21']);

    const recycling = buildOffer({ zoneId: 'zone_open', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: true }, view());
    expect(recycling.lines.map((l) => `${l.catalogId}:${l.frequency}`)).toEqual(['cat_res_96:weekly', 'cat_res_recycling:eow']);
    expect(recycling.lines[1].charge).toMatchObject({ baseCents: 3600, fees: [{ feeRuleId: 'fee_fuel_7pct', cents: 252 }, { feeRuleId: 'fee_env_1', cents: 300 }], taxCents: 270, totalCents: 4422 });
    expect(recycling.recurringQuarterlyCents).toBe(14683);
    expect(recycling.dueTodayCents).toBe(17358);

    const small = buildOffer({ zoneId: 'zone_open', routeId: 'route_tue_res', cartCatalogId: 'cat_res_64', extraCart: false, recycling: false }, view());
    expect(small.lines[0].charge).toMatchObject({ baseCents: 7800, totalCents: 7800 + 546 + 300 + 584 });
  });

  it('marks a boundary zone provisional and prices it from zone_boundary\'s own rate row (addendum C4)', () => {
    const o = buildOffer({ zoneId: 'zone_boundary', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false }, view());
    const rv = seedRow('cat_res_96', 'zone_boundary');
    expect(rv.id).not.toBe(seedRow('cat_res_96', 'zone_open').id);
    expect(o.provisional).toBe(true);
    expect(o.lines[0].pricing).toEqual({ priceCents: rv.priceCents, rateVersionId: rv.id, ruleWon: 'zoneRate' });
    expect(o.rules.taxRuleId).toBe(view().db.taxRules.find((t) => t.zoneId === 'zone_boundary')!.id);
    // zone_boundary has its own higher rate row (addendum C4, Phase 3.7c): 96 gal at 3100, so the held signup is
    // $136.23 due and $109.48 a quarter, the storefront prototype's figures. Pinned so a reseed shows.
    expect(rv.priceCents).toBe(3100);
    expect(o.dueTodayCents).toBe(13623);
    expect(o.recurringQuarterlyCents).toBe(10948);
  });

  it('follows the engine clock and the rate card: a start date on or after a newer version prices at it', () => {
    // Billing's seed publishes cat_res_64 at 2700 from 2026-10-01 (superseding 2600). Two weeks later the storefront
    // offers Sep 29 (old price) and Oct 6 (new price) for the Tuesday route.
    setToday('2026-09-24');
    const args = { zoneId: 'zone_open', routeId: 'route_tue_res', cartCatalogId: 'cat_res_64', extraCart: false, recycling: false } as const;
    const early = buildOffer(args, view());
    expect(early.startDateOptions).toEqual(['2026-09-29', '2026-10-06']);
    expect(early.lines[0].priceCents).toBe(2600);
    const late = buildOffer({ ...args, startDate: '2026-10-06' }, view());
    expect(late.lines[0].priceCents).toBe(2700);
    expect(late.lines[0].pricing.rateVersionId).toBe(
      useStore.getState().db.rateVersions.find((rv) => rv.catalogId === 'cat_res_64' && rv.effectiveFrom === '2026-10-01')!.id,
    );
  });

  it('throws a clear error for a franchise zone, an unserved zone, and a business buyer', () => {
    expect(() => buildOffer({ zoneId: 'zone_franchise', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false }, view())).toThrow(/franchise agreement/);
    expect(() => buildOffer({ zoneId: 'zone_notserved', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false }, view())).toThrow(/no service/);
    expect(() => buildOffer({ zoneId: 'zone_open', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false, business: true as unknown as false }, view())).toThrow(/Commercial/);
    expect(() => buildOffer({ zoneId: 'zone_open', routeId: 'route_tue_res', cartCatalogId: 'cat_fl_2yd', extraCart: false, recycling: false }, view())).toThrow(/Cart size/);
  });

  it('is pure: building an offer writes nothing to the store and mints no charge id', () => {
    const before = JSON.stringify(useStore.getState());
    const o = single();
    expect(JSON.stringify(useStore.getState())).toBe(before);
    expect(useStore.getState().db.accounts.find((a) => a.id === 'acct_offer')).toBeUndefined();
    // Offer charges carry fixed offer ids, so pricing never advances billing's chg_bl_ counter.
    expect(o.charges.map((c) => c.id)).toEqual(['chg_offer_cat_res_96', 'chg_offer_delivery']);
  });
});
