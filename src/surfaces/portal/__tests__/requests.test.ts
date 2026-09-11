// Request flows: extra pickup eligibility and booking (runbook scenario 3), the hold policy, and the cart change.
// Moved from portal/src/store/requests.test.ts.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EVENT_RATES } from '../../../seed'
import { setToday, today } from '../../../store/clock'
import {
  EXTRA_PICKUP_RATE_CENTS, EXTRA_PICKUP_SOURCE, HOLD_POLICY, PREVIEW_CHARGE_ID, checkHoldPolicy, computeCharge,
} from '../lib/engine'
import { extraPickupEligibility, holdableServiceItems, holdsForSite, pendingChangesForSite, routeCapacityOn } from '../lib/selectors'
import { handoff, handoffSentence } from '../lib/handoff'
import { MAPLE, patchDb, resetStore, s } from './helpers'

beforeEach(resetStore)
afterEach(() => setToday())

/** The extra pickup quote exactly as ExtraPickupFlow builds it. */
function extraPickupQuote(day = '2026-09-14') {
  return computeCharge({
    id: PREVIEW_CHARGE_ID, accountId: MAPLE, siteId: 'site_maple', lineType: 'event', baseCents: EXTRA_PICKUP_RATE_CENTS,
    servicedOn: day, source: { ...EXTRA_PICKUP_SOURCE }, pricing: { ruleWon: 'standardRate' }, description: `Extra pickup on ${day}`,
  })
}

describe('extra pickup eligibility', () => {
  it('passes all three checks for Maple and names Monday, Sep 14', () => {
    const route = s().routes.find(r => r.id === 'route_mon_res')!
    const open = route.capacityStops - route.stopSiteIds.length
    const e = extraPickupEligibility(s(), MAPLE, 'site_maple', today())
    expect(e.ok).toBe(true)
    expect(e.checks.map(c => c.id)).toEqual(['accountStatus', 'routeCapacity', 'activeService'])
    expect(e.checks.every(c => c.ok)).toBe(true)
    expect(e.nextRouteDay).toBe('2026-09-14')
    expect(e.checks[0].detail).toMatch(/Past due balances do not block/)
    expect(e.checks[1].detail).toBe(`${open} open stops on Monday, Sep 14`)
    expect(e.serviceItem?.id).toBe('si_maple_96')
  })

  it('fails the account check for suspended Kerr with the exact reason, and still runs every check', () => {
    const e = extraPickupEligibility(s(), 'acct_res_kerr', 'site_kerr', today())
    expect(e.ok).toBe(false)
    expect(e.checks[0]).toMatchObject({ id: 'accountStatus', ok: false, detail: 'Account is suspended' })
    expect(e.reason).toBe('Account is suspended')
    expect(e.checks).toHaveLength(3)
  })

  it('fails the capacity check when the route is full on the next route day', () => {
    patchDb(db => ({ ...db, routes: db.routes.map(r => (r.id === 'route_mon_res' ? { ...r, capacityStops: r.stopSiteIds.length } : r)) }))
    expect(routeCapacityOn(s(), 'route_mon_res', '2026-09-14')).toBe(0)
    const e = extraPickupEligibility(s(), MAPLE, 'site_maple', today())
    expect(e.ok).toBe(false)
    expect(e.checks[1]).toMatchObject({ id: 'routeCapacity', ok: false, detail: 'Route is full on Monday, Sep 14' })
    expect(e.reason).toBe('Route is full on Monday, Sep 14')
  })

  it('fails the account check for Holt, whose account is on hold', () => {
    const e = extraPickupEligibility(s(), 'acct_res_holt', 'site_holt', today())
    expect(e.checks[0]).toMatchObject({ ok: false, detail: 'Account is on hold' })
  })
})

