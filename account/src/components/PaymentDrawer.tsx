// "Take a payment" drawer (invariant 6). Two modes share one allocation table:
//   new:      method, amount in dollars (parsed to integer cents from the string), receivedAt (default TODAY), an
//             optional reference kept as processorBatchId only for card payments, then the allocation table.
//   existing: an unapplied Payment (pay_chk_oakridge) or CreditMemo already on the account, opened from the
//             "Unapplied payments" list here or from the Allocate button under the invoices table.
// The preview is pure (buildPaymentPreview / buildExistingAllocationPreview on a shadow state) and runs the engine's
// allocate() exactly as confirm will: per-invoice new open balance, account balance and past due before and after,
// and the QuickBooks chip going stale. Confirm calls takePayment (one allocate call inside, validated before any
// write) or the store's allocate; an AllocationError is shown inline and nothing is written.
import { useMemo, useState, type FormEvent } from 'react';
import { TODAY } from '../store/clock';
import {
  autoAllocateOldestFirst,
  buildExistingAllocationPreview,
  buildPaymentPreview,
  centsToInput,
  openInvoicesOldestFirst,
  parseDollars,
  type AllocationPreview,
  type PaymentPreview,
  type SyncStatus,
} from '../store/selectors';
import { entities, listOf, useStore } from '../store/useStore';
import { unallocatedCents } from '../store/engine';
import type { Payment, PaymentAllocation } from '../types';
import { Drawer } from './Drawer';
import { METHOD_LABEL, PAYMENT_STATUS_PILL, capitalize, creditReasonText, fmtDate, money, plural } from './format';

export type PaymentDrawerSource = { sourceType: PaymentAllocation['sourceType']; sourceId: string };

export interface DrawerResult {
  title: string;
  detail: string;
}

