// @vitest-environment jsdom
/**
 * Box 3.3: portal requests reach the account view.
 * - Every request kind the portal files (extra pickup, vacation hold, cart change, missed pickup, quote) is an open item
 *   on that account's view with its kind and work order.
 * - A portal cart change drives account's changeServiceItem at request time, so the account view shows the effective
 *   date, the swap work order, and the next-invoice adjustment with no proration (scenario 7).
 * - A portal vacation hold is applied by the office from the account view: "Apply hold" opens the hold drawer with
 *   the portal's dates, and confirming goes through account's changeAccountStatus without a second Request.
 * Relationships only; the seed's cents are being regenerated in parallel.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes, ROUTER_FUTURE } from '../App'
import { resolvePrice } from '../store/engine'
import { useStore } from '../store/useStore'
import { buildAccountView } from '../surfaces/account/selectors'
import { EXTRA_PICKUP_RATE_CENTS, EXTRA_PICKUP_SOURCE, PREVIEW_CHARGE_ID, computeCharge } from '../surfaces/portal/lib/engine'

const MAPLE = 'acct_res_maple'
const OAKRIDGE = 'acct_pm_oakridge'
const st = () => useStore.getState()
const view = (id: string) => buildAccountView(id, st().db)!

let errors: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  st().reset()
  errors = vi.spyOn(console, 'error')
})
afterEach(() => {
  cleanup()
  expect(errors).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <AppRoutes />
    </MemoryRouter>,
  )
}

function bookExtraPickup() {
  const charge = computeCharge({
    id: PREVIEW_CHARGE_ID, accountId: MAPLE, siteId: 'site_maple', lineType: 'event', baseCents: EXTRA_PICKUP_RATE_CENTS,
    servicedOn: '2026-09-14', source: { ...EXTRA_PICKUP_SOURCE }, pricing: { ruleWon: 'standardRate' },
  })
  return st().portalBookExtraPickup({ accountId: MAPLE, siteId: 'site_maple', charge, method: 'card', scheduledFor: '2026-09-14' })
}

describe('box 3.3: every portal request is an open item on the account view', () => {
  it('extra pickup, vacation hold, cart change, missed pickup, and quote show with their kind and work order', () => {
    const filed = [
      bookExtraPickup().request,
      st().portalPlaceHold({ accountId: MAPLE, siteId: 'site_maple', start: '2026-09-20', end: '2026-10-04' }).request,
      st().portalChangeCart({ accountId: MAPLE, siteId: 'site_maple', serviceItemId: 'si_maple_96', toCatalogId: 'cat_res_64' }).request,
      st().portalAddRequest({ accountId: MAPLE, siteId: 'site_maple', kind: 'missedPickup', status: 'open', createdVia: 'portal', note: 'Customer disputes the blocked stop' }),
      st().portalRequestQuote({ accountId: OAKRIDGE, siteId: 'site_oak_2', catalogId: 'cat_fl_3yd', qty: 1, frequency: 'weekly', material: 'trash' }).request,
    ]
    expect(filed.map(r => r.kind).sort()).toEqual(['cartChange', 'extraPickup', 'missedPickup', 'quote', 'vacationHold'])

    for (const r of filed) {
      const item = view(r.accountId).openRequests.find(v => v.request.id === r.id)
      expect(item, `${r.kind} ${r.id}`).toBeDefined()
      expect(item!.request.kind).toBe(r.kind)
      expect(item!.workOrder?.id).toBe(r.workOrderId)
      if (r.workOrderId) expect(view(r.accountId).openWorkOrders.map(w => w.workOrder.id)).toContain(r.workOrderId)
    }

    renderAt(`/office/account/${MAPLE}`)
    const open = within(screen.getByRole('region', { name: 'Open items' }))
    for (const r of filed.filter(x => x.accountId === MAPLE)) {
      // The request row names it; a work order that answers it names it too ("for request").
      expect(open.getAllByText(r.id).length).toBeGreaterThan(0)
      if (r.workOrderId) expect(open.getAllByText(r.workOrderId).length).toBeGreaterThan(0)
    }
    for (const label of ['Extra pickup', 'Vacation hold', 'Cart change', 'Missed pickup']) expect(open.getAllByText(label).length).toBeGreaterThan(0)
  })
})

describe('box 3.3: a portal cart change drives account\'s changeServiceItem (scenario 7)', () => {
  it('the account view shows the effective date, the swap work order, and the next-invoice adjustment with no proration', () => {
    const before = view(MAPLE)
    const oldLine = before.nextInvoice.preview.recurring.find(c => c.source.id === 'si_maple_96')!
    expect(oldLine).toBeDefined()

    const r = st().portalChangeCart({ accountId: MAPLE, siteId: 'site_maple', serviceItemId: 'si_maple_96', toCatalogId: 'cat_res_64' })
    const { effectiveFrom } = r.pendingChange
    const after = view(MAPLE)

    // Effective date: the old cart ends and the new one starts at the next cycle start.
    const items = st().db.serviceItems
    expect(items.find(i => i.id === 'si_maple_96')).toMatchObject({ status: 'ended', effectiveTo: effectiveFrom })
    const newItem = items.find(i => i.id === r.workOrder.serviceItemId)!
    expect(newItem).toMatchObject({ catalogId: 'cat_res_64', effectiveFrom, status: 'active' })
    expect(after.nextInvoice.date).toBe(effectiveFrom)

    // The swap work order answers the portal's Request.
    const wo = after.openWorkOrders.find(w => w.workOrder.id === r.workOrder.id)!
    expect(wo.workOrder).toMatchObject({ kind: 'swap', requestId: r.request.id, serviceItemId: newItem.id })
    expect(wo.workOrder.scheduledFor <= effectiveFrom).toBe(true)

    // Next invoice: the 96 gal line is gone, the 64 gal line bills the whole period at the new size (no proration),
    // and every other line is exactly as it was.
    const newLine = after.nextInvoice.preview.recurring.find(c => c.source.id === newItem.id)!
    expect(after.nextInvoice.preview.recurring.some(c => c.source.id === 'si_maple_96')).toBe(false)
    const price = resolvePrice({ catalogId: 'cat_res_64', frequency: newItem.frequency, zoneId: 'zone_open', accountId: MAPLE, onDate: effectiveFrom })
    const months = st().db.accounts.find(a => a.id === MAPLE)!.cycle === 'quarterly' ? 3 : 1
    expect(newLine.period).toEqual(oldLine.period)
    expect(newLine.baseCents).toBe(price.priceCents * newItem.qty * months)
    expect(newLine.pricing.rateVersionId).toBe(price.rateVersionId)
    const others = (lines: typeof before.nextInvoice.lines, skip: string) => lines.filter(c => c.source.id !== skip).map(c => c.totalCents).sort()
    expect(others(after.nextInvoice.lines, newItem.id)).toEqual(others(before.nextInvoice.lines, 'si_maple_96'))
    expect(after.nextInvoice.estimateCents - before.nextInvoice.estimateCents).toBe(newLine.totalCents - oldLine.totalCents)

    // On screen: the new line with its date, the swap work order, and the request.
    renderAt(`/office/account/${MAPLE}`)
    const text = screen.getByRole('main', { name: 'Account' }).textContent + (screen.getByRole('region', { name: 'Open items' }).textContent ?? '')
    expect(text).toContain('64 gal')
    expect(text).toContain(r.workOrder.id)
    expect(text).toContain(r.request.id)
  })
})

describe('box 3.3: a portal vacation hold feeds the account\'s hold drawer', () => {
  it('"Apply hold" opens the drawer with the portal\'s dates; confirming holds the account and files no second Request', () => {
    const placed = st().portalPlaceHold({ accountId: MAPLE, siteId: 'site_maple', start: '2026-09-20', end: '2026-10-04' })
    renderAt(`/office/account/${MAPLE}`)
    const open = within(screen.getByRole('region', { name: 'Open items' }))
    fireEvent.click(open.getByRole('button', { name: 'Apply hold' }))

    const drawer = within(screen.getByRole('region', { name: 'Portal request' }))
    expect(drawer.getByText(placed.request.id)).toBeTruthy()
    const requests = st().db.requests.length
    fireEvent.submit(document.getElementById('hold-form')!)

    expect(st().db.accounts.find(a => a.id === MAPLE)?.status).toBe('hold')
    expect(st().accountEdits.statusChanges.at(-1)).toMatchObject({ kind: 'hold', effectiveFrom: '2026-09-20', resumeOn: '2026-10-05' })
    expect(st().db.requests).toHaveLength(requests)
    expect(screen.queryByRole('button', { name: 'Apply hold' })).toBeNull()
  })
})
