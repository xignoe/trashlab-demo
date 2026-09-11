/**
 * Onboarding a customer at every hauler, in every line of business that hauler sells.
 *
 * This is the question "can I onboard a residential, commercial, or roll-off customer here?" asked of each tenant and
 * answered by running the real thing: the storefront's own store actions, the canonical engine, and the office's
 * approval path. Nothing is stubbed, so a tenant whose rate card, routes, or catalog do not hang together fails here
 * rather than in a demo.
 *
 * The two shapes of onboarding the product has:
 *
 *   Residential is self-serve. The buyer's address resolves to a zone and a route, the engine prices a complete offer,
 *   the card is authorized, and the account exists at the end of the flow with its first cycle already charged.
 *
 *   Commercial and roll-off are quoted. The buyer sends a request, which is a draft Quote and nothing else; a person
 *   writes a price per container and sends it; the customer accepts; and only then is there an account, with the
 *   written price on its contract so billing charges what was quoted.
 *
 * Fixtures are derived from each tenant's own configuration rather than hard-coded, so a hauler added to the registry
 * is covered the moment it is listed.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../store/useStore'
import { buildOffer } from '../surfaces/storefront/lib/offer'
import { formatAddress } from '../surfaces/storefront/lib/serviceability'
import { viewOf } from '../surfaces/storefront/lib/view'
import { TENANTS, piedmont, tenantById, type TenantProfile } from '../tenants'
import type { Frequency, LOB } from '../types'

const store = () => useStore.getState()
const view = () => viewOf(store())

/**
 * The store is module state shared by every test file in a worker, and signing in changes which hauler it holds. Any
 * file that switches hauler puts the seeded one back, so a later file that only calls reset() is not silently run
 * against a hauler it never asked for.
 */
afterAll(() => {
  store().signIn({ tenantId: piedmont.id, role: 'office', name: 'Piedmont office' })
})

const contact = { name: 'Jordan Vega', email: 'jordan@example.com', phone: '973-555-0134' }

/** Sign in to a hauler as its office, which is who walks a new customer through signup. */
function signInTo(tenant: TenantProfile) {
  store().signIn({ tenantId: tenant.id, role: 'office', name: `${tenant.shortName} office` })
}

/** An address in this hauler's open-market zone, on a route for the line of business being sold. */
function openAddressFor(tenant: TenantProfile, lob: LOB) {
  const db = tenant.buildDb()
  const routesForLob = new Set(db.routes.filter(r => r.lob === lob).map(r => r.id))
  const open = tenant.addresses.filter(a => a.zoneId === 'zone_open')
  // Residential must land on a residential route, because the offer needs a pickup day. A quoted line does not.
  return open.find(a => a.routeId && routesForLob.has(a.routeId)) ?? open[0]
}

/** A service this hauler stocks in the line, with a published rate, and the frequency that rate is for. */
function sellableService(tenant: TenantProfile, lob: LOB): { catalogId: string; frequency: Frequency } {
  const db = tenant.buildDb()
  const stocked = new Set(db.catalog.filter(c => c.lob === lob).map(c => c.id))
  const rate = db.rateVersions.find(r => stocked.has(r.catalogId) && r.zoneId === 'zone_open' && r.frequency)
  if (!rate) throw new Error(`${tenant.name} sells ${lob} but publishes no rate for it`)
  return { catalogId: rate.catalogId, frequency: rate.frequency! }
}

const tenantsSelling = (lob: LOB) => TENANTS.filter(t => t.lines.includes(lob)).map(t => [t.name, t.id] as const)

// ---------------------------------------------------------------------------
// Residential: self-serve signup, priced and paid in the storefront
// ---------------------------------------------------------------------------

