// @vitest-environment jsdom
/**
 * Box 1.11: every route renders inside the shell and mounts its surface's wrapper class, and redirects land where the
 * persona map says. Renders the real route tree (AppRoutes) in a MemoryRouter.
 */
import { cleanup, render } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes, ROUTER_FUTURE } from '../App'
import { useStore } from '../store/useStore'
import { PERSONAS } from './routes'

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
let warnings: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  useStore.getState().reset()
  errors = vi.spyOn(console, 'error')
  warnings = vi.spyOn(console, 'warn')
})

afterEach(() => {
  cleanup()
  expect(errors).not.toHaveBeenCalled()
  expect(warnings).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

const SURFACE_ROUTES: [string, string][] = [
  ['/owner/pricing', 'pricing'],
  ['/office/account', 'account'],
  ['/office/account/acct_res_maple', 'account'],
  ['/office/account/acct_bakery', 'account'],
  ['/office/payments', 'billing'],
  ['/customer/store', 'storefront'],
  ['/customer/store/offer', 'storefront'],
  ['/customer/portal', 'portal'],
  ['/office/approvals', 'storefront'],
]

describe('routes', () => {
  it.each(SURFACE_ROUTES)('%s renders the persona bar and .surface-%s', (path, surface) => {
    const { container, getByTestId } = renderAt(path)
    expect(getByTestId('persona-bar')).toBeTruthy()
    expect(container.querySelectorAll(`.surface-${surface}`)).toHaveLength(1)
    expect(where).toBe(path)
  })

  it('every screen in the persona map renders its surface', () => {
    for (const persona of PERSONAS) {
      for (const screen of persona.screens) {
        const { container, unmount } = renderAt(screen.to)
        expect(container.querySelector(`.surface-${screen.surface}`), screen.to).not.toBeNull()
        unmount()
      }
    }
  })

  it.each([
    ['/', '/office/account'],
    ['/owner', '/owner/pricing'],
    ['/owner/pricing/quote', '/owner/pricing'],
    ['/office', '/office/account'],
    ['/customer', '/customer/store'],
    ['/office/billing', '/office/payments'],
    ['/customer/store/office', '/office/approvals'],
    ['/customer/store/office/store', '/office/approvals'],
    ['/office/approvals/store', '/office/approvals'],
  ])('%s redirects to %s', (from, to) => {
    renderAt(from)
    expect(where).toBe(to)
  })

  it('an unknown path shows the not found screen inside the shell', () => {
    const { getByText, getByTestId } = renderAt('/nowhere')
    expect(getByTestId('persona-bar')).toBeTruthy()
    expect(getByText('No screen at this address')).toBeTruthy()
  })

  it('the billing surface renders Payments with no billing tab row and no prototype office nav', () => {
    const { container, getByRole } = renderAt('/office/payments')
    expect(container.querySelector('.surface-billing .tl-subnav')).toBeNull()
    expect(container.querySelector('.tl-nav')).toBeNull()
    expect(getByRole('heading', { level: 1 }).textContent).toBe('Payments and deposits')
  })

  it('Office lists Accounts, Billing groups, Payments, and Approvals', () => {
    const { getByRole } = renderAt('/office/account')
    const nav = getByRole('navigation', { name: 'Office screens' })
    expect([...nav.querySelectorAll('a')].map(a => a.firstChild?.textContent)).toEqual(['Accounts', 'Billing groups', 'Payments', 'Approvals'])
  })

  it('the persona bar marks the persona and screen from the URL and shows the demo clock', () => {
    const { getByRole, getByText, queryByRole } = renderAt('/owner/pricing')
    expect(getByRole('link', { name: 'Owner' }).getAttribute('aria-current')).toBe('true')
    expect(getByRole('link', { name: 'Ratebook' }).getAttribute('aria-current')).toBe('page')
    expect(queryByRole('link', { name: 'Quote workbench' })).toBeNull()
    expect(getByText('Sep 10, 2026')).toBeTruthy()
  })
})
