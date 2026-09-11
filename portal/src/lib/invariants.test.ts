import { beforeEach, describe, expect, it } from 'vitest';
import { createPortalStore } from '../store/useStore';
import { bindTables } from '../store/engine';
import { resetIds } from '../store/ids';
import { seed } from '../seed';
import { checkChargeShape, checkManyToMany, checkSuspendedNoMoney, checkWaivedKept, runInvariants } from './invariants';

let store: ReturnType<typeof createPortalStore>;

beforeEach(() => {
  resetIds();
  store = createPortalStore();
  bindTables(() => store.getState());
});

describe('invariants on seed data', () => {
  it('all pass', () => {
    const results = runInvariants(store.getState() as never, seed.waived);
    expect(results.map((r) => [r.number, r.pass])).toEqual([[2, true], [4, true], [5, true], [6, true]]);
  });

  it('pay_chk_oakridge splits across three invoices', () => {
    expect(checkManyToMany(store.getState()).detail).toContain('3 allocations across 3 invoices');
  });
});

describe('invariants catch violations', () => {
  it('fails a charge with no ruleWon or unbalanced math', () => {
    const [c] = store.getState().charges;
    store.setState({ charges: [{ ...c, pricing: {} as never }, ...store.getState().charges.slice(1)] });
    expect(checkChargeShape(store.getState()).pass).toBe(false);
    store.setState({ charges: [{ ...c, totalCents: c.totalCents + 1 }] });
    expect(checkChargeShape(store.getState()).pass).toBe(false);
  });

  it('fails when a suspended account has a payment', () => {
    const [p] = store.getState().payments;
    store.setState({ payments: [...store.getState().payments, { ...p, id: 'pay_bad', accountId: 'acct_res_kerr' }] });
    expect(checkSuspendedNoMoney(store.getState())).toMatchObject({ pass: false });
  });

  it('fails when the store exposes a delete method or a seeded waived row goes missing', () => {
    const s = store.getState() as never as Record<string, unknown>;
    expect(checkWaivedKept({ ...(s as object), deleteWaived: () => undefined } as never, []).pass).toBe(false);
    const row = { chargeId: 'ch_x', reason: 'goodwill' as const, by: 'office', at: '2026-09-01T00:00:00' };
    expect(checkWaivedKept(store.getState() as never, [row]).pass).toBe(false);
  });
});
