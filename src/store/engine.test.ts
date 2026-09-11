import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadSeed } from '../seed'
import type { Charge, RateVersion } from '../types'
import { clearEngineDb, emptyDb, getEngineDb, setEngineDb, withEngineDb, type Db } from './db'
import { computeCharge, eventRates, generateRecurringCharges, resetChargeIds, resolvePrice, setChargeIdGenerator } from './engine'

let db: Db

beforeEach(() => {
  db = loadSeed()
  setEngineDb(db)
  resetChargeIds()
})

afterEach(() => {
  clearEngineDb()
  resetChargeIds()
})

// ---------------------------------------------------------------------------
// db context
// ---------------------------------------------------------------------------

describe('engine db context', () => {
  it('getEngineDb throws a clear error when nothing is bound', () => {
    clearEngineDb()
    expect(() => getEngineDb()).toThrow(/setEngineDb/)
  })

  it('accepts a getter so a store can bind live state', () => {
    let live = emptyDb()
    setEngineDb(() => live)
    expect(getEngineDb().accounts).toHaveLength(0)
    live = loadSeed()
    expect(getEngineDb().accounts.length).toBeGreaterThan(0)
  })

  it('withEngineDb swaps the db for the callback and restores it after, even on throw', () => {
    const scratch = emptyDb()
    const seen = withEngineDb(scratch, () => getEngineDb())
    expect(seen).toBe(scratch)
    expect(getEngineDb()).toBe(db)
    expect(() => withEngineDb(scratch, () => { throw new Error('boom') })).toThrow('boom')
    expect(getEngineDb()).toBe(db)
  })

  it('event rate table is typed from seed/eventRates.json', () => {
    expect(eventRates).toEqual({ extraBags: 250, overload: 1000, contamination: 2000, dryRun: 2500 })
  })
})

// ---------------------------------------------------------------------------
// resolvePrice
// ---------------------------------------------------------------------------

