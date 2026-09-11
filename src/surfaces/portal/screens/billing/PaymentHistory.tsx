// Every payment on the account, newest first, with an expandable allocation list.

import { useState } from 'react';
import { usePortal } from '../../store';
import { allocationsForPayment, batchForPayment, paymentsForAccount } from '../../lib/selectors';
import { formatDate, formatDateTime } from '../../lib/clock';
import { money } from '../../lib/money';
import type { Payment } from '../../../../types';

const METHOD_LABEL: Record<Payment['method'], string> = {
  check: 'Check', card: 'Card', ach: 'Bank (ACH)', autopay: 'Autopay', cash: 'Cash',
};

const STATUS_CLASS: Record<Payment['status'], string> = {
  settled: 'tl-pill tl-pill--ok', pending: 'tl-pill tl-pill--warn', returned: 'tl-pill tl-pill--danger',
};

export function PaymentHistory({ accountId }: { accountId: string }) {
  const state = usePortal();
  const payments = paymentsForAccount(state, accountId);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <section className="tl-panel">
      <h2 className="text-lg font-medium mb-3">Payment history</h2>
      {payments.length === 0 ? (
        <p className="text-sm text-ink-3">No payments on this account yet.</p>
      ) : (
        <table className="tl-table">
          <thead>
            <tr>
              <th>Received</th>
              <th>Method</th>
              <th className="num">Amount</th>
              <th>Status</th>
              <th>Processor batch</th>
              <th>Applied to</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => {
              const allocs = allocationsForPayment(state, p.id);
              const batch = batchForPayment(state, p.id);
              const expanded = openId === p.id;
              const applied = allocs.reduce((s, a) => s + a.cents, 0);
              return [
                <tr key={p.id}>
                  <td className="whitespace-nowrap">
                    <div>{formatDateTime(p.receivedAt)}</div>
                    <div className="font-mono text-xs text-ink-3">{p.id}</div>
                  </td>
                  <td>{METHOD_LABEL[p.method]}</td>
                  <td className="num tl-money font-medium">{money(p.cents)}</td>
                  <td><span className={STATUS_CLASS[p.status]}>{p.status}</span></td>
                  <td>
                    {batch ? (
                      <div>
                        <div className="font-mono text-xs">{batch.id}</div>
                        <div className="text-xs text-ink-3">deposited {formatDate(batch.depositedAt)}</div>
                      </div>
                    ) : p.processorBatchId ? (
                      <span className="font-mono text-xs">{p.processorBatchId}</span>
                    ) : (
                      <span className="text-xs text-ink-3">none</span>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="tl-button tl-button--ghost"
                      style={{ height: 28, padding: '0 8px' }}
                      aria-expanded={expanded}
                      onClick={() => setOpenId(expanded ? null : p.id)}
                    >
                      {allocs.length} invoice{allocs.length === 1 ? '' : 's'} {expanded ? '(hide)' : '(show)'}
                    </button>
                  </td>
                </tr>,
                expanded && (
                  <tr key={`${p.id}-alloc`}>
                    <td colSpan={6} style={{ background: 'var(--color-surface-2)' }}>
                      {allocs.length === 0 ? (
                        <span className="text-sm text-ink-3">Not yet applied to an invoice.</span>
                      ) : (
                        <div className="flex flex-col gap-1 text-sm py-1">
                          {allocs.map((a) => {
                            const inv = state.invoices.find((i) => i.id === a.invoiceId);
                            return (
                              <div key={a.invoiceId} className="flex items-baseline gap-3">
                                <span className="w-32">{inv?.number ?? a.invoiceId}</span>
                                <span className="text-xs text-ink-3 flex-1">
                                  {inv ? `issued ${formatDate(inv.issuedAt)}, due ${formatDate(inv.dueAt)}` : ''}
                                </span>
                                <span className="tl-money">{money(a.cents)}</span>
                              </div>
                            );
                          })}
                          <div className="flex items-baseline gap-3 border-t border-border pt-1 font-medium">
                            <span className="flex-1">
                              {allocs.length > 1 ? `One ${METHOD_LABEL[p.method].toLowerCase()} split across ${allocs.length} invoices` : 'Applied'}
                            </span>
                            <span className="tl-money">{money(applied)}</span>
                          </div>
                          {applied !== p.cents && (
                            <div className="text-xs text-ink-3">{money(p.cents - applied)} of this payment is not yet applied.</div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
