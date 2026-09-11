// Phase 3: pay flow, autopay toggle, saved methods, and the billing selectors.

import { beforeEach, describe, expect, it } from 'vitest';
import { createPortalStore } from './useStore';
import { bindTables } from './engine';
import {
  accountBalance, allocationsForPayment, invoiceOpenBalance, invoiceStatus, invoicesForAccount, nextDueOpenInvoice,
  paymentsForAccount,
} from './selectors';
import { resetIds } from './ids';
import { TODAY } from './clock';
import { tokenizeMockMethod } from '../lib/paymentToken';
import { clampPayment, parseDollars, MIN_PAYMENT_CENTS } from '../screens/billing/PaymentSheet';

let store: ReturnType<typeof createPortalStore>;

beforeEach(() => {
  resetIds();
  store = createPortalStore();
  bindTables(() => store.getState());
});

describe('pay now', () => {
  it('payment plus allocation clears the open balance and flips Maple from pastDue to active', () => {
    const s = store.getState();
    expect(s.accounts.find((a) => a.id === 'acct_res_maple')!.status).toBe('pastDue');
    expect(invoiceOpenBalance(s, 'inv_maple_2026q3')).toBe(8745);
    expect(invoiceStatus(s, 'inv_maple_2026q3', TODAY)).toBe('pastDue');

    const { payment, allocations } = s.recordPayment({
      accountId: 'acct_res_maple', method: 'card', invoiceIds: ['inv_maple_2026q3'], cents: [8745],
    });

    const after = store.getState();
    expect(payment.id).toBe('pay_p0001');
    expect(payment.status).toBe('settled');
    expect(payment.cents).toBe(8745);
    expect(payment.receivedAt.startsWith(`${TODAY}T`)).toBe(true);
    expect(allocations).toEqual([{ sourceType: 'payment', sourceId: 'pay_p0001', invoiceId: 'inv_maple_2026q3', cents: 8745 }]);
    expect(allocationsForPayment(after, 'pay_p0001')).toEqual(allocations);
    expect(invoiceOpenBalance(after, 'inv_maple_2026q3')).toBe(0);
    expect(invoiceStatus(after, 'inv_maple_2026q3', TODAY)).toBe('paid');
    expect(accountBalance(after, 'acct_res_maple')).toBe(0);
    expect(after.accounts.find((a) => a.id === 'acct_res_maple')!.status).toBe('active');
    expect(after.log.map((l) => l.action)).toEqual(['addPayment', 'addAllocations', 'accountStatus:pastDue->active']);
  });

  it('a partial payment lowers the open balance but leaves the account past due', () => {
    const s = store.getState();
    s.recordPayment({ accountId: 'acct_res_maple', method: 'card', invoiceIds: ['inv_maple_2026q3'], cents: [5000] });
    const after = store.getState();
    expect(invoiceOpenBalance(after, 'inv_maple_2026q3')).toBe(3745);
    expect(invoiceStatus(after, 'inv_maple_2026q3', TODAY)).toBe('pastDue');
    expect(after.accounts.find((a) => a.id === 'acct_res_maple')!.status).toBe('pastDue');
    expect(after.log.map((l) => l.action)).toEqual(['addPayment', 'addAllocations']);
  });

  it('refuses to pay more than the open balance and writes nothing', () => {
    const s = store.getState();
    expect(() => s.recordPayment({ accountId: 'acct_res_maple', method: 'card', invoiceIds: ['inv_maple_2026q3'], cents: [8746] })).toThrow(/exceeds/);
    expect(store.getState().payments.length).toBe(s.payments.length);
    expect(store.getState().log).toEqual([]);
  });

  it('refuses an invoice on another account', () => {
    const s = store.getState();
    expect(() => s.recordPayment({ accountId: 'acct_res_maple', method: 'card', invoiceIds: ['inv_oak_2026_09'], cents: [100] })).toThrow(/not on account/);
  });

  it('Oakridge stays active after paying its open invoice, and the payment shows in history newest first', () => {
    const s = store.getState();
    s.recordPayment({ accountId: 'acct_pm_oakridge', method: 'ach', invoiceIds: ['inv_oak_2026_09'], cents: [91992] });
    const after = store.getState();
    expect(accountBalance(after, 'acct_pm_oakridge')).toBe(0);
    expect(after.accounts.find((a) => a.id === 'acct_pm_oakridge')!.status).toBe('active');
    const history = paymentsForAccount(after, 'acct_pm_oakridge');
    expect(history[0].id).toBe('pay_p0001');
    expect(history[1].id).toBe('pay_chk_oakridge');
    expect(allocationsForPayment(after, 'pay_chk_oakridge').map((a) => a.invoiceId)).toEqual([
      'inv_oak_2026_06', 'inv_oak_2026_07', 'inv_oak_2026_08',
    ]);
  });

  it('amount parsing and clamping stay inside 100 cents and the open balance', () => {
    expect(parseDollars('87.45')).toBe(8745);
    expect(parseDollars('$1,000')).toBe(100000);
    expect(parseDollars('12.5')).toBe(1250);
    expect(parseDollars('abc')).toBeUndefined();
    expect(parseDollars('-5')).toBeUndefined();
    expect(clampPayment(5, 8745)).toBe(MIN_PAYMENT_CENTS);
    expect(clampPayment(99999, 8745)).toBe(8745);
    expect(clampPayment(4000, 8745)).toBe(4000);
    expect(clampPayment(1, 48)).toBe(48);
  });
});

