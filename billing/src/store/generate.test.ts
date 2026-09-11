import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadSeed } from '../seed'
import type { Charge } from '../types'
import { clearEngineDb, setEngineDb, type Db } from './db'
import {
  appendCharges, applyPosting, eventRates, generateEventCharges, generateRecurringCharges, postInvoices, resetChargeIds,
} from './engine'

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

function approved(charges: Charge[]): Charge[] {
  return charges.map(c => ({ ...c, status: 'approved' as const }))
}

function byAccount(charges: Charge[], accountId: string): Charge[] {
  return charges.filter(c => c.accountId === accountId)
}

// ---------------------------------------------------------------------------
// generateRecurringCharges
// ---------------------------------------------------------------------------

describe('generateRecurringCharges', () => {
  it('returns one proposed recurring charge per active service item for every due, non suspended account (56 on 2026-10-01)', () => {
    const charges = generateRecurringCharges({ cycleDate: '2026-10-01' })
    // 3 maple + 1 holt + 2 bakery + 4 oakridge + 38 generic residential (30 carts, 7 recycling, 1 extra cart) + 8 frontload.
    expect(charges).toHaveLength(56)
    for (const c of charges) {
      expect(c.status).toBe('proposed')
      expect(c.lineType).toBe('recurring')
      expect(c.source.type).toBe('serviceItem')
      expect(c.period).toBeDefined()
      expect(c.id.startsWith('chg_')).toBe(true)
    }
    const items = charges.map(c => c.source.id)
    expect(new Set(items).size).toBe(items.length)
  })

  it('prices on the period start with qty and months multiplied in: a quarterly 96 gal cart bills 3 x 2900 = 8700, matching the seed history', () => {
    const charges = generateRecurringCharges({ cycleDate: '2026-10-01' })
    const maple96 = charges.find(c => c.source.id === 'si_maple_96')!
    expect(maple96.baseCents).toBe(8700)
    expect(maple96.period).toEqual({ start: '2026-10-01', end: '2026-12-31' })
    expect(maple96.description).toBe('96 gal cart, weekly, Oct 1 to Dec 31')
    expect(maple96.pricing).toEqual({ ruleWon: 'zoneRate', rateVersionId: 'rv_res_96_2026' })
    // Same fee and tax shape as the seeded Q3 line for this item.
    const seeded = db.charges.find(c => c.id === 'chg_maple_2026q3_1')!
    expect(maple96.fees).toEqual(seeded.fees)
    expect(maple96.taxCents).toBe(seeded.taxCents)
    expect(maple96.totalCents).toBe(seeded.totalCents)

    const monthly96 = charges.find(c => c.source.id === 'si_res_001_main')!
    expect(monthly96.baseCents).toBe(2900)
    expect(monthly96.description).toBe('96 gal cart, weekly, Oct 1 to Oct 31')

    const recycling = charges.find(c => c.source.id === 'si_maple_recycling')!
    expect(recycling.description).toBe('Recycling cart, every other week, Oct 1 to Dec 31')
    expect(recycling.baseCents).toBe(3600)
  })

  it('multiplies qty into baseCents', () => {
    db.serviceItems.find(si => si.id === 'si_oak_1')!.qty = 2
    const charges = generateRecurringCharges({ cycleDate: '2026-10-01' })
    const oak1 = charges.find(c => c.source.id === 'si_oak_1')!
    expect(oak1.baseCents).toBe(30000)
    expect(oak1.description).toBe('2 x 2 yd frontload container, weekly, Oct 1 to Oct 31')
  })

  it('uses the rate version in force on the period start: cat_res_64 bills 2700 from 2026-10-01 and 2600 before', () => {
    const oct = generateRecurringCharges({ cycleDate: '2026-10-01' }).find(c => c.source.id === 'si_res_005_main')!
    expect(oct.baseCents).toBe(2700)
    expect(oct.pricing.rateVersionId).toBe('rv_res_64_2026q4')
    const jul = generateRecurringCharges({ cycleDate: '2026-07-01' }).find(c => c.source.id === 'si_res_005_main')!
    expect(jul.baseCents).toBe(2600)
    expect(jul.pricing.rateVersionId).toBe('rv_res_64_2026')
  })

  it('invariant 4: suspended acct_res_kerr produces zero charges while its route events are skippedSuspended', () => {
    const account = db.accounts.find(a => a.id === 'acct_res_kerr')!
    expect(account.status).toBe('suspended')
    // The service item is still active; the engine, not the seed, is what skips it.
    expect(db.serviceItems.find(si => si.id === 'si_kerr_96')!.status).toBe('active')
    for (const cycleDate of ['2026-10-01', '2026-07-01', '2027-01-01']) {
      expect(byAccount(generateRecurringCharges({ cycleDate }), 'acct_res_kerr')).toHaveLength(0)
    }
    const kerrEvents = db.serviceEvents.filter(e => e.siteId === 'site_kerr')
    expect(kerrEvents.length).toBeGreaterThan(0)
    expect(kerrEvents.every(e => e.outcome === 'skippedSuspended')).toBe(true)
  })

  it('acct_res_holt on vacation hold still bills under proration none (DECISIONS.md entry 4)', () => {
    expect(db.accounts.find(a => a.id === 'acct_res_holt')!.status).toBe('hold')
    const holt = byAccount(generateRecurringCharges({ cycleDate: '2026-10-01' }), 'acct_res_holt')
    expect(holt).toHaveLength(1)
    expect(holt[0].baseCents).toBe(8700)
  })

  it('invariant 3: acct_res_007 extra cart appears in the 2026-10-01 run, not in the 2026-07-01 run, and wo_res_007_deliver exists', () => {
    const workOrder = db.workOrders.find(w => w.id === 'wo_res_007_deliver')
    expect(workOrder).toBeDefined()
    expect(workOrder!.serviceItemId).toBe('si_res_007_extra')
    expect(workOrder!.status).toBe('done')

    const oct = byAccount(generateRecurringCharges({ cycleDate: '2026-10-01' }), 'acct_res_007')
    expect(oct.map(c => c.source.id).sort()).toEqual(['si_res_007_extra', 'si_res_007_main'])
    expect(oct.find(c => c.source.id === 'si_res_007_extra')!.description).toBe('Extra 96 gal cart, weekly, Oct 1 to Oct 31')

    const jul = byAccount(generateRecurringCharges({ cycleDate: '2026-07-01' }), 'acct_res_007')
    expect(jul.map(c => c.source.id)).toEqual(['si_res_007_main'])
  })

  it('an item whose effectiveTo is on or before the period start is not billed; one ending later still is', () => {
    db.serviceItems.find(si => si.id === 'si_res_001_main')!.effectiveTo = '2026-10-01'
    db.serviceItems.find(si => si.id === 'si_res_002_main')!.effectiveTo = '2026-10-15'
    const charges = generateRecurringCharges({ cycleDate: '2026-10-01' })
    expect(charges.find(c => c.source.id === 'si_res_001_main')).toBeUndefined()
    expect(charges.find(c => c.source.id === 'si_res_002_main')).toBeDefined()
  })

  it('held and ended service items are not billed', () => {
    db.serviceItems.find(si => si.id === 'si_res_001_main')!.status = 'held'
    db.serviceItems.find(si => si.id === 'si_res_002_main')!.status = 'ended'
    const ids = generateRecurringCharges({ cycleDate: '2026-10-01' }).map(c => c.source.id)
    expect(ids).not.toContain('si_res_001_main')
    expect(ids).not.toContain('si_res_002_main')
  })

  it('acct_pm_oakridge yields four charges on one account, one per site, untaxed', () => {
    const oak = byAccount(generateRecurringCharges({ cycleDate: '2026-10-01' }), 'acct_pm_oakridge')
    expect(oak).toHaveLength(4)
    expect(new Set(oak.map(c => c.siteId)).size).toBe(4)
    for (const c of oak) {
      expect(c.baseCents).toBe(15000)
      expect(c.taxCents).toBe(0)
      expect(c.totalCents).toBe(16150)
    }
  })

  it('a quarterly account yields nothing on 2026-11-01 while monthly accounts still bill', () => {
    const nov = generateRecurringCharges({ cycleDate: '2026-11-01' })
    expect(byAccount(nov, 'acct_res_maple')).toHaveLength(0)
    expect(byAccount(nov, 'acct_res_011')).toHaveLength(0)
    expect(byAccount(nov, 'acct_res_001')).toHaveLength(1)
    expect(byAccount(nov, 'acct_bakery')).toHaveLength(2)
    // 2 bakery + 4 oakridge + 13 generic monthly residential + 8 frontload.
    expect(nov).toHaveLength(27)
  })

  it('nothing is due on a day other than the first of a month', () => {
    expect(generateRecurringCharges({ cycleDate: '2026-10-15' })).toHaveLength(0)
  })

  it('onCall rolloff items and perJob accounts never produce a recurring line (DECISIONS.md entry 24)', () => {
    const charges = generateRecurringCharges({ cycleDate: '2026-10-01' })
    expect(byAccount(charges, 'acct_contractor_hale')).toHaveLength(0)
    expect(byAccount(charges, 'acct_ro_homeowner')).toHaveLength(0)
  })

  it('acct_bakery lines carry contractOverride with the contract id and the override price', () => {
    const bakery = byAccount(generateRecurringCharges({ cycleDate: '2026-10-01' }), 'acct_bakery')
    expect(bakery).toHaveLength(2)
    const main = bakery.find(c => c.catalogId === 'cat_fl_3yd')!
    const wood = bakery.find(c => c.catalogId === 'cat_fl_3yd_wood')!
    expect(main.pricing).toEqual({ ruleWon: 'contractOverride', contractId: 'contract_bakery' })
    expect(main.baseCents).toBe(19800)
    expect(wood.pricing).toEqual({ ruleWon: 'contractOverride', contractId: 'contract_bakery' })
    expect(wood.baseCents).toBe(17100)
    expect(main.description).toBe('3 yd frontload container, 2x weekly, Oct 1 to Oct 31')
  })

  it('running 2026-10-01 twice after posting yields no duplicates (idempotent per serviceItem and period start)', () => {
    const first = generateRecurringCharges({ cycleDate: '2026-10-01' })
    db = appendCharges(db, approved(first))
    db = applyPosting(db, postInvoices({ chargeIds: first.map(c => c.id) }))
    expect(generateRecurringCharges({ cycleDate: '2026-10-01' })).toHaveLength(0)
    // The next cycle is untouched by the October posting.
    expect(generateRecurringCharges({ cycleDate: '2026-11-01' })).toHaveLength(27)
  })

  it('an approved but unposted charge also blocks a duplicate; a proposed or waived one does not', () => {
    const first = generateRecurringCharges({ cycleDate: '2026-10-01' })
    const maple = first.find(c => c.source.id === 'si_maple_96')!
    const holt = first.find(c => c.source.id === 'si_holt_96')!
    const oak = first.find(c => c.source.id === 'si_oak_1')!
    db = appendCharges(db, [{ ...maple, status: 'approved' }, { ...holt, status: 'proposed' }, { ...oak, status: 'waived' }])
    const again = generateRecurringCharges({ cycleDate: '2026-10-01' }).map(c => c.source.id)
    expect(again).not.toContain('si_maple_96')
    expect(again).toContain('si_holt_96')
    expect(again).toContain('si_oak_1')
  })

  it('does not mutate the db: charges are returned, not appended', () => {
    const before = JSON.stringify(db)
    generateRecurringCharges({ cycleDate: '2026-10-01' })
    expect(JSON.stringify(db)).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// generateEventCharges
// ---------------------------------------------------------------------------

describe('generateEventCharges', () => {
  it('five in window exception events produce five event charges with matching evidenceIds, plus two overages', () => {
    const charges = generateEventCharges()
    const events = charges.filter(c => c.source.type === 'serviceEvent')
    const overages = charges.filter(c => c.source.type === 'scaleTicket')
    expect(events).toHaveLength(5)
    expect(overages).toHaveLength(2)
    expect(charges).toHaveLength(7)

    const expected: Record<string, [string, number, string]> = {
      evt_maple_extrabags: ['acct_res_maple', eventRates.extraBags, 'Extra bags, Sep 7'],
      evt_res014_overload: ['acct_res_014', eventRates.overload, 'Overloaded cart, Sep 8'],
      evt_fl003_dryrun: ['acct_fl_003', eventRates.dryRun, 'Dry run, Sep 2'],
      evt_hale_dryrun: ['acct_contractor_hale', eventRates.dryRun, 'Dry run, Sep 3'],
      evt_bakery_contam: ['acct_bakery', eventRates.contamination, 'Contamination, Sep 9'],
    }
    for (const [eventId, [accountId, baseCents, description]] of Object.entries(expected)) {
      const c = events.find(x => x.source.id === eventId)
      expect(c, eventId).toBeDefined()
      expect(c!.accountId).toBe(accountId)
      expect(c!.baseCents).toBe(baseCents)
      expect(c!.description).toBe(description)
      expect(c!.evidenceIds).toEqual([eventId])
      expect(c!.lineType).toBe('event')
      expect(c!.status).toBe('proposed')
      expect(c!.pricing.ruleWon).toBe('standardRate')
      const event = db.serviceEvents.find(e => e.id === eventId)!
      expect(c!.servicedOn).toBe(event.date)
      expect(c!.siteId).toBe(event.siteId)
    }
  })

  it('historical exception events that already carry a charge (evt_hist_*) are not billed again', () => {
    const ids = generateEventCharges().map(c => c.source.id)
    const historical = db.serviceEvents.filter(e => e.id.startsWith('evt_hist_'))
    expect(historical).toHaveLength(7)
    for (const e of historical) expect(ids).not.toContain(e.id)
  })

  it('ticket_hale_1 gives base 8400 and ticket_hale_2 gives base 3850, with ticket and work order as evidence', () => {
    const charges = generateEventCharges()
    const one = charges.find(c => c.source.id === 'ticket_hale_1')!
    const two = charges.find(c => c.source.id === 'ticket_hale_2')!
    expect(one.baseCents).toBe(8400)
    expect(one.description).toBe('Overage 1.20 t over 3 t cap')
    expect(one.evidenceIds).toEqual(['ticket_hale_1', 'wo_hale_haul_1'])
    expect(one.catalogId).toBe('cat_ro_20yd')
    expect(one.accountId).toBe('acct_contractor_hale')
    expect(one.siteId).toBe('site_hale_a')
    expect(one.servicedOn).toBe('2026-09-03')
    expect(one.lineType).toBe('event')
    expect(one.source).toEqual({ type: 'scaleTicket', id: 'ticket_hale_1' })

    expect(two.baseCents).toBe(3850)
    expect(two.description).toBe('Overage 0.55 t over 3 t cap')
    expect(two.evidenceIds).toEqual(['ticket_hale_2', 'wo_hale_haul_2'])
    expect(two.siteId).toBe('site_hale_b')
  })

  it('ticket_hale_3 (4900 lb, under the 3 t cap) produces nothing', () => {
    const charges = generateEventCharges()
    expect(charges.find(c => c.source.id === 'ticket_hale_3')).toBeUndefined()
    expect(db.scaleTickets.find(t => t.id === 'ticket_hale_3')!.workOrderId).toBe('wo_hale_haul_3')
  })

  it('a ticket exactly at the cap produces nothing; one pound over produces a one cent line', () => {
    db.scaleTickets.find(t => t.id === 'ticket_hale_3')!.netLbs = 6000
    expect(generateEventCharges().find(c => c.source.id === 'ticket_hale_3')).toBeUndefined()
    db.scaleTickets.find(t => t.id === 'ticket_hale_3')!.netLbs = 6001
    const c = generateEventCharges().find(x => x.source.id === 'ticket_hale_3')!
    expect(c.baseCents).toBe(Math.round((1 / 2000) * 7000))
  })

  it('notOut exceptions produce nothing', () => {
    db.serviceEvents.push({
      id: 'evt_test_notout', siteId: 'site_res_001', routeId: 'route_mon_res', date: '2026-09-07',
      outcome: 'missed', exception: 'notOut', driver: 'Marcus Bell',
    })
    expect(generateEventCharges().find(c => c.source.id === 'evt_test_notout')).toBeUndefined()
  })

  it('invariant 4: an exception event on a suspended account produces nothing', () => {
    db.serviceEvents.push({
      id: 'evt_test_kerr_extrabags', siteId: 'site_kerr', routeId: 'route_tue_res', date: '2026-09-08',
      outcome: 'completed', exception: 'extraBags', photoUrl: '/evidence/x.jpg', driver: 'Tasha Green',
    })
    const charges = generateEventCharges()
    expect(charges.find(c => c.source.id === 'evt_test_kerr_extrabags')).toBeUndefined()
    expect(byAccount(charges, 'acct_res_kerr')).toHaveLength(0)
  })

  it('running twice produces no duplicates once the first run is committed, whatever the charge status', () => {
    const first = generateEventCharges()
    const statuses: Charge['status'][] = ['proposed', 'approved', 'waived', 'posted']
    db = appendCharges(db, first.map((c, i) => ({ ...c, status: statuses[i % statuses.length] })))
    expect(generateEventCharges()).toHaveLength(0)
  })

  it('each event charge carries fuel and tax (fuel applies to event lines, env fee does not)', () => {
    for (const c of generateEventCharges()) {
      expect(c.fees.map(f => f.feeRuleId)).toEqual(['fee_fuel_7pct'])
      expect(c.fees[0].cents).toBe(Math.round(c.baseCents * 0.07))
      expect(c.taxCents).toBe(Math.round((c.baseCents + c.fees[0].cents) * 0.07))
      expect(c.totalCents).toBe(c.baseCents + c.fees[0].cents + c.taxCents)
    }
    const maple = generateEventCharges().find(c => c.source.id === 'evt_maple_extrabags')!
    expect(maple.fees[0].cents).toBe(18)
    expect(maple.taxCents).toBe(19)
    expect(maple.totalCents).toBe(287)
  })

  it('invariant 2: every generated charge carries base, fees, tax, source, and ruleWon', () => {
    const all = [...generateRecurringCharges({ cycleDate: '2026-10-01' }), ...generateEventCharges()]
    expect(all.length).toBeGreaterThan(0)
    for (const c of all) {
      expect(typeof c.baseCents).toBe('number')
      expect(Array.isArray(c.fees)).toBe(true)
      expect(typeof c.taxCents).toBe('number')
      expect(c.source.type).toBeTruthy()
      expect(c.source.id).toBeTruthy()
      expect(c.pricing.ruleWon).toBeTruthy()
    }
  })

  it('does not mutate the db', () => {
    const before = JSON.stringify(db)
    generateEventCharges()
    expect(JSON.stringify(db)).toBe(before)
  })
})
