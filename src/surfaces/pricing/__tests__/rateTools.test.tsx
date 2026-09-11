// @vitest-environment jsdom
/**
 * The rate tools (RateTools.tsx) through the real Ratebook at /owner/pricing: Add rate drafts a dimension rate,
 * Fill a matrix drafts one rate per changed combination, and Adjust shown drafts a percentage on the lines shown.
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

describe('Add rate', () => {
  it('drafts a VIP rate for 96 gal weekly in the open market', () => {
    renderAt('/owner/pricing')
    expect(text(screen.getByTestId('ratebook-status'))).toBe('25 published, 0 drafts')

    fireEvent.click(screen.getByRole('button', { name: 'Add rate' }))
    const dialog = screen.getByRole('dialog', { name: 'Add a rate' })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Service' }), { target: { value: 'cat_res_96' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Zone type' }), { target: { value: 'zone_open' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Frequency' }), { target: { value: 'weekly' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Customer tier' }), { target: { value: 'vip' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Price per month' }), { target: { value: '27.50' } })
    // New service only is the default, so the rate can take effect today (DECISIONS.md entry 67).
    expect((within(dialog).getByRole('radio', { name: /New service only/ }) as HTMLInputElement).checked).toBe(true)
    expect((within(dialog).getByLabelText('Effective from') as HTMLInputElement).value).toBe('2026-09-10')

    const effect = text(within(dialog).getByTestId('rate-effect'))
    expect(effect).toContain('bills $29.00/mo from rv_res_96_2026')
    expect(effect).toContain('opens a new rate line')
    expect(effect).toContain('More specific than rv_res_96_2026')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }))
    expect(screen.queryByRole('dialog', { name: 'Add a rate' })).toBeNull()
    expect(text(screen.getByTestId('ratebook-status'))).toBe('25 published, 1 draft')
    const drafts = useStore.getState().pricingDrafts
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', dims: { customerTier: 'vip' }, priceCents: 2750, effectiveFrom: '2026-09-10', status: 'draft',
      appliesTo: 'newService',
    })
    expect(drafts[0].supersedesId).toBeUndefined()
  })

  it('Publish now puts a new-service-only rate in force today, with no draft left behind', () => {
    renderAt('/owner/pricing')
    fireEvent.click(screen.getByRole('button', { name: 'Add rate' }))
    const dialog = screen.getByRole('dialog', { name: 'Add a rate' })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Service' }), { target: { value: 'cat_res_96' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Zone type' }), { target: { value: 'zone_open' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Frequency' }), { target: { value: 'weekly' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Price per month' }), { target: { value: '31' } })
    expect(text(within(dialog).getByTestId('rate-effect'))).toMatch(/current service lines? of this service (has these values and keeps its|have these values and keep their) current price/)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish now' }))
    expect(screen.queryByRole('dialog', { name: 'Add a rate' })).toBeNull()
    expect(text(screen.getByTestId('ratebook-status'))).toBe('26 published, 0 drafts')
    expect(useStore.getState().db.rateVersions.at(-1)).toMatchObject({
      catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 3100, effectiveFrom: '2026-09-10', status: 'published',
      appliesTo: 'newService', supersedesId: 'rv_res_96_2026',
    })
    expect(screen.getByText(/for new service only\./)).toBeTruthy()
  })

  it('Everyone on this line goes back to a draft from the first of next month', () => {
    renderAt('/owner/pricing')
    fireEvent.click(screen.getByRole('button', { name: 'Add rate' }))
    const dialog = screen.getByRole('dialog', { name: 'Add a rate' })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Service' }), { target: { value: 'cat_res_96' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: /Everyone on this line/ }))
    expect((within(dialog).getByLabelText('Effective from') as HTMLInputElement).value).toBe('2026-10-01')
    expect(within(dialog).queryByRole('button', { name: 'Publish now' })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Save draft' })).toBeTruthy()
  })

  it('supersedes the exact line and refuses a missing price', () => {
    renderAt('/owner/pricing')
    fireEvent.click(screen.getByRole('button', { name: 'Add rate' }))
    const dialog = screen.getByRole('dialog', { name: 'Add a rate' })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Service' }), { target: { value: 'cat_res_96' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Zone type' }), { target: { value: 'zone_boundary' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Frequency' }), { target: { value: 'weekly' } })
    expect(text(within(dialog).getByTestId('rate-effect'))).toContain('supersedes its newest version, rv_res_96_2026_boundary')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }))
    expect(text(within(dialog).getByRole('alert'))).toContain('Enter a price above $0.00')
    expect(useStore.getState().pricingDrafts).toHaveLength(0)

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Price per month' }), { target: { value: '33' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }))
    expect(useStore.getState().pricingDrafts[0]).toMatchObject({ zoneId: 'zone_boundary', priceCents: 3300, supersedesId: 'rv_res_96_2026_boundary' })
  })
})

describe('Adjust rates by x%', () => {
  it('drafts a decrease on every residential line shown', () => {
    renderAt('/owner/pricing')
    // Fill a matrix and the per line of business "Increase all by 4%" are gone; this is the one percentage tool.
    expect(screen.queryByRole('button', { name: 'Fill a matrix' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Increase all/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Adjust rates by x%' }))
    const dialog = screen.getByRole('dialog', { name: 'Adjust rates by a percentage' })
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Adjust by percent' }), { target: { value: '-10' } })
    const row = dialog.querySelector('[data-rate="rv_res_96_2026"]')!
    expect(text(row)).toContain('$29.00/mo')
    expect(text(row)).toContain('$26.10/mo')
    expect(text(row)).toContain('-$2.90')

    const n = useStore.getState().pricingDrafts.length
    const create = within(dialog).getByRole('button', { name: /^Create \d+ drafts?$/ })
    const count = Number(/\d+/.exec(create.textContent ?? '')![0])
    fireEvent.click(create)
    const drafts = useStore.getState().pricingDrafts
    expect(drafts).toHaveLength(n + count)
    expect(drafts.find(d => d.supersedesId === 'rv_res_96_2026')?.priceCents).toBe(2610)
  })
})
