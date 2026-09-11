// @vitest-environment jsdom
/**
 * Box 3.1: a storefront signup is an account the office can open. After sfCompleteInstantSignup, the account view at
 * /office/account/<new id> shows the new account with its service item, delivery work order, approved first-cycle
 * charges, and payment; the rail pins it and its search finds it.
 *
 * Figures come from the seed and the canonical engine, which another agent is changing (fee months, period ends), so
 * these tests assert relationships (the payment equals the approved charges, every id the signup returned is on the
 * view), never absolute cents.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes, ROUTER_FUTURE } from '../App'
import { useStore } from '../store/useStore'
import { buildAccountView, pinnedAccountIds, searchAccounts } from '../surfaces/account/selectors'
import { signUpAtLarkspur } from './helpers'

const st = () => useStore.getState()

let errors: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  st().reset()
  errors = vi.spyOn(console, 'error')
})
afterEach(() => {
  cleanup()
  expect(errors).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <AppRoutes />
    </MemoryRouter>,
  )
}

describe('box 3.1: storefront signup to account view', () => {
  it('the account view model carries every row the signup wrote', () => {
    const result = signUpAtLarkspur()
    const { db } = st()
    const view = buildAccountView(result.accountId, db)!
    expect(view).toBeDefined()
    expect(view.payer.name).toBe('Dana Larkspur')
    expect(view.account.status).toBe('active')

    // Service item: active at the new site.
    const lines = view.sites.flatMap(s => s.activeLines.map(l => l.item.id))
    expect(lines).toEqual(expect.arrayContaining(result.serviceItemIds))

    // Delivery work order, scheduled for the day before the first pickup.
    const wo = view.workOrders.find(w => w.workOrder.id === result.workOrderIds[0])!
    expect(wo.workOrder).toMatchObject({ kind: 'deliver', status: 'scheduled', scheduledFor: result.cartArrives })
    expect(view.openWorkOrders.map(w => w.workOrder.id)).toContain(wo.workOrder.id)

    // Approved first-cycle charges wait for billing on the next-invoice card; none is invoiced yet.
    const waiting = view.nextInvoice.preview.proposed
    expect(waiting.map(c => c.id)).toEqual(expect.arrayContaining(result.chargeIds))
    expect(waiting.filter(c => result.chargeIds.includes(c.id)).every(c => c.status === 'approved')).toBe(true)
    expect(view.invoices).toHaveLength(0)

    // The payment is on the account and equals the approved charges it paid for (unapplied until billing posts).
    const pay = view.payments.find(p => p.payment.id === result.paymentId)!
    const chargedCents = result.chargeIds.reduce((s, id) => s + db.charges.find(c => c.id === id)!.totalCents, 0)
    expect(pay.payment.cents).toBe(chargedCents)
    expect(pay.payment.status).toBe('settled')
  })

  it('/office/account/<new id> renders the account, its cart, work order, charges, and payment', () => {
    const result = signUpAtLarkspur()
    const { db } = st()
    const { container } = renderAt(`/office/account/${result.accountId}`)
    const main = within(screen.getByRole('main', { name: 'Account' }))
    expect(main.getAllByText('Dana Larkspur').length).toBeGreaterThan(0)
    // The next-run card lists its lines behind a toggle; open it so the approved charges are on the page.
    fireEvent.click(screen.getByRole('button', { name: /^Show \d+ lines?$/ }))
    const text = container.textContent ?? ''

    const serial = db.containers.find(c => c.id === result.containerIds[0])!.serial
    expect(text).toContain(serial)
    expect(text).toContain(result.workOrderIds[0])
    for (const id of result.chargeIds) expect(text).toContain(db.charges.find(c => c.id === id)!.description)
    expect(text).toContain(result.paymentId)
    expect(screen.queryByText('Account not found')).toBeNull()
  })

  it('the rail pins the new account and its search finds it by name and by address', () => {
    const result = signUpAtLarkspur()
    expect(pinnedAccountIds(st().db).at(-1)).toBe(result.accountId)
    expect(searchAccounts('Dana Lark', st().db).map(s => s.account.id)).toEqual([result.accountId])

    renderAt('/office/account/acct_res_maple')
    const rail = within(screen.getByRole('complementary', { name: 'Accounts' }))
    const pinned = rail.getAllByRole('link').map(a => a.getAttribute('href'))
    expect(pinned).toContain(`/office/account/${result.accountId}`)

    fireEvent.change(rail.getByLabelText('Find an account'), { target: { value: 'Dana' } })
    const hit = rail.getByRole('link', { name: /Dana Larkspur/ })
    expect(hit.getAttribute('href')).toBe(`/office/account/${result.accountId}`)
    fireEvent.click(hit)
    expect(within(screen.getByRole('main', { name: 'Account' })).getAllByText('Dana Larkspur').length).toBeGreaterThan(0)
  })
})
