// @vitest-environment jsdom
/**
 * Box 2C.5: /customer/portal and its two sub-routes render in .surface-portal with no console error or warning, and
 * the four portal/RUNBOOK.md scenarios work through the real screens.
 *
 * The surface is mounted the way App.tsx mounts it (`customer/portal/*`, the same v7 flags), but without importing
 * App.tsx: that would pull in the other three surfaces, which are being ported in parallel, so this suite would fail
 * for reasons outside the portal. src/shell/routes.test.tsx covers the portal inside the full route tree.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PortalSurface from '../index'
import { useStore } from '../../../store/useStore'
import { setToday } from '../../../store/clock'
import { money } from '../lib/money'
import { MAPLE, OAKRIDGE, maplePastDueInvoice, openFromRows, s } from './helpers'

/** App.tsx's ROUTER_FUTURE, repeated so this file does not import App.tsx. */
const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <Routes>
        <Route path="customer/portal/*" element={<PortalSurface />} />
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
  setToday()
})

const button = (name: string | RegExp, root: HTMLElement = document.body) => within(root).getByRole('button', { name })

describe('routes', () => {
  it.each([
    ['/customer/portal', 'Overview'],
    ['/customer/portal/billing', 'Billing'],
    ['/customer/portal/requests', 'Requests'],
  ])('%s renders %s inside .surface-portal', (path, title) => {
    const { container } = renderAt(path)
    expect(container.querySelectorAll('.surface-portal')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy()
    expect(screen.getByRole('link', { name: title }).getAttribute('aria-current')).toBe('page')
  })

  it('an unknown sub-route lands on the overview', () => {
    renderAt('/customer/portal/nope')
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeTruthy()
  })

  it("the overview shows Maple's seed balance, the past due pill, and all four invariants passing", () => {
    renderAt('/customer/portal')
    const open = openFromRows(maplePastDueInvoice().id)
    expect(screen.getAllByText(money(open)).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Past due').length).toBeGreaterThan(0)
    expect(screen.getByTestId('invariants').textContent).toContain('4 of 4 pass')
  })
})

describe('runbook scenarios through the screens', () => {
  it('1. Maple pays the past due invoice and turns on autopay', () => {
    renderAt('/customer/portal/billing')
    const inv = maplePastDueInvoice()
    const open = openFromRows(inv.id)
    fireEvent.click(screen.getAllByRole('button', { name: 'Pay now' })[0])
    const sheet = screen.getByRole('dialog', { name: `Pay invoice ${inv.number}` })
    expect((within(sheet).getByLabelText('Amount') as HTMLInputElement).value).toBe((open / 100).toFixed(2))
    expect(within(sheet).getByText('Visa ending in 4242')).toBeTruthy()
    fireEvent.click(button(`Pay ${money(open)}`, sheet))
    const receipt = screen.getByRole('dialog', { name: 'Payment received' })
    expect(receipt.textContent).toContain('pay_p0001')
    expect(receipt.textContent).toContain(inv.number)
    fireEvent.click(button('Done', receipt))

    fireEvent.click(screen.getByRole('switch', { name: 'Autopay' }))
    expect(screen.getByText('Autopay on: we charge your saved method on each due date')).toBeTruthy()
    expect(s().accounts.find(a => a.id === MAPLE)).toMatchObject({ status: 'active', autopay: true })
    expect(screen.queryByRole('button', { name: 'Pay now' })).toBeNull()
  })

  it('2. Maple reports the missed pickup: the blocked stop shows its photo and books no recovery; the real miss does', () => {
    renderAt('/customer/portal/requests')
    fireEvent.click(screen.getByRole('radio', { name: /Missed pickup/ }))
    const date = screen.getByLabelText('Pickup day') as HTMLInputElement
    expect(date.value).toBe('2026-09-07')

    fireEvent.change(date, { target: { value: '2026-08-24' } })
    fireEvent.click(button('Check this day'))
    const card = screen.getByTestId('event-card')
    expect(card.textContent).toContain('Cart blocked by a parked vehicle in the driveway')
    expect(card.textContent).toContain('R. Alvarez')
    expect(card.querySelector('img')?.getAttribute('src')).toBe('/photos/blocked-driveway.svg')
    expect(screen.getByText('No recovery pickup is scheduled')).toBeTruthy()
    expect(s().workOrders.some(w => w.kind === 'recovery')).toBe(false)

    fireEvent.change(screen.getByLabelText('Pickup day'), { target: { value: '2026-08-17' } })
    fireEvent.click(button('Check this day'))
    expect(screen.getByTestId('recovery-booked').textContent).toContain('Friday, Sep 11')
    const row = screen.getByTestId('open-items').querySelector('[data-request="req_p0001"]') as HTMLElement
    expect(row.textContent).toContain('scheduled')
    expect(row.textContent).toContain('wo_p0001')
  })

  it('3. Maple books an extra pickup for Monday, Sep 14 at $28.62', () => {
    renderAt('/customer/portal/requests')
    fireEvent.click(screen.getByRole('radio', { name: /Extra pickup/ }))
    const checks = screen.getByTestId('check-rows')
    expect(checks.querySelectorAll('[data-ok="true"]')).toHaveLength(3)
    expect(checks.textContent).toContain('Monday, Sep 14')
    const stack = screen.getByTestId('price-stack')
    expect(stack.textContent).toContain('$25.00')
    expect(stack.textContent).toContain('$28.62')
    fireEvent.click(button('Pay $28.62 and book'))
    fireEvent.click(button('Pay $28.62 with Visa ending in 4242'))
    expect(screen.getByText('Extra pickup booked for Monday, Sep 14')).toBeTruthy()
    const row = screen.getByTestId('open-items').querySelector('[data-request="req_p0001"]') as HTMLElement
    expect(row.textContent).toContain('Extra pickup')
    expect(row.textContent).toContain('wo_p0001')
    expect(row.textContent).toContain('Monday, Sep 14')
  })

  it('4. Oakridge switches to site 2 and requests a quote, followed up by Friday, Sep 11, 10:00 am', () => {
    renderAt('/customer/portal/requests')
    fireEvent.change(screen.getByLabelText('Signed in as'), { target: { value: OAKRIDGE } })
    const site2 = s().sites.find(x => x.id === 'site_oak_2')!
    fireEvent.click(screen.getByRole('tab', { name: new RegExp(site2.address) }))
    expect(s().session.siteId).toBe('site_oak_2')
    fireEvent.click(screen.getByRole('radio', { name: /Request a quote/ }))
    expect((screen.getByLabelText('Site', { selector: 'select' }) as HTMLSelectElement).value).toBe('site_oak_2')
    fireEvent.change(screen.getByLabelText('Container size'), { target: { value: '3 yd' } })
    fireEvent.change(screen.getByLabelText('Material'), { target: { value: 'cardboard' } })
    fireEvent.change(screen.getByLabelText('Pickups'), { target: { value: '2x' } })
    fireEvent.change(screen.getByLabelText('Access notes'), { target: { value: 'Gate code 4411' } })
    act(() => { fireEvent.click(button('Send quote request')) })
    expect(screen.getByTestId('quote-submitted').textContent).toContain('quote_p0001')
    const row = screen.getByTestId('open-items').querySelector('[data-request="req_p0001"]') as HTMLElement
    expect(row.textContent).toContain('open')
    expect(row.textContent).toContain('quote_p0001')
    expect(row.textContent).toContain('Priced by a person, we will send the quote by Friday, Sep 11, 10:00 am')
  })
})

describe('requests a person handles', () => {
  it('the picker offers Add a cart to residential accounts only, and Other to everyone', () => {
    renderAt('/customer/portal/requests')
    expect(screen.getByRole('radio', { name: /Add a cart/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /^Other/ })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Signed in as'), { target: { value: OAKRIDGE } })
    expect(screen.queryByRole('radio', { name: /Add a cart/ })).toBeNull()
    expect(screen.getByRole('radio', { name: /Request a quote/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /^Other/ })).toBeTruthy()
  })

  it('Other needs text, then files one open Request with the text as its note', () => {
    renderAt('/customer/portal/requests')
    fireEvent.click(screen.getByRole('radio', { name: /^Other/ }))
    expect((button('Send request') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Your request'), { target: { value: 'Please move the cart pad closer to the curb' } })
    act(() => { fireEvent.click(button('Send request')) })
    expect(screen.getByTestId('general-request-sent').textContent).toContain('req_p0001')
    expect(s().requests.find(r => r.id === 'req_p0001')).toMatchObject({
      kind: 'other', status: 'open', createdVia: 'portal', note: 'Please move the cart pad closer to the curb',
    })
    const row = screen.getByTestId('open-items').querySelector('[data-request="req_p0001"]') as HTMLElement
    expect(row.textContent).toContain('Other request')
    expect(row.textContent).toContain('open')
  })

  it('a bulky item pickup puts the pick, the day, and the details in the note, with no work order', () => {
    renderAt('/customer/portal/requests')
    fireEvent.click(screen.getByRole('radio', { name: /Bulky item pickup/ }))
    expect((button('Send request') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: 'Mattress or box spring' }))
    fireEvent.change(screen.getByLabelText(/Preferred day/), { target: { value: '2026-09-15' } })
    fireEvent.change(screen.getByLabelText(/Details/), { target: { value: 'One queen mattress' } })
    act(() => { fireEvent.click(button('Send request')) })
    const req = s().requests.find(r => r.id === 'req_p0001')!
    expect(req).toMatchObject({ kind: 'bulkyItem', status: 'open', createdVia: 'portal' })
    expect(req.workOrderId).toBeUndefined()
    expect(req.note).toMatch(/^Mattress or box spring; Preferred day .+; One queen mattress$/)
  })
})
