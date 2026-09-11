// @vitest-environment jsdom
/**
 * The rate sheet (DECISIONS.md entry 68) through the real Ratebook at /owner/pricing: every line of business in one
 * table, a price edited in place (Enter saves a draft and moves down, Escape cancels), and the Grid view filling an
 * empty cell as a new rate line. No console error or warning.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes, ROUTER_FUTURE } from '../../../App'
import { useStore } from '../../../store/useStore'

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

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <AppRoutes />
    </MemoryRouter>,
  )

const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const drafts = () => useStore.getState().pricingDrafts

describe('Rate sheet', () => {
  it('shows every line of business at once and edits a price in place', () => {
    const { container } = renderAt('/owner/pricing')
    const sheet = screen.getByRole('region', { name: 'Rate sheet' })
    expect(text(within(sheet).getByTestId('sheet-summary'))).toContain('24 of 24 rate lines')
    // Columns come from the fields the rates are keyed by.
    const headers = within(sheet).getAllByRole('columnheader').map(h => text(h))
    expect(headers).toEqual(expect.arrayContaining(['Service', 'Zone type', 'Frequency', 'Customer tier', 'Price', 'Unit']))

    const line = container.querySelector('[data-line="cat_res_96|zone_open|weekly"]') as HTMLElement
    fireEvent.click(within(line).getByRole('button', { name: /^Price for 96 gal cart, Open market, weekly: \$29\.00/ }))
    const input = within(line).getByLabelText('New price for 96 gal cart') as HTMLInputElement
    expect(input.value).toBe('29.00')
    fireEvent.change(input, { target: { value: '30.50' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(drafts()).toHaveLength(1)
    expect(drafts()[0]).toMatchObject({
      catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 3050, effectiveFrom: '2026-10-01', supersedesId: 'rv_res_96_2026', status: 'draft',
    })
    expect(text(line)).toContain('Draft $30.50 from 2026-10-01')
    expect(text(screen.getByTestId('ratebook-status'))).toBe('25 published, 1 draft')

    // Enter moved the editor to the next line; Escape there cancels without a draft.
    const next = container.querySelector('[data-line="cat_res_96|zone_boundary|weekly"]') as HTMLElement
    const nextInput = within(next).getByLabelText('New price for 96 gal cart')
    fireEvent.keyDown(nextInput, { key: 'Escape' })
    expect(within(next).queryByLabelText('New price for 96 gal cart')).toBeNull()
    expect(drafts()).toHaveLength(1)

    // Editing the line again replaces its draft instead of stacking a second one.
    fireEvent.click(within(line).getByRole('button', { name: /^Price for 96 gal cart, Open market, weekly/ }))
    const again = within(line).getByLabelText('New price for 96 gal cart') as HTMLInputElement
    expect(again.value).toBe('30.50')
    fireEvent.change(again, { target: { value: '31' } })
    fireEvent.keyDown(again, { key: 'Tab' })
    expect(drafts()).toHaveLength(1)
    expect(drafts()[0].priceCents).toBe(3100)
  })

  it('fills an empty cell in the Grid view as a new rate line', () => {
    renderAt('/owner/pricing')
    const sheet = screen.getByRole('region', { name: 'Rate sheet' })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Grid' }))
    fireEvent.change(within(sheet).getByRole('combobox', { name: 'Columns across' }), { target: { value: 'zone' } })
    const headers = within(sheet).getAllByRole('columnheader').map(h => text(h))
    expect(headers).toEqual(expect.arrayContaining(['Open market', 'Boundary', 'City franchise', 'Not served']))

    fireEvent.click(within(sheet).getByRole('button', { name: 'Add a rate for 96 gal cart, City franchise' }))
    const input = within(sheet).getByLabelText('Price for 96 gal cart, City franchise')
    fireEvent.change(input, { target: { value: '33' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(drafts()).toHaveLength(1)
    expect(drafts()[0]).toMatchObject({ catalogId: 'cat_res_96', zoneId: 'zone_franchise', frequency: 'weekly', priceCents: 3300 })
    expect(drafts()[0].supersedesId).toBeUndefined()
  })

  it('refuses a price that is not a dollar amount and keeps the editor open', () => {
    const { container } = renderAt('/owner/pricing')
    const line = container.querySelector('[data-line="cat_res_96|zone_open|weekly"]') as HTMLElement
    fireEvent.click(within(line).getByRole('button', { name: /^Price for 96 gal cart/ }))
    const input = within(line).getByLabelText('New price for 96 gal cart')
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(text(within(line).getByRole('alert'))).toBe('Enter a price in dollars, like 31.50')
    expect(drafts()).toHaveLength(0)
  })
})
