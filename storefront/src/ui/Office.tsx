// Office approvals (reachable from the "Office" link and #office), with a Store tab (#store) for the inspector. Every quote in the store, held
// signups first. A held quote is approved (charge the saved card, create the account) or declined with
// a one-line reason (never charged). Commercial requests show their intake so a person can write the price.
import { useState } from 'react';
import { datePart, formatDay, formatDayTime, nextBusinessDay } from '../store/clock';
import { approveHeldQuote, declineHeldQuote } from '../store/held';
import { formatCents } from '../store/money';
import { frequencyLabel } from '../store/offer';
import { CardDeclinedError } from '../store/payments';
import { useStore } from '../store/store';
import { useUi } from '../store/ui';
import type { Quote } from '../types';
import { cardLabel } from './CardWidget';
import { Container, cx, DangerButton, Eyebrow, Field, LinkButton, Pill, PrimaryButton, SecondaryButton, TextInput } from './components';
import { statusPill } from './quoteStatus';
import { StoreInspector } from './StoreInspector';

/** Who approvals are stamped with (quoteIntake.reviewedBy). The office screen has no sign-in. */
export const OFFICE_APPROVER = 'office';

const KIND_LABEL: Record<Quote['kind'], string> = {
  residentialSignup: 'Residential signup',
  commercialRequest: 'Commercial request',
};

const STATUS_ORDER: Record<string, number> = { held: 0, draft: 1, sent: 2, accepted: 3, declined: 4, expired: 5 };

const OFFICE_PILL: Record<string, string> = { held: 'Held', draft: 'Awaiting price' };

function Cell({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-[2px]', className)}>
      <dt className="text-small text-ink-muted">{label}</dt>
      <dd className="break-words text-body text-ink">{children}</dd>
    </div>
  );
}

