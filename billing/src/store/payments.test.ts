import { beforeEach, describe, expect, it } from 'vitest'
import { loadSeed } from '../seed'
import { resetChargeIds } from './engine'
import { queueItems } from './selectors'
import {
  batchView, checkView, openInvoicesFor, paidInvoicesFor, paymentTiles, suggestedSplit, unappliedPayments,
} from './paymentSelectors'
import { applyUnappliedStub } from './stubs'
import { useStore } from './useStore'

const store = () => useStore.getState()

beforeEach(() => {
  store().reset()
  resetChargeIds()
})

/** Run October, approve every queue item, bulk approve clean, and post. */
function postOctober() {
  store().runCycle()
  for (const item of queueItems(store())) if (!item.decided) store().approve(item.chargeId)
  store().bulkApproveClean()
  return store().post()
}

describe('check card: pay_chk_oakridge', () => {
  it('shows the check amount, received date, and three allocations that sum to the check', () => {
    const v = checkView(store())!
    expect(v.payment.cents).toBe(193800)
    expect(v.payment.receivedAt).toBe('2026-09-04')
    expect(v.accountName).toBe('Oakridge Property Group')
    expect(v.allocations.map(a => [a.invoiceNumber, a.invoiceTotalCents, a.cents, a.invoiceBalanceCents])).toEqual([
      ['INV-2026-0201', 64600, 64600, 0],
      ['INV-2026-0202', 64600, 64600, 0],
      ['INV-2026-0210', 64600, 64600, 0],
    ])
    expect(v.allocations.map(a => a.periodLabel)).toEqual(['Jun 1 to Jun 30', 'Jul 1 to Jul 31', 'Aug 1 to Aug 31'])
    expect(v.allocatedCents).toBe(v.payment.cents)
    expect(v.fullyApplied).toBe(true)
    expect(v.remainingCents).toBe(0)
  })
})

describe('batch card: batch_0908', () => {
  it('net equals gross minus fees, 14 rows, and the footer sums match gross and the unapplied remainder', () => {
    const v = batchView(store())!
    expect([v.batch.grossCents, v.batch.feeCents, v.batch.netCents]).toEqual([131842, 4120, 127722])
    expect(v.netMatches).toBe(true)
    expect(v.rows).toHaveLength(14)
    expect(v.paidCents).toBe(131842)
    expect(v.grossMatches).toBe(true)
    expect(v.unappliedCents).toBe(1530)
    expect(v.allocatedCents + v.unappliedCents).toBe(v.batch.grossCents)
    expect(v.rows.filter(r => r.unappliedCents > 0).map(r => r.payment.id)).toEqual(['pay_card_014'])
  })

  it('pay_card_011 short pays inv_res_020_2026q3: an open balance of 1200, not unapplied cash', () => {
    const v = batchView(store())!
    const row = v.rows.find(r => r.payment.id === 'pay_card_011')!
    expect(row.unappliedCents).toBe(0)
    expect(row.openOnInvoicesCents).toBe(1200)
    expect(row.allocations[0]).toMatchObject({ invoiceId: 'inv_res_020_2026q3', invoiceNumber: 'INV-2026-0208', invoiceBalanceCents: 1200 })
    expect(v.shortPays.map(r => r.payment.id)).toEqual(['pay_card_011'])
    expect(unappliedPayments(store()).map(r => r.payment.id)).not.toContain('pay_card_011')
  })
})

describe('unapplied cash', () => {
  it('lists every payment whose cents exceed its allocations, with the remainder', () => {
    expect(unappliedPayments(store()).map(r => [r.payment.id, r.unappliedCents])).toEqual([
      ['pay_card_014', 1530],
      ['pay_chk_unknown', 6500],
    ])
  })

  it('tiles: received in the seven days to Sep 10, applied, unapplied, and processor fees', () => {
    expect(paymentTiles(store())).toMatchObject({
      from: '2026-09-04',
      to: '2026-09-10',
      receivedCents: 193800 + 131842 + 6500,
      receivedCount: 16,
      appliedCents: 193800 + 131842 - 1530,
      unappliedCents: 8030,
      unappliedCount: 2,
      feeCents: 4120,
      batchCount: 1,
    })
  })

  it('suggestedSplit fills the oldest open invoice first up to the unapplied cash', () => {
    const open = (b: number[]) => b.map(balanceCents => ({ balanceCents } as Parameters<typeof suggestedSplit>[1][number]))
    expect(suggestedSplit(6500, open([10261]))).toEqual([6500])
    expect(suggestedSplit(6500, open([4000, 10261]))).toEqual([4000, 2500])
    expect(suggestedSplit(1530, open([]))).toEqual([])
  })
})

