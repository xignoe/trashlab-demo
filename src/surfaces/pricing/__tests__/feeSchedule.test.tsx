// @vitest-environment jsdom
/**
 * The fee schedule (FeeSchedule.tsx) rendered alone over the app store: the fuel surcharge amount edited in place
 * saves a new version from the toolbar date, Compare across Customer tier shows where the VIP discount is charged,
 * and the Taxable toggle saves a new version with only taxable flipped. No console error or warning.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FeeSchedule from '../components/FeeSchedule'
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

const TODAY = '2026-09-10'
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const row = (id: string) => document.querySelector(`[data-fee-row="${id}"]`) as HTMLElement

describe('FeeSchedule', () => {
  it('edits the fuel surcharge in place as a new version from the toolbar date', () => {
    render(<FeeSchedule today={TODAY} />)
    expect(screen.getByRole('region', { name: 'Fee schedule' })).toBeTruthy()
    expect((screen.getByLabelText('Changes take effect') as HTMLInputElement).value).toBe('2026-10-01')

    const fuel = row('fee_fuel_7pct')
    expect(text(fuel)).toContain('Fuel surcharge')
    expect(text(within(fuel).getByRole('button', { name: 'Change amount of Fuel surcharge' }))).toBe('7%')

    fireEvent.click(within(fuel).getByRole('button', { name: 'Change amount of Fuel surcharge' }))
    const input = screen.getByLabelText('New amount for Fuel surcharge')
    fireEvent.change(input, { target: { value: '8' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    const rules = useStore.getState().db.feeRules
    const old = rules.find(r => r.id === 'fee_fuel_7pct')!
    expect(old.value).toBe(7)
    expect(old.effectiveTo).toBe('2026-09-30')
    const next = rules.find(r => r.supersedesId === 'fee_fuel_7pct')!
    expect(next).toMatchObject({ name: 'Fuel surcharge', kind: 'percent', value: 8, effectiveFrom: '2026-10-01', taxable: true, appliesTo: ['recurring', 'event'] })
    expect(next.effectiveTo).toBeUndefined()

    expect(row('fee_fuel_7pct')).toBeNull()
    const shown = row(next.id)
    expect(text(shown)).toContain('8%')
    expect(text(shown)).toContain('now 7%')
    expect(text(shown)).toContain('Scheduled from 2026-10-01')
    expect(text(screen.getByTestId('fee-schedule-saved'))).toContain('ends 2026-09-30 and is kept')
  })

  it('Escape cancels an edit without saving', () => {
    render(<FeeSchedule today={TODAY} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change amount of Fuel surcharge' }))
    const input = screen.getByLabelText('New amount for Fuel surcharge')
    fireEvent.change(input, { target: { value: '9' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(useStore.getState().db.feeRules.some(r => r.supersedesId === 'fee_fuel_7pct')).toBe(false)
    expect(text(row('fee_fuel_7pct'))).toContain('7%')
  })

  it('shows a store error under the row', () => {
    render(<FeeSchedule today={TODAY} />)
    // The VIP discount starts 2027-01-01, so a version from 2026-10-01 is refused.
    fireEvent.click(screen.getByRole('button', { name: 'Change amount of VIP discount' }))
    const input = screen.getByLabelText('New amount for VIP discount')
    fireEvent.change(input, { target: { value: '12' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(text(document.querySelector('[data-fee-errors="fee_tier_vip"]'))).toContain('Pick a date after 2027-01-01')
  })

  it('compares across Customer tier: the VIP discount is charged only under VIP', () => {
    render(<FeeSchedule today={TODAY} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Compare across' }), { target: { value: 'customerTier' } })
    expect(screen.getByRole('columnheader', { name: 'VIP' })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Amount' })).toBeNull()

    const vip = row('fee_tier_vip')
    expect(text(vip.querySelector('[data-compare-cell="vip"]'))).toBe('-10%')
    for (const other of ['standard', 'friendsFamily', 'nationalBroker']) {
      expect(text(vip.querySelector(`[data-compare-cell="${other}"]`))).toBe('not charged')
    }
    // A fee with no condition on the tier is charged under every tier.
    const fuel = row('fee_fuel_7pct')
    for (const tier of ['standard', 'vip', 'friendsFamily', 'nationalBroker']) {
      expect(text(fuel.querySelector(`[data-compare-cell="${tier}"]`))).toBe('7%')
    }
    expect(within(vip).getByRole('button', { name: 'Change amount of VIP discount for VIP' }).getAttribute('title')).toContain('Applies to 1 of 4')
  })

  it('the Taxable toggle saves a new version with only taxable flipped', () => {
    render(<FeeSchedule today={TODAY} />)
    fireEvent.click(within(row('fee_fuel_7pct')).getByRole('switch', { name: 'Fuel surcharge taxable' }))

    const rules = useStore.getState().db.feeRules
    const old = rules.find(r => r.id === 'fee_fuel_7pct')!
    const next = rules.find(r => r.supersedesId === 'fee_fuel_7pct')!
    expect(old.taxable).toBe(true)
    expect(old.effectiveTo).toBe('2026-09-30')
    expect(next).toMatchObject({ taxable: false, value: 7, kind: 'percent', effectiveFrom: '2026-10-01' })
    const { id: _a, supersedesId: _b, effectiveFrom: _c, effectiveTo: _d, taxable: _e, ...restNext } = next
    const { id: _f, supersedesId: _g, effectiveFrom: _h, effectiveTo: _i, taxable: _j, ...restOld } = old
    expect(restNext).toEqual(restOld)
  })

  it('filters by search and says so when nothing matches', () => {
    render(<FeeSchedule today={TODAY} />)
    fireEvent.change(screen.getByLabelText('Search fees'), { target: { value: 'nothing like this' } })
    expect(screen.getByText(/No fees match "nothing like this"/)).toBeTruthy()
  })

  it('sums unconditional tax layers per zone', () => {
    const onOpenSection = vi.fn()
    render(<FeeSchedule today={TODAY} onOpenSection={onOpenSection} />)
    expect(text(document.querySelector('[data-zone-tax="zone_open"]'))).toBe('Open market 7%')
    fireEvent.click(screen.getByRole('button', { name: 'Edit tax layers' }))
    expect(onOpenSection).toHaveBeenCalledWith('taxes')
  })
})
