// @vitest-environment jsdom
/**
 * Phase 4, boxes 4.1 to 4.7a: the seven test scenarios of trashlab/CLAUDE_CODE_PROMPT.md, each end to end on the one
 * store and the real screens (AppRoutes under a MemoryRouter, as the persona bar mounts them). Where a screen step is a
 * click in the demo, the test clicks it; where the step is a long form already proved by its surface's own tests, the
 * test calls the same slice action the form calls and then reads the result off the screens.
 *
 * Unlike the Phase 3 flow tests these pin the seed's figures: docs/SCENARIOS_WALK.md quotes them, and the runbook
 * writer reads them from there. A figure that moves here must move there too.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes, ROUTER_FUTURE } from '../App'
import { setToday, today } from '../store/clock'
import { invoiceBalance } from '../store/engine'
import { leakage, queueItems } from '../store/selectors'
import { cardChargeRows, paymentTiles } from '../store/paymentSelectors'
import { useStore } from '../store/useStore'
import { buildAccountView } from '../surfaces/account/selectors'
import { proposeIncreases } from '../surfaces/pricing/lib/agentProposals'
import { blastRadius } from '../surfaces/pricing/lib/preview'
import { resolvePhoto } from '../seed/photos'
import { buildOffer } from '../surfaces/storefront/lib/offer'
import { viewOf } from '../surfaces/storefront/lib/view'
import { chargesOn, postedSnapshot, signUpAtLarkspur } from './helpers'

const st = () => useStore.getState()

let errors: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  st().reset()
  // jsdom has no scrolling; billing's Payments button scrolls to the top. Not an app error, so stub it before the spy.
  window.scrollTo = (() => {}) as typeof window.scrollTo
  errors = vi.spyOn(console, 'error')
})
afterEach(() => {
  cleanup()
  expect(errors).not.toHaveBeenCalled()
  vi.restoreAllMocks()
  st().reset()
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <AppRoutes />
    </MemoryRouter>,
  )
}

/** Accounts' Run Oct 1 cycle button, clicked. It leaves Accounts filtered to the accounts with charges to review. */
function clickRunCycle() {
  cleanup()
  renderAt('/office/account')
  fireEvent.click(screen.getByRole('button', { name: /^Run \w+ \d+ cycle$/ }))
}

/** Open an account's page and pick the row in its "Charges to review" whose text has every part. */
function selectReviewRow(accountId: string, ...parts: string[]) {
  cleanup()
  renderAt(`/office/account/${accountId}`)
  const row = [...document.querySelectorAll('.tl-queue-table tbody tr')].find(r => parts.every(p => (r.textContent ?? '').includes(p)))
  if (!row) throw new Error(`no review row on ${accountId} with ${parts.join(', ')}`)
  fireEvent.click(row.querySelector('.tl-row-button')!)
}

/**
 * By clicking: approve every charge under review on each account's page, then bulk approve the clean charges and post
 * from the cycle banner on Accounts. Ends on Payments, where the posted invoices are.
 */
function decideBulkAndPostOnScreen() {
  for (let guard = 0; guard < 100; guard++) {
    const next = queueItems(st()).find(i => !i.decided)
    if (!next) break
    cleanup()
    renderAt(`/office/account/${next.accountId}`)
    while (document.querySelector('.tl-queue-table tbody tr:not([data-decided])')) {
      fireEvent.click(within(screen.getByRole('region', { name: 'Actions' })).getByRole('button', { name: /^Approve \$/ }))
    }
  }
  cleanup()
  renderAt('/office/account')
  fireEvent.click(screen.getByRole('button', { name: /^Bulk approve \d+ clean$/ }))
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Confirm bulk approve' })).getByRole('button', { name: /^Approve \d+$/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Post invoices' }))
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Confirm posting' })).getByRole('button', { name: /^Post \d+ invoices?$/ }))
  cleanup()
  renderAt('/office/payments')
}

// ---------------------------------------------------------------------------------------------------------------
// Scenario 1
// ---------------------------------------------------------------------------------------------------------------

