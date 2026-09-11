// Phase 4 request flows: extra pickup eligibility, the hold policy check, and cart change service item dating.

import { beforeEach, describe, expect, it } from 'vitest';
import { createPortalStore } from './useStore';
import { bindTables, checkHoldPolicy, computeCharge, HOLD_POLICY } from './engine';
import { eventRates } from '../seed';
import { extraPickupEligibility, routeCapacityOn, holdsForSite, holdableServiceItems, pendingChangesForSite } from './selectors';
import { resetIds } from './ids';
import { TODAY } from './clock';
import { handoff, handoffSentence } from '../lib/handoff';

let store: ReturnType<typeof createPortalStore>;

beforeEach(() => {
  resetIds();
  store = createPortalStore();
  bindTables(() => store.getState());
});

describe('extra pickup eligibility', () => {
  it('passes all three checks for Maple and names Monday, Sep 14', () => {
    const e = extraPickupEligibility(store.getState(), 'acct_res_maple', 'site_maple', TODAY);
    expect(e.ok).toBe(true);
    expect(e.checks.map((c) => c.id)).toEqual(['accountStatus', 'routeCapacity', 'activeService']);
    expect(e.checks.every((c) => c.ok)).toBe(true);
    expect(e.nextRouteDay).toBe('2026-09-14');
    expect(e.checks[0].detail).toMatch(/Past due balances do not block/);
    expect(e.checks[1].detail).toMatch(/8 open stops on Monday, Sep 14/);
    expect(e.serviceItem?.id).toBe('si_maple_96');
  });

  it('fails the account check for suspended Kerr with the exact reason', () => {
    const e = extraPickupEligibility(store.getState(), 'acct_res_kerr', 'site_kerr', TODAY);
    expect(e.ok).toBe(false);
    expect(e.checks[0]).toMatchObject({ id: 'accountStatus', ok: false, detail: 'Account is suspended' });
    expect(e.reason).toBe('Account is suspended');
    // The other checks still run so the customer sees the whole picture.
    expect(e.checks).toHaveLength(3);
  });

  it('fails the capacity check when the route is full on the next route day', () => {
    const s = store.getState();
    const full = s.routes.map((r) => (r.id === 'route_mon_res' ? { ...r, capacityStops: r.stopSiteIds.length } : r));
    store.setState({ routes: full });
    expect(routeCapacityOn(store.getState(), 'route_mon_res', '2026-09-14')).toBe(0);
    const e = extraPickupEligibility(store.getState(), 'acct_res_maple', 'site_maple', TODAY);
    expect(e.ok).toBe(false);
    expect(e.checks[0].ok).toBe(true);
    expect(e.checks[1]).toMatchObject({ id: 'routeCapacity', ok: false, detail: 'Route is full on Monday, Sep 14' });
    expect(e.reason).toBe('Route is full on Monday, Sep 14');
  });

  it('a scheduled extraPickup work order consumes one stop of capacity', () => {
    const before = routeCapacityOn(store.getState(), 'route_mon_res', '2026-09-14');
    store.getState().addWorkOrder({ siteId: 'site_maple', kind: 'extraPickup', status: 'scheduled', scheduledFor: '2026-09-14' });
    expect(routeCapacityOn(store.getState(), 'route_mon_res', '2026-09-14')).toBe(before - 1);
  });

  it('fails the service check for a site with no active service (Holt, on hold)', () => {
    const e = extraPickupEligibility(store.getState(), 'acct_res_holt', 'site_holt', TODAY);
    expect(e.checks[0]).toMatchObject({ ok: false, detail: 'Account is on hold' });
    expect(e.checks[2]).toMatchObject({ id: 'activeService', ok: false, detail: 'No active service at this site' });
  });
});

