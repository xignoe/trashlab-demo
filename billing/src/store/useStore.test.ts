import { beforeEach, describe, expect, it } from 'vitest'
import { getEngineDb } from './db'
import { resetChargeIds } from './engine'
import { batchSummary, chargeDetail, customerContext, queueItems } from './selectors'
import { DEFAULT_CYCLE_DATE, useStore } from './useStore'

const store = () => useStore.getState()

beforeEach(() => {
  store().reset()
  resetChargeIds()
})

/** Decide every undecided queue item by approving it. */
function approveQueue() {
  for (const item of queueItems(store())) if (!item.decided) store().approve(item.chargeId)
}

describe('store setup', () => {
  it('starts on the October cycle, run tab, nothing selected, no runs', () => {
    expect(store().cycleDate).toBe(DEFAULT_CYCLE_DATE)
    expect(DEFAULT_CYCLE_DATE).toBe('2026-10-01')
    expect(store().activeTab).toBe('run')
    expect(store().selectedChargeId).toBeNull()
    expect(store().runs).toEqual({})
  })

  it('binds the engine to the live store state', () => {
    expect(getEngineDb()).toBe(store().db)
    store().runCycle()
    expect(getEngineDb()).toBe(store().db)
    expect(getEngineDb().charges.some(c => c.id === 'chg_bl_0001')).toBe(true)
  })
})

describe('runCycle', () => {
  it('appends every recurring and event charge for 2026-10-01 as proposed with chg_bl_ ids', () => {
    const before = store().db.charges.length
    const run = store().runCycle()
    expect(run.chargeIds).toHaveLength(63)
    expect(store().db.charges).toHaveLength(before + 63)
    const rows = run.chargeIds.map(id => store().db.charges.find(c => c.id === id)!)
    for (const c of rows) {
      expect(c.status).toBe('proposed')
      expect(c.id).toMatch(/^chg_bl_\d{4}$/)
    }
    expect(rows.filter(c => c.lineType === 'event')).toHaveLength(7)
  })

  it('queue hand count: 5 exception events, 2 overages, 1 service change, 6 rate changes', () => {
    store().runCycle()
    const kinds = queueItems(store()).map(i => i.kind)
    expect(kinds.filter(k => ['extraBags', 'overload', 'contamination', 'dryRun'].includes(k))).toHaveLength(5)
    expect(kinds.filter(k => k === 'overage')).toHaveLength(2)
    expect(kinds.filter(k => k === 'serviceChange')).toHaveLength(1)
    expect(kinds.filter(k => k === 'rateChange')).toHaveLength(6)
  })

  it('records changedFromPrior with reasons: the 64 gal rate move and the new extra cart on acct_res_007', () => {
    const run = store().runCycle()
    const changes = Object.entries(run.changedFromPrior)
    const rate = changes.filter(([, c]) => c.kind === 'rateChange')
    expect(rate.length).toBeGreaterThanOrEqual(1)
    for (const [, c] of rate) {
      expect(c.reason).toBe('rate version changed 2600 to 2700')
      expect(c.priorRateVersionId).toBe('rv_res_64_2026')
      expect(c.newRateVersionId).toBe('rv_res_64_2026q4')
    }
    const service = changes.filter(([, c]) => c.kind === 'serviceChange')
    expect(service).toHaveLength(1)
    expect(service[0][1].reason).toBe('first invoice after service change')
    const charge = store().db.charges.find(c => c.id === service[0][0])!
    expect(charge.source.id).toBe('si_res_007_extra')
  })

  it('re-running the same cycle does not duplicate proposed rows and keeps their ids', () => {
    const first = store().runCycle()
    const count = store().db.charges.length
    const second = store().runCycle()
    expect(store().db.charges).toHaveLength(count)
    expect(second.chargeIds).toEqual(first.chargeIds)
    expect(Object.keys(second.changedFromPrior).sort()).toEqual(Object.keys(first.changedFromPrior).sort())
  })

  it('re-running after decisions keeps approved and waived rows and regenerates only the proposed set', () => {
    const run = store().runCycle()
    const [a, b] = queueItems(store())
    store().approve(a.chargeId)
    store().waive(b.chargeId, 'goodwill')
    const count = store().db.charges.length
    const again = store().runCycle()
    expect(store().db.charges).toHaveLength(count)
    expect(new Set(again.chargeIds)).toEqual(new Set(run.chargeIds))
    expect(store().db.charges.find(c => c.id === a.chargeId)!.status).toBe('approved')
    expect(store().db.charges.find(c => c.id === b.chargeId)!.status).toBe('waived')
  })

  it('selects the first undecided queue item after a run', () => {
    store().runCycle()
    expect(store().selectedChargeId).toBe(queueItems(store())[0].chargeId)
  })
})

