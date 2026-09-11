/**
 * The intake rule (Phase 3.2, addendum C13 and L; written out in the root DECISIONS.md).
 *
 * A Charge with status proposed or approved, on no Invoice and in no billing run's chargeIds, is intake. The next
 * runCycle adds it to its run: a proposed one joins the queue as a decision (kind proposedCharge), an approved one is
 * posted with the run's other approved charges. When the invoice posts, the account's settled payments that are on no
 * allocation are applied to it through the canonical allocate(), up to the smaller of its open balance and the total
 * of the intake charges on it.
 *
 * These tests drive the real surfaces' writers through the one store: the storefront's instant signup, the portal's
 * extra pickup, and account's reinstatement fee built by account's own helper (written to db.charges as proposed,
 * which is the shape the other Phase 3 agent is wiring account to write).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Charge } from '../types'
import { computeCharge, generateRecurringCharges, invoiceBalance, resetChargeIds, unappliedFor } from './engine'
import { batchSummary, cleanApprovalPreview, queueItems } from './selectors'
import { useStore } from './useStore'
import { buildOffer } from '../surfaces/storefront/lib/offer'
import { viewOf } from '../surfaces/storefront/lib/view'
import { EXTRA_PICKUP_RATE_CENTS, EXTRA_PICKUP_SOURCE } from '../surfaces/portal/lib/engine'
import { buildReinstatementFee } from '../surfaces/account/lib/engine'

const store = () => useStore.getState()
const OCT = '2026-10-01'

beforeEach(() => {
  store().reset()
  resetChargeIds()
})

/** Decide every open queue item by approving it, bulk approve the clean rest, post. */
function approveAllAndPost() {
  for (const i of queueItems(store()).filter(x => !x.decided)) store().approve(i.chargeId)
  store().bulkApproveClean()
  return store().post()
}

/** The storefront's instant signup at 412 Larkspur (zone_open, Tuesday route): Sep 15 start, card 4242. */
function signUp() {
  const offer = buildOffer({ zoneId: 'zone_open', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false }, viewOf(store()))
  const { tokenId } = store().sfTokenizeCard({ last4: '4242', brand: 'visa', expMonth: 1, expYear: 2030 })
  const result = store().sfCompleteInstantSignup({
    offer, contact: { name: 'Avery Lark', email: 'avery@example.com', phone: '404-555-0100' }, addressId: 'addr_open_single', consent: { autopay: true }, tokenId,
  })
  return { offer, result }
}

/** A proposed extra pickup priced as the portal prices it (eventRates.extraPickup, manual source), then booked and paid. */
function bookExtraPickup(accountId: string, siteId: string) {
  const charge = computeCharge({
    id: 'chg_p_preview', accountId, siteId, lineType: 'event', baseCents: EXTRA_PICKUP_RATE_CENTS, servicedOn: '2026-09-14',
    source: { ...EXTRA_PICKUP_SOURCE }, description: 'Extra pickup, Sep 14', pricing: { ruleWon: 'standardRate' },
  }, store().db)
  return store().portalBookExtraPickup({ accountId, siteId, charge, method: 'card', scheduledFor: '2026-09-14' })
}