describe('extra pickup booking', () => {
  it('writes an approved charge, a settled unallocated payment, a scheduled request, and a work order', () => {
    const s = store.getState();
    // Addendum D5: base from eventRates.json, lineType event, source manual, no catalogId.
    expect(eventRates.extraPickup).toBe(2500);
    const charge = computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'event',
      baseCents: eventRates.extraPickup, servicedOn: '2026-09-14', source: { type: 'manual', id: 'eventRates.extraPickup' },
    });
    expect(charge.catalogId).toBeUndefined();
    expect(charge.source).toEqual({ type: 'manual', id: 'eventRates.extraPickup' });
    // 2500 base, 7% fuel 175, no env fee on event lines, 7% tax on 2675 = 187, total 2862
    expect(charge.baseCents).toBe(2500);
    expect(charge.fees).toEqual([{ feeRuleId: 'fee_fuel_7pct', cents: 175 }]);
    expect(charge.taxCents).toBe(187);
    expect(charge.totalCents).toBe(2862);

    const r = s.bookExtraPickup({ accountId: 'acct_res_maple', siteId: 'site_maple', charge, method: 'card', scheduledFor: '2026-09-14', serviceItemId: 'si_maple_96' });
    const live = store.getState();
    expect(live.charges.find((c) => c.id === r.charge.id)).toMatchObject({ status: 'approved', lineType: 'event', source: { type: 'manual' } });
    expect(r.payment).toMatchObject({ accountId: 'acct_res_maple', method: 'card', cents: 2862, status: 'settled' });
    expect(live.allocations.filter((a) => a.sourceId === r.payment.id)).toHaveLength(0);
    expect(r.request).toMatchObject({ kind: 'extraPickup', status: 'scheduled', workOrderId: r.workOrder.id });
    expect(r.workOrder).toMatchObject({ kind: 'extraPickup', status: 'scheduled', scheduledFor: '2026-09-14', requestId: r.request.id, serviceItemId: 'si_maple_96' });
    expect(live.log.map((l) => l.action)).toEqual(['addCharge', 'addPayment', 'addRequest', 'addWorkOrder', 'updateRequest']);
  });
});

describe('hold policy check', () => {
  it('accepts a 14 day hold starting tomorrow or later', () => {
    expect(checkHoldPolicy('2026-09-14', '2026-09-28', TODAY)).toEqual({ ok: true, days: 14 });
    expect(checkHoldPolicy('2026-09-11', '2026-09-18', TODAY)).toEqual({ ok: true, days: 7 });
    expect(checkHoldPolicy('2026-09-11', '2026-12-10', TODAY)).toEqual({ ok: true, days: 90 });
  });

  it('rejects a hold shorter than the minimum', () => {
    const c = checkHoldPolicy('2026-09-14', '2026-09-18', TODAY);
    expect(c.ok).toBe(false);
    expect(c.days).toBe(4);
    expect(c.reason).toBe(`This hold is 4 days, shorter than the ${HOLD_POLICY.minDays} day minimum`);
  });

  it('rejects a hold longer than the maximum', () => {
    const c = checkHoldPolicy('2026-09-11', '2026-12-11', TODAY);
    expect(c.ok).toBe(false);
    expect(c.days).toBe(91);
    expect(c.reason).toBe(`This hold is 91 days, longer than the ${HOLD_POLICY.maxDays} day maximum`);
  });

  it('rejects a start before tomorrow and an end that is not after the start', () => {
    expect(checkHoldPolicy('2026-09-10', '2026-09-24', TODAY).reason).toBe('The hold must start on or after 2026-09-11');
    expect(checkHoldPolicy('2026-09-14', '2026-09-14', TODAY).reason).toBe('The hold must end after it starts');
    expect(checkHoldPolicy('2026-09-14', '2026-09-12', TODAY).reason).toBe('The hold must end after it starts');
  });

  it('placeHold writes only portal-local holds and a scheduled request; the ServiceItem hold is a stub', () => {
    const before = store.getState();
    const itemsBefore = before.serviceItems.filter((i) => i.siteId === 'site_maple');
    const r = before.placeHold({ accountId: 'acct_res_maple', siteId: 'site_maple', start: '2026-09-14', end: '2026-09-28' });
    const live = store.getState();
    expect(r.holds).toHaveLength(3);
    expect(holdsForSite(live, 'site_maple').map((h) => [h.start, h.end])).toEqual([['2026-09-14', '2026-09-28'], ['2026-09-14', '2026-09-28'], ['2026-09-14', '2026-09-28']]);
    expect(r.request).toMatchObject({ kind: 'vacationHold', status: 'scheduled', note: 'Vacation hold 2026-09-14 to 2026-09-28, pickups resume 2026-10-05' });
    // OWNERSHIP.md: account owns ServiceItem and account status. The portal leaves both untouched.
    expect(live.serviceItems.filter((i) => i.siteId === 'site_maple')).toEqual(itemsBefore);
    expect(live.accounts.find((a) => a.id === 'acct_res_maple')?.status).toBe('pastDue');
    expect(live.log.map((l) => l.action)).toEqual(['addHold', 'addHold', 'addHold', 'stub:requestServiceItemHold', 'addRequest']);
    // The held items can not be held again while the range is running or ahead.
    expect(holdableServiceItems(live, 'site_maple', TODAY)).toHaveLength(0);
    expect(() => live.placeHold({ accountId: 'acct_res_maple', siteId: 'site_maple', start: '2026-10-01', end: '2026-10-20' })).toThrow(/No active service/);
  });

  it('placeHold refuses an out of policy range and writes nothing', () => {
    expect(() => store.getState().placeHold({ accountId: 'acct_res_maple', siteId: 'site_maple', start: '2026-09-14', end: '2026-09-16' })).toThrow(/shorter than/);
    expect(store.getState().holds).toHaveLength(0);
    expect(store.getState().log).toHaveLength(0);
  });
});

