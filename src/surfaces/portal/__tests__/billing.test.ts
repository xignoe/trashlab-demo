// Pay flow, autopay, saved methods, and the billing selectors, against billing's seed (box 2C.3).
// Moved from portal/src/store/billing.test.ts.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setToday, today } from '../../../store/clock'
import {
  accountBalance, allocationsForPayment, invoiceOpenBalance, invoiceStatus, invoicesForAccount, nextDueOpenInvoice, paymentsForAccount,
} from '../lib/selectors'
import { tokenizeMockMethod } from '../lib/paymentToken'
import { clampPayment, parseDollars, MIN_PAYMENT_CENTS } from '../screens/billing/PaymentSheet'
import { MAPLE, OAKRIDGE, maplePastDueInvoice, openFromRows, resetStore, s } from './helpers'

beforeEach(resetStore)
afterEach(() => setToday())

const status = (id: string) => s().accounts.find(a => a.id === id)!.status

describe('pay now (runbook scenario 1)', () => {
  it('payment plus allocation clears the open balance and flips Maple from pastDue to active', () => {
    const inv = maplePastDueInvoice()
    const open = openFromRows(inv.id)
    expect(status(MAPLE)).toBe('pastDue')
    expect(invoiceOpenBalance(s(), inv.id)).toBe(open)
    expect(invoiceStatus(s(), inv.id, today())).toBe('pastDue')

    const { payment, allocations } = s().recordPayment({ accountId: MAPLE, method: 'card', invoiceIds: [inv.id], cents: [open] })

    expect(payment).toMatchObject({ id: 'pay_p0001', status: 'settled', cents: open, method: 'card' })
    expect(payment.receivedAt.startsWith(`${today()}T`)).toBe(true)
    expect(allocations).toEqual([{ sourceType: 'payment', sourceId: 'pay_p0001', invoiceId: inv.id, cents: open }])
    expect(allocationsForPayment(s(), 'pay_p0001')).toEqual(allocations)
    expect(invoiceOpenBalance(s(), inv.id)).toBe(0)
    expect(invoiceStatus(s(), inv.id, today())).toBe('paid')
    expect(accountBalance(s(), MAPLE)).toBe(0)
    expect(status(MAPLE)).toBe('active')
    expect(s().log.map(l => l.action)).toEqual(['addPayment', 'addAllocations', 'accountStatus:pastDue->active'])
    // Payment history lists the new payment first.
    expect(paymentsForAccount(s(), MAPLE)[0].id).toBe('pay_p0001')
  })

  it('a partial payment lowers the open balance but leaves the account past due', () => {
    const inv = maplePastDueInvoice()
    const open = openFromRows(inv.id)
    s().recordPayment({ accountId: MAPLE, method: 'card', invoiceIds: [inv.id], cents: [5000] })
    expect(invoiceOpenBalance(s(), inv.id)).toBe(open - 5000)
    expect(invoiceStatus(s(), inv.id, today())).toBe('pastDue')
    expect(status(MAPLE)).toBe('pastDue')
    expect(s().log.map(l => l.action)).toEqual(['addPayment', 'addAllocations'])
  })

  it('refuses to pay more than the open balance and writes nothing', () => {
    const inv = maplePastDueInvoice()
    const before = s().payments.length
    expect(() => s().recordPayment({ accountId: MAPLE, method: 'card', invoiceIds: [inv.id], cents: [openFromRows(inv.id) + 1] })).toThrow(/open balance/)
    expect(s().payments.length).toBe(before)
    expect(s().log).toEqual([])
  })

  it('refuses an invoice on another account and a non-positive amount', () => {
    const oak = invoicesForAccount(s(), OAKRIDGE)[0]
    expect(() => s().recordPayment({ accountId: MAPLE, method: 'card', invoiceIds: [oak.id], cents: [100] })).toThrow(/not on account/)
    expect(() => s().recordPayment({ accountId: MAPLE, method: 'card', invoiceIds: [maplePastDueInvoice().id], cents: [0] })).toThrow(/positive/)
  })

  it('amount parsing and clamping stay inside 100 cents and the open balance', () => {
    expect(parseDollars('87.45')).toBe(8745)
    expect(parseDollars('$1,000')).toBe(100000)
    expect(parseDollars('12.5')).toBe(1250)
    expect(parseDollars('abc')).toBeUndefined()
    expect(parseDollars('-5')).toBeUndefined()
    expect(clampPayment(5, 8745)).toBe(MIN_PAYMENT_CENTS)
    expect(clampPayment(99999, 8745)).toBe(8745)
    expect(clampPayment(4000, 8745)).toBe(4000)
    expect(clampPayment(1, 48)).toBe(48)
  })
})

