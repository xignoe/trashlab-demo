// Office approvals (/office/approvals). Every quote in the Db, open work first. A held signup is approved (charge the
// saved card, create the account) or declined with a one-line reason (never charged). A commercial request is priced
// line by line and sent, or declined; once sent, the customer's answer is recorded here: accepted (the account, or the
// existing customer's contract, carries the written price) or declined.
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../../../store/useStore';
import type { Quote } from '../../../types';
import { datePart, formatDay, formatDayTime, nextBusinessDay } from '../lib/clock';
import { heldAmounts, savedTokenId } from '../lib/held';
import { formatCents } from '../lib/money';
import { frequencyLabel } from '../lib/offer';
import { rateCardPrices } from '../lib/commercial';
import { CardDeclinedError } from '../lib/payments';
import { cardLabel } from './CardWidget';
import { Container, cx, DangerButton, Eyebrow, Field, LinkButton, Pill, PrimaryButton, SecondaryButton, TextInput } from './components';
import { useShowStatus, useStartOver, useUi, useView } from './hooks';
import { statusPill } from './quoteStatus';

/** Who approvals are stamped with (quoteIntake.reviewedBy). The office screen has no sign-in. */
export const OFFICE_APPROVER = 'office';

const KIND_LABEL: Record<Quote['kind'], string> = {
  residentialSignup: 'Residential signup',
  commercialRequest: 'Commercial request',
};

const STATUS_ORDER: Record<string, number> = { held: 0, draft: 1, sent: 2, accepted: 3, declined: 4, expired: 5 };

const OFFICE_PILL: Record<string, string> = { held: 'Held', draft: 'Awaiting price' };

const toCents = (dollars: string): number => Math.round(Number(dollars.replace(/[$,\s]/g, '')) * 100);
const toDollars = (cents?: number): string => (cents && cents > 0 ? (cents / 100).toFixed(2) : '');

/**
 * A commercial request's answer, on the approvals page itself: price each line and send it (or decline), then record
 * whether the customer accepted the written price.
 */
