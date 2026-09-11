// @vitest-environment jsdom
/**
 * The Roll-off section of the Ratebook at /owner/pricing?section=rolloff: a matrix cell edit is saved as a new
 * RolloffRate that supersedes the seeded cell, and the haul calculator prices overage, extra days, and a trip charge
 * from the live settings. No console error or warning.
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

describe('/owner/pricing?section=rolloff', () => {
  it('saves a Roofing shingles x 20 yd cell as a new dated version that supersedes the seeded cell', () => {
    renderAt('/owner/pricing?section=rolloff')
    expect(screen.getByRole('heading', { name: 'Roll-off' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Roofing shingles, 20 yd' }))
    const drawer = screen.getByRole('dialog', { name: 'Roofing shingles, 20 yd' })
    expect((within(drawer).getByLabelText('Overage per ton') as HTMLInputElement).value).toBe('65.00')
    fireEvent.change(within(drawer).getByLabelText('Overage per ton'), { target: { value: '70.00' } })
    fireEvent.change(within(drawer).getByLabelText('Effective from'), { target: { value: '2026-10-01' } })
    expect(text(within(drawer).getByTestId('margin-hint'))).toContain('$15.00')
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save cell' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    const added = useStore.getState().db.rolloffRates.filter(r => r.catalogId === 'cat_ro_20yd' && r.materialId === 'mat_roofing' && r.effectiveFrom === '2026-10-01')
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ overageCentsPerTon: 7000, supersedesId: 'rr_20yd_roofing_2026', haulDeltaCents: 7500, includedTons: 5, available: true })
    expect(added[0].overageTiers).toEqual([{ aboveTons: 2, centsPerTon: 8500 }])
    // The seeded cell is kept, unchanged.
    expect(useStore.getState().db.rolloffRates.find(r => r.id === 'rr_20yd_roofing_2026')!.overageCentsPerTon).toBe(6500)
    expect(text(screen.getByRole('button', { name: 'Roofing shingles, 20 yd' }))).toContain('New from 2026-10-01')
  })

  it('prices overage, extra days, and a trip charge in the haul calculator', () => {
    renderAt('/owner/pricing?section=rolloff')
    const calc = screen.getByRole('region', { name: 'Haul calculator' })
    fireEvent.change(within(calc).getByLabelText('Box size'), { target: { value: 'cat_ro_20yd' } })
    fireEvent.change(within(calc).getByLabelText('Material'), { target: { value: 'mat_mixed' } })
    expect((within(calc).getByLabelText('Material') as HTMLSelectElement).selectedOptions[0].textContent).toBe('Mixed debris (C&D)')
    fireEvent.change(within(calc).getByLabelText('Tons per haul'), { target: { value: '4.2' } })
    fireEvent.change(within(calc).getByLabelText('Days on site'), { target: { value: '35' } })
    fireEvent.change(within(calc).getByLabelText('Miles from yard'), { target: { value: '20' } })

    const lines = within(calc).getByTestId('haul-lines')
    expect(text(lines.querySelector('[data-line="haul"]'))).toContain('20 yd haul, Mixed debris (C&D)')
    const overage = lines.querySelector('[data-line="overage"]')
    expect(overage).toBeTruthy()
    expect(text(overage)).toContain('Overage')
    expect(text(overage)).toContain('$84.00')
    expect(text(lines.querySelector('[data-line="days"]'))).toContain('Extra days, 5')
    expect(text(lines.querySelector('[data-line="days"]'))).toContain('$35.00')
    expect(text(lines.querySelector('[data-line="trip"]'))).toContain('Trip charge, 5.0 mi past 15 mi')
    expect(text(lines.querySelector('[data-line="trip"]'))).toContain('$17.50')
    expect(within(calc).queryByTestId('haul-error')).toBeNull()
  })
})
