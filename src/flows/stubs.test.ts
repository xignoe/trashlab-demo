/**
 * Box 3.6: billing's hand-offs routed to their owners (src/store/stubs.ts). Each delegate writes exactly once, through
 * the owner's store action, and carries the owner's bookkeeping: pricing's publish record, account's ledger write.
 * Relationships only, never seed cents (the seed is being regenerated in parallel).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setToday, stamp } from '../store/clock'
import { invoiceBalance, unappliedFor } from '../store/engine'
import { applyUnappliedThroughAccount, publishRateVersionThroughPricing } from '../store/stubs'
import { useStore } from '../store/useStore'
import { postedSnapshot } from './helpers'

const st = () => useStore.getState()
beforeEach(() => st().reset())
afterEach(() => setToday())

describe('box 3.6: publishRateVersionThroughPricing', () => {
  it('drafts and publishes through pricing: one new row, superseding the current line, stamped by the clock', () => {
    const before = st().db.rateVersions
    const current = before
      .filter(rv => rv.catalogId === 'cat_res_96' && rv.zoneId === 'zone_open' && rv.status === 'published' && rv.effectiveFrom <= '2026-11-01')
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).at(-1)!
    const snapshot = postedSnapshot()

    const row = publishRateVersionThroughPricing(st(), { catalogId: 'cat_res_96', priceCents: current.priceCents + 200, effectiveFrom: '2026-11-01', zoneId: 'zone_open' })

    expect(st().db.rateVersions).toHaveLength(before.length + 1)
    expect(st().db.rateVersions.filter(rv => rv.id === row.id)).toHaveLength(1)
    expect(row).toMatchObject({ status: 'published', supersedesId: current.id, frequency: current.frequency, priceCents: current.priceCents + 200, publishedAt: stamp() })
    expect(row.id).toMatch(/^rv_pr_/)
    before.forEach((rv, i) => expect(st().db.rateVersions[i]).toBe(rv))
    // Pricing's own bookkeeping sees the publish; no draft is left behind.
    expect(st().pricingLastPublish?.ids).toEqual([row.id])
    expect(st().pricingDrafts).toEqual([])
    // Invariant 1: posted invoices are untouched.
    expect(postedSnapshot()).toEqual(snapshot)
  })

  it('refuses a price equal to the version it supersedes and leaves no draft', () => {
    const current = st().db.rateVersions.find(rv => rv.catalogId === 'cat_res_96' && rv.zoneId === 'zone_open' && rv.effectiveFrom === '2026-01-01')!
    const db = st().db
    expect(() => publishRateVersionThroughPricing(st(), { catalogId: 'cat_res_96', priceCents: current.priceCents, effectiveFrom: '2026-02-01', zoneId: 'zone_open' }))
      .toThrow(/nothing to publish/)
    expect(st().db).toBe(db)
    expect(st().pricingDrafts).toEqual([])
  })
})

describe('box 3.6: applyUnappliedThroughAccount', () => {
  it('allocates once through account and records account\'s ledger write', () => {
    const payment = st().db.payments.find(p => p.id === 'pay_chk_unknown')!
    const invoice = st().db.invoices.find(i => i.accountId === payment.accountId && invoiceBalance(i.id) > 0)!
    const cents = Math.min(unappliedFor(payment.id), invoiceBalance(invoice.id))
    const allocationsBefore = st().db.allocations.length
    const balanceBefore = invoiceBalance(invoice.id)

    const rows = applyUnappliedThroughAccount(st(), { paymentId: payment.id, invoiceIds: [invoice.id], cents: [cents] })

    expect(rows).toEqual([{ sourceType: 'payment', sourceId: payment.id, invoiceId: invoice.id, cents }])
    expect(st().db.allocations).toHaveLength(allocationsBefore + 1)
    expect(invoiceBalance(invoice.id)).toBe(balanceBefore - cents)
    expect(st().accountEdits.ledgerWrites.at(-1)).toMatchObject({ kind: 'allocation', sourceId: payment.id, cents, accountId: payment.accountId })
  })

  it('an over-allocation throws the engine error and writes nothing', () => {
    const payment = st().db.payments.find(p => p.id === 'pay_chk_unknown')!
    const invoice = st().db.invoices.find(i => i.accountId === payment.accountId && invoiceBalance(i.id) > 0)!
    const db = st().db
    expect(() => applyUnappliedThroughAccount(st(), { paymentId: payment.id, invoiceIds: [invoice.id], cents: [unappliedFor(payment.id) + 1] })).toThrow(/Cannot allocate/)
    expect(st().db).toBe(db)
    expect(st().accountEdits.ledgerWrites).toEqual([])
  })
})