describe('autopay', () => {
  it('turning on and off writes BillingAccount.autopay in db and logs each change', () => {
    expect(s().accounts.find(a => a.id === MAPLE)!.autopay).toBe(false)
    s().setAutopay(MAPLE, true)
    expect(s().accounts.find(a => a.id === MAPLE)!.autopay).toBe(true)
    s().setAutopay(MAPLE, false)
    expect(s().accounts.find(a => a.id === MAPLE)!.autopay).toBe(false)
    expect(s().log.map(l => l.action)).toEqual(['setAutopay:on', 'setAutopay:off'])
    expect(s().log[0].ids).toEqual([MAPLE])
  })

  it('with autopay off the next manual due date is the earliest open invoice, and none once it is paid', () => {
    const inv = maplePastDueInvoice()
    expect(nextDueOpenInvoice(s(), MAPLE)?.id).toBe(inv.id)
    expect(nextDueOpenInvoice(s(), OAKRIDGE)).toBeUndefined()
    s().recordPayment({ accountId: MAPLE, method: 'card', invoiceIds: [inv.id], cents: [openFromRows(inv.id)] })
    expect(nextDueOpenInvoice(s(), MAPLE)).toBeUndefined()
  })
})

describe('saved payment methods', () => {
  it('seeds a last four for Maple (Visa 4242) and Oakridge (ACH 6710)', () => {
    expect(s().paymentMethods.find(m => m.accountId === MAPLE)).toMatchObject({ kind: 'card', last4: '4242', brand: 'Visa' })
    expect(s().paymentMethods.find(m => m.accountId === OAKRIDGE)).toMatchObject({ kind: 'ach', last4: '6710' })
  })

  it("agrees with the seed's paymentMethodOnFile wherever the seed records one", () => {
    // Billing's seed has no flag for Maple or Oakridge yet ("Requests from portal port" item 2); where it has one, it matches.
    for (const m of s().paymentMethods) {
      const flag = s().accounts.find(a => a.id === m.accountId)!.paymentMethodOnFile
      if (flag !== undefined) expect(flag, m.accountId).toBe(m.kind)
    }
    expect(s().accounts.find(a => a.id === 'acct_res_holt')!.paymentMethodOnFile).toBe('card')
  })

  it('the mock tokenizer returns only a token id and a last four', () => {
    const t = tokenizeMockMethod('card')
    expect(t.tokenId).toMatch(/^tok_/)
    expect(t.last4).toMatch(/^\d{4}$/)
    expect(Object.keys(t).sort()).toEqual(['brand', 'kind', 'last4', 'tokenId'])
  })

  it('saving a method replaces the row and keeps paymentMethodOnFile in step', () => {
    const t = tokenizeMockMethod('ach')
    s().savePaymentMethod({ accountId: MAPLE, kind: t.kind, last4: t.last4, tokenId: t.tokenId, brand: t.brand })
    const rows = s().paymentMethods.filter(m => m.accountId === MAPLE)
    expect(rows).toHaveLength(1)
    expect(rows[0].tokenId).toBe(t.tokenId)
    expect(s().accounts.find(a => a.id === MAPLE)!.paymentMethodOnFile).toBe('ach')
    expect(s().log[0].action).toBe('savePaymentMethod')
  })

  it('refuses anything that is not a processor token', () => {
    expect(() => s().savePaymentMethod({ accountId: MAPLE, kind: 'card', last4: '4242', tokenId: '4111111111111111', brand: 'Visa' })).toThrow(/token/)
    expect(() => s().savePaymentMethod({ accountId: MAPLE, kind: 'card', last4: '41111', tokenId: 'tok_x', brand: 'Visa' })).toThrow(/four digits/)
  })
})

describe('billing selectors on billing seed', () => {
  it('lists invoices newest first with the right statuses', () => {
    const oak = invoicesForAccount(s(), OAKRIDGE)
    expect(oak.map(i => i.issuedAt)).toEqual([...oak.map(i => i.issuedAt)].sort().reverse())
    for (const inv of oak) expect(invoiceStatus(s(), inv.id, today())).toBe('paid')
    expect(invoiceStatus(s(), maplePastDueInvoice().id, today())).toBe('pastDue')
  })

  it("every one of Maple's and Oakridge's invoices reconciles to the sum of its lines", () => {
    for (const inv of s().invoices.filter(i => i.accountId === MAPLE || i.accountId === OAKRIDGE)) {
      const lines = inv.chargeIds.map(id => s().charges.find(c => c.id === id)!)
      expect(lines.reduce((t, c) => t + c.totalCents, 0)).toBe(inv.totalCents)
      expect(lines.reduce((t, c) => t + c.baseCents, 0)).toBe(inv.subtotalCents)
      expect(lines.reduce((t, c) => t + c.fees.reduce((f, x) => f + x.cents, 0), 0)).toBe(inv.feeCents)
      expect(lines.reduce((t, c) => t + c.taxCents, 0)).toBe(inv.taxCents)
    }
  })

  it('pay_chk_oakridge is one check split across three invoices', () => {
    expect(allocationsForPayment(s(), 'pay_chk_oakridge')).toHaveLength(3)
  })
})
