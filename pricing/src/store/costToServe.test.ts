import { describe, expect, it } from 'vitest';
import { seed } from '../seed';
import { DEFAULT_ASSUMPTIONS, changedAssumptions, costToServe, validateAssumptions, yardsFor } from './costToServe';

const item = (id: string) => {
  const c = seed.catalog.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};

describe('yardsFor', () => {
  it('reads yards from the size label and treats carts as fractions of a yard', () => {
    expect(yardsFor(item('cat_fl_3yd'))).toBe(3);
    expect(yardsFor(item('cat_fl_2yd'))).toBe(2);
    expect(yardsFor(item('cat_ro_20yd'))).toBe(20);
    expect(yardsFor(item('cat_res_96'))).toBe(0.5);
    expect(yardsFor(item('cat_res_64'))).toBe(0.33);
  });
});

describe('costToServe', () => {
  it('prices a 3 yd msw container at 2x to the artboard numbers', () => {
    const c = costToServe({ item: item('cat_fl_3yd'), material: 'msw', frequency: '2x' });
    expect(c.effectiveLiftsPerDay).toBe(80);
    expect(c.truckPerLiftCents).toBe(812.5);
    expect(c.liftsPerMonth).toBe(8.67);
    expect(c.monthlyTruckCents).toBe(7044); // 812.5 * 8.67 = 7044.375
    expect(c.lbPerLift).toBe(285);
    expect(c.tonsPerMonth).toBeCloseTo(1.235475, 6);
    expect(c.disposalCents).toBe(7660); // 1.235475 * 6200 = 7659.945
    expect(c.directCents).toBe(14704);
    expect(c.indirectCents).toBe(2206);
    expect(c.fullCostCents).toBe(16910);
    expect(c.targetPriceCents).toBe(19894);
    expect(c.marginCents).toBe(19894 - 16910);
    expect(c.minimumDefensibleCents).toBe(c.fullCostCents);
  });

  it('access flags add minutes per lift and lower effective lifts per day', () => {
    const c = costToServe({ item: item('cat_fl_3yd'), material: 'msw', frequency: '2x', access: { gate: true, lock: true, enclosure: true } });
    // 480 / (480/80 + 6) = 40 lifts a day, so truck time per lift doubles.
    expect(c.extraMinutesPerLift).toBe(6);
    expect(c.effectiveLiftsPerDay).toBe(40);
    expect(c.truckPerLiftCents).toBe(1625);
    expect(c.disposalCents).toBe(7660);
  });

  it('material changes disposal only', () => {
    const msw = costToServe({ item: item('cat_fl_3yd'), material: 'msw', frequency: '2x' });
    const wood = costToServe({ item: item('cat_fl_3yd'), material: 'wood', frequency: '2x' });
    expect(wood.monthlyTruckCents).toBe(msw.monthlyTruckCents);
    expect(wood.lbPerLift).toBe(300);
    expect(wood.disposalCents).toBe(Math.round(((300 * 8.67) / 2000) * 6200));
  });

  it('residential carts use residentialStopsPerDay and land well under the $29 cart price', () => {
    const c = costToServe({ item: item('cat_res_96'), material: 'msw', frequency: 'weekly' });
    expect(c.liftsPerDaySource).toBe('residentialStopsPerDay');
    expect(c.liftsPerDayBase).toBe(600);
    expect(c.fullCostCents).toBeLessThan(2900);
    expect(c.fullCostCents).toBeGreaterThan(0);
  });

  it('rolloff boxes use rolloffHaulsPerDay (6.0c): a 20 yd C&D haul costs $338.48 against the $575 haul price', () => {
    const c = costToServe({ item: item('cat_ro_20yd'), material: 'cAndD', frequency: 'onCall' });
    expect(DEFAULT_ASSUMPTIONS.rolloffHaulsPerDay).toBe(6);
    expect(c.liftsPerDaySource).toBe('rolloffHaulsPerDay');
    expect(c.liftsPerDayBase).toBe(6);
    expect(c.monthlyTruckCents).toBe(10833); // 65000 / 6 = 10833.33 a haul, one haul a month on call
    expect(c.disposalCents).toBe(18600); // 20 yd * 300 lb = 3 tons * $62
    expect(c.fullCostCents).toBe(33848);
    expect(c.targetPriceCents).toBe(39821);
    const faster = costToServe({ item: item('cat_ro_20yd'), material: 'cAndD', frequency: 'onCall', assumptions: { ...DEFAULT_ASSUMPTIONS, rolloffHaulsPerDay: 8 } });
    expect(faster.fullCostCents).toBeLessThan(c.fullCostCents);
    // Frontload is unaffected by the rolloff assumption.
    const fl = costToServe({ item: item('cat_fl_3yd'), material: 'msw', frequency: '2x', assumptions: { ...DEFAULT_ASSUMPTIONS, rolloffHaulsPerDay: 8 } });
    expect(fl.fullCostCents).toBe(16910);
  });

  it('every editable assumption moves the result', () => {
    const base = costToServe({ item: item('cat_fl_3yd'), material: 'msw', frequency: '2x' }).targetPriceCents;
    const bump = (patch: Partial<typeof DEFAULT_ASSUMPTIONS>) =>
      costToServe({ item: item('cat_fl_3yd'), material: 'msw', frequency: '2x', assumptions: { ...DEFAULT_ASSUMPTIONS, ...patch } }).targetPriceCents;
    expect(bump({ truckDayCostCents: 70000 })).toBeGreaterThan(base);
    expect(bump({ baseLiftsPerDay: 60 })).toBeGreaterThan(base);
    expect(bump({ truckHoursPerDay: 6 })).toBe(base); // fewer hours at the same lifts per day keeps cost per lift
    expect(bump({ tipFeeCentsPerTon: 8000 })).toBeGreaterThan(base);
    expect(bump({ indirectPct: 20 })).toBeGreaterThan(base);
    expect(bump({ targetMarginPct: 25 })).toBeGreaterThan(base);
    expect(bump({ lbPerYard: { ...DEFAULT_ASSUMPTIONS.lbPerYard, msw: 120 } })).toBeGreaterThan(base);
    expect(bump({ liftsPerMonth: { ...DEFAULT_ASSUMPTIONS.liftsPerMonth, '2x': 9 } })).toBeGreaterThan(base);
  });

  it('truck hours matter once an access flag adds fixed minutes', () => {
    const run = (truckHoursPerDay: number) =>
      costToServe({ item: item('cat_fl_3yd'), material: 'msw', frequency: '2x', access: { gate: true }, assumptions: { ...DEFAULT_ASSUMPTIONS, truckHoursPerDay } });
    expect(run(6).effectiveLiftsPerDay).toBeLessThan(run(8).effectiveLiftsPerDay);
  });

  it('rejects assumptions that would divide by zero', () => {
    expect(() => validateAssumptions({ ...DEFAULT_ASSUMPTIONS, baseLiftsPerDay: 0 })).toThrow(RangeError);
    expect(() => validateAssumptions({ ...DEFAULT_ASSUMPTIONS, targetMarginPct: 100 })).toThrow(RangeError);
    expect(() => validateAssumptions({ ...DEFAULT_ASSUMPTIONS, rolloffHaulsPerDay: 0 })).toThrow(RangeError);
    expect(() => validateAssumptions(DEFAULT_ASSUMPTIONS)).not.toThrow();
  });

  it('changedAssumptions lists edited paths', () => {
    expect(changedAssumptions(DEFAULT_ASSUMPTIONS)).toEqual([]);
    expect(changedAssumptions({ ...DEFAULT_ASSUMPTIONS, lbPerYard: { ...DEFAULT_ASSUMPTIONS.lbPerYard, wood: 110 } })).toEqual(['lbPerYard.wood']);
  });
});
