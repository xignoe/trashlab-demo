/**
 * RUNBOOK.md, proved. Drives the store through the walkthrough from a clean seed and asserts every figure the
 * runbook quotes, so the runbook cannot drift from the app. If this test changes, update RUNBOOK.md with it.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { today } from './clock'
import { invoiceBalance, resetChargeIds } from './engine'
import { paymentTiles, unappliedPayments } from './paymentSelectors'
import { batchSummary, cleanApprovalPreview, leakage, queueItems } from './selectors'
import { useStore } from './useStore'

const store = () => useStore.getState()
const charge = (id: string) => store().db.charges.find(c => c.id === id)!
const undecided = () => queueItems(store()).filter(i => !i.decided)
const tiles = () => {
  const s = batchSummary(store())
  return [s.invoicesToGenerate, s.clean, s.needDecisions, s.dollarsAtIssueCents]
}

beforeEach(() => {
  store().reset()
  resetChargeIds()
})

describe('RUNBOOK.md walkthrough', () => {
  it('every number in the five scenarios, from a clean seed', () => {
    // Step 1: run the October cycle.
    expect(tiles()).toEqual([0, 0, 0, 0])
    store().runCycle()
    expect(store().runs['2026-10-01'].chargeIds).toHaveLength(63)
    expect(tiles()).toEqual([43, 31, 12, 69279])
    const kinds = queueItems(store()).map(i => i.kind)
    expect(kinds).toHaveLength(14)
    expect(kinds.filter(k => k === 'rateChange')).toHaveLength(6)
    expect(kinds.filter(k => k === 'overage')).toHaveLength(2)
    expect(kinds.filter(k => k === 'serviceChange')).toHaveLength(1)
    expect(kinds.filter(k => ['extraBags', 'overload', 'contamination', 'dryRun'].includes(k))).toHaveLength(5)
    const maple96 = store().db.charges.find(c => c.accountId === 'acct_res_maple' && c.catalogId === 'cat_res_96' && c.period?.start === '2026-10-01')!
    expect([maple96.baseCents, maple96.taxCents, maple96.totalCents]).toEqual([8700, 652, 10261])
    expect(leakage(store()).totalCents).toBe(6584)
    expect(leakage(store()).count).toBe(4)

    // Step 2: waive Maple's extra bags as goodwill; leakage moves by exactly its total.
    const bags = queueItems(store()).find(i => i.accountId === 'acct_res_maple' && i.kind === 'extraBags')!
    expect(bags.suggestion.action).toBe('approve')
    expect(charge(bags.chargeId).totalCents).toBe(287)
    store().waive(bags.chargeId, 'goodwill')
    expect(leakage(store()).totalCents).toBe(6871)
    expect(leakage(store()).cycles.at(-1)!.cents).toBe(2864)
    expect(tiles()).toEqual([43, 32, 11, 68992])

    // Step 3: approve both Hale overages with their tickets.
    const overages = queueItems(store()).filter(i => i.kind === 'overage')
    expect(overages.map(o => [charge(o.chargeId).totalCents, charge(o.chargeId).evidenceIds])).toEqual([
      [9617, ['ticket_hale_1', 'wo_hale_haul_1']],
      [4408, ['ticket_hale_2', 'wo_hale_haul_2']],
    ])
    for (const o of overages) store().approve(o.chargeId)
    expect(tiles()).toEqual([43, 32, 11, 54967])

    // Step 4: approve the other eleven queue items, bulk approve clean, post.
    expect(undecided()).toHaveLength(11)
    for (const i of undecided()) store().approve(i.chargeId)
    expect(tiles()).toEqual([43, 43, 0, 0])
    const bulk = cleanApprovalPreview(store())
    expect([bulk.count, bulk.cents]).toEqual([49, 517184])
    store().bulkApproveClean()
    const oct = store().post()
    expect(oct).toHaveLength(43)
    expect([oct[0].number, oct.at(-1)!.number]).toEqual(['INV-2026-0223', 'INV-2026-0265'])
    expect(oct.reduce((s, i) => s + i.totalCents, 0)).toBe(586176)
    const octOf = (accountId: string) => oct.find(i => i.accountId === accountId)!
    expect([octOf('acct_res_maple').number, octOf('acct_res_maple').totalCents]).toEqual(['INV-2026-0223', 18074])
    expect([octOf('acct_res_001').number, octOf('acct_res_001').totalCents, octOf('acct_res_001').dueAt]).toEqual(['INV-2026-0227', 3420, '2026-09-25'])
    expect([octOf('acct_res_011').number, octOf('acct_res_011').totalCents]).toEqual(['INV-2026-0237', 10261])
    expect([octOf('acct_pm_oakridge').number, octOf('acct_pm_oakridge').totalCents, octOf('acct_pm_oakridge').dueAt]).toEqual(['INV-2026-0226', 64600, '2026-10-10'])
    expect([octOf('acct_contractor_hale').number, octOf('acct_contractor_hale').totalCents]).toEqual(['INV-2026-0265', 16887])
    expect(oct.every(i => i.issuedAt === '2026-09-10' && i.postedAt === '2026-09-10T12:00:00-04:00')).toBe(true)

    // Payments tab.
    const t = paymentTiles(store())
    expect([t.receivedCents, t.receivedCount, t.appliedCents, t.unappliedCents, t.unappliedCount, t.feeCents]).toEqual([332142, 16, 324112, 8030, 2, 4120])
    expect(invoiceBalance('inv_res_020_2026q3')).toBe(1200)
    store().applyUnapplied({ paymentId: 'pay_card_014', invoiceIds: [octOf('acct_res_011').id], cents: [1530] })
    expect(invoiceBalance(octOf('acct_res_011').id)).toBe(8731)
    store().applyUnapplied({ paymentId: 'pay_chk_unknown', invoiceIds: ['inv_res_017'], cents: [6500] })
    expect(invoiceBalance('inv_res_017')).toBe(3761)
    expect(unappliedPayments(store())).toHaveLength(0)

    // Step 5: publish cat_res_96 at $31 from Nov 1, advance, run November.
    const octLine = charge(octOf('acct_res_001').chargeIds[0])
    const snapshot = JSON.stringify([octOf('acct_res_001'), octLine])
    const rv = store().publishRateVersionStub({ catalogId: 'cat_res_96', priceCents: 3100, effectiveFrom: '2026-11-01', zoneId: 'zone_open' })
    expect([rv.id, rv.supersedesId]).toEqual(['rv_bl_0001', 'rv_res_96_2026'])
    store().advanceCycle()
    expect([store().cycleDate, today()]).toEqual(['2026-11-01', '2026-10-10'])
    store().runCycle()
    expect(store().runs['2026-11-01'].chargeIds).toHaveLength(27)
    expect(tiles()).toEqual([20, 12, 8, 29192])
    const nov = queueItems(store())
    expect(nov).toHaveLength(8)
    expect(nov.every(i => i.kind === 'rateChange' && i.change?.reason === 'rate version changed 2900 to 3100' && i.charge.totalCents === 3649)).toBe(true)
    const novLine = store().runs['2026-11-01'].chargeIds.map(charge).find(c => c.source.id === octLine.source.id)!
    expect([novLine.baseCents, novLine.totalCents, novLine.pricing.rateVersionId]).toEqual([3100, 3649, 'rv_bl_0001'])
    expect(JSON.stringify([store().db.invoices.find(i => i.id === octOf('acct_res_001').id), charge(octLine.id)])).toBe(snapshot)
    expect(leakage(store()).totalCents).toBe(2864)

    // Optional: post November. Issued on the moved clock.
    for (const i of undecided()) store().approve(i.chargeId)
    const novBulk = cleanApprovalPreview(store())
    expect([novBulk.count, novBulk.cents]).toEqual([19, 282715])
    store().bulkApproveClean()
    const posted = store().post()
    expect([posted.length, posted[0].number, posted.at(-1)!.number]).toEqual([20, 'INV-2026-0266', 'INV-2026-0285'])
    expect(posted.reduce((s, i) => s + i.totalCents, 0)).toBe(311907)
    expect([posted[0].issuedAt, posted[0].dueAt]).toEqual(['2026-10-10', '2026-10-25'])
  })
})
