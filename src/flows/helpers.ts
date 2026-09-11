/**
 * Shared steps for the cross-surface flow tests (Phase 3). Each step drives a surface through its own slice actions
 * on the one live store, exactly as its screen does, so a flow test proves the hand-off and not a fixture.
 */
import type { Charge, Invoice } from '../types'
import { useStore } from '../store/useStore'
import { queueItems } from '../store/selectors'
import { buildOffer } from '../surfaces/storefront/lib/offer'
import { viewOf } from '../surfaces/storefront/lib/view'
import type { SignupResult } from '../surfaces/storefront/lib/signup'

const st = () => useStore.getState()

/** An instant storefront signup at 412 Larkspur Ln (zone_open, Tuesday route), one 96 gal cart. */
export function signUpAtLarkspur(opts: { startDate?: string; name?: string } = {}): SignupResult {
  st().sfSubmitAddress('addr_open_single')
  const offer = buildOffer(
    { zoneId: 'zone_open', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false, startDate: opts.startDate },
    viewOf(st()),
  )
  const { tokenId } = st().sfTokenizeCard({ last4: '4242', brand: 'visa', expMonth: 1, expYear: 2030 })
  return st().sfCompleteInstantSignup({
    offer,
    contact: { name: opts.name ?? 'Dana Larkspur', email: 'dana@example.com' },
    addressId: 'addr_open_single',
    consent: { autopay: true },
    tokenId,
  })
}

/**
 * Run billing's cycle through the store (runCycle), decide every queue item by approving it, approve the clean rest,
 * and post. Returns the invoices posted. This is the billing run screen's own sequence, called through billing's
 * actions without touching its slice.
 */
export function runAndPost(): Invoice[] {
  st().runCycle()
  for (const item of queueItems(st())) if (!item.decided && st().db.charges.find(c => c.id === item.chargeId)?.status === 'proposed') st().approve(item.chargeId)
  st().bulkApproveClean()
  return st().post()
}

/** The charges on an invoice, in invoice order. */
export function chargesOn(invoice: Invoice): Charge[] {
  const { db } = st()
  return invoice.chargeIds.map(id => db.charges.find(c => c.id === id)!)
}

/** A JSON snapshot of every posted invoice with its charges, to prove invariant 1 (posted means frozen). */
export function postedSnapshot(): Map<string, string> {
  const { db } = st()
  return new Map(db.invoices.map(inv => [inv.id, JSON.stringify({ inv, charges: inv.chargeIds.map(id => db.charges.find(c => c.id === id)) })]))
}
