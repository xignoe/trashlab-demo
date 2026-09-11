import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setToday } from '../../../store/clock';
import { useStore } from '../../../store/useStore';
import { addHours, now } from '../lib/clock';
import { heldAmounts, savedTokenId } from '../lib/held';
import { buildOffer } from '../lib/offer';
import { CardDeclinedError } from '../lib/payments';
import { viewOf } from '../lib/view';

const store = () => useStore.getState();
const view = () => viewOf(store());
beforeEach(() => store().reset());
afterEach(() => setToday());

const contact = { name: 'Priya Ridgeway', email: 'priya@example.com', phone: '404-555-0142' };
const boundaryOffer = () => buildOffer({ zoneId: 'zone_boundary', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false }, view());
const paymentCount = () => store().db.payments.length;
const snapshot = () => JSON.stringify(store());
const token = (last4 = '4242') => store().sfTokenizeCard({ last4, brand: 'visa', expMonth: 1, expYear: 2030 }).tokenId;

describe('sfCreateHeldQuote', () => {
  it('creates a held Quote with a 72 hour deadline, a 7 day expiry, and no Payment', () => {
    const offer = boundaryOffer();
    const tokenId = token();
    const before = paymentCount();
    const result = store().sfCreateHeldQuote({ offer, contact, deliveryNotes: 'Gravel drive, leave by the gate', photoName: 'drive.jpg', tokenId, addressId: 'addr_boundary' });

    const quote = view().quotes[result.quoteId];
    expect(result.quoteId).toMatch(/^quote_sf_\d{4}$/);
    expect(quote).toEqual({
      id: result.quoteId, kind: 'residentialSignup', address: '1180 Ridge Hollow Rd, Piedmont, GA 30512', zoneId: 'zone_boundary',
      lines: [{ catalogId: 'cat_res_96', qty: 1, frequency: 'weekly', priceCents: offer.lines[0].priceCents }],
      dueTodayCents: offer.dueTodayCents, recurringCents: offer.recurringQuarterlyCents, status: 'held', holdReason: 'confirm private road access',
      holdDeadline: '2026-09-13T10:00:00-04:00', expiresAt: '2026-09-17T10:00:00-04:00', paymentTokenId: tokenId, createdVia: 'storefront',
    });
    // Observed on billing's seed (prototype: 13623 and 10948).
    expect([quote.dueTodayCents, quote.recurringCents]).toEqual([13623, 10948]);
    expect(result.holdDeadline).toBe(addHours(now(), 72));
    expect(store().quoteIntake[result.quoteId]).toEqual({
      quoteId: result.quoteId, contact, addressId: 'addr_boundary', startDate: '2026-09-15', deliveryNotes: 'Gravel drive, leave by the gate', photoName: 'drive.jpg', createdAt: now(),
    });
    expect(paymentCount()).toBe(before);
    // A storefront-created quote shows exactly its own figures.
    expect(heldAmounts(quote, view())).toEqual({ dueTodayCents: quote.dueTodayCents, recurringCents: quote.recurringCents, fromQuote: false });
  });

  it('refuses a non-provisional offer', () => {
    const offer = buildOffer({ zoneId: 'zone_open', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false }, view());
    expect(() => store().sfCreateHeldQuote({ offer, contact, deliveryNotes: '', tokenId: token(), addressId: 'addr_open_single' })).toThrow(/provisional/);
  });
});

describe('seed quote_held_ridge on billing\'s seed (addenda D6, I4)', () => {
  it('reads its saved card from the Quote\'s own paymentTokenId and shows the engine\'s figures for its line', () => {
    const quote = view().quotes.quote_held_ridge;
    expect(quote.status).toBe('held');
    expect(quote.paymentTokenId).toBe('tok_ridge_4242');
    expect(savedTokenId(quote)).toBe('tok_ridge_4242');
    const offer = buildOffer({ zoneId: 'zone_boundary', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false, startDate: '2026-09-15' }, view());
    expect(quote.lines).toEqual(offer.lines.map((l) => ({ catalogId: l.catalogId, qty: l.qty, frequency: l.frequency, priceCents: l.priceCents })));
    // The seed row carries the engine's totals for its line (addendum D6, Phase 3.7c), the same figures approval charges.
    expect([quote.dueTodayCents, quote.recurringCents]).toEqual([13623, 10948]);
    expect(heldAmounts(quote, view())).toEqual({ dueTodayCents: offer.dueTodayCents, recurringCents: offer.recurringQuarterlyCents, fromQuote: false });
    expect(offer.dueTodayCents).toBe(13623);
  });
});

