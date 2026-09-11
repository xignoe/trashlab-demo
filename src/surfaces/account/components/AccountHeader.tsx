// Page header (eyebrow, name, status pill, meta line, sync chips) and the money strip of four stat cards.
import type { AccountView, SyncStatus } from '../selectors';
import {
  CYCLE_LABEL, DELIVERY_LABEL, METHOD_LABEL, PARTY_KIND_LABEL, PAYMENT_METHOD_ON_FILE, STATUS_LABEL, fmtDate, fmtDay, fmtPeriod, money, plural,
} from './format';

function SyncChip({ name, status }: { name: string; status: SyncStatus }) {
  return (
    <span className={`chip${status.state === 'stale' ? ' chip-stale' : ''}`} title={status.reason} tabIndex={0} aria-label={`${name}: ${status.state === 'stale' ? 'stale' : 'in sync'}. ${status.reason}`}>
      {name}
    </span>
  );
}

export function AccountHeader({ view }: { view: AccountView }) {
  const { account, payer, sites, sync } = view;
  const firstAddress = sites[0]?.site.address;
  // Addendum C14: every cycle bills forward from its cycle date, so net30 reads as terms, not "in arrears".
  const cycleText = account.cycle === 'net30' ? 'Net 30 terms' : `${CYCLE_LABEL[account.cycle]}${account.cycle !== 'perJob' && account.billedInAdvance ? ' in advance' : ''}`;
  const staleCount = [sync.dispatch, sync.billing, sync.quickbooks].filter((s) => s.state === 'stale').length;
  const meta = [
    PARTY_KIND_LABEL[payer.kind],
    account.id,
    sites.length > 1 ? plural(sites.length, 'site') : firstAddress,
    cycleText,
    DELIVERY_LABEL[account.deliveryMethod],
    account.taxExempt ? 'Tax exempt' : undefined,
  ].filter(Boolean);

  return (
    <div className="page-head">
      <div className="stack">
        <div className="eyebrow">Office · Account view</div>
        <div className="page-head-title">
          <h1 className="page-title">{payer.name}</h1>
          <span className={`pill pill-${account.status}`}>{STATUS_LABEL[account.status]}</span>
        </div>
        <p className="page-subtitle">{meta.join(' · ')}</p>
      </div>
      <div className="chip-group" role="group" aria-label="Sync status">
        <SyncChip name="Dispatch" status={sync.dispatch} />
        <SyncChip name="Billing" status={sync.billing} />
        <SyncChip name="QuickBooks" status={sync.quickbooks} />
        <span className="chip-note">{staleCount ? `${staleCount} stale` : 'all in sync'}</span>
      </div>
    </div>
  );
}

export function MoneyStrip({ view }: { view: AccountView }) {
  const { account, balance, pastDue, lastPayment, nextInvoice, openInvoices } = view;
  const oldestPastDue = [...openInvoices].filter((v) => v.isPastDue).sort((a, b) => (a.invoice.dueAt < b.invoice.dueAt ? -1 : 1))[0];
  const lineCount = nextInvoice.lines.length;
  const billedPeriod = nextInvoice.preview.recurring[0]?.period;

  return (
    <div className="stat-strip">
      <div className="panel stat-card">
        <div className="eyebrow">Balance</div>
        <div className="stat-figure">{money(balance)}</div>
        {(view.unappliedCreditCents > 0 || view.unappliedPaymentCents > 0) && (
          <div className="stat-unapplied" aria-label="Unapplied on account">
            {[
              view.unappliedCreditCents > 0 ? `${money(view.unappliedCreditCents)} unapplied credit` : undefined,
              view.unappliedPaymentCents > 0 ? `${money(view.unappliedPaymentCents)} unapplied payment` : undefined,
            ]
              .filter(Boolean)
              .join(', ')}
          </div>
        )}
        <div className="meta">
          {lastPayment
            ? `Last payment ${money(lastPayment.cents)} ${METHOD_LABEL[lastPayment.method]}, ${fmtDate(lastPayment.receivedAt)}${lastPayment.status === 'pending' ? ' (pending)' : ''}`
            : 'No payments on record'}
        </div>
      </div>
      <div className="panel stat-card">
        <div className="eyebrow">Past due</div>
        <div className={`stat-figure${pastDue > 0 ? ' stat-figure-danger' : ''}`}>{money(pastDue)}</div>
        <div className="meta">
          {oldestPastDue
            ? `${oldestPastDue.invoice.number} due ${fmtDate(oldestPastDue.invoice.dueAt)}, ${plural(oldestPastDue.daysLate, 'day')} late`
            : 'Nothing past due'}
        </div>
      </div>
      <div className="panel stat-card">
        <div className="eyebrow">Next invoice{nextInvoice.date ? ` · ${fmtDay(nextInvoice.date)}` : ''}</div>
        <div className="stat-figure">{money(nextInvoice.estimateCents)}</div>
        <div className="meta">
          {account.status === 'suspended'
            ? 'Suspended, no charges will be generated'
            : nextInvoice.date
              ? `Estimated, ${billedPeriod ? `bills ${fmtPeriod(billedPeriod)}, ` : ''}${plural(lineCount, 'line')}`
              : `Billed per job, ${plural(lineCount, 'proposed line')}`}
        </div>
      </div>
      <div className="panel stat-card">
        <div className="eyebrow">Autopay</div>
        <div className="stat-figure stat-figure-word">{account.autopay ? 'On' : 'Off'}</div>
        <div className="meta">{account.paymentMethodOnFile ? PAYMENT_METHOD_ON_FILE[account.paymentMethodOnFile] : 'No payment method on file'}</div>
      </div>
    </div>
  );
}
