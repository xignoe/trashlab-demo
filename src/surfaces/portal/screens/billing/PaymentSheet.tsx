// Pay now. Amount defaults to the open balance and can only go down to $1.00 (100 cents), never above the
// open balance. Method is the saved method on file or a fresh token from the hosted field stub. Confirming
// writes one Payment plus its allocations through the store, then the sheet becomes the receipt.

import { useMemo, useState } from 'react';
import { portalState, usePortal } from '../../store';
import { invoiceOpenBalance } from '../../lib/selectors';
import { formatDate, formatDateTime } from '../../lib/clock';
import { money } from '../../lib/money';
import { Drawer } from '../../components/Drawer';
import { AccountStatusPill } from '../../components/StatusPill';
import { HostedField } from './HostedField';
import type { PaymentToken } from '../../lib/paymentToken';
import type { Invoice, Payment, PaymentAllocation } from '../../../../types';

export const MIN_PAYMENT_CENTS = 100;

/** Parse a dollars string like "87.45" into cents, or undefined when it is not a money amount. */
export function parseDollars(text: string): number | undefined {
  const t = text.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return undefined;
  const [whole, frac = ''] = t.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}

/** Keep the amount inside [MIN_PAYMENT_CENTS, open]; an open balance below the minimum can only be paid in full. */
export function clampPayment(cents: number, open: number): number {
  const floor = Math.min(MIN_PAYMENT_CENTS, open);
  return Math.max(floor, Math.min(open, cents));
}

type Receipt = { payment: Payment; allocations: PaymentAllocation[] };

