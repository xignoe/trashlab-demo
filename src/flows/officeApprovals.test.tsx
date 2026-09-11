// @vitest-environment jsdom
/**
 * Box 3.7d: the storefront's held-signup approval is office work. It mounts at /office/approvals inside
 * .surface-storefront under the Office persona, the old /customer/store/office path lands there, and approving the
 * held seed quote from it charges and activates the account, which the account view then opens.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes, ROUTER_FUTURE } from '../App'
import { useStore } from '../store/useStore'

const st = () => useStore.getState()
let where = ''
function Where() {
  where = useLocation().pathname
  return null
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <AppRoutes />
      <Where />
    </MemoryRouter>,
  )
}

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

describe('box 3.7d: office approvals under the Office persona', () => {
  it('renders the approval screen inside .surface-storefront with Office active', () => {
    const { container } = renderAt('/office/approvals')
    expect(container.querySelector('.surface-storefront')).not.toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Office approvals')
    expect(screen.getByRole('link', { name: 'Office' }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByRole('link', { name: 'Approvals' }).getAttribute('aria-current')).toBe('page')
    // The buyer's storefront header is not part of the office screen.
    expect(screen.queryByRole('navigation', { name: 'Storefront' })).toBeNull()
  })

  it('/customer/store/office redirects there; the removed Store inspector has no tab and its old link lands on approvals', () => {
    renderAt('/customer/store/office')
    expect(where).toBe('/office/approvals')
    expect(screen.queryByRole('tab', { name: 'Store' })).toBeNull()
    cleanup()
    renderAt('/office/approvals/store')
    expect(where).toBe('/office/approvals')
  })

  it('approving the held seed quote charges the saved card and activates an account the office can open', () => {
    renderAt('/office/approvals')
    const held = st().db.quotes.find(q => q.status === 'held')!
    const row = screen.getByTestId(`office-${held.id}`)
    const accountsBefore = st().db.accounts.length
    fireEvent.click(within(row).getByRole('button', { name: 'Approve' }))

    const { db } = st()
    expect(db.quotes.find(q => q.id === held.id)?.status).toBe('accepted')
    expect(db.accounts).toHaveLength(accountsBefore + 1)
    const approval = st().sfUi.approvals[held.id]
    const account = db.accounts.find(a => a.id === approval.accountId)!
    expect(account.status).toBe('active')
    const charged = db.charges.filter(c => approval.chargeIds.includes(c.id))
    expect(charged.every(c => c.status === 'approved')).toBe(true)
    expect(db.payments.find(p => p.id === approval.paymentId)?.cents).toBe(charged.reduce((s, c) => s + c.totalCents, 0))
    expect(within(row).getByTestId(`approval-${held.id}`).textContent).toMatch(/^Approved\. Charged \$/)

    // The Office persona opens the activated account.
    cleanup()
    renderAt(`/office/account/${account.id}`)
    expect(screen.queryByText('Account not found')).toBeNull()
    expect(screen.getByRole('main', { name: 'Account' }).textContent).toContain(approval.paymentId)
  })
})
