import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadSeed } from '../seed'
import type { Charge } from '../types'
import { clearEngineDb, setEngineDb, type Db } from './db'
import { computeCharge, generateEventCharges, generateRecurringCharges, resetChargeIds } from './engine'
import { suggestFor, tenureMonths } from './suggest'

let db: Db

beforeEach(() => {
  db = loadSeed()
  setEngineDb(() => db)
  resetChargeIds()
})

afterEach(() => {
  clearEngineDb()
  resetChargeIds()
})

function eventCharge(eventId: string): Charge {
  const c = generateEventCharges().find(x => x.source.id === eventId)
  if (!c) throw new Error(`no charge for ${eventId}`)
  return c
}

describe('tenureMonths', () => {
  it('counts months since the earliest service item on the account, as of today (2026-09-10)', () => {
    expect(tenureMonths(db, 'acct_res_maple')).toBe(65) // 2021-04-01
    expect(tenureMonths(db, 'acct_res_002')).toBe(0) // 2026-08-20, under a month
    expect(tenureMonths(db, 'acct_bakery')).toBe(8) // 2026-01-01
    expect(tenureMonths(db, 'acct_nope')).toBe(0)
  })
})

describe('suggestFor', () => {
  it('overage with a ticket attached is approve high, citing the ticket and work order', () => {
    const s = suggestFor(eventCharge('ticket_hale_1'), db)
    expect(s.action).toBe('approve')
    expect(s.confidence).toBe('high')
    expect(s.evidenceIds).toEqual(['ticket_hale_1', 'wo_hale_haul_1'])
    expect(s.rationale).toMatch(/8,400 lb/)
    expect(s.reason).toBeUndefined()
  })

  it('overage whose ticket is missing from the record is review low, insufficient evidence', () => {
    const c = eventCharge('ticket_hale_2')
    db = { ...db, scaleTickets: db.scaleTickets.filter(t => t.id !== 'ticket_hale_2') }
    const s = suggestFor(c, db)
    expect(s).toMatchObject({ action: 'review', reason: 'insufficientEvidence', confidence: 'low' })
  })

  it('dry run with a photo is approve medium', () => {
    const s = suggestFor(eventCharge('evt_hale_dryrun'), db)
    expect(s).toMatchObject({ action: 'approve', confidence: 'medium', evidenceIds: ['evt_hale_dryrun'] })
    expect(s.rationale).toMatch(/Dry run/)
  })

  it('dry run without a photo is review low, citing insufficient evidence', () => {
    const s = suggestFor(eventCharge('evt_fl003_dryrun'), db)
    expect(s).toMatchObject({ action: 'review', reason: 'insufficientEvidence', confidence: 'low', evidenceIds: ['evt_fl003_dryrun'] })
    expect(s.rationale).toMatch(/no photo/i)
  })

  it('contamination with a photo is approve medium; without one it is review low', () => {
    const s = suggestFor(eventCharge('evt_bakery_contam'), db)
    expect(s).toMatchObject({ action: 'approve', confidence: 'medium', evidenceIds: ['evt_bakery_contam'] })
    const c = eventCharge('evt_bakery_contam')
    const noPhoto = { ...db, serviceEvents: db.serviceEvents.map(e => (e.id === 'evt_bakery_contam' ? { ...e, photoUrl: undefined } : e)) }
    expect(suggestFor(c, noPhoto)).toMatchObject({ action: 'review', reason: 'insufficientEvidence', confidence: 'low' })
  })

  it('extra bags under 1000 cents on an account with tenure over 2 years and no prior waives is waive immaterial medium', () => {
    const c = eventCharge('evt_maple_extrabags')
    expect(c.baseCents).toBe(250)
    const activeMaple = { ...db, accounts: db.accounts.map(a => (a.id === 'acct_res_maple' ? { ...a, status: 'active' as const } : a)) }
    const s = suggestFor(c, activeMaple)
    expect(s).toMatchObject({ action: 'waive', reason: 'immaterial', confidence: 'medium', evidenceIds: ['evt_maple_extrabags'] })
    expect(s.rationale).toMatch(/5 year customer/)
  })

  it('the same small line on a pastDue account is approve medium (acct_res_maple as seeded)', () => {
    expect(db.accounts.find(a => a.id === 'acct_res_maple')!.status).toBe('pastDue')
    const s = suggestFor(eventCharge('evt_maple_extrabags'), db)
    expect(s).toMatchObject({ action: 'approve', confidence: 'medium', evidenceIds: ['evt_maple_extrabags'] })
    expect(s.reason).toBeUndefined()
    expect(s.rationale).toMatch(/past due/)
  })

  it('overload at 1000 cents is not under the immaterial threshold: with a photo it is approve medium', () => {
    const c = eventCharge('evt_res014_overload')
    expect(c.baseCents).toBe(1000)
    const s = suggestFor(c, db)
    expect(s).toMatchObject({ action: 'approve', confidence: 'medium', evidenceIds: ['evt_res014_overload'] })
    expect(s.rationale).toMatch(/above the immaterial threshold/)
  })

  it('a small line on a long tenure account that already has a prior waive is approve medium with a photo, review low without', () => {
    // acct_res_008 has a waived extra bags line from August.
    db.serviceEvents.push({
      id: 'evt_test_res008_again', siteId: 'site_res_008', routeId: 'route_tue_res', date: '2026-09-08',
      outcome: 'completed', exception: 'extraBags', photoUrl: '/evidence/res008-again.jpg', note: '2 bags', driver: 'Tasha Green',
    })
    const c = eventCharge('evt_test_res008_again')
    const withPhoto = suggestFor(c, db)
    expect(withPhoto).toMatchObject({ action: 'approve', confidence: 'medium' })
    expect(withPhoto.rationale).toMatch(/1 prior waive/)
    const noPhoto = { ...db, serviceEvents: db.serviceEvents.map(e => (e.id === 'evt_test_res008_again' ? { ...e, photoUrl: undefined } : e)) }
    expect(suggestFor(c, noPhoto)).toMatchObject({ action: 'review', reason: 'insufficientEvidence', confidence: 'low' })
  })

  it('a small line on a short tenure account is approve medium with a photo (tenure named in the rationale)', () => {
    db.serviceEvents.push({
      id: 'evt_test_res002_bags', siteId: 'site_res_002', routeId: 'route_tue_res', date: '2026-09-08',
      outcome: 'completed', exception: 'extraBags', photoUrl: '/evidence/res002.jpg', driver: 'Tasha Green',
    })
    const s = suggestFor(eventCharge('evt_test_res002_bags'), db)
    expect(s).toMatchObject({ action: 'approve', confidence: 'medium' })
    expect(s.rationale).toMatch(/tenure is 0 months/)
  })

  it('recurring lines are approve high with the rate version as evidence, or the contract and service item for overrides', () => {
    const october = generateRecurringCharges({ cycleDate: '2026-10-01' })
    const maple = october.find(c => c.source.id === 'si_maple_96')!
    expect(suggestFor(maple, db)).toMatchObject({ action: 'approve', confidence: 'high', evidenceIds: ['rv_res_96_2026'] })
    const bakery = october.find(c => c.source.id === 'si_bakery_3yd')!
    expect(suggestFor(bakery, db)).toMatchObject({ action: 'approve', confidence: 'high', evidenceIds: ['contract_bakery', 'si_bakery_3yd'] })
    const res005 = october.find(c => c.source.id === 'si_res_005_main')!
    expect(suggestFor(res005, db).evidenceIds).toEqual(['rv_res_64_2026q4'])
  })

  it('a recurring line with neither a rate version nor a contract falls back to the service item as evidence', () => {
    const c = computeCharge({
      accountId: 'acct_res_001', siteId: 'site_res_001', lineType: 'recurring', baseCents: 2900,
      period: { start: '2026-10-01', end: '2026-10-31' }, source: { type: 'serviceItem', id: 'si_res_001_main' },
      pricing: { ruleWon: 'manualException' },
    })
    expect(suggestFor(c, db)).toMatchObject({ action: 'approve', confidence: 'high', evidenceIds: ['si_res_001_main'] })
  })

  it('manual fee lines are review low: no rule covers them', () => {
    const c = computeCharge({
      accountId: 'acct_res_001', siteId: 'site_res_001', lineType: 'fee', baseCents: 2500, servicedOn: '2026-09-10',
      source: { type: 'manual', id: 'wo_test' }, description: 'Delivery fee', evidenceIds: ['wo_test'],
    })
    expect(suggestFor(c, db)).toMatchObject({ action: 'review', confidence: 'low', evidenceIds: ['wo_test'] })
  })

  it('an event charge whose source event is missing is review low', () => {
    const c = eventCharge('evt_maple_extrabags')
    const gone = { ...db, serviceEvents: db.serviceEvents.filter(e => e.id !== 'evt_maple_extrabags') }
    expect(suggestFor(c, gone)).toMatchObject({ action: 'review', reason: 'insufficientEvidence', confidence: 'low' })
  })

  it('every suggestion names its evidence and never mutates the charge or the db', () => {
    const before = JSON.stringify(db)
    const all = [...generateRecurringCharges({ cycleDate: '2026-10-01' }), ...generateEventCharges()]
    for (const c of all) {
      const snapshot = JSON.stringify(c)
      const s = suggestFor(c, db)
      expect(['approve', 'waive', 'review']).toContain(s.action)
      expect(['high', 'medium', 'low']).toContain(s.confidence)
      expect(s.rationale.length).toBeGreaterThan(10)
      expect(s.evidenceIds.length).toBeGreaterThan(0)
      expect(JSON.stringify(c)).toBe(snapshot)
    }
    expect(JSON.stringify(db)).toBe(before)
  })
})