export function PaymentSheet({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const state = usePortal();
  const open = invoiceOpenBalance(state, invoice.id);
  const saved = state.paymentMethods.find((m) => m.accountId === invoice.accountId);
  const [amountText, setAmountText] = useState((open / 100).toFixed(2));
  const [useSaved, setUseSaved] = useState(Boolean(saved));
  const [token, setToken] = useState<PaymentToken | null>(null);
  const [saveToken, setSaveToken] = useState(true);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseDollars(amountText);
  const amountError = useMemo(() => {
    if (parsed === undefined) return 'Enter an amount in dollars and cents';
    if (parsed > open) return `Cannot exceed the open balance of ${money(open)}`;
    if (parsed < Math.min(MIN_PAYMENT_CENTS, open)) return `Minimum payment is ${money(Math.min(MIN_PAYMENT_CENTS, open))}`;
    return null;
  }, [parsed, open]);

  const method = useSaved ? saved?.kind : token?.kind;
  const methodLabel = useSaved && saved ? `${saved.brand} ending in ${saved.last4}` : token ? `${token.brand} ending in ${token.last4}` : null;
  const ready = !amountError && method !== undefined && parsed !== undefined;

  const confirm = () => {
    if (!ready || parsed === undefined || method === undefined) return;
    try {
      if (!useSaved && token && saveToken) {
        state.savePaymentMethod({ accountId: invoice.accountId, kind: token.kind, last4: token.last4, tokenId: token.tokenId, brand: token.brand });
      }
      const result = state.recordPayment({ accountId: invoice.accountId, method, invoiceIds: [invoice.id], cents: [parsed] });
      setReceipt(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (receipt) {
    const live = portalState();
    const account = live.accounts.find((a) => a.id === invoice.accountId)!;
    return (
      <Drawer title="Payment received" eyebrow="Receipt" onClose={onClose}>
        <div className="tl-card flex flex-col gap-2" style={{ background: 'var(--color-ok-soft)', borderColor: 'transparent' }}>
          <div className="text-xl font-semibold tl-money" style={{ color: 'var(--color-ok)' }}>{money(receipt.payment.cents)}</div>
          <div className="text-sm text-ink-2">Paid with {methodLabel} on {formatDateTime(receipt.payment.receivedAt)}</div>
        </div>
        <dl className="text-sm grid gap-1" style={{ gridTemplateColumns: 'auto 1fr' }}>
          <dt className="text-ink-3">Payment id</dt><dd className="font-mono text-xs">{receipt.payment.id}</dd>
          <dt className="text-ink-3">Method</dt><dd>{receipt.payment.method}, {methodLabel}</dd>
          <dt className="text-ink-3">Status</dt><dd>{receipt.payment.status}</dd>
          <dt className="text-ink-3">Account status</dt><dd><AccountStatusPill status={account.status} /></dd>
        </dl>
        <div>
          <div className="tl-label">Applied to</div>
          <table className="tl-table">
            <thead><tr><th>Invoice</th><th className="num">Applied</th><th className="num">Still open</th></tr></thead>
            <tbody>
              {receipt.allocations.map((a) => {
                const inv = live.invoices.find((i) => i.id === a.invoiceId)!;
                return (
                  <tr key={a.invoiceId}>
                    <td>{inv.number}</td>
                    <td className="num tl-money">{money(a.cents)}</td>
                    <td className="num tl-money">{money(invoiceOpenBalance(live, inv.id))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button type="button" className="tl-button" onClick={onClose}>Done</button>
      </Drawer>
    );
  }

  return (
    <Drawer title={`Pay invoice ${invoice.number}`} eyebrow="Pay now" onClose={onClose}>
      <div className="tl-card text-sm flex flex-col gap-1" style={{ background: 'var(--color-surface-2)' }}>
        <div className="flex justify-between"><span className="text-ink-3">Invoice total</span><span className="tl-money">{money(invoice.totalCents)}</span></div>
        <div className="flex justify-between"><span className="text-ink-3">Already paid</span><span className="tl-money">{money(invoice.totalCents - open)}</span></div>
        <div className="flex justify-between font-semibold"><span>Open balance</span><span className="tl-money">{money(open)}</span></div>
        <div className="text-xs text-ink-3">Due {formatDate(invoice.dueAt)}</div>
      </div>

      <div>
        <label className="tl-label" htmlFor="pay-amount">Amount</label>
        <div className="flex items-center gap-2">
          <span className="text-ink-3">$</span>
          <input
            id="pay-amount"
            className="tl-field tl-money"
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            onBlur={() => {
              if (parsed !== undefined) setAmountText((clampPayment(parsed, open) / 100).toFixed(2));
            }}
            aria-invalid={Boolean(amountError)}
            aria-describedby="pay-amount-help"
          />
          <button type="button" className="tl-button tl-button--ghost whitespace-nowrap" style={{ height: 32 }} onClick={() => setAmountText((open / 100).toFixed(2))}>
            Full balance
          </button>
        </div>
        <div id="pay-amount-help" className="text-xs mt-1" style={{ color: amountError ? 'var(--color-danger)' : 'var(--color-ink-3)' }}>
          {amountError ?? `Any amount from ${money(Math.min(MIN_PAYMENT_CENTS, open))} up to the open balance`}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="tl-label">Pay with</span>
        {saved && (
          <label className="tl-card flex items-center gap-3 cursor-pointer" style={{ borderColor: useSaved ? 'var(--color-accent)' : undefined }}>
            <input type="radio" name="pay-method" checked={useSaved} onChange={() => setUseSaved(true)} />
            <div className="flex-1">
              <div className="text-sm font-medium">{saved.brand} ending in {saved.last4}</div>
              <div className="text-xs text-ink-3">Saved {saved.kind === 'card' ? 'card' : 'bank account'} on file</div>
            </div>
            <span className="tl-pill tl-pill--ok">On file</span>
          </label>
        )}
        <label className="tl-card flex items-center gap-3 cursor-pointer" style={{ borderColor: !useSaved ? 'var(--color-accent)' : undefined }}>
          <input type="radio" name="pay-method" checked={!useSaved} onChange={() => setUseSaved(false)} />
          <div className="text-sm font-medium">{saved ? 'Use a different method' : 'Add a payment method'}</div>
        </label>
        {!useSaved && (
          <>
            <HostedField token={token} onToken={setToken} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={saveToken} onChange={(e) => setSaveToken(e.target.checked)} />
              Save this as my method on file
            </label>
          </>
        )}
      </div>

      {error && <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>}

      <div className="flex gap-2 justify-end">
        <button type="button" className="tl-button tl-button--secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="tl-button" disabled={!ready} onClick={confirm}>
          Pay {parsed !== undefined && !amountError ? money(parsed) : ''}
        </button>
      </div>
      <p className="text-xs text-ink-3">
        Payments settle immediately in this portal and are applied to this invoice only. We never see your card or bank numbers; the processor holds them and gives us a token.
      </p>
    </Drawer>
  );
}
