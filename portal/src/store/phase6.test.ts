// Phase 6 edge state: a suspended account signed in to the portal gets the handoff on extra pickup, with an open
// Request and no Charge, Payment, or WorkOrder, so invariant 4 still holds.

import { beforeEach, describe, expect, it } from 'vitest';
import { createPortalStore } from './useStore';
import { bindTables } from './engine';
import { extraPickupEligibility } from './selectors';
import { resetIds } from './ids';
import { TODAY } from './clock';
import { handoff, handoffSentence } from '../lib/handoff';
import { checkSuspendedNoMoney } from '../lib/invariants';

let store: ReturnType<typeof createPortalStore>;

beforeEach(() => {
  resetIds();
  store = createPortalStore();
  bindTables(() => store.getState());
});

describe('suspended account session (acct_res_kerr)', () => {
  it('shows the handoff on extra pickup and moves no money', () => {
    store.getState().switchAccount('acct_res_kerr');
    const { accountId, siteId } = store.getState().session;
    expect(accountId).toBe('acct_res_kerr');
    expect(siteId).toBe('site_kerr');

    const e = extraPickupEligibility(store.getState(), accountId, siteId, TODAY);
    expect(e.ok).toBe(false);
    expect(e.reason).toBe('Account is suspended');

    // What the HandoffCard shows and files for the failed flow.
    const h = handoff(e.reason!);
    expect(handoffSentence(h)).toMatch(/We could not finish this automatically\. Reason: Account is suspended\. A person will follow up by Friday, Sep 11/);
    const before = { charges: store.getState().charges.length, payments: store.getState().payments.length, workOrders: store.getState().workOrders.length };
    const req = store.getState().addRequest({ accountId, siteId, kind: 'extraPickup', status: 'open', createdVia: 'portal', note: h.reason });
    expect(req).toMatchObject({ kind: 'extraPickup', status: 'open', note: 'Account is suspended' });

    const after = store.getState();
    expect([after.charges.length, after.payments.length, after.workOrders.length]).toEqual([before.charges, before.payments, before.workOrders]);
    expect(checkSuspendedNoMoney(after).pass).toBe(true);
  });
});