describe('scenario 1 (box 4.1): a homeowner signs up instantly at a zone_open address', () => {
  it('charges $129.36, creates the delivery work order, and the Oct 1 run folds the signup into one invoice the payment clears', () => {
    const r = signUpAtLarkspur()
    let { db } = st()
    const payment = db.payments.find(p => p.id === r.paymentId)!
    expect(payment).toMatchObject({ cents: 12936, method: 'card', status: 'settled' })
    expect(db.workOrders.find(w => w.id === r.workOrderIds[0])).toMatchObject({ kind: 'deliver', status: 'scheduled', scheduledFor: '2026-09-14' })
    const [recurring, delivery] = r.chargeIds.map(id => db.charges.find(c => c.id === id)!)
    expect(recurring).toMatchObject({ lineType: 'recurring', status: 'approved', totalCents: 10261, period: { start: '2026-09-15', end: '2026-12-14' } })
    expect(delivery).toMatchObject({ lineType: 'fee', status: 'approved', totalCents: 2675 })

    // Office: the new account is on the account view with its work order and the charges waiting for billing.
    const { container } = renderAt(`/office/account/${r.accountId}`)
    expect(screen.getByRole('main', { name: 'Account' }).textContent).toContain('Dana Larkspur')
    expect(container.textContent).toContain(r.workOrderIds[0])
    expect(container.textContent).toContain('$129.36 unapplied payment')
    cleanup()

    // Office runs October from the persona bar: the signup is intake, posted last, and the payment clears it.
    renderAt('/office/payments')
    clickRunCycle()
    decideBulkAndPostOnScreen()
    db = st().db
    const mine = db.invoices.filter(i => i.accountId === r.accountId)
    expect(mine).toHaveLength(1)
    const invoice = mine[0]
    expect(invoice).toMatchObject({ number: 'INV-2026-0267', totalCents: 12936, chargeIds: r.chargeIds })
    expect(invoiceBalance(invoice.id, db)).toBe(0)
    expect(db.allocations.filter(a => a.sourceId === r.paymentId)).toEqual([{ sourceType: 'payment', sourceId: r.paymentId, invoiceId: invoice.id, cents: 12936 }])
    // No second recurring charge: the Sep 15 to Dec 14 quarter covers the Oct 1 cycle (addendum C13).
    expect(db.charges.filter(c => c.accountId === r.accountId && c.lineType === 'recurring')).toHaveLength(1)
    // The seeded numbers do not shift: Maple is still first, and the run posts 45 invoices.
    expect(db.invoices.find(i => i.accountId === 'acct_res_maple' && i.number === 'INV-2026-0223')).toBeDefined()
    expect(st().runs['2026-10-01'].postedInvoiceIds).toHaveLength(45)

    // The posted card shows the payment applied and a $0.00 balance on the signup's invoice.
    fireEvent.click(screen.getByRole('button', { name: 'INV-2026-0267' }))
    expect(screen.getByTestId(`applied-${r.paymentId}`).textContent).toContain('($129.36)')
    expect(screen.getByTestId(`balance-${invoice.id}`).textContent).toContain('$0.00')
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Scenario 2
// ---------------------------------------------------------------------------------------------------------------

describe('scenario 2 (box 4.2): a zone_boundary signup is held, then approved by the office with no second conversation', () => {
  it('holds $136.23 with a reason and deadline, charges nothing, then Approve at /office/approvals charges and activates', () => {
    st().sfSubmitAddress('addr_boundary')
    const offer = buildOffer({ zoneId: 'zone_boundary', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false }, viewOf(st()))
    expect(offer.lines[0].monthlyCents).toBe(3100)
    const { tokenId } = st().sfTokenizeCard({ last4: '4242', brand: 'visa', expMonth: 1, expYear: 2030 })
    const paymentsBefore = st().db.payments.length
    const held = st().sfCreateHeldQuote({ offer, contact: { name: 'Priya Ridgeway', email: 'priya@example.com', phone: '404-555-0142' }, deliveryNotes: 'Gravel drive', tokenId, addressId: 'addr_boundary' })
    let quote = st().db.quotes.find(q => q.id === held.quoteId)!
    expect(quote).toMatchObject({ status: 'held', dueTodayCents: 13623, recurringCents: 10948, paymentTokenId: tokenId })
    expect(held.holdReason).toMatch(/private road/i)
    expect(held.holdDeadline).toBe('2026-09-13T10:00:00-04:00')
    expect(quote.expiresAt.slice(0, 10)).toBe('2026-09-17')
    expect(st().db.payments).toHaveLength(paymentsBefore) // tokenized, not charged

    renderAt('/office/approvals')
    const row = screen.getByTestId(`office-${held.quoteId}`)
    expect(row.textContent).toContain(held.holdReason)
    expect(row.textContent).toContain('$136.23')
    fireEvent.click(within(row).getByRole('button', { name: 'Approve' }))

    const { db } = st()
    quote = db.quotes.find(q => q.id === held.quoteId)!
    expect(quote.status).toBe('accepted')
    const approval = st().sfUi.approvals[held.quoteId]
    expect(db.accounts.find(a => a.id === approval.accountId)).toMatchObject({ status: 'active', paymentMethodOnFile: 'card' })
    expect(db.payments.find(p => p.id === approval.paymentId)).toMatchObject({ cents: 13623, status: 'settled' })
    const charged = approval.chargeIds.map(id => db.charges.find(c => c.id === id)!)
    expect(charged.map(c => c.totalCents)).toEqual([10948, 2675])
    expect(charged[0].pricing).toMatchObject({ rateVersionId: 'rv_res_96_2026_boundary', ruleWon: 'zoneRate' })
    expect(db.workOrders.find(w => w.id === approval.workOrderIds[0])).toMatchObject({ kind: 'deliver', scheduledFor: '2026-09-14' })
    expect(within(row).getByTestId(`approval-${held.quoteId}`).textContent).toMatch(/^Approved\. Charged \$136\.23 to Visa ending 4242\. Cart arrives Mon Sep 14/)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Scenario 3
// ---------------------------------------------------------------------------------------------------------------

describe('scenario 3 (box 4.3): the bakery quote, 10% under the ratebook as a contract exception', () => {
  it('quote_bakery_request priced at $198.00 against $220.00, and the Oct 1 invoice line carries contract_bakery', () => {
    // The quote workbench screen is gone (DECISIONS.md 66), so this calls the two slice actions its Save called. The
    // storefront asked for 3x; only 2x is published for cat_fl_3yd, so the request is priced as 2x (DECISIONS.md 55).
    st().priceCommercialRequest({ quoteId: 'quote_bakery_request', lines: [{ catalogId: 'cat_fl_3yd', frequency: '2x', priceCents: 19800, qty: 1 }] })
    st().saveContractOverride({ accountId: 'acct_bakery', catalogId: 'cat_fl_3yd', frequency: '2x', priceCents: 19800, reason: 'competitive match', pctBelowRateCard: 10 })

    let { db } = st()
    expect(db.quotes.find(q => q.id === 'quote_bakery_request')).toMatchObject({ recurringCents: 19800, lines: [{ catalogId: 'cat_fl_3yd', frequency: '2x', priceCents: 19800, qty: 1 }] })
    const contract = db.contracts.find(c => c.id === 'contract_bakery')!
    expect(contract.overrides[0]).toMatchObject({ catalogId: 'cat_fl_3yd', frequency: '2x', priceCents: 19800, pctBelowRateCard: 10, reason: 'competitive match' })

    renderAt('/office/payments')
    clickRunCycle()
    decideBulkAndPostOnScreen()
    db = st().db
    const invoice = db.invoices.find(i => i.accountId === 'acct_bakery' && i.issuedAt.startsWith('2026-09-10'))!
    const line = chargesOn(invoice).find(c => c.catalogId === 'cat_fl_3yd')!
    expect(line).toMatchObject({ baseCents: 19800, totalCents: 22769, pricing: { ruleWon: 'contractOverride', contractId: 'contract_bakery' } })
    expect(invoice).toMatchObject({ number: 'INV-2026-0225', totalCents: 44737 })
    // The posted line on Payments names the contract as its source.
    fireEvent.click(screen.getByRole('button', { name: invoice.number }))
    const lines = document.getElementById(`lines-${invoice.id}`)!.textContent ?? ''
    expect(lines).toContain('base $198.00 · contract_bakery')
    cleanup()

    // The portal, signed in as the bakery: "Why this charge" on the posted line names the contract.
    st().portalSwitchAccount('acct_bakery')
    renderAt('/customer/portal/billing')
    const invoiceRow = screen.getByText(invoice.number).closest('tr')!
    fireEvent.click(within(invoiceRow).getByRole('button', { name: /^View/ }))
    const lineRow = screen.getByText(line.description!).closest('tr')!
    expect(lineRow.textContent).toContain('$227.69')
    fireEvent.click(within(lineRow).getByRole('button', { name: 'Why this charge' }))
    expect(document.body.textContent).toContain('contract_bakery')
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Scenario 4
// ---------------------------------------------------------------------------------------------------------------

describe('scenario 4 (box 4.4): Maple extra bags, waived as goodwill', () => {
  it('the event is in the queue with its photo; the goodwill waive moves leakage from $65.84 to $68.71 and deletes nothing', () => {
    renderAt('/office/payments')
    expect(screen.getByTestId('leakage-total').textContent).toBe('$65.84')
    clickRunCycle()
    selectReviewRow('acct_res_maple', 'Extra bags')
    const detail = screen.getByRole('complementary', { name: 'Item detail' })
    const evidence = within(detail).getByRole('region', { name: 'Evidence' })
    const photo = within(evidence).getByRole('img', { name: 'Driver photo, Extra bags, Sep 7' })
    expect(photo.getAttribute('src')).toBe(resolvePhoto('/evidence/maple-extra-bags.jpg'))
    expect(photo.getAttribute('src')).toMatch(/^\/photos\/.+\.svg$/)
    expect(evidence.textContent).toContain('3 bags beside cart, lid closed')
    expect(within(detail).getByRole('region', { name: 'Proposed amount' }).textContent).toContain('$2.87')

    fireEvent.click(within(detail).getByRole('button', { name: 'Waive' }))
    fireEvent.click(within(detail).getByRole('radio', { name: /^Goodwill/ }))
    fireEvent.click(within(detail).getByRole('button', { name: 'Waive $2.87' }))

    cleanup()
    renderAt('/office/payments')
    expect(screen.getByTestId('leakage-total').textContent).toBe('$68.71')
    const maple = queueItems(st()).find(i => i.accountName === 'Ruth Maple' && i.kind === 'extraBags')!
    expect(maple.decision).toBe('waived')
    expect(st().db.charges.find(c => c.id === maple.chargeId)?.status).toBe('waived')
    expect(st().db.waivedCharges.find(w => w.chargeId === maple.chargeId)).toMatchObject({ reason: 'goodwill', by: 'M. Alvarez' })
    expect(leakage(st()).totalCents).toBe(6871)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Scenario 5 and box 4.5a
// ---------------------------------------------------------------------------------------------------------------

describe('scenario 5 (boxes 4.5 and 4.5a): Hale roll-off overage, approved, posted, then charged to the card on file', () => {
  it('proposes $96.17 with ticket_hale_1, posts INV-2026-0265 at $168.87, and "Charge card on file" pays it with the allocation visible', () => {
    expect(st().db.accounts.find(a => a.id === 'acct_contractor_hale')).toMatchObject({ paymentMethodOnFile: 'card', autopay: false })
    renderAt('/office/payments')
    clickRunCycle()
    selectReviewRow('acct_contractor_hale', '$96.17')
    const detail = screen.getByRole('complementary', { name: 'Item detail' })
    const evidence = within(detail).getByRole('region', { name: 'Evidence' }).textContent ?? ''
    expect(evidence).toContain('ticket_hale_1')
    expect(evidence).toMatch(/1\.20 t/)
    fireEvent.click(within(detail).getByRole('button', { name: 'Approve $96.17' }))

    const paymentsBeforePost = st().db.payments.length
    decideBulkAndPostOnScreen()
    const { db } = st()
    const invoice = db.invoices.find(i => i.number === 'INV-2026-0265')!
    expect(invoice).toMatchObject({ accountId: 'acct_contractor_hale', totalCents: 16887 })
    expect(chargesOn(invoice).map(c => c.totalCents)).toEqual([2862, 9617, 4408])
    expect(chargesOn(invoice)[1].evidenceIds).toEqual(['ticket_hale_1', 'wo_hale_haul_1'])
    // Posting charges no card (invariant 7): no payment was created by the post.
    expect(st().db.payments).toHaveLength(paymentsBeforePost)
    expect(invoiceBalance(invoice.id, db)).toBe(16887)

    // The office opens the posted invoice and clicks Charge card on file, then confirms.
    fireEvent.click(screen.getByRole('button', { name: 'INV-2026-0265' }))
    fireEvent.click(screen.getByRole('button', { name: 'Charge card on file' }))
    const confirm = screen.getByRole('dialog', { name: 'Confirm card charge for INV-2026-0265' })
    expect(confirm.textContent).toContain("Charge $168.87 to Hale Construction's card on file for INV-2026-0265?")
    fireEvent.click(within(confirm).getByRole('button', { name: 'Charge $168.87' }))

    const after = st().db
    const payment = after.payments.find(p => p.id === 'pay_bl_0001')!
    expect(payment).toMatchObject({ accountId: 'acct_contractor_hale', method: 'card', cents: 16887, status: 'settled', receivedAt: '2026-09-10T12:00:00-04:00' })
    expect(after.allocations.filter(a => a.sourceId === payment.id)).toEqual([{ sourceType: 'payment', sourceId: 'pay_bl_0001', invoiceId: invoice.id, cents: 16887 }])
    expect(invoiceBalance(invoice.id, after)).toBe(0)
    expect(st().cardCharges).toEqual({ pay_bl_0001: { invoiceId: invoice.id, by: 'M. Alvarez', at: '2026-09-10T12:00:00-04:00' } })
    const postedCard = within(screen.getByRole('region', { name: 'Posted this cycle' }))
    expect(postedCard.getByRole('status').textContent).toBe("Charged $168.87 to Hale Construction's card on file: pay_bl_0001 applied to INV-2026-0265, balance $0.00.")
    expect(screen.getByTestId('applied-pay_bl_0001').textContent).toContain('($168.87)')
    expect(screen.getByTestId(`balance-${invoice.id}`).textContent).toContain('$0.00')
    // Paid in full: the button is gone, so a second click cannot charge twice.
    expect(screen.queryByRole('button', { name: 'Charge card on file' })).toBeNull()
    expect(() => st().chargeCardOnFile(invoice.id)).toThrow('INV-2026-0265 is paid in full, so there is nothing to charge')

    // Payments: the card charge and its allocation; the tiles count it as received and applied this week.
    const row = screen.getByTestId('card-charge-pay_bl_0001')
    expect(row.textContent).toContain('Hale Construction')
    expect(row.textContent).toContain('INV-2026-0265 $168.87')
    expect(row.textContent).toContain('by M. Alvarez')
    expect(cardChargeRows(st())[0].allocations[0]).toMatchObject({ invoiceNumber: 'INV-2026-0265', cents: 16887, invoiceBalanceCents: 0 })
    const tiles = paymentTiles(st())
    expect(tiles).toMatchObject({ receivedCents: 332142 + 16887, receivedCount: 17, appliedCents: 324112 + 16887, unappliedCents: 8030 })
    cleanup()

    // Account view: the payment row names the invoice it paid, and INV-2026-0265 is no longer open.
    renderAt('/office/account/acct_contractor_hale')
    const main = screen.getByRole('main', { name: 'Account' })
    const payRow = within(main).getByText('pay_bl_0001').closest('tr')!
    expect(payRow.textContent).toContain('INV-2026-0265 $168.87')
    const view = buildAccountView('acct_contractor_hale', st().db)!
    expect(view.payments.find(p => p.payment.id === 'pay_bl_0001')?.unappliedCents).toBe(0)
  })

  it('refuses an account with no card on file and an invoice that is not posted, writing nothing', () => {
    st().runCycle()
    st().bulkApproveClean()
    for (const i of queueItems(st())) if (!i.decided) st().approve(i.chargeId)
    const posted = st().post()
    const oakridge = posted.find(i => i.accountId === 'acct_pm_oakridge')!
    const before = st().db
    expect(() => st().chargeCardOnFile(oakridge.id)).toThrow('Oakridge Property Group has no card on file')
    expect(() => st().chargeCardOnFile('inv_nope')).toThrow('Unknown invoice inv_nope')
    expect(st().db).toBe(before)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Scenario 6
// ---------------------------------------------------------------------------------------------------------------

describe('scenario 6 (box 4.6): the owner publishes a 4% residential increase effective 2026-10-01', () => {
  it('the preview protects the 5 contract accounts, October bills the new rates, and INV-2026-0203 stays $180.74', () => {
    const before = postedSnapshot()
    renderAt('/owner/pricing')
    fireEvent.click(screen.getByRole('button', { name: 'Residential rates' }))
    fireEvent.click(screen.getByRole('button', { name: 'Adjust rates by x%' }))
    const form = screen.getByRole('dialog', { name: 'Adjust rates by a percentage' })
    fireEvent.change(within(form).getByRole('spinbutton', { name: 'Adjust by percent' }), { target: { value: '4' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Create 8 drafts' }))
    fireEvent.click(screen.getByRole('button', { name: /^Preview publish/ }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('31 accounts move')
    expect(dialog.textContent).toContain('5 protected by contract')
    const drafts = st().pricingDrafts
    expect(drafts).toHaveLength(8)
    const radius = blastRadius({ draftIds: drafts.map(d => d.id), drafts, onDate: today(), db: st().db })
    expect(radius.evaluatedOn).toBe('2026-10-01')
    expect(radius.movedAccounts).toHaveLength(31)
    const kept = radius.excludedContractAccounts.filter(p => p.protected)
    expect(kept.map(p => p.accountId).sort()).toEqual(['acct_bakery', 'acct_fl_002', 'acct_fl_004', 'acct_fl_006', 'acct_fl_008'])
    expect(radius.movedAccounts.some(m => m.accountId === 'acct_bakery')).toBe(false)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and publish 8 versions' }))
    expect(st().db.rateVersions.find(rv => rv.id === 'rv_pr_res_96_open_weekly_20261001')).toMatchObject({ priceCents: 3016, status: 'published', effectiveFrom: '2026-10-01' })
    cleanup()

    // Office: the run flags 41 rate changes; one confirmed group approval decides them, the other 9 are decided one by one.
    renderAt('/office/payments')
    clickRunCycle()
    const items = queueItems(st())
    expect(items).toHaveLength(50)
    expect(items.filter(i => i.kind === 'rateChange')).toHaveLength(41)
    fireEvent.click(screen.getByRole('button', { name: 'Approve 41 rate changes' }))
    const confirm = screen.getByRole('dialog', { name: 'Confirm rate changes' })
    expect(confirm.textContent).toContain('The other 9 charges under review stay one decision each.')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Approve 41 rate changes' }))
    expect(queueItems(st()).filter(i => !i.decided).map(i => i.kind).sort()).toEqual(['contamination', 'dryRun', 'dryRun', 'extraBags', 'extraDays', 'overage', 'overage', 'overload', 'serviceChange'])
    decideBulkAndPostOnScreen()

    const { db } = st()
    const maple = db.invoices.find(i => i.accountId === 'acct_res_maple' && i.number === 'INV-2026-0223')!
    const cart = chargesOn(maple).find(c => c.catalogId === 'cat_res_96')!
    expect(cart).toMatchObject({ baseCents: 9048, totalCents: 10659, pricing: { rateVersionId: 'rv_pr_res_96_open_weekly_20261001', ruleWon: 'zoneRate' } })
    expect(maple.totalCents).toBe(19047)
    // Bakery is on its contract: its 3 yd line is untouched by the residential publish.
    const bakery = db.invoices.find(i => i.accountId === 'acct_bakery' && i.issuedAt.startsWith('2026-09-10'))!
    expect(chargesOn(bakery).find(c => c.catalogId === 'cat_fl_3yd')?.pricing.contractId).toBe('contract_bakery')
    // Invariant 1: every invoice posted before the publish is byte for byte what it was, INV-2026-0203 included.
    for (const [id, snap] of before) expect(postedSnapshot().get(id)).toBe(snap)
    expect(db.invoices.find(i => i.number === 'INV-2026-0203')).toMatchObject({ totalCents: 18074 })
    expect(invoiceBalance(db.invoices.find(i => i.number === 'INV-2026-0203')!.id, db)).toBe(8745)
    cleanup()

    // Customer: the portal shows the unchanged Q3 invoice beside the new one.
    renderAt('/customer/portal/billing')
    const text = document.body.textContent ?? ''
    expect(text).toContain('$180.74')
    expect(text).toContain('$190.47')
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Scenario 7
// ---------------------------------------------------------------------------------------------------------------

describe('scenario 7 (box 4.7): Maple changes 96 gal to 64 gal in the portal mid-quarter', () => {
  it('the account view shows Oct 1, the open swap work order, $183.61 to $176.74 with no proration, and Mark scheduled', () => {
    expect(buildAccountView('acct_res_maple', st().db)!.nextInvoice.preview.totalCents).toBe(18361)
    renderAt('/customer/portal/requests')
    fireEvent.click(screen.getByRole('radio', { name: /^Cart size change/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }))
    const main = document.body.textContent ?? ''
    expect(main).toContain('Switching to 64')
    expect(main).toContain('wo_ac_0004')
    cleanup()

    const { db } = st()
    expect(db.workOrders.find(w => w.id === 'wo_ac_0004')).toMatchObject({ kind: 'swap', status: 'open', scheduledFor: '2026-09-14', requestId: 'req_p0001' })
    // Account ends the old cart on the new one's start date and never deletes it; the 64 gal line starts Oct 1.
    expect(db.serviceItems.find(i => i.id === 'si_maple_96')?.effectiveTo?.slice(0, 10)).toBe('2026-10-01')
    expect(db.serviceItems.find(i => i.id === 'si_ac_0097')).toMatchObject({ catalogId: 'cat_res_64', effectiveFrom: '2026-10-01' })
    const view = buildAccountView('acct_res_maple', db)!
    expect(view.nextInvoice.preview.totalCents).toBe(17674)
    const cart64 = view.nextInvoice.preview.recurring.find(c => c.catalogId === 'cat_res_64')!
    expect(cart64).toMatchObject({ baseCents: 8100, period: { start: '2026-10-01', end: '2026-12-31' } })
    // No proration: the posted Q3 invoice is untouched and no credit or partial line exists.
    expect(db.invoices.find(i => i.number === 'INV-2026-0203')?.totalCents).toBe(18074)
    expect(view.nextInvoice.preview.recurring.some(c => c.catalogId === 'cat_res_96')).toBe(false)

    // The new line is priced on its start date: $27.00 a month from Oct 1 (the seed's 64 gal rate then), which is what
    // the $176.74 bills (3 x $27.00 = $81.00 base), not today's $26.00.
    const line64 = view.sites.flatMap(s => s.lines).find(l => l.item.id === 'si_ac_0097')!
    expect(line64.resolved).toMatchObject({ priceCents: 2700, ruleWon: 'zoneRate' })

    renderAt('/office/account/acct_res_maple')
    const account = screen.getByRole('main', { name: 'Account' })
    expect(account.textContent).toMatch(/64 gal[\s\S]*Oct 1, 2026/)
    expect(within(account).getByText('C64-9001').closest('tr')!.textContent).toContain('$27.00')
    expect(within(screen.getByRole('region', { name: 'Next billing run preview' })).getAllByText('$176.74').length).toBeGreaterThan(0)
    const open = within(screen.getByRole('region', { name: 'Open items' }))
    expect(open.getAllByText('wo_ac_0004').length).toBeGreaterThan(0)
    fireEvent.click(open.getByRole('button', { name: 'Mark scheduled' }))
    expect(st().db.workOrders.find(w => w.id === 'wo_ac_0004')?.status).toBe('scheduled')
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Box 4.7a
// ---------------------------------------------------------------------------------------------------------------

describe('box 4.7a: an auto-renewed contract is said so, on the account view and in the pricing agent', () => {
  it('the contract card says "Auto-renewed on Jan 1, 2027" once resolvePrice renews contract_bakery, and nothing before', () => {
    renderAt('/office/account/acct_bakery')
    expect(screen.queryByTestId('contract-renewed')).toBeNull()
    cleanup()
    act(() => setToday('2027-01-15'))
    renderAt('/office/account/acct_bakery')
    expect(screen.getByTestId('contract-renewed').textContent).toBe('Auto-renewed on Jan 1, 2027')
    expect(today()).toBe('2027-01-15')
  })

  it('the agent row for a renewed contract is protected and never says it bills at the ratebook', () => {
    const rows = proposeIncreases({ onDate: '2027-01-15' }, st().db)
    const bakery = rows.find(r => r.accountId === 'acct_bakery')!
    expect(bakery.contract?.id).toBe('contract_bakery')
    expect(bakery.contractTerm).toEqual({ start: '2027-01-01', end: '2027-12-31', renewedOn: '2027-01-01' })
    expect(bakery.lapsedContract).toBeUndefined()
    expect(bakery.rationale).toContain("Contract contract_bakery's signed term ended 2026-12-31 and it auto-renewed on 2027-01-01, so it still prices this account")
    for (const r of rows) expect(r.rationale).not.toContain('already bills at the ratebook')
    // In the signed term nothing about renewal is said.
    const now = proposeIncreases({ onDate: '2026-09-10' }, st().db).find(r => r.accountId === 'acct_bakery')!
    expect(now.contractTerm).toEqual({ start: '2026-01-01', end: '2026-12-31' })
    expect(now.rationale).not.toContain('auto-renewed')
  })
})
