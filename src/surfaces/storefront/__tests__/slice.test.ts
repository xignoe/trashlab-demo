// The storefront slice against the store contract (src/store/slices/types.ts, CHECKLIST.md hazards).
import { beforeEach, describe, expect, it } from 'vitest';
import { sliceRegistry } from '../../../store/slices';
import { CORE_KEYS } from '../../../store/slices/types';
import { useStore } from '../../../store/useStore';
import { buildOffer } from '../lib/offer';
import { initialStorefrontUi } from '../lib/ui';
import { viewOf } from '../lib/view';

const store = () => useStore.getState();
beforeEach(() => store().reset());

describe('storefront slice contract', () => {
  it('contributes quoteIntake, paymentTokens, sfUi, and sf-prefixed actions, never a core key', () => {
    const part = sliceRegistry.storefront(useStore.setState, useStore.getState, useStore);
    const keys = Object.keys(part);
    expect(keys).toEqual(expect.arrayContaining(['quoteIntake', 'paymentTokens', 'sfUi', 'sfCompleteInstantSignup', 'sfApproveHeldQuote']));
    for (const k of CORE_KEYS) expect(keys).not.toContain(k);
    for (const k of keys) if (!['quoteIntake', 'paymentTokens'].includes(k)) expect(k).toMatch(/^sf[A-Z]/);
    // The creator is free of side effects: calling it changed nothing in the live store.
    expect(store().sfUi).toEqual(initialStorefrontUi());
  });

  it('starts with the seed sidecars for the two seed quotes', () => {
    expect(Object.keys(store().quoteIntake).sort()).toEqual(['quote_bakery_request', 'quote_held_ridge']);
    expect(Object.keys(store().paymentTokens)).toEqual(['tok_ridge_4242']);
    for (const id of Object.keys(store().quoteIntake)) expect(store().db.quotes.some((q) => q.id === id)).toBe(true);
  });

  it('Reset seed rebuilds the slice: session rows, tokens, and receipts are gone', () => {
    const v = viewOf(store());
    const offer = buildOffer({ zoneId: 'zone_open', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false }, v);
    const { tokenId } = store().sfTokenizeCard({ last4: '4242', brand: 'visa', expMonth: 1, expYear: 2030 });
    store().sfSubmitAddress('addr_open_single');
    store().sfCompleteInstantSignup({ offer, contact: { name: 'A', email: 'a@example.com' }, addressId: 'addr_open_single', consent: { autopay: true }, tokenId });
    expect(store().db.accounts.some((a) => a.id.includes('_sf_'))).toBe(true);
    store().reset();
    expect(store().db.accounts.some((a) => a.id.includes('_sf_'))).toBe(false);
    expect(Object.keys(store().paymentTokens)).toEqual(['tok_ridge_4242']);
    expect(store().sfUi).toEqual(initialStorefrontUi());
  });

  it('ids keep counting across Reset seed, so a session never repeats one', () => {
    const first = store().sfTokenizeCard({ last4: '4242', brand: 'visa', expMonth: 1, expYear: 2030 }).tokenId;
    store().reset();
    const second = store().sfTokenizeCard({ last4: '4242', brand: 'visa', expMonth: 1, expYear: 2030 }).tokenId;
    expect(second).not.toBe(first);
    expect(Number(second.slice(-4))).toBeGreaterThan(Number(first.slice(-4)));
  });

  it('sfSubmitAddress routes each branch and applies the address presets', () => {
    expect(store().sfSubmitAddress('412 Larkspur').screen).toBe('offer');
    expect(store().sfUi).toMatchObject({ addressId: 'addr_open_single', query: '412 Larkspur Ln, Piedmont, GA 30512' });
    expect(store().sfSubmitAddress('88 Copper').screen).toBe('offer');
    expect(store().sfUi.selections.extraCart).toBe(true);
    expect(store().sfSubmitAddress('2071 Meadow').screen).toBe('offer');
    expect(store().sfUi.selections).toMatchObject({ extraCart: false, recycling: true });
    expect(store().sfSubmitAddress('1180 Ridge').screen).toBe('boundary');
    expect(store().sfSubmitAddress('530 Main').screen).toBe('franchise');
    expect(store().sfSubmitAddress('1 Nowhere Rd').screen).toBe('notServed');
    store().sfSetUi({ business: true });
    expect(store().sfSubmitAddress('1500 Commerce').screen).toBe('commercial');
    expect(store().sfUi.commercialDraft.address).toBe('1500 Commerce Way, Suite B, Piedmont, GA 30512');
    store().sfStartOver();
    expect(store().sfUi.business).toBe(true);
    expect(store().sfUi.addressId).toBeUndefined();
  });
});
