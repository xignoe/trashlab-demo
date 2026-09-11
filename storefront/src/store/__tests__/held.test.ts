import { beforeEach, describe, expect, it } from 'vitest';
import { addHours, NOW } from '../clock';
import { approveHeldQuote, createHeldQuote, declineHeldQuote } from '../held';
import { buildOffer } from '../offer';
import { CardDeclinedError, tokenizeCard } from '../payments';
import { useStore, values } from '../store';

beforeEach(() => useStore.getState().reset());

const contact = { name: 'Priya Ridgeway', email: 'priya@example.com', phone: '404-555-0142' };
const boundaryOffer = () => buildOffer({ zoneId: 'zone_boundary', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false });
const paymentCount = () => values(useStore.getState().payments).length;

describe('createHeldQuote', () => {
  it('creates a held Quote with a 72 hour deadline, a 7 day expiry, and no Payment', () => {
    const offer = boundaryOffer();
    const { tokenId } = tokenizeCard({ last4: '4242', brand: 'visa', expMonth: 1, expYear: 2030 });
    const before = paymentCount();
    const result = createHeldQuote({ offer, contact, deliveryNotes: 'Gravel drive, leave by the gate', photoName: 'drive.jpg', tokenId, addressId: 'addr_boundary' });

    const quote = useStore.getState().quotes[result.quoteId];
    expect(quote).toEqual({
      id: result.quoteId, kind: 'residentialSignup', address: '1180 Ridge Hollow Rd, Piedmont, GA 30512', zoneId: 'zone_boundary',
      lines: [{ catalogId: 'cat_res_96', qty: 1, frequency: 'weekly', priceCents: 3100 }],
      dueTodayCents: 13623, recurringCents: 10948, status: 'held', holdReason: 'confirm private road access',
      holdDeadline: '2026-09-13T10:00:00-04:00', expiresAt: '2026-09-17T10:00:00-04:00', paymentTokenId: tokenId, createdVia: 'storefront',
    });
    expect(result.holdDeadline).toBe(addHours(NOW, 72));
    expect(useStore.getState().quoteIntake[result.quoteId]).toEqual({
      quoteId: result.quoteId, contact, addressId: 'addr_boundary', startDate: '2026-09-15', deliveryNotes: 'Gravel drive, leave by the gate', photoName: 'drive.jpg', createdAt: NOW,
    });
    expect(paymentCount()).toBe(before);
  });

  it('refuses a non-provisional offer', () => {
    const offer = buildOffer({ zoneId: 'zone_open', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false });
    const { tokenId } = tokenizeCard({ last4: '4242', brand: 'visa', expMonth: 1, expYear: 2030 });
    expect(() => createHeldQuote({ offer, contact, deliveryNotes: '', tokenId, addressId: 'addr_open_single' })).toThrow(/provisional/);
  });
});

describe('seed quote_held_ridge (addenda C4, D6)', () => {
  it('carries exactly what buildOffer computes for one 96 gal weekly cart in zone_boundary', () => {
    const quote = useStore.getState().quotes.quote_held_ridge;
    const offer = buildOffer({ zoneId: 'zone_boundary', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false, startDate: '2026-09-15' });
    expect(quote.lines).toEqual(offer.lines.map((l) => ({ catalogId: l.catalogId, qty: l.qty, frequency: l.frequency, priceCents: l.priceCents })));
    expect(quote.lines).toEqual([{ catalogId: 'cat_res_96', qty: 1, frequency: 'weekly', priceCents: 3100 }]);
    expect(quote.recurringCents).toBe(offer.recurringQuarterlyCents);
    expect(quote.dueTodayCents).toBe(offer.dueTodayCents);
    const [cart] = offer.lines;
    expect({ base: cart.charge.baseCents, fees: cart.charge.fees.map((f) => f.cents), tax: cart.charge.taxCents, total: cart.charge.totalCents }).toEqual({ base: 9300, fees: [651, 300], tax: 697, total: 10948 });
    expect(offer.deliveryCharge.totalCents).toBe(2500 + 175);
    expect(quote.dueTodayCents).toBe(10948 + 2500 + 175);
  });
});