function CommercialActions({ quote }: { quote: Quote }) {
  const view = useView();
  const intake = view.quoteIntake[quote.id];
  const rates = useMemo(() => rateCardPrices(quote, view), [quote, view]);
  const sent = Boolean(intake?.quotedAt);
  const [editing, setEditing] = useState(!sent);
  const [prices, setPrices] = useState<string[]>(() => rates.map((r) => toDollars(r.priceCents || r.rateCents)));
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [accepted, setAccepted] = useState<{ accountId: string; created: boolean; contractId: string } | undefined>();
  const monthly = prices.reduce((sum, p, i) => sum + (toCents(p) || 0) * (quote.lines[i]?.qty ?? 1), 0);

  const attempt = (fn: () => void) => {
    setError(undefined);
    try {
      fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const send = () =>
    attempt(() => {
      const lines = quote.lines.map((l, i) => ({ catalogId: l.catalogId, qty: l.qty, frequency: l.frequency, priceCents: toCents(prices[i] ?? '') }));
      if (lines.some((l) => !(l.priceCents > 0))) throw new Error('Enter a price above $0 for every container.');
      useStore.getState().sfSendCommercialQuote(quote.id, lines, OFFICE_APPROVER);
      setEditing(false);
    });
  const accept = () => attempt(() => setAccepted(useStore.getState().sfAcceptCommercialQuote(quote.id, OFFICE_APPROVER)));
  const decline = () =>
    attempt(() => {
      if (!reason.trim()) throw new Error('Enter a one-line reason.');
      useStore.getState().sfDeclineHeldQuote(quote.id, reason);
      setDeclining(false);
    });

  if (quote.status === 'accepted') {
    const accountId = accepted?.accountId ?? intake?.acceptedAccountId;
    return (
      <div className="mt-4 flex flex-col gap-2 rounded border border-success bg-success-soft p-3" data-testid={`accepted-${quote.id}`}>
        <p className="text-body font-medium text-ink">
          Accepted at {formatCents(quote.recurringCents)} a month.{' '}
          {accepted ? (accepted.created ? 'A new account was set up with delivery scheduled.' : 'The written price is on the existing customer\'s contract.') : ''}
        </p>
        {accountId ? (
          <p className="text-small text-ink">
            <Link className="font-semibold underline" to={`/office/account/${accountId}`}>Open account {accountId}</Link>
            {accepted && !accepted.created ? ' to change its service to match the quote.' : null}
          </p>
        ) : null}
      </div>
    );
  }
  if (quote.status !== 'draft') return null;

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4" data-testid={`commercial-actions-${quote.id}`}>
      {editing ? (
        <>
          <p className="text-small font-semibold text-ink">{sent ? 'Change the written price' : 'Write the price'}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-body">
              <thead>
                <tr className="text-left text-small text-ink-muted">
                  <th className="py-1 pr-3 font-medium">Container</th>
                  <th className="py-1 pr-3 font-medium">Pickups</th>
                  <th className="py-1 pr-3 font-medium">Rate card</th>
                  <th className="py-1 font-medium">Price per container</th>
                </tr>
              </thead>
              <tbody>
                {quote.lines.map((l, i) => (
                  <tr key={`${l.catalogId}-${i}`} className="border-t border-line">
                    <td className="py-2 pr-3">
                      {l.qty} x {view.catalog[l.catalogId]?.name ?? l.catalogId}
                      {intake?.lineMaterials?.[i] ? <span className="block text-small text-ink-muted">{intake.lineMaterials[i]}</span> : null}
                    </td>
                    <td className="py-2 pr-3">{frequencyLabel(l.frequency)}</td>
                    <td className="py-2 pr-3 text-ink-muted">{rates[i]?.rateCents ? `${formatCents(rates[i].rateCents!)}` : 'No published rate'}</td>
                    <td className="py-2">
                      <span className="flex items-center gap-1">
                        $
                        <TextInput
                          aria-label={`Price per ${view.catalog[l.catalogId]?.name ?? l.catalogId}`}
                          inputMode="decimal"
                          className="max-w-[140px]"
                          value={prices[i] ?? ''}
                          onChange={(e) => setPrices((p) => p.map((x, j) => (j === i ? e.target.value : x)))}
                        />
                        <span className="text-small text-ink-muted">{l.frequency === 'onCall' ? '/haul' : '/mo'}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PrimaryButton size="compact" onClick={send}>
              {sent ? 'Send new price' : 'Send written price'}
            </PrimaryButton>
            {sent ? (
              <SecondaryButton size="compact" onClick={() => setEditing(false)}>
                Cancel
              </SecondaryButton>
            ) : (
              <SecondaryButton size="compact" onClick={() => setDeclining(true)}>
                Decline request
              </SecondaryButton>
            )}
            <span className="text-small text-ink-muted">Total {formatCents(monthly)} before fees and tax.</span>
          </div>
        </>
      ) : (
        <>
          <p className="text-body text-ink" data-testid={`sent-${quote.id}`}>
            Written price sent {intake?.quotedAt ? formatDayTime(intake.quotedAt) : ''}: {formatCents(quote.recurringCents)} before fees and tax. Waiting on the customer.
          </p>
          <div className="flex flex-wrap gap-2">
            <PrimaryButton size="compact" onClick={accept}>
              Customer accepted
            </PrimaryButton>
            <SecondaryButton size="compact" onClick={() => setEditing(true)}>
              Change price
            </SecondaryButton>
            <SecondaryButton size="compact" onClick={() => setDeclining(true)}>
              Customer declined
            </SecondaryButton>
          </div>
        </>
      )}
      {declining ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Reason (one line)" htmlFor={`reason-${quote.id}`} className="min-w-0 flex-1">
            <TextInput
              id={`reason-${quote.id}`}
              value={reason}
              maxLength={140}
              autoFocus
              placeholder={sent ? 'Went with another hauler' : 'Outside our commercial routes'}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') decline();
                if (e.key === 'Escape') setDeclining(false);
              }}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <DangerButton size="compact" onClick={decline}>Decline</DangerButton>
            <SecondaryButton size="compact" onClick={() => setDeclining(false)}>
              Cancel
            </SecondaryButton>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="rounded border border-danger bg-danger-soft px-3 py-2 text-body text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Cell({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
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
  const view = useView();
  const intake = view.quoteIntake[quote.id];
  const catalog = view.catalog;
  const tokenId = savedTokenId(quote);
  const token = tokenId ? view.paymentTokens[tokenId] : undefined;
  const approval = useUi((s) => s.approvals[quote.id]);
  const payment = approval ? view.payments[approval.paymentId] : undefined;
  const showStatus = useShowStatus();

  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();

  const commercial = quote.kind === 'commercialRequest';
  const amounts = heldAmounts(quote, view);
  const pill = statusPill(quote.status);
  const card = cardLabel(token);
  const deadline = quote.holdDeadline
    ? formatDayTime(quote.holdDeadline)
    : commercial && quote.status === 'draft' && intake
      ? `Reply by ${formatDay(nextBusinessDay(datePart(intake.createdAt)))}`
      : 'None';

  function approve() {
    setError(undefined);
    try {
      useStore.getState().sfApproveHeldQuote(quote.id, OFFICE_APPROVER);
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
      useStore.getState().sfDeclineHeldQuote(quote.id, reason);
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
          <Pill tone={pill.tone}>{commercial && quote.status === 'draft' && intake?.quotedAt ? 'Price sent' : OFFICE_PILL[quote.status] ?? pill.label}</Pill>
        </div>
        {!commercial ? <LinkButton onClick={() => showStatus(quote.id)}>Customer status</LinkButton> : null}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-6">
        <Cell label="Kind">{KIND_LABEL[quote.kind]}</Cell>
        <Cell label="Address" className="md:col-span-2">
          {quote.address}
        </Cell>
        <Cell label={commercial ? 'Monthly' : 'Due today'}>
          {commercial ? (quote.recurringCents > 0 ? `${formatCents(quote.recurringCents)} a month` : 'Not priced yet') : formatCents(amounts.dueTodayCents)}
        </Cell>
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
              <Cell label={quote.lines.length > 1 ? 'Containers' : 'Container'}>
                {quote.lines.length
                  ? quote.lines.map((l) => `${l.qty} x ${catalog[l.catalogId]?.name ?? l.catalogId}, ${frequencyLabel(l.frequency)}`).join('; ')
                  : 'Not given'}
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

      {commercial ? <CommercialActions quote={quote} /> : null}

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
                Approve charges {formatCents(amounts.dueTodayCents)} to {card} and creates the account and cart delivery.
              </p>
            </div>
          )}
        </div>
      ) : null}

      {approval ? (
        <div className="mt-4 flex flex-col gap-3 rounded border border-success bg-success-soft p-3" data-testid={`approval-${quote.id}`}>
          <p className="text-body font-medium text-ink">
            Approved. Charged {formatCents(payment?.cents ?? amounts.dueTodayCents)} to {card}. Cart arrives {formatDay(approval.cartArrives)}, first
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
            <IdList label="Containers" ids={approval.containerIds} />
            <IdList label="Work orders" ids={approval.workOrderIds} />
            <IdList label="Payment" ids={[approval.paymentId]} />
            <IdList label="Charges (approved)" ids={approval.chargeIds} />
          </dl>
        </div>
      ) : null}

      {quote.status === 'declined' ? (
        <p className="mt-4 rounded border border-line bg-gray-100 px-3 py-2 text-body text-ink" data-testid={`declined-${quote.id}`}>
          {commercial ? 'Declined.' : 'Declined, card was not charged.'}{intake?.declineReason ? ` Reason: ${intake.declineReason}` : ''}
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

/** Office approvals: held signups to approve or decline, then every other quote. */
export function OfficeScreen() {
  const startOver = useStartOver();

  return (
    <main className="pb-16 pt-8 md:pt-16">
      <Container>
      <div className="flex flex-col gap-3">
        <Eyebrow>Office</Eyebrow>
        <h1 className="text-title font-bold text-ink">Office approvals</h1>
      </div>
      <div className="mt-6">
        <Approvals />
      </div>
      <SecondaryButton className="mt-8" onClick={startOver}>
        Back to the storefront
      </SecondaryButton>
      </Container>
    </main>
  );
}

function Approvals() {
  const quotes = useView().quotes;
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