describe.each(tenantsSelling('residential'))('%s: onboarding a residential customer', (_name, id) => {
  const tenant = tenantById(id)
  beforeEach(() => signInTo(tenant))

  it('prices a complete offer from the address alone', () => {
    const address = openAddressFor(tenant, 'residential')!
    const match = view().addresses[address.id]
    expect(match, 'the address book did not follow the signed-in hauler').toBeTruthy()

    const offer = buildOffer(
      { zoneId: address.zoneId, routeId: address.routeId!, cartCatalogId: 'cat_res_96', extraCart: false, recycling: true },
      view(),
    )

    // A real offer: a price for each line, a delivery fee, a first pickup day, and a total the buyer pays today.
    expect(offer.lines.length).toBe(2)
    expect(offer.lines.every(l => l.priceCents > 0)).toBe(true)
    expect(offer.dueTodayCents).toBeGreaterThan(0)
    expect(offer.recurringQuarterlyCents).toBeGreaterThan(0)
    expect(offer.startDate >= '2026-09-10').toBe(true)
    // The price came from this hauler's own published rate card, not another's.
    const published = tenant.buildDb().rateVersions.find(r => r.catalogId === 'cat_res_96' && r.zoneId === address.zoneId)!
    expect(offer.lines[0].priceCents).toBe(published.priceCents)
  })

  it('signs the customer up: account, site, cart, delivery, first charges, and a settled payment', () => {
    const address = openAddressFor(tenant, 'residential')!
    const offer = buildOffer(
      { zoneId: address.zoneId, routeId: address.routeId!, cartCatalogId: 'cat_res_96', extraCart: false, recycling: true },
      view(),
    )
    const { tokenId } = store().sfTokenizeCard({ last4: '4242', brand: 'visa', expMonth: 1, expYear: 2030 })
    const before = store().db.accounts.length

    const result = store().sfCompleteInstantSignup({ offer, contact, addressId: address.id, consent: { autopay: true }, tokenId })

    const db = store().db
    expect(db.accounts.length).toBe(before + 1)
    const account = db.accounts.find(a => a.id === result.accountId)!
    expect(account.status).toBe('active')
    expect(account.autopay).toBe(true)

    // The customer is on a route, with a cart on the way and the first cycle already charged and paid.
    const site = db.sites.find(s => s.id === result.siteId)!
    expect(site.zoneId).toBe(address.zoneId)
    expect(db.serviceItems.filter(s => s.siteId === site.id).length).toBe(2)
    expect(db.workOrders.filter(w => w.id && result.workOrderIds.includes(w.id)).every(w => w.kind === 'deliver')).toBe(true)
    const charges = db.charges.filter(c => result.chargeIds.includes(c.id))
    expect(charges.length).toBeGreaterThan(0)
    expect(charges.every(c => c.status === 'approved')).toBe(true)
    const payment = db.payments.find(p => p.id === result.paymentId)!
    expect(payment).toMatchObject({ method: 'card', status: 'settled', cents: offer.dueTodayCents })
    expect(result.cartArrives < result.firstPickup).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Commercial and roll-off: requested, priced by a person, then accepted
// ---------------------------------------------------------------------------

const QUOTED_LINES: [LOB, string][] = [
  ['frontload', 'commercial front load'],
  ['rolloff', 'roll-off'],
]

for (const [lob, label] of QUOTED_LINES) {
  describe.each(tenantsSelling(lob))(`%s: onboarding a ${label} customer`, (_name, id) => {
    const tenant = tenantById(id)
    beforeEach(() => signInTo(tenant))

    it('takes the request as a draft quote with no price shown to the buyer and nothing charged', () => {
      const address = openAddressFor(tenant, lob)!
      const { catalogId, frequency } = sellableService(tenant, lob)
      // Counted before, because the seeded hauler already has a book of charges and accounts of its own.
      const before = {
        charges: store().db.charges.length,
        payments: store().db.payments.length,
        accounts: store().db.accounts.length,
      }

      const { quoteId } = store().sfCreateCommercialRequest({
        address: formatAddress(address),
        lines: [{ catalogId, qty: 1, material: lob === 'rolloff' ? 'construction debris' : 'trash', frequency }],
        accessNotes: 'Gate code 4417',
        contact,
      })

      const quote = store().db.quotes.find(q => q.id === quoteId)!
      expect(quote.kind).toBe('commercialRequest')
      expect(quote.status).toBe('draft')
      expect(quote.lines[0].catalogId).toBe(catalogId)
      // A request is not a sale: nothing is billed or opened until a person prices it and the customer accepts.
      expect(store().db.charges).toHaveLength(before.charges)
      expect(store().db.payments).toHaveLength(before.payments)
      expect(store().db.accounts).toHaveLength(before.accounts)
      expect(quote.dueTodayCents).toBe(0)
    })

    it('the office writes a price, the customer accepts, and the account carries the quoted price', () => {
      const address = openAddressFor(tenant, lob)!
      const { catalogId, frequency } = sellableService(tenant, lob)
      const quoted = 78500

      const { quoteId } = store().sfCreateCommercialRequest({
        address: formatAddress(address),
        lines: [{ catalogId, qty: 2, material: lob === 'rolloff' ? 'construction debris' : 'trash', frequency }],
        accessNotes: '',
        contact,
      })

      store().sfSendCommercialQuote(quoteId, [{ catalogId, qty: 2, frequency, priceCents: quoted }], 'office')
      expect(store().quoteIntake[quoteId].quotedAt).toBeTruthy()

      const accepted = store().sfAcceptCommercialQuote(quoteId, 'office')
      const db = store().db

      expect(db.quotes.find(q => q.id === quoteId)!.status).toBe('accepted')
      expect(accepted.created).toBe(true)
      const account = db.accounts.find(a => a.id === accepted.accountId)!
      expect(account.status).toBe('active')

      // The written price is on the contract, so billing charges what was quoted rather than the rate card.
      const contract = db.contracts.find(c => c.id === accepted.contractId)!
      expect(contract.accountId).toBe(accepted.accountId)
      expect(contract.overrides.find(o => o.catalogId === catalogId)?.priceCents).toBe(quoted)

      // The containers are ordered: a site, a service line, and a delivery work order for the quantity quoted.
      const site = db.sites.find(s => s.accountId === accepted.accountId)!
      const item = db.serviceItems.find(s => s.siteId === site.id)!
      expect(item.catalogId).toBe(catalogId)
      expect(item.qty).toBe(2)
      expect(db.workOrders.filter(w => w.siteId === site.id && w.kind === 'deliver').length).toBeGreaterThan(0)
    })

    it('the office can decline the request instead, leaving no customer behind', () => {
      const address = openAddressFor(tenant, lob)!
      const { catalogId, frequency } = sellableService(tenant, lob)
      const before = store().db.accounts.length

      const { quoteId } = store().sfCreateCommercialRequest({
        address: formatAddress(address),
        lines: [{ catalogId, qty: 1, material: 'trash', frequency }],
        accessNotes: '',
        contact,
      })
      store().sfDeclineHeldQuote(quoteId, 'Outside the Thursday roll-off run')

      expect(store().db.quotes.find(q => q.id === quoteId)!.status).toBe('declined')
      expect(store().db.accounts.length).toBe(before)
    })
  })
}

// ---------------------------------------------------------------------------
// A line a hauler does not sell is closed, not broken
// ---------------------------------------------------------------------------

describe('a hauler that sells no residential service', () => {
  const omni = tenantById('omni-waste')
  beforeEach(() => signInTo(omni))

  it('cannot price a residential offer, because it stocks no cart and runs no residential route', () => {
    expect(omni.buildDb().routes.some(r => r.lob === 'residential')).toBe(false)
    // The storefront never reaches this call for Omni (the residential side is not offered), but if it did, the
    // engine refuses rather than inventing a price.
    expect(() =>
      buildOffer({ zoneId: 'zone_open', routeId: 'route_tue_fl', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false }, view()),
    ).toThrow()
  })

  it('still onboards the commercial and roll-off customers it does sell', () => {
    for (const lob of ['frontload', 'rolloff'] as LOB[]) {
      const address = openAddressFor(omni, lob)!
      const { catalogId, frequency } = sellableService(omni, lob)
      const { quoteId } = store().sfCreateCommercialRequest({
        address: formatAddress(address),
        lines: [{ catalogId, qty: 1, material: 'trash', frequency }],
        accessNotes: '',
        contact,
      })
      store().sfSendCommercialQuote(quoteId, [{ catalogId, qty: 1, frequency, priceCents: 64000 }], 'office')
      expect(store().sfAcceptCommercialQuote(quoteId, 'office').created).toBe(true)
    }
  })
})
