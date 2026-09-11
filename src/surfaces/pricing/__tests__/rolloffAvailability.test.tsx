// @vitest-environment jsdom
/**
 * The owner's report: turning a roll-off cell on and pricing it does not put a price in the grid. Roofing shingles is
 * seeded as not taken in 30 yd (rr_30yd_roofing_2026, available false), so this walks that exact cell: a cell that is
 * not taken starts today, saving with Available off says so, and a change dated later shows on the grid as scheduled.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes, ROUTER_FUTURE } from '../../../App'
import { useStore } from '../../../store/useStore'
import { rolloffTermsFor } from '../../../store/engine'

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

const db = () => useStore.getState().db
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const cellText = () => text(screen.getByRole('button', { name: 'Roofing shingles, 30 yd' }))
const openCell = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Roofing shingles, 30 yd' }))
  return screen.getByRole('dialog', { name: 'Roofing shingles, 30 yd' })
}

describe('Roll-off: making a material available in a size', () => {
  it('prices the cell today when Available is switched on', () => {
    renderAt('/owner/pricing?section=rolloff')
    expect(cellText()).toContain('Not taken in this size')

    const drawer = openCell()
    // A cell nobody is billed for starts today, not next month, so the price shows at once.
    expect((within(drawer).getByLabelText('Effective from') as HTMLInputElement).value).toBe('2026-09-10')
    expect(text(within(drawer).getByTestId('not-taken-warning'))).toContain('Roofing shingles is not taken in 30 yd')

    const available = within(drawer).getByRole('switch', { name: 'Available' })
    expect(available.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(available)
    expect(available.getAttribute('aria-checked')).toBe('true')
    expect(within(drawer).queryByTestId('not-taken-warning')).toBeNull()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save cell' }))

    const row = db().rolloffRates.find(r => r.catalogId === 'cat_ro_30yd' && r.materialId === 'mat_roofing' && r.effectiveFrom === '2026-09-10')
    expect(row).toMatchObject({ available: true, includedTons: 4, overageCentsPerTon: 7000, supersedesId: 'rr_30yd_roofing_2026' })
    expect(rolloffTermsFor({ catalogId: 'cat_ro_30yd', materialId: 'mat_roofing', onDate: '2026-09-10' }, db())).toMatchObject({ available: true })

    // The grid prices the cell: the size's haul rate plus the delta, the allowance, and the rate over.
    expect(cellText()).not.toContain('Not taken in this size')
    expect(cellText()).toContain('$675.00')
    expect(cellText()).toContain('4 t incl.')
    expect(cellText()).toContain('$70.00/t over')
  })

  it('takes the haul price directly, and the delta follows', () => {
    renderAt('/owner/pricing?section=rolloff')
    const drawer = openCell()
    fireEvent.click(within(drawer).getByRole('switch', { name: 'Available' }))

    const price = within(drawer).getByLabelText('Haul price') as HTMLInputElement
    expect(price.value).toBe('675.00')
    fireEvent.change(price, { target: { value: '700' } })
    expect((within(drawer).getByLabelText('Haul delta') as HTMLInputElement).value).toBe('25.00')

    // Editing the delta moves the price the other way.
    fireEvent.change(within(drawer).getByLabelText('Haul delta'), { target: { value: '-25' } })
    expect((within(drawer).getByLabelText('Haul price') as HTMLInputElement).value).toBe('650.00')

    fireEvent.change(within(drawer).getByLabelText('Haul price'), { target: { value: '700' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save cell' }))
    expect(db().rolloffRates.find(r => r.catalogId === 'cat_ro_30yd' && r.materialId === 'mat_roofing' && r.effectiveFrom === '2026-09-10')).toMatchObject({
      available: true, haulDeltaCents: 2500,
    })
    expect(cellText()).toContain('$700.00')
  })

  it('saving with Available off says the cell is still not taken', () => {
    renderAt('/owner/pricing?section=rolloff')
    const drawer = openCell()
    fireEvent.change(within(drawer).getByLabelText('Overage per ton'), { target: { value: '80' } })
    // The button names the outcome rather than promising a price.
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save as not taken' }))

    const row = db().rolloffRates.find(r => r.catalogId === 'cat_ro_30yd' && r.materialId === 'mat_roofing' && r.effectiveFrom === '2026-09-10')
    expect(row?.available).toBe(false)
    expect(cellText()).toContain('Not taken in this size')
  })

  it('a change dated later shows on the grid as scheduled', () => {
    renderAt('/owner/pricing?section=rolloff')
    const drawer = openCell()
    fireEvent.click(within(drawer).getByRole('switch', { name: 'Available' }))
    fireEvent.change(within(drawer).getByLabelText('Effective from'), { target: { value: '2026-11-01' } })
    expect(text(drawer)).toContain('Starts 2026-11-01')
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save cell' }))

    expect(db().rolloffRates.some(r => r.catalogId === 'cat_ro_30yd' && r.materialId === 'mat_roofing' && r.effectiveFrom === '2026-11-01' && r.available)).toBe(true)
    // Today's grid still shows the cell in force, and now says the new one is coming.
    expect(cellText()).toContain('Not taken in this size')
    expect(cellText()).toContain('New from 2026-11-01')
  })
})
