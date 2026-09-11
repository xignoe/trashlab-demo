// Missed pickup lookup and recovery (runbook scenario 2), the commercial quote stub (scenario 4), the picker rules,
// and one path per Request kind. Moved from portal/src/store/phase5.test.ts.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setToday, today } from '../../../store/clock'
import { EXTRA_PICKUP_RATE_CENTS, EXTRA_PICKUP_SOURCE, PREVIEW_CHARGE_ID, computeCharge, missedPickupWindow } from '../lib/engine'
import {
  accountHasResidentialCart, defaultMissedPickupDate, frontloadSizes, missedPickupLookup, quoteCatalogFor, requestsForAccount,
} from '../lib/selectors'
import { MAPLE, OAKRIDGE, patchDb, resetStore, s } from './helpers'

beforeEach(resetStore)
afterEach(() => setToday())

describe('missed pickup lookup', () => {
  it('limits the window to the last 28 days and defaults to the most recent route day', () => {
    expect(missedPickupWindow(today())).toEqual({ min: '2026-08-13', max: '2026-09-10' })
    expect(defaultMissedPickupDate(s(), 'site_maple', today())).toBe('2026-09-07')
    expect(defaultMissedPickupDate(s(), 'site_oak_2', today())).toBe('2026-09-09')
    expect(missedPickupLookup(s(), 'site_maple', '2026-08-10', today()).kind).toBe('outOfWindow')
    expect(missedPickupLookup(s(), 'site_maple', '2026-08-17', today()).kind).toBe('missed')
  })

  it('the default day, 2026-09-07, is a completed stop with the extra bags photo and writes nothing', () => {
    const l = missedPickupLookup(s(), 'site_maple', '2026-09-07', today())
    expect(l.kind).toBe('completed')
    if (l.kind !== 'completed') throw new Error('unreachable')
    expect(l.event).toMatchObject({ exception: 'extraBags', driver: 'Marcus Bell' })
    expect(l.event.photoUrl).toBeTruthy()
    expect(s().log).toHaveLength(0)
  })

  it('shows the blocked event on 2026-08-24 with its photo and writes nothing: no recovery order', () => {
    const l = missedPickupLookup(s(), 'site_maple', '2026-08-24', today())
    expect(l.kind).toBe('notReachable')
    if (l.kind !== 'notReachable') throw new Error('unreachable')
    expect(l.event).toMatchObject({ outcome: 'blocked', driver: 'R. Alvarez', photoUrl: '/photos/blocked-driveway.svg' })
    expect(l.event.note).toMatch(/parked vehicle/)
    expect(() => s().reportMissedPickup({ accountId: MAPLE, siteId: 'site_maple', date: '2026-08-24' })).toThrow(/No recovery/)
    expect(s().workOrders.some(w => w.kind === 'recovery')).toBe(false)
    expect(s().log).toHaveLength(0)
  })

  it('treats a notOut exception like blocked even when the outcome says completed', () => {
    patchDb(db => ({ ...db, serviceEvents: db.serviceEvents.map(e => (e.siteId === 'site_maple' && e.date.startsWith('2026-08-31') ? { ...e, exception: 'notOut' as const } : e)) }))
    expect(missedPickupLookup(s(), 'site_maple', '2026-08-31', today()).kind).toBe('notReachable')
  })

  it('hands off a suspended stop and a day with no record', () => {
    expect(missedPickupLookup(s(), 'site_kerr', '2026-09-08', today())).toMatchObject({ kind: 'handoff', reason: 'Service was suspended on 2026-09-08' })
    // Billing's seed records Oakridge's Wednesdays from Sep 2 only, so Aug 26 has no record.
    expect(missedPickupLookup(s(), 'site_oak_2', '2026-08-26', today())).toMatchObject({ kind: 'handoff', reason: 'No route record for 2026-08-26' })
    expect(missedPickupLookup(s(), 'site_oak_1', '2026-08-12', today()).kind).toBe('outOfWindow')
  })

  it('says a non route day is not one and offers the nearest route day in the window', () => {
    expect(missedPickupLookup(s(), 'site_maple', '2026-09-10', today())).toMatchObject({ kind: 'notRouteDay', nearest: '2026-09-07' })
    expect(missedPickupLookup(s(), 'site_maple', '2026-08-29', today())).toMatchObject({ kind: 'notRouteDay', nearest: '2026-08-31' })
    // Thursday Aug 13 for a Wednesday route: Aug 12 is outside the window, so Aug 19 is offered.
    expect(missedPickupLookup(s(), 'site_oak_1', '2026-08-13', today())).toMatchObject({ kind: 'notRouteDay', nearest: '2026-08-19' })
  })

  it('books a recovery work order the next business day for the missed event and refuses a second report', () => {
    expect(missedPickupLookup(s(), 'site_maple', '2026-08-17', today())).toMatchObject({ kind: 'missed', recoveryOn: '2026-09-11' })
    const { workOrder, request } = s().reportMissedPickup({ accountId: MAPLE, siteId: 'site_maple', date: '2026-08-17' })
    expect(workOrder).toMatchObject({ id: 'wo_p0001', kind: 'recovery', status: 'scheduled', scheduledFor: '2026-09-11', requestId: request.id, siteId: 'site_maple', serviceItemId: 'si_maple_96' })
    expect(request).toMatchObject({ id: 'req_p0001', kind: 'missedPickup', status: 'scheduled', workOrderId: workOrder.id })
    expect(request.note).toContain('2026-08-17')
    expect(missedPickupLookup(s(), 'site_maple', '2026-08-17', today()).existing?.id).toBe(request.id)
    expect(() => s().reportMissedPickup({ accountId: MAPLE, siteId: 'site_maple', date: '2026-08-17' })).toThrow(/Already reported/)
    expect(s().log.map(l => l.action)).toEqual(['addRequest', 'addWorkOrder'])
  })
})