describe('extra pickup booking (addendum D5)', () => {
  it('prices from eventRates.extraPickup: base 2500, fuel 175, no env fee, tax 187, total 2862', () => {
    expect(EVENT_RATES.extraPickup).toBe(2500)
    expect(s().catalog.some(c => c.id === 'cat_res_extra_pickup')).toBe(false)
    const q = extraPickupQuote()
    expect(q).toMatchObject({ lineType: 'event', source: { type: 'manual', id: 'eventRates.extraPickup' }, baseCents: 2500, taxCents: 187, totalCents: 2862 })
    expect(q.catalogId).toBeUndefined()
    expect(q.fees).toEqual([{ feeRuleId: 'fee_fuel_7pct', cents: 175 }])
    expect(q.pricing).toEqual({ ruleWon: 'standardRate' })
  })

  it('a preview never advances billing\'s charge id counter', () => {
    const before = computeCharge({ accountId: MAPLE, siteId: 'site_maple', lineType: 'event', baseCents: 100, servicedOn: '2026-09-14', source: { type: 'manual', id: 'x' } }).id
    extraPickupQuote()
    extraPickupQuote()
    const after = computeCharge({ accountId: MAPLE, siteId: 'site_maple', lineType: 'event', baseCents: 100, servicedOn: '2026-09-14', source: { type: 'manual', id: 'x' } }).id
    expect(Number(after.slice(-4)) - Number(before.slice(-4))).toBe(1)
  })

  it('writes an approved charge, a settled unallocated payment, a scheduled request, and an extraPickup work order', () => {
    const r = s().bookExtraPickup({ accountId: MAPLE, siteId: 'site_maple', charge: extraPickupQuote(), method: 'card', scheduledFor: '2026-09-14', serviceItemId: 'si_maple_96', containerId: 'cart_maple_1' })
    expect(r.charge).toMatchObject({ id: 'chg_p0001', status: 'approved', lineType: 'event', totalCents: 2862, source: { type: 'manual' } })
    expect(s().charges.find(c => c.id === 'chg_p0001')).toEqual(r.charge)
    expect(r.payment).toMatchObject({ id: 'pay_p0001', accountId: MAPLE, method: 'card', cents: 2862, status: 'settled' })
    expect(s().allocations.filter(a => a.sourceId === r.payment.id)).toHaveLength(0)
    expect(r.request).toMatchObject({ id: 'req_p0001', kind: 'extraPickup', status: 'scheduled', workOrderId: r.workOrder.id })
    expect(r.workOrder).toMatchObject({ id: 'wo_p0001', kind: 'extraPickup', status: 'scheduled', scheduledFor: '2026-09-14', requestId: r.request.id, serviceItemId: 'si_maple_96' })
    expect(s().workOrders.find(w => w.id === r.workOrder.id)).toEqual(r.workOrder)
    expect(s().log.map(l => l.action)).toEqual(['addCharge', 'addPayment', 'addRequest', 'addWorkOrder'])
    // The booked stop takes one place on Monday's truck.
    const e = extraPickupEligibility(s(), MAPLE, 'site_maple', today())
    const route = s().routes.find(x => x.id === 'route_mon_res')!
    expect(e.checks[1].detail).toBe(`${route.capacityStops - route.stopSiteIds.length - 1} open stops on Monday, Sep 14`)
  })

  it('refuses a suspended account even if a screen let it through (invariant 4)', () => {
    const charge = computeCharge({
      id: PREVIEW_CHARGE_ID, accountId: 'acct_res_kerr', siteId: 'site_kerr', lineType: 'event', baseCents: 2500, servicedOn: '2026-09-15',
      source: { ...EXTRA_PICKUP_SOURCE }, pricing: { ruleWon: 'standardRate' },
    })
    expect(() => s().bookExtraPickup({ accountId: 'acct_res_kerr', siteId: 'site_kerr', charge, method: 'card', scheduledFor: '2026-09-15' })).toThrow(/suspended/)
    expect(s().charges.some(c => c.accountId === 'acct_res_kerr')).toBe(false)
  })
})

describe('hold policy check', () => {
  it('accepts a 7 to 90 day hold starting tomorrow or later', () => {
    expect(checkHoldPolicy('2026-09-14', '2026-09-28', today())).toEqual({ ok: true, days: 14 })
    expect(checkHoldPolicy('2026-09-11', '2026-09-18', today())).toEqual({ ok: true, days: 7 })
    expect(checkHoldPolicy('2026-09-11', '2026-12-10', today())).toEqual({ ok: true, days: 90 })
  })

  it('rejects a hold shorter than the minimum or longer than the maximum', () => {
    expect(checkHoldPolicy('2026-09-14', '2026-09-18', today())).toEqual({ ok: false, days: 4, reason: `This hold is 4 days, shorter than the ${HOLD_POLICY.minDays} day minimum` })
    expect(checkHoldPolicy('2026-09-11', '2026-12-11', today())).toEqual({ ok: false, days: 91, reason: `This hold is 91 days, longer than the ${HOLD_POLICY.maxDays} day maximum` })
  })

  it('rejects a start before tomorrow and an end that is not after the start', () => {
    expect(checkHoldPolicy('2026-09-10', '2026-09-24', today()).reason).toBe('The hold must start on or after 2026-09-11')
    expect(checkHoldPolicy('2026-09-14', '2026-09-14', today()).reason).toBe('The hold must end after it starts')
    expect(checkHoldPolicy('2026-09-14', '2026-09-12', today()).reason).toBe('The hold must end after it starts')
  })

  it('placeHold writes only portal holds and a scheduled request; ServiceItem and account status are untouched', () => {
    const itemsBefore = s().serviceItems.filter(i => i.siteId === 'site_maple')
    const r = s().placeHold({ accountId: MAPLE, siteId: 'site_maple', start: '2026-09-14', end: '2026-09-28' })
    expect(r.holds.map(h => h.id)).toEqual(['hold_p0001', 'hold_p0002', 'hold_p0003'])
    expect(holdsForSite(s(), 'site_maple').map(h => [h.serviceItemId, h.start, h.end])).toEqual(
      itemsBefore.map(i => [i.id, '2026-09-14', '2026-09-28']),
    )
    expect(r.request).toMatchObject({ kind: 'vacationHold', status: 'scheduled', note: 'Vacation hold 2026-09-14 to 2026-09-28, pickups resume 2026-10-05' })
    expect(s().serviceItems.filter(i => i.siteId === 'site_maple')).toEqual(itemsBefore)
    expect(s().accounts.find(a => a.id === MAPLE)?.status).toBe('pastDue')
    expect(s().log.map(l => l.action)).toEqual(['addHold', 'addHold', 'addHold', 'stub:requestServiceItemHold', 'addRequest'])
    expect(holdableServiceItems(s(), 'site_maple', today())).toHaveLength(0)
    expect(() => s().placeHold({ accountId: MAPLE, siteId: 'site_maple', start: '2026-10-01', end: '2026-10-20' })).toThrow(/No active service/)
  })

  it('placeHold refuses an out of policy range and writes nothing', () => {
    expect(() => s().placeHold({ accountId: MAPLE, siteId: 'site_maple', start: '2026-09-14', end: '2026-09-16' })).toThrow(/shorter than/)
    expect(s().holds).toHaveLength(0)
    expect(s().log).toHaveLength(0)
  })
})

