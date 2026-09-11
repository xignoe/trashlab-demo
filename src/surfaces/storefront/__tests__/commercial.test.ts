import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../../store/useStore';
import { now } from '../lib/clock';
import { estimateCommercial, type CommercialLine } from '../lib/commercial';
import { viewOf } from '../lib/view';

const store = () => useStore.getState();
const view = () => viewOf(store());
beforeEach(() => store().reset());

const contact = { name: 'Sam Okafor', email: 'sam@example.com', phone: '404-555-0177' };
const line = (catalogId: string, frequency: CommercialLine['frequency'], material = 'trash', qty = 1): CommercialLine => ({ catalogId, qty, material, frequency });

describe('estimateCommercial', () => {
  it('prices a front load line as one month of service with fuel, the environmental fee, and tax', () => {
    const e = estimateCommercial({ address: '1500 Commerce Way', lines: [line('cat_fl_4yd', 'weekly', 'trash', 2)] }, view());
    expect(e.blocker).toBeUndefined();
    expect(e.complete).toBe(true);
    const [l] = e.lines;
    expect(l).toMatchObject({ priced: true, unitCents: 18500, basis: 'monthly', pricing: { ruleWon: 'zoneRate', rateVersionId: 'rv_fl_4yd_weekly_2026' } });
    // 37000 base, 7% fuel 2590, one month of the $1 environmental fee, 7% tax on base plus fuel (2771.3, rounded).
    expect(e.monthly).toEqual({ baseCents: 37000, fuelCents: 2590, environmentalCents: 100, taxCents: 2771, totalCents: 42461 });
    expect(e.perHaul).toBeUndefined();
    expect(e.delivery?.totalCents).toBe(2675); // $25 delivery plus 7% tax
  });

  it('prices a rolloff line per haul (fuel and tax, no environmental fee)', () => {
    const e = estimateCommercial({ address: '1500 Commerce Way', lines: [line('cat_ro_30yd', 'onCall', 'construction debris')] }, view());
    expect(e.perHaul).toEqual({ baseCents: 67500, fuelCents: 4725, environmentalCents: 0, taxCents: 5056, totalCents: 77281 });
    expect(e.monthly).toBeUndefined();
  });

  it('uses the wood container rate for a 3 yd front load of wood waste', () => {
    const [l] = estimateCommercial({ address: '1500 Commerce Way', lines: [line('cat_fl_3yd', '2x', 'wood waste')] }, view()).lines;
    expect(l).toMatchObject({ priced: true, catalogId: 'cat_fl_3yd_wood', unitCents: 19000 });
  });

  it('says why a person prices a line: no published rate, a compactor, or a material that needs a person', () => {
    const e = estimateCommercial(
      {
        address: '1500 Commerce Way',
        lines: [line('cat_fl_3yd', '3x'), line('cat_ro_compactor_30yd', 'onCall'), line('cat_fl_6yd', 'weekly', 'food scraps'), line('cat_fl_8yd', 'weekly', 'metal'), line('cat_fl_2yd', 'weekly')],
      },
      view(),
    );
    expect(e.lines.map((l) => (l.priced ? 'priced' : l.reason))).toEqual([
      'No published rate yet for a 3 yd three times a week.',
      'Compactors are sized and priced on site.',
      'Food scraps run on a separate organics route.',
      'Metal is heavy, so front load service for it is priced by weight.',
      'priced',
    ]);
    expect(e.complete).toBe(false);
    expect(e.monthly?.baseCents).toBe(15000);
  });

  it('prices nothing without an address, at the boundary, or where the address does not match', () => {
    const lines = [line('cat_fl_4yd', 'weekly')];
    expect(estimateCommercial({ address: '', lines }, view()).blocker).toBe('Enter the business address to see an estimate.');
    expect(estimateCommercial({ address: '1180 Ridge Hollow Rd', lines }, view()).blocker).toMatch(/edge of our service area/);
    const unknown = estimateCommercial({ address: '9 Unknown Pl', lines }, view());
    expect(unknown.blocker).toMatch(/could not match/);
    expect(unknown.lines[0].priced).toBe(false);
    expect(unknown.monthly).toBeUndefined();
  });
});