describe('resolvePrice precedence', () => {
  it('contract override wins for acct_bakery cat_fl_3yd: 19800, contractOverride, contract_bakery', () => {
    const r = resolvePrice({ catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', accountId: 'acct_bakery', onDate: '2026-10-01' })
    expect(r).toEqual({ priceCents: 19800, contractId: 'contract_bakery', ruleWon: 'contractOverride' })
    expect(r.rateVersionId).toBeUndefined()
  })

  it('contract override only applies when the override frequency matches the requested one', () => {
    // The bakery override is for 2x. Asking for weekly falls through to the rate card, which has no weekly 3yd rate.
    expect(() => resolvePrice({ catalogId: 'cat_fl_3yd', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_bakery', onDate: '2026-10-01' }))
      .toThrow(/cat_fl_3yd/)
  })

  it('contract override without a frequency matches any frequency', () => {
    db.contracts.push({
      id: 'contract_test', accountId: 'acct_res_001', termStart: '2026-01-01', termEnd: '2026-12-31', renewalNoticeDays: 30,
      overrides: [{ catalogId: 'cat_res_96', priceCents: 2500 }],
    })
    const r = resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_001', onDate: '2026-10-01' })
    expect(r).toEqual({ priceCents: 2500, contractId: 'contract_test', ruleWon: 'contractOverride' })
  })

  it('contract override does not apply before the contract term starts', () => {
    db.contracts.find(c => c.id === 'contract_bakery')!.termStart = '2026-10-01'
    const r = resolvePrice({ catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', accountId: 'acct_bakery', onDate: '2026-09-10' })
    expect(r.ruleWon).toBe('zoneRate')
    expect(r.priceCents).toBe(22000)
  })

  it('3.7e: the first matching override in a contract wins; later rows for the same item are history', () => {
    // Pricing writes a new override first and keeps the older rows after it (pricing PORT_DECISIONS.md P2, request 2).
    // If this ever becomes "last wins", contractWithOverride in src/surfaces/pricing/lib/contracts.ts must write last.
    db.contracts.push({
      id: 'contract_order', accountId: 'acct_res_001', termStart: '2026-01-01', termEnd: '2026-12-31', renewalNoticeDays: 30,
      overrides: [
        { catalogId: 'cat_res_96', frequency: 'weekly', priceCents: 2400, reason: 'newest, written first' },
        { catalogId: 'cat_res_96', frequency: 'weekly', priceCents: 2600, reason: 'older, kept as history' },
      ],
    })
    const args = { catalogId: 'cat_res_96', frequency: 'weekly' as const, zoneId: 'zone_open', accountId: 'acct_res_001', onDate: '2026-10-01' }
    expect(resolvePrice(args)).toEqual({ priceCents: 2400, contractId: 'contract_order', ruleWon: 'contractOverride' })

    // "Matching" means catalog and frequency: a first row for another frequency is skipped, a wildcard row matches.
    db.contracts.at(-1)!.overrides.unshift({ catalogId: 'cat_res_96', frequency: 'eow', priceCents: 1000 })
    expect(resolvePrice(args).priceCents).toBe(2400)
    db.contracts.at(-1)!.overrides.unshift({ catalogId: 'cat_res_96', priceCents: 2200 })
    expect(resolvePrice(args).priceCents).toBe(2200)
    // The billing run bills the same row.
    const run = generateRecurringCharges({ cycleDate: '2026-10-01' }).find(c => c.source.id === 'si_res_001_main')!
    expect([run.baseCents, run.pricing]).toEqual([2200, { contractId: 'contract_order', ruleWon: 'contractOverride' }])
  })

  it('3.7f: past termEnd a contract auto-renews for a term of the same length, with the escalator on each anniversary', () => {
    // A fixture that lapsed: April 2025 to March 2026, 5% fixed escalator from its first anniversary, 2026-04-01.
    db.contracts.push({
      id: 'contract_lapsed', accountId: 'acct_res_001', termStart: '2025-04-01', termEnd: '2026-03-31', renewalNoticeDays: 60,
      overrides: [{ catalogId: 'cat_res_96', frequency: 'weekly', priceCents: 2500, reason: 'fixture' }],
      escalator: { kind: 'fixedPct', pct: 5, anniversary: '2026-04-01' },
    })
    const on = (onDate: string) => resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_001', onDate })
    // Inside the signed term: the override as written, no renewal, no escalation yet.
    expect(on('2026-03-31')).toEqual({ priceCents: 2500, contractId: 'contract_lapsed', ruleWon: 'contractOverride' })
    // First renewed term, 2026-04-01 to 2027-03-31: one escalation, 2500 x 1.05.
    expect(on('2026-04-01')).toEqual({ priceCents: 2625, contractId: 'contract_lapsed', ruleWon: 'contractOverride', renewedOn: '2026-04-01', escalations: 1 })
    expect(on('2026-10-01')).toEqual({ priceCents: 2625, contractId: 'contract_lapsed', ruleWon: 'contractOverride', renewedOn: '2026-04-01', escalations: 1 })
    expect(on('2027-03-31').renewedOn).toBe('2026-04-01')
    // Second renewal: compounded and rounded after each step (addendum C6), 2625 x 1.05 = 2756.25, so 2756.
    expect(on('2027-04-01')).toEqual({ priceCents: 2756, contractId: 'contract_lapsed', ruleWon: 'contractOverride', renewedOn: '2027-04-01', escalations: 2 })
    // The billing run for October bills the renewed, escalated price.
    const run = generateRecurringCharges({ cycleDate: '2026-10-01' }).find(c => c.source.id === 'si_res_001_main')!
    expect([run.baseCents, run.pricing]).toEqual([2625, { contractId: 'contract_lapsed', ruleWon: 'contractOverride' }])
  })

  it('3.7f: the seed bakery contract renews on 2027-01-01 at its 4% escalator', () => {
    const r = resolvePrice({ catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', accountId: 'acct_bakery', onDate: '2027-02-01' })
    expect(r).toEqual({ priceCents: 20592, contractId: 'contract_bakery', ruleWon: 'contractOverride', renewedOn: '2027-01-01', escalations: 1 })
  })

  it('3.7f: a term that is not whole months renews by its day count', () => {
    db.contracts.push({
      id: 'contract_days', accountId: 'acct_res_001', termStart: '2026-01-10', termEnd: '2026-02-20', renewalNoticeDays: 10,
      overrides: [{ catalogId: 'cat_res_96', priceCents: 2000 }],
    })
    // 42 days: the first renewal runs 2026-02-21 to 2026-04-03, the second from 2026-04-04.
    const on = (onDate: string) => resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_001', onDate })
    expect(on('2026-04-03')).toMatchObject({ priceCents: 2000, renewedOn: '2026-02-21' })
    expect(on('2026-04-04')).toMatchObject({ priceCents: 2000, renewedOn: '2026-04-04' })
  })

  it('3.7f and K3: a lapsed contract replaced by a newer contract on the account does not renew', () => {
    db.contracts.push(
      { id: 'contract_old', accountId: 'acct_res_001', termStart: '2025-01-01', termEnd: '2025-12-31', renewalNoticeDays: 60, overrides: [{ catalogId: 'cat_res_96', priceCents: 2500 }] },
      { id: 'contract_acct_res_001_20260910', accountId: 'acct_res_001', termStart: '2026-09-10', termEnd: '2027-09-09', renewalNoticeDays: 60, overrides: [{ catalogId: 'cat_res_96', priceCents: 2300 }] },
    )
    const on = (onDate: string) => resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_001', onDate })
    // Before the new contract starts, the old one is still auto-renewed.
    expect(on('2026-09-01')).toMatchObject({ priceCents: 2500, contractId: 'contract_old', renewedOn: '2026-01-01' })
    // From its start the new contract wins and the old one is history.
    expect(on('2026-10-01')).toEqual({ priceCents: 2300, contractId: 'contract_acct_res_001_20260910', ruleWon: 'contractOverride' })
  })

  it('another account does not inherit the bakery override', () => {
    const r = resolvePrice({ catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', accountId: 'acct_fl_001', onDate: '2026-10-01' })
    expect(r).toEqual({ priceCents: 22000, rateVersionId: 'rv_fl_3yd_2026', ruleWon: 'zoneRate' })
  })

  it('zone rate for acct_res_maple cat_res_96 on 2026-10-01: 2900, zoneRate, rv_res_96_2026', () => {
    const r = resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_maple', onDate: '2026-10-01' })
    expect(r).toEqual({ priceCents: 2900, rateVersionId: 'rv_res_96_2026', ruleWon: 'zoneRate' })
  })

  it('zone rate picks the boundary copy, at its own higher price, for a boundary zone site (addendum C4, Phase 3.7c)', () => {
    const r = resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_boundary', accountId: 'acct_res_maple', onDate: '2026-10-01' })
    expect(r).toEqual({ priceCents: 3100, rateVersionId: 'rv_res_96_2026_boundary', ruleWon: 'zoneRate' })
  })

  it('cat_res_64 resolves 2600 on 2026-09-30 and 2700 on 2026-10-01 (latest effectiveFrom not after onDate)', () => {
    const before = resolvePrice({ catalogId: 'cat_res_64', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_005', onDate: '2026-09-30' })
    const after = resolvePrice({ catalogId: 'cat_res_64', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_005', onDate: '2026-10-01' })
    expect(before).toEqual({ priceCents: 2600, rateVersionId: 'rv_res_64_2026', ruleWon: 'zoneRate' })
    expect(after).toEqual({ priceCents: 2700, rateVersionId: 'rv_res_64_2026q4', ruleWon: 'zoneRate' })
  })

  it('accepts a full timestamp for onDate and compares by calendar day', () => {
    const r = resolvePrice({ catalogId: 'cat_res_64', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_005', onDate: '2026-10-01T00:00:00-04:00' })
    expect(r.priceCents).toBe(2700)
  })

  it('a draft version is ignored even when it is newer and cheaper', () => {
    const draft: RateVersion = {
      id: 'rv_res_96_draft', catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly',
      priceCents: 9999, effectiveFrom: '2026-06-01', status: 'draft',
    }
    db.rateVersions.push(draft)
    const r = resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_maple', onDate: '2026-10-01' })
    expect(r).toEqual({ priceCents: 2900, rateVersionId: 'rv_res_96_2026', ruleWon: 'zoneRate' })
  })

  it('a version effective after onDate is ignored', () => {
    db.rateVersions.push({
      id: 'rv_res_96_future', catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly',
      priceCents: 3100, effectiveFrom: '2026-11-01', status: 'published', publishedAt: '2026-09-10T10:00:00-04:00', supersedesId: 'rv_res_96_2026',
    })
    const oct = resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_maple', onDate: '2026-10-01' })
    const nov = resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_maple', onDate: '2026-11-01' })
    expect(oct.rateVersionId).toBe('rv_res_96_2026')
    expect(oct.priceCents).toBe(2900)
    expect(nov.rateVersionId).toBe('rv_res_96_future')
    expect(nov.priceCents).toBe(3100)
  })

  it('falls back to a published version with no zone (standardRate) when the zone has no rate', () => {
    db.rateVersions.push({
      id: 'rv_fl_2yd_standard', catalogId: 'cat_fl_2yd', frequency: 'weekly',
      priceCents: 16000, effectiveFrom: '2026-01-01', status: 'published', publishedAt: '2025-12-15T09:00:00-05:00',
    })
    const franchise = resolvePrice({ catalogId: 'cat_fl_2yd', frequency: 'weekly', zoneId: 'zone_franchise', accountId: 'acct_pm_oakridge', onDate: '2026-10-01' })
    expect(franchise).toEqual({ priceCents: 16000, rateVersionId: 'rv_fl_2yd_standard', ruleWon: 'standardRate' })
    // The zone rate still wins where one exists.
    const open = resolvePrice({ catalogId: 'cat_fl_2yd', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_pm_oakridge', onDate: '2026-10-01' })
    expect(open).toEqual({ priceCents: 15000, rateVersionId: 'rv_fl_2yd_2026', ruleWon: 'zoneRate' })
  })

  it('a rate version with no frequency is a wildcard for any requested frequency', () => {
    db.rateVersions.push({
      id: 'rv_any_freq', catalogId: 'cat_fl_2yd', zoneId: 'zone_franchise',
      priceCents: 17000, effectiveFrom: '2026-01-01', status: 'published', publishedAt: '2025-12-15T09:00:00-05:00',
    })
    const r = resolvePrice({ catalogId: 'cat_fl_2yd', frequency: '3x', zoneId: 'zone_franchise', accountId: 'acct_pm_oakridge', onDate: '2026-10-01' })
    expect(r).toEqual({ priceCents: 17000, rateVersionId: 'rv_any_freq', ruleWon: 'zoneRate' })
  })

  it('a catalog with no rate throws an Error naming the catalogId, zoneId, and date', () => {
    expect(() => resolvePrice({ catalogId: 'cat_missing', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_maple', onDate: '2026-10-01' }))
      .toThrow('No published rate for cat_missing in zone_open on 2026-10-01')
  })

  it('a catalog whose only version starts after onDate throws', () => {
    expect(() => resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_maple', onDate: '2025-12-31' }))
      .toThrow(/cat_res_96.*zone_open.*2025-12-31/)
  })

  it('does not mutate the db', () => {
    const before = JSON.stringify(db)
    resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_maple', onDate: '2026-10-01' })
    expect(JSON.stringify(db)).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// computeCharge
// ---------------------------------------------------------------------------

const recurringMaple = () => computeCharge({
  accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'recurring', baseCents: 2900,
  period: { start: '2026-10-01', end: '2026-12-31' }, source: { type: 'serviceItem', id: 'si_maple_96' }, catalogId: 'cat_res_96',
  description: '96 gal cart, weekly, Oct 1 to Dec 31',
})

function assertInvariant2(c: Charge) {
  expect(typeof c.baseCents).toBe('number')
  expect(Number.isInteger(c.baseCents)).toBe(true)
  expect(Array.isArray(c.fees)).toBe(true)
  for (const f of c.fees) {
    expect(typeof f.feeRuleId).toBe('string')
    expect(Number.isInteger(f.cents)).toBe(true)
  }
  expect(Number.isInteger(c.taxCents)).toBe(true)
  expect(Number.isInteger(c.totalCents)).toBe(true)
  expect(c.source).toBeDefined()
  expect(['serviceItem', 'serviceEvent', 'scaleTicket', 'manual']).toContain(c.source.type)
  expect(typeof c.source.id).toBe('string')
  expect(['contractOverride', 'zoneRate', 'standardRate', 'manualException']).toContain(c.pricing.ruleWon)
  expect(c.totalCents).toBe(c.baseCents + c.fees.reduce((s, f) => s + f.cents, 0) + c.taxCents)
}

describe('computeCharge fees and tax', () => {
  it('recurring cat_res_96 for acct_res_maple at base 2900 over an Oct to Dec period: fuel 203, env 300 (three whole months, addendum C5), tax 217, total 3620', () => {
    const c = recurringMaple()
    expect(c.baseCents).toBe(2900)
    expect(c.fees).toEqual([
      { feeRuleId: 'fee_fuel_7pct', cents: 203 },
      { feeRuleId: 'fee_env_1', cents: 300 },
    ])
    // tax = round((2900 + 203) * 0.07) = round(217.21) = 217. The env fee is not taxable.
    expect(c.taxCents).toBe(217)
    expect(c.totalCents).toBe(3620)
  })

  it('addendum C5: a flat fee applies once per whole month, so acct_res_maple quarterly 96 gal on 2026-10-01 is base 8700, fuel 609, env 300, tax 652, total 10261', () => {
    const c = computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'recurring', baseCents: 8700, catalogId: 'cat_res_96',
      period: { start: '2026-10-01', end: '2026-12-31' }, source: { type: 'serviceItem', id: 'si_maple_96' },
    })
    expect(c.baseCents).toBe(8700)
    expect(c.fees).toEqual([
      { feeRuleId: 'fee_fuel_7pct', cents: 609 },
      { feeRuleId: 'fee_env_1', cents: 300 },
    ])
    // tax = round((8700 + 609) * 0.07) = round(651.63) = 652. The env fee is not taxable.
    expect(c.taxCents).toBe(652)
    expect(c.totalCents).toBe(10261)
  })

  it('addendum C5: a one month period and a servicedOn line each take the flat fee once', () => {
    const monthly = computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'recurring', baseCents: 2900, catalogId: 'cat_res_96',
      period: { start: '2026-10-01', end: '2026-10-31' }, source: { type: 'serviceItem', id: 'si_maple_96' },
    })
    expect(monthly.fees.find(f => f.feeRuleId === 'fee_env_1')?.cents).toBe(100)
    db.feeRules.find(f => f.id === 'fee_env_1')!.appliesTo.push('fee')
    const dated = computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'fee', baseCents: 2500,
      servicedOn: '2026-10-15', source: { type: 'manual', id: 'delivery_maple' },
    })
    expect(dated.fees.find(f => f.feeRuleId === 'fee_env_1')?.cents).toBe(100)
  })

  it('returns a proposed charge with a chg_bl_ id, catalog, period, description, and empty evidence', () => {
    const c = recurringMaple()
    expect(c.id).toMatch(/^chg_bl_\d{4}$/)
    expect(c.status).toBe('proposed')
    expect(c.catalogId).toBe('cat_res_96')
    expect(c.period).toEqual({ start: '2026-10-01', end: '2026-12-31' })
    expect(c.servicedOn).toBeUndefined()
    expect(c.description).toBe('96 gal cart, weekly, Oct 1 to Dec 31')
    expect(c.evidenceIds).toEqual([])
    expect(c.accountId).toBe('acct_res_maple')
    expect(c.siteId).toBe('site_maple')
    expect(c.lineType).toBe('recurring')
  })

  it('an event line gets the fuel surcharge but not the environmental fee', () => {
    const c = computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'event', baseCents: eventRates.extraBags,
      servicedOn: '2026-09-07', source: { type: 'serviceEvent', id: 'evt_maple_extrabags' }, description: 'Extra bags',
      evidenceIds: ['evt_maple_extrabags'],
    })
    // fuel = round(250 * 0.07) = round(17.5) = 18; tax = round((250 + 18) * 0.07) = round(18.76) = 19
    expect(c.fees).toEqual([{ feeRuleId: 'fee_fuel_7pct', cents: 18 }])
    expect(c.fees.some(f => f.feeRuleId === 'fee_env_1')).toBe(false)
    expect(c.taxCents).toBe(19)
    expect(c.totalCents).toBe(287)
    expect(c.servicedOn).toBe('2026-09-07')
    expect(c.period).toBeUndefined()
    expect(c.evidenceIds).toEqual(['evt_maple_extrabags'])
  })

  it('a fee line (delivery) gets no fuel surcharge because fee_fuel_7pct is on serviceLines and excludes fee, but is taxed', () => {
    const c = computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'fee', baseCents: 2500,
      servicedOn: '2026-09-15', source: { type: 'manual', id: 'delivery_maple' }, description: 'Cart delivery',
    })
    expect(c.fees).toEqual([])
    // tax_zone_open lists fee, so round(2500 * 0.07) = 175
    expect(c.taxCents).toBe(175)
    expect(c.totalCents).toBe(2675)
  })

  it('a lateFee line has zero fees and zero tax even in a taxed zone', () => {
    const c = computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'lateFee', baseCents: 1000,
      servicedOn: '2026-09-20', source: { type: 'manual', id: 'late_maple_2026q3' }, description: 'Late fee',
    })
    expect(c.fees).toEqual([])
    expect(c.taxCents).toBe(0)
    expect(c.totalCents).toBe(1000)
  })

  it('a lateFee line stays untaxed even if a TaxRule wrongly lists lateFee', () => {
    db.taxRules[0].appliesTo.push('lateFee')
    const c = computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'lateFee', baseCents: 1000,
      servicedOn: '2026-09-20', source: { type: 'manual', id: 'late_maple_2026q3' },
    })
    expect(c.taxCents).toBe(0)
  })

  it('a taxExempt account (acct_pm_oakridge) gets taxCents 0 with fees intact', () => {
    expect(db.accounts.find(a => a.id === 'acct_pm_oakridge')?.taxExempt).toBe(true)
    const c = computeCharge({
      accountId: 'acct_pm_oakridge', siteId: 'site_oak_1', lineType: 'recurring', baseCents: 15000,
      period: { start: '2026-10-01', end: '2026-10-31' }, source: { type: 'serviceItem', id: 'si_oak_1' }, catalogId: 'cat_fl_2yd',
    })
    expect(c.fees).toEqual([
      { feeRuleId: 'fee_fuel_7pct', cents: 1050 },
      { feeRuleId: 'fee_env_1', cents: 100 },
    ])
    expect(c.taxCents).toBe(0)
    expect(c.totalCents).toBe(16150)
  })

  it('no tax when the site zone has no TaxRule', () => {
    db.taxRules = db.taxRules.filter(t => t.zoneId !== 'zone_open')
    const c = recurringMaple()
    expect(c.fees.map(f => f.cents)).toEqual([203, 300])
    expect(c.taxCents).toBe(0)
    expect(c.totalCents).toBe(3403)
  })

  it('rounds each fee individually, then rounds tax once on base plus taxable fees', () => {
    // base 1235: fuel = round(86.45) = 86 (not 86.45 carried); tax = round((1235 + 86) * 0.07) = round(92.47) = 92
    const c = computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'recurring', baseCents: 1235,
      period: { start: '2026-10-01', end: '2026-10-31' }, source: { type: 'serviceItem', id: 'si_maple_96' },
      pricing: { ruleWon: 'manualException' },
    })
    expect(c.fees).toEqual([{ feeRuleId: 'fee_fuel_7pct', cents: 86 }, { feeRuleId: 'fee_env_1', cents: 100 }])
    expect(c.taxCents).toBe(92)
    expect(c.totalCents).toBe(1235 + 86 + 100 + 92)
  })

  it('a taxable flat fee is included in the tax base and a non-taxable percent fee is not', () => {
    db.feeRules = [
      { id: 'fee_flat_taxable', name: 'Flat taxable', kind: 'flat', value: 300, base: 'serviceLines', appliesTo: ['recurring'], taxable: true },
      { id: 'fee_pct_untaxed', name: 'Percent untaxed', kind: 'percent', value: 10, base: 'allLines', appliesTo: ['recurring'], taxable: false },
    ]
    const c = computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'recurring', baseCents: 1000,
      period: { start: '2026-10-01', end: '2026-10-31' }, source: { type: 'serviceItem', id: 'si_maple_96' },
      pricing: { ruleWon: 'manualException' },
    })
    expect(c.fees).toEqual([{ feeRuleId: 'fee_flat_taxable', cents: 300 }, { feeRuleId: 'fee_pct_untaxed', cents: 100 }])
    expect(c.taxCents).toBe(Math.round((1000 + 300) * 0.07))
    expect(c.totalCents).toBe(1000 + 300 + 100 + 91)
  })
})

describe('computeCharge pricing', () => {
  it('resolves pricing through resolvePrice with the site zone and account when catalogId is given and no pricing is passed', () => {
    const maple = recurringMaple()
    expect(maple.pricing).toEqual({ rateVersionId: 'rv_res_96_2026', ruleWon: 'zoneRate' })

    const bakery = computeCharge({
      accountId: 'acct_bakery', siteId: 'site_bakery', lineType: 'recurring', baseCents: 19800,
      period: { start: '2026-10-01', end: '2026-10-31' }, source: { type: 'serviceItem', id: 'si_bakery_3yd' }, catalogId: 'cat_fl_3yd',
    })
    expect(bakery.pricing).toEqual({ contractId: 'contract_bakery', ruleWon: 'contractOverride' })
  })

  it('infers the frequency from the site service item, and honors an explicit frequency', () => {
    // si_maple_recycling is eow; only the eow rate exists for recycling.
    const inferred = computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'recurring', baseCents: 1200,
      period: { start: '2026-10-01', end: '2026-12-31' }, source: { type: 'serviceItem', id: 'si_maple_recycling' }, catalogId: 'cat_res_recycling',
    })
    expect(inferred.pricing.rateVersionId).toBe('rv_res_recycling_2026')
    expect(() => computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'recurring', baseCents: 1200, frequency: 'weekly',
      period: { start: '2026-10-01', end: '2026-12-31' }, source: { type: 'serviceItem', id: 'si_maple_recycling' }, catalogId: 'cat_res_recycling',
    })).toThrow(/cat_res_recycling/)
  })

  it('resolves on the period start for recurring lines and on servicedOn for event lines', () => {
    const sept = computeCharge({
      accountId: 'acct_res_005', siteId: 'site_res_005', lineType: 'recurring', baseCents: 2600,
      period: { start: '2026-09-01', end: '2026-09-30' }, source: { type: 'serviceItem', id: 'si_res_005_main' }, catalogId: 'cat_res_64',
    })
    const oct = computeCharge({
      accountId: 'acct_res_005', siteId: 'site_res_005', lineType: 'recurring', baseCents: 2700,
      period: { start: '2026-10-01', end: '2026-10-31' }, source: { type: 'serviceItem', id: 'si_res_005_main' }, catalogId: 'cat_res_64',
    })
    expect(sept.pricing.rateVersionId).toBe('rv_res_64_2026')
    expect(oct.pricing.rateVersionId).toBe('rv_res_64_2026q4')
  })

  it('uses caller supplied pricing as given', () => {
    const c = computeCharge({
      accountId: 'acct_contractor_hale', siteId: 'site_hale_a', lineType: 'event', baseCents: 8400,
      servicedOn: '2026-09-03', source: { type: 'scaleTicket', id: 'ticket_hale_1' }, catalogId: 'cat_ro_20yd',
      pricing: { ruleWon: 'standardRate' }, evidenceIds: ['ticket_hale_1', 'wo_hale_haul_1'],
    })
    expect(c.pricing).toEqual({ ruleWon: 'standardRate' })
    expect(c.evidenceIds).toEqual(['ticket_hale_1', 'wo_hale_haul_1'])
  })

  it('defaults pricing to standardRate when there is no catalog, and manualException for manual sources without a catalog', () => {
    const late = computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'lateFee', baseCents: 1000,
      servicedOn: '2026-09-20', source: { type: 'manual', id: 'late_1' },
    })
    expect(late.pricing).toEqual({ ruleWon: 'manualException' })
    const evt = computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'event', baseCents: 250,
      servicedOn: '2026-09-07', source: { type: 'serviceEvent', id: 'evt_maple_extrabags' },
    })
    expect(evt.pricing).toEqual({ ruleWon: 'standardRate' })
  })

  it('copies the source and evidence arrays rather than sharing caller references', () => {
    const source = { type: 'serviceEvent' as const, id: 'evt_maple_extrabags' }
    const evidenceIds = ['evt_maple_extrabags']
    const c = computeCharge({ accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'event', baseCents: 250, servicedOn: '2026-09-07', source, evidenceIds })
    evidenceIds.push('tampered')
    source.id = 'tampered'
    expect(c.evidenceIds).toEqual(['evt_maple_extrabags'])
    expect(c.source.id).toBe('evt_maple_extrabags')
  })
})

describe('computeCharge ids and validation', () => {
  it('mints chg_bl_ ids (addendum C12) that are sequential and deterministic after resetChargeIds', () => {
    const a = recurringMaple()
    const b = recurringMaple()
    expect(a.id).toBe('chg_bl_0001')
    expect(b.id).toBe('chg_bl_0002')
    resetChargeIds()
    expect(recurringMaple().id).toBe('chg_bl_0001')
  })

  it('starts the counter above the highest chg_bl_ suffix already in the db', () => {
    db.charges.push({ ...recurringMaple(), id: 'chg_bl_0002' })
    resetChargeIds()
    expect(recurringMaple().id).toBe('chg_bl_0003')
    const row = recurringMaple() // chg_bl_0004
    db.charges.push({ ...row, id: 'chg_bl_0041' })
    expect(recurringMaple().id).toBe('chg_bl_0042')
    // Ids with other shapes (seed names, old chg_0001 style, prefixed non-numeric) never move the counter.
    db.charges.push({ ...row, id: 'chg_0900' }, { ...row, id: 'chg_bl_prior_7' })
    expect(recurringMaple().id).toBe('chg_bl_0043')
  })

  it('accepts an injected id generator and an explicit id', () => {
    let n = 100
    setChargeIdGenerator(() => `chg_test_${n++}`)
    expect(recurringMaple().id).toBe('chg_test_100')
    expect(recurringMaple().id).toBe('chg_test_101')
    expect(computeCharge({
      accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'recurring', baseCents: 2900, id: 'chg_explicit',
      period: { start: '2026-10-01', end: '2026-12-31' }, source: { type: 'serviceItem', id: 'si_maple_96' }, catalogId: 'cat_res_96',
    }).id).toBe('chg_explicit')
  })

  it('throws on an unknown account or site, a missing date, or non-integer cents', () => {
    const base = { lineType: 'recurring' as const, baseCents: 2900, period: { start: '2026-10-01', end: '2026-12-31' }, source: { type: 'serviceItem' as const, id: 'si_maple_96' } }
    expect(() => computeCharge({ ...base, accountId: 'acct_nope', siteId: 'site_maple' })).toThrow('Unknown account acct_nope')
    expect(() => computeCharge({ ...base, accountId: 'acct_res_maple', siteId: 'site_nope' })).toThrow('Unknown site site_nope')
    expect(() => computeCharge({ ...base, period: undefined, accountId: 'acct_res_maple', siteId: 'site_maple' })).toThrow(/servicedOn or period/)
    expect(() => computeCharge({ ...base, baseCents: 29.5, accountId: 'acct_res_maple', siteId: 'site_maple' })).toThrow(/integer cents/)
  })

  it('does not mutate the db (charges are returned, not appended)', () => {
    const before = JSON.stringify(db)
    recurringMaple()
    expect(JSON.stringify(db)).toBe(before)
  })
})

describe('invariant 2: every charge carries base, fees, tax, source, and ruleWon', () => {
  it('holds for recurring, event, fee, lateFee, contract, and taxExempt charges from computeCharge', () => {
    const charges: Charge[] = [
      recurringMaple(),
      computeCharge({ accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'event', baseCents: eventRates.overload, servicedOn: '2026-09-08', source: { type: 'serviceEvent', id: 'evt_res014_overload' } }),
      computeCharge({ accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'fee', baseCents: 2500, servicedOn: '2026-09-15', source: { type: 'manual', id: 'delivery' } }),
      computeCharge({ accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'lateFee', baseCents: 1000, servicedOn: '2026-09-20', source: { type: 'manual', id: 'late' } }),
      computeCharge({ accountId: 'acct_bakery', siteId: 'site_bakery', lineType: 'recurring', baseCents: 17100, period: { start: '2026-10-01', end: '2026-10-31' }, source: { type: 'serviceItem', id: 'si_bakery_wood' }, catalogId: 'cat_fl_3yd_wood' }),
      computeCharge({ accountId: 'acct_pm_oakridge', siteId: 'site_oak_2', lineType: 'recurring', baseCents: 15000, period: { start: '2026-10-01', end: '2026-10-31' }, source: { type: 'serviceItem', id: 'si_oak_2' }, catalogId: 'cat_fl_2yd' }),
      computeCharge({ accountId: 'acct_contractor_hale', siteId: 'site_hale_a', lineType: 'event', baseCents: 8400, servicedOn: '2026-09-03', source: { type: 'scaleTicket', id: 'ticket_hale_1' }, catalogId: 'cat_ro_20yd', pricing: { ruleWon: 'standardRate' } }),
    ]
    for (const c of charges) assertInvariant2(c)
  })

  it('also holds for every historical charge in the seed', () => {
    expect(db.charges.length).toBeGreaterThan(0)
    for (const c of db.charges) assertInvariant2(c)
  })
})
