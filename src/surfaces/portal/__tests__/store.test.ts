// The portal slice in the one store: session, ids, the log, reset, and the ownership rules (box 2C.2).
// Moved from portal/src/store/useStore.test.ts.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../../../store/useStore'
import { setToday } from '../../../store/clock'
import { createPortalSlice, initialPortalData } from '../../../store/slices/portal'
import { accountBalance, eventForSiteOn, invoiceOpenBalance, routeCapacityOn } from '../lib/selectors'
import { allocate } from '../lib/engine'
import { nextPortalId, nextPortalIds } from '../lib/ids'
import { viewOf } from '../store'
import { MAPLE, OAKRIDGE, maplePastDueInvoice, openFromRows, resetStore, s } from './helpers'

beforeEach(resetStore)
afterEach(() => setToday())

describe('session', () => {
  it('starts signed in as Maple on site_maple', () => {
    expect(s().session).toEqual({ accountId: MAPLE, siteId: 'site_maple' })
  })

  it("switching accounts resets the site to that account's first site", () => {
    s().switchAccount(OAKRIDGE)
    expect(s().session).toEqual({ accountId: OAKRIDGE, siteId: 'site_oak_1' })
    s().setSite('site_oak_3')
    expect(s().session.siteId).toBe('site_oak_3')
    s().switchAccount(MAPLE)
    expect(s().session.siteId).toBe('site_maple')
  })

  it('refuses a site on another account and an unknown account', () => {
    expect(() => s().setSite('site_oak_1')).toThrow(/not on the signed-in account/)
    expect(() => s().switchAccount('acct_nope')).toThrow(/Unknown account/)
  })

  it('Reset seed puts the session, the portal tables, and the log back', () => {
    s().switchAccount(OAKRIDGE)
    s().setAutopay(MAPLE, true)
    useStore.getState().reset()
    const root = useStore.getState()
    expect(root.portalSession).toEqual(initialPortalData().portalSession)
    expect(root.portalLog).toEqual([])
    expect(root.db.accounts.find(a => a.id === MAPLE)!.autopay).toBe(false)
  })
})

describe('slice contract (src/store/slices/types.ts)', () => {
  const keys = Object.keys(createPortalSlice(useStore.setState, useStore.getState, useStore))

  it('holds the four portal-local tables under the names Phase 3 reads', () => {
    expect(keys).toEqual(expect.arrayContaining(['holds', 'pendingChanges', 'quoteRequests', 'paymentMethods', 'portalSession', 'portalLog']))
  })

  it('prefixes every other key with portal, so no generic name can collide with another slice', () => {
    const tables = new Set(['holds', 'pendingChanges', 'quoteRequests', 'paymentMethods'])
    for (const k of keys) if (!tables.has(k)) expect(k, k).toMatch(/^portal[A-Z]/)
  })

  it('never writes an entity another surface owns: no invoice, charge edit, service item, quote, or delete action', () => {
    for (const k of keys) expect(k, k).not.toMatch(/Invoice|UpdateCharge|ServiceItem$|AddServiceItem|AddQuote|Delete|Remove|Purge|Drop/)
  })

  it('the creator has no side effects: calling it twice gives equal fresh state and leaves the store alone', () => {
    const before = useStore.getState()
    const a = createPortalSlice(useStore.setState, useStore.getState, useStore)
    const b = createPortalSlice(useStore.setState, useStore.getState, useStore)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(useStore.getState()).toBe(before)
  })
})

describe('ids (addendum C12)', () => {
  it('mints one above the highest _p suffix and ignores seed ids', () => {
    expect(nextPortalId('req', ['req_holt_vacation', 'req_bakery_quote'])).toBe('req_p0001')
    expect(nextPortalId('req', ['req_p0001', 'req_p0009', 'req_px'])).toBe('req_p0010')
    expect(nextPortalIds('hold', ['hold_p0002'], 3)).toEqual(['hold_p0003', 'hold_p0004', 'hold_p0005'])
  })

  it('restart at 0001 after Reset seed, so a demo is repeatable', () => {
    expect(s().addRequest({ accountId: MAPLE, siteId: 'site_maple', kind: 'extraPickup', status: 'open', createdVia: 'portal' }).id).toBe('req_p0001')
    resetStore()
    expect(s().addRequest({ accountId: MAPLE, siteId: 'site_maple', kind: 'extraPickup', status: 'open', createdVia: 'portal' }).id).toBe('req_p0001')
  })
})