describe('applyUnappliedStub', () => {
  it('is pure: returns allocation rows through the engine and writes nothing', () => {
    const db = loadSeed()
    const rows = applyUnappliedStub(db, { paymentId: 'pay_chk_unknown', invoiceIds: ['inv_res_017'], cents: [6500] })
    expect(rows).toEqual([{ sourceType: 'payment', sourceId: 'pay_chk_unknown', invoiceId: 'inv_res_017', cents: 6500 }])
    expect(db.allocations.some(a => a.sourceId === 'pay_chk_unknown')).toBe(false)
  })

  it('refuses over-allocation with the engine error message, and nothing is committed', () => {
    const before = store().db.allocations
    expect(() => store().applyUnapplied({ paymentId: 'pay_chk_unknown', invoiceIds: ['inv_res_017'], cents: [6501] }))
      .toThrow('Cannot allocate 6501 cents from pay_chk_unknown: only 6500 cents unapplied')
    expect(store().db.allocations).toBe(before)
  })

  it('refuses an invoice on another account or an unknown payment', () => {
    const db = loadSeed()
    expect(() => applyUnappliedStub(db, { paymentId: 'pay_chk_unknown', invoiceIds: ['inv_maple_2026q3'], cents: [100] }))
      .toThrow(/belongs to another account/)
    expect(() => applyUnappliedStub(db, { paymentId: 'pay_nope', invoiceIds: ['inv_res_017'], cents: [100] })).toThrow(/Unknown payment/)
    expect(() => applyUnappliedStub(db, { paymentId: 'pay_chk_unknown', invoiceIds: [], cents: [] })).toThrow(/at least one invoice/)
  })

  it('pay_chk_unknown (6500) to inv_res_017 (INV-2026-0204, open 10261) leaves 3761 open and clears the unapplied row', () => {
    const open = openInvoicesFor(store(), 'acct_res_017')
    expect(open.map(o => [o.invoice.number, o.balanceCents])).toEqual([['INV-2026-0204', 10261]])
    store().applyUnapplied({ paymentId: 'pay_chk_unknown', invoiceIds: ['inv_res_017'], cents: [6500] })
    expect(openInvoicesFor(store(), 'acct_res_017').map(o => o.balanceCents)).toEqual([3761])
    expect(unappliedPayments(store()).map(r => r.payment.id)).toEqual(['pay_card_014'])
  })

  it('pay_card_014: no open invoice before October posts (only leave on account), then 1530 applies to the October invoice', () => {
    const batchBefore = batchView(store())!

    // Before posting: acct_res_011's only invoice INV-2026-0209 is paid in full.
    expect(openInvoicesFor(store(), 'acct_res_011')).toEqual([])
    expect(paidInvoicesFor(store(), 'acct_res_011').map(i => i.number)).toEqual(['INV-2026-0209'])
    expect(() => store().applyUnapplied({ paymentId: 'pay_card_014', invoiceIds: ['inv_res_011_2026q3'], cents: [1530] }))
      .toThrow('Cannot allocate 1530 cents to INV-2026-0209: open balance is 0 cents')
    store().leaveOnAccount('pay_card_014')
    expect(store().leftOnAccount.pay_card_014).toBe('2026-09-10T12:00:00-04:00')
    expect(unappliedPayments(store()).find(r => r.payment.id === 'pay_card_014')?.unappliedCents).toBe(1530)

    postOctober()
    const open = openInvoicesFor(store(), 'acct_res_011')
    expect(open).toHaveLength(1)
    const october = open[0]
    expect(october.invoice.id).toMatch(/^inv_bl_\d{4}$/)
    expect(october.invoice.chargeIds.length).toBeGreaterThan(0)
    const balanceBefore = october.balanceCents
    expect(balanceBefore).toBe(october.invoice.totalCents)

    store().applyUnapplied({ paymentId: 'pay_card_014', invoiceIds: [october.invoice.id], cents: [1530] })
    expect(unappliedPayments(store()).map(r => r.payment.id)).not.toContain('pay_card_014')
    expect(openInvoicesFor(store(), 'acct_res_011')[0].balanceCents).toBe(balanceBefore - 1530)
    expect(store().leftOnAccount.pay_card_014).toBeUndefined()

    // The batch totals never change; only the applied and unapplied split moves.
    const batchAfter = batchView(store())!
    expect([batchAfter.batch.grossCents, batchAfter.batch.feeCents, batchAfter.batch.netCents]).toEqual([131842, 4120, 127722])
    expect(batchAfter.paidCents).toBe(batchBefore.paidCents)
    expect(batchAfter.unappliedCents).toBe(0)
    expect(batchAfter.allocatedCents).toBe(131842)
    const row = batchAfter.rows.find(r => r.payment.id === 'pay_card_014')!
    expect(row.allocations.map(a => a.invoiceNumber)).toEqual(['INV-2026-0209', october.invoice.number])
    // A credit applied to an invoice issued after the payment arrived is not a short pay.
    expect(row.openOnInvoicesCents).toBe(0)
    expect(batchAfter.shortPays.map(r => r.payment.id)).toEqual(['pay_card_011'])

    // The short pay stays an open balance throughout.
    expect(openInvoicesFor(store(), 'acct_res_020').find(o => o.invoice.id === 'inv_res_020_2026q3')?.balanceCents).toBe(1200)
  })
})