describe('selectors', () => {
  it('batchSummary reads 0 before the run and the computed numbers after', () => {
    expect(batchSummary(store())).toMatchObject({ invoicesToGenerate: 0, clean: 0, needDecisions: 0, dollarsAtIssueCents: 0 })
    store().runCycle()
    const s = batchSummary(store())
    expect(s).toMatchObject({ invoicesToGenerate: 43, clean: 31, needDecisions: 12, queueCount: 14, undecidedCount: 14 })
    const undecided = queueItems(store()).filter(i => !i.decided)
    expect(s.dollarsAtIssueCents).toBe(undecided.reduce((sum, i) => sum + i.charge.totalCents, 0))
    expect(s.clean + s.needDecisions).toBe(s.invoicesToGenerate)
  })

  it('an account leaves needDecisions once all its queue items are decided, and dollars at issue drop by the item total', () => {
    store().runCycle()
    const before = batchSummary(store())
    const maple = queueItems(store()).find(i => i.accountId === 'acct_res_maple')!
    store().waive(maple.chargeId, 'goodwill', 'Long tenure')
    const after = batchSummary(store())
    expect(after.needDecisions).toBe(before.needDecisions - 1)
    expect(after.clean).toBe(before.clean + 1)
    expect(after.dollarsAtIssueCents).toBe(before.dollarsAtIssueCents - maple.charge.totalCents)
  })

  it('undecided rows sort first', () => {
    store().runCycle()
    const first = queueItems(store())[0]
    store().approve(first.chargeId)
    const items = queueItems(store())
    expect(items.at(-1)!.chargeId).toBe(first.chargeId)
    const firstDecided = items.findIndex(i => i.decided)
    expect(items.slice(firstDecided).every(i => i.decided)).toBe(true)
  })

  it('customerContext for Maple: 8745 open, pastDue, no autopay, no prior waives', () => {
    const ctx = customerContext(store(), 'acct_res_maple')!
    expect(ctx.balanceCents).toBe(8745)
    expect(ctx.status).toBe('pastDue')
    expect(ctx.autopay).toBe(false)
    expect(ctx.priorWaives).toEqual({ count: 0, cents: 0 })
    expect(ctx.tenureMonths).toBeGreaterThan(24)
  })

  it('customerContext counts prior waives in count and cents (acct_fl_003 has one)', () => {
    const ctx = customerContext(store(), 'acct_fl_003')!
    expect(ctx.priorWaives.count).toBe(1)
    const waived = store().db.charges.find(c => c.id === 'chg_waived_fl003_0826')!
    expect(ctx.priorWaives.cents).toBe(waived.totalCents)
  })

  it('chargeDetail names every fee, and shows ticket evidence and the overage formula for a Hale overage', () => {
    store().runCycle()
    const hale = queueItems(store()).find(i => i.kind === 'overage')!
    const d = chargeDetail(store(), hale.chargeId)!
    expect(d.lines.map(l => l.label)).toEqual(['Base', 'Fuel surcharge', 'Tax'])
    expect(d.lines.reduce((s, l) => s + l.cents, 0)).toBe(d.charge.totalCents)
    expect(d.evidence.type).toBe('ticket')
    expect(d.policy).toMatch(/3 t included cap/)
  })
})

