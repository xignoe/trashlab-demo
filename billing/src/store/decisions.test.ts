/**
 * Phase 5: decisions, bulk approve, posting, leakage, the rate publishing stub, and the next cycle.
 * Runs against the zustand store, which binds the engine to its live state.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { resetChargeIds } from './engine'
import {
  batchSummary, chargeDetail, cleanApprovalPreview, cycleWindow, leakage, nextUndecidedAfter, postPreview,
  postedCycleDates, postedInvoices, queueItems,
} from './selectors'
import { useStore } from './useStore'

const store = () => useStore.getState()
const charge = (id: string) => store().db.charges.find(c => c.id === id)!
const mapleExtraBags = () => queueItems(store()).find(i => i.accountId === 'acct_res_maple' && i.kind === 'extraBags')!

beforeEach(() => {
  store().reset()
  resetChargeIds()
})

function decideRestByApproving() {
  for (const item of queueItems(store())) if (!item.decided) store().approve(item.chargeId)
}

describe('approve moves to the next undecided item', () => {
  it('approving the selected item selects the row below it', () => {
    store().runCycle()
    const [first, second] = queueItems(store())
    expect(store().selectedChargeId).toBe(first.chargeId)
    expect(nextUndecidedAfter(store(), first.chargeId)).toBe(second.chargeId)
    store().approve(first.chargeId)
    expect(charge(first.chargeId).status).toBe('approved')
    expect(store().selectedChargeId).toBe(second.chargeId)
  })

  it('approving a row that is not selected leaves the selection alone', () => {
    store().runCycle()
    const items = queueItems(store())
    store().approve(items[3].chargeId)
    expect(store().selectedChargeId).toBe(items[0].chargeId)
  })

  it('waive and edit also move to the next undecided item', () => {
    store().runCycle()
    const [a, b, c] = queueItems(store())
    store().waive(a.chargeId, 'goodwill')
    expect(store().selectedChargeId).toBe(b.chargeId)
    store().editAmount(b.chargeId, b.charge.baseCents + 100, 'Driver note says two')
    expect(store().selectedChargeId).toBe(c.chargeId)
  })

  it('when the last undecided item is decided the selection stays on it', () => {
    store().runCycle()
    const items = queueItems(store())
    for (const item of items.slice(0, -1)) store().approve(item.chargeId)
    const last = items[items.length - 1]
    store().selectCharge(last.chargeId)
    store().approve(last.chargeId)
    expect(store().selectedChargeId).toBe(last.chargeId)
    expect(queueItems(store()).every(i => i.decided)).toBe(true)
  })
})

describe('edit amount', () => {
  it('previewEdit re-prices through computeCharge without changing the store', () => {
    store().runCycle()
    const maple = mapleExtraBags()
    const before = store().db
    const preview = store().previewEdit(maple.chargeId, 500)
    expect(store().db).toBe(before)
    expect(charge(maple.chargeId).status).toBe('proposed')
    expect(preview).toMatchObject({ id: maple.chargeId, baseCents: 500, taxCents: 37, totalCents: 572 })
    expect(preview.pricing.ruleWon).toBe('manualException')
    const committed = store().editAmount(maple.chargeId, 500, 'Two bags on the photo')
    expect(committed).toEqual(preview)
  })

  it('the original proposed total stays on the item after an edit (addendum C11: ruleWon manualException)', () => {
    store().runCycle()
    const maple = mapleExtraBags()
    expect(maple.charge.totalCents).toBe(287)
    store().editAmount(maple.chargeId, 500, 'Two bags on the photo')
    const item = queueItems(store()).find(i => i.chargeId === maple.chargeId)!
    expect(item.decision).toBe('edited')
    expect(item.edit).toMatchObject({ originalBaseCents: 250, originalTotalCents: 287, newBaseCents: 500, reason: 'Two bags on the photo' })
    expect(item.charge.pricing.ruleWon).toBe('manualException')
    const detail = chargeDetail(store(), maple.chargeId)!
    expect(detail.policy).toMatch(/Edited from \$2\.50 base/)
  })

  it('previewEdit refuses a negative or fractional amount', () => {
    store().runCycle()
    const maple = mapleExtraBags()
    expect(() => store().previewEdit(maple.chargeId, -1)).toThrow(/non-negative integer cents/)
    expect(() => store().previewEdit(maple.chargeId, 1.5)).toThrow(/non-negative integer cents/)
  })
})

describe('waive (invariant 5: nothing is deleted)', () => {
  it('creates a WaivedCharge row through waiveCharge and marks the item waived; the detail shows the row', () => {
    store().runCycle()
    const maple = mapleExtraBags()
    const rows = store().db.waivedCharges.length
    const charges = store().db.charges.length
    store().waive(maple.chargeId, 'goodwill', 'Long tenure, first extra bag')
    expect(store().db.waivedCharges).toHaveLength(rows + 1)
    expect(store().db.charges).toHaveLength(charges)
    expect(charge(maple.chargeId).status).toBe('waived')
    expect(queueItems(store()).find(i => i.chargeId === maple.chargeId)!.decision).toBe('waived')
    expect(chargeDetail(store(), maple.chargeId)!.waived).toMatchObject({ reason: 'goodwill', note: 'Long tenure, first extra bag' })
  })
})

describe('bulk approve clean', () => {
  it('the preview count and dollars match what bulkApproveClean approves, and queue items are never touched', () => {
    store().runCycle()
    const preview = cleanApprovalPreview(store())
    expect(preview.count).toBe(49)
    const queued = new Set(queueItems(store()).map(i => i.chargeId))
    expect(preview.chargeIds.some(id => queued.has(id))).toBe(false)
    const res = store().bulkApproveClean()
    expect(res).toEqual({ count: preview.count, cents: preview.cents })
    for (const id of preview.chargeIds) expect(charge(id).status).toBe('approved')
    for (const item of queueItems(store())) expect(item.decision).toBe('undecided')
    expect(cleanApprovalPreview(store()).count).toBe(0)
  })
})

describe('post invoices', () => {
  it('is not ready while a queue item is undecided', () => {
    store().runCycle()
    store().bulkApproveClean()
    const p = postPreview(store())
    expect(p.ready).toBe(false)
    expect(p.undecidedCount).toBe(14)
  })

  it('the confirmation preview matches what post() creates, and the posted list and tiles reflect posted state', () => {
    store().runCycle()
    store().bulkApproveClean()
    decideRestByApproving()
    const p = postPreview(store())
    expect(p).toMatchObject({ ready: true, undecidedCount: 0, unapprovedCleanCount: 0, invoiceCount: 43, firstNumber: 'INV-2026-0223', lastNumber: 'INV-2026-0265' })
    const invoices = store().post()
    expect(invoices).toHaveLength(p.invoiceCount)
    expect(invoices.reduce((s, i) => s + i.totalCents, 0)).toBe(p.totalCents)

    const rows = postedInvoices(store(), '2026-10-01')
    expect(rows).toHaveLength(43)
    expect(rows.every(r => r.invoice.locked)).toBe(true)
    expect(rows[0].invoice.number).toBe('INV-2026-0223')
    expect(postedCycleDates(store())).toEqual(['2026-10-01'])

    const s = batchSummary(store())
    expect(s).toMatchObject({ allPosted: true, postedInvoiceCount: 43, undecidedCount: 0, dollarsAtIssueCents: 0 })
    expect(s.postedTotalCents).toBe(p.totalCents)
    expect(postPreview(store()).ready).toBe(false)
  })

  it('warns about clean charges left unapproved: they stay off the invoices', () => {
    store().runCycle()
    decideRestByApproving()
    const p = postPreview(store())
    expect(p.ready).toBe(true)
    expect(p.unapprovedCleanCount).toBe(49)
    expect(p.chargeIds).toHaveLength(14)
  })
})

describe('leakage over the last three cycles', () => {
  it('a cycle owns the waives recorded in the month before its date', () => {
    expect(cycleWindow('2026-10-01')).toEqual({ from: '2026-09-01', to: '2026-10-01' })
    expect(cycleWindow('2026-01-01')).toEqual({ from: '2025-12-01', to: '2026-01-01' })
  })

  it('on the Oct 1 cycle it counts the four seeded waives recorded Jul 1 to Sep 30 and leaves out April', () => {
    const l = leakage(store())
    expect(l.cycles.map(c => c.cycleDate)).toEqual(['2026-08-01', '2026-09-01', '2026-10-01'])
    expect(l.from).toBe('2026-07-01')
    expect(l.to).toBe('2026-10-01')
    const ids = ['chg_waived_res021_0622', 'chg_waived_fl005_0617', 'chg_waived_res008_0825', 'chg_waived_fl003_0826']
    const expected = ids.reduce((s, id) => s + charge(id).totalCents, 0)
    expect(l.count).toBe(4)
    expect(l.totalCents).toBe(expected)
    expect(l.cycles[0].count).toBe(2)
    expect(l.cycles[1].count).toBe(0)
    expect(l.cycles[2].count).toBe(2)
    for (const rows of [l.byReason, l.byRoute, l.byAccount]) {
      expect(rows.reduce((s, r) => s + r.cents, 0)).toBe(l.totalCents)
      expect(rows.reduce((s, r) => s + r.count, 0)).toBe(l.count)
    }
    expect(l.byReason.map(r => r.key)).not.toContain('salesPromise')
  })

  it('waiving Maple extra bags as goodwill moves the total, the current cycle, and all three breakdowns by exactly its total', () => {
    store().runCycle()
    const before = leakage(store())
    const maple = mapleExtraBags()
    store().waive(maple.chargeId, 'goodwill')
    const after = leakage(store())
    expect(after.totalCents - before.totalCents).toBe(287)
    expect(after.cycles[2].cents - before.cycles[2].cents).toBe(287)
    const reason = (l: typeof after) => l.byReason.find(r => r.key === 'goodwill')?.cents ?? 0
    expect(reason(after) - reason(before)).toBe(287)
    expect(after.byAccount.find(r => r.key === 'acct_res_maple')).toMatchObject({ count: 1, cents: 287 })
    const site = store().db.sites.find(s => s.id === maple.siteId)!
    const route = (l: typeof after) => l.byRoute.find(r => r.key === (site.routeId ?? 'none'))?.cents ?? 0
    expect(route(after) - route(before)).toBe(287)
  })
})

describe('scenario chain: waive, approve overages, bulk approve, post, publish $31, next cycle (invariant 1)', () => {
  it('the posted October invoice keeps 2900 while the November run prices the same line at 3100', () => {
    store().runCycle()
    const waivedBefore = store().db.waivedCharges.length
    store().waive(mapleExtraBags().chargeId, 'goodwill')

    const overages = queueItems(store()).filter(i => i.kind === 'overage')
    expect(overages.map(i => i.accountId)).toEqual(['acct_contractor_hale', 'acct_contractor_hale'])
    for (const o of overages) {
      const d = chargeDetail(store(), o.chargeId)!
      expect(d.evidence.type).toBe('ticket')
      store().approve(o.chargeId)
    }
    store().bulkApproveClean()
    decideRestByApproving()
    const posted = store().post()
    expect(posted).toHaveLength(43)

    const octLine = store().db.charges.find(c => c.status === 'posted' && c.catalogId === 'cat_res_96' && c.period?.start === '2026-10-01' && c.period.end === '2026-10-31')!
    expect(octLine.baseCents).toBe(2900)
    const octInvoice = store().db.invoices.find(i => i.chargeIds.includes(octLine.id))!
    const snapshot = JSON.stringify({ invoice: octInvoice, charges: octInvoice.chargeIds.map(charge) })

    const rv = store().publishRateVersionStub({ catalogId: 'cat_res_96', priceCents: 3100, effectiveFrom: '2026-11-01', zoneId: 'zone_open' })
    expect(rv).toMatchObject({ id: 'rv_bl_0001', supersedesId: 'rv_res_96_2026', status: 'published' })
    store().advanceCycle()
    expect(store().cycleDate).toBe('2026-11-01')
    store().runCycle()

    const novLine = store().runs['2026-11-01'].chargeIds.map(charge).find(c => c.source.id === octLine.source.id)!
    expect(novLine.baseCents).toBe(3100)
    expect(novLine.pricing.rateVersionId).toBe('rv_bl_0001')
    const flagged = queueItems(store()).find(i => i.chargeId === novLine.id)!
    expect(flagged.kind).toBe('rateChange')
    expect(flagged.change?.reason).toBe('rate version changed 2900 to 3100')

    const octNow = store().db.invoices.find(i => i.id === octInvoice.id)!
    expect(JSON.stringify({ invoice: octNow, charges: octNow.chargeIds.map(charge) })).toBe(snapshot)
    expect(postedInvoices(store(), '2026-10-01').find(r => r.invoice.id === octInvoice.id)!.lines.find(l => l.chargeId === octLine.id)!.baseCents).toBe(2900)
    expect(store().db.waivedCharges).toHaveLength(waivedBefore + 1)
  })
})
