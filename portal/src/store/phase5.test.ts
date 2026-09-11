// Phase 5 request flows: missed pickup lookup and recovery, the commercial quote stub, the picker rules, and one
// path per Request kind that lands in the open items list.

import { beforeEach, describe, expect, it } from 'vitest';
import { createPortalStore } from './useStore';
import { bindTables, computeCharge, missedPickupWindow } from './engine';
import { eventRates } from '../seed';
import {
  accountHasResidentialCart, defaultMissedPickupDate, frontloadSizes, missedPickupLookup, quoteCatalogFor, requestsForAccount,
} from './selectors';
import { resetIds } from './ids';
import { TODAY } from './clock';

let store: ReturnType<typeof createPortalStore>;

beforeEach(() => {
  resetIds();
  store = createPortalStore();
  bindTables(() => store.getState());
});

describe('missed pickup lookup', () => {
  it('limits the window to the last 21 days and defaults to the most recent route day', () => {
    expect(missedPickupWindow(TODAY)).toEqual({ min: '2026-08-20', max: '2026-09-10' });
    expect(defaultMissedPickupDate(store.getState(), 'site_maple', TODAY)).toBe('2026-09-07');
    expect(defaultMissedPickupDate(store.getState(), 'site_oak_2', TODAY)).toBe('2026-09-09');
    expect(missedPickupLookup(store.getState(), 'site_maple', '2026-08-17', TODAY).kind).toBe('outOfWindow');
    // The seeded 2026-08-24 missed event is inside the 21 day window (DECISIONS.md entry 47).
    expect(missedPickupLookup(store.getState(), 'site_maple', '2026-08-24', TODAY).kind).toBe('missed');
  });

  it('shows the blocked event on 2026-09-07 and writes nothing', () => {
    const before = store.getState().log.length;
    const l = missedPickupLookup(store.getState(), 'site_maple', '2026-09-07', TODAY);
    expect(l.kind).toBe('notReachable');
    if (l.kind !== 'notReachable') throw new Error('unreachable');
    expect(l.event.note).toMatch(/parked vehicle/);
    expect(l.event.photoUrl).toBe('photos/blocked-driveway.svg');
    expect(store.getState().log.length).toBe(before);
    expect(() => store.getState().reportMissedPickup({ accountId: 'acct_res_maple', siteId: 'site_maple', date: '2026-09-07' })).toThrow();
    expect(store.getState().workOrders.some((w) => w.kind === 'recovery')).toBe(false);
  });

  it('treats a completed stop as completed with its time and driver', () => {
    const l = missedPickupLookup(store.getState(), 'site_maple', '2026-08-31', TODAY);
    expect(l.kind).toBe('completed');
    if (l.kind === 'completed') expect(l.event).toMatchObject({ driver: 'R. Alvarez', date: '2026-08-31T07:42:00' });
  });

  it('treats a notOut exception like blocked even when the outcome says completed', () => {
    const s = store.getState();
    store.setState({ serviceEvents: s.serviceEvents.map((e) => (e.id === 'ev_0003' ? { ...e, exception: 'notOut' as const } : e)) });
    expect(missedPickupLookup(store.getState(), 'site_maple', '2026-08-31', TODAY).kind).toBe('notReachable');
  });

  it('hands off a suspended stop and a day with no record', () => {
    const kerr = missedPickupLookup(store.getState(), 'site_kerr', '2026-09-08', TODAY);
    expect(kerr).toMatchObject({ kind: 'handoff', reason: 'Service was suspended on 2026-09-08' });
    // Every seeded route day in the window has an event, so drop Bldg B's 2026-09-09 stop to get a day with no record.
    store.setState({ serviceEvents: store.getState().serviceEvents.filter((e) => e.id !== 'ev_0021') });
    const none = missedPickupLookup(store.getState(), 'site_oak_2', '2026-09-09', TODAY);
    expect(none).toMatchObject({ kind: 'handoff', reason: 'No route record for 2026-09-09' });
    expect(missedPickupLookup(store.getState(), 'site_oak_1', '2026-08-19', TODAY).kind).toBe('outOfWindow');
  });

  it('says a non route day is not one and offers the nearest route day in the window', () => {
    const thu = missedPickupLookup(store.getState(), 'site_maple', '2026-09-10', TODAY);
    expect(thu).toMatchObject({ kind: 'notRouteDay', nearest: '2026-09-07' });
    // Saturday Aug 29: Monday Aug 31 (2 days) is nearer than Monday Aug 24 (5 days).
    expect(missedPickupLookup(store.getState(), 'site_maple', '2026-08-29', TODAY)).toMatchObject({ kind: 'notRouteDay', nearest: '2026-08-31' });
    // Thursday Aug 20 for a Wednesday route: Aug 19 is outside the window, so Aug 26 (6 days ahead) is offered.
    expect(missedPickupLookup(store.getState(), 'site_oak_1', '2026-08-20', TODAY)).toMatchObject({ kind: 'notRouteDay', nearest: '2026-08-26' });
    // Thursday Aug 27: Aug 26 (1 day back) is nearer than Sep 2.
    expect(missedPickupLookup(store.getState(), 'site_oak_1', '2026-08-27', TODAY)).toMatchObject({ kind: 'notRouteDay', nearest: '2026-08-26' });
  });

  it('books a recovery work order the next business day for a missed event and refuses a second report', () => {
    // The seeded 2026-08-24 missed event is reachable on seed data now that the window is 21 days.
    const l = missedPickupLookup(store.getState(), 'site_maple', '2026-08-24', TODAY);
    expect(l).toMatchObject({ kind: 'missed', recoveryOn: '2026-09-11' });
    const { workOrder, request } = store.getState().reportMissedPickup({ accountId: 'acct_res_maple', siteId: 'site_maple', date: '2026-08-24' });
    expect(workOrder).toMatchObject({ kind: 'recovery', status: 'scheduled', scheduledFor: '2026-09-11', requestId: request.id, siteId: 'site_maple' });
    expect(request).toMatchObject({ kind: 'missedPickup', status: 'scheduled', workOrderId: workOrder.id });
    expect(request.note).toContain('2026-08-24');
    expect(missedPickupLookup(store.getState(), 'site_maple', '2026-08-24', TODAY).existing?.id).toBe(request.id);
    expect(() => store.getState().reportMissedPickup({ accountId: 'acct_res_maple', siteId: 'site_maple', date: '2026-08-24' })).toThrow(/Already reported/);
    const actions = store.getState().log.map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['addRequest', 'addWorkOrder', 'updateRequest']));
  });
});

