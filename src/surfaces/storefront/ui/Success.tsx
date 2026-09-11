// Success: the two dates the buyer cares about, then the ids the signup created, what was paid, and
// what recurs. Everything here is read back from the Db and the slice, not from the form.
import { formatDay } from '../lib/clock';
import { formatCents } from '../lib/money';
import { frequencyLabel } from '../lib/offer';
import { MoneyRow, Panel, Pill, PrimaryButton } from './components';
import { useStartOver, useUi, useView } from './hooks';

export function SuccessScreen() {
  const signup = useUi((s) => s.signup);
  const autopay = useUi((s) => s.autopay);
  const startOver = useStartOver();
  const view = useView();
  const payment = signup ? view.payments[signup.result.paymentId] : undefined;
  const token = signup ? view.paymentTokens[signup.tokenId] : undefined;
  const site = signup ? view.sites[signup.result.siteId] : undefined;

  if (!signup) {
    return (
      <main className="mx-auto w-full max-w-[560px] px-4 pt-12">
        <p className="text-body text-ink-muted">There is no finished signup to show yet. Start with your address.</p>
        <PrimaryButton className="mt-4" onClick={startOver}>
          Start over
        </PrimaryButton>
      </main>
    );
  }

  const { result, offer } = signup;
  const brand = token ? token.brand.charAt(0).toUpperCase() + token.brand.slice(1) : 'Card';

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 pb-12 pt-12 md:pt-[96px]">
      <Pill tone="success">Service active</Pill>
      <h1 className="mt-4 text-title font-bold text-ink">
        Cart arrives {formatDay(result.cartArrives)}, first pickup {formatDay(result.firstPickup)}.
      </h1>
      <p className="mt-4 text-body text-ink-muted">
        Your receipt is on its way to the email you gave us. We text the day before the cart arrives
        {site ? ` at ${site.address}` : ''}.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel className="flex flex-col gap-3" aria-label="Your account">
          <h2 className="text-heading font-bold text-ink">Your account</h2>
          <dl className="flex flex-col gap-2 text-body">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Account</dt>
              <dd className="font-medium text-ink">{result.accountId}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Site</dt>
              <dd className="font-medium text-ink">{result.siteId}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-ink-muted">Cart delivery work orders</dt>
              <dd className="flex flex-wrap gap-2">
                {result.workOrderIds.map((id) => (
                  <Pill key={id} tone="accent">
                    {id}
                  </Pill>
                ))}
              </dd>
            </div>
          </dl>
        </Panel>

        <Panel className="flex flex-col gap-3" aria-label="What you paid">
          <h2 className="text-heading font-bold text-ink">What you paid</h2>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-body text-ink">
              {brand} ending {token?.last4 ?? ''}
            </span>
            <span className="text-stat font-bold tabular-nums text-ink">{formatCents(payment?.cents ?? offer.dueTodayCents)}</span>
          </div>
          <p className="text-small text-ink-muted">
            First quarter {formatDay(offer.period.start)} to {formatDay(offer.period.end)}, plus one-time cart delivery. Payment{' '}
            {result.paymentId}, settled.
          </p>
        </Panel>
      </div>

      <Panel className="mt-4 flex flex-col gap-3" aria-label="What recurs">
        <h2 className="text-heading font-bold text-ink">What recurs</h2>
        {offer.lines.map((line) => (
          <MoneyRow key={line.catalogId} label={`${line.name}, ${frequencyLabel(line.frequency)}`} value={`${formatCents(line.monthlyCents)}/mo`} />
        ))}
        <MoneyRow label="Every quarter, fees and tax included" value={formatCents(offer.recurringQuarterlyCents)} className="border-t border-line pt-3" />
        <p className="text-small text-ink-muted">
          About {formatCents(offer.recurringMonthlyEquivalentCents)} a month. Next bill covers {formatDay(offer.period.end)} onward and is charged{' '}
          {autopay ? 'automatically to the card above' : 'when you pay the emailed invoice'}.
        </p>
      </Panel>

      <PrimaryButton className="mt-8" onClick={startOver}>
        Start over
      </PrimaryButton>
    </main>
  );
}
