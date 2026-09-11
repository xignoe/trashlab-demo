// @vitest-environment jsdom
/**
 * Edit in the Ratebook (DECISIONS.md entry 71): a rate line's Edit opens the rate form on that line, and a billing
 * cycle's adjustment and a tax layer open their forms with Edit.
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

/** The 96 gal boundary weekly line of the rate sheet, which rv_res_96_2026_boundary bills at $31.00. */
function boundaryLine(): HTMLTableRowElement {
  const line = [...document.querySelectorAll<HTMLTableRowElement>('tr[data-line]')].find(tr =>
    ['cat_res_96', 'zone_boundary', 'weekly'].every(part => (tr.dataset.line ?? '').includes(part)),
  )
  if (!line) throw new Error('no 96 gal boundary weekly line on the sheet')
  return line
}

const editLine = () => fireEvent.click(within(boundaryLine()).getByRole('button', { name: /^Edit rate for / }))

describe('Edit rate', () => {
  it('opens on the line, saves a draft that supersedes it for everyone from next month, and a second edit replaces that draft', () => {
    renderAt('/owner/pricing')
    editLine()
    const dialog = screen.getByRole('dialog', { name: 'Edit rate' })
    expect((within(dialog).getByRole('combobox', { name: 'Service' }) as HTMLSelectElement).value).toBe('cat_res_96')
    expect((within(dialog).getByRole('combobox', { name: 'Zone type' }) as HTMLSelectElement).value).toBe('zone_boundary')
    expect((within(dialog).getByRole('combobox', { name: 'Frequency' }) as HTMLSelectElement).value).toBe('weekly')
    const price = within(dialog).getByRole('textbox', { name: 'Price per month' }) as HTMLInputElement
    expect(price.value).toMatch(/^31(\.00)?$/)
    expect((within(dialog).getByRole('radio', { name: /Everyone on this line/ }) as HTMLInputElement).checked).toBe(true)
    expect((within(dialog).getByLabelText('Effective from') as HTMLInputElement).value).toBe('2026-10-01')
    expect(text(within(dialog).getByTestId('rate-effect'))).toContain('supersedes its newest version, rv_res_96_2026_boundary')

    fireEvent.change(price, { target: { value: '32.50' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }))
    expect(screen.queryByRole('dialog', { name: 'Edit rate' })).toBeNull()
    expect(useStore.getState().pricingDrafts).toHaveLength(1)
    expect(useStore.getState().pricingDrafts[0]).toMatchObject({
      catalogId: 'cat_res_96', zoneId: 'zone_boundary', frequency: 'weekly', priceCents: 3250, effectiveFrom: '2026-10-01', status: 'draft',
      supersedesId: 'rv_res_96_2026_boundary',
    })
    // Everyone on this line is the default, so the slice stores no appliesTo.
    expect(useStore.getState().pricingDrafts[0].appliesTo).toBeUndefined()

    editLine()
    const again = screen.getByRole('dialog', { name: 'Edit rate' })
    const priceAgain = within(again).getByRole('textbox', { name: 'Price per month' }) as HTMLInputElement
    expect(priceAgain.value).toMatch(/^32\.50?$/)
    expect(text(within(again).getByTestId('rate-effect'))).toContain('Saving replaces it.')
    fireEvent.change(priceAgain, { target: { value: '33' } })
    fireEvent.click(within(again).getByRole('button', { name: 'Save draft' }))
    const drafts = useStore.getState().pricingDrafts
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({ priceCents: 3300, supersedesId: 'rv_res_96_2026_boundary' })
  })
})

describe('Edit in other sections', () => {
  it("a billing cycle's adjustment opens the adjustment form", () => {
    renderAt('/owner/pricing?section=cycles')
    fireEvent.click(screen.getByRole('button', { name: 'Edit Quarterly prepay discount' }))
    expect(screen.getByRole('dialog', { name: 'New version of Quarterly prepay discount' })).toBeTruthy()
  })

  it('a tax layer opens its form with Edit', () => {
    renderAt('/owner/pricing?section=taxes')
    fireEvent.click(screen.getAllByRole('button', { name: /^Edit / })[0])
    expect(screen.getByRole('dialog', { name: /^Edit / })).toBeTruthy()
  })
})