describe('sfApproveHeldQuote', () => {
  it('creates the account, container, work order, charges, and Payment, and marks the Quote accepted, in one update', () => {
    const tokenId = token();
    const { quoteId } = store().sfCreateHeldQuote({ offer: boundaryOffer(), contact, deliveryNotes: 'Gravel drive', tokenId, addressId: 'addr_boundary' });
    const before = paymentCount();

    let updates = 0;
    const unsub = useStore.subscribe(() => { updates++; });
    const result = store().sfApproveHeldQuote(quoteId, 'dispatch@piedmont');
    unsub();
    expect(updates).toBe(1);

    const v = view();
    expect(v.quotes[quoteId].status).toBe('accepted');
    expect(result).toMatchObject({ quoteId, startDate: '2026-09-15', startDateMoved: false, cartArrives: '2026-09-14', firstPickup: '2026-09-15' });
    expect(v.accounts[result.accountId]).toMatchObject({ status: 'active', paymentMethodOnFile: 'card', autopay: false });
    expect(v.sites[result.siteId]).toMatchObject({ zoneId: 'zone_boundary', routeId: 'route_tue_res', accessNotes: 'Gravel drive' });
    expect(v.containers[result.containerIds[0]]).toMatchObject({ catalogId: 'cat_res_96', siteId: result.siteId });
    expect(v.workOrders[result.workOrderIds[0]]).toMatchObject({ kind: 'deliver', status: 'scheduled', scheduledFor: '2026-09-14', containerId: result.containerIds[0] });
    expect(v.payments[result.paymentId]).toMatchObject({ accountId: result.accountId, cents: 13623, method: 'card', status: 'settled' });
    expect(v.payments[result.paymentId].cents).toBe(v.quotes[quoteId].dueTodayCents);
    expect(paymentCount()).toBe(before + 1);
    expect(store().quoteIntake[quoteId]).toMatchObject({ reviewedBy: 'dispatch@piedmont', reviewedAt: now() });
    expect(store().sfUi.approvals[quoteId]).toEqual(result);
    expect(() => store().sfApproveHeldQuote(quoteId, 'dispatch@piedmont')).toThrow(/not held/);
  });

  it('approves the seed quote_held_ridge from its preserved lines; the payment equals the approved charges', () => {
    const result = store().sfApproveHeldQuote('quote_held_ridge', 'office');
    const v = view();
    expect(v.quotes.quote_held_ridge.status).toBe('accepted');
    expect(v.parties[result.partyId].name).toBe('Priya Ridgeway');
    expect(result.startDate).toBe('2026-09-15');
    const charges = result.chargeIds.map((id) => v.charges[id]);
    expect(charges.map((c) => c.pricing.ruleWon)).toEqual(['zoneRate', 'zoneRate']);
    expect(v.db.rateVersions.find((rv) => rv.id === charges[0].pricing.rateVersionId)?.zoneId).toBe('zone_boundary');
    expect(charges.map((c) => c.totalCents)).toEqual([10948, 2675]);
    expect(v.payments[result.paymentId].cents).toBe(charges.reduce((sum, c) => sum + c.totalCents, 0));
    expect(v.payments[result.paymentId].cents).toBe(13623);
  });

  it('moves a preserved start date forward when it has passed', () => {
    useStore.setState((s) => ({ quoteIntake: { ...s.quoteIntake, quote_held_ridge: { ...s.quoteIntake.quote_held_ridge, startDate: '2026-09-08' } } }));
    const result = store().sfApproveHeldQuote('quote_held_ridge', 'office');
    expect(result).toMatchObject({ startDate: '2026-09-15', startDateMoved: true, cartArrives: '2026-09-14' });
  });

  it('keeps a promised price as a manual exception when the rate card moved since the hold', () => {
    const { quoteId } = store().sfCreateHeldQuote({ offer: boundaryOffer(), contact, deliveryNotes: '', tokenId: token(), addressId: 'addr_boundary' });
    const promised = view().quotes[quoteId].lines[0].priceCents;
    store().mutateDb((db) => ({
      ...db,
      rateVersions: [...db.rateVersions, { id: 'rv_test_up', catalogId: 'cat_res_96', zoneId: 'zone_boundary', frequency: 'weekly', priceCents: promised + 500, effectiveFrom: '2026-09-01', status: 'published', publishedAt: '2026-09-10T12:00:00-04:00' }],
    }));
    const result = store().sfApproveHeldQuote(quoteId, 'office');
    const recurring = view().charges[result.chargeIds[0]];
    expect(recurring.baseCents).toBe(promised * 3);
    expect(recurring.pricing).toEqual({ ruleWon: 'manualException' });
  });

  it('a declined saved card leaves the quote held and writes nothing', () => {
    const { quoteId } = store().sfCreateHeldQuote({ offer: boundaryOffer(), contact, deliveryNotes: '', tokenId: token('0002'), addressId: 'addr_boundary' });
    const before = snapshot();
    expect(() => store().sfApproveHeldQuote(quoteId, 'office')).toThrow(CardDeclinedError);
    expect(snapshot()).toBe(before);
  });
});

describe('sfDeclineHeldQuote', () => {
  it('sets status declined, keeps the reason, and never creates a Payment', () => {
    const before = paymentCount();
    const result = store().sfDeclineHeldQuote('quote_held_ridge', 'Road is not passable for the truck');
    expect(result).toEqual({ quoteId: 'quote_held_ridge', reason: 'Road is not passable for the truck' });
    expect(view().quotes.quote_held_ridge.status).toBe('declined');
    expect(store().quoteIntake.quote_held_ridge.declineReason).toBe('Road is not passable for the truck');
    expect(paymentCount()).toBe(before);
    expect(() => store().sfDeclineHeldQuote('quote_held_ridge', 'again')).toThrow(/not held/);
    expect(() => store().sfApproveHeldQuote('quote_held_ridge', 'office')).toThrow(/not held/);
  });
});