function IdList({ label, ids }: { label: string; ids: string[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-[2px]">
      <dt className="text-small text-ink-muted">{label}</dt>
      <dd className="break-all text-small font-medium text-ink">{ids.join(', ')}</dd>
    </div>
  );
}

function QuoteRow({ quote }: { quote: Quote }) {
  const intake = useStore((s) => s.quoteIntake[quote.id]);
  const catalog = useStore((s) => s.catalog);
  const token = useStore((s) => (quote.paymentTokenId ? s.paymentTokens[quote.paymentTokenId] : undefined));
  const approval = useUi((s) => s.approvals[quote.id]);
  const payment = useStore((s) => (approval ? s.payments[approval.paymentId] : undefined));
  const recordApproval = useUi((s) => s.recordApproval);
  const showStatus = useUi((s) => s.showStatus);

  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();

  const commercial = quote.kind === 'commercialRequest';
  const pill = statusPill(quote.status);
  const card = cardLabel(token);
  const line = quote.lines[0];
  const deadline = quote.holdDeadline
    ? formatDayTime(quote.holdDeadline)
    : commercial && quote.status === 'draft' && intake
      ? `Reply by ${formatDay(nextBusinessDay(datePart(intake.createdAt)))}`
      : 'None';

  function approve() {
    setError(undefined);
    try {
      recordApproval(quote.id, approveHeldQuote(quote.id, OFFICE_APPROVER));
    } catch (err) {
      setError(
        err instanceof CardDeclinedError
          ? `The saved card (${card}) was declined. Nothing was charged and the quote stays held.`
          : err instanceof Error
            ? err.message
            : String(err),
      );
    }
  }

  function decline() {
    setError(undefined);
    if (!reason.trim()) return setError('Enter a one-line reason for the customer.');
    try {
      declineHeldQuote(quote.id, reason);
      setDeclining(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <li className="rounded-lg border border-line bg-surface p-4 md:p-5" data-testid={`office-${quote.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="break-all text-body font-semibold text-ink">{quote.id}</span>
          <Pill tone={pill.tone}>{OFFICE_PILL[quote.status] ?? pill.label}</Pill>
        </div>
        {!commercial ? <LinkButton onClick={() => showStatus(quote.id)}>Customer status</LinkButton> : null}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-6">
        <Cell label="Kind">{KIND_LABEL[quote.kind]}</Cell>
        <Cell label="Address" className="md:col-span-2">
          {quote.address}
        </Cell>
        <Cell label="Due today">{commercial ? 'Priced by a person' : formatCents(quote.dueTodayCents)}</Cell>
        <Cell label="Hold reason">{quote.holdReason ?? 'None'}</Cell>
        <Cell label="Deadline">{deadline}</Cell>
      </dl>

      {intake ? (
        <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 rounded border border-line bg-bg p-3 sm:grid-cols-2 md:grid-cols-3" aria-label="Intake details">
          <Cell label="Contact">
            {intake.contact.name}
            <span className="block break-all text-small text-ink-muted">
              {[intake.contact.email, intake.contact.phone].filter(Boolean).join(', ')}
            </span>
          </Cell>
          {commercial ? (
            <>
              <Cell label="Container">
                {line ? `${catalog[line.catalogId]?.name ?? line.catalogId}, ${frequencyLabel(line.frequency)}` : 'Not given'}
              </Cell>
              <Cell label="Material">{intake.material ?? 'Not given'}</Cell>
              <Cell label="Access notes" className="sm:col-span-2 md:col-span-3">
                {intake.accessNotes || 'None'}
              </Cell>
            </>
          ) : (
            <>
              <Cell label="Start date">{intake.startDate ? formatDay(intake.startDate) : 'Not given'}</Cell>
              <Cell label="Card">{quote.status === 'accepted' ? `${card}, charged` : `${card}, saved, not charged`}</Cell>
              <Cell label="Delivery notes" className="sm:col-span-2">
                {intake.deliveryNotes || 'None'}
              </Cell>
              <Cell label="Driveway photo">{intake.photoName ?? 'None'}</Cell>
            </>
          )}
        </dl>
      ) : null}

      {quote.status === 'held' ? (
        <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
          {declining ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field label="Reason for declining (one line, sent to the customer)" htmlFor={`reason-${quote.id}`} className="min-w-0 flex-1">
                <TextInput
                  id={`reason-${quote.id}`}
                  value={reason}
                  maxLength={140}
                  autoFocus
                  placeholder="The private road is too narrow for our truck"
                  onChange={(e) => setReason(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') decline();
                    if (e.key === 'Escape') setDeclining(false);
                  }}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <DangerButton size="compact" onClick={decline}>Decline, do not charge</DangerButton>
                <SecondaryButton size="compact" onClick={() => setDeclining(false)}>
                  Cancel
                </SecondaryButton>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <div className="flex gap-2">
                <PrimaryButton size="compact" onClick={approve}>
                  Approve
                </PrimaryButton>
                <SecondaryButton size="compact" onClick={() => setDeclining(true)}>
                  Decline
                </SecondaryButton>
              </div>
              <p className="text-small text-ink-muted">
                Approve charges {formatCents(quote.dueTodayCents)} to {card} and creates the account and cart delivery.
              </p>
            </div>
          )}
        </div>
      ) : null}

      {approval ? (
        <div className="mt-4 flex flex-col gap-3 rounded border border-success bg-success-soft p-3" data-testid={`approval-${quote.id}`}>
          <p className="text-body font-medium text-ink">
            Approved. Charged {formatCents(payment?.cents ?? quote.dueTodayCents)} to {card}. Cart arrives {formatDay(approval.cartArrives)}, first
            pickup {formatDay(approval.firstPickup)}.
          </p>
          {approval.startDateMoved ? (
            <p className="text-small text-ink">The preserved start date had passed, so service starts on the next route day.</p>
          ) : null}
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
            <IdList label="Account" ids={[approval.accountId]} />
            <IdList label="Party" ids={[approval.partyId]} />
            <IdList label="Site" ids={[approval.siteId]} />
            <IdList label="Service items" ids={approval.serviceItemIds} />
            <IdList label="Work orders" ids={approval.workOrderIds} />
            <IdList label="Payment" ids={[approval.paymentId]} />
            <IdList label="Charges (approved)" ids={approval.chargeIds} />
          </dl>
        </div>
      ) : null}

      {quote.status === 'declined' ? (
        <p className="mt-4 rounded border border-line bg-gray-100 px-3 py-2 text-body text-ink" data-testid={`declined-${quote.id}`}>
          Declined, card was not charged.{intake?.declineReason ? ` Reason: ${intake.declineReason}` : ''}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 rounded border border-danger bg-danger-soft px-3 py-2 text-body text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}

const TABS: { screen: 'office' | 'store'; label: string }[] = [
  { screen: 'office', label: 'Approvals' },
  { screen: 'store', label: 'Store' },
];

/** Office approvals and the store inspector share one header with a two-tab bar (#office, #store). */
export function OfficeScreen() {
  const screen = useUi((s) => s.screen);
  const go = useUi((s) => s.go);
  const startOver = useUi((s) => s.startOver);
  const tab = screen === 'store' ? 'store' : 'office';

  return (
    <main className="pb-16 pt-8 md:pt-16">
      <Container>
      <div className="flex flex-col gap-3">
        <Eyebrow>Office</Eyebrow>
        <h1 className="text-title font-bold text-ink">{tab === 'store' ? 'Store inspector' : 'Office approvals'}</h1>
      </div>
      <div role="tablist" aria-label="Office" className="mt-6 flex gap-1 border-b border-line">
        {TABS.map((t) => {
          const selected = t.screen === tab;
          return (
            <button
              key={t.screen}
              type="button"
              role="tab"
              id={`office-tab-${t.screen}`}
              aria-selected={selected}
              aria-controls="office-tabpanel"
              onClick={() => go(t.screen)}
              className={cx(
                '-mb-px rounded-t border-b-2 px-4 py-2 text-body font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                selected ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div id="office-tabpanel" role="tabpanel" aria-labelledby={`office-tab-${tab}`} className="mt-6">
        {tab === 'store' ? <StoreInspector /> : <Approvals />}
      </div>
      <SecondaryButton className="mt-8" onClick={startOver}>
        Back to the storefront
      </SecondaryButton>
      </Container>
    </main>
  );
}

function Approvals() {
  const quotes = useStore((s) => s.quotes);
  const list = Object.values(quotes).sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.id.localeCompare(b.id),
  );
  const held = list.filter((q) => q.status === 'held').length;
  const waiting = list.filter((q) => q.kind === 'commercialRequest' && q.status === 'draft').length;

  return (
    <>
      <p className="text-body text-ink-muted">
        {held} held {held === 1 ? 'signup is' : 'signups are'} waiting for an address check, and {waiting} commercial{' '}
        {waiting === 1 ? 'request is' : 'requests are'} waiting for a written price. Approving a held signup charges the saved
        card and books the cart; the customer does not need to do anything else.
      </p>
      {list.length === 0 ? (
        <p className="mt-8 text-body text-ink-muted">No quotes yet.</p>
      ) : (
        <ul className="mt-8 flex flex-col gap-4" aria-label="Quotes">
          {list.map((q) => (
            <QuoteRow key={q.id} quote={q} />
          ))}
        </ul>
      )}
    </>
  );
}
