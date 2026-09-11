// "Issue credit" drawer (invariant 6). Reason, amount in dollars, optional note, and an optional invoice to apply
// against (default none: the credit stays unapplied on the account and shows in the header). The preview is pure
// (buildCreditPreview on a shadow state): the invoice's open balance before and after, or "unapplied credit on
// account", plus balance, past due, and the QuickBooks chip. Confirm calls issueCreditMemo, which writes the
// CreditMemo (by office, at TODAY) and, when an invoice is chosen, allocates it with sourceType creditMemo in the
// same write. Errors are shown inline and nothing is written.
import { useMemo, useState, type FormEvent } from 'react';
import { CREDIT_REASONS, buildCreditPreview, openInvoicesOldestFirst, parseDollars, type CreditReason } from '../store/selectors';
import { entities, useStore } from '../store/useStore';
import { Drawer } from './Drawer';
import { MoneyEffect, type DrawerResult } from './PaymentDrawer';
import { CREDIT_REASON_LABEL, creditReasonText, fmtDate, money } from './format';

export function CreditDrawer({
  accountId,
  initialInvoiceId,
  onClose,
  onDone,
}: {
  accountId: string;
  initialInvoiceId?: string;
  onClose: () => void;
  onDone: (result: DrawerResult) => void;
}) {
  const store = useStore();
  const state = useMemo(() => entities(store), [store]);
  const { ledgerWrites, issueCreditMemo } = store;

  const [reason, setReason] = useState<CreditReason>('goodwill');
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');
  const [invoiceId, setInvoiceId] = useState(initialInvoiceId ?? '');
  const [submitError, setSubmitError] = useState<string>();

  const openInvoices = useMemo(() => openInvoicesOldestFirst(accountId, state), [accountId, state]);
  const cents = parseDollars(amountText);
  const amountError = amountText.trim() === '' ? undefined : cents === undefined ? 'Amount must be dollars and cents, like 25.00' : cents <= 0 ? 'Amount must be more than $0.00' : undefined;
  const noteError = reason === 'other' && !note.trim() ? 'Say what the credit is for when the reason is Other' : undefined;

  const preview = useMemo(
    () => (cents && cents > 0 ? buildCreditPreview({ accountId, cents, reason, note, invoiceId: invoiceId || undefined }, state, ledgerWrites) : undefined),
    [accountId, cents, reason, note, invoiceId, state, ledgerWrites],
  );
  const canConfirm = Boolean(preview) && !preview?.error && !amountError && !noteError;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canConfirm || !cents) return;
    try {
      const memo = issueCreditMemo({ accountId, cents, reason, note: note.trim() || undefined, invoiceId: invoiceId || undefined });
      const inv = invoiceId ? state.invoices.byId[invoiceId] : undefined;
      onDone({
        title: `Credit ${memo.id} issued`,
        detail: `${money(memo.cents)}, ${creditReasonText(memo.reason)}. ${
          inv ? `Applied to ${inv.number}, now ${money(preview!.openAfter ?? 0)} open.` : 'Unapplied, held on the account.'
        }`,
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Drawer
      eyebrow="Issue credit"
      title="Issue a credit memo"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="credit-form" className="btn btn-primary" disabled={!canConfirm}>
            {cents && cents > 0 ? `Issue ${money(cents)} credit` : 'Issue credit'}
          </button>
        </>
      }
    >
      <form id="credit-form" className="drawer-form" onSubmit={submit} noValidate>
        <div className="field-row field-row-even">
          <label className="field">
            <span className="eyebrow">Reason</span>
            <select className="select" value={reason} onChange={(e) => { setReason(e.target.value as CreditReason); setSubmitError(undefined); }}>
              {CREDIT_REASONS.map((r) => (
                <option key={r} value={r}>{CREDIT_REASON_LABEL[r]}</option>
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
              onChange={(e) => { setAmountText(e.target.value); setSubmitError(undefined); }}
              aria-invalid={amountError ? true : undefined}
            />
            <span className="meta">{cents !== undefined ? `${cents} cents` : 'In dollars'}</span>
          </label>
        </div>

        <label className="field">
          <span className="eyebrow">Note{reason === 'other' ? '' : ' (optional)'}</span>
          <textarea
            className="textarea"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What happened, for example missed pickup on Aug 24"
            aria-invalid={noteError && note !== '' ? true : undefined}
          />
          <span className="meta">Saved on the credit memo after the reason.</span>
        </label>

        <label className="field">
          <span className="eyebrow">Apply to invoice</span>
          <select className="select" value={invoiceId} onChange={(e) => { setInvoiceId(e.target.value); setSubmitError(undefined); }}>
            <option value="">None, leave it unapplied on the account</option>
            {openInvoices.map((v) => (
              <option key={v.invoice.id} value={v.invoice.id}>
                {v.invoice.number}, due {fmtDate(v.invoice.dueAt)}, {money(v.openCents)} open
              </option>
            ))}
          </select>
          {openInvoices.length === 0 && <span className="meta">No open invoices; the credit will sit on the account.</span>}
        </label>

        {amountError && <div className="form-error" role="alert">{amountError}</div>}
        {noteError && cents ? <div className="form-error" role="alert">{noteError}</div> : null}
        {preview?.error && <div className="form-error" role="alert">{preview.error}</div>}
        {submitError && <div className="form-error" role="alert">{submitError}</div>}

        <div className="eyebrow drawer-section-label">Preview before confirm</div>
        {!preview ? (
          <p className="change-note">Enter an amount to see the effect on this account.</p>
        ) : (
          <>
            <section className="inset" aria-label="Credit memo">
              <div className="eyebrow">Writes</div>
              <div className="row-title">
                <span>Credit memo</span>
                <code className="code">{preview.memo.id}</code>
                <span className="mono">{money(preview.memo.cents)}</span>
              </div>
              <div className="meta">{creditReasonText(preview.memo.reason)}. By {preview.memo.by}, {fmtDate(preview.memo.at)}.</div>
            </section>
            <section className="inset" aria-label="Where the credit lands">
              <div className="eyebrow">{preview.invoice ? `Invoice ${preview.invoice.invoice.number}` : 'Unapplied credit on account'}</div>
              {preview.invoice ? (
                <div className="change-compare">
                  <div>
                    <div className="meta">Open before</div>
                    <div className="kv-value mono">{money(preview.openBefore ?? 0)}</div>
                  </div>
                  <div aria-hidden="true" className="change-arrow">to</div>
                  <div>
                    <div className="meta">Open after</div>
                    <div className="kv-value mono">
                      {preview.openAfter === undefined ? <span className="danger-text">not applied</span> : preview.openAfter === 0 ? <span className="pill pill-ok">Paid in full</span> : money(preview.openAfter)}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="change-note">
                  Unapplied credit on account: {money(preview.unappliedCreditBefore)} to <strong>{money(preview.unappliedCreditAfter)}</strong>. It shows in the header and can be applied to an invoice later from Take a payment.
                </p>
              )}
            </section>
            <section className="inset" aria-label="Account effect">
              <div className="eyebrow">Account</div>
              <MoneyEffect
                rows={[
                  { label: 'Account balance', before: preview.balanceBefore, after: preview.balanceAfter },
                  { label: 'Past due', before: preview.pastDueBefore, after: preview.pastDueAfter },
                  { label: 'Unapplied credit', before: preview.unappliedCreditBefore, after: preview.unappliedCreditAfter },
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
