import { beforeEach, describe, expect, it } from 'vitest';
import { NOW } from '../clock';
import { buildOffer } from '../offer';
import { CardDeclinedError, chargeToken, tokenizeCard } from '../payments';
import { completeInstantSignup } from '../signup';
import { useStore, values } from '../store';

beforeEach(() => useStore.getState().reset());

const counts = () => {
  const s = useStore.getState();
  return {
    parties: values(s.parties).length, accounts: values(s.accounts).length, sites: values(s.sites).length,
    serviceItems: values(s.serviceItems).length, workOrders: values(s.workOrders).length, charges: values(s.charges).length,
    payments: values(s.payments).length, tokens: values(s.paymentTokens).length,
  };
};

const contact = { name: 'Avery Lark', email: 'avery@example.com', phone: '404-555-0100' };

describe('tokenizeCard and chargeToken', () => {
  it('stores brand, last4, and expiry only', () => {
    const { tokenId } = tokenizeCard({ last4: '4242', brand: 'Visa', expMonth: 12, expYear: 2029 });
    const token = useStore.getState().paymentTokens[tokenId];
    expect(token).toEqual({ id: tokenId, brand: 'visa', last4: '4242', expMonth: 12, expYear: 2029, createdAt: NOW });
    expect(Object.keys(token).sort()).toEqual(['brand', 'createdAt', 'expMonth', 'expYear', 'id', 'last4']);
    expect(() => tokenizeCard({ last4: '4111111111111111', brand: 'visa', expMonth: 1, expYear: 2030 })).toThrow(/four digits/);
    expect(() => tokenizeCard({ last4: '4242', brand: 'visa', expMonth: 8, expYear: 2026 })).toThrow(/expired/);
  });

  it('creates a settled card Payment, and declines last4 0002 without writing', () => {
    const ok = tokenizeCard({ last4: '4242', brand: 'visa', expMonth: 1, expYear: 2030 }).tokenId;
    const before = counts();
    const payment = chargeToken(ok, 12936, 'acct_res_holt');
    expect(payment).toMatchObject({ accountId: 'acct_res_holt', method: 'card', status: 'settled', cents: 12936, receivedAt: NOW });
    expect(useStore.getState().payments[payment.id]).toEqual(payment);
    expect(counts().payments).toBe(before.payments + 1);

    const bad = tokenizeCard({ last4: '0002', brand: 'visa', expMonth: 1, expYear: 2030 }).tokenId;
    const beforeDecline = counts();
    expect(() => chargeToken(bad, 100, 'acct_res_holt')).toThrow(CardDeclinedError);
    expect(counts()).toEqual(beforeDecline);
  });
});

describe('completeInstantSignup', () => {
  it('creates one Party, one BillingAccount, one Site, N ServiceItems, N WorkOrders, one Payment, and adds the site to the route', () => {
    const offer = buildOffer({ zoneId: 'zone_open', routeId: 'route_mon_res', cartCatalogId: 'cat_res_96', extraCart: true, recycling: true });
    const { tokenId } = tokenizeCard({ last4: '4242', brand: 'visa', expMonth: 1, expYear: 2030 });
    const before = counts();
    const stopsBefore = useStore.getState().routes.route_mon_res.stopSiteIds.length;

    const result = completeInstantSignup({ offer, contact, addressId: 'addr_open_second_cart', consent: { autopay: true }, tokenId });

    const after = counts();
    expect(after.parties).toBe(before.parties + 1);
    expect(after.accounts).toBe(before.accounts + 1);
    expect(after.sites).toBe(before.sites + 1);
    expect(after.serviceItems).toBe(before.serviceItems + 3);
    expect(after.workOrders).toBe(before.workOrders + 3);
    expect(after.charges).toBe(before.charges + 4);
    expect(after.payments).toBe(before.payments + 1);

    const s = useStore.getState();
    expect(result).toMatchObject({ cartArrives: '2026-09-13', firstPickup: '2026-09-14' });
    expect(result.workOrderIds).toHaveLength(3);
    expect(s.parties[result.partyId]).toEqual({ id: result.partyId, name: 'Avery Lark', kind: 'homeowner' });
    expect(s.accounts[result.accountId]).toEqual({
      id: result.accountId, payerPartyId: result.partyId, cycle: 'quarterly', billedInAdvance: true, autopay: true,
      paymentMethodOnFile: 'card', status: 'active', deliveryMethod: 'email', taxExempt: false,
    });
    expect(s.sites[result.siteId]).toMatchObject({ accountId: result.accountId, address: '88 Copper Kettle Ct, Piedmont, GA 30512', zoneId: 'zone_open', routeId: 'route_mon_res' });
    expect(s.routes.route_mon_res.stopSiteIds).toHaveLength(stopsBefore + 1);
    expect(s.routes.route_mon_res.stopSiteIds.at(-1)).toBe(result.siteId);

    for (const [i, siId] of result.serviceItemIds.entries()) {
      expect(s.serviceItems[siId]).toMatchObject({ siteId: result.siteId, catalogId: offer.lines[i].catalogId, frequency: offer.lines[i].frequency, containerIds: [], effectiveFrom: '2026-09-14', status: 'active' });
      expect(s.workOrders[result.workOrderIds[i]]).toMatchObject({ siteId: result.siteId, kind: 'deliver', status: 'scheduled', scheduledFor: '2026-09-13', serviceItemId: siId });
    }
    const charges = result.chargeIds.map((id) => s.charges[id]);
    expect(charges.every((c) => c.status === 'approved' && c.accountId === result.accountId && c.siteId === result.siteId)).toBe(true);
    expect(charges.map((c) => c.source.id)).toEqual([...result.serviceItemIds, result.serviceItemIds[0]]);
    expect(charges.reduce((sum, c) => sum + c.totalCents, 0)).toBe(offer.dueTodayCents);
    expect(s.payments[result.paymentId]).toMatchObject({ accountId: result.accountId, method: 'card', status: 'settled', cents: offer.dueTodayCents });
  });

  it('a declined token leaves the store unchanged', () => {
    const offer = buildOffer({ zoneId: 'zone_open', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false });
    const { tokenId } = tokenizeCard({ last4: '0002', brand: 'mastercard', expMonth: 1, expYear: 2030 });
    const before = JSON.stringify(useStore.getState());
    expect(() => completeInstantSignup({ offer, contact, addressId: 'addr_open_single', consent: { autopay: false }, tokenId })).toThrow(CardDeclinedError);
    expect(JSON.stringify(useStore.getState())).toBe(before);
  });

  it('refuses an offer built for a different zone than the address', () => {
    const offer = buildOffer({ zoneId: 'zone_boundary', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false });
    const { tokenId } = tokenizeCard({ last4: '4242', brand: 'visa', expMonth: 1, expYear: 2030 });
    expect(() => completeInstantSignup({ offer, contact, addressId: 'addr_open_single', consent: { autopay: false }, tokenId })).toThrow(/does not match/);
  });
});
