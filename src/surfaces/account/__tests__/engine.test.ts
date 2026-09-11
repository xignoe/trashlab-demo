/**
 * Account surface on the canonical engine (box 2A.5). Moved from account/src/store/engine.test.ts: the prototype's own
 * engine is gone, so the tests of its pricing and charge internals now live in billing's engine suites (src/store/*.test.ts,
 * see PORT_DECISIONS.md). What stays here is everything the account view adds on top of the canonical engine, asserted
 * against billing's seed (the merged seed), with the figures that seed produces.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadSeed } from '../../../seed'
import { setToday } from '../../../store/clock'
import type { Db } from '../../../store/db'
import { generateRecurringCharges, nextChargeId, resetChargeIds } from '../../../store/engine'
import { useStore } from '../../../store/useStore'
import type { Charge, ServiceCatalog } from '../../../types'
import { withRows } from '../lib/db'
import {
  EngineError, accountBalance, allocateChecked, buildReinstatementFee, explainPrice, itemStatusForAccountStatus, nextCycleDate,
  openBalance, pastDue, planServiceChange, previewNextRun, statusAfterReinstatement,
} from '../lib/engine'
import { highestSuffix, nextId, nextSerial } from '../lib/ids'

let db: Db
beforeEach(() => {
  db = loadSeed()
  useStore.getState().reset()
})
afterEach(() => setToday())

const fees = (c: Charge) => c.fees.reduce((s, f) => s + f.cents, 0)

/** Invariant 2: every charge carries base, fees, tax, source, and ruleWon, and its total adds up. */
function expectInvariant2(c: Charge) {
  expect(Number.isInteger(c.baseCents)).toBe(true)
  expect(Array.isArray(c.fees)).toBe(true)
  expect(Number.isInteger(c.taxCents)).toBe(true)
  expect(c.source.id).toBeTruthy()
  expect(c.pricing.ruleWon).toBeTruthy()
  expect(c.totalCents).toBe(c.baseCents + fees(c) + c.taxCents)
}