const METHODS: Payment['method'][] = ['check', 'card', 'ach', 'cash'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function QuickbooksChip({ status }: { status: SyncStatus }) {
  const stale = status.state === 'stale';
  return (
    <span className={`chip${stale ? ' chip-stale' : ''}`} title={status.reason}>
      QuickBooks {stale ? 'stale' : 'in sync'}
    </span>
  );
}

/** Before and after for the account: balance, past due, and the QuickBooks chip. Shared with the credit drawer. */
export function MoneyEffect({
  rows,
  quickbooksBefore,
  quickbooksAfter,
}: {
  rows: { label: string; before: number; after: number }[];
  quickbooksBefore: SyncStatus;
  quickbooksAfter: SyncStatus;
}) {
  return (
    <>
      <table className="table table-dense" aria-label="Account before and after">
        <thead>
          <tr>
            <th />
            <th className="money">Before</th>
            <th className="money">After</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td className="money">{money(r.before)}</td>
              <td className={`money${r.after !== r.before ? ' status-text' : ''}`}>{money(r.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="stack" style={{ gap: 6 }}>
        <div className="cluster">
          <QuickbooksChip status={quickbooksBefore} />
          <span className="change-arrow" style={{ paddingTop: 0 }} aria-hidden="true">to</span>
          <QuickbooksChip status={quickbooksAfter} />
        </div>
        {quickbooksAfter.state === 'stale' && <div className="meta">{quickbooksAfter.reason}.</div>}
      </div>
    </>
  );
}

function AllocationTable({
  preview,
  texts,
  onText,
  onFill,
}: {
  preview: AllocationPreview;
  texts: Record<string, string>;
  onText: (invoiceId: string, text: string) => void;
  onFill: (invoiceId: string) => void;
}) {
  if (preview.rows.length === 0) return <p className="change-note">No open invoices on this account. The whole amount stays unapplied on the account.</p>;
  return (
    <div className="table-wrap">
      <table className="table table-dense alloc-table" aria-label="Allocation to open invoices">
        <thead>
          <tr>
            <th>Invoice</th>
            <th className="money">Open</th>
            <th className="money">Apply</th>
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((r) => {
            const text = texts[r.invoice.id] ?? '';
            const bad = (text.trim() !== '' && parseDollars(text) === undefined) || r.over;
            return (
              <tr key={r.invoice.id}>
                <td>
                  <span className="mono">{r.invoice.number}</span>
                  <div className="meta">
                    due {fmtDate(r.invoice.dueAt)}
                    {r.isPastDue ? <span className="danger-text">, {r.daysLate}d late</span> : ''}
                  </div>
                </td>
                <td className="money">{money(r.openBefore)}</td>
                <td className="money">
                  <div className="alloc-cell">
                    <input
                      className="input input-mono alloc-input"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={text}
                      onChange={(e) => onText(r.invoice.id, e.target.value)}
                      aria-label={`Apply to ${r.invoice.number}, in dollars`}
                      aria-invalid={bad ? true : undefined}
                    />
                    <button type="button" className="btn btn-tertiary btn-sm alloc-fill" onClick={() => onFill(r.invoice.id)} aria-label={`Fill ${r.invoice.number}`}>
                      Fill
                    </button>
                  </div>
                  <div className="meta">{r.cents} cents</div>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>Applied</td>
            <td />
            <td className="money">{money(preview.allocatedCents)}</td>
          </tr>
          <tr>
            <td colSpan={2}>{preview.remainderCents < 0 ? 'Over by' : 'Unallocated remainder'}</td>
            <td className={`money${preview.remainderCents < 0 ? ' danger-text' : ''}`} aria-live="polite">
              {money(Math.abs(preview.remainderCents))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function PerInvoiceEffect({ preview }: { preview: AllocationPreview }) {
  const touched = preview.rows.filter((r) => r.cents > 0);
  if (touched.length === 0) return <p className="change-note">Nothing applied yet: enter amounts above or use auto-allocate.</p>;
  return (
    <table className="table table-dense" aria-label="Invoice open balances after">
      <thead>
        <tr>
          <th>Invoice</th>
          <th className="money">Open now</th>
          <th className="money">Applied</th>
          <th className="money">New open</th>
        </tr>
      </thead>
      <tbody>
        {touched.map((r) => (
          <tr key={r.invoice.id}>
            <td className="mono">{r.invoice.number}</td>
            <td className="money">{money(r.openBefore)}</td>
            <td className="money">-{money(r.cents)}</td>
            <td className="money">
              {r.openAfter === 0 ? <span className="pill pill-ok">Paid in full</span> : <span className={r.openAfter < 0 ? 'danger-text mono' : 'status-text mono'}>{money(r.openAfter)}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PaymentDrawer({
  accountId,
  initialSource,
  onClose,
  onDone,
}: {
  accountId: string;
  initialSource?: PaymentDrawerSource;
  onClose: () => void;
  onDone: (result: DrawerResult) => void;
}) {
  const store = useStore();
  const state = useMemo(() => entities(store), [store]);
  const { ledgerWrites, takePayment, allocate } = store;

  const [source, setSource] = useState<PaymentDrawerSource | undefined>(initialSource);
  const [method, setMethod] = useState<Payment['method']>('check');
  const [amountText, setAmountText] = useState('');
  const [receivedAt, setReceivedAt] = useState(TODAY);
  const [reference, setReference] = useState('');
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string>();

  const amountCents = parseDollars(amountText);
  const amountError = amountText.trim() === '' ? undefined : amountCents === undefined ? 'Amount must be dollars and cents, like 759.64' : amountCents <= 0 ? 'Amount must be more than $0.00' : undefined;
  const dateError = !ISO_DATE.test(receivedAt) ? 'Pick the date the payment was received' : receivedAt > TODAY ? `Received date cannot be after today, ${fmtDate(TODAY)}` : undefined;
  const rowTextError = Object.entries(texts).some(([, t]) => t.trim() !== '' && parseDollars(t) === undefined) ? 'Allocation amounts must be dollars and cents, like 759.64' : undefined;

  const requested = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [id, t] of Object.entries(texts)) out[id] = parseDollars(t) ?? 0;
    return out;
  }, [texts]);

  const preview = useMemo(() => {
    if (source) return buildExistingAllocationPreview(source.sourceType, source.sourceId, requested, state, ledgerWrites);
    return buildPaymentPreview({ accountId, method, cents: amountCents ?? 0, receivedAt, reference }, requested, state, ledgerWrites);
  }, [source, accountId, method, amountCents, receivedAt, reference, requested, state, ledgerWrites]);

  const unappliedPayments = useMemo(
    () => listOf(state.payments).filter((p) => p.accountId === accountId && p.status !== 'returned' && unallocatedCents('payment', p.id, state) > 0),
    [state, accountId],
  );
  const unappliedCredits = useMemo(
    () => listOf(state.creditMemos).filter((m) => m.accountId === accountId && unallocatedCents('creditMemo', m.id, state) > 0),
    [state, accountId],
  );

  const setText = (invoiceId: string, text: string) => {
    setTexts((t) => ({ ...t, [invoiceId]: text }));
    setSubmitError(undefined);
  };
  const autoAllocate = () => {
    if (!preview) return;
    const fill = autoAllocateOldestFirst(openInvoicesOldestFirst(accountId, state), preview.availableCents);
    setTexts(Object.fromEntries(Object.entries(fill).map(([id, c]) => [id, c > 0 ? centsToInput(c) : ''])));
    setSubmitError(undefined);
  };
  const fillRow = (invoiceId: string) => {
    if (!preview) return;
    const row = preview.rows.find((r) => r.invoice.id === invoiceId);
    if (!row) return;
    const room = Math.max(0, preview.remainderCents + row.cents);
    const take = Math.min(row.openBefore, room);
    setText(invoiceId, take > 0 ? centsToInput(take) : '');
  };
  const chooseSource = (next?: PaymentDrawerSource) => {
    setSource(next);
    setTexts({});
    setSubmitError(undefined);
  };

  const isNew = !source;
  const needsAmount = isNew && amountCents === undefined;
  const hasRows = Boolean(preview && preview.invoiceIds.length > 0);
  const blocked = Boolean(preview?.error || rowTextError || (isNew ? needsAmount || amountError || dateError : !hasRows));
  const canConfirm = Boolean(preview) && !blocked;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canConfirm || !preview) return;
    try {
      const allocations = hasRows ? { invoiceIds: preview.invoiceIds, cents: preview.cents } : undefined;
      const invoiceNumbers = preview.rows.filter((r) => r.cents > 0).map((r) => r.invoice.number).join(', ');
      if (isNew) {
        const payment = takePayment({
          accountId,
          method,
          cents: amountCents!,
          receivedAt,
          processorBatchId: method === 'card' && reference.trim() ? reference.trim() : undefined,
          allocations,
        });
        onDone({
          title: `Payment ${payment.id} recorded`,
          detail: `${money(payment.cents)} ${METHOD_LABEL[payment.method]}, ${payment.status}. ${
            hasRows ? `Applied ${money(preview.allocatedCents)} to ${invoiceNumbers}` : 'Nothing applied'
          }${preview.remainderCents > 0 ? `; ${money(preview.remainderCents)} stays unapplied on the account` : ''}. QuickBooks sync pending.`,
        });
      } else {
        allocate({ sourceType: source!.sourceType, sourceId: source!.sourceId, invoiceIds: preview.invoiceIds, cents: preview.cents });
        onDone({
          title: `${source!.sourceId} applied`,
          detail: `${money(preview.allocatedCents)} across ${plural(preview.invoiceIds.length, 'invoice')} (${invoiceNumbers}). Balance now ${money(preview.balanceAfter)}${
            preview.remainderCents > 0 ? `; ${money(preview.remainderCents)} still unapplied` : ''
          }.`,
        });
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  };

  const draftRow = source ? undefined : (preview as PaymentPreview | undefined)?.payment;
  const existingPayment = source?.sourceType === 'payment' ? state.payments.byId[source.sourceId] : undefined;
  const existingCredit = source?.sourceType === 'creditMemo' ? state.creditMemos.byId[source.sourceId] : undefined;
  const confirmLabel = isNew
    ? amountCents && amountCents > 0
      ? `Record ${money(amountCents)} ${METHOD_LABEL[method]}`
      : 'Record payment'
    : hasRows
      ? `Apply ${money(preview?.allocatedCents ?? 0)}`
      : 'Apply';

  return (
    <Drawer
      eyebrow={isNew ? 'Take a payment' : 'Allocate'}
      title={isNew ? 'Record a payment' : `Apply ${existingCredit ? 'credit' : 'payment'} ${source!.sourceId}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="payment-form" className="btn btn-primary" disabled={!canConfirm}>{confirmLabel}</button>
        </>
      }
    >
      <form id="payment-form" className="drawer-form" onSubmit={submit} noValidate>
        {isNew ? (
          <>
            {(unappliedPayments.length > 0 || unappliedCredits.length > 0) && (
              <section className="inset" aria-label="Unapplied payments">
                <div className="eyebrow">Unapplied payments</div>
                <div className="row-list">
                  {unappliedPayments.map((p) => (
                    <div className="unapplied-row" key={p.id}>
                      <div className="stack" style={{ gap: 2 }}>
                        <div className="cluster">
                          <code className="code">{p.id}</code>
                          <span className="status-text mono">{money(unallocatedCents('payment', p.id, state))}</span>
                        </div>
                        <div className="meta">{capitalize(METHOD_LABEL[p.method])} received {fmtDate(p.receivedAt)}, {money(p.cents)} total</div>
                      </div>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => chooseSource({ sourceType: 'payment', sourceId: p.id })}>
                        Allocate
                      </button>
                    </div>
                  ))}
                  {unappliedCredits.map((m) => (
                    <div className="unapplied-row" key={m.id}>
                      <div className="stack" style={{ gap: 2 }}>
                        <div className="cluster">
                          <code className="code">{m.id}</code>
                          <span className="status-text mono">{money(unallocatedCents('creditMemo', m.id, state))}</span>
                          <span className="meta">credit</span>
                        </div>
                        <div className="meta">{creditReasonText(m.reason)}, {fmtDate(m.at)}</div>
                      </div>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => chooseSource({ sourceType: 'creditMemo', sourceId: m.id })}>
                        Allocate
                      </button>
                    </div>
                  ))}
                </div>
                <div className="meta">Money already on the account. Apply it before recording a new payment.</div>
              </section>
            )}

            <div className="field-row field-row-even">
              <label className="field">
                <span className="eyebrow">Method</span>
                <select className="select" value={method} onChange={(e) => setMethod(e.target.value as Payment['method'])}>
                  {METHODS.map((m) => (
                    <option key={m} value={m}>{capitalize(METHOD_LABEL[m])}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="eyebrow">Amount</span>
                <input
                  className="input input-mono"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amountText}
                  onChange={(e) => {
                    setAmountText(e.target.value);
                    setSubmitError(undefined);
                  }}
                  aria-invalid={amountError ? true : undefined}
                />
                <span className="meta">{amountCents !== undefined ? `${amountCents} cents` : 'In dollars'}</span>
              </label>
            </div>

            <div className="field-row field-row-even">
              <label className="field">
                <span className="eyebrow">Received</span>
                <input
                  className="input input-mono"
                  type="date"
                  max={TODAY}
                  value={receivedAt}
                  onChange={(e) => setReceivedAt(e.target.value)}
                  aria-invalid={dateError ? true : undefined}
                />
              </label>
              <label className="field">
                <span className="eyebrow">Check or reference no.</span>
                <input className="input input-mono" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
              </label>
            </div>
            <div className="meta">
              {method === 'card'
                ? 'Card: the reference is saved on the payment as its processor batch id.'
                : 'Only card references are saved (as the processor batch id); the payment record has no field for a check or ACH number.'}{' '}
              {method === 'card' || method === 'ach' ? 'Card and ACH post as pending until the processor settles.' : 'Check and cash post as settled.'}
            </div>
          </>
        ) : (
          <section className="inset" aria-label="Source">
            <div className="eyebrow">{existingCredit ? 'Unapplied credit' : 'Unapplied payment'}</div>
            <div className="row-title">
              <code className="code">{source!.sourceId}</code>
              <span className="mono">{money(preview?.availableCents ?? 0)}</span>
              <span className="meta">available</span>
            </div>
            <div className="meta">
              {existingPayment
                ? `${capitalize(METHOD_LABEL[existingPayment.method])} received ${fmtDate(existingPayment.receivedAt)}, ${money(existingPayment.cents)} total, ${existingPayment.status}.`
                : existingCredit
                  ? `${creditReasonText(existingCredit.reason)}, issued ${fmtDate(existingCredit.at)} by ${existingCredit.by}, ${money(existingCredit.cents)} total.`
                  : ''}
            </div>
            {!initialSource && (
              <button type="button" className="toggle" onClick={() => chooseSource(undefined)}>Back to a new payment</button>
            )}
          </section>
        )}

        {preview && (
          <>
            <div className="card-head">
              <span className="eyebrow">Allocate to open invoices</span>
              {preview.rows.length > 0 && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={autoAllocate} disabled={preview.availableCents <= 0}>
                  Auto-allocate oldest first
                </button>
              )}
            </div>
            <AllocationTable preview={preview} texts={texts} onText={setText} onFill={fillRow} />
          </>
        )}

        {(amountError || dateError || rowTextError) && <div className="form-error" role="alert">{amountError ?? dateError ?? rowTextError}</div>}
        {preview?.error && !rowTextError && <div className="form-error" role="alert">{preview.error}</div>}
        {submitError && <div className="form-error" role="alert">{submitError}</div>}

        <div className="eyebrow drawer-section-label">Preview before confirm</div>
        {!preview || needsAmount ? (
          <p className="change-note">Enter an amount to see the effect on this account.</p>
        ) : (
          <>
            {draftRow && (
              <section className="inset" aria-label="Payment record">
                <div className="eyebrow">Writes</div>
                <div className="row-title">
                  <span>Payment</span>
                  <code className="code">{draftRow.id}</code>
                  <span className={`pill ${PAYMENT_STATUS_PILL[draftRow.status]}`}>{capitalize(draftRow.status)}</span>
                </div>
                <div className="meta">
                  {money(amountCents ?? 0)} {METHOD_LABEL[method]}, received {fmtDate(receivedAt)}
                  {method === 'card' && reference.trim() ? `, reference ${reference.trim()}` : ''}.{' '}
                  {hasRows ? `One allocation call across ${plural(preview.invoiceIds.length, 'invoice')}.` : 'No allocation: the payment sits unapplied on the account.'}
                </div>
              </section>
            )}
            <section className="inset" aria-label="Invoice effect">
              <div className="eyebrow">Invoices</div>
              <PerInvoiceEffect preview={preview} />
              {preview.remainderCents > 0 && hasRows && <div className="meta">{money(preview.remainderCents)} stays unapplied on the account.</div>}
            </section>
            <section className="inset" aria-label="Account effect">
              <div className="eyebrow">Account</div>
              <MoneyEffect
                rows={[
                  { label: 'Account balance', before: preview.balanceBefore, after: preview.balanceAfter },
                  { label: 'Past due', before: preview.pastDueBefore, after: preview.pastDueAfter },
                ]}
                quickbooksBefore={preview.quickbooksBefore}
                quickbooksAfter={preview.quickbooksAfter}
              />
            </section>
          </>
        )}
      </form>
    </Drawer>
  );
}
