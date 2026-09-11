// @vitest-environment jsdom
/**
 * The Adjustments and Taxes sections of the Ratebook through the real screens: add a discount with a condition and a
 * stack group, save a new version of the fuel surcharge, and add a city tax layer, with no console error or warning.
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
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } })

describe('/owner/pricing?section=adjustments', () => {
  it('adds a VIP senior discount and saves a new version of the fuel surcharge', () => {
    renderAt('/owner/pricing?section=adjustments')
    expect(screen.getByRole('heading', { name: 'Adjustments', level: 2 })).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'How a line is priced' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Add adjustment' }))
    let form = screen.getByRole('dialog', { name: 'Add an adjustment' })
    const save = within(form).getByRole('button', { name: 'Save adjustment' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect(text(within(form).getByTestId('form-problems'))).toContain('Give the adjustment a name')

    type(within(form).getByLabelText('Name'), 'Senior discount')
    fireEvent.click(within(form).getByRole('button', { name: 'Gives a credit' }))
    type(within(form).getByLabelText('Amount'), '8')
    fireEvent.click(within(form).getByRole('button', { name: 'Add condition' }))
    fireEvent.change(within(form).getByLabelText('Condition 1 dimension'), { target: { value: 'customerTier' } })
    fireEvent.click(within(within(form).getByRole('group', { name: 'Customer tier values' })).getByRole('button', { name: 'VIP' }))
    type(within(form).getByLabelText('Stack group'), 'customerDiscount')
    expect((within(form).getByLabelText('Effective from') as HTMLInputElement).value).toBe('2026-10-01')
    expect(save.disabled).toBe(false)
    fireEvent.click(save)

    expect(screen.queryByRole('dialog', { name: 'Add an adjustment' })).toBeNull()
    expect(text(screen.getByTestId('adjustment-saved'))).toContain('Senior discount')
    const senior = useStore.getState().db.feeRules.find(r => r.name === 'Senior discount')!
    expect(senior).toMatchObject({
      kind: 'percent', value: -8, appliesTo: ['recurring'], when: { customerTier: ['vip'] }, stackGroup: 'customerDiscount', category: 'credit', effectiveFrom: '2026-10-01',
    })
    const credits = screen.getByRole('region', { name: 'Discounts and credits' })
    expect(text(credits.querySelector(`[data-chain="${senior.id}"]`))).toContain('-8% of the line')

    // A new version of the fuel surcharge from 2026-11-01.
    fireEvent.click(screen.getByRole('button', { name: 'Edit Fuel surcharge' }))
    form = screen.getByRole('dialog', { name: 'New version of Fuel surcharge' })
    type(within(form).getByLabelText('Amount'), '8')
    type(within(form).getByLabelText('Effective from'), '2026-11-01')
    fireEvent.click(within(form).getByRole('button', { name: 'Preview impact' }))
    expect(text(within(form).getByTestId('impact-headline'))).toMatch(/^First run on or after 2026-11-01: \d+ accounts? change, total \+\$/)
    fireEvent.click(within(form).getByRole('button', { name: 'Save new version' }))

    const rules = useStore.getState().db.feeRules
    const old = rules.find(r => r.id === 'fee_fuel_7pct')!
    expect(old.value).toBe(7)
    expect(old.effectiveTo).toBe('2026-10-31')
    const next = rules.find(r => r.supersedesId === 'fee_fuel_7pct')!
    expect(next).toMatchObject({ name: 'Fuel surcharge', value: 8, effectiveFrom: '2026-11-01' })
    expect(next.effectiveTo).toBeUndefined()

    const row = document.querySelector(`[data-chain="${next.id}"]`)!
    expect(text(row)).toContain('Scheduled from 2026-11-01')
    expect(text(row)).toContain('In force now: +7% of the line until 2026-10-31')
    expect(text(row)).toContain('1 earlier version')
  })
})

describe('/owner/pricing?section=taxes', () => {
  it('adds a 1% city layer to Open market', () => {
    renderAt('/owner/pricing?section=taxes')
    expect(screen.getByRole('heading', { name: 'Taxes', level: 2 })).toBeTruthy()
    const open = screen.getByRole('region', { name: 'Open market' })
    expect(text(within(open).getByTestId('combined-rate'))).toContain('7%')

    fireEvent.click(within(open).getByRole('button', { name: 'Add layer' }))
    const form = screen.getByRole('dialog', { name: 'Add a tax layer to Open market' })
    type(within(form).getByLabelText('Name'), 'City tax')
    fireEvent.change(within(form).getByLabelText('Jurisdiction'), { target: { value: 'city' } })
    type(within(form).getByLabelText('Rate'), '1')
    expect((within(form).getByLabelText('Effective from') as HTMLInputElement).value).toBe('2026-10-01')
    fireEvent.click(within(form).getByRole('button', { name: 'Save layer' }))

    expect(screen.queryByRole('dialog', { name: /Add a tax layer/ })).toBeNull()
    const layer = useStore.getState().db.taxRules.find(r => r.name === 'City tax')!
    expect(layer).toMatchObject({ zoneId: 'zone_open', ratePct: 1, jurisdiction: 'city', appliesTo: ['recurring', 'event', 'fee'], effectiveFrom: '2026-10-01' })
    expect(text(screen.getByRole('region', { name: 'Open market' }).querySelector(`[data-layer="${layer.id}"]`))).toContain('Scheduled from 2026-10-01')
  })
})