describe('explainPrice (the "why this price" chain on the canonical resolvePrice)', () => {
  it('bakery 3 yd: contract 19800 won over the 22000 zone rate rv_fl_3yd_2026, 10% below for competitive match', () => {
    const e = explainPrice({ catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', accountId: 'acct_bakery', onDate: '2026-09-10' }, db)
    expect(e.ruleWon).toBe('contractOverride')
    expect(e.priceCents).toBe(19800)
    expect(e.contractOverride).toMatchObject({ contractId: 'contract_bakery', priceCents: 19800, pctBelowRateCard: 10, reason: 'competitive match', termEnd: '2026-12-31' })
    expect(e.rateVersion).toMatchObject({ id: 'rv_fl_3yd_2026', priceCents: 22000, ruleWon: 'zoneRate' })
  })

  it('maple 96 gal: zone rate rv_res_96_2026 wins with no contract and no superseded version', () => {
    const e = explainPrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_maple', onDate: '2026-09-10' }, db)
    expect(e).toMatchObject({ ruleWon: 'zoneRate', priceCents: 2900 })
    expect(e.contractOverride).toBeUndefined()
    expect(e.rateVersion?.id).toBe('rv_res_96_2026')
    expect(e.priorVersion).toBeUndefined()
  })

  it('names the superseded version when the winner has one (64 gal on 2026-10-01)', () => {
    const e = explainPrice({ catalogId: 'cat_res_64', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_maple', onDate: '2026-10-01' }, db)
    expect(e.rateVersion).toMatchObject({ id: 'rv_res_64_2026q4', priceCents: 2700 })
    expect(e.priorVersion).toMatchObject({ id: 'rv_res_64_2026', priceCents: 2600 })
  })

  it('after the contract term the contract auto-renews with its escalator (addendum I1, Phase 3.7f)', () => {
    // contract_bakery runs 2026-01-01 to 2026-12-31 with a 4% escalator on 2027-01-01: the renewed term bills 19800 x 1.04.
    const e = explainPrice({ catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', accountId: 'acct_bakery', onDate: '2027-01-15' }, db)
    expect(e).toMatchObject({ ruleWon: 'contractOverride', priceCents: 20592 })
  })
})

describe('nextCycleDate and previewNextRun', () => {
  it('monthly, net30, and quarterly accounts next bill on 2026-10-01; perJob has no cycle date', () => {
    expect(nextCycleDate({ cycle: 'monthly' })).toBe('2026-10-01')
    expect(nextCycleDate({ cycle: 'net30' })).toBe('2026-10-01')
    expect(nextCycleDate({ cycle: 'quarterly' })).toBe('2026-10-01')
    expect(nextCycleDate({ cycle: 'perJob' })).toBeUndefined()
    setToday('2026-10-10')
    expect(nextCycleDate({ cycle: 'quarterly' })).toBe('2027-01-01')
  })

  it('Maple: three quarterly lines plus the Sep 7 extra bags event, 18361, without touching the db', () => {
    const before = db.charges
    const p = previewNextRun('acct_res_maple', db)
    expect(p.cycleDate).toBe('2026-10-01')
    expect(p.recurring.map(c => [c.source.id, c.baseCents, c.totalCents])).toEqual([
      ['si_maple_96', 8700, 10261],
      ['si_maple_extra', 2700, 3391],
      ['si_maple_recycling', 3600, 4422],
    ])
    const ninetySix = p.recurring[0]
    expect(ninetySix.fees).toEqual([{ feeRuleId: 'fee_fuel_7pct', cents: 609 }, { feeRuleId: 'fee_env_1', cents: 300 }])
    expect(ninetySix.taxCents).toBe(652)
    expect(ninetySix.period).toEqual({ start: '2026-10-01', end: '2026-12-31' })
    expect(p.events.map(c => [c.source.id, c.baseCents, fees(c), c.taxCents, c.totalCents])).toEqual([['evt_maple_extrabags', 250, 18, 19, 287]])
    expect(p.totalCents).toBe(18361)
    expect(db.charges).toBe(before)
    for (const c of [...p.recurring, ...p.events]) expectInvariant2(c)
  })

  it('Bakery: contract prices on the monthly lines, contractId copied in, 44737 with the contamination event', () => {
    const p = previewNextRun('acct_bakery', db)
    expect(p.recurring.map(c => [c.source.id, c.baseCents, fees(c), c.taxCents, c.totalCents, c.pricing.contractId, c.pricing.ruleWon])).toEqual([
      ['si_bakery_3yd', 19800, 1486, 1483, 22769, 'contract_bakery', 'contractOverride'],
      ['si_bakery_wood', 17100, 1297, 1281, 19678, 'contract_bakery', 'contractOverride'],
    ])
    expect(p.events.map(c => [c.source.id, c.baseCents, fees(c), c.taxCents, c.totalCents])).toEqual([['evt_bakery_contam', 2000, 140, 150, 2290]])
    expect(p.totalCents).toBe(44737)
  })

  it('Kerr is suspended: nothing at all (invariant 4); Hale: two overages and a dry run, 16887; Oakridge: four untaxed lines', () => {
    expect(previewNextRun('acct_res_kerr', db)).toMatchObject({ recurring: [], events: [], totalCents: 0 })
    const hale = previewNextRun('acct_contractor_hale', db)
    expect(hale.recurring).toEqual([])
    expect(hale.events.map(c => [c.source.id, c.baseCents, c.totalCents])).toEqual([
      ['evt_hale_dryrun', 2500, 2862],
      ['ticket_hale_1', 8400, 9617],
      ['ticket_hale_2', 3850, 4408],
    ])
    expect(hale.totalCents).toBe(16887)
    const oak = previewNextRun('acct_pm_oakridge', db)
    expect(oak.recurring).toHaveLength(4)
    expect(oak.recurring.every(c => c.taxCents === 0 && c.totalCents === 16150)).toBe(true)
    expect(oak.recurring[0].period).toEqual({ start: '2026-10-01', end: '2026-10-31' })
  })

  it('previews mint throwaway ids and never advance billing\'s chg_bl_ counter', () => {
    resetChargeIds()
    const p = previewNextRun('acct_res_maple', db)
    expect(p.recurring.every(c => c.id.startsWith('chg_ac_preview_'))).toBe(true)
    expect(nextChargeId(db)).toBe('chg_bl_0001')
    resetChargeIds()
  })

  it('after billing runs the cycle, the lines it proposed move to `proposed` and nothing is counted twice', () => {
    const store = useStore.getState()
    store.runCycle()
    const live = useStore.getState().db
    const p = previewNextRun('acct_res_maple', live)
    expect(p.recurring).toEqual([])
    expect(p.events).toEqual([])
    expect(p.proposed.map(c => c.source.id).sort()).toEqual(['evt_maple_extrabags', 'si_maple_96', 'si_maple_extra', 'si_maple_recycling'])
    expect(p.totalCents).toBe(18361)
  })
})

describe('balances (canonical invoiceBalance and unappliedFor)', () => {
  it('Maple: INV-2026-0203 total 18074, 9329 paid by card, 8745 open and all of it past due', () => {
    expect(openBalance('inv_maple_2026q3', db)).toBe(8745)
    expect(accountBalance('acct_res_maple', db)).toBe(8745)
    expect(pastDue('acct_res_maple', db)).toBe(8745)
  })

  it('Oakridge: pay_chk_oakridge is split across three invoices in the seed (invariant 6), nothing open', () => {
    const rows = db.allocations.filter(a => a.sourceId === 'pay_chk_oakridge')
    expect(rows.map(a => [a.invoiceId, a.cents])).toEqual([['inv_oak_2026_06', 64600], ['inv_oak_2026_07', 64600], ['inv_oak_2026_08', 64600]])
    expect(accountBalance('acct_pm_oakridge', db)).toBe(0)
    expect(pastDue('acct_pm_oakridge', db)).toBe(0)
  })

  it('Bakery and Kerr have no invoices in the merged seed', () => {
    expect(accountBalance('acct_bakery', db)).toBe(0)
    expect(accountBalance('acct_res_kerr', db)).toBe(0)
  })
})

describe('allocateChecked (canonical allocate plus the account checks)', () => {
  it('splits one payment across two invoices and leaves both paid in full', () => {
    const pay = { id: 'pay_ac_0808', accountId: 'acct_res_003', method: 'check' as const, cents: 6840, receivedAt: '2026-09-10', status: 'settled' as const }
    const shadow = withRows(db, { payments: [pay] })
    const rows = allocateChecked({ sourceType: 'payment', sourceId: pay.id, invoiceIds: ['inv_res_003_2026_08', 'inv_res_003_2026_09'], cents: [3420, 3420] }, shadow)
    const after = withRows(shadow, { allocations: rows })
    expect(openBalance('inv_res_003_2026_08', after)).toBe(0)
    expect(openBalance('inv_res_003_2026_09', after)).toBe(0)
  })

  it('several sources on one invoice (invariant 6, many-to-many)', () => {
    const cm = { id: 'cm_ac_0001', accountId: 'acct_res_017', cents: 1000, reason: 'goodwill', by: 'office', at: '2026-09-10' }
    let d = withRows(db, { creditMemos: [cm] })
    d = withRows(d, { allocations: allocateChecked({ sourceType: 'payment', sourceId: 'pay_chk_unknown', invoiceIds: ['inv_res_017'], cents: [6500] }, d) })
    d = withRows(d, { allocations: allocateChecked({ sourceType: 'creditMemo', sourceId: cm.id, invoiceIds: ['inv_res_017'], cents: [1000] }, d) })
    expect(d.allocations.filter(a => a.invoiceId === 'inv_res_017').map(a => a.sourceId)).toEqual(['pay_chk_unknown', 'cm_ac_0001'])
    expect(openBalance('inv_res_017', d)).toBe(10261 - 6500 - 1000)
  })

  it('refuses another account\'s invoice, an unknown or returned source, nothing to allocate, and over-allocation', () => {
    expect(() => allocateChecked({ sourceType: 'payment', sourceId: 'pay_chk_unknown', invoiceIds: ['inv_maple_2026q3'], cents: [100] }, db)).toThrow(/belongs to another account/)
    expect(() => allocateChecked({ sourceType: 'payment', sourceId: 'pay_nope', invoiceIds: ['inv_res_017'], cents: [100] }, db)).toThrow(EngineError)
    const returned = withRows(db, { payments: [{ id: 'pay_ac_0900', accountId: 'acct_res_017', method: 'check', cents: 500, receivedAt: '2026-09-10', status: 'returned' }] })
    expect(() => allocateChecked({ sourceType: 'payment', sourceId: 'pay_ac_0900', invoiceIds: ['inv_res_017'], cents: [500] }, returned)).toThrow(/was returned/)
    expect(() => allocateChecked({ sourceType: 'payment', sourceId: 'pay_chk_unknown', invoiceIds: [], cents: [] }, db)).toThrow(/Nothing to allocate/)
    expect(() => allocateChecked({ sourceType: 'payment', sourceId: 'pay_chk_oakridge', invoiceIds: ['inv_oak_2026_06'], cents: [100] }, db)).toThrow(/only 0 cents unapplied/)
  })
})

describe('planServiceChange (invariant 3)', () => {
  const maple96 = { siteId: 'site_maple', replaceItemId: 'si_maple_96', catalogId: 'cat_res_64', qty: 1, frequency: 'weekly' as const, effectiveFrom: '2026-09-14' }

  it('plans a swap with ids above every seed row, and the next run has the 64 gal line and not the 96', () => {
    const plan = planServiceChange(maple96, db)
    expect(plan.oldItem).toMatchObject({ id: 'si_maple_96', status: 'ended', effectiveTo: '2026-09-14' })
    expect(plan.newItem).toMatchObject({ id: 'si_ac_0097', catalogId: 'cat_res_64', status: 'active', effectiveFrom: '2026-09-14' })
    expect(plan.container).toMatchObject({ id: 'cont_ac_0001', serial: 'C64-9001', siteId: 'site_maple' })
    expect(plan.workOrder).toMatchObject({ id: 'wo_ac_0004', kind: 'swap', status: 'open', scheduledFor: '2026-09-14', serviceItemId: 'si_ac_0097' })
    expect(plan.price).toMatchObject({ priceCents: 2600, rateVersionId: 'rv_res_64_2026' })
    const run = generateRecurringCharges({ cycleDate: '2026-10-01' }, plan.nextDb).filter(c => c.accountId === 'acct_res_maple')
    expect(run.map(c => c.catalogId)).toContain('cat_res_64')
    expect(run.map(c => c.catalogId)).not.toContain('cat_res_96')
    expect(db.serviceItems.find(s => s.id === 'si_maple_96')?.status).toBe('active')
  })

  it('refuses changes that cannot be billed or dispatched', () => {
    expect(() => planServiceChange({ ...maple96, catalogId: 'cat_fl_3yd' }, db)).toThrow(/frontload; 412 Maple Ave is on a residential route/)
    expect(() => planServiceChange({ ...maple96, frequency: 'eow' }, db)).toThrow(/No published price/)
    expect(() => planServiceChange({ ...maple96, effectiveFrom: '2021-04-01' }, db)).toThrow(/must be after si_maple_96/)
    expect(() => planServiceChange({ ...maple96, qty: 0 }, db)).toThrow(/at least 1/)
    expect(() => planServiceChange({ ...maple96, catalogId: 'cat_res_96' }, db)).toThrow(/Nothing changes/)
  })
})

describe('holds, suspensions, reinstatement', () => {
  it('a suspension holds items; a vacation hold leaves them active so billing continues', () => {
    expect(itemStatusForAccountStatus('suspended')).toBe('held')
    expect(itemStatusForAccountStatus('hold')).toBe('active')
    expect(itemStatusForAccountStatus('active')).toBe('active')
    expect(itemStatusForAccountStatus('pastDue')).toBe('active')
  })

  it('reinstatement returns to pastDue while anything is past due, else active', () => {
    expect(statusAfterReinstatement('acct_res_maple', db)).toBe('pastDue')
    expect(statusAfterReinstatement('acct_res_kerr', db)).toBe('active')
  })

  it('the reinstatement fee: base 2500, no fees, tax 175 (tax_zone_open 7%), total 2675, fee line, manual source, proposed', () => {
    const fee = buildReinstatementFee({ accountId: 'acct_res_kerr', sourceId: 'sc_ac_0001', id: 'chg_ac_0827' }, db)
    expect(fee).toMatchObject({ id: 'chg_ac_0827', lineType: 'fee', baseCents: 2500, fees: [], taxCents: 175, totalCents: 2675, status: 'proposed', servicedOn: '2026-09-10' })
    expect(fee.source).toEqual({ type: 'manual', id: 'sc_ac_0001' })
    expect(fee.pricing.ruleWon).toBe('manualException')
    expectInvariant2(fee)
  })
})

describe('runtime ids (addendum C12)', () => {
  it('reads the trailing number of every id with the prefix and emits the ac infix above it', () => {
    expect(highestSuffix('wo', db.workOrders.map(w => w.id))).toBe(3)
    expect(nextId('wo', db.workOrders.map(w => w.id))).toBe('wo_ac_0004')
    expect(nextId('note', [])).toBe('note_ac_0001')
    expect(nextId('pay', db.payments.map(p => p.id))).toBe('pay_ac_0808')
    expect(nextId('chg', db.charges.map(c => c.id))).toBe('chg_ac_0827')
    expect(nextId('lw', ['lw_ac_0002'], 1)).toBe('lw_ac_0004')
  })

  it('serials follow the seed patterns in a 9xxx block', () => {
    const cat = (unit: ServiceCatalog['unit'], sizeLabel: string): ServiceCatalog => ({ id: 'x', lob: 'residential', name: 'x', sizeLabel, unit, public: true })
    expect(nextSerial(cat('cart', '64 gal'), db.containers)).toBe('C64-9001')
    expect(nextSerial(cat('box', '20 yd'), db.containers)).toBe('RO20-9001')
    expect(nextSerial(cat('container', '3 yd'), [...db.containers, { id: 'c', serial: 'FL-9004', catalogId: 'x', siteId: 's', assignedFrom: '2026-01-01' }])).toBe('FL-9005')
  })
})
