// @vitest-environment jsdom
/**
 * The Services and Dimensions sections of the Ratebook (DECISIONS.md entry 65), through the real screens at
 * /owner/pricing?section=services and ?section=dimensions: a new category and a service in it, a new input dimension,
 * and an account assignment on Customer tier, with no console error or warning.
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

const db = () => useStore.getState().db

describe('Services section', () => {
  it('adds a category, then a service in it priced by zone, frequency, and Customer tier', () => {
    renderAt('/owner/pricing?section=services')
    expect(screen.getByRole('heading', { name: 'Services' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Commercial trash' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Add category' }))
    const catDrawer = screen.getByRole('dialog', { name: 'Add a category' })
    fireEvent.change(within(catDrawer).getByLabelText('Category name'), { target: { value: 'Specialty bins' } })
    fireEvent.click(within(catDrawer).getByRole('radio', { name: /^Frontload/ }))
    fireEvent.click(within(catDrawer).getByRole('button', { name: 'Save category' }))
    expect(screen.queryByRole('dialog', { name: 'Add a category' })).toBeNull()
    const category = db().serviceCategories.find(c => c.name === 'Specialty bins')!
    expect(category).toMatchObject({ lob: 'frontload' })
    const card = screen.getByRole('region', { name: 'Specialty bins' })
    expect(within(card).getByText('No services in this category yet.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Add service' }))
    const drawer = screen.getByRole('dialog', { name: 'Add a service' })
    fireEvent.change(within(drawer).getByLabelText('Service name'), { target: { value: '1.5 yd alley bin' } })
    fireEvent.change(within(drawer).getByLabelText('Category'), { target: { value: category.id } })
    fireEvent.change(within(drawer).getByLabelText('Size label'), { target: { value: '1.5 yd' } })
    expect((within(drawer).getByLabelText('Container type') as HTMLSelectElement).value).toBe('container')
    const chips = within(drawer).getByRole('group', { name: 'Priced by dimensions' })
    expect(within(chips).getByRole('button', { name: 'Zone type' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(chips).getByRole('button', { name: 'Frequency' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(chips).queryByRole('button', { name: 'Service' })).toBeNull()
    fireEvent.click(within(chips).getByRole('button', { name: 'Customer tier' }))
    expect(within(drawer).getByTestId('priced-by-order').textContent).toBe('Rate columns, in order: Zone type, Frequency, Customer tier')
    expect(within(drawer).queryByText('Included with each haul')).toBeNull()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save service' }))

    expect(screen.queryByRole('dialog', { name: 'Add a service' })).toBeNull()
    const saved = db().catalog.find(c => c.name === '1.5 yd alley bin')!
    expect(saved).toMatchObject({
      categoryId: category.id, lob: 'frontload', sizeLabel: '1.5 yd', unit: 'container', priceUnit: 'month',
      pricedBy: ['zone', 'frequency', 'customerTier'], public: true,
    })
    expect(screen.getByRole('status').textContent).toContain('Saved 1.5 yd alley bin. Add its prices under Rates.')
    const row = within(screen.getByRole('region', { name: 'Specialty bins' })).getByText('1.5 yd alley bin').closest('tr')!
    expect(row.textContent).toContain('Customer tier')
    expect(row.textContent).toContain('0 active lines')
  })

  it('a roll-off service asks for its haul terms, and editing offers only categories of the same LOB', () => {
    renderAt('/owner/pricing?section=services')
    fireEvent.click(screen.getByRole('button', { name: 'Add service to Roll-off boxes' }))
    const drawer = screen.getByRole('dialog', { name: 'Add a service' })
    expect(within(drawer).getByText('Included with each haul')).toBeTruthy()
    fireEvent.change(within(drawer).getByLabelText('Service name'), { target: { value: '15 yd box' } })
    fireEvent.change(within(drawer).getByLabelText('Size label'), { target: { value: '15 yd' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save service' }))
    expect(within(drawer).getByRole('alert').textContent).toContain('Give the included tons, included days, extra day charge, overage per ton for each haul')

    fireEvent.change(within(drawer).getByLabelText('Included tons'), { target: { value: '2' } })
    fireEvent.change(within(drawer).getByLabelText('Included days'), { target: { value: '7' } })
    fireEvent.change(within(drawer).getByLabelText('Extra day charge'), { target: { value: '12.50' } })
    fireEvent.change(within(drawer).getByLabelText('Overage per ton'), { target: { value: '85' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save service' }))
    const saved = db().catalog.find(c => c.name === '15 yd box')!
    expect(saved).toMatchObject({ lob: 'rolloff', unit: 'box', priceUnit: 'haul', pricedBy: ['zone'], rolloff: { includedTons: 2, includedDays: 7, extraDayCents: 1250, overageCentsPerTon: 8500 } })

    fireEvent.click(screen.getByRole('button', { name: 'Edit 15 yd box' }))
    const edit = screen.getByRole('dialog', { name: 'Edit 15 yd box' })
    const options = [...(within(edit).getByLabelText('Category') as HTMLSelectElement).options].map(o => o.value)
    expect(options.sort()).toEqual(db().serviceCategories.filter(c => c.lob === 'rolloff').map(c => c.id).sort())
  })
})

describe('Dimensions section', () => {
  it('adds an input dimension, and assigns an account to VIP on Customer tier', () => {
    renderAt('/owner/pricing?section=dimensions')
    expect(screen.getByRole('heading', { name: 'Fields' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rename Zone' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Add field' }))
    const drawer = screen.getByRole('dialog', { name: 'Add a field' })
    fireEvent.change(within(drawer).getByLabelText('Field name'), { target: { value: 'Order channel' } })
    fireEvent.click(within(drawer).getByRole('radio', { name: /^Asked when quoting/ }))
    fireEvent.change(within(drawer).getByLabelText('Value 1'), { target: { value: 'Phone' } })
    fireEvent.change(within(drawer).getByLabelText('Value 2'), { target: { value: 'Online' } })
    fireEvent.click(within(drawer).getByRole('radio', { name: 'Make value 1 the default' }))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save field' }))

    expect(screen.queryByRole('dialog', { name: 'Add a field' })).toBeNull()
    const dim = db().pricingDimensions.find(d => d.name === 'Order channel')!
    expect(dim).toMatchObject({ source: 'input', values: [{ id: 'phone', label: 'Phone' }, { id: 'online', label: 'Online' }], defaultValueId: 'phone' })
    const card = screen.getByRole('region', { name: 'Order channel' })
    expect(within(card).queryByRole('button', { name: 'Assign Order channel' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Assign Customer tier' }))
    const assign = screen.getByRole('dialog', { name: 'Assign Customer tier' })
    expect(within(assign).getByTestId('assign-counts').textContent).toContain('VIP: 2')
    const select = within(assign).getByLabelText('Customer tier for acct_res_maple') as HTMLSelectElement
    expect(select.value).toBe('standard')
    expect([...select.options].map(o => o.textContent)).toContain('Standard (default)')
    fireEvent.change(select, { target: { value: 'vip' } })
    expect(db().pricingDimensions.find(d => d.id === 'customerTier')!.assignments!.acct_res_maple).toBe('vip')
    expect(within(assign).getByTestId('assign-counts').textContent).toContain('VIP: 3')
    expect(within(assign).getAllByRole('row')).toHaveLength(26)

    fireEvent.change(within(assign).getByLabelText('Customer tier for acct_res_maple'), { target: { value: 'standard' } })
    expect(db().pricingDimensions.find(d => d.id === 'customerTier')!.assignments!.acct_res_maple).toBeUndefined()
  })

  it('refuses to remove a value that is still assigned', () => {
    renderAt('/owner/pricing?section=dimensions')
    fireEvent.click(screen.getByRole('button', { name: 'Edit Customer tier' }))
    const drawer = screen.getByRole('dialog', { name: 'Edit Customer tier' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Remove value 2' }))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save field' }))
    expect(within(drawer).getByRole('alert').textContent).toContain('VIP is still used by rates, rules, or assignments')
    expect(db().pricingDimensions.find(d => d.id === 'customerTier')!.values.map(v => v.id)).toContain('vip')
  })
})
