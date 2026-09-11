/**
 * Addendum C2: every engine function that reads the db takes an optional trailing db. With it, the call reads that
 * db and leaves the bound one in place; without it, behaviour is exactly the bound form's.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadSeed } from '../seed'
import { clearEngineDb, getEngineDb, hasEngineDb, setEngineDb, type Db } from './db'
import {
  allocate, allocatedTo, computeCharge, findAccount, findCatalog, findSite, generateEventCharges, generateRecurringCharges,
  invoiceBalance, nextChargeId, postInvoices, resetChargeIds, resolvePrice, unappliedFor,
} from './engine'

let bound: Db
let other: Db

beforeEach(() => {
  resetChargeIds()
  bound = loadSeed()
  other = loadSeed()
  // Make the two worlds disagree so a read from the wrong one shows: Maple on portal delivery in `other`, cat_res_96 repriced.
  other.accounts = other.accounts.map(a => (a.id === 'acct_res_maple' ? { ...a, deliveryMethod: 'portal' as const } : a))
  other.contracts = []
  other.rateVersions = other.rateVersions.map(rv => (rv.id === 'rv_res_96_2026' ? { ...rv, priceCents: 9999 } : rv))
})

afterEach(() => {
  clearEngineDb()
  resetChargeIds()
})

const MAPLE_96 = { catalogId: 'cat_res_96', frequency: 'weekly' as const, zoneId: 'zone_open', accountId: 'acct_res_maple', onDate: '2026-10-01' }

describe('trailing db parameter (addendum C2)', () => {
  it('reads the given db and restores the previous binding afterwards', () => {
    setEngineDb(bound)
    expect(findAccount('acct_res_maple', other).deliveryMethod).toBe('portal')
    expect(getEngineDb()).toBe(bound)
    expect(findAccount('acct_res_maple').deliveryMethod).not.toBe('portal')
  })

  it('works when nothing is bound, and leaves nothing bound', () => {
    clearEngineDb()
    expect(findSite('site_maple', other).accountId).toBe('acct_res_maple')
    expect(hasEngineDb()).toBe(false)
    expect(() => findSite('site_maple')).toThrow(/Engine db is not set/)
  })

  it('resolvePrice and computeCharge price from the given db', () => {
    setEngineDb(bound)
    expect(resolvePrice(MAPLE_96, other).priceCents).toBe(9999)
    expect(resolvePrice(MAPLE_96).priceCents).toBe(2900)
    const c = computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'event', baseCents: 250, servicedOn: '2026-09-07',
      source: { type: 'manual', id: 'x' }, id: 'chg_test',
    }, other)
    expect(c.totalCents).toBe(computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'event', baseCents: 250, servicedOn: '2026-09-07',
      source: { type: 'manual', id: 'x' }, id: 'chg_test',
    }).totalCents)
    expect(findCatalog('cat_res_96', other)?.id).toBe('cat_res_96')
  })

  it('generators and posting give the same rows in both forms on the same db', () => {
    setEngineDb(bound)
    const a = generateRecurringCharges({ cycleDate: '2026-10-01' })
    resetChargeIds()
    const b = generateRecurringCharges({ cycleDate: '2026-10-01' }, loadSeed())
    expect(b).toEqual(a)
    resetChargeIds()
    const events = generateEventCharges()
    resetChargeIds()
    expect(generateEventCharges(loadSeed())).toEqual(events)
  })

  it('postInvoices refuses unknown charges from the given db the same way', () => {
    setEngineDb(bound)
    expect(() => postInvoices({ chargeIds: ['nope'] }, other)).toThrow(/unknown charge nope/)
    expect(postInvoices({ chargeIds: [] }, other)).toEqual([])
  })

  it('allocation helpers read the given db', () => {
    clearEngineDb()
    const db = loadSeed()
    const inv = db.invoices[0]
    expect(invoiceBalance(inv.id, db)).toBe(inv.totalCents - allocatedTo(inv.id, db))
    const pay = db.payments.find(p => p.id === 'pay_chk_unknown')!
    expect(unappliedFor(pay.id, db)).toBe(pay.cents)
    const open = db.invoices.find(i => i.accountId === pay.accountId && invoiceBalance(i.id, db) > 0)!
    const rows = allocate({ sourceType: 'payment', sourceId: pay.id, invoiceIds: [open.id], cents: [100] }, db)
    expect(rows).toEqual([{ sourceType: 'payment', sourceId: pay.id, invoiceId: open.id, cents: 100 }])
    expect(nextChargeId(db)).toMatch(/^chg_bl_\d{4}$/)
    expect(hasEngineDb()).toBe(false)
  })
})
