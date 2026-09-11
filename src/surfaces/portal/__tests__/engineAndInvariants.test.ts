// The portal-only engine helpers and the canonical engine calls the portal makes (box 2C.1), the invariants panel,
// and the suspended account session. Moved from portal/src/store/engine.test.ts, portal/src/lib/invariants.test.ts,
// and portal/src/store/phase6.test.ts. The prototype's own resolvePrice, computeCharge, and allocate tests are gone
// with its engine; billing's engine tests cover the canonical ones.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { seed } from '../../../seed'
import { setToday, today } from '../../../store/clock'
import { useStore } from '../../../store/useStore'
import type { BillingAccount } from '../../../types'
import {
  PREVIEW_CHARGE_ID, computeCharge, cycleEnd, monthsInCycle, nextCycleStart, nextInvoicePeriod, resolvePrice,
} from '../lib/engine'
import { checkChargeShape, checkManyToMany, checkSuspendedNoMoney, checkWaivedKept, runInvariants, type StoreSurface } from '../lib/invariants'
import { extraPickupEligibility, serviceItemsInPeriod } from '../lib/selectors'
import { handoff, handoffSentence } from '../lib/handoff'
import { MAPLE, OAKRIDGE, patchDb, resetStore, s } from './helpers'

beforeEach(resetStore)
afterEach(() => setToday())

const account = (id: string) => s().accounts.find(a => a.id === id)!

describe('cycle math', () => {
  it('quarterly next cycle starts on the next calendar quarter', () => {
    expect(nextCycleStart(account(MAPLE), '2026-09-10')).toBe('2026-10-01')
    expect(nextCycleStart(account(MAPLE))).toBe('2026-10-01')
    expect(nextCycleStart(account(MAPLE), '2026-12-31')).toBe('2027-01-01')
    expect(cycleEnd(account(MAPLE), '2026-10-01')).toBe('2026-12-31')
    expect(monthsInCycle(account(MAPLE))).toBe(3)
  })

  it('monthly and net30 next cycle starts on the first of next month', () => {
    const monthly: BillingAccount = { ...account(MAPLE), cycle: 'monthly' }
    expect(nextCycleStart(monthly, '2026-09-10')).toBe('2026-10-01')
    expect(nextCycleStart(account(OAKRIDGE), '2026-09-10')).toBe('2026-10-01')
  })

  it('next invoice period is the next cycle in advance and the running cycle in arrears', () => {
    expect(nextInvoicePeriod(account(MAPLE), '2026-09-10')).toEqual({ start: '2026-10-01', end: '2026-12-31' })
    // Billing's seed bills Oakridge in advance (the prototype billed it in arrears), so its next invoice is October.
    expect(account(OAKRIDGE).billedInAdvance).toBe(true)
    expect(nextInvoicePeriod(account(OAKRIDGE), '2026-09-10')).toEqual({ start: '2026-10-01', end: '2026-10-31' })
    expect(nextInvoicePeriod({ ...account(OAKRIDGE), billedInAdvance: false }, '2026-09-10')).toEqual({ start: '2026-09-01', end: '2026-09-30' })
  })

  it('defaults follow the engine clock', () => {
    setToday('2026-10-10')
    expect(today()).toBe('2026-10-10')
    expect(nextCycleStart(account(MAPLE))).toBe('2027-01-01')
  })
})

describe('the next invoice estimate (Overview) on the canonical engine', () => {
  it("reproduces the seed's own Q3 recurring lines for the same period and prices each through resolvePrice", () => {
    const period = { start: '2026-07-01', end: '2026-09-30' }
    const seeded = s().charges.filter(c => c.accountId === MAPLE && c.lineType === 'recurring' && c.period?.start === period.start)
    expect(seeded.length).toBeGreaterThan(0)
    for (const c of seeded) {
      const item = s().serviceItems.find(i => i.id === c.source.id)!
      const site = s().sites.find(x => x.id === c.siteId)!
      const price = resolvePrice({ catalogId: item.catalogId, frequency: item.frequency, zoneId: site.zoneId, accountId: MAPLE, onDate: period.start })
      const est = computeCharge({
        id: PREVIEW_CHARGE_ID, accountId: MAPLE, siteId: c.siteId, lineType: 'recurring', baseCents: price.priceCents * 3 * item.qty,
        period, source: { type: 'serviceItem', id: item.id }, catalogId: item.catalogId, frequency: item.frequency,
      })
      expect([est.baseCents, est.fees, est.taxCents, est.totalCents]).toEqual([c.baseCents, c.fees, c.taxCents, c.totalCents])
    }
  })

  it('lists every Maple service for the Q4 period', () => {
    expect(serviceItemsInPeriod(s(), 'site_maple', { start: '2026-10-01', end: '2026-12-31' }).map(i => i.id).sort()).toEqual(['si_maple_96', 'si_maple_extra', 'si_maple_recycling'])
  })
})