describe('mutations log', () => {
  it('every write appends to the log with its ids, stamped on the engine clock', () => {
    const req = s().addRequest({ accountId: MAPLE, siteId: 'site_maple', kind: 'extraPickup', status: 'open', createdVia: 'portal', note: 'test' })
    const wo = s().addWorkOrder({ siteId: 'site_maple', kind: 'extraPickup', status: 'scheduled', scheduledFor: '2026-09-14', requestId: req.id })
    s().setAutopay(MAPLE, true)
    expect(s().log.map(l => l.action)).toEqual(['addRequest', 'addWorkOrder', 'setAutopay:on'])
    expect(s().log[0]).toMatchObject({ ids: [req.id], at: '2026-09-10T12:00:00-04:00' })
    expect([req.id, wo.id]).toEqual(['req_p0001', 'wo_p0001'])
  })

  it('writes land in db through mutateDb, so the engine and every surface see them', () => {
    const req = s().addRequest({ accountId: MAPLE, siteId: 'site_maple', kind: 'quote', status: 'open', createdVia: 'portal' })
    expect(useStore.getState().db.requests.some(r => r.id === req.id)).toBe(true)
  })

  it('a payment allocation updates the open balance the engine and selectors see', () => {
    const inv = maplePastDueInvoice()
    const open = openFromRows(inv.id)
    s().recordPayment({ accountId: MAPLE, method: 'card', invoiceIds: [inv.id], cents: [open] })
    expect(invoiceOpenBalance(s(), inv.id)).toBe(0)
    expect(accountBalance(s(), MAPLE)).toBe(0)
    expect(() => allocate({ sourceType: 'payment', sourceId: 'pay_p0001', invoiceIds: [inv.id], cents: [1] })).toThrow(/unapplied|open balance/)
  })
})

describe('selectors', () => {
  it("Maple's balance is whatever the seed's rows produce (box 2C.3)", () => {
    const inv = maplePastDueInvoice()
    expect(accountBalance(s(), MAPLE)).toBe(openFromRows(inv.id))
    expect(accountBalance(s(), MAPLE)).toBeGreaterThan(0)
    expect(accountBalance(s(), OAKRIDGE)).toBe(0)
  })

  it('route capacity subtracts scheduled extra pickups on that date', () => {
    const route = s().routes.find(r => r.id === 'route_mon_res')!
    const open = route.capacityStops - route.stopSiteIds.length
    expect(routeCapacityOn(s(), 'route_mon_res', '2026-09-14')).toBe(open)
    s().addWorkOrder({ siteId: 'site_maple', kind: 'extraPickup', status: 'scheduled', scheduledFor: '2026-09-14' })
    expect(routeCapacityOn(s(), 'route_mon_res', '2026-09-14')).toBe(open - 1)
    expect(routeCapacityOn(s(), 'route_mon_res', '2026-09-21')).toBe(open)
  })

  it('eventForSiteOn matches the calendar day, including the pending-seed events', () => {
    expect(eventForSiteOn(s(), 'site_maple', '2026-08-24')?.outcome).toBe('blocked')
    expect(eventForSiteOn(s(), 'site_maple', '2026-09-07')?.exception).toBe('extraBags')
    expect(eventForSiteOn(s(), 'site_maple', '2026-09-08')).toBeUndefined()
  })
})

describe('Maple field events are seed rows (Phase 3.7a; lib/fieldEvents.ts retired)', () => {
  it('the missed and blocked Mondays come from the seed, with the driver note and photo', () => {
    const db = useStore.getState().db
    const missed = db.serviceEvents.find(e => e.id === 'evt_maple_missed_0817')!
    const blocked = db.serviceEvents.find(e => e.id === 'evt_maple_blocked_0824')!
    expect([missed.siteId, missed.date, missed.outcome, missed.exception, missed.driver]).toEqual(['site_maple', '2026-08-17', 'missed', undefined, 'R. Alvarez'])
    expect([blocked.siteId, blocked.date, blocked.outcome, blocked.exception, blocked.photoUrl, blocked.driver]).toEqual(['site_maple', '2026-08-24', 'blocked', undefined, '/photos/blocked-driveway.svg', 'R. Alvarez'])
    expect(blocked.note).toBe('Cart blocked by a parked vehicle in the driveway')
    expect(viewOf(useStore.getState()).serviceEvents.filter(e => e.siteId === 'site_maple' && e.date === '2026-08-24').map(e => e.id)).toEqual(['evt_maple_blocked_0824'])
  })

  it('the view is cached per store state, so selectors over it are stable', () => {
    const root = useStore.getState()
    expect(viewOf(root)).toBe(viewOf(root))
    s().setAutopay(MAPLE, true)
    expect(viewOf(useStore.getState())).not.toBe(viewOf(root))
  })
})
