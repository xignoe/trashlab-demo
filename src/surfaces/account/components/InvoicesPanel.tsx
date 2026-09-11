// Invoices with open balances and past due flags; payments and credit memos beneath with their allocations.
import { useState } from 'react';
import type { AccountView } from '../selectors';
import type { PaymentAllocation } from '../../../types';
import { METHOD_LABEL, capitalize, creditReasonText, fmtDate, money, plural } from './format';

export function InvoicesPanel({
  view,
  onAllocate,
  onCredit,
}: {
  view: AccountView;
  /** Opens the Take a payment drawer on an unapplied payment or credit memo. */
  onAllocate?: (source: { sourceType: PaymentAllocation['sourceType']; sourceId: string }) => void;
  /** Opens Issue credit with this invoice preselected. */
  onCredit?: (invoiceId: string) => void;
}) {
  const [showPaid, setShowPaid] = useState(false);
  const paid = view.invoices.filter((v) => v.openCents <= 0);
  const rows = showPaid ? view.invoices : view.openInvoices;
  const openTotal = view.openInvoices.reduce((s, v) => s + v.openCents, 0);

  return (
    <section className="panel" aria-label="Invoices">
      <div className="card-head">
        <h2 className="card-title">Invoices</h2>
        <span className="card-note">{view.openInvoices.length ? `${plural(view.openInvoices.length, 'open invoice')}, ${money(openTotal)} open` : 'nothing open'}</span>
      </div>
      <div className="table-wrap">
        <table className="table table-dense">
          <thead>
            <tr>
              <th>Number</th>
              <th>Issued</th>
              <th>Due</th>
              <th className="money">Total</th>
              <th className="money">Paid</th>
              <th className="money">Open</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">{view.invoices.length ? 'No open invoices' : 'No invoices yet'}</td>
              </tr>
            )}
            {rows.map(({ invoice, openCents, paidCents, isPastDue, daysLate }) => (
              <tr key={invoice.id}>
                <td>
                  <span className="mono">{invoice.number}</span>
                  <div className="meta">{invoice.chargeIds.length} {invoice.chargeIds.length === 1 ? 'line' : 'lines'}, by {invoice.deliveredVia}</div>
                </td>
                <td className="nowrap">{fmtDate(invoice.issuedAt)}</td>
                <td className="nowrap">{fmtDate(invoice.dueAt)}</td>
                <td className="money">{money(invoice.totalCents)}</td>
                <td className="money">{money(paidCents)}</td>
                <td className={`money${openCents > 0 ? ' status-text' : ''}`}>{money(openCents)}</td>
                <td>
                  {isPastDue ? (
                    <span className="pill pill-danger">Past due {daysLate}d</span>
                  ) : openCents > 0 ? (
                    <span className="pill pill-info">Open</span>
                  ) : (
                    <span className="pill pill-ok">Paid</span>
                  )}
                  {openCents > 0 && onCredit && (
                    <div>
                      <button type="button" className="toggle" onClick={() => onCredit(invoice.id)} aria-label={`Issue credit against ${invoice.number}`}>
                        Credit
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={3}>{showPaid ? 'All invoices' : 'Open invoices'}</td>
                <td className="money">{money(rows.reduce((s, v) => s + v.invoice.totalCents, 0))}</td>
                <td className="money">{money(rows.reduce((s, v) => s + v.paidCents, 0))}</td>
                <td className="money">{money(rows.reduce((s, v) => s + v.openCents, 0))}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {paid.length > 0 && (
        <button type="button" className="toggle" onClick={() => setShowPaid((v) => !v)} aria-expanded={showPaid}>
          {showPaid ? 'Hide paid' : `Show paid (${paid.length})`}
        </button>
      )}

      <div className="stack">
        <div className="eyebrow">Payments</div>
        {view.payments.length === 0 ? (
          <div className="meta">No payments on record</div>
        ) : (
          <div className="table-wrap">
            <table className="table table-dense">
              <thead>
                <tr>
                  <th>Payment</th>
                  <th>Received</th>
                  <th>Method</th>
                  <th className="money">Amount</th>
                  <th>Applied to</th>
                  <th className="money">Unapplied</th>
                </tr>
              </thead>
              <tbody>
                {view.payments.map(({ payment: p, allocations, unappliedCents }) => (
                  <tr key={p.id}>
                    <td>
                      <code className="code">{p.id}</code>
                      <div className="meta">{capitalize(p.status)}{p.processorBatchId ? `, batch ${p.processorBatchId}` : ''}</div>
                    </td>
                    <td className="nowrap">{fmtDate(p.receivedAt)}</td>
                    <td>{capitalize(METHOD_LABEL[p.method])}</td>
                    <td className="money">{money(p.cents)}</td>
                    <td>
                      {allocations.length === 0 ? (
                        <span className="pill pill-warn">Not applied</span>
                      ) : (
                        <div className="stack" style={{ gap: 2 }}>
                          {allocations.map((a, i) => (
                            <span key={i} className="meta">
                              <span className="mono">{a.invoice?.number ?? a.invoiceId}</span> {money(a.cents)}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className={`money${unappliedCents > 0 ? ' status-text' : ''}`}>
                      {money(unappliedCents)}
                      {unappliedCents > 0 && p.status !== 'returned' && onAllocate && (
                        <div>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAllocate({ sourceType: 'payment', sourceId: p.id })}>
                            Allocate
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="stack">
        <div className="eyebrow">Credit memos</div>
        {view.creditMemos.length === 0 ? (
          <div className="meta">No credit memos</div>
        ) : (
          <div className="table-wrap">
            <table className="table table-dense">
              <thead>
                <tr>
                  <th>Credit</th>
                  <th>Date</th>
                  <th>Reason</th>
                  <th className="money">Amount</th>
                  <th>Applied to</th>
                  <th className="money">Unapplied</th>
                </tr>
              </thead>
              <tbody>
                {view.creditMemos.map(({ memo, allocations, unappliedCents }) => (
                  <tr key={memo.id}>
                    <td>
                      <code className="code">{memo.id}</code>
                      <div className="meta">by {memo.by}</div>
                    </td>
                    <td className="nowrap">{fmtDate(memo.at)}</td>
                    <td>{creditReasonText(memo.reason)}</td>
                    <td className="money">{money(memo.cents)}</td>
                    <td>
                      {allocations.length === 0 ? (
                        <span className="pill pill-warn">On account</span>
                      ) : (
                        <div className="stack" style={{ gap: 2 }}>
                          {allocations.map((a, i) => (
                            <span key={i} className="meta">
                              <span className="mono">{a.invoice?.number ?? a.invoiceId}</span> {money(a.cents)}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className={`money${unappliedCents > 0 ? ' status-text' : ''}`}>
                      {money(unappliedCents)}
                      {unappliedCents > 0 && onAllocate && (
                        <div>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAllocate({ sourceType: 'creditMemo', sourceId: memo.id })}>
                            Allocate
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
