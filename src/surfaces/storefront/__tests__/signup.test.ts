// Instant signup through the storefront slice (box 2D.2): what it writes to the one Db, in one update, and what a
// declined card writes (nothing).
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../../store/useStore';
import { now } from '../lib/clock';
import { idMint } from '../lib/ids';
import { buildOffer } from '../lib/offer';
import { authorizeToken, CardDeclinedError } from '../lib/payments';
import { viewOf } from '../lib/view';

const store = () => useStore.getState();
const view = () => viewOf(store());
beforeEach(() => store().reset());

const counts = () => {
  const { db, paymentTokens } = store();
  return {
    parties: db.parties.length, accounts: db.accounts.length, sites: db.sites.length, serviceItems: db.serviceItems.length,
    containers: db.containers.length, workOrders: db.workOrders.length, charges: db.charges.length, payments: db.payments.length,
    quotes: db.quotes.length, tokens: Object.keys(paymentTokens).length,
  };
};

/** Everything the store holds except functions: the Db, the sidecars, and every slice's plain state. */
const snapshot = () => JSON.stringify(store());

const contact = { name: 'Avery Lark', email: 'avery@example.com', phone: '404-555-0100' };

describe('card tokens and authorization', () => {
  it('sfTokenizeCard stores brand, last4, and expiry only, in the slice, not the Db', () => {
    const dbBefore = store().db;
    const { tokenId } = store().sfTokenizeCard({ last4: '4242', brand: 'Visa', expMonth: 12, expYear: 2029 });
    const token = store().paymentTokens[tokenId];
    expect(tokenId).toMatch(/^tok_sf_\d{4}$/);
    expect(token).toEqual({ id: tokenId, brand: 'visa', last4: '4242', expMonth: 12, expYear: 2029, createdAt: now() });
    expect(Object.keys(token).sort()).toEqual(['brand', 'createdAt', 'expMonth', 'expYear', 'id', 'last4']);
    expect(store().db).toBe(dbBefore);
    expect(() => store().sfTokenizeCard({ last4: '4111111111111111', brand: 'visa', expMonth: 1, expYear: 2030 })).toThrow(/four digits/);
    expect(() => store().sfTokenizeCard({ last4: '4242', brand: 'visa', expMonth: 8, expYear: 2026 })).toThrow(/expired/);
  });

  it('authorizeToken is pure: a settled card Payment, or CardDeclinedError for last4 0002', () => {
    const ok = store().sfTokenizeCard({ last4: '4242', brand: 'visa', expMonth: 1, expYear: 2030 }).tokenId;
    const before = snapshot();
    const payment = authorizeToken(ok, 12936, 'acct_res_holt', store().paymentTokens, idMint(view()));
    expect(payment).toMatchObject({ accountId: 'acct_res_holt', method: 'card', status: 'settled', cents: 12936, receivedAt: now() });
    expect(payment.id).toMatch(/^pay_sf_\d{4}$/);
    expect(snapshot()).toBe(before);

    const bad = store().sfTokenizeCard({ last4: '0002', brand: 'visa', expMonth: 1, expYear: 2030 }).tokenId;
    expect(() => authorizeToken(bad, 100, 'acct_res_holt', store().paymentTokens, idMint(view()))).toThrow(CardDeclinedError);
  });
});

