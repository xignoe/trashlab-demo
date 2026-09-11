// @vitest-environment jsdom
/**
 * Custom fields (DECISIONS.md entry 68) through the real Ratebook at /owner/pricing?section=: a number field set on the
 * service line with bands, its value on one service line through the Assign drawer, a service whose price is
 * multiplied by a number field, and a yes or no field. No console error
 * or warning.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes, ROUTER_FUTURE } from '../../../App'
import { useStore } from '../../../store/useStore'
import { fieldValueId, lineDims } from '../../../store/engine'

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

describe('Fields section: a number field set on the service line', () => {
  it('adds Container yards with bands, refuses an overlap, and sets 24 on a service line', () => {
    renderAt('/owner/pricing?section=dimensions')
    expect(screen.getByRole('heading', { name: 'Fields' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Add field' }))
    const drawer = screen.getByRole('dialog', { name: 'Add a field' })
    fireEvent.change(within(drawer).getByLabelText('Field name'), { target: { value: 'Container yards' } })
    fireEvent.click(within(drawer).getByRole('radio', { name: /^Number/ }))
    fireEvent.click(within(drawer).getByRole('radio', { name: /^Set on each service line/ }))
    // A number field has no values editor.
    expect(within(drawer).queryByLabelText('Value 1')).toBeNull()
    fireEvent.change(within(drawer).getByLabelText('Unit'), { target: { value: 'cubic yards' } })
    const addBand = within(drawer).getByRole('button', { name: 'Add band' })
    fireEvent.click(addBand)
    fireEvent.click(addBand)
    fireEvent.click(addBand)
    fireEvent.change(within(drawer).getByLabelText('Band 1 label'), { target: { value: 'Under 10' } })
    fireEvent.change(within(drawer).getByLabelText('Band 1 up to'), { target: { value: '10' } })
    fireEvent.change(within(drawer).getByLabelText('Band 2 label'), { target: { value: '10 to 19' } })
    fireEvent.change(within(drawer).getByLabelText('Band 2 from'), { target: { value: '5' } })
    fireEvent.change(within(drawer).getByLabelText('Band 2 up to'), { target: { value: '20' } })
    fireEvent.change(within(drawer).getByLabelText('Band 3 label'), { target: { value: '20 or more' } })
    fireEvent.change(within(drawer).getByLabelText('Band 3 from'), { target: { value: '20' } })
    expect(text(within(drawer).getByTestId('band-1-text'))).toBe('Under 10: under 10 cubic yards')
    expect(text(within(drawer).getByTestId('band-3-text'))).toBe('20 or more: 20 or more cubic yards')

    // 5 to 20 overlaps under 10: the store refuses it and nothing is saved.
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save field' }))
    expect(within(drawer).getByRole('alert').textContent).toContain('The bands Under 10 and 10 to 19 overlap')
    expect(db().pricingDimensions.some(d => d.name === 'Container yards')).toBe(false)

    fireEvent.change(within(drawer).getByLabelText('Band 2 from'), { target: { value: '10' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save field' }))
    expect(screen.queryByRole('dialog', { name: 'Add a field' })).toBeNull()

    const dim = db().pricingDimensions.find(d => d.name === 'Container yards')!
    expect(dim).toMatchObject({
      type: 'number', source: 'serviceLine', unit: 'cubic yards',
      values: [
        { id: 'under_10', label: 'Under 10', max: 10 },
        { id: '10_to_19', label: '10 to 19', min: 10, max: 20 },
        { id: '20_or_more', label: '20 or more', min: 20 },
      ],
    })
    expect(dim.values[0].min).toBeUndefined()
    expect(dim.values[2].max).toBeUndefined()
    const card = screen.getByRole('region', { name: 'Container yards' })
    expect(text(card)).toContain('Number')
    expect(text(card)).toContain('Set on each service line')
    expect(text(card)).toContain('10 to under 20 cubic yards')

    // Set 24 on one service line through the Assign drawer.
    const line = db().serviceItems.find(si => si.status === 'active')!
    fireEvent.click(within(card).getByRole('button', { name: 'Assign Container yards' }))
    const assign = screen.getByRole('dialog', { name: 'Assign Container yards' })
    fireEvent.change(within(assign).getByLabelText('Search service lines'), { target: { value: line.id } })
    const input = within(assign).getByLabelText(`Container yards for ${line.id}`)
    fireEvent.change(input, { target: { value: '24' } })
    fireEvent.blur(input)

    const saved = db().pricingDimensions.find(d => d.id === dim.id)!
    expect(saved.assignments?.[line.id]).toBe('24')
    expect(fieldValueId(saved, '24')).toBe('20_or_more')
    const dims = lineDims({ serviceItemId: line.id, siteId: line.siteId, catalogId: line.catalogId, frequency: line.frequency, onDate: '2026-10-01', lineType: 'recurring' }, db())
    expect(dims[dim.id]).toBe('20_or_more')
    expect(text(assign.querySelector(`[data-target="${line.id}"]`))).toContain('20 or more')
    expect(text(within(assign).getByTestId('assign-counts'))).toContain('20 or more: 1')
  })

  it('adds a yes or no field, which gets the values yes and no', () => {
    renderAt('/owner/pricing?section=dimensions')
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }))
    const drawer = screen.getByRole('dialog', { name: 'Add a field' })
    fireEvent.change(within(drawer).getByLabelText('Field name'), { target: { value: 'Entry required' } })
    fireEvent.click(within(drawer).getByRole('radio', { name: /^Yes or no/ }))
    fireEvent.click(within(drawer).getByRole('radio', { name: /^Set on each service site/ }))
    expect(within(drawer).queryByLabelText('Value 1')).toBeNull()
    fireEvent.change(within(drawer).getByLabelText('Default'), { target: { value: 'no' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save field' }))
    expect(screen.queryByRole('dialog', { name: 'Add a field' })).toBeNull()

    const dim = db().pricingDimensions.find(d => d.name === 'Entry required')!
    expect(dim).toMatchObject({ type: 'yesNo', source: 'site', defaultValueId: 'no' })
    expect(dim.values.map(v => v.id)).toEqual(['yes', 'no'])
  })
})

describe('Services section: price multiplied by a number field', () => {
  it('sets a service to bill price x collections per month', () => {
    const item = db().catalog.find(c => c.lob === 'frontload')!
    renderAt('/owner/pricing?section=services')
    fireEvent.click(screen.getAllByRole('button', { name: `Edit ${item.name}` })[0])
    const drawer = screen.getByRole('dialog', { name: `Edit ${item.name}` })
    const select = within(drawer).getByLabelText('Price multiplied by') as HTMLSelectElement
    expect(select.value).toBe('')
    expect([...select.options].map(o => o.textContent)).toContain('Nothing (flat per unit)')
    fireEvent.change(select, { target: { value: 'collectionsPerMonth' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save service' }))
    expect(screen.queryByRole('dialog', { name: `Edit ${item.name}` })).toBeNull()

    expect(db().catalog.find(c => c.id === item.id)!.quantityField).toBe('collectionsPerMonth')
    expect(text(document.querySelector(`[data-service="${item.id}"]`))).toContain('x collections per month')
  })
})
