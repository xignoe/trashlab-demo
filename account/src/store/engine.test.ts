import { beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../seed';
import { TODAY } from './clock';
import {
  AllocationError,
  PriceNotFound,
  accountBalance,
  allocate,
  computeCharge,
  explainPrice,
  generateEventCharges,
  generateRecurringCharges,
  highestSeedSuffix,
  newId,
  nextCycleDate,
  openBalance,
  pastDue,
  planServiceChange,
  postInvoices,
  previewNextRun,
  peekId,
  resolvePrice,
  unallocatedCents,
} from './engine';
import { entities, listOf, stateFromSeed, useStore, type EntityState } from './useStore';
import {
  autoAllocateOldestFirst,
  buildAccountView,
  buildCreditPreview,
  buildExistingAllocationPreview,
  buildHoldPreview,
  buildRouteStub,
  buildPaymentPreview,
  openInvoicesOldestFirst,
  parseDollars,
} from './selectors';
import type { Charge } from '../types';

const fresh = (): EntityState => stateFromSeed(seed);

function expectInvariant2(charges: Charge[]) {
  expect(charges.length).toBeGreaterThan(0);
  for (const c of charges) {
    expect(Number.isInteger(c.baseCents), `${c.id} base`).toBe(true);
    expect(Array.isArray(c.fees), `${c.id} fees`).toBe(true);
    expect(Number.isInteger(c.taxCents), `${c.id} tax`).toBe(true);
    expect(c.source.type, `${c.id} source type`).toBeTruthy();
    expect(c.source.id, `${c.id} source id`).toBeTruthy();
    expect(['contractOverride', 'zoneRate', 'standardRate', 'manualException'], `${c.id} ruleWon`).toContain(c.pricing.ruleWon);
    expect(c.baseCents + c.fees.reduce((s, f) => s + f.cents, 0) + c.taxCents, `${c.id} total ties`).toBe(c.totalCents);
    expect(c.status).toBe('proposed');
  }
}

describe('resolvePrice', () => {
  const state = fresh();

  it('bakery cat_fl_3yd 2x: contract override 19800 wins', () => {
    const r = resolvePrice({ catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', accountId: 'acct_bakery', onDate: TODAY }, state);
    expect(r).toEqual({ priceCents: 19800, contractId: 'contract_bakery', ruleWon: 'contractOverride' });
  });

  it('generic frontload account without a contract: zone rate 22000', () => {
    const r = resolvePrice({ catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', accountId: 'acct_fl_006', onDate: TODAY }, state);
    expect(r).toEqual({ priceCents: 22000, rateVersionId: 'rv_fl_3yd_v1', ruleWon: 'zoneRate' });
  });

  it('picks the version whose effectiveFrom is latest but not after onDate', () => {
    const args = { catalogId: 'cat_res_96', frequency: 'weekly' as const, zoneId: 'zone_open', accountId: 'acct_res_maple' };
    const old = resolvePrice({ ...args, onDate: '2025-06-01' }, state);
    expect(old).toEqual({ priceCents: 2700, rateVersionId: 'rv_res_96_v0', ruleWon: 'zoneRate' });
    const now = resolvePrice({ ...args, onDate: TODAY }, state);
    expect(now).toEqual({ priceCents: 2900, rateVersionId: 'rv_res_96_v1', ruleWon: 'zoneRate' });
    // The day the new version takes effect it wins; the day before it does not.
    expect(resolvePrice({ ...args, onDate: '2026-01-01' }, state).rateVersionId).toBe('rv_res_96_v1');
    expect(resolvePrice({ ...args, onDate: '2025-12-31' }, state).rateVersionId).toBe('rv_res_96_v0');
  });

  it('throws PriceNotFound for an unpriced catalog, frequency, zone, or date', () => {
    expect(() => resolvePrice({ catalogId: 'cat_nope', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_maple', onDate: TODAY }, state)).toThrow(PriceNotFound);
    expect(() => resolvePrice({ catalogId: 'cat_res_96', frequency: '3x', zoneId: 'zone_open', accountId: 'acct_res_maple', onDate: TODAY }, state)).toThrow(PriceNotFound);
    expect(() => resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_franchise', accountId: 'acct_res_maple', onDate: TODAY }, state)).toThrow(PriceNotFound);
    expect(() => resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_maple', onDate: '2024-06-01' }, state)).toThrow(PriceNotFound);
  });

  it('a contract override only applies when its frequency matches and the date is inside the term', () => {
    // No weekly override and no weekly rate card for a 3 yd, so this must throw rather than misuse the 2x override.
    expect(() => resolvePrice({ catalogId: 'cat_fl_3yd', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_bakery', onDate: TODAY }, state)).toThrow(PriceNotFound);
    const beforeTerm = resolvePrice({ catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', accountId: 'acct_bakery', onDate: '2028-01-15' }, state);
    expect(beforeTerm.ruleWon).toBe('zoneRate');
  });

  it('falls back to a published version with no zone (standardRate) before throwing', () => {
    const s = fresh();
    s.rateVersions = { byId: { ...s.rateVersions.byId }, ids: [...s.rateVersions.ids] };
    s.rateVersions.byId['rv_res_96_std'] = { id: 'rv_res_96_std', catalogId: 'cat_res_96', frequency: 'weekly', priceCents: 3100, effectiveFrom: '2026-01-01', status: 'published', publishedAt: '2025-12-15' };
    s.rateVersions.ids.push('rv_res_96_std');
    const r = resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_boundary', accountId: 'acct_res_maple', onDate: TODAY }, s);
    expect(r).toEqual({ priceCents: 3100, rateVersionId: 'rv_res_96_std', ruleWon: 'standardRate' });
    // Zone still wins over standard where both exist.
    expect(resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_maple', onDate: TODAY }, s).ruleWon).toBe('zoneRate');
  });
});

describe('explainPrice', () => {
  const state = fresh();

  it('bakery 3 yd: contract 19800 won over the 22000 zone rate, 10% below for competitive match', () => {
    const e = explainPrice({ catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', accountId: 'acct_bakery', onDate: TODAY }, state);
    expect(e.ruleWon).toBe('contractOverride');
    expect(e.priceCents).toBe(19800);
    expect(e.contractOverride).toMatchObject({ contractId: 'contract_bakery', priceCents: 19800, reason: 'competitive match', pctBelowRateCard: 10 });
    expect(e.rateVersion).toMatchObject({ id: 'rv_fl_3yd_v1', priceCents: 22000, effectiveFrom: '2026-01-01', publishedAt: '2025-12-15', ruleWon: 'zoneRate' });
    expect(e.priorVersion).toBeUndefined();
  });

  it('maple 96 gal: zone rate with the superseded prior version', () => {
    const e = explainPrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_maple', onDate: TODAY }, state);
    expect(e.ruleWon).toBe('zoneRate');
    expect(e.contractOverride).toBeUndefined();
    expect(e.rateVersion).toMatchObject({ id: 'rv_res_96_v1', priceCents: 2900, effectiveFrom: '2026-01-01', publishedAt: '2025-12-15' });
    expect(e.priorVersion).toEqual({ id: 'rv_res_96_v0', priceCents: 2700, effectiveFrom: '2025-01-01', publishedAt: '2024-12-15' });
  });
});

describe('computeCharge', () => {
  const state = fresh();

  it('3-month Maple 96 line: base 8700, fuel 609, env 300, tax 652, total 10261', () => {
    const c = computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'recurring', catalogId: 'cat_res_96',
      description: 'test', source: { type: 'serviceItem', id: 'si_maple_96' },
      period: { start: '2026-10-01', end: '2026-12-31' }, baseCents: 2900 * 3,
      pricing: { rateVersionId: 'rv_res_96_v1', ruleWon: 'zoneRate' },
    }, state);
    // Arithmetic from the rules: fuel 7% of 8700 = 609; env $1 x 3 months = 300; tax 7% of (8700 + 609) = 651.63 rounds to 652.
    expect(c.baseCents).toBe(8700);
    expect(c.fees).toEqual([{ feeRuleId: 'fee_fuel_7pct', cents: 609 }, { feeRuleId: 'fee_env_1', cents: 300 }]);
    expect(c.taxCents).toBe(Math.round((8700 + 609) * 0.07));
    expect(c.taxCents).toBe(652);
    expect(c.totalCents).toBe(10261);
    expect(c.status).toBe('proposed');
    expect(c.evidenceIds).toEqual([]);
    expect(c.id).toMatch(/^ch_ac_\d{4}$/);
    expect(c.pricing).toEqual({ rateVersionId: 'rv_res_96_v1', ruleWon: 'zoneRate' });
    expect(c.period).toEqual({ start: '2026-10-01', end: '2026-12-31' });
  });

  it('fresh ids on every call', () => {
    const args = {
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'event' as const, description: 'x',
      source: { type: 'manual' as const, id: 'm' }, servicedOn: TODAY, baseCents: 100,
    };
    expect(computeCharge(args, state).id).not.toBe(computeCharge(args, state).id);
  });

  it('a one-month line carries the flat fee once; an event line carries fuel and tax but no env fee', () => {
    const month = computeCharge({
      accountId: 'acct_bakery', siteId: 'site_bakery', lineType: 'recurring', description: 'x',
      source: { type: 'serviceItem', id: 'si_bakery_3yd' }, period: { start: '2026-10-01', end: '2026-10-31' }, baseCents: 19800,
    }, state);
    expect(month.fees).toEqual([{ feeRuleId: 'fee_fuel_7pct', cents: 1386 }, { feeRuleId: 'fee_env_1', cents: 100 }]);
    expect(month.taxCents).toBe(Math.round((19800 + 1386) * 0.07));
    const event = computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'event', description: 'x',
      source: { type: 'serviceEvent', id: 'ev_maple_extrabags' }, servicedOn: '2026-09-07', baseCents: 250,
    }, state);
    expect(event.fees).toEqual([{ feeRuleId: 'fee_fuel_7pct', cents: 18 }]);
    expect(event.taxCents).toBe(Math.round(268 * 0.07));
    expect(event.totalCents).toBe(250 + 18 + 19);
    expect(event.servicedOn).toBe('2026-09-07');
  });

  it('lateFee lines have zero tax and no fees', () => {
    const c = computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'lateFee', description: 'Late fee',
      source: { type: 'manual', id: 'office' }, servicedOn: TODAY, baseCents: 1000,
    }, state);
    expect(c.fees).toEqual([]);
    expect(c.taxCents).toBe(0);
    expect(c.totalCents).toBe(1000);
    expect(c.pricing.ruleWon).toBe('manualException');
  });

  it('a fee line (reinstatement) gets tax from tax_open but no fuel surcharge', () => {
    const c = computeCharge({
      accountId: 'acct_res_kerr', siteId: 'site_kerr', lineType: 'fee', description: 'Reinstatement fee',
      source: { type: 'manual', id: 'office' }, servicedOn: TODAY, baseCents: 2500,
    }, state);
    expect(c.fees).toEqual([]);
    expect(c.taxCents).toBe(175);
    expect(c.totalCents).toBe(2675);
  });

  it('taxExempt accounts skip tax entirely', () => {
    const s = fresh();
    s.billingAccounts = { ...s.billingAccounts, byId: { ...s.billingAccounts.byId, acct_res_maple: { ...s.billingAccounts.byId.acct_res_maple, taxExempt: true } } };
    const c = computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'recurring', description: 'x',
      source: { type: 'serviceItem', id: 'si_maple_96' }, period: { start: '2026-10-01', end: '2026-12-31' }, baseCents: 8700,
    }, s);
    expect(c.taxCents).toBe(0);
    expect(c.totalCents).toBe(8700 + 609 + 300);
  });
});

describe('generateRecurringCharges', () => {
  it('2026-10-01: nothing for suspended acct_res_kerr (invariant 4)', () => {
    const out = generateRecurringCharges({ cycleDate: '2026-10-01' }, fresh());
    expect(out.filter((c) => c.accountId === 'acct_res_kerr')).toHaveLength(0);
  });

  it('2026-10-01: three lines for Maple, a full quarter each, priced on the cycle date', () => {
    const out = generateRecurringCharges({ cycleDate: '2026-10-01' }, fresh());
    const maple = out.filter((c) => c.accountId === 'acct_res_maple');
    expect(maple).toHaveLength(3);
    expect(maple.map((c) => c.catalogId).sort()).toEqual(['cat_res_96', 'cat_res_extra_cart', 'cat_res_recycling']);
    for (const c of maple) {
      expect(c.lineType).toBe('recurring');
      expect(c.period).toEqual({ start: '2026-10-01', end: '2026-12-31' });
      expect(c.source.type).toBe('serviceItem');
      expect(c.pricing.ruleWon).toBe('zoneRate');
      expect(c.pricing.rateVersionId).toBeTruthy();
    }
    const line96 = maple.find((c) => c.catalogId === 'cat_res_96')!;
    expect(line96.baseCents).toBe(8700);
    expect(line96.totalCents).toBe(10261);
    expect(line96.description).toBe('96 gal trash cart, weekly, 2026-10-01 to 2026-12-31');
    expectInvariant2(maple);
  });

  it('cycle boundaries: monthly and net30 on the 1st of any month, quarterly on quarter starts, perJob never', () => {
    const s = fresh();
    const nov = generateRecurringCharges({ cycleDate: '2026-11-01' }, s);
    expect(nov.some((c) => c.accountId === 'acct_res_maple')).toBe(false);
    expect(nov.some((c) => c.accountId === 'acct_bakery')).toBe(true);
    expect(nov.some((c) => c.accountId === 'acct_pm_oakridge')).toBe(true);
    expect(nov.some((c) => c.accountId === 'acct_ro_homeowner')).toBe(false);
    expect(generateRecurringCharges({ cycleDate: '2026-10-15' }, s)).toHaveLength(0);
  });

  it('bakery: monthly lines at contract prices with contractId copied in', () => {
    const out = generateRecurringCharges({ cycleDate: '2026-10-01' }, fresh()).filter((c) => c.accountId === 'acct_bakery');
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.baseCents).sort()).toEqual([17100, 19800]);
    for (const c of out) {
      expect(c.pricing).toEqual({ rateVersionId: undefined, contractId: 'contract_bakery', ruleWon: 'contractOverride' });
      expect(c.period).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    }
  });

  it('addendum C14: net30 accounts not billed in advance still bill cycleDate forward (Oakridge Oct 1 run bills Oct 1 to Oct 31)', () => {
    const out = generateRecurringCharges({ cycleDate: '2026-10-01' }, fresh()).filter((c) => c.accountId === 'acct_pm_oakridge');
    expect(out).toHaveLength(4);
    for (const c of out) {
      expect(c.period).toEqual({ start: '2026-10-01', end: '2026-10-31' });
      expect(c.baseCents).toBe(16500);
    }
  });

  it('onCall rolloff items never recur; Hale gets no recurring line', () => {
    const out = generateRecurringCharges({ cycleDate: '2026-10-01' }, fresh());
    expect(out.filter((c) => c.accountId === 'acct_contractor_hale')).toHaveLength(0);
  });

  it('a hold keeps billing (no proration, Holt items are held not ended)', () => {
    const out = generateRecurringCharges({ cycleDate: '2026-10-01' }, fresh()).filter((c) => c.accountId === 'acct_res_holt');
    expect(out).toHaveLength(1);
  });

  it('does not produce a line already charged for the same item and period start', () => {
    const july = generateRecurringCharges({ cycleDate: '2026-07-01' }, fresh());
    expect(july.filter((c) => c.accountId === 'acct_res_maple')).toHaveLength(0);
  });

  it('invariant 3: after closing si_maple_96 on 2026-09-14 and opening a 64 gal item, the next run has the 64 line and not the 96', () => {
    const plan = planServiceChange(
      { siteId: 'site_maple', replaceItemId: 'si_maple_96', catalogId: 'cat_res_64', qty: 1, frequency: 'weekly', effectiveFrom: '2026-09-14' },
      fresh(),
    );
    expect(plan.oldItem).toMatchObject({ id: 'si_maple_96', effectiveTo: '2026-09-14', status: 'ended' });
    expect(plan.newItem).toMatchObject({ catalogId: 'cat_res_64', effectiveFrom: '2026-09-14', status: 'active' });
    expect(plan.workOrder).toMatchObject({ kind: 'swap', status: 'open', scheduledFor: '2026-09-14', siteId: 'site_maple', serviceItemId: plan.newItem.id });
    // The phone request is an office note draft, never a Request row (Portal owns Requests).
    expect(plan.officeRequest).toMatchObject({ kind: 'cartChange', createdVia: 'phone', siteId: 'site_maple', accountId: 'acct_res_maple', workOrderId: plan.workOrder.id });
    expect(plan.workOrder.requestId).toBeUndefined();
    expect(plan.nextState.requests.ids).toEqual(fresh().requests.ids);
    // History intact: the old item still exists in the next state.
    expect(plan.nextState.serviceItems.byId['si_maple_96']).toMatchObject({ status: 'ended', effectiveTo: '2026-09-14' });
    expect(plan.nextState.serviceItems.ids.length).toBe(fresh().serviceItems.ids.length + 1);

    const next = generateRecurringCharges({ cycleDate: '2026-10-01' }, plan.nextState).filter((c) => c.accountId === 'acct_res_maple');
    expect(next).toHaveLength(3);
    expect(next.some((c) => c.catalogId === 'cat_res_64')).toBe(true);
    expect(next.some((c) => c.catalogId === 'cat_res_96')).toBe(false);
    const line64 = next.find((c) => c.catalogId === 'cat_res_64')!;
    expect(line64.baseCents).toBe(2600 * 3);
    // The quarter drops by 900 cents base before fees and tax.
    expect(8700 - line64.baseCents).toBe(900);
  });

  it('proration none: an item starting mid-period waits for the next cycle; an item ending mid-period is not credited', () => {
    const plan = planServiceChange(
      { siteId: 'site_maple', catalogId: 'cat_res_64', qty: 1, frequency: 'weekly', effectiveFrom: '2026-10-15' },
      fresh(),
    );
    const oct = generateRecurringCharges({ cycleDate: '2026-10-01' }, plan.nextState).filter((c) => c.accountId === 'acct_res_maple');
    expect(oct.some((c) => c.catalogId === 'cat_res_64')).toBe(false);
    const jan = generateRecurringCharges({ cycleDate: '2027-01-01' }, plan.nextState).filter((c) => c.accountId === 'acct_res_maple');
    expect(jan.some((c) => c.catalogId === 'cat_res_64')).toBe(true);
    const ended = planServiceChange(
      { siteId: 'site_maple', replaceItemId: 'si_maple_96', catalogId: 'cat_res_64', qty: 1, frequency: 'weekly', effectiveFrom: '2026-11-15' },
      fresh(),
    );
    const octAfter = generateRecurringCharges({ cycleDate: '2026-10-01' }, ended.nextState).filter((c) => c.accountId === 'acct_res_maple');
    expect(octAfter.find((c) => c.catalogId === 'cat_res_96')?.baseCents).toBe(8700);
  });
});

describe('generateEventCharges', () => {
  const out = generateEventCharges(fresh());

  it('overage of 8400 cents for tk_hale_1 (1.2 tons over at 7000 per ton) and 3850 for tk_hale_2', () => {
    const t1 = out.find((c) => c.source.type === 'scaleTicket' && c.source.id === 'tk_hale_1')!;
    const t2 = out.find((c) => c.source.type === 'scaleTicket' && c.source.id === 'tk_hale_2')!;
    expect(t1.baseCents).toBe(Math.round((8400 / 2000 - 3) * 7000));
    expect(t1.baseCents).toBe(8400);
    expect(t2.baseCents).toBe(Math.round((7100 / 2000 - 3) * 7000));
    expect(t2.baseCents).toBe(3850);
    for (const c of [t1, t2]) {
      expect(c.accountId).toBe('acct_contractor_hale');
      expect(c.lineType).toBe('event');
      expect(c.catalogId).toBe('cat_ro_20yd');
      expect(c.fees).toEqual([{ feeRuleId: 'fee_fuel_7pct', cents: Math.round(c.baseCents * 0.07) }]);
    }
    expect(t1.totalCents).toBe(8400 + 588 + Math.round(8988 * 0.07));
  });

  it('one charge per exception event, priced by exception, keyed on the exception not the outcome', () => {
    const byEvent = (id: string) => out.find((c) => c.source.type === 'serviceEvent' && c.source.id === id);
    expect(byEvent('ev_maple_extrabags')).toMatchObject({ accountId: 'acct_res_maple', baseCents: 250, servicedOn: '2026-09-07' });
    expect(byEvent('ev_res_014_overload')).toMatchObject({ baseCents: 1000 });
    expect(byEvent('ev_bakery_contamination')).toMatchObject({ accountId: 'acct_bakery', baseCents: 2000 });
    expect(byEvent('ev_hale_dryrun')).toMatchObject({ accountId: 'acct_contractor_hale', baseCents: 2500 });
    expect(byEvent('ev_fl_003_dryrun')).toMatchObject({ accountId: 'acct_fl_003', baseCents: 2500 });
    expect(out.filter((c) => c.source.type === 'serviceEvent')).toHaveLength(5);
    // Kerr's skippedSuspended stops have no exception and never charge.
    expect(out.some((c) => c.accountId === 'acct_res_kerr')).toBe(false);
  });

  it('addendum B4: exception rates come from state.eventRates (seed eventRates.json), not an engine constant', () => {
    expect(fresh().eventRates).toEqual({ extraBags: 250, overload: 1000, contamination: 2000, dryRun: 2500 });
    const s: EntityState = { ...fresh(), eventRates: { extraBags: 300, overload: 1200, contamination: 2200, dryRun: 2700 } };
    const repriced = generateEventCharges(s);
    const byEvent = (id: string) => repriced.find((c) => c.source.type === 'serviceEvent' && c.source.id === id)!;
    expect(byEvent('ev_maple_extrabags').baseCents).toBe(300);
    expect(byEvent('ev_res_014_overload').baseCents).toBe(1200);
    expect(byEvent('ev_bakery_contamination').baseCents).toBe(2200);
    expect(byEvent('ev_hale_dryrun').baseCents).toBe(2700);
  });

  it('notOut events produce no charge', () => {
    const s = fresh();
    s.serviceEvents = { byId: { ...s.serviceEvents.byId }, ids: [...s.serviceEvents.ids] };
    s.serviceEvents.byId['ev_test_notout'] = { id: 'ev_test_notout', siteId: 'site_maple', routeId: 'route_mon_res', date: '2026-08-31', outcome: 'missed', exception: 'notOut', driver: 'R. Ortiz' };
    s.serviceEvents.ids.push('ev_test_notout');
    expect(generateEventCharges(s).some((c) => c.source.id === 'ev_test_notout')).toBe(false);
  });

  it('roll-off homeowner box out 34 days: 4 extra days at 700 cents', () => {
    const xd = out.filter((c) => c.accountId === 'acct_ro_homeowner');
    expect(xd).toHaveLength(1);
    expect(xd[0].baseCents).toBe(4 * 700);
    expect(xd[0].evidenceIds).toEqual(['wo_ro_home_deliver']);
    expect(xd[0].servicedOn).toBe(TODAY);
    // Hale's boxes are all under 30 days, so no extra-day lines.
    expect(out.filter((c) => c.accountId === 'acct_contractor_hale' && c.description.startsWith('Extra days'))).toHaveLength(0);
  });

  it('skips sources that already have a charge, and suspended accounts', () => {
    const s = fresh();
    const first = generateEventCharges(s);
    const withCharges: EntityState = { ...s, charges: { byId: { ...s.charges.byId }, ids: [...s.charges.ids] } };
    for (const c of first) { withCharges.charges.byId[c.id] = c; withCharges.charges.ids.push(c.id); }
    expect(generateEventCharges(withCharges)).toHaveLength(0);

    const suspended = fresh();
    suspended.billingAccounts = { ...suspended.billingAccounts, byId: { ...suspended.billingAccounts.byId, acct_contractor_hale: { ...suspended.billingAccounts.byId.acct_contractor_hale, status: 'suspended' } } };
    expect(generateEventCharges(suspended).some((c) => c.accountId === 'acct_contractor_hale')).toBe(false);
  });

  it('invariant 2 holds for every generated charge', () => {
    expectInvariant2(out);
    expectInvariant2(generateRecurringCharges({ cycleDate: '2026-10-01' }, fresh()));
  });
});

describe('nextCycleDate and previewNextRun', () => {
  const state = fresh();

  it('monthly and net30 give the 1st of next month, quarterly the next quarter start, perJob undefined', () => {
    expect(nextCycleDate(state.billingAccounts.byId.acct_bakery, TODAY)).toBe('2026-10-01');
    expect(nextCycleDate(state.billingAccounts.byId.acct_pm_oakridge, TODAY)).toBe('2026-10-01');
    expect(nextCycleDate(state.billingAccounts.byId.acct_res_maple, TODAY)).toBe('2026-10-01');
    expect(nextCycleDate(state.billingAccounts.byId.acct_res_maple, '2026-10-01')).toBe('2027-01-01');
    expect(nextCycleDate(state.billingAccounts.byId.acct_bakery, '2026-12-15')).toBe('2027-01-01');
    expect(nextCycleDate(state.billingAccounts.byId.acct_ro_homeowner, TODAY)).toBeUndefined();
  });

  it('Maple: three recurring lines plus the loose bag event, without touching the store', () => {
    const before = JSON.stringify(entities(useStore.getState()).charges.ids);
    const p = previewNextRun('acct_res_maple', state);
    expect(p.cycleDate).toBe('2026-10-01');
    expect(p.recurring).toHaveLength(3);
    expect(p.events).toHaveLength(1);
    expect(p.proposed).toHaveLength(0);
    const rec = 10261 + 3391 + 4422;
    expect(p.recurring.reduce((s, c) => s + c.totalCents, 0)).toBe(rec);
    expect(p.totalCents).toBe(rec + p.events[0].totalCents);
    expect(JSON.stringify(useStore.getState().charges.ids)).toBe(before);
  });

  it('Kerr: suspended, nothing at all; Hale: two overages and a dry run; roll-off homeowner: no cycle date', () => {
    const kerr = previewNextRun('acct_res_kerr', state);
    expect(kerr.recurring).toHaveLength(0);
    expect(kerr.events).toHaveLength(0);
    expect(kerr.totalCents).toBe(0);
    const hale = previewNextRun('acct_contractor_hale', state);
    expect(hale.recurring).toHaveLength(0);
    expect(hale.events).toHaveLength(3);
    const ro = previewNextRun('acct_ro_homeowner', state);
    expect(ro.cycleDate).toBeUndefined();
    expect(ro.events).toHaveLength(1);
  });

  it('defaults to the live store when no state is passed', () => {
    useStore.getState().resetToSeed();
    expect(previewNextRun('acct_res_maple').recurring).toHaveLength(3);
  });
});

describe('balances', () => {
  const state = fresh();

  it('Maple open balance 8745, all of it past due', () => {
    expect(openBalance('inv_maple_q3', state)).toBe(8745);
    expect(accountBalance('acct_res_maple', state)).toBe(8745);
    expect(pastDue('acct_res_maple', state)).toBe(8745);
  });

  it('Oakridge: three open invoices, all past due, and the check fully unallocated', () => {
    const sum = ['inv_oak_0601', 'inv_oak_0701', 'inv_oak_0801'].reduce((s, id) => s + openBalance(id, state), 0);
    expect(accountBalance('acct_pm_oakridge', state)).toBe(sum);
    expect(pastDue('acct_pm_oakridge', state)).toBe(sum);
    expect(unallocatedCents('payment', 'pay_chk_oakridge', state)).toBe(state.payments.byId.pay_chk_oakridge.cents);
    expect(sum).toBe(state.payments.byId.pay_chk_oakridge.cents);
  });

  it('Bakery: paid in full', () => {
    expect(accountBalance('acct_bakery', state)).toBe(0);
    expect(pastDue('acct_bakery', state)).toBe(0);
  });
});

describe('allocate', () => {
  it('splits one payment across three invoices and leaves them paid in full', () => {
    const state = fresh();
    const ids = ['inv_oak_0601', 'inv_oak_0701', 'inv_oak_0801'];
    const cents = ids.map((id) => openBalance(id, state));
    const rows = allocate({ sourceType: 'payment', sourceId: 'pay_chk_oakridge', invoiceIds: ids, cents }, state);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.invoiceId)).toEqual(ids);
    const after: EntityState = { ...state, paymentAllocations: [...state.paymentAllocations, ...rows] };
    for (const id of ids) expect(openBalance(id, after)).toBe(0);
    expect(accountBalance('acct_pm_oakridge', after)).toBe(0);
    expect(unallocatedCents('payment', 'pay_chk_oakridge', after)).toBe(0);
  });

  it('rejects an over-allocation of the invoice, of the source, and bad shapes', () => {
    const state = fresh();
    const chk = state.payments.byId.pay_chk_oakridge.cents;
    expect(() => allocate({ sourceType: 'payment', sourceId: 'pay_chk_oakridge', invoiceIds: ['inv_oak_0601'], cents: [openBalance('inv_oak_0601', state) + 1] }, state)).toThrow(AllocationError);
    expect(() => allocate({ sourceType: 'payment', sourceId: 'pay_chk_oakridge', invoiceIds: ['inv_oak_0601', 'inv_oak_0601'], cents: [openBalance('inv_oak_0601', state), 1] }, state)).toThrow(AllocationError);
    expect(() => allocate({ sourceType: 'payment', sourceId: 'pay_chk_maple', invoiceIds: ['inv_maple_q3'], cents: [1] }, state)).toThrow(/unallocated/);
    expect(() => allocate({ sourceType: 'payment', sourceId: 'pay_chk_oakridge', invoiceIds: ['inv_oak_0601'], cents: [0] }, state)).toThrow(AllocationError);
    expect(() => allocate({ sourceType: 'payment', sourceId: 'pay_chk_oakridge', invoiceIds: ['inv_oak_0601'], cents: [1, 2] }, state)).toThrow(AllocationError);
    expect(() => allocate({ sourceType: 'payment', sourceId: 'pay_missing', invoiceIds: ['inv_oak_0601'], cents: [1] }, state)).toThrow(/does not exist/);
    expect(() => allocate({ sourceType: 'payment', sourceId: 'pay_chk_oakridge', invoiceIds: ['inv_maple_q3'], cents: [1] }, state)).toThrow(/another account/);
    expect(chk).toBeGreaterThan(0);
  });

  it('several sources on one invoice (invariant 6, many-to-many)', () => {
    useStore.getState().resetToSeed();
    const store = useStore.getState();
    const p1 = store.takePayment({ accountId: 'acct_res_maple', method: 'cash', cents: 3000, allocations: { invoiceIds: ['inv_maple_q3'], cents: [3000] } });
    expect(p1.status).toBe('settled');
    expect(openBalance('inv_maple_q3')).toBe(5745);
    const memo = useStore.getState().issueCreditMemo({ accountId: 'acct_res_maple', cents: 745, reason: 'goodwill', invoiceId: 'inv_maple_q3' });
    expect(openBalance('inv_maple_q3')).toBe(5000);
    const p2 = useStore.getState().takePayment({ accountId: 'acct_res_maple', method: 'card', cents: 5000, processorBatchId: 'ref-1', allocations: { invoiceIds: ['inv_maple_q3'], cents: [5000] } });
    expect(p2.status).toBe('pending');
    expect(p2.processorBatchId).toBe('ref-1');
    expect(openBalance('inv_maple_q3')).toBe(0);
    expect(accountBalance('acct_res_maple')).toBe(0);
    expect(pastDue('acct_res_maple')).toBe(0);
    const sources = useStore.getState().paymentAllocations.filter((a) => a.invoiceId === 'inv_maple_q3').map((a) => a.sourceId);
    expect(sources).toEqual(['pay_chk_maple', p1.id, memo.id, p2.id]);
    useStore.getState().resetToSeed();
  });
});

describe('store actions', () => {
  beforeEach(() => useStore.getState().resetToSeed());

  it('changeServiceItem commits the plan and never deletes the old item', () => {
    const before = useStore.getState().serviceItems.ids.length;
    const requestsBefore = useStore.getState().requests.ids;
    const plan = useStore.getState().changeServiceItem({ siteId: 'site_maple', replaceItemId: 'si_maple_96', catalogId: 'cat_res_64', qty: 1, frequency: 'weekly', effectiveFrom: '2026-09-14' });
    const s = useStore.getState();
    expect(s.serviceItems.ids.length).toBe(before + 1);
    expect(s.serviceItems.byId.si_maple_96).toMatchObject({ status: 'ended', effectiveTo: '2026-09-14' });
    expect(s.serviceItems.byId[plan.newItem.id]).toMatchObject({ catalogId: 'cat_res_64', status: 'active' });
    expect(s.workOrders.byId[plan.workOrder.id]).toMatchObject({ kind: 'swap', status: 'open', scheduledFor: '2026-09-14' });
    // Portal owns Requests: the change writes none, and the phone request lands in the officeNotes sidecar instead.
    expect(s.requests.ids).toEqual(requestsBefore);
    expect(s.officeNotes).toHaveLength(1);
    expect(s.officeNotes[0]).toMatchObject({ kind: 'cartChange', createdVia: 'phone', siteId: 'site_maple', accountId: 'acct_res_maple', workOrderId: plan.workOrder.id, at: TODAY });
    expect(s.officeNotes[0].id).toMatch(/^note_ac_\d{4}$/);
    expect(s.containers.byId[plan.container.id]).toMatchObject({ catalogId: 'cat_res_64', siteId: 'site_maple' });
    const next = generateRecurringCharges({ cycleDate: '2026-10-01' }).filter((c) => c.accountId === 'acct_res_maple');
    expect(next.map((c) => c.catalogId).sort()).toEqual(['cat_res_64', 'cat_res_extra_cart', 'cat_res_recycling']);
    // Adding a line at a site (no replacement) is a deliver.
    const add = useStore.getState().changeServiceItem({ siteId: 'site_bakery', catalogId: 'cat_fl_2yd', qty: 1, frequency: 'weekly', effectiveFrom: '2026-09-16' });
    expect(add.oldItem).toBeUndefined();
    expect(add.workOrder.kind).toBe('deliver');
  });

  it('takePayment writes nothing when the allocation is invalid', () => {
    const before = useStore.getState().payments.ids.length;
    expect(() => useStore.getState().takePayment({ accountId: 'acct_res_maple', method: 'check', cents: 100, allocations: { invoiceIds: ['inv_maple_q3'], cents: [200] } })).toThrow(AllocationError);
    expect(useStore.getState().payments.ids.length).toBe(before);
    expect(useStore.getState().paymentAllocations.length).toBe(seed.paymentAllocations.length);
  });

  it('issueCreditMemo without an invoice stays unapplied on the account', () => {
    const memo = useStore.getState().issueCreditMemo({ accountId: 'acct_res_maple', cents: 500, reason: 'missedPickup', note: 'Missed 2026-08-24' });
    expect(memo).toMatchObject({ by: 'office', at: TODAY, reason: 'missedPickup: Missed 2026-08-24', invoiceId: undefined });
    expect(unallocatedCents('creditMemo', memo.id)).toBe(500);
    expect(accountBalance('acct_res_maple')).toBe(8745);
  });

  it('setAccountStatus suspends Maple: items held, no charges; reinstating brings them back (invariant 4)', () => {
    useStore.getState().setAccountStatus('acct_res_maple', 'suspended');
    let s = useStore.getState();
    expect(s.billingAccounts.byId.acct_res_maple.status).toBe('suspended');
    for (const si of listOf(s.serviceItems).filter((x) => x.siteId === 'site_maple')) {
      expect(si.status).toBe('held');
      expect(si.effectiveFrom).toBe('2025-04-01');
      expect(si.effectiveTo).toBeUndefined();
    }
    expect(generateRecurringCharges({ cycleDate: '2026-10-01' }).some((c) => c.accountId === 'acct_res_maple')).toBe(false);
    expect(generateEventCharges().some((c) => c.accountId === 'acct_res_maple')).toBe(false);
    expect(previewNextRun('acct_res_maple').totalCents).toBe(0);

    useStore.getState().setAccountStatus('acct_res_maple', 'pastDue');
    s = useStore.getState();
    for (const si of listOf(s.serviceItems).filter((x) => x.siteId === 'site_maple')) expect(si.status).toBe('active');
    expect(generateRecurringCharges({ cycleDate: '2026-10-01' }).filter((c) => c.accountId === 'acct_res_maple')).toHaveLength(3);
    expect(generateEventCharges().filter((c) => c.accountId === 'acct_res_maple')).toHaveLength(1);
  });

  it('a hold records a vacationHold office note (no Request) and keeps billing', () => {
    const requestsBefore = useStore.getState().requests.ids;
    useStore.getState().setAccountStatus('acct_res_maple', 'hold', { resumeOn: '2026-09-28', note: 'Visiting family' });
    const s = useStore.getState();
    // Portal owns Requests (shared/OWNERSHIP.md): setAccountStatus writes none.
    expect(s.requests.ids).toEqual(requestsBefore);
    expect(s.officeNotes).toHaveLength(1);
    expect(s.officeNotes[0]).toMatchObject({
      kind: 'vacationHold', accountId: 'acct_res_maple', siteId: 'site_maple', createdVia: 'phone',
      note: 'Vacation hold from 2026-09-10, resume 2026-09-28. Visiting family',
    });
    expect(s.statusChanges.at(-1)).toMatchObject({ kind: 'hold', from: 'pastDue', to: 'hold', effectiveFrom: TODAY, resumeOn: '2026-09-28' });
    expect(generateRecurringCharges({ cycleDate: '2026-10-01' }).filter((c) => c.accountId === 'acct_res_maple')).toHaveLength(3);
  });

  it('postInvoices: one locked invoice per account, due +30 for net30 and +15 otherwise (addendum C9), charges posted', () => {
    const proposed = [...generateRecurringCharges({ cycleDate: '2026-10-01' }), ...generateEventCharges()]
      .filter((c) => c.accountId === 'acct_res_maple' || c.accountId === 'acct_contractor_hale');
    useStore.getState().appendCharges(proposed);
    const invoices = useStore.getState().postInvoices({ chargeIds: proposed.map((c) => c.id) });
    expect(invoices).toHaveLength(2);
    const maple = invoices.find((i) => i.accountId === 'acct_res_maple')!;
    const hale = invoices.find((i) => i.accountId === 'acct_contractor_hale')!;
    expect(maple).toMatchObject({ issuedAt: TODAY, dueAt: '2026-09-25', postedAt: TODAY, locked: true, deliveredVia: 'mail' });
    expect(hale).toMatchObject({ issuedAt: TODAY, dueAt: '2026-10-10', locked: true, deliveredVia: 'email' });
    expect(maple.chargeIds).toHaveLength(4);
    expect(maple.subtotalCents + maple.feeCents + maple.taxCents).toBe(maple.totalCents);
    expect(maple.totalCents).toBe(proposed.filter((c) => c.accountId === 'acct_res_maple').reduce((s, c) => s + c.totalCents, 0));
    expect(maple.number).toBe('PD-2026-0449');
    expect(hale.number).toBe('PD-2026-0450');
    const s = useStore.getState();
    for (const id of proposed.map((c) => c.id)) expect(s.charges.byId[id].status).toBe('posted');
    expect(s.invoices.byId[maple.id]).toBeTruthy();
    expect(openBalance(maple.id)).toBe(maple.totalCents);
    expect(accountBalance('acct_res_maple')).toBe(8745 + maple.totalCents);
    expect(pastDue('acct_res_maple')).toBe(8745);
    // Posting twice is refused.
    expect(() => useStore.getState().postInvoices({ chargeIds: [proposed[0].id] })).toThrow(/already posted/);
    // The next run no longer proposes the lines that were just posted.
    expect(generateRecurringCharges({ cycleDate: '2026-10-01' }).some((c) => c.accountId === 'acct_res_maple')).toBe(false);
  });

  it('postInvoices is pure: it returns invoices without writing, and refuses waived or posted charges', () => {
    const proposed = generateEventCharges().filter((c) => c.accountId === 'acct_contractor_hale');
    useStore.getState().appendCharges(proposed);
    const before = useStore.getState();
    const invoices = postInvoices({ chargeIds: proposed.map((c) => c.id) });
    expect(invoices).toHaveLength(1);
    expect(invoices[0].chargeIds).toEqual(proposed.map((c) => c.id));
    expect(useStore.getState()).toBe(before);
    expect(useStore.getState().charges.byId[proposed[0].id].status).toBe('proposed');
    expect(() => postInvoices({ chargeIds: ['ch_maple_q3_96'] })).toThrow(/already posted/);
    expect(() => postInvoices({ chargeIds: ['ch_missing'] })).toThrow(/not found/);
  });

  it('a posted invoice never changes when a new RateVersion is published (invariant 1)', () => {
    const before = JSON.stringify(useStore.getState().invoices.byId.inv_maple_q3);
    const s = useStore.getState();
    useStore.setState({
      rateVersions: {
        byId: { ...s.rateVersions.byId, rv_res_96_v2: { id: 'rv_res_96_v2', catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 3300, effectiveFrom: '2026-09-01', status: 'published', publishedAt: TODAY, supersedesId: 'rv_res_96_v1' } },
        ids: [...s.rateVersions.ids, 'rv_res_96_v2'],
      },
    });
    expect(resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_maple', onDate: TODAY }).priceCents).toBe(3300);
    expect(JSON.stringify(useStore.getState().invoices.byId.inv_maple_q3)).toBe(before);
    expect(useStore.getState().charges.byId.ch_maple_q3_96.baseCents).toBe(8700);
  });

  it('waiveCharge appends a row and there is no delete action anywhere in the store (invariant 5)', () => {
    const [charge] = generateEventCharges().filter((c) => c.accountId === 'acct_res_maple');
    useStore.getState().appendCharges([charge]);
    const row = useStore.getState().waiveCharge({ chargeId: charge.id, reason: 'goodwill', note: 'first offence' });
    const s = useStore.getState();
    expect(s.waivedCharges.byId[charge.id]).toMatchObject({ ...row, id: charge.id });
    expect(s.charges.byId[charge.id].status).toBe('waived');
    expect(() => useStore.getState().waiveCharge({ chargeId: charge.id, reason: 'immaterial' })).toThrow(/already waived/);
    const actionNames = Object.keys(useStore.getState()).filter((k) => typeof (useStore.getState() as unknown as Record<string, unknown>)[k] === 'function');
    expect(actionNames.some((n) => /delete|remove|drop|clear/i.test(n))).toBe(false);
  });

  it('resetToSeed restores the seed exactly', () => {
    useStore.getState().setAccountStatus('acct_res_maple', 'suspended');
    useStore.getState().resetToSeed();
    expect(useStore.getState().billingAccounts.byId.acct_res_maple.status).toBe('pastDue');
    expect(useStore.getState().serviceItems.byId.si_maple_96.status).toBe('active');
  });
});

describe('addendum C12: runtime ids', () => {
  const seedIds = (): string[] =>
    Object.values(seed).flatMap((rows) => (Array.isArray(rows) ? (rows as { id?: unknown }[]).map((r) => r.id).filter((id): id is string => typeof id === 'string') : []));

  it('highestSeedSuffix reads the trailing number of every seed id with the prefix', () => {
    for (const prefix of ['ch', 'si', 'wo', 'pay', 'cont', 'inv']) {
      const expected = Math.max(0, ...seedIds().filter((id) => id.startsWith(`${prefix}_`)).map((id) => Number(/(\d+)$/.exec(id)?.[1] ?? 0)));
      expect(highestSeedSuffix(prefix), prefix).toBe(expected);
    }
    expect(highestSeedSuffix('cm')).toBe(0);
  });

  it('newId emits the ac infix, counters start above the highest seed suffix, and peekId does not consume', () => {
    for (const prefix of ['si', 'wo', 'pay', 'cm', 'ch']) {
      const peeked = peekId(prefix);
      const id = newId(prefix);
      expect(id).toBe(peeked);
      expect(id).toMatch(new RegExp(`^${prefix}_ac_\\d{4}$`));
      expect(Number(id.slice(-4))).toBeGreaterThan(highestSeedSuffix(prefix));
      expect(seedIds()).not.toContain(id);
      expect(newId(prefix)).not.toBe(id);
    }
  });

  it('no runtime id produced by any engine path or store action contains _new_', () => {
    useStore.getState().resetToSeed();
    const store = useStore.getState();
    const plan = store.changeServiceItem({ siteId: 'site_maple', replaceItemId: 'si_maple_96', catalogId: 'cat_res_64', qty: 1, frequency: 'weekly', effectiveFrom: '2026-09-14' });
    const pay = useStore.getState().takePayment({ accountId: 'acct_res_maple', method: 'check', cents: 100 });
    const memo = useStore.getState().issueCreditMemo({ accountId: 'acct_res_maple', cents: 100, reason: 'goodwill' });
    const charges = [...generateRecurringCharges({ cycleDate: '2026-10-01' }), ...generateEventCharges()];
    const ids = [plan.newItem.id, plan.container.id, plan.workOrder.id, pay.id, memo.id, ...useStore.getState().officeNotes.map((n) => n.id), ...charges.map((c) => c.id)];
    for (const id of ids) {
      expect(id).not.toContain('_new_');
      expect(id).toMatch(/_ac_\d{4}$/);
    }
    useStore.getState().resetToSeed();
  });
});

describe('Phase 4: change a service (invariant 3)', () => {
  beforeEach(() => useStore.getState().resetToSeed());

  it('changeServiceItem on Maple, then the 2026-10-01 run has cat_res_64 and not cat_res_96, and a swap WorkOrder exists for the replacement', () => {
    const plan = useStore.getState().changeServiceItem({ siteId: 'site_maple', replaceItemId: 'si_maple_96', catalogId: 'cat_res_64', qty: 1, frequency: 'weekly', effectiveFrom: '2026-09-14' });
    const run = generateRecurringCharges({ cycleDate: '2026-10-01' }).filter((c) => c.accountId === 'acct_res_maple');
    expect(run.some((c) => c.catalogId === 'cat_res_64')).toBe(true);
    expect(run.some((c) => c.catalogId === 'cat_res_96')).toBe(false);
    const replacement = listOf(useStore.getState().serviceItems).find((si) => si.siteId === 'site_maple' && si.catalogId === 'cat_res_64' && si.status === 'active')!;
    expect(replacement.id).toBe(plan.newItem.id);
    const swap = listOf(useStore.getState().workOrders).find((wo) => wo.kind === 'swap' && wo.serviceItemId === replacement.id);
    expect(swap).toMatchObject({ siteId: 'site_maple', status: 'open', scheduledFor: '2026-09-14', containerId: plan.container.id });
    // The old item is closed, never deleted, and its container is the one the swap pulls.
    expect(useStore.getState().serviceItems.byId.si_maple_96).toMatchObject({ status: 'ended', effectiveTo: '2026-09-14', containerIds: ['cont_maple_96'] });
  });

  it('scenario A numbers: the Oct 1 quarter drops 900 cents base (1031 with fees and tax); the current quarter invoice is untouched', () => {
    const q3Before = JSON.stringify(useStore.getState().invoices.byId.inv_maple_q3);
    const before = previewNextRun('acct_res_maple');
    useStore.getState().changeServiceItem({ siteId: 'site_maple', replaceItemId: 'si_maple_96', catalogId: 'cat_res_64', qty: 1, frequency: 'weekly', effectiveFrom: '2026-09-14' });
    const after = previewNextRun('acct_res_maple');
    const base = (p: typeof before) => p.recurring.reduce((s, c) => s + c.baseCents, 0);
    expect(base(before) - base(after)).toBe(900);
    const line64 = after.recurring.find((c) => c.catalogId === 'cat_res_64')!;
    // 7800 base, fuel 546, env 300, tax round((7800 + 546) * 0.07) = 584, total 9230 against the 96's 10261.
    expect(line64).toMatchObject({ baseCents: 7800, taxCents: 584, totalCents: 9230, period: { start: '2026-10-01', end: '2026-12-31' } });
    expect(before.totalCents - after.totalCents).toBe(1031);
    expect(before.totalCents).toBe(18361);
    expect(after.totalCents).toBe(17330);
    expect(JSON.stringify(useStore.getState().invoices.byId.inv_maple_q3)).toBe(q3Before);
    expect(accountBalance('acct_res_maple')).toBe(8745);
  });

  it('a preview plan peeks ids and writes nothing; confirm then produces the same WorkOrder id', () => {
    const args = { siteId: 'site_maple', replaceItemId: 'si_maple_96', catalogId: 'cat_res_64', qty: 1, frequency: 'weekly' as const, effectiveFrom: '2026-09-14' };
    const before = useStore.getState();
    const preview = planServiceChange(args, entities(before), { preview: true });
    expect(planServiceChange(args, entities(before), { preview: true }).workOrder.id).toBe(preview.workOrder.id);
    expect(useStore.getState()).toBe(before);
    const committed = useStore.getState().changeServiceItem(args);
    expect(committed.workOrder.id).toBe(preview.workOrder.id);
    expect(committed.newItem.id).toBe(preview.newItem.id);
    expect(committed.container.serial).toBe(preview.container.serial);
  });

  it('refuses changes that cannot be billed or dispatched', () => {
    const s = fresh();
    const base = { siteId: 'site_maple', replaceItemId: 'si_maple_96', qty: 1, effectiveFrom: '2026-09-14' };
    expect(() => planServiceChange({ ...base, catalogId: 'cat_res_96', frequency: 'weekly' }, s)).toThrow(/Nothing changes/);
    expect(() => planServiceChange({ ...base, catalogId: 'cat_fl_2yd', frequency: 'weekly' }, s)).toThrow(/residential route/);
    expect(() => planServiceChange({ ...base, catalogId: 'cat_res_64', frequency: '3x' }, s)).toThrow(/No published price/);
    expect(() => planServiceChange({ ...base, catalogId: 'cat_res_64', frequency: 'weekly', effectiveFrom: '2025-04-01' }, s)).toThrow(/after si_maple_96 started/);
    expect(() => planServiceChange({ ...base, catalogId: 'cat_res_64', frequency: 'weekly', qty: 0 }, s)).toThrow(/Quantity/);
  });

  it('marking the WorkOrder scheduled never removes it', () => {
    const plan = useStore.getState().changeServiceItem({ siteId: 'site_maple', replaceItemId: 'si_maple_96', catalogId: 'cat_res_64', qty: 1, frequency: 'weekly', effectiveFrom: '2026-09-14' });
    const count = useStore.getState().workOrders.ids.length;
    useStore.getState().setWorkOrderStatus(plan.workOrder.id, 'scheduled');
    expect(useStore.getState().workOrders.byId[plan.workOrder.id].status).toBe('scheduled');
    expect(useStore.getState().workOrders.ids.length).toBe(count);
  });
});

describe('Phase 5: take a payment and issue a credit (invariant 6)', () => {
  const OAK = ['inv_oak_0601', 'inv_oak_0701', 'inv_oak_0801'];
  beforeEach(() => useStore.getState().resetToSeed());

  it('takePayment then allocate across three invoices leaves each with zero open balance', () => {
    const total = OAK.reduce((s, id) => s + openBalance(id), 0);
    expect(total).toBe(227892);
    const pay = useStore.getState().takePayment({ accountId: 'acct_pm_oakridge', method: 'check', cents: total });
    expect(pay).toMatchObject({ status: 'settled', receivedAt: TODAY });
    expect('processorBatchId' in pay).toBe(false);
    expect(pay.id).toMatch(/^pay_ac_\d{4}$/);
    expect(unallocatedCents('payment', pay.id)).toBe(total);
    const rows = useStore.getState().allocate({ sourceType: 'payment', sourceId: pay.id, invoiceIds: OAK, cents: OAK.map((id) => openBalance(id)) });
    expect(rows).toHaveLength(3);
    for (const id of OAK) expect(openBalance(id)).toBe(0);
    expect(accountBalance('acct_pm_oakridge')).toBe(0);
    expect(pastDue('acct_pm_oakridge')).toBe(0);
    expect(unallocatedCents('payment', pay.id)).toBe(0);
  });

  it('a second payment on an already-paid invoice is rejected and nothing is written', () => {
    useStore.getState().allocate({ sourceType: 'payment', sourceId: 'pay_chk_oakridge', invoiceIds: OAK, cents: [75964, 75964, 75964] });
    expect(openBalance('inv_oak_0601')).toBe(0);
    const before = useStore.getState();
    expect(() =>
      useStore.getState().takePayment({ accountId: 'acct_pm_oakridge', method: 'cash', cents: 1000, allocations: { invoiceIds: ['inv_oak_0601'], cents: [1000] } }),
    ).toThrow(/exceeds its open balance of 0/);
    const after = useStore.getState();
    expect(after.payments).toBe(before.payments);
    expect(after.paymentAllocations).toBe(before.paymentAllocations);
    expect(after.ledgerWrites).toBe(before.ledgerWrites);
    // The same again through the store allocate on a fresh unapplied payment.
    const extra = useStore.getState().takePayment({ accountId: 'acct_pm_oakridge', method: 'cash', cents: 1000 });
    expect(() => useStore.getState().allocate({ sourceType: 'payment', sourceId: extra.id, invoiceIds: ['inv_oak_0701'], cents: [1000] })).toThrow(AllocationError);
    expect(unallocatedCents('payment', extra.id)).toBe(1000);
  });

  it('a creditMemo allocation reduces open balance and shows in accountBalance', () => {
    const balance = accountBalance('acct_pm_oakridge');
    const memo = useStore.getState().issueCreditMemo({ accountId: 'acct_pm_oakridge', cents: 5000, reason: 'missedPickup', note: 'Missed Aug 24', invoiceId: 'inv_oak_0601' });
    expect(memo).toMatchObject({ by: 'office', at: TODAY, invoiceId: 'inv_oak_0601', reason: 'missedPickup: Missed Aug 24' });
    expect(memo.id).toMatch(/^cm_ac_\d{4}$/);
    expect(openBalance('inv_oak_0601')).toBe(75964 - 5000);
    expect(accountBalance('acct_pm_oakridge')).toBe(balance - 5000);
    expect(pastDue('acct_pm_oakridge')).toBe(balance - 5000);
    expect(unallocatedCents('creditMemo', memo.id)).toBe(0);
    const alloc = useStore.getState().paymentAllocations.filter((a) => a.sourceId === memo.id);
    expect(alloc).toEqual([{ sourceType: 'creditMemo', sourceId: memo.id, invoiceId: 'inv_oak_0601', cents: 5000 }]);
    // A credit larger than the invoice's open balance is refused whole.
    const memos = useStore.getState().creditMemos.ids.length;
    expect(() => useStore.getState().issueCreditMemo({ accountId: 'acct_pm_oakridge', cents: 80000, reason: 'goodwill', invoiceId: 'inv_oak_0701' })).toThrow(AllocationError);
    expect(useStore.getState().creditMemos.ids.length).toBe(memos);
  });

  it('scenario B: pay_chk_oakridge allocated across the three Oakridge invoices, balances before and after', () => {
    const s0 = entities(useStore.getState());
    const view0 = buildAccountView('acct_pm_oakridge', useStore.getState())!;
    expect(view0.balance).toBe(227892);
    expect(view0.pastDue).toBe(227892);
    expect(view0.unappliedPaymentCents).toBe(227892);
    expect(view0.sync.quickbooks.state).toBe('inSync');

    const preview = buildExistingAllocationPreview('payment', 'pay_chk_oakridge', autoAllocateOldestFirst(openInvoicesOldestFirst('acct_pm_oakridge', s0), 227892), s0)!;
    expect(preview.rows.map((r) => r.invoice.id)).toEqual(OAK);
    expect(preview.cents).toEqual([75964, 75964, 75964]);
    expect(preview.rows.map((r) => r.openAfter)).toEqual([0, 0, 0]);
    expect(preview).toMatchObject({ error: undefined, remainderCents: 0, balanceBefore: 227892, balanceAfter: 0, pastDueBefore: 227892, pastDueAfter: 0 });
    expect(preview.quickbooksBefore.state).toBe('inSync');
    expect(preview.quickbooksAfter.state).toBe('stale');
    expect(preview.quickbooksAfter.reason).toMatch(/^Payment not yet synced/);
    // The preview wrote nothing.
    expect(useStore.getState().paymentAllocations.length).toBe(seed.paymentAllocations.length);

    useStore.getState().allocate({ sourceType: 'payment', sourceId: 'pay_chk_oakridge', invoiceIds: preview.invoiceIds, cents: preview.cents });
    const view1 = buildAccountView('acct_pm_oakridge', useStore.getState())!;
    expect(view1.balance).toBe(0);
    expect(view1.pastDue).toBe(0);
    expect(view1.openInvoices).toHaveLength(0);
    expect(view1.invoices.filter((v) => OAK.includes(v.invoice.id)).every((v) => v.openCents === 0 && v.paidCents === 75964)).toBe(true);
    expect(view1.unappliedPaymentCents).toBe(0);
    expect(view1.sync.quickbooks.state).toBe('stale');
  });

  it('payment preview: draft id, status by method, card-only reference, per-invoice balances, and nothing written', () => {
    const s0 = entities(useStore.getState());
    const next = peekId('pay');
    const card = buildPaymentPreview({ accountId: 'acct_res_maple', method: 'card', cents: 8745, receivedAt: TODAY, reference: ' auth-771 ' }, { inv_maple_q3: 8745 }, s0);
    expect(card.payment).toMatchObject({ id: next, status: 'pending', processorBatchId: 'auth-771' });
    expect(card).toMatchObject({ balanceBefore: 8745, balanceAfter: 0, pastDueBefore: 8745, pastDueAfter: 0, remainderCents: 0, error: undefined });
    const check = buildPaymentPreview({ accountId: 'acct_res_maple', method: 'check', cents: 10000, receivedAt: TODAY, reference: '4411' }, { inv_maple_q3: 8745 }, s0);
    expect(check.payment.status).toBe('settled');
    expect(check.payment.processorBatchId).toBeUndefined();
    expect(check.remainderCents).toBe(1255);
    expect(buildPaymentPreview({ accountId: 'acct_res_maple', method: 'ach', cents: 100, receivedAt: TODAY }, {}, s0).payment.status).toBe('pending');
    const over = buildPaymentPreview({ accountId: 'acct_res_maple', method: 'cash', cents: 100, receivedAt: TODAY }, { inv_maple_q3: 200 }, s0);
    expect(over.error).toMatch(/only \$1\.00 is available/);
    expect(over.balanceAfter).toBe(8745);
    expect(peekId('pay')).toBe(next);
    expect(useStore.getState().payments.ids.length).toBe(seed.payments.length);
    // Confirm writes the id the preview showed.
    expect(useStore.getState().takePayment({ accountId: 'acct_res_maple', method: 'card', cents: 8745, processorBatchId: 'auth-771', allocations: { invoiceIds: card.invoiceIds, cents: card.cents } }).id).toBe(next);
    expect(openBalance('inv_maple_q3')).toBe(0);
  });

  it('credit preview: unapplied on account by default, or the invoice before and after; over-balance is an error', () => {
    const s0 = entities(useStore.getState());
    const loose = buildCreditPreview({ accountId: 'acct_res_maple', cents: 500, reason: 'goodwill' }, s0);
    expect(loose).toMatchObject({ invoice: undefined, unappliedCreditBefore: 0, unappliedCreditAfter: 500, balanceAfter: 8745, error: undefined });
    expect(loose.memo).toMatchObject({ id: peekId('cm'), by: 'office', at: TODAY, reason: 'goodwill' });
    expect(loose.quickbooksAfter.reason).toMatch(/^Credit not yet synced/);
    const applied = buildCreditPreview({ accountId: 'acct_res_maple', cents: 745, reason: 'billingError', note: 'Fuel double counted', invoiceId: 'inv_maple_q3' }, s0);
    expect(applied).toMatchObject({ openBefore: 8745, openAfter: 8000, balanceAfter: 8000, pastDueAfter: 8000, unappliedCreditAfter: 0 });
    expect(applied.memo.reason).toBe('billingError: Fuel double counted');
    expect(buildCreditPreview({ accountId: 'acct_res_maple', cents: 9000, reason: 'goodwill', invoiceId: 'inv_maple_q3' }, s0).error).toMatch(/Lower the amount/);
  });

  it('header view: unapplied credits, and the QuickBooks chip goes stale after any money write', () => {
    useStore.getState().issueCreditMemo({ accountId: 'acct_res_maple', cents: 500, reason: 'goodwill' });
    const view = buildAccountView('acct_res_maple', useStore.getState())!;
    expect(view.unappliedCreditCents).toBe(500);
    expect(view.unappliedCredits).toHaveLength(1);
    expect(view.sync.quickbooks.state).toBe('stale');
    useStore.getState().resetToSeed();
    expect(useStore.getState().ledgerWrites).toEqual([]);
  });

  it('parseDollars and auto-allocate', () => {
    expect(parseDollars('2,278.92')).toBe(227892);
    expect(parseDollars('$20')).toBe(2000);
    expect(parseDollars('.5')).toBe(50);
    expect(parseDollars('0.07')).toBe(7);
    expect(parseDollars('759.645')).toBeUndefined();
    expect(parseDollars('abc')).toBeUndefined();
    expect(parseDollars('')).toBeUndefined();
    expect(parseDollars('-5')).toBeUndefined();
    const open = openInvoicesOldestFirst('acct_pm_oakridge', entities(useStore.getState()));
    expect(autoAllocateOldestFirst(open, 100000)).toEqual({ inv_oak_0601: 75964, inv_oak_0701: 24036, inv_oak_0801: 0 });
  });
});

describe('Phase 6: hold or suspension with route stub (invariant 4)', () => {
  beforeEach(() => useStore.getState().resetToSeed());
  const mapleRecurring = () => generateRecurringCharges({ cycleDate: '2026-10-01' }).filter((c) => c.accountId === 'acct_res_maple');
  const mapleEvents = () => generateEventCharges().filter((c) => c.accountId === 'acct_res_maple');

  it('suspending Maple leaves generateRecurringCharges and generateEventCharges empty for Maple; reinstating brings them back', () => {
    expect(mapleRecurring()).toHaveLength(3);
    expect(mapleEvents()).toHaveLength(1);

    useStore.getState().setAccountStatus('acct_res_maple', 'suspended', { reason: 'nonPayment' });
    let s = useStore.getState();
    expect(s.billingAccounts.byId.acct_res_maple.status).toBe('suspended');
    for (const id of ['si_maple_96', 'si_maple_extra', 'si_maple_recycling']) {
      expect(s.serviceItems.byId[id]).toMatchObject({ status: 'held', effectiveFrom: '2025-04-01' });
      expect(s.serviceItems.byId[id].effectiveTo).toBeUndefined();
    }
    expect(mapleRecurring()).toEqual([]);
    expect(mapleEvents()).toEqual([]);
    expect(s.statusChanges.at(-1)).toMatchObject({ kind: 'suspend', reason: 'nonPayment', from: 'pastDue', to: 'suspended' });

    const { account, fee } = useStore.getState().reinstateAccount('acct_res_maple');
    s = useStore.getState();
    // Past due 8745 is still owed, so reinstatement lands on pastDue, not active.
    expect(account.status).toBe('pastDue');
    for (const id of ['si_maple_96', 'si_maple_extra', 'si_maple_recycling']) expect(s.serviceItems.byId[id].status).toBe('active');
    expect(mapleRecurring().map((c) => c.catalogId).sort()).toEqual(['cat_res_96', 'cat_res_extra_cart', 'cat_res_recycling']);
    expect(mapleEvents()).toHaveLength(1);
    expect(fee).toBeDefined();
  });

  it('reinstating a suspension proposes the $25 fee through computeCharge into the sidecar, not the Charge table', () => {
    useStore.getState().setAccountStatus('acct_res_maple', 'suspended', { reason: 'nonPayment' });
    const chargesBefore = useStore.getState().charges;
    const { fee, statusChange } = useStore.getState().reinstateAccount('acct_res_maple');
    const s = useStore.getState();
    expect(fee).toMatchObject({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'fee', status: 'proposed', baseCents: 2500,
      source: { type: 'manual', id: statusChange.id }, servicedOn: TODAY, pricing: { ruleWon: 'manualException' },
    });
    // No fee rule applies to fee lines; tax_open (7%) does: 2500 + 175.
    expect(fee!.fees).toEqual([]);
    expect(fee!.taxCents).toBe(175);
    expect(fee!.totalCents).toBe(2675);
    expect(s.charges).toBe(chargesBefore);
    expect(s.proposedCharges).toEqual([fee]);
    const view = buildAccountView('acct_res_maple', s)!;
    expect(view.nextInvoice.officeProposed).toEqual([fee]);
    expect(view.nextInvoice.estimateCents).toBe(view.nextInvoice.preview.totalCents + 2675);
    expect(view.sync.billing.state).toBe('stale');
    expect(view.sync.billing.reason).toContain(fee!.id);
  });

  it('a hold resumes to active items with no fee and billing never stopped', () => {
    useStore.getState().setAccountStatus('acct_res_maple', 'hold', { resumeOn: '2026-09-28' });
    const { account, fee, statusChange } = useStore.getState().reinstateAccount('acct_res_maple');
    expect(account.status).toBe('pastDue');
    expect(fee).toBeUndefined();
    expect(statusChange.kind).toBe('resume');
    expect(useStore.getState().proposedCharges).toEqual([]);
  });

  it('Kerr: route stub lists the two recorded Tuesday skips and four projected skips; reinstating flips them to completed', () => {
    const state = entities(useStore.getState());
    const [stub] = buildRouteStub('acct_res_kerr', undefined, state);
    expect(stub.route?.id).toBe('route_tue_res');
    expect(stub.otherStops).toBe(16);
    expect(stub.stops.map((x) => [x.date, x.kind, x.now])).toEqual([
      ['2026-09-01', 'recorded', 'skippedSuspended'],
      ['2026-09-08', 'recorded', 'skippedSuspended'],
      ['2026-09-15', 'projected', 'skippedSuspended'],
      ['2026-09-22', 'projected', 'skippedSuspended'],
      ['2026-09-29', 'projected', 'skippedSuspended'],
      ['2026-10-06', 'projected', 'skippedSuspended'],
    ]);
    const preview = buildHoldPreview({ accountId: 'acct_res_kerr', mode: 'reinstate', effectiveFrom: TODAY }, state);
    expect(preview.error).toBeUndefined();
    expect(preview.statusAfter).toBe('pastDue');
    expect(preview.routeStub[0].stops.filter((x) => x.kind === 'projected').every((x) => x.after === 'completed')).toBe(true);
    expect(preview.routeStub[0].stops.filter((x) => x.kind === 'recorded').every((x) => x.after === 'skippedSuspended')).toBe(true);
    expect(preview.nextRunBeforeCents).toBe(0);
    expect(preview.fee?.totalCents).toBe(2675);
    expect(preview.billingBefore.state).toBe('inSync');
    expect(preview.billingAfter.state).toBe('stale');
    // Kerr's quarterly 96 gal (10261) comes back on the Oct 1 run, plus the fee.
    expect(preview.nextRunAfterCents).toBe(10261 + 2675);

    // Reinstate, then suspend again: the live stub flips back.
    useStore.getState().reinstateAccount('acct_res_kerr');
    const live = entities(useStore.getState());
    expect(buildRouteStub('acct_res_kerr', undefined, live)[0].stops.filter((x) => x.kind === 'projected').every((x) => x.now === 'completed')).toBe(true);
    const suspend = buildHoldPreview({ accountId: 'acct_res_kerr', mode: 'suspend', effectiveFrom: TODAY, reason: 'nonPayment' }, live, useStore.getState());
    expect(suspend.routeStub[0].stops.filter((x) => x.kind === 'projected').map((x) => [x.now, x.after])).toEqual(
      Array(4).fill(['completed', 'skippedSuspended']),
    );
    // The suspend preview reads zero even though the fee from the reinstatement is still waiting in the sidecar.
    expect(suspend.nextRunAfterCents).toBe(0);
    useStore.getState().setAccountStatus('acct_res_kerr', 'suspended', { reason: 'nonPayment' });
    const kerr = buildAccountView('acct_res_kerr', useStore.getState())!;
    expect(kerr.nextInvoice.preview.totalCents).toBe(0);
    expect(kerr.nextInvoice.estimateCents).toBe(0);
    expect(kerr.nextInvoice.officeProposed).toHaveLength(1);
    expect(kerr.sync.billing.state).toBe('stale');
  });

  it('suspension preview: next run goes to zero and the fee is noted, not charged; hold preview leaves the next invoice unchanged', () => {
    const state = entities(useStore.getState());
    const suspend = buildHoldPreview({ accountId: 'acct_res_maple', mode: 'suspend', effectiveFrom: TODAY, reason: 'nonPayment' }, state);
    expect(suspend.nextRunBeforeCents).toBe(previewNextRun('acct_res_maple', state).totalCents);
    expect(suspend.nextRunBeforeCents).toBeGreaterThan(0);
    expect(suspend.nextRunAfterCents).toBe(0);
    expect(suspend.reinstatementFeeCents).toBe(2500);
    expect(suspend.fee).toBeUndefined();
    expect(suspend.items.map((i) => [i.item.id, i.before, i.after])).toEqual([
      ['si_maple_96', 'active', 'held'], ['si_maple_extra', 'active', 'held'], ['si_maple_recycling', 'active', 'held'],
    ]);
    // Maple is on the Monday route: next four Mondays from TODAY flip to skippedSuspended.
    expect(suspend.routeStub[0].stops.filter((x) => x.kind === 'projected').map((x) => [x.date, x.now, x.after])).toEqual([
      ['2026-09-14', 'completed', 'skippedSuspended'],
      ['2026-09-21', 'completed', 'skippedSuspended'],
      ['2026-09-28', 'completed', 'skippedSuspended'],
      ['2026-10-05', 'completed', 'skippedSuspended'],
    ]);

    const hold = buildHoldPreview({ accountId: 'acct_res_maple', mode: 'hold', effectiveFrom: TODAY, resumeOn: '2026-09-28' }, state);
    expect(hold.nextRunAfterCents).toBe(hold.nextRunBeforeCents);
    // Stops before the resume date skip for the hold; the resume date and after run again.
    expect(hold.routeStub[0].stops.filter((x) => x.kind === 'projected').map((x) => x.after)).toEqual(['skippedHold', 'skippedHold', 'completed', 'completed']);
    expect(buildHoldPreview({ accountId: 'acct_res_maple', mode: 'hold', effectiveFrom: TODAY }, state).error).toMatch(/resume date/);
    expect(buildHoldPreview({ accountId: 'acct_res_maple', mode: 'suspend', effectiveFrom: '2026-09-01', reason: 'nonPayment' }, state).error).toMatch(/before today/);
    // Previews write nothing.
    expect(useStore.getState().billingAccounts.byId.acct_res_maple.status).toBe('pastDue');
  });
});