describe('sfCreateCommercialRequest', () => {
  it('saves a draft commercialRequest Quote with the estimated unit prices plus an intake row', () => {
    const before = { quotes: store().db.quotes.length, payments: store().db.payments.length };
    const result = store().sfCreateCommercialRequest({
      address: '1500 Commerce Way',
      lines: [line('cat_fl_4yd', 'weekly', 'trash', 2), line('cat_fl_3yd', '3x', 'cardboard'), line('cat_ro_30yd', 'onCall', 'construction debris')],
      businessType: 'Restaurant or food service',
      term: 'ongoing',
      startDate: '2026-09-21',
      extras: ['lock'],
      accessNotes: 'Gate opens at 6am',
      contact,
    });
    expect(result.quoteId).toMatch(/^quote_sf_\d{4}$/);
    expect(store().db.quotes).toHaveLength(before.quotes + 1);
    expect(store().db.payments).toHaveLength(before.payments);
    expect(view().quotes[result.quoteId]).toEqual({
      id: result.quoteId, kind: 'commercialRequest', address: '1500 Commerce Way, Suite B, Piedmont, GA 30512', zoneId: 'zone_open',
      lines: [
        { catalogId: 'cat_fl_4yd', qty: 2, frequency: 'weekly', priceCents: 18500 },
        { catalogId: 'cat_fl_3yd', qty: 1, frequency: '3x', priceCents: 0 },
        { catalogId: 'cat_ro_30yd', qty: 1, frequency: 'onCall', priceCents: 67500 },
      ],
      dueTodayCents: 0, recurringCents: 104500,
      status: 'draft', expiresAt: '2026-10-10T10:00:00-04:00', createdVia: 'storefront',
    });
    expect(store().quoteIntake[result.quoteId]).toEqual({
      quoteId: result.quoteId, contact, addressId: 'addr_commercial',
      material: 'trash, cardboard, construction debris', lineMaterials: ['trash', 'cardboard', 'construction debris'],
      businessType: 'Restaurant or food service', term: 'ongoing', startDate: '2026-09-21', extras: ['lock'],
      accessNotes: 'Gate opens at 6am', createdAt: now(),
    });
    expect(result.replyBy).toBe('2026-09-11');
    expect(result.estimate).toEqual({ monthlyCents: 42461, perHaulCents: 77281, deliveryCents: 2675, pricedLines: 2, totalLines: 3 });
    expect(store().sfUi.commercialReceipt).toEqual(result);
  });

  it('keeps an unmatched address as typed with the notserved zone and no price', () => {
    const result = store().sfCreateCommercialRequest({ address: '9 Unknown Pl', lines: [line('cat_fl_2yd', 'weekly')], accessNotes: '', contact: { name: 'A', email: 'a@example.com' } });
    expect(view().quotes[result.quoteId]).toMatchObject({ address: '9 Unknown Pl', zoneId: 'zone_notserved', recurringCents: 0, lines: [{ priceCents: 0 }] });
    expect(store().quoteIntake[result.quoteId].addressId).toBeUndefined();
    expect(result.estimate).toEqual({ pricedLines: 0, totalLines: 1 });
  });

  it('rejects a residential cart, a frequency the container does not take, a bad count, or no lines, and writes nothing', () => {
    const base = { address: 'Commerce', accessNotes: '', contact: { name: 'A', email: 'a@example.com' } };
    const before = JSON.stringify(store());
    expect(() => store().sfCreateCommercialRequest({ ...base, lines: [line('cat_res_96', 'weekly')] })).toThrow(/front load or rolloff/);
    expect(() => store().sfCreateCommercialRequest({ ...base, lines: [line('cat_ro_20yd', 'weekly')] })).toThrow(/frequency weekly/);
    expect(() => store().sfCreateCommercialRequest({ ...base, lines: [line('cat_fl_2yd', 'weekly', 'trash', 0)] })).toThrow(/quantity/);
    expect(() => store().sfCreateCommercialRequest({ ...base, lines: [] })).toThrow(/at least one/);
    expect(JSON.stringify(store())).toBe(before);
  });
});

