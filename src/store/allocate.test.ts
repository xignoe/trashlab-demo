import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadSeed } from '../seed'
import { clearEngineDb, setEngineDb, type Db } from './db'
import { allocate, allocatedTo, invoiceBalance, unappliedFor } from './engine'

let db: Db

beforeEach(() => {
  db = loadSeed()
  setEngineDb(() => db)
})

afterEach(() => {
  clearEngineDb()
})

const OAK_INVOICES = ['inv_oak_2026_06', 'inv_oak_2026_07', 'inv_oak_2026_08']

/** Remove the seeded allocations for one source so a test can replay them through allocate(). */
function unallocate(sourceId: string): void {
  db = { ...db, allocations: db.allocations.filter(a => a.sourceId !== sourceId) }
}

describe('invoiceBalance and unappliedFor', () => {
  it('invoice balance is total minus allocations; the maple Q3 invoice is open for exactly 8745 cents', () => {
    expect(invoiceBalance('inv_maple_2026q3')).toBe(8745)
    expect(invoiceBalance('inv_oak_2026_06')).toBe(0)
    expect(invoiceBalance('inv_res_017')).toBe(10261) // quarterly 96 gal with env 300 (addendum C5)
  })

  it('unapplied is source cents minus its allocations: the two seeded unapplied entries are 1530 and 6500', () => {
    expect(unappliedFor('pay_card_014')).toBe(1530)
    expect(unappliedFor('pay_chk_unknown')).toBe(6500)
    expect(unappliedFor('pay_chk_oakridge')).toBe(0)
    expect(unappliedFor('pay_card_001')).toBe(0)
  })

  it('throws for an unknown invoice or source', () => {
    expect(() => invoiceBalance('inv_nope')).toThrow(/inv_nope/)
    expect(() => unappliedFor('pay_nope')).toThrow(/pay_nope/)
  })
})