describe('commercial quote request (runbook scenario 4)', () => {
  it('maps size and material onto the frontload catalog', () => {
    const cat = s().catalog
    expect(frontloadSizes(cat)).toEqual(['2 yd', '3 yd', '4 yd', '6 yd', '8 yd'])
    expect(quoteCatalogFor(cat, '3 yd', 'wood waste')?.id).toBe('cat_fl_3yd_wood')
    expect(quoteCatalogFor(cat, '3 yd', 'cardboard')?.id).toBe('cat_fl_3yd')
    expect(quoteCatalogFor(cat, '2 yd', 'wood waste')?.id).toBe('cat_fl_2yd')
  })

  it('stubs the Quote into quoteRequests and files an open quote Request naming the quote id', () => {
    const quotesBefore = s().quotes.length
    const site = s().sites.find(x => x.id === 'site_oak_2')!
    const { quoteRequest, request } = s().requestQuote({
      accountId: OAKRIDGE, siteId: 'site_oak_2', catalogId: 'cat_fl_2yd', qty: 1, frequency: '2x', material: 'cardboard', accessNotes: ' Gate code 4411 ',
    })
    expect(s().quotes.length).toBe(quotesBefore)
    expect(quoteRequest.id).toBe('quote_p0001')
    expect(quoteRequest.quote).toMatchObject({
      id: 'quote_p0001', kind: 'commercialRequest', status: 'draft', createdVia: 'agent', address: site.address, zoneId: site.zoneId,
      lines: [{ catalogId: 'cat_fl_2yd', qty: 1, frequency: '2x', priceCents: 0 }], dueTodayCents: 0, recurringCents: 0, expiresAt: '2026-10-10T23:59:59',
    })
    expect(quoteRequest).toMatchObject({ siteId: 'site_oak_2', material: 'cardboard', accessNotes: 'Gate code 4411', requestId: request.id, followUpBy: '2026-09-11T10:00:00' })
    expect(request).toMatchObject({ id: 'req_p0001', kind: 'quote', status: 'open', siteId: 'site_oak_2', createdVia: 'portal' })
    expect(request.note).toContain(quoteRequest.id)
    expect(s().log.map(l => l.action)).toEqual(['stub:submitQuoteRequest', 'addRequest'])
  })

  it('refuses a non frontload catalog item or a site on another account', () => {
    expect(() => s().requestQuote({ accountId: OAKRIDGE, siteId: 'site_oak_1', catalogId: 'cat_res_96', qty: 1, frequency: 'weekly', material: 'trash' })).toThrow()
    expect(() => s().requestQuote({ accountId: OAKRIDGE, siteId: 'site_maple', catalogId: 'cat_fl_2yd', qty: 1, frequency: 'weekly', material: 'trash' })).toThrow()
  })
})

describe('request picker', () => {
  it('offers cart size change only to accounts with an active residential cart', () => {
    expect(accountHasResidentialCart(s(), MAPLE)).toBe(true)
    expect(accountHasResidentialCart(s(), OAKRIDGE)).toBe(false)
  })
})

describe('every request kind', () => {
  it('has a path that creates a Request, and all five show in the account lists', () => {
    const charge = computeCharge({
      id: PREVIEW_CHARGE_ID, accountId: MAPLE, siteId: 'site_maple', lineType: 'event', baseCents: EXTRA_PICKUP_RATE_CENTS,
      servicedOn: '2026-09-14', source: { ...EXTRA_PICKUP_SOURCE }, pricing: { ruleWon: 'standardRate' },
    })
    s().bookExtraPickup({ accountId: MAPLE, siteId: 'site_maple', charge, method: 'card', scheduledFor: '2026-09-14' })
    s().placeHold({ accountId: MAPLE, siteId: 'site_maple', start: '2026-09-20', end: '2026-10-04' })
    s().changeCart({ accountId: MAPLE, siteId: 'site_maple', serviceItemId: 'si_maple_96', toCatalogId: 'cat_res_64' })
    s().addRequest({ accountId: MAPLE, siteId: 'site_maple', kind: 'missedPickup', status: 'open', createdVia: 'portal', note: 'Customer disputes blocked outcome on 2026-08-24' })
    s().requestQuote({ accountId: OAKRIDGE, siteId: 'site_oak_2', catalogId: 'cat_fl_3yd', qty: 1, frequency: 'weekly', material: 'trash' })
    const kinds = new Set([...requestsForAccount(s(), MAPLE), ...requestsForAccount(s(), OAKRIDGE)].filter(r => r.createdVia === 'portal').map(r => r.kind))
    expect([...kinds].sort()).toEqual(['cartChange', 'extraPickup', 'missedPickup', 'quote', 'vacationHold'])
    // Every portal request lands in db.requests, which is what the account view reads (Phase 3, box 3.3).
    expect(s().requests.filter(r => r.id.startsWith('req_p'))).toHaveLength(5)
  })
})