describe('cart change', () => {
  it('writes a scheduled request, a swap work order on the next route day, and a pending change effective 2026-10-01', () => {
    const before = store.getState();
    const itemsBefore = before.serviceItems;
    const r = before.changeCart({ accountId: 'acct_res_maple', siteId: 'site_maple', serviceItemId: 'si_maple_96', toCatalogId: 'cat_res_64' });
    expect(r.pendingChange).toMatchObject({
      serviceItemId: 'si_maple_96', fromCatalogId: 'cat_res_96', toCatalogId: 'cat_res_64', effectiveFrom: '2026-10-01',
      requestId: r.request.id, workOrderId: r.workOrder.id,
    });
    expect(r.workOrder).toMatchObject({ kind: 'swap', status: 'scheduled', scheduledFor: '2026-09-14', serviceItemId: 'si_maple_96', containerId: 'cont_1001', requestId: r.request.id });
    expect(r.request).toMatchObject({ kind: 'cartChange', status: 'scheduled', workOrderId: r.workOrder.id });
    expect(r.request.note).toContain('effective 2026-10-01');

    const live = store.getState();
    // OWNERSHIP.md: the portal never ends or adds a ServiceItem; proposeCartChange is the stub.
    expect(live.serviceItems).toBe(itemsBefore);
    expect(pendingChangesForSite(live, 'site_maple').map((p) => p.id)).toEqual([r.pendingChange.id]);
    expect(live.log.map((l) => l.action)).toEqual(['addRequest', 'addWorkOrder', 'updateRequest', 'stub:proposeCartChange']);
  });

  it('dates a monthly account to the first of next month', () => {
    // Holt is monthly and its cart is held; activate it to exercise the monthly path.
    store.getState().updateServiceItem('si_holt_96', { status: 'active' });
    const r = store.getState().changeCart({ accountId: 'acct_res_holt', siteId: 'site_holt', serviceItemId: 'si_holt_96', toCatalogId: 'cat_res_64' });
    expect(r.pendingChange.effectiveFrom).toBe('2026-10-01');
  });

  it('refuses the same size, a non-active item, or a second change on the same cart', () => {
    expect(() => store.getState().changeCart({ accountId: 'acct_res_maple', siteId: 'site_maple', serviceItemId: 'si_maple_96', toCatalogId: 'cat_res_96' })).toThrow(/already the current/);
    expect(() => store.getState().changeCart({ accountId: 'acct_res_holt', siteId: 'site_holt', serviceItemId: 'si_holt_96', toCatalogId: 'cat_res_64' })).toThrow(/Only an active/);
    store.getState().changeCart({ accountId: 'acct_res_maple', siteId: 'site_maple', serviceItemId: 'si_maple_96', toCatalogId: 'cat_res_64' });
    expect(() => store.getState().changeCart({ accountId: 'acct_res_maple', siteId: 'site_maple', serviceItemId: 'si_maple_96', toCatalogId: 'cat_res_64' })).toThrow(/pending change/);
  });
});

describe('handoff', () => {
  it('promises the next business day at 10:00 am', () => {
    const h = handoff('Account is suspended');
    expect(h).toEqual({ reason: 'Account is suspended', followUpBy: '2026-09-11T10:00:00' });
    expect(handoffSentence(h)).toBe('We could not finish this automatically. Reason: Account is suspended. A person will follow up by Friday, Sep 11, 10:00 am.');
    // A Friday request rolls to Monday.
    expect(handoff('x', '2026-09-11').followUpBy).toBe('2026-09-14T10:00:00');
  });
});