describe('invariants on seed data', () => {
  const run = () => runInvariants(useStore.getState() as unknown as StoreSurface, useStore.getState().db, seed.waivedCharges)

  it('all pass', () => {
    expect(run().map(r => [r.number, r.pass])).toEqual([[2, true], [4, true], [5, true], [6, true]])
  })

  it('pay_chk_oakridge splits across three invoices', () => {
    expect(checkManyToMany(s()).detail).toContain('3 allocations across 3 invoices')
  })

  it('still all pass after the four runbook scenarios write their rows', () => {
    const inv = s().invoices.find(i => i.accountId === MAPLE)!
    const open = inv.totalCents - s().allocations.filter(a => a.invoiceId === inv.id).reduce((t, a) => t + a.cents, 0)
    s().recordPayment({ accountId: MAPLE, method: 'card', invoiceIds: [inv.id], cents: [open] })
    s().setAutopay(MAPLE, true)
    s().reportMissedPickup({ accountId: MAPLE, siteId: 'site_maple', date: '2026-08-17' })
    s().requestQuote({ accountId: OAKRIDGE, siteId: 'site_oak_2', catalogId: 'cat_fl_2yd', qty: 1, frequency: 'weekly', material: 'trash' })
    expect(run().every(r => r.pass)).toBe(true)
  })
})

describe('invariants catch violations', () => {
  it('fails a charge with no ruleWon or unbalanced math', () => {
    const [c] = s().charges
    patchDb(db => ({ ...db, charges: [{ ...c, pricing: {} as never }, ...db.charges.slice(1)] }))
    expect(checkChargeShape(s()).pass).toBe(false)
    patchDb(db => ({ ...db, charges: [{ ...c, totalCents: c.totalCents + 1 }] }))
    expect(checkChargeShape(s()).pass).toBe(false)
  })

  it('fails when a suspended account has a payment', () => {
    const [p] = s().payments
    patchDb(db => ({ ...db, payments: [...db.payments, { ...p, id: 'pay_bad', accountId: 'acct_res_kerr' }] }))
    expect(checkSuspendedNoMoney(s())).toMatchObject({ pass: false })
  })

  it('fails when the store exposes a waived-row delete or a seeded waived row goes missing', () => {
    const store = useStore.getState() as unknown as StoreSurface
    expect(checkWaivedKept({ ...store, deleteWaivedCharge: () => undefined }, s(), seed.waivedCharges).pass).toBe(false)
    const row = { chargeId: 'ch_x', reason: 'goodwill' as const, by: 'office', at: '2026-09-01T00:00:00' }
    expect(checkWaivedKept(store, s(), [row]).pass).toBe(false)
  })
})

describe('suspended account session (acct_res_kerr)', () => {
  it('shows the handoff on extra pickup and moves no money', () => {
    s().switchAccount('acct_res_kerr')
    const { accountId, siteId } = s().session
    expect([accountId, siteId]).toEqual(['acct_res_kerr', 'site_kerr'])
    const e = extraPickupEligibility(s(), accountId, siteId, today())
    expect(e.ok).toBe(false)
    expect(e.reason).toBe('Account is suspended')
    const h = handoff(e.reason!)
    expect(handoffSentence(h)).toMatch(/We could not finish this automatically\. Reason: Account is suspended\. A person will follow up by Friday, Sep 11/)
    const before = [s().charges.length, s().payments.length, s().workOrders.length]
    expect(s().addRequest({ accountId, siteId, kind: 'extraPickup', status: 'open', createdVia: 'portal', note: h.reason })).toMatchObject({ kind: 'extraPickup', status: 'open', note: 'Account is suspended' })
    expect([s().charges.length, s().payments.length, s().workOrders.length]).toEqual(before)
    expect(checkSuspendedNoMoney(s()).pass).toBe(true)
  })
})
