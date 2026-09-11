// @vitest-environment jsdom
/**
 * The Ratebook's Zones, Billing cycles, and New rate sections through the real app at /owner/pricing?section=,
 * with no console error or warning.
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

describe('Zones section', () => {
  it('adds a zone with its first tax layer', () => {
    renderAt('/owner/pricing?section=zones')
    expect(screen.getByRole('heading', { name: 'Distance and density' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add zone' }))
    const drawer = screen.getByRole('dialog', { name: 'Add zone' })
    fireEvent.change(within(drawer).getByLabelText('Zone name'), { target: { value: 'Lake district' } })
    fireEvent.click(within(drawer).getByRole('radio', { name: /^open/ }))
    fireEvent.change(within(drawer).getByLabelText('Delivery fee'), { target: { value: '35' } })
    fireEvent.change(within(drawer).getByLabelText('First tax rate'), { target: { value: '6' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save zone' }))

    expect(screen.queryByRole('dialog', { name: 'Add zone' })).toBeNull()
    const { db } = useStore.getState()
    const zone = db.zones.find(z => z.name === 'Lake district')
    expect(zone).toMatchObject({ serviceability: 'open', deliveryFeeCents: 3500 })
    expect(db.taxRules.some(t => t.zoneId === zone!.id && t.ratePct === 6)).toBe(true)
    const row = document.querySelector(`[data-zone="${zone!.id}"]`)
    expect(text(row)).toContain('Lake district')
    expect(text(row)).toContain('6%')
    expect(text(row)).toContain('$35.00')
  })
})

describe('Billing cycles section', () => {
  it('shows each cycle with its accounts and the adjustments priced by it', () => {
    renderAt('/owner/pricing?section=cycles')
    const quarterly = screen.getByRole('region', { name: 'Quarterly cycle' })
    expect(text(quarterly)).toContain('Quarterly prepay discount')
    expect(screen.getByRole('region', { name: 'Billing groups' })).toBeTruthy()
  })
})

describe('New rate section', () => {
  const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  const combo = (name: string) => screen.getByRole('combobox', { name })
  const current = () => text(document.querySelector('[aria-current="step"]'))

  it('walks every part of the ratebook and drafts a VIP rate for 96 gal weekly in the open market', () => {
    renderAt('/owner/pricing?section=newrate')
    expect(screen.getByRole('list', { name: 'Steps to add a rate' }).querySelectorAll('li')).toHaveLength(10)

    // 1 Service
    next()
    expect(text(screen.getByRole('alert'))).toContain('Pick a service')
    fireEvent.change(combo('Service'), { target: { value: 'cat_res_96' } })
    expect(text(screen.getByTestId('service-facts'))).toContain('Rates keyed by')
    next()
    // 2 Fields
    expect(current()).toContain('Fields')
    fireEvent.change(combo('Customer tier'), { target: { value: 'vip' } })
    next()
    // 3 Zone type
    expect(current()).toContain('Zone type')
    fireEvent.change(combo('Zone type'), { target: { value: 'zone_open' } })
    expect(text(screen.getByTestId('zone-facts'))).toContain('Open market')
    next()
    // 4 Zone
    expect(current()).toContain('Zone')
    next()
    // 5 Frequency and cycle
    fireEvent.change(combo('Frequency'), { target: { value: 'weekly' } })
    expect(text(screen.getByTestId('cycle-pricing'))).toContain('Quarterly prepay discount')
    next()
    // 6 Roll-off
    expect(screen.getByTestId('rolloff-not-applicable')).toBeTruthy()
    next()
    // 7 Price
    next()
    expect(text(screen.getByRole('alert'))).toContain('Enter a price above $0.00')
    fireEvent.change(screen.getByRole('textbox', { name: 'Price per month' }), { target: { value: '27.50' } })
    // The customer tier discounts start 2027-01-01.
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2027-01-01' } })
    next()
    // 8 Adjustments
    expect(text(screen.getByTestId('example-line'))).toContain('Customer tier VIP')
    expect(text(screen.getByTestId('new-rate-applied'))).toContain('VIP discount')
    expect(text(screen.getByTestId('new-rate-not-applied'))).toContain('Friends and family')
    next()
    // 9 Taxes
    expect(screen.getByTestId('new-rate-tax')).toBeTruthy()
    next()
    // 10 Review
    expect(current()).toContain('Review')
    expect(text(screen.getByTestId('new-rate-summary'))).toContain('$27.50/mo')
    const totals = text(screen.getByTestId('new-rate-totals'))
    expect(totals).toContain('Base$27.50')
    expect(totals).toMatch(/Total\$\d+\.\d\d$/)
    expect(totals).not.toContain('prices this example line instead')
    expect(text(screen.getByTestId('rate-effect'))).toContain('More specific than rv_res_96_2026')

    // Going back keeps what was entered.
    const strip = () => within(screen.getByRole('list', { name: 'Steps to add a rate' }))
    fireEvent.click(strip().getByRole('button', { name: /Fields/ }))
    expect((combo('Customer tier') as HTMLSelectElement).value).toBe('vip')
    fireEvent.click(strip().getByRole('button', { name: /Review/ }))

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(text(screen.getByTestId('new-rate-done'))).toContain('saved')
    expect(useStore.getState().pricingDrafts[0]).toMatchObject({
      catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', dims: { customerTier: 'vip' }, priceCents: 2750, effectiveFrom: '2027-01-01', status: 'draft',
      appliesTo: 'newService',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Go to rates' }))
    expect(text(screen.getByTestId('ratebook-status'))).toBe('25 published, 1 draft')
  })

  it('keys a rate by a drawn zone, adds an adjustment scoped to it, and publishes for new service', () => {
    renderAt('/owner/pricing?section=newrate')
    fireEvent.change(combo('Service'), { target: { value: 'cat_res_96' } })
    next()
    next()
    fireEvent.change(combo('Zone type'), { target: { value: 'zone_open' } })
    next()
    const geo = useStore.getState().db.geoZones[0]
    fireEvent.change(combo('Zone'), { target: { value: geo.id } })
    next()
    fireEvent.change(combo('Frequency'), { target: { value: 'weekly' } })
    next()
    next()
    fireEvent.change(screen.getByRole('textbox', { name: 'Price per month' }), { target: { value: '31' } })
    next()

    fireEvent.click(screen.getByRole('button', { name: 'Add an adjustment for this rate' }))
    const form = screen.getByRole('dialog', { name: 'Add an adjustment' })
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Launch credit' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Gives a credit' }))
    fireEvent.change(within(form).getByLabelText('Amount'), { target: { value: '5' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save adjustment' }))
    expect(screen.queryByRole('dialog', { name: 'Add an adjustment' })).toBeNull()
    expect(useStore.getState().db.feeRules.at(-1)).toMatchObject({
      name: 'Launch credit', when: { service: ['cat_res_96'], zone: ['zone_open'], geoZone: [geo.id], frequency: ['weekly'] }, effectiveFrom: '2026-09-10',
    })
    expect(text(screen.getByTestId('new-rate-applied'))).toContain('Launch credit')
    next()
    next()

    expect(text(screen.getByTestId('saved-along'))).toContain('Adjustment Launch credit')
    fireEvent.click(screen.getByRole('button', { name: 'Publish now' }))
    expect(text(screen.getByTestId('new-rate-done'))).toContain('Published')
    const { db } = useStore.getState()
    expect(db.rateVersions.at(-1)).toMatchObject({ catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', dims: { geoZone: geo.id }, priceCents: 3100, status: 'published' })
    expect(db.catalog.find(c => c.id === 'cat_res_96')!.pricedBy).toContain('geoZone')
  })
})