describe('sfCompleteInstantSignup', () => {
  it('writes Party, BillingAccount, Site, and per line a ServiceItem, Container, and deliver WorkOrder, the approved charges, and one Payment', () => {
    const offer = buildOffer({ zoneId: 'zone_open', routeId: 'route_mon_res', cartCatalogId: 'cat_res_96', extraCart: true, recycling: true }, view());
    const { tokenId } = store().sfTokenizeCard({ last4: '4242', brand: 'visa', expMonth: 1, expYear: 2030 });
    const before = counts();
    const routesBefore = store().db.routes;

    let updates = 0;
    const unsub = useStore.subscribe(() => { updates++; });
    const result = store().sfCompleteInstantSignup({ offer, contact, addressId: 'addr_open_second_cart', consent: { autopay: true }, tokenId });
    unsub();

    // One atomic update: the Db rows and the success receipt land together.
    expect(updates).toBe(1);
    const after = counts();
    expect(after).toEqual({
      ...before,
      parties: before.parties + 1, accounts: before.accounts + 1, sites: before.sites + 1, serviceItems: before.serviceItems + 3,
      containers: before.containers + 3, workOrders: before.workOrders + 3, charges: before.charges + 4, payments: before.payments + 1,
    });

    // Every runtime id carries _sf_ (addendum C12).
    for (const id of [result.accountId, result.partyId, result.siteId, result.paymentId, ...result.serviceItemIds, ...result.containerIds, ...result.workOrderIds, ...result.chargeIds]) {
      expect(id).toMatch(/_sf_\d{4}$/);
    }

    const v = view();
    expect(result).toMatchObject({ cartArrives: '2026-09-13', firstPickup: '2026-09-14' });
    expect(v.parties[result.partyId]).toEqual({ id: result.partyId, name: 'Avery Lark', kind: 'homeowner' });
    expect(v.accounts[result.accountId]).toEqual({
      id: result.accountId, payerPartyId: result.partyId, cycle: 'quarterly', billedInAdvance: true, autopay: true,
      paymentMethodOnFile: 'card', status: 'active', deliveryMethod: 'email', taxExempt: false,
    });
    expect(v.sites[result.siteId]).toMatchObject({ accountId: result.accountId, occupantPartyId: result.partyId, address: '88 Copper Kettle Ct, Piedmont, GA 30512', zoneId: 'zone_open', routeId: 'route_mon_res' });
    // Routes are seed-owned (OWNERSHIP.md); the site carries its routeId instead of the prototype's stopSiteIds write.
    expect(store().db.routes).toBe(routesBefore);

    for (const [i, siId] of result.serviceItemIds.entries()) {
      const cartId = result.containerIds[i];
      expect(v.serviceItems[siId]).toMatchObject({ siteId: result.siteId, catalogId: offer.lines[i].catalogId, frequency: offer.lines[i].frequency, containerIds: [cartId], effectiveFrom: '2026-09-14', status: 'active' });
      expect(v.containers[cartId]).toMatchObject({ catalogId: offer.lines[i].catalogId, siteId: result.siteId, assignedFrom: '2026-09-13' });
      expect(v.workOrders[result.workOrderIds[i]]).toMatchObject({ siteId: result.siteId, kind: 'deliver', status: 'scheduled', scheduledFor: '2026-09-13', serviceItemId: siId, containerId: cartId });
    }
    const charges = result.chargeIds.map((id) => v.charges[id]);
    expect(charges.every((c) => c.status === 'approved' && c.accountId === result.accountId && c.siteId === result.siteId)).toBe(true);
    expect(charges.map((c) => c.lineType)).toEqual(['recurring', 'recurring', 'recurring', 'fee']);
    expect(charges.map((c) => c.source)).toEqual([...result.serviceItemIds, result.serviceItemIds[0]].map((id) => ({ type: 'serviceItem', id })));
    expect(charges.slice(0, 3).every((c) => c.period?.start === '2026-09-14' && c.period?.end === '2026-12-13')).toBe(true);
    expect(charges[3].servicedOn).toBe('2026-09-13');
    expect(charges.reduce((sum, c) => sum + c.totalCents, 0)).toBe(offer.dueTodayCents);
    expect(v.payments[result.paymentId]).toMatchObject({ accountId: result.accountId, method: 'card', status: 'settled', cents: offer.dueTodayCents });

    // The success receipt is in the slice.
    expect(store().sfUi.signup).toMatchObject({ result, tokenId });
  });

  it('the 412 Larkspur signup is $129.36: charges $102.61 and $26.75, payment $129.36', () => {
    const offer = buildOffer({ zoneId: 'zone_open', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false }, view());
    const { tokenId } = store().sfTokenizeCard({ last4: '4242', brand: 'visa', expMonth: 1, expYear: 2030 });
    const result = store().sfCompleteInstantSignup({ offer, contact, addressId: 'addr_open_single', consent: { autopay: true }, tokenId });
    const v = view();
    expect(result.chargeIds.map((id) => v.charges[id].totalCents)).toEqual([10261, 2675]);
    expect(v.charges[result.chargeIds[0]].pricing).toMatchObject({ ruleWon: 'zoneRate' });
    expect(v.payments[result.paymentId].cents).toBe(12936);
    expect(v.workOrders[result.workOrderIds[0]].scheduledFor).toBe('2026-09-14');
  });

  it('a declined token leaves the store unchanged', () => {
    const offer = buildOffer({ zoneId: 'zone_open', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false }, view());
    const { tokenId } = store().sfTokenizeCard({ last4: '0002', brand: 'mastercard', expMonth: 1, expYear: 2030 });
    const before = snapshot();
    expect(() => store().sfCompleteInstantSignup({ offer, contact, addressId: 'addr_open_single', consent: { autopay: false }, tokenId })).toThrow(CardDeclinedError);
    expect(snapshot()).toBe(before);
  });

  it('refuses an offer built for a different zone than the address', () => {
    const offer = buildOffer({ zoneId: 'zone_boundary', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false }, view());
    const { tokenId } = store().sfTokenizeCard({ last4: '4242', brand: 'visa', expMonth: 1, expYear: 2030 });
    expect(() => store().sfCompleteInstantSignup({ offer, contact, addressId: 'addr_open_single', consent: { autopay: false }, tokenId })).toThrow(/does not match/);
  });
});