describe('office answers a commercial request', () => {
  const bakery = () => view().quotes['quote_bakery_request'];

  it('prices and sends the seeded bakery request, then records acceptance on the existing account contract', () => {
    expect(() => store().sfAcceptCommercialQuote('quote_bakery_request', 'office')).toThrow(/Send the written price/)
    store().sfSendCommercialQuote('quote_bakery_request', [{ catalogId: 'cat_fl_3yd', qty: 1, frequency: '3x', priceCents: 26500 }], 'office')
    expect(bakery()).toMatchObject({ status: 'draft', recurringCents: 26500, lines: [{ catalogId: 'cat_fl_3yd', frequency: '3x', priceCents: 26500 }] })
    expect(store().quoteIntake['quote_bakery_request']).toMatchObject({ quotedBy: 'office' })
    const accountsBefore = store().db.accounts.length
    const r = store().sfAcceptCommercialQuote('quote_bakery_request', 'office')
    expect(r).toMatchObject({ accountId: 'acct_bakery', created: false, serviceItemIds: [], workOrderIds: [] })
    expect(store().db.accounts).toHaveLength(accountsBefore)
    expect(bakery().status).toBe('accepted')
    const contract = store().db.contracts.find(c => c.id === r.contractId)!
    expect(contract.accountId).toBe('acct_bakery')
    expect(contract.overrides[0]).toMatchObject({ catalogId: 'cat_fl_3yd', frequency: '3x', priceCents: 26500 })
    expect(store().quoteIntake['quote_bakery_request'].acceptedAccountId).toBe('acct_bakery')
  })

  it('sets up a new business account, service, delivery, and contract when a new customer accepts', () => {
    const { quoteId } = store().sfCreateCommercialRequest({
      address: '1500 Commerce Way', lines: [line('cat_fl_4yd', 'weekly', 'trash', 2), line('cat_ro_compactor_30yd', 'onCall')], accessNotes: 'Dock B',
      contact: { name: 'Lantern Hill Bistro', email: 'ops@lantern.example.com' },
    })
    expect(() => store().sfSendCommercialQuote(quoteId, [{ catalogId: 'cat_fl_4yd', qty: 2, frequency: 'weekly', priceCents: 0 }], 'office')).toThrow(/above \$0/)
    store().sfSendCommercialQuote(quoteId, [
      { catalogId: 'cat_fl_4yd', qty: 2, frequency: 'weekly', priceCents: 17500 },
      { catalogId: 'cat_ro_compactor_30yd', qty: 1, frequency: 'onCall', priceCents: 95000 },
    ], 'office')
    const r = store().sfAcceptCommercialQuote(quoteId, 'office')
    expect(r.created).toBe(true)
    const db = store().db
    const account = db.accounts.find(a => a.id === r.accountId)!
    expect(account).toMatchObject({ cycle: 'monthly', status: 'active', contractId: r.contractId })
    expect(db.parties.find(p => p.id === account.payerPartyId)).toMatchObject({ name: 'Lantern Hill Bistro', kind: 'business' })
    const site = db.sites.find(s => s.accountId === r.accountId)!
    expect(site).toMatchObject({ zoneId: 'zone_open', routeId: 'route_wed_fl', accessNotes: 'Dock B' })
    expect(db.serviceItems.filter(si => r.serviceItemIds.includes(si.id)).map(si => [si.catalogId, si.qty, si.frequency])).toEqual([['cat_fl_4yd', 2, 'weekly'], ['cat_ro_compactor_30yd', 1, 'onCall']])
    expect(db.containers.filter(c => c.siteId === site.id)).toHaveLength(3)
    expect(db.workOrders.filter(w => r.workOrderIds.includes(w.id)).every(w => w.kind === 'deliver' && w.status === 'open')).toBe(true)
    const contract = db.contracts.find(c => c.id === r.contractId)!
    expect(contract.overrides.map(o => [o.catalogId, o.priceCents])).toEqual(expect.arrayContaining([['cat_fl_4yd', 17500], ['cat_ro_compactor_30yd', 95000]]))
    expect(view().quotes[quoteId].status).toBe('accepted')
  })

  it('declines an open request with a reason, before or after the price is sent', () => {
    store().sfDeclineHeldQuote('quote_bakery_request', 'Outside our commercial routes')
    expect(bakery().status).toBe('declined')
    expect(store().quoteIntake['quote_bakery_request'].declineReason).toBe('Outside our commercial routes')
    expect(() => store().sfSendCommercialQuote('quote_bakery_request', [{ catalogId: 'cat_fl_3yd', qty: 1, frequency: '3x', priceCents: 100 }], 'office')).toThrow(/only an open request/)
  })
})
