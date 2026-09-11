import { beforeEach, describe, expect, it } from 'vitest';
import { NOW } from '../clock';
import { createCommercialRequest } from '../commercial';
import { useStore, values } from '../store';

beforeEach(() => useStore.getState().reset());

describe('createCommercialRequest', () => {
  it('saves a commercialRequest Quote with no price plus an intake row', () => {
    const before = { quotes: values(useStore.getState().quotes).length, payments: values(useStore.getState().payments).length };
    const result = createCommercialRequest({
      address: '1500 Commerce Way', containerCatalogId: 'cat_fl_3yd', material: 'cardboard', frequency: '2x',
      accessNotes: 'Gate opens at 6am', contact: { name: 'Sam Okafor', email: 'sam@example.com', phone: '404-555-0177' },
    });
    const s = useStore.getState();
    expect(values(s.quotes)).toHaveLength(before.quotes + 1);
    expect(values(s.payments)).toHaveLength(before.payments);
    expect(s.quotes[result.quoteId]).toEqual({
      id: result.quoteId, kind: 'commercialRequest', address: '1500 Commerce Way, Suite B, Piedmont, GA 30512', zoneId: 'zone_open',
      lines: [{ catalogId: 'cat_fl_3yd', qty: 1, frequency: '2x', priceCents: 0 }], dueTodayCents: 0, recurringCents: 0,
      status: 'draft', expiresAt: '2026-10-10T10:00:00-04:00', createdVia: 'storefront',
    });
    expect(s.quoteIntake[result.quoteId]).toEqual({
      quoteId: result.quoteId, contact: { name: 'Sam Okafor', email: 'sam@example.com', phone: '404-555-0177' }, addressId: 'addr_commercial',
      material: 'cardboard', accessNotes: 'Gate opens at 6am', createdAt: NOW,
    });
    expect(result.replyBy).toBe('2026-09-11');
    expect(JSON.stringify(s.quotes[result.quoteId])).not.toMatch(/priceCents":[1-9]/);
  });

  it('keeps an unmatched address as typed with the notserved zone', () => {
    const result = createCommercialRequest({
      address: '9 Unknown Pl', containerCatalogId: 'cat_fl_2yd', material: 'trash', frequency: 'weekly', accessNotes: '',
      contact: { name: 'A', email: 'a@example.com' },
    });
    expect(useStore.getState().quotes[result.quoteId]).toMatchObject({ address: '9 Unknown Pl', zoneId: 'zone_notserved' });
    expect(useStore.getState().quoteIntake[result.quoteId].addressId).toBeUndefined();
  });

  it('rejects a residential cart or an unknown frequency', () => {
    const base = { address: 'Commerce', material: 'trash', accessNotes: '', contact: { name: 'A', email: 'a@example.com' } };
    expect(() => createCommercialRequest({ ...base, containerCatalogId: 'cat_res_96', frequency: 'weekly' })).toThrow(/front load/);
    expect(() => createCommercialRequest({ ...base, containerCatalogId: 'cat_fl_2yd', frequency: 'eow' })).toThrow(/Frequency/);
  });
});
