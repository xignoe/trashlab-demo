// @vitest-environment jsdom
/**
 * Box 3.7: the persona bar shows live open-item counts. Office sums proposed charges awaiting a decision, open
 * customer requests, and held signups; Owner counts pricing's drafts. Each count moves as a surface acts, with no
 * reload. Counts are compared before and after, never against seed figures.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppRoutes, ROUTER_FUTURE } from '../App'
import { useStore } from '../store/useStore'
import { OPEN_ITEM_SELECTORS } from '../shell/openItems'
import { queueItems } from '../store/selectors'
import { today } from '../store/clock'

const st = () => useStore.getState()
const count = (testId: string) => Number(screen.queryByTestId(testId)?.textContent ?? '0')
const office = () => count('open-items-office')
const owner = () => count('open-items-owner')
const n = (key: keyof typeof OPEN_ITEM_SELECTORS) => OPEN_ITEM_SELECTORS[key](st())

beforeEach(() => st().reset())
afterEach(() => cleanup())

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <AppRoutes />
    </MemoryRouter>,
  )
}

describe('box 3.7: persona bar open-item counts', () => {
  it('the Office badge is the sum of its three counts and the Owner badge is the drafts', () => {
    renderAt('/office/account')
    expect(office()).toBe(n('proposedCharges') + n('openRequests') + n('heldSignups'))
    expect(owner()).toBe(n('pricingDrafts'))
    // The held seed quote is office work waiting on the Approvals screen.
    expect(n('heldSignups')).toBeGreaterThan(0)
    expect(count('open-items-/office/approvals')).toBe(n('heldSignups'))
  })

  it('the persona and screen names stay the plain labels; the breakdown is the title', () => {
    renderAt('/office/account')
    const link = screen.getByRole('link', { name: 'Office' })
    expect(link.getAttribute('title')).toMatch(/held signup/)
  })

  it('counts move as billing, portal, storefront, and pricing act', () => {
    renderAt('/office/account')
    const office0 = office()

    // Billing runs the cycle: every generated charge is proposed and waits for a decision.
    act(() => { st().runCycle() })
    const proposed = n('proposedCharges')
    expect(proposed).toBeGreaterThan(0)
    expect(office()).toBe(office0 + proposed)
    // Accounts carries the cycle, so its screen count is the proposed charges plus the open requests.
    expect(count('open-items-/office/account')).toBe(proposed + n('openRequests'))

    // A decision takes one off.
    const first = st().db.charges.find(c => c.status === 'proposed')!
    act(() => { st().approve(first.id) })
    expect(office()).toBe(office0 + proposed - 1)

    // A customer files a request in the portal.
    const before = office()
    act(() => {
      st().portalAddRequest({ accountId: 'acct_res_maple', siteId: 'site_maple', kind: 'missedPickup', status: 'open', createdVia: 'portal', note: 'Flow test' })
    })
    expect(office()).toBe(before + 1)

    // The office approves the held signup.
    const held = st().db.quotes.find(q => q.status === 'held')!
    const beforeApproval = office()
    act(() => { st().sfApproveHeldQuote(held.id, 'office') })
    expect(office()).toBe(beforeApproval - 1)

    // The owner drafts a 4% residential increase, then publishes it.
    expect(owner()).toBe(0)
    let ids: string[] = []
    act(() => { ids = st().createBulkIncreaseDrafts({ lob: 'residential', pct: 4, effectiveFrom: '2026-10-01' }).map(d => d.id) })
    expect(owner()).toBe(ids.length)
    expect(ids.length).toBeGreaterThan(0)
    act(() => { st().publishRateVersions({ draftIds: ids }) })
    expect(owner()).toBe(0)
  })
})

describe('the Accounts cycle button (it replaced the billing run screen header)', () => {
  it('runs the cycle and filters to the accounts to review, steps aside while charges are decided, then moves to the next cycle', () => {
    renderAt('/office/account')
    expect(screen.queryByTestId('persona-bar')!.textContent).not.toMatch(/cycle/)
    fireEvent.click(screen.getByRole('button', { name: 'Run Oct 1 cycle' }))
    expect(screen.getByRole('button', { name: /^To review/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('button', { name: /cycle/ })).toBeNull()

    // Cancel run undoes it: one click while nothing is decided, and the table leaves the To review filter.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }))
    expect(st().runs).toEqual({})
    expect(screen.queryByRole('button', { name: /^To review/ })).toBeNull()

    // With a decision made, it asks first, and Keep it leaves the run alone.
    fireEvent.click(screen.getByRole('button', { name: 'Run Oct 1 cycle' }))
    act(() => { st().approve(queueItems(st())[0].chargeId) })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }))
    const confirm = screen.getByRole('dialog', { name: 'Confirm cancel run' })
    expect(confirm.textContent).toContain('the 1 decision you made on them is lost')
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(Object.keys(st().runs)).toEqual(['2026-10-01'])

    act(() => {
      for (const i of queueItems(st())) if (!i.decided) st().approve(i.chargeId)
      st().bulkApproveClean()
      st().post()
    })
    const clock = today()
    fireEvent.click(screen.getByRole('button', { name: 'Next cycle, Nov 1' }))
    expect(today()).not.toBe(clock)
    expect(screen.getByRole('button', { name: 'Run Nov 1 cycle' })).toBeTruthy()
  })
})