describe('cart change', () => {
  it('drives account\'s changeServiceItem: a scheduled request, the swap work order on the next route day, the new size from 2026-10-01 (box 3.3)', () => {
    const cart = s().serviceItems.find(i => i.id === 'si_maple_96')!
    const requestsBefore = s().requests.length
    const r = s().changeCart({ accountId: MAPLE, siteId: 'site_maple', serviceItemId: 'si_maple_96', toCatalogId: 'cat_res_64' })
    expect(r.pendingChange).toEqual({
      id: 'chgreq_p0001', serviceItemId: 'si_maple_96', fromCatalogId: 'cat_res_96', toCatalogId: 'cat_res_64', effectiveFrom: '2026-10-01',
      requestId: r.request.id, workOrderId: r.workOrder.id,
    })
    // Account's work order: a swap on the next route day that answers the portal's Request.
    expect(r.workOrder).toMatchObject({ kind: 'swap', scheduledFor: '2026-09-14', requestId: r.request.id })
    expect(r.request).toMatchObject({ kind: 'cartChange', status: 'scheduled', createdVia: 'portal', workOrderId: r.workOrder.id })
    expect(r.request.note).toContain('effective 2026-10-01')
    // OWNERSHIP.md: account, not the portal, ends the old cart (never deleted) and starts the new one; no proration.
    expect(s().serviceItems.find(i => i.id === 'si_maple_96')).toMatchObject({ status: 'ended', effectiveTo: '2026-10-01' })
    expect(s().serviceItems.find(i => i.id === r.workOrder.serviceItemId)).toMatchObject({ catalogId: 'cat_res_64', effectiveFrom: '2026-10-01', status: 'active', frequency: cart.frequency })
    // One Request for the change: account did not file a second one.
    expect(s().requests).toHaveLength(requestsBefore + 1)
    expect(s().requests.at(-1)).toEqual(r.request)
    expect(pendingChangesForSite(s(), 'site_maple').map(p => p.id)).toEqual([r.pendingChange.id])
    expect(s().log.map(l => l.action)).toEqual(['addRequest', 'account:changeServiceItem', 'addPendingChange'])
  })

  it('refuses the same size, a held item, or a second change on the same cart', () => {
    expect(() => s().changeCart({ accountId: MAPLE, siteId: 'site_maple', serviceItemId: 'si_maple_96', toCatalogId: 'cat_res_96' })).toThrow(/already the current/)
    patchDb(db => ({ ...db, serviceItems: db.serviceItems.map(i => (i.id === 'si_holt_96' ? { ...i, status: 'held' } : i)) }))
    expect(() => s().changeCart({ accountId: 'acct_res_holt', siteId: 'site_holt', serviceItemId: 'si_holt_96', toCatalogId: 'cat_res_64' })).toThrow(/Only an active/)
    s().changeCart({ accountId: MAPLE, siteId: 'site_maple', serviceItemId: 'si_maple_96', toCatalogId: 'cat_res_64' })
    expect(() => s().changeCart({ accountId: MAPLE, siteId: 'site_maple', serviceItemId: 'si_maple_96', toCatalogId: 'cat_res_64' })).toThrow(/pending change/)
  })
})

describe('handoff', () => {
  it('promises the next business day at 10:00 am', () => {
    const h = handoff('Account is suspended')
    expect(h).toEqual({ reason: 'Account is suspended', followUpBy: '2026-09-11T10:00:00' })
    expect(handoffSentence(h)).toBe('We could not finish this automatically. Reason: Account is suspended. A person will follow up by Friday, Sep 11, 10:00 am.')
    expect(handoff('x', '2026-09-11').followUpBy).toBe('2026-09-14T10:00:00')
  })

  it('follows the engine clock when billing moves it', () => {
    setToday('2026-10-10')
    expect(handoff('x').followUpBy).toBe('2026-10-12T10:00:00')
  })
})
