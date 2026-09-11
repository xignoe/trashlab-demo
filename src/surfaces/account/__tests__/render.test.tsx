// @vitest-environment jsdom
/**
 * The account surface renders for the five focus accounts with no console output (box 2A.5), mounted on its own route
 * so this suite does not depend on the other surfaces' in-progress code. The shell's routes.test.tsx covers the
 * mounted route tree once every surface resolves.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../../store/useStore'
import AccountSurface from '../index'

/** The React Router v7 flags the app runs with (src/App.tsx ROUTER_FUTURE), inlined so this suite never imports App. */
const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const

function renderAt(accountId: string) {
  return render(
    <MemoryRouter initialEntries={[`/office/account/${accountId}`]} future={ROUTER_FUTURE}>
      <Routes>
        <Route path="/office/account/:accountId/*" element={<AccountSurface />} />
      </Routes>
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

describe('account surface', () => {
  it.each([
    ['acct_res_maple', 'Ruth Maple', '$183.61'],
    ['acct_bakery', 'Sunrise Bakery', '$447.37'],
    ['acct_pm_oakridge', 'Oakridge Property Group', '$646.00'],
    ['acct_contractor_hale', 'Hale Construction', '$168.87'],
    ['acct_res_kerr', 'Lena Kerr', '$0.00'],
  ])('%s renders inside .surface-account with its name and next invoice', (id, name, next) => {
    const { container } = renderAt(id)
    const wrapper = container.querySelector('.surface-account')!
    expect(wrapper).not.toBeNull()
    expect(within(wrapper as HTMLElement).getByRole('heading', { level: 1 }).textContent).toBe(name)
    const card = screen.getByLabelText('Next billing run preview')
    expect(card.textContent).toContain(next)
  })

  it('an unknown account says so instead of crashing', () => {
    renderAt('acct_nope')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Account not found')
  })

  it('the rail links stay on the office route', () => {
    const { container } = renderAt('acct_res_maple')
    const links = [...container.querySelectorAll('.rail a')].map(a => a.getAttribute('href'))
    expect(links).toEqual([
      '/office/account',
      '/office/account/acct_res_maple', '/office/account/acct_bakery', '/office/account/acct_pm_oakridge',
      '/office/account/acct_contractor_hale', '/office/account/acct_res_kerr',
    ])
  })

  it('Scenario A in the UI: the change drawer previews wo_ac_0004 and confirm shows it as an open item', () => {
    renderAt('acct_res_maple')
    fireEvent.click(screen.getByRole('button', { name: 'Change 96 gal cart' }))
    const dialog = screen.getByRole('dialog')
    const newService = within(dialog).getAllByRole('combobox')[1]
    fireEvent.change(newService, { target: { value: 'cat_res_64' } })
    expect(dialog.textContent).toContain('wo_ac_0004')
    expect(dialog.textContent).toContain('$176.74')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and create swap' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByLabelText('Open items').textContent).toContain('wo_ac_0004')
    expect(screen.getByLabelText('Next billing run preview').textContent).toContain('$176.74')
  })
})

describe('accounts table', () => {
  function renderList(search = '') {
    return render(
      <MemoryRouter initialEntries={[`/office/account${search}`]} future={ROUTER_FUTURE}>
        <Routes>
          <Route path="/office/account" element={<AccountSurface />} />
          <Route path="/office/account/:accountId/*" element={<AccountSurface />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('lists every account, and a row shows its balance and opens that account', () => {
    const { unmount } = renderList()
    const total = useStore.getState().db.accounts.length
    expect(screen.getByText(`${total} accounts`)).toBeTruthy()
    unmount()
    renderList('?q=maple')
    const maple = screen.getByText('Ruth Maple').closest('tr')!
    expect(maple.textContent).toContain('$87.45')
    fireEvent.click(maple)
    expect(document.querySelector('.accounts-table')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ruth Maple')
  })

  it('filters by status and search', () => {
    renderList()
    fireEvent.click(within(screen.getByRole('group', { name: 'Filter by status' })).getByRole('button', { name: /^Past due/ }))
    const pastDue = useStore.getState().db.accounts.filter(a => a.status === 'pastDue').length
    expect(screen.getByText(new RegExp(`^${pastDue} of \\d+ accounts$`))).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search accounts' }), { target: { value: 'maple' } })
    expect(screen.getByText('Ruth Maple')).toBeTruthy()
  })

  it('the status chip counts follow the other filters', () => {
    renderList('?q=maple')
    const chips = within(screen.getByRole('group', { name: 'Filter by status' }))
    expect(chips.getByRole('button', { name: /^All/ }).textContent).toBe('All1')
    expect(chips.getByRole('button', { name: /^Past due/ }).textContent).toBe('Past due1')
    expect(chips.getByRole('button', { name: /^Active/ }).textContent).toBe('Active0')
  })

  it('windows thousands of rows instead of rendering them all', () => {
    const { container } = renderList('?sample=5000')
    expect(screen.getByText(/^5,0\d\d accounts$/, { selector: '.accounts-foot-left span' })).toBeTruthy()
    expect(container.querySelectorAll('tr.accounts-row').length).toBeLessThan(100)
  })
})