describe('commercial quote request', () => {
  it('maps size and material onto the frontload catalog', () => {
    const cat = store.getState().catalog;
    expect(frontloadSizes(cat)).toEqual(['2 yd', '3 yd']);
    expect(quoteCatalogFor(cat, '3 yd', 'wood waste')?.id).toBe('cat_fl_3yd_wood');
    expect(quoteCatalogFor(cat, '3 yd', 'cardboard')?.id).toBe('cat_fl_3yd');
    expect(quoteCatalogFor(cat, '2 yd', 'wood waste')?.id).toBe('cat_fl_2yd');
  });

  it('stubs the Quote into quoteRequests and files an open quote Request naming the quote id', () => {
    const quotesBefore = store.getState().quotes.length;
    const { quoteRequest, request } = store.getState().requestQuote({
      accountId: 'acct_pm_oakridge', siteId: 'site_oak_2', catalogId: 'cat_fl_2yd', qty: 1, frequency: '2x', material: 'cardboard', accessNotes: ' Gate code 4411 ',
    });
    expect(store.getState().quotes.length).toBe(quotesBefore);
    expect(quoteRequest.quote).toMatchObject({
      id: quoteRequest.id, kind: 'commercialRequest', status: 'draft', createdVia: 'agent', address: '100 Oakridge Commons, Bldg B', zoneId: 'zone_open',
      lines: [{ catalogId: 'cat_fl_2yd', qty: 1, frequency: '2x', priceCents: 0 }], dueTodayCents: 0, recurringCents: 0, expiresAt: '2026-10-10T23:59:59',
    });
    expect(quoteRequest).toMatchObject({ siteId: 'site_oak_2', material: 'cardboard', accessNotes: 'Gate code 4411', requestId: request.id, followUpBy: '2026-09-11T10:00:00' });
    expect(request).toMatchObject({ kind: 'quote', status: 'open', siteId: 'site_oak_2', createdVia: 'portal' });
    expect(request.note).toContain(quoteRequest.id);
    expect(store.getState().log.map((l) => l.action)).toEqual(['stub:submitQuoteRequest', 'addRequest']);
  });

  it('refuses a non frontload catalog item or a site on another account', () => {
    const s = store.getState();
    expect(() => s.requestQuote({ accountId: 'acct_pm_oakridge', siteId: 'site_oak_1', catalogId: 'cat_res_96', qty: 1, frequency: 'weekly', material: 'trash' })).toThrow();
    expect(() => s.requestQuote({ accountId: 'acct_pm_oakridge', siteId: 'site_maple', catalogId: 'cat_fl_2yd', qty: 1, frequency: 'weekly', material: 'trash' })).toThrow();
  });
});

describe('request picker', () => {
  it('offers cart size change only to accounts with an active residential cart', () => {
    expect(accountHasResidentialCart(store.getState(), 'acct_res_maple')).toBe(true);
    expect(accountHasResidentialCart(store.getState(), 'acct_pm_oakridge')).toBe(false);
  });
});

describe('every request kind', () => {
  it('has a path that creates a Request and all five show in the account list', () => {
    const s = store.getState();
    const charge = computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'event', baseCents: eventRates.extraPickup,
      servicedOn: '2026-09-14', source: { type: 'manual', id: 'eventRates.extraPickup' },
    });
    s.bookExtraPickup({ accountId: 'acct_res_maple', siteId: 'site_maple', charge, method: 'card', scheduledFor: '2026-09-14' });
    s.placeHold({ accountId: 'acct_res_maple', siteId: 'site_maple', start: '2026-09-20', end: '2026-10-04' });
    s.changeCart({ accountId: 'acct_res_maple', siteId: 'site_maple', serviceItemId: 'si_maple_96', toCatalogId: 'cat_res_64' });
    s.addRequest({ accountId: 'acct_res_maple', siteId: 'site_maple', kind: 'missedPickup', status: 'open', createdVia: 'portal', note: 'Customer disputes blocked outcome on 2026-09-07' });
    s.requestQuote({ accountId: 'acct_pm_oakridge', siteId: 'site_oak_2', catalogId: 'cat_fl_3yd', qty: 1, frequency: 'weekly', material: 'trash' });
    const kinds = new Set([
      ...requestsForAccount(store.getState(), 'acct_res_maple'),
      ...requestsForAccount(store.getState(), 'acct_pm_oakridge'),
    ].map((r) => r.kind));
    expect([...kinds].sort()).toEqual(['cartChange', 'extraPickup', 'missedPickup', 'quote', 'vacationHold']);
  });
});
