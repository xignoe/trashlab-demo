import { beforeEach, describe, expect, it } from 'vitest';
import { createPortalStore } from './useStore';
import { allocate, bindTables } from './engine';
import { accountBalance, invoiceOpenBalance, routeCapacityOn, eventForSiteOn } from './selectors';
import { resetIds } from './ids';

let store: ReturnType<typeof createPortalStore>;

beforeEach(() => {
  resetIds();
  store = createPortalStore();
  bindTables(() => store.getState());
});

describe('session', () => {
  it('starts signed in as Maple on site_maple', () => {
    expect(store.getState().session).toEqual({ accountId: 'acct_res_maple', siteId: 'site_maple' });
  });

  it('switching accounts resets the site to that account\'s first site', () => {
    store.getState().switchAccount('acct_pm_oakridge');
    expect(store.getState().session).toEqual({ accountId: 'acct_pm_oakridge', siteId: 'site_oak_1' });
    store.getState().setSite('site_oak_3');
    expect(store.getState().session.siteId).toBe('site_oak_3');
    store.getState().switchAccount('acct_res_maple');
    expect(store.getState().session.siteId).toBe('site_maple');
  });

  it('refuses a site that belongs to another account', () => {
    expect(() => store.getState().setSite('site_oak_1')).toThrow(/not on the signed-in account/);
  });
});

describe('locked and posted rows', () => {
  it('updateInvoice on a locked invoice throws', () => {
    expect(() => store.getState().updateInvoice('inv_maple_2026q3', { dueAt: '2026-12-01' })).toThrow(/locked/);
    expect(store.getState().invoices.find((i) => i.id === 'inv_maple_2026q3')!.dueAt).toBe('2026-07-15');
  });

  it('updateCharge on a posted charge throws', () => {
    expect(() => store.getState().updateCharge('chg_maple_q3_96', { baseCents: 1 })).toThrow(/posted/);
  });

  it('addCharge refuses a posted charge', () => {
    const c = { ...store.getState().charges[0], id: 'chg_x', status: 'posted' as const };
    expect(() => store.getState().addCharge(c)).toThrow(/posting is an office action/);
  });
});

describe('mutations log', () => {
  it('every mutation appends to the log with ids', () => {
    const s = store.getState();
    const req = s.addRequest({
      accountId: 'acct_res_maple', siteId: 'site_maple', kind: 'extraPickup', status: 'open', createdVia: 'portal', note: 'test',
    });
    const wo = s.addWorkOrder({ siteId: 'site_maple', kind: 'extraPickup', status: 'scheduled', scheduledFor: '2026-09-14', requestId: req.id });
    s.updateRequest(req.id, { status: 'scheduled', workOrderId: wo.id });
    const pay = s.addPayment({ accountId: 'acct_res_maple', method: 'card', cents: 8745, receivedAt: '2026-09-10T12:00:00', status: 'settled' });
    s.addAllocations(allocate({ sourceType: 'payment', sourceId: pay.id, invoiceIds: ['inv_maple_2026q3'], cents: [8745] }));
    s.setAutopay('acct_res_maple', true);
    s.setPaymentMethod('acct_res_maple', 'ach');
    s.updateServiceItem('si_maple_96', { effectiveTo: '2026-09-30' });
    s.addServiceItem({ siteId: 'site_maple', catalogId: 'cat_res_64', qty: 1, frequency: 'weekly', containerIds: [], effectiveFrom: '2026-10-01', status: 'active' });
    s.addQuote({
      kind: 'commercialRequest', address: '100 Oakridge Commons', lines: [], dueTodayCents: 0, recurringCents: 0,
      status: 'draft', expiresAt: '2026-10-10', createdVia: 'agent',
    });

    const actions = store.getState().log.map((l) => l.action);
    expect(actions).toEqual([
      'addRequest', 'addWorkOrder', 'updateRequest', 'addPayment', 'addAllocations', 'setAutopay:on',
      'setPaymentMethod', 'updateServiceItem', 'addServiceItem', 'addQuote',
    ]);
    expect(store.getState().log[0].ids).toEqual([req.id]);
    expect(store.getState().log[0].at.startsWith('2026-09-10T')).toBe(true);
    expect(req.id).toBe('req_p0001');
    expect(wo.id).toBe('wo_p0001');
  });

  it('a payment allocation updates the open balance the engine and selectors see', () => {
    const s = store.getState();
    expect(invoiceOpenBalance(store.getState(), 'inv_maple_2026q3')).toBe(8745);
    const pay = s.addPayment({ accountId: 'acct_res_maple', method: 'card', cents: 8745, receivedAt: '2026-09-10T12:00:00', status: 'settled' });
    s.addAllocations(allocate({ sourceType: 'payment', sourceId: pay.id, invoiceIds: ['inv_maple_2026q3'], cents: [8745] }));
    expect(invoiceOpenBalance(store.getState(), 'inv_maple_2026q3')).toBe(0);
    expect(accountBalance(store.getState(), 'acct_res_maple')).toBe(0);
    expect(() => allocate({ sourceType: 'payment', sourceId: 'again', invoiceIds: ['inv_maple_2026q3'], cents: [1] })).toThrow(/exceeds/);
  });

  it('store mutations never touch the imported seed', () => {
    store.getState().setAutopay('acct_res_maple', true);
    const other = createPortalStore();
    expect(other.getState().accounts.find((a) => a.id === 'acct_res_maple')!.autopay).toBe(false);
  });
});

describe('selectors', () => {
  it('account balances match the seed derivations', () => {
    expect(accountBalance(store.getState(), 'acct_res_maple')).toBe(8745);
    expect(accountBalance(store.getState(), 'acct_pm_oakridge')).toBe(91992);
  });

  it('route capacity subtracts scheduled extra pickups on that date', () => {
    expect(routeCapacityOn(store.getState(), 'route_mon_res', '2026-09-14')).toBe(8);
    store.getState().addWorkOrder({ siteId: 'site_maple', kind: 'extraPickup', status: 'scheduled', scheduledFor: '2026-09-14' });
    expect(routeCapacityOn(store.getState(), 'route_mon_res', '2026-09-14')).toBe(7);
    expect(routeCapacityOn(store.getState(), 'route_mon_res', '2026-09-21')).toBe(8);
  });

  it('eventForSiteOn matches on the calendar day of a timestamped event', () => {
    expect(eventForSiteOn(store.getState(), 'site_maple', '2026-09-07')?.outcome).toBe('blocked');
    expect(eventForSiteOn(store.getState(), 'site_maple', '2026-09-08')).toBeUndefined();
  });
});