describe('allocate', () => {
  it('pay_chk_oakridge splits across three invoices and each invoice balance drops accordingly', () => {
    unallocate('pay_chk_oakridge')
    expect(unappliedFor('pay_chk_oakridge')).toBe(193800)
    for (const id of OAK_INVOICES) expect(invoiceBalance(id)).toBe(64600)

    const rows = allocate({ sourceType: 'payment', sourceId: 'pay_chk_oakridge', invoiceIds: OAK_INVOICES, cents: [64600, 64600, 64600] })
    expect(rows).toEqual(OAK_INVOICES.map(invoiceId => ({ sourceType: 'payment', sourceId: 'pay_chk_oakridge', invoiceId, cents: 64600 })))
    // Nothing is written until the caller commits.
    expect(unappliedFor('pay_chk_oakridge')).toBe(193800)

    db = { ...db, allocations: [...db.allocations, ...rows] }
    for (const id of OAK_INVOICES) expect(invoiceBalance(id)).toBe(0)
    expect(unappliedFor('pay_chk_oakridge')).toBe(0)
  })

  it('a partial allocation leaves the remainder on both sides', () => {
    unallocate('pay_chk_oakridge')
    const rows = allocate({ sourceType: 'payment', sourceId: 'pay_chk_oakridge', invoiceIds: ['inv_oak_2026_06', 'inv_oak_2026_07'], cents: [64600, 30000] })
    db = { ...db, allocations: [...db.allocations, ...rows] }
    expect(invoiceBalance('inv_oak_2026_06')).toBe(0)
    expect(invoiceBalance('inv_oak_2026_07')).toBe(34600)
    expect(invoiceBalance('inv_oak_2026_08')).toBe(64600)
    expect(unappliedFor('pay_chk_oakridge')).toBe(193800 - 94600)
  })

  it('invariant 6: batch_0908 gross minus fees equals net, and its 14 allocations plus the unapplied remainder equal gross', () => {
    const batch = db.processorBatches.find(b => b.id === 'batch_0908')!
    expect(batch.paymentIds).toHaveLength(14)
    expect(batch.grossCents - batch.feeCents).toBe(batch.netCents)
    expect(batch.netCents).toBe(127722)

    const payments = batch.paymentIds.map(id => db.payments.find(p => p.id === id)!)
    expect(payments.reduce((s, p) => s + p.cents, 0)).toBe(batch.grossCents)

    const allocations = db.allocations.filter(a => batch.paymentIds.includes(a.sourceId))
    expect(allocations).toHaveLength(14)
    expect(new Set(allocations.map(a => a.invoiceId)).size).toBe(14)
    const allocated = allocations.reduce((s, a) => s + a.cents, 0)
    const unapplied = batch.paymentIds.reduce((s, id) => s + unappliedFor(id), 0)
    expect(unapplied).toBe(1530)
    expect(allocated + unapplied).toBe(batch.grossCents)
    // Every payment in the batch is fully explained by its allocations plus its own remainder.
    for (const p of payments) expect(allocatedTo_(p.id) + unappliedFor(p.id)).toBe(p.cents)
  })

  it('applying the pay_card_014 remainder to the account open invoice clears the unapplied bucket without touching the batch', () => {
    const batchBefore = JSON.stringify(db.processorBatches)
    // Give acct_res_011 an open invoice to receive the remainder.
    db.invoices.push({
      id: 'inv_res_011_2026q4', accountId: 'acct_res_011', number: 'INV-2026-0223', chargeIds: [], subtotalCents: 8700,
      feeCents: 909, taxCents: 652, totalCents: 10261, issuedAt: '2026-10-01', dueAt: '2026-10-16', postedAt: '2026-10-01', locked: true, deliveredVia: 'email',
    })
    const rows = allocate({ sourceType: 'payment', sourceId: 'pay_card_014', invoiceIds: ['inv_res_011_2026q4'], cents: [1530] })
    db = { ...db, allocations: [...db.allocations, ...rows] }
    expect(unappliedFor('pay_card_014')).toBe(0)
    expect(invoiceBalance('inv_res_011_2026q4')).toBe(10261 - 1530)
    expect(JSON.stringify(db.processorBatches)).toBe(batchBefore)
  })

  it('pay_chk_unknown can be applied to inv_res_017', () => {
    const rows = allocate({ sourceType: 'payment', sourceId: 'pay_chk_unknown', invoiceIds: ['inv_res_017'], cents: [6500] })
    db = { ...db, allocations: [...db.allocations, ...rows] }
    expect(unappliedFor('pay_chk_unknown')).toBe(0)
    expect(invoiceBalance('inv_res_017')).toBe(10261 - 6500)
  })

  it('over-allocation throws: the sum may not exceed the source unapplied amount', () => {
    expect(() => allocate({ sourceType: 'payment', sourceId: 'pay_card_014', invoiceIds: ['inv_res_017'], cents: [1531] }))
      .toThrow(/only 1530 cents unapplied/)
    unallocate('pay_chk_oakridge')
    expect(() => allocate({ sourceType: 'payment', sourceId: 'pay_chk_oakridge', invoiceIds: OAK_INVOICES, cents: [64600, 64600, 64601] }))
      .toThrow(/unapplied/)
  })

  it('over-allocation throws: no single allocation may exceed that invoice open balance', () => {
    // pay_chk_oakridge has zero unapplied; free it and try to put more than the balance on one invoice.
    unallocate('pay_chk_oakridge')
    expect(() => allocate({ sourceType: 'payment', sourceId: 'pay_chk_oakridge', invoiceIds: ['inv_oak_2026_06'], cents: [64601] }))
      .toThrow(/INV-2026-0201.*open balance is 64600/)
    // A fully paid invoice accepts nothing more (inv_res_011_2026q3 was paid in full by pay_card_014).
    expect(() => allocate({ sourceType: 'payment', sourceId: 'pay_chk_unknown', invoiceIds: ['inv_res_011_2026q3'], cents: [1] }))
      .toThrow(/open balance is 0/)
    // The same invoice listed twice is checked as one amount.
    expect(() => allocate({ sourceType: 'payment', sourceId: 'pay_chk_oakridge', invoiceIds: ['inv_maple_2026q3', 'inv_maple_2026q3'], cents: [5000, 4000] }))
      .toThrow(/open balance is 8745/)
  })

  it('throws when cents and invoiceIds differ in length, or an amount is not positive integer cents', () => {
    expect(() => allocate({ sourceType: 'payment', sourceId: 'pay_chk_unknown', invoiceIds: ['inv_res_017'], cents: [] })).toThrow(/one amount per invoice/)
    expect(() => allocate({ sourceType: 'payment', sourceId: 'pay_chk_unknown', invoiceIds: ['inv_res_017'], cents: [10, 20] })).toThrow(/one amount per invoice/)
    expect(() => allocate({ sourceType: 'payment', sourceId: 'pay_chk_unknown', invoiceIds: ['inv_res_017'], cents: [0] })).toThrow(/positive integer/)
    expect(() => allocate({ sourceType: 'payment', sourceId: 'pay_chk_unknown', invoiceIds: ['inv_res_017'], cents: [12.5] })).toThrow(/positive integer/)
    expect(() => allocate({ sourceType: 'payment', sourceId: 'pay_nope', invoiceIds: ['inv_res_017'], cents: [1] })).toThrow(/pay_nope/)
    expect(allocate({ sourceType: 'payment', sourceId: 'pay_chk_unknown', invoiceIds: [], cents: [] })).toEqual([])
  })

  it('a credit memo is a source too and is limited to its own unapplied amount', () => {
    db.creditMemos.push({ id: 'cm_test', accountId: 'acct_res_maple', invoiceId: 'inv_maple_2026q3', cents: 2000, reason: 'missed pickup credit', by: 'M. Alvarez', at: '2026-09-10T09:00:00-04:00' })
    expect(unappliedFor('cm_test')).toBe(2000)
    const rows = allocate({ sourceType: 'creditMemo', sourceId: 'cm_test', invoiceIds: ['inv_maple_2026q3'], cents: [2000] })
    expect(rows).toEqual([{ sourceType: 'creditMemo', sourceId: 'cm_test', invoiceId: 'inv_maple_2026q3', cents: 2000 }])
    db = { ...db, allocations: [...db.allocations, ...rows] }
    expect(invoiceBalance('inv_maple_2026q3')).toBe(6745)
    expect(() => allocate({ sourceType: 'creditMemo', sourceId: 'cm_test', invoiceIds: ['inv_maple_2026q3'], cents: [1] })).toThrow(/unapplied/)
  })

  it('does not mutate the db', () => {
    const before = JSON.stringify(db)
    allocate({ sourceType: 'payment', sourceId: 'pay_chk_unknown', invoiceIds: ['inv_res_017'], cents: [6500] })
    expect(JSON.stringify(db)).toBe(before)
  })
})

function allocatedTo_(paymentId: string): number {
  return db.allocations.filter(a => a.sourceId === paymentId).reduce((s, a) => s + a.cents, 0)
}

// Keep the exported helper covered too.
describe('allocatedTo', () => {
  it('sums allocations against an invoice', () => {
    expect(allocatedTo('inv_oak_2026_06')).toBe(64600)
    expect(allocatedTo('inv_res_017')).toBe(0)
  })
})
