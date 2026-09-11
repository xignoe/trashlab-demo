// @vitest-environment jsdom
/**
 * Box 3.5: a below-ratebook contract price saved for Sunrise Bakery (pricing's saveContractOverride) is the price
 * source everywhere: the service line on /office/account/acct_bakery, and, after the
 * next billing run posts, the bakery invoice line in the portal ("Why this charge"). Relationships only: the new price
 * is the old contract price less $5, whatever the seed says the old one is.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes, ROUTER_FUTURE } from '../App'
import { today } from '../store/clock'
import { resolvePrice } from '../store/engine'
import { useStore } from '../store/useStore'
import { buildAccountView } from '../surfaces/account/selectors'
import { chargesOn, runAndPost } from './helpers'

const BAKERY = 'acct_bakery'
const st = () => useStore.getState()
const dollars = (cents: number) => (cents / 100).toFixed(2)

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

/** Save a bakery 3 yd override $5 under the contract price in force today. */
function saveBakeryOverride() {
  const site = st().db.sites.find(s => s.accountId === BAKERY)!
  const before = resolvePrice({ catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: site.zoneId, accountId: BAKERY, onDate: today() })
  const priceCents = before.priceCents - 500
  const contract = st().saveContractOverride({ accountId: BAKERY, catalogId: 'cat_fl_3yd', frequency: '2x', priceCents, reason: 'competitive match', pctBelowRateCard: 12 })
  return { before, priceCents, contract }
}

describe('box 3.5: bakery contract override as the price source', () => {
  it('the account view prices the bakery 3 yd line from the contract at the new price', () => {
    const { before, priceCents, contract } = saveBakeryOverride()
    expect(priceCents).toBeLessThan(before.priceCents)
    const line = buildAccountView(BAKERY, st().db)!.sites.flatMap(s => s.lines).find(l => l.item.catalogId === 'cat_fl_3yd' && l.item.status === 'active')!
    expect(line.resolved).toEqual({ priceCents, contractId: contract.id, ruleWon: 'contractOverride' })

    renderAt(`/office/account/${BAKERY}`)
    const row = screen.getByRole('button', { name: `$${dollars(priceCents)}` }).closest('tr')!
    expect(within(row).getByText('Contract')).toBeTruthy()
    expect(row.textContent).toContain('3 yd')
  })

  it('after the next run posts, the bakery invoice line carries the contract price and source, and the portal shows it', () => {
    const { priceCents, contract } = saveBakeryOverride()
    runAndPost()
    const { db } = st()
    const item = db.serviceItems.find(i => i.siteId === 'site_bakery' && i.catalogId === 'cat_fl_3yd' && i.status === 'active')!
    const invoice = db.invoices.find(i => i.accountId === BAKERY && chargesOn(i).some(c => c.source.id === item.id && c.period?.start === '2026-10-01'))!
    expect(invoice).toBeDefined()
    const charge = chargesOn(invoice).find(c => c.source.id === item.id)!
    expect(charge.pricing).toMatchObject({ ruleWon: 'contractOverride', contractId: contract.id })
    expect(charge.baseCents).toBe(priceCents * item.qty)

    // The customer's portal, signed in as the bakery: open the invoice, then "Why this charge" on the 3 yd line.
    st().portalSwitchAccount(BAKERY)
    renderAt('/customer/portal/billing')
    const invoiceRow = screen.getByText(invoice.number).closest('tr')!
    fireEvent.click(within(invoiceRow).getByRole('button', { name: /^View/ }))
    const lineRow = screen.getByText(charge.description!).closest('tr')!
    fireEvent.click(within(lineRow).getByRole('button', { name: 'Why this charge' }))
    const drawer = screen.getByRole('dialog')
    expect(within(drawer).getByText('Your contract price.')).toBeTruthy()
    expect(drawer.textContent).toContain('contractOverride')
    expect(drawer.textContent).toContain(contract.id)
    expect(drawer.textContent).toContain(dollars(priceCents))
  })
})
