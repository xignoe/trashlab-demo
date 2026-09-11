// The live price panel, drawn as the ES-0 price card: white, 32px radius, 32px padding (24px on phones), lines
// at 15/22, and the amount due as the indigo stat block. Every number comes from the Offer that buildOffer
// returned; the fee labels come from the FeeRules that fired and the tax label from the zone's rate.
import { formatDay } from '../store/clock';
import { formatCents } from '../store/money';
import { frequencyLabel, type Offer } from '../store/offer';
import { useStore } from '../store/store';
import { cx, Pill, StatBlock } from './components';
import { feeLabel, feeTotals } from './hooks';

export const BILLING_SENTENCE = 'Billed quarterly in advance. Prices resolved from the published rate card for your zone.';
export const CONDITIONS_NOTE =
  'Conditions that can change the amount: extra material left beside the cart, or contamination in the recycling cart, is charged per event at the published rate.';

/** A price line. Service lines are 16/24 (`service`), fee lines 15/22, as in ES-0. */
function Row({ label, value, service }: { label: string; value: string; service?: boolean }) {
  return (
    <div className={cx('flex items-baseline justify-between gap-4', service ? 'text-body' : 'text-row')}>
      <span className="text-ink">{label}</span>
      <span className="tabular-nums text-ink">{value}</span>
    </div>
  );
}

export function PricePanel({ offer, className }: { offer: Offer; className?: string }) {
  const feeRules = useStore((s) => s.feeRules);
  const zone = useStore((s) => s.zones[offer.zoneId]);
  const fees = feeTotals(offer);

  return (
    <section className={cx('flex flex-col gap-4 rounded-xl border border-line bg-surface p-6 md:p-8', className)} aria-label="Your price">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-heading font-bold text-ink">Your price</h2>
        {offer.provisional ? <Pill tone="warning">Provisional price</Pill> : null}
      </div>

      <div className="flex flex-col gap-4 border-b border-line pb-4" aria-label="Service lines">
        {offer.lines.map((line) => (
          <Row key={line.catalogId} label={`${line.name}, ${frequencyLabel(line.frequency)}`} value={`${formatCents(line.monthlyCents)}/mo`} service />
        ))}
      </div>

      <div className="flex flex-col gap-2" aria-label="First quarter fee stack">
        <p className="text-label font-semibold text-ink-muted">
          First quarter, {formatDay(offer.period.start)} to {formatDay(offer.period.end)}
        </p>
        <Row label="Service, 3 months" value={formatCents(offer.feeBreakdown.base)} />
        <Row label="One-time cart delivery" value={formatCents(offer.feeBreakdown.delivery)} />
        {offer.rules.feeRuleIds.map((id) => {
          const rule = feeRules[id];
          return <Row key={id} label={rule ? feeLabel(rule) : id} value={formatCents(fees[id] ?? 0)} />;
        })}
        <Row label={`Estimated tax, ${zone?.taxRatePct ?? 0}%`} value={formatCents(offer.feeBreakdown.tax)} />
      </div>

      <StatBlock className="mt-2" label={offer.provisional ? 'Due when approved' : 'Due today'} amount={formatCents(offer.dueTodayCents)} amountTestId="due-today">
        <span>
          Then every quarter <span className="font-semibold tabular-nums text-on-brand" data-testid="recurring-quarterly">{formatCents(offer.recurringQuarterlyCents)}</span>
        </span>
        <span>About {formatCents(offer.recurringMonthlyEquivalentCents)} a month, all in</span>
      </StatBlock>

      <div className="flex flex-col gap-2">
        <p className="text-small text-ink-muted">{BILLING_SENTENCE}</p>
        <p className="text-small text-ink-muted">{CONDITIONS_NOTE}</p>
      </div>
    </section>
  );
}
