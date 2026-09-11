/**
 * The account view's pure view models and drawer previews (box 2A.5). Moved from the selector tests in
 * account/src/store/engine.test.ts (Phase 3 to 6 previews), rewritten over the merged Db. Nothing here writes the store.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadSeed } from '../../../seed'
import { setToday } from '../../../store/clock'
import type { Db } from '../../../store/db'
import {
  autoAllocateOldestFirst, buildAccountRows, buildAccountView, buildContractView, buildCreditPreview, buildExistingAllocationPreview, buildPaymentPreview,
  buildRolloffBoxes, centsToInput, contractOf, defaultChangeDate, explainServiceLine, nextAnniversary, openInvoicesOldestFirst,
  parseDollars, searchAccounts,
} from '../selectors'

let db: Db
beforeEach(() => { db = loadSeed() })
afterEach(() => setToday())

describe('account view', () => {
  it('Maple header and money strip: past due 8745 on INV-2026-0203, next invoice 18361, every chip in sync', () => {
    const v = buildAccountView('acct_res_maple', db)!
    expect(v.payer.name).toBe('Ruth Maple')
    expect([v.balance, v.pastDue, v.nextInvoice.date, v.nextInvoice.estimateCents]).toEqual([8745, 8745, '2026-10-01', 18361])
    expect(v.openInvoices.map(i => [i.invoice.number, i.daysLate])).toEqual([['INV-2026-0203', 56]])
    expect([v.sync.dispatch.state, v.sync.billing.state, v.sync.quickbooks.state]).toEqual(['inSync', 'inSync', 'inSync'])
    expect(v.fieldEvents.map(e => `${e.event.date} ${e.event.exception ?? e.event.outcome}`)).toEqual(['2026-09-07 extraBags', '2026-08-31 completed'])
  })

  it('Bakery shows its open quote request from the portal as an open item', () => {
    const v = buildAccountView('acct_bakery', db)!
    expect(v.openRequests.map(r => r.request.id)).toEqual(['req_bakery_quote'])
  })

  it('returns undefined for an unknown account', () => {
    expect(buildAccountView('acct_nope', db)).toBeUndefined()
  })

  it('rail search matches name, id, address, or PO', () => {
    expect(searchAccounts('maple', db).map(s => s.account.id)).toContain('acct_res_maple')
    expect(searchAccounts('PO-OAK-B2026', db).map(s => s.account.id)).toEqual(['acct_pm_oakridge'])
    expect(searchAccounts('   ', db)).toEqual([])
  })
})

describe('price explanation and contract card (Scenario D)', () => {
  it('Bakery 3 yd: the contract sentence names the rate card it beat', () => {
    const v = buildAccountView('acct_bakery', db)!
    const site = v.sites[0]
    const e = explainServiceLine(site.lines[0], site.site, db)
    expect(e.summary).toBe('Contract contract_bakery override of $198.00 per month won over the $220.00 zone rate, 10% below rate card for "competitive match".')
    expect(e.details[1]).toBe('Rate card it beat: Zone rate rv_fl_3yd_2026 for Open market, 2x per week: $220.00 effective Jan 1, 2026, published Dec 15, 2025.')
  })

  it('contract card: 112 days to term end, notice by Nov 1, 2026, escalated prices 20592 and 17784 from Jan 1, 2027', () => {
    const account = db.accounts.find(a => a.id === 'acct_bakery')!
    const cv = buildContractView(contractOf(account, db)!, db)
    expect([cv.daysUntilTermEnd, cv.noticeBy, cv.noticeDaysLeft, cv.nextAnniversary]).toEqual([112, '2026-11-01', 52, '2027-01-01'])
    expect(cv.overrides.map(o => [o.catalogId, o.priceCents, o.rateCardCents, o.escalatedCents])).toEqual([
      ['cat_fl_3yd', 19800, 22000, 20592],
      ['cat_fl_3yd_wood', 17100, 19000, 17784],
    ])
  })

  it('nextAnniversary rolls a passed date forward and refuses a non-ISO value', () => {
    expect(nextAnniversary('2026-01-01')).toBe('2027-01-01')
    expect(nextAnniversary('2027-01-01')).toBe('2027-01-01')
    expect(() => nextAnniversary('01-01')).toThrow(/YYYY-MM-DD/)
  })
})

describe('roll-off boxes', () => {
  it('Hale: three boxes within their 30 days; the two tickets over cap carry the canonical overage charges', () => {
    const boxes = buildRolloffBoxes('acct_contractor_hale', db)
    expect(boxes.map(b => [b.container.serial, b.daysOut, b.extraDays])).toEqual([['RO20-2001', 23, 0], ['RO20-2002', 17, 0], ['RO20-2003', 23, 0]])
    const tickets = boxes.flatMap(b => b.tickets).map(t => [t.ticket.id, t.overTons > 0, t.overage?.baseCents, t.overage?.totalCents])
    expect(tickets).toEqual([['ticket_hale_1', true, 8400, 9617], ['ticket_hale_2', true, 3850, 4408], ['ticket_hale_3', false, undefined, undefined]])
    expect(boxes.every(b => b.extraDayCharge === undefined && b.extraDaysBilled === undefined)).toBe(true)
  })

  it('acct_ro_homeowner: 4 days past 30 carry the extra-day charge the next run proposes, Sep 7 to Sep 10 (box 3.7g)', () => {
    const [box] = buildRolloffBoxes('acct_ro_homeowner', db)
    expect([box.deliveredOn, box.daysOut, box.includedDays, box.extraDays, box.extraDayCents, box.extraDaysCents]).toEqual(['2026-08-07', 34, 30, 4, 700, 2800])
    // The canonical engine's line (DECISIONS.md entry 38): base $28.00, total $32.06, standardRate, not yet in db.
    expect(box.extraDayCharge).toMatchObject({ baseCents: 2800, totalCents: 3206, period: { start: '2026-09-07', end: '2026-09-10' }, status: 'proposed', pricing: { ruleWon: 'standardRate' } })
    expect(box.extraDaysBilled).toBeUndefined()
  })

  it('acct_ro_homeowner: once the run holds the extra-day charge, the card reads how far it is billed and proposes nothing more', () => {
    const [before] = buildRolloffBoxes('acct_ro_homeowner', db)
    const posted = { ...before.extraDayCharge!, id: 'chg_bl_9999', status: 'posted' as const }
    const [box] = buildRolloffBoxes('acct_ro_homeowner', { ...db, charges: [...db.charges, posted] })
    expect(box.extraDayCharge).toBeUndefined()
    expect(box.extraDaysBilled).toMatchObject({ id: 'chg_bl_9999', status: 'posted', period: { end: '2026-09-10' } })
  })
})

describe('payment and credit previews (invariant 6)', () => {
  it('payment preview: the id confirm will write, status by method, card-only reference, nothing written', () => {
    const before = db.payments
    const p = buildPaymentPreview({ accountId: 'acct_res_017', method: 'card', cents: 10261, receivedAt: '2026-09-10', reference: 'batch_x' }, { inv_res_017: 10261 }, db)
    expect(p.payment).toMatchObject({ id: 'pay_ac_0808', status: 'pending', processorBatchId: 'batch_x' })
    expect([p.balanceBefore, p.balanceAfter, p.pastDueAfter, p.error]).toEqual([10261, 0, 0, undefined])
    expect(p.quickbooksAfter.state).toBe('stale')
    expect(buildPaymentPreview({ accountId: 'acct_res_017', method: 'check', cents: 100, receivedAt: '2026-09-10', reference: '1234' }, {}, db).payment.processorBatchId).toBeUndefined()
    expect(db.payments).toBe(before)
  })

  it('an existing unapplied payment: over its open balance is an error in plain words', () => {
    const over = buildExistingAllocationPreview('payment', 'pay_chk_unknown', { inv_res_017: 80000 }, db)!
    expect(over.error).toBe('INV-2026-0204: $800.00 is more than its open balance of $102.61')
    const ok = buildExistingAllocationPreview('payment', 'pay_chk_unknown', { inv_res_017: 6500 }, db)!
    expect([ok.availableCents, ok.error, ok.balanceAfter, ok.remainderCents]).toEqual([6500, undefined, 3761, 0])
  })

  it('credit preview: unapplied on the account by default, or the invoice before and after; over balance is an error', () => {
    const loose = buildCreditPreview({ accountId: 'acct_res_maple', cents: 500, reason: 'goodwill' }, db)
    expect([loose.memo.id, loose.unappliedCreditBefore, loose.unappliedCreditAfter, loose.balanceAfter]).toEqual(['cm_ac_0001', 0, 500, 8745])
    const applied = buildCreditPreview({ accountId: 'acct_res_maple', cents: 745, reason: 'billingError', invoiceId: 'inv_maple_2026q3' }, db)
    expect([applied.openBefore, applied.openAfter, applied.pastDueAfter]).toEqual([8745, 8000, 8000])
    const over = buildCreditPreview({ accountId: 'acct_res_maple', cents: 9000, reason: 'goodwill', invoiceId: 'inv_maple_2026q3' }, db)
    expect(over.error).toMatch(/^INV-2026-0203 has \$87.45 open/)
  })

  it('parseDollars, centsToInput, and auto-allocate oldest first', () => {
    expect(parseDollars('1,234.5')).toBe(123450)
    expect(parseDollars('$20')).toBe(2000)
    expect(parseDollars('.75')).toBe(75)
    expect(parseDollars('')).toBeUndefined()
    expect(parseDollars('1.234')).toBeUndefined()
    expect(centsToInput(75964)).toBe('759.64')
    const open = openInvoicesOldestFirst('acct_res_003', db)
    expect(autoAllocateOldestFirst(open, 5000)).toEqual({ inv_res_003_2026_08: 3420, inv_res_003_2026_09: 1580 })
  })
})

describe('the demo clock', () => {
  it('the change drawer defaults to next Monday, and follows the engine clock', () => {
    expect(defaultChangeDate()).toBe('2026-09-14')
    setToday('2026-10-10')
    expect(defaultChangeDate()).toBe('2026-10-12')
  })
})

describe('accounts table rows', () => {
  it('monthly revenue is price x qty of the active recurring lines, and zero when suspended', () => {
    const maple = buildAccountRows(db).find(r => r.id === 'acct_res_maple')!
    // 96 gal cart $29.00 + extra 96 gal cart $9.00 + recycling $12.00, one of each.
    expect([maple.monthlyRevenueCents, maple.unpricedLines]).toEqual([5000, 0])
    const suspended = { ...db, accounts: db.accounts.map(a => (a.id === 'acct_res_maple' ? { ...a, status: 'suspended' as const } : a)) }
    expect(buildAccountRows(suspended).find(r => r.id === 'acct_res_maple')!.monthlyRevenueCents).toBe(0)
  })
})