describe('storefront signup to billing run (addendum C13, Phase 3.2 and 3.2b)', () => {
  it('a Sep 15 signup is not billed again by the Oct 1 run; its approved charges land on its first invoice with the signup payment applied', () => {
    const { offer, result } = signUp()
    const db0 = store().db
    const recurring = result.chargeIds.map(id => db0.charges.find(c => c.id === id)!).filter(c => c.lineType === 'recurring')
    expect(recurring.map(c => c.period)).toEqual([{ start: '2026-09-15', end: '2026-12-14' }])
    expect(result.chargeIds.map(id => db0.charges.find(c => c.id === id)!.status)).toEqual(['approved', 'approved'])

    const run = store().runCycle()
    // The engine proposed nothing for the new service item: Sep 15 to Dec 14 overlaps Oct 1 to Dec 31.
    const proposedForItem = run.chargeIds.map(id => store().db.charges.find(c => c.id === id)!)
      .filter(c => c.source.type === 'serviceItem' && result.serviceItemIds.includes(c.source.id) && c.lineType === 'recurring' && c.status === 'proposed')
    expect(proposedForItem).toEqual([])
    // The storefront's approved first-cycle charges are intake: in the run, not queue items, not bulk-approve targets.
    expect(run.intakeChargeIds).toEqual(result.chargeIds)
    expect(run.intakeDecisionIds).toEqual([])
    expect(run.chargeIds).toEqual(expect.arrayContaining(result.chargeIds))
    expect(queueItems(store()).some(i => i.accountId === result.accountId)).toBe(false)
    expect(cleanApprovalPreview(store()).chargeIds.some(id => result.chargeIds.includes(id))).toBe(false)
    // One more invoice to generate than the seed alone produces, and it is clean.
    expect(batchSummary(store()).invoicesToGenerate).toBe(45)

    // Re-running the cycle keeps the intake exactly once and never deletes it.
    const again = store().runCycle()
    expect(again.intakeChargeIds).toEqual(result.chargeIds)
    expect(again.chargeIds.filter(id => result.chargeIds.includes(id))).toHaveLength(result.chargeIds.length)

    const posted = approveAllAndPost()
    const first = posted.find(i => i.accountId === result.accountId)!
    // Posting follows run order: the signup is numbered after every account the run billed, so the seed's numbers hold.
    expect(posted).toHaveLength(45)
    expect(first.number).toBe('INV-2026-0267')
    expect(posted.find(i => i.accountId === 'acct_res_maple')!.number).toBe('INV-2026-0223')
    expect(first.chargeIds).toEqual(result.chargeIds)
    expect(first.totalCents).toBe(offer.dueTodayCents)
    expect(first.totalCents).toBe(12936)
    // The signup payment is applied through allocate(), in full, and the first invoice is paid.
    const allocations = store().db.allocations.filter(a => a.invoiceId === first.id)
    expect(allocations).toEqual([{ sourceType: 'payment', sourceId: result.paymentId, invoiceId: first.id, cents: 12936 }])
    expect(store().runs[OCT].postedAllocations).toEqual(allocations)
    expect(invoiceBalance(first.id, store().db)).toBe(0)
    expect(unappliedFor(result.paymentId, store().db)).toBe(0)
    expect(store().db.charges.filter(c => result.chargeIds.includes(c.id)).every(c => c.status === 'posted')).toBe(true)

    // Posted intake is no longer intake: the next run takes nothing from the signup, and the January run bills the next quarter.
    store().advanceCycle()
    const nov = store().runCycle()
    expect(nov.intakeChargeIds).toEqual([])
    expect(generateRecurringCharges({ cycleDate: '2027-01-01' }, store().db).filter(c => result.serviceItemIds.includes(c.source.id)).map(c => c.period))
      .toEqual([{ start: '2027-01-01', end: '2027-03-31' }])
  })
})