describe('autopay', () => {
  it('turning on and off writes BillingAccount.autopay and logs each change', () => {
    const s = store.getState();
    expect(s.accounts.find((a) => a.id === 'acct_res_maple')!.autopay).toBe(false);
    s.setAutopay('acct_res_maple', true);
    expect(store.getState().accounts.find((a) => a.id === 'acct_res_maple')!.autopay).toBe(true);
    store.getState().setAutopay('acct_res_maple', false);
    expect(store.getState().accounts.find((a) => a.id === 'acct_res_maple')!.autopay).toBe(false);
    expect(store.getState().log.map((l) => l.action)).toEqual(['setAutopay:on', 'setAutopay:off']);
    expect(store.getState().log[0].ids).toEqual(['acct_res_maple']);
  });

  it('with autopay off the next manual due date is the earliest open invoice', () => {
    expect(nextDueOpenInvoice(store.getState(), 'acct_res_maple')?.id).toBe('inv_maple_2026q3');
    expect(nextDueOpenInvoice(store.getState(), 'acct_pm_oakridge')?.dueAt).toBe('2026-10-01');
    store.getState().recordPayment({ accountId: 'acct_pm_oakridge', method: 'ach', invoiceIds: ['inv_oak_2026_09'], cents: [91992] });
    expect(nextDueOpenInvoice(store.getState(), 'acct_pm_oakridge')).toBeUndefined();
  });
});

describe('saved payment methods', () => {
  it('seeds a last four for the accounts with a method on file', () => {
    const s = store.getState();
    expect(s.paymentMethods.find((m) => m.accountId === 'acct_res_maple')).toMatchObject({ kind: 'card', last4: '4242' });
    expect(s.paymentMethods.find((m) => m.accountId === 'acct_pm_oakridge')).toMatchObject({ kind: 'ach', last4: '6710' });
    for (const m of s.paymentMethods) {
      const account = s.accounts.find((a) => a.id === m.accountId)!;
      expect(account.paymentMethodOnFile).toBe(m.kind);
    }
  });

  it('the mock tokenizer returns only a token id and a last four', () => {
    const t = tokenizeMockMethod('card');
    expect(t.tokenId).toMatch(/^tok_/);
    expect(t.last4).toMatch(/^\d{4}$/);
    expect(Object.keys(t).sort()).toEqual(['brand', 'kind', 'last4', 'tokenId']);
  });

  it('saving a method replaces the row and keeps paymentMethodOnFile in step', () => {
    const s = store.getState();
    const t = tokenizeMockMethod('ach');
    s.savePaymentMethod({ accountId: 'acct_res_maple', kind: t.kind, last4: t.last4, tokenId: t.tokenId, brand: t.brand });
    const after = store.getState();
    const rows = after.paymentMethods.filter((m) => m.accountId === 'acct_res_maple');
    expect(rows.length).toBe(1);
    expect(rows[0].tokenId).toBe(t.tokenId);
    expect(after.accounts.find((a) => a.id === 'acct_res_maple')!.paymentMethodOnFile).toBe('ach');
    expect(after.log[0].action).toBe('savePaymentMethod');
  });

  it('refuses anything that is not a processor token', () => {
    const s = store.getState();
    expect(() => s.savePaymentMethod({ accountId: 'acct_res_maple', kind: 'card', last4: '4242', tokenId: '4111111111111111', brand: 'Visa' })).toThrow(/token/);
    expect(() => s.savePaymentMethod({ accountId: 'acct_res_maple', kind: 'card', last4: '41111', tokenId: 'tok_x', brand: 'Visa' })).toThrow(/four digits/);
  });
});

describe('billing selectors', () => {
  it('lists invoices newest first with the right statuses', () => {
    const s = store.getState();
    expect(invoicesForAccount(s, 'acct_res_maple').map((i) => i.id)).toEqual(['inv_maple_2026q3', 'inv_maple_2026q2']);
    expect(invoiceStatus(s, 'inv_maple_2026q2', TODAY)).toBe('paid');
    expect(invoicesForAccount(s, 'acct_pm_oakridge').map((i) => i.id)).toEqual([
      'inv_oak_2026_09', 'inv_oak_2026_08', 'inv_oak_2026_07', 'inv_oak_2026_06',
    ]);
    expect(invoiceStatus(s, 'inv_oak_2026_09', TODAY)).toBe('open');
    expect(invoiceStatus(s, 'inv_oak_2026_08', TODAY)).toBe('paid');
  });

  it('every seeded invoice total reconciles to the sum of its lines', () => {
    const s = store.getState();
    for (const inv of s.invoices) {
      const lines = inv.chargeIds.map((id) => s.charges.find((c) => c.id === id)!);
      expect(lines.reduce((t, c) => t + c.totalCents, 0)).toBe(inv.totalCents);
      expect(lines.reduce((t, c) => t + c.baseCents, 0)).toBe(inv.subtotalCents);
      expect(lines.reduce((t, c) => t + c.fees.reduce((f, x) => f + x.cents, 0), 0)).toBe(inv.feeCents);
      expect(lines.reduce((t, c) => t + c.taxCents, 0)).toBe(inv.taxCents);
    }
  });
});
