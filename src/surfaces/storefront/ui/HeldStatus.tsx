// Customer status for one quote, reachable by quote id at /customer/store/status/<quoteId>. Held shows the reason,
// the text-back deadline, the preserved price, and the expiry; approved shows the cart and first pickup days with
// nothing left for the buyer to do; declined says the card was not charged.
import { Link, useParams } from 'react-router-dom';
import { dayBefore, formatDay, formatDayTime } from '../lib/clock';
import { heldAmounts, savedTokenId } from '../lib/held';
import { formatCents } from '../lib/money';
import { frequencyLabel } from '../lib/offer';
import { statusPath, statusUrl } from '../lib/paths';
import { cardLabel } from './CardWidget';
import { MoneyRow, Panel, Pill, PrimaryButton, StatBlock } from './components';
import { useStartOver, useUi, useView } from './hooks';
import { statusPill } from './quoteStatus';

export function HeldStatusScreen() {
  const { quoteId } = useParams();
  const startOver = useStartOver();
  const approval = useUi((s) => (quoteId ? s.approvals[quoteId] : undefined));
  const view = useView();
  const quote = quoteId ? view.quotes[quoteId] : undefined;
  const intake = quoteId ? view.quoteIntake[quoteId] : undefined;
  const tokenId = quote ? savedTokenId(quote) : undefined;
  const token = tokenId ? view.paymentTokens[tokenId] : undefined;
  const payment = approval ? view.payments[approval.paymentId] : undefined;

  if (!quoteId || !quote) {
    return (
      <main className="mx-auto w-full max-w-[560px] px-4 pb-12 pt-12 md:pt-[120px]">
        <Pill tone="neutral">Status</Pill>
        <h1 className="mt-4 text-title font-bold text-ink">We could not find that request.</h1>
        <p className="mt-4 text-body text-ink-muted">
          Nothing matches "{quoteId ?? ''}". Check the link you saved, or start again with your address.
        </p>
        <PrimaryButton className="mt-6" onClick={startOver}>
          Back to the address
        </PrimaryButton>
      </main>
    );
  }

  const amounts = heldAmounts(quote, view);
  const pill = statusPill(quote.status);
  const card = cardLabel(token);
  const reason = quote.holdReason ?? 'confirm service at this address';
  const startDate = approval?.firstPickup ?? intake?.startDate;
  const commercial = quote.kind === 'commercialRequest';

  let heading: string;
  let body: string;
  if (commercial) {
    heading = `Request ${quote.id} received.`;
    body = 'A person is writing your price and will reply by email. Nothing has been charged.';
  } else if (quote.status === 'accepted') {
    heading = startDate ? `Approved. Cart arrives ${formatDay(dayBefore(startDate))}, first pickup ${formatDay(startDate)}.` : 'Approved.';
    body = `We charged ${formatCents(payment?.cents ?? amounts.dueTodayCents)} to ${card} for the first quarter and cart delivery. There is nothing else you need to do.`;
  } else if (quote.status === 'declined') {
    heading = "We can't start service at this address.";
    body = `${intake?.declineReason ? `Reason: ${intake.declineReason}. ` : ''}Your card was not charged.`;
  } else {
    heading = 'Your price is held while we confirm your address.';
    body = `We need to ${reason} before we start. Your card is saved, not charged.`;
  }

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 pb-12 pt-12 md:pt-[96px]">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={pill.tone}>{pill.label}</Pill>
        <span className="break-all text-small text-ink-muted">Quote {quote.id}</span>
      </div>
      <h1 className="mt-4 text-title font-bold text-ink" data-testid="status-heading">
        {heading}
      </h1>
      <p className="mt-4 text-body text-ink-muted">{body}</p>

      {quote.status === 'held' && quote.holdDeadline ? (
        <p className="mt-6 rounded-lg border border-warning bg-warning-soft px-4 py-3 text-body font-medium text-ink" data-testid="status-deadline">
          We will text you by {formatDayTime(quote.holdDeadline)}
          {intake?.contact.phone ? ` at ${intake.contact.phone}` : ''}.
        </p>
      ) : null}

      <Panel className="mt-8 flex flex-col gap-3" aria-label={commercial ? 'Your request' : 'Your preserved price'}>
        <h2 className="text-heading font-bold text-ink">{commercial ? 'Your request' : 'Your preserved price'}</h2>
        <dl className="flex flex-col gap-2 text-body">
          <div className="flex flex-wrap justify-between gap-x-4">
            <dt className="text-ink-muted">Address</dt>
            <dd className="text-ink">{quote.address}</dd>
          </div>
          {!commercial ? (
            <div className="flex flex-wrap justify-between gap-x-4">
              <dt className="text-ink-muted">Reason for review</dt>
              <dd className="text-ink">{reason.charAt(0).toUpperCase() + reason.slice(1)}</dd>
            </div>
          ) : null}
        </dl>
        {!commercial ? (
          <>
            <div className="flex flex-col gap-2 border-t border-line pt-3">
              {quote.lines.map((line) => (
                <MoneyRow
                  key={line.catalogId}
                  label={`${view.catalog[line.catalogId]?.name ?? line.catalogId}, ${frequencyLabel(line.frequency)}`}
                  value={`${formatCents(line.priceCents * line.qty)}/mo`}
                />
              ))}
              <MoneyRow label="Then every quarter" value={formatCents(amounts.recurringCents)} />
            </div>
            <StatBlock label={quote.status === 'accepted' ? 'Paid' : 'Due when approved'} amount={formatCents(payment?.cents ?? amounts.dueTodayCents)} />
            <p className="text-small text-ink-muted">
              {quote.status === 'held'
                ? `This price is held until ${formatDay(quote.expiresAt)}. ${card.charAt(0).toUpperCase() + card.slice(1)} is saved, not charged.`
                : quote.status === 'accepted'
                  ? `Paid with ${card}.`
                  : `${quote.status === 'expired' ? 'This price has expired. ' : ''}${card.charAt(0).toUpperCase() + card.slice(1)} was not charged.`}
            </p>
          </>
        ) : null}
      </Panel>

      <p className="mt-6 text-small text-ink-muted">
        View this status again any time:{' '}
        <Link to={statusPath(quote.id)} className="break-all font-medium text-accent underline underline-offset-2 hover:text-accent-strong">
          {statusUrl(quote.id)}
        </Link>
      </p>

      <PrimaryButton className="mt-8" onClick={startOver}>
        Start over
      </PrimaryButton>
    </main>
  );
}