describe('portal extra pickup to billing run (addendum L)', () => {
  it("Maple's prepaid extra pickup posts on her October invoice and her portal payment is applied to it, capped at the charge", () => {
    const booked = bookExtraPickup('acct_res_maple', 'site_maple')
    expect(booked.charge.status).toBe('approved')
    const run = store().runCycle()
    expect(run.intakeChargeIds).toEqual([booked.charge.id])
    expect(queueItems(store()).some(i => i.chargeId === booked.charge.id)).toBe(false)

    const posted = approveAllAndPost()
    const maple = posted.find(i => i.accountId === 'acct_res_maple')!
    expect(maple.chargeIds).toContain(booked.charge.id)
    // Her October invoice is $180.74 of recurring lines, her $2.87 extra bags (approved here), and the pickup
    // ($25.00 event line plus 7% fuel and 7% tax, $28.62); only the pickup is prepaid, so only its $28.62 is applied
    // and $183.61 stays open.
    expect(booked.charge.totalCents).toBe(2862)
    expect(maple.totalCents).toBe(18074 + 287 + 2862)
    expect(store().db.allocations.filter(a => a.invoiceId === maple.id)).toEqual([
      { sourceType: 'payment', sourceId: booked.payment.id, invoiceId: maple.id, cents: 2862 },
    ])
    expect(invoiceBalance(maple.id, store().db)).toBe(18361)
  })

  it('an unrelated unapplied payment on the same account stays for a person (pay_chk_unknown on acct_res_017)', () => {
    const booked = bookExtraPickup('acct_res_017', 'site_res_017')
    store().runCycle()
    const posted = approveAllAndPost()
    const inv = posted.find(i => i.accountId === 'acct_res_017')!
    expect(store().db.allocations.filter(a => a.invoiceId === inv.id).map(a => [a.sourceId, a.cents])).toEqual([[booked.payment.id, booked.charge.totalCents]])
    expect(unappliedFor('pay_chk_unknown', store().db)).toBe(6500)
  })
})

describe("account's reinstatement fee to billing run (addendum L, Phase 3.6's shape)", () => {
  /** Kerr is reinstated (active) and account proposes the hauler's reinstatement fee into db.charges. */
  function proposeFee(accountStatus: 'active' | 'suspended'): Charge {
    const fee = buildReinstatementFee({ accountId: 'acct_res_kerr', sourceId: 'reinstate_test', id: 'chg_a_test_fee' }, store().db)
    store().mutateDb(db => ({
      ...db,
      accounts: db.accounts.map(a => (a.id === 'acct_res_kerr' ? { ...a, status: accountStatus } : a)),
      charges: [...db.charges, fee],
    }))
    return fee
  }

  it('a proposed fee joins the run as a queue decision, is never bulk approved, blocks posting until decided, then posts', () => {
    const fee = proposeFee('active')
    expect(fee.status).toBe('proposed')
    const run = store().runCycle()
    expect(run.intakeDecisionIds).toEqual([fee.id])
    const item = queueItems(store()).find(i => i.chargeId === fee.id)!
    expect([item.kind, item.kindLabel, item.decided, item.accountId]).toEqual(['proposedCharge', 'Proposed charge', false, 'acct_res_kerr'])
    store().bulkApproveClean()
    expect(store().db.charges.find(c => c.id === fee.id)!.status).toBe('proposed')
    expect(() => store().post()).toThrow(/undecided/)

    const posted = approveAllAndPost()
    const kerr = posted.find(i => i.accountId === 'acct_res_kerr')!
    expect(kerr.chargeIds).toContain(fee.id)
    // The item stays in the queue as decided, like every other decision.
    expect(queueItems(store()).find(i => i.chargeId === fee.id)?.decision).toBe('posted')
  })

  it('a waived fee is recorded as leakage and never posts', () => {
    const fee = proposeFee('active')
    store().runCycle()
    store().waive(fee.id, 'goodwill')
    const posted = approveAllAndPost()
    expect(posted.flatMap(i => i.chargeIds)).not.toContain(fee.id)
    expect(store().db.waivedCharges.some(w => w.chargeId === fee.id)).toBe(true)
  })

  it('invariant 4: a charge on a suspended account stays intake until the account is active, then the next run takes it', () => {
    const fee = proposeFee('suspended')
    expect(store().runCycle().chargeIds).not.toContain(fee.id)
    store().mutateDb(db => ({ ...db, accounts: db.accounts.map(a => (a.id === 'acct_res_kerr' ? { ...a, status: 'active' } : a)) }))
    const rerun = store().runCycle()
    expect(rerun.intakeDecisionIds).toEqual([fee.id])
  })

  it('a charge already in a run is never taken again by a later run', () => {
    const fee = proposeFee('active')
    store().runCycle()
    store().advanceCycle()
    expect(store().runCycle().chargeIds).not.toContain(fee.id)
  })
})