describe('approveHeldQuote', () => {
  it('creates the account, work order, and Payment and marks the Quote accepted', () => {
    const offer = boundaryOffer();
    const { tokenId } = tokenizeCard({ last4: '4242', brand: 'visa', expMonth: 1, expYear: 2030 });
    const { quoteId } = createHeldQuote({ offer, contact, deliveryNotes: 'Gravel drive', tokenId, addressId: 'addr_boundary' });
    const before = paymentCount();

    const result = approveHeldQuote(quoteId, 'dispatch@piedmont');
    const s = useStore.getState();
    expect(s.quotes[quoteId].status).toBe('accepted');
    expect(result).toMatchObject({ quoteId, startDate: '2026-09-15', startDateMoved: false, cartArrives: '2026-09-14', firstPickup: '2026-09-15' });
    expect(s.accounts[result.accountId]).toMatchObject({ status: 'active', paymentMethodOnFile: 'card', autopay: false });
    expect(s.sites[result.siteId]).toMatchObject({ zoneId: 'zone_boundary', routeId: 'route_tue_res', accessNotes: 'Gravel drive' });
    expect(s.workOrders[result.workOrderIds[0]]).toMatchObject({ kind: 'deliver', status: 'scheduled', scheduledFor: '2026-09-14' });
    expect(s.payments[result.paymentId]).toMatchObject({ accountId: result.accountId, cents: 13623, method: 'card', status: 'settled' });
    expect(paymentCount()).toBe(before + 1);
    expect(s.routes.route_tue_res.stopSiteIds).toContain(result.siteId);
    expect(s.quoteIntake[quoteId]).toMatchObject({ reviewedBy: 'dispatch@piedmont', reviewedAt: NOW });
    expect(() => approveHeldQuote(quoteId, 'dispatch@piedmont')).toThrow(/not held/);
  });

  it('approves the seed quote_held_ridge from its preserved lines', () => {
    const result = approveHeldQuote('quote_held_ridge', 'office');
    const s = useStore.getState();
    expect(s.quotes.quote_held_ridge.status).toBe('accepted');
    expect(s.payments[result.paymentId].cents).toBe(13623);
    expect(s.parties[result.partyId].name).toBe('Priya Ridgeway');
    expect(result.startDate).toBe('2026-09-15');
    const charges = result.chargeIds.map((id) => s.charges[id]);
    expect(charges.map((c) => c.pricing.ruleWon)).toEqual(['zoneRate', 'zoneRate']);
    expect(charges[0].pricing.rateVersionId).toBe('rv_res_96_boundary_weekly');
    expect(charges.reduce((sum, c) => sum + c.totalCents, 0)).toBe(13623);
  });

  it('moves a preserved start date forward when it has passed', () => {
    useStore.setState((s) => ({ quoteIntake: { ...s.quoteIntake, quote_held_ridge: { ...s.quoteIntake.quote_held_ridge, startDate: '2026-09-08' } } }));
    const result = approveHeldQuote('quote_held_ridge', 'office');
    expect(result).toMatchObject({ startDate: '2026-09-15', startDateMoved: true, cartArrives: '2026-09-14' });
  });

  it('a declined saved card leaves the quote held and writes nothing', () => {
    const offer = boundaryOffer();
    const { tokenId } = tokenizeCard({ last4: '0002', brand: 'visa', expMonth: 1, expYear: 2030 });
    const { quoteId } = createHeldQuote({ offer, contact, deliveryNotes: '', tokenId, addressId: 'addr_boundary' });
    const before = JSON.stringify(useStore.getState());
    expect(() => approveHeldQuote(quoteId, 'office')).toThrow(CardDeclinedError);
    expect(JSON.stringify(useStore.getState())).toBe(before);
  });
});

describe('declineHeldQuote', () => {
  it('sets status declined, keeps the reason, and never creates a Payment', () => {
    const before = paymentCount();
    const result = declineHeldQuote('quote_held_ridge', 'Road is not passable for the truck');
    const s = useStore.getState();
    expect(result).toEqual({ quoteId: 'quote_held_ridge', reason: 'Road is not passable for the truck' });
    expect(s.quotes.quote_held_ridge.status).toBe('declined');
    expect(s.quoteIntake.quote_held_ridge.declineReason).toBe('Road is not passable for the truck');
    expect(paymentCount()).toBe(before);
    expect(() => declineHeldQuote('quote_held_ridge', 'again')).toThrow(/not held/);
    expect(() => approveHeldQuote('quote_held_ridge', 'office')).toThrow(/not held/);
  });
});
