// @vitest-environment jsdom
/**
 * Box 2B.5: pricing/RUNBOOK.md scenarios (a) and (c) through the Ratebook, rendered inside the app's routes at
 * /owner/pricing, with no console error or warning. Scenario (b) went with the quote workbench (DECISIONS.md entry 66).
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

describe('/owner/pricing', () => {
  it('scenario (a) and (c): 4% residential increase, preview, publish, history proof, version history', () => {
    const { container } = renderAt('/owner/pricing')
    expect(container.querySelector('.shell-outlet > .surface-pricing')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ratebook')
    // The persona bar owns the link; the surface adds no second "Ratebook" link and no tab row.
    expect(screen.getAllByRole('link', { name: 'Ratebook' })).toHaveLength(1)
    expect(screen.queryByRole('tablist', { name: 'Pricing screens' })).toBeNull()
    expect(text(screen.getByTestId('ratebook-status'))).toBe('25 published, 0 drafts')

    // The sheet opens on every line of business; Adjust rates by x% works on the lines shown, here residential.
    fireEvent.click(screen.getByRole('button', { name: 'Residential rates' }))
    fireEvent.click(screen.getByRole('button', { name: 'Adjust rates by x%' }))
    const form = screen.getByRole('dialog', { name: 'Adjust rates by a percentage' })
    expect((within(form).getByLabelText('Effective from') as HTMLInputElement).value).toBe('2026-10-01')
    fireEvent.change(within(form).getByRole('spinbutton', { name: 'Adjust by percent' }), { target: { value: '4' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Create 8 drafts' }))
    expect(screen.getByText('8 drafts created: adjusted lines.')).toBeTruthy()
    expect(text(screen.getByTestId('ratebook-status'))).toBe('25 published, 8 drafts')

    fireEvent.click(screen.getByRole('button', { name: 'Preview publish' }))
    const modal = screen.getByRole('dialog', { name: 'Publish 8 residential drafts as new versions' })
    expect(text(within(modal).getByTestId('preview-headline'))).toBe('31 accounts move, 5 protected by contract, monthly revenue +$40.04 before fees and tax.')
    const maple = modal.querySelector('[data-representative="acct_res_maple"]')!
    expect(text(maple)).toContain('+$6.86 per quarter')
    expect(text(maple)).toContain('$180.74')
    expect(text(maple)).toContain('$187.60')
    expect(text(modal.querySelector('[data-representative="acct_bakery"]'))).toContain('Unchanged: contract override')
    expect(text(modal)).toContain('+$480.48')

    fireEvent.click(within(modal).getByRole('button', { name: 'Confirm and publish 8 versions' }))
    expect(screen.queryByRole('dialog', { name: /Publish 8/ })).toBeNull()
    expect(screen.getByText('Published 8 versions. Old versions kept.')).toBeTruthy()
    expect(text(screen.getByTestId('ratebook-status'))).toBe('33 published, 0 drafts')
    const proof = screen.getByTestId('history-proof')
    expect(text(proof)).toContain('Posted invoice unchanged by this publish')
    expect(text(within(proof).getByTestId('proof-total'))).toBe('$180.74')

    const line = container.querySelector('[data-line="cat_res_96|zone_open|weekly"]')!
    expect(text(line)).toContain('$29.00')
    expect(text(line)).toContain('Scheduled $30.16 from 2026-10-01')
    fireEvent.click(within(line as HTMLElement).getByRole('button', { name: 'History' }))
    const drawer = screen.getByRole('dialog', { name: '96 gal cart' })
    const versions = drawer.querySelectorAll('[data-version]')
    expect(versions).toHaveLength(2)
    expect(text(versions[0])).toContain('rv_pr_res_96_open_weekly_20261001')
    expect(text(versions[0])).toContain('$30.16')
    expect(text(versions[1])).toContain('$29.00')
    expect(text(versions[1])).toContain('current')
    expect(text(versions[1])).toContain('Published versions are never edited')
  })
})