describe('decisions', () => {
  it('approve sets status approved and refuses a non-proposed charge', () => {
    store().runCycle()
    const id = queueItems(store())[0].chargeId
    store().approve(id)
    expect(store().db.charges.find(c => c.id === id)!.status).toBe('approved')
    expect(() => store().approve(id)).toThrow(/status is approved/)
  })

  it('editAmount recomputes fees and tax through computeCharge, marks manualException, and keeps the first original base', () => {
    store().runCycle()
    const maple = queueItems(store()).find(i => i.accountId === 'acct_res_maple')!
    const updated = store().editAmount(maple.chargeId, 500, 'Two bags, not one')
    // fuel round(35) = 35, tax round((500 + 35) * 0.07) = round(37.45) = 37
    expect(updated.fees).toEqual([{ feeRuleId: 'fee_fuel_7pct', cents: 35 }])
    expect(updated.taxCents).toBe(37)
    expect(updated.totalCents).toBe(572)
    expect(updated.pricing.ruleWon).toBe('manualException')
    expect(updated.status).toBe('approved')
    store().editAmount(maple.chargeId, 400, 'Customer called')
    const edits = store().edits.filter(e => e.chargeId === maple.chargeId)
    expect(edits).toHaveLength(2)
    expect(edits.every(e => e.originalBaseCents === 250)).toBe(true)
    expect(queueItems(store()).find(i => i.chargeId === maple.chargeId)!.decision).toBe('edited')
    expect(() => store().editAmount(maple.chargeId, 400, '  ')).toThrow(/reason/)
  })

  it('waive appends a WaivedCharge by the actor and never removes one', () => {
    store().runCycle()
    const before = store().db.waivedCharges.length
    const item = queueItems(store())[0]
    store().waive(item.chargeId, 'operationalFault', 'Truck late')
    const rows = store().db.waivedCharges
    expect(rows).toHaveLength(before + 1)
    expect(rows.at(-1)).toMatchObject({ chargeId: item.chargeId, reason: 'operationalFault', note: 'Truck late', by: 'M. Alvarez' })
  })

  it('bulkApproveClean approves every proposed non-queue charge and never touches a queue item', () => {
    store().runCycle()
    const res = store().bulkApproveClean()
    expect(res.count).toBe(63 - 14)
    for (const item of queueItems(store())) expect(item.decision).toBe('undecided')
  })

  it('post refuses while a queue item is undecided, then posts approved charges as inv_bl_ invoices', () => {
    store().runCycle()
    store().bulkApproveClean()
    expect(() => store().post()).toThrow(/14 queue items are undecided/)
    approveQueue()
    const invoices = store().post()
    expect(invoices).toHaveLength(43)
    expect(invoices[0].id).toBe('inv_bl_0001')
    expect(invoices[0].number).toBe('INV-2026-0223')
    const run = store().runs['2026-10-01']
    expect(run.postedInvoiceIds).toEqual(invoices.map(i => i.id))
    for (const id of run.chargeIds) expect(store().db.charges.find(c => c.id === id)!.status).toBe('posted')
    expect(batchSummary(store()).postedInvoiceCount).toBe(43)
  })
})

describe('publishRateVersionStub and advanceCycle', () => {
  it('publishes an rv_bl_ version that supersedes the current cat_res_96 rate and the next run prices from it', () => {
    const rv = store().publishRateVersionStub({ catalogId: 'cat_res_96', priceCents: 3100, effectiveFrom: '2026-11-01', zoneId: 'zone_open' })
    expect(rv).toMatchObject({ id: 'rv_bl_0001', status: 'published', supersedesId: 'rv_res_96_2026', frequency: 'weekly', priceCents: 3100 })
    expect(store().db.rateVersions.at(-1)).toEqual(rv)
    store().advanceCycle()
    expect(store().cycleDate).toBe('2026-11-01')
    store().runCycle()
    const run = store().runs['2026-11-01']
    const monthly96 = run.chargeIds.map(id => store().db.charges.find(c => c.id === id)!)
      .find(c => c.catalogId === 'cat_res_96' && c.period?.end === '2026-11-30')!
    expect(monthly96.baseCents).toBe(3100)
    expect(monthly96.pricing.rateVersionId).toBe('rv_bl_0001')
  })

  it('advanceCycle moves to the next month start and clears the selection', () => {
    store().runCycle()
    store().advanceCycle()
    expect(store().cycleDate).toBe('2026-11-01')
    expect(store().selectedChargeId).toBeNull()
    expect(batchSummary(store()).ran).toBe(false)
  })
})
