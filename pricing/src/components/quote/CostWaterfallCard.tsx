import type { Frequency } from '../../types';
import type { CostToServe, Material } from '../../store/costToServe';
import { MATERIAL_LABEL } from '../../store/costToServe';
import { FREQUENCY_LABEL } from '../../store/engine';
import { formatCents, formatPct } from '../../lib/money';
import Pill from '../Pill';

export interface PricePoint {
  label: string;
  cents: number;
}

const fmtNum = (n: number, digits = 2): string => Number(n.toFixed(digits)).toLocaleString('en-US', { maximumFractionDigits: digits });

/** Cost to serve per container per month, line by line, with the floor (minimum defensible, which is full
 *  cost) and the target price. Any price point below full cost gets a "Below cost to serve" pill. */
export default function CostWaterfallCard({
  cost, material, frequency, truckDayCostCents, pricePoints,
}: {
  cost: CostToServe;
  material: Material;
  frequency: Frequency;
  truckDayCostCents: number;
  pricePoints: PricePoint[];
}) {
  const below = pricePoints.filter((p) => p.cents < cost.fullCostCents);
  const scaleMax = Math.max(cost.targetPriceCents, ...pricePoints.map((p) => p.cents)) * 1.04;
  const pctOf = (c: number) => `${Math.max(0, Math.min(100, (c / scaleMax) * 100))}%`;
  const segments = [
    { label: 'Truck and labor', cents: cost.monthlyTruckCents, cls: 'bg-accent' },
    { label: 'Disposal', cents: cost.disposalCents, cls: 'bg-info' },
    { label: 'Indirect', cents: cost.indirectCents, cls: 'bg-muted' },
    { label: 'Target margin', cents: cost.marginCents, cls: 'bg-success' },
  ];

  const rows: { label: string; detail?: string; value: string; strong?: boolean; rule?: boolean }[] = [
    {
      label: 'Truck and labor per lift',
      detail: `${formatCents(truckDayCostCents)} a day / ${fmtNum(cost.effectiveLiftsPerDay, 1)} effective lifts a day${cost.extraMinutesPerLift ? ` (${fmtNum(cost.baseMinutesPerLift, 1)} + ${fmtNum(cost.extraMinutesPerLift, 1)} access min per lift)` : ''}${cost.liftsPerDaySource === 'residentialStopsPerDay' ? ', residential stops' : cost.liftsPerDaySource === 'rolloffHaulsPerDay' ? ', rolloff hauls' : ''}`,
      value: formatCents(cost.truckPerLiftCents),
    },
    { label: 'Lifts per month', detail: FREQUENCY_LABEL[frequency], value: fmtNum(cost.liftsPerMonth) },
    { label: 'Monthly truck and labor', value: formatCents(cost.monthlyTruckCents) },
    {
      label: 'Disposal',
      detail: `${fmtNum(cost.lbPerLift, 1)} lb per lift (${fmtNum(cost.yards)} yd x ${cost.lbPerYard} lb/yd ${MATERIAL_LABEL[material].toLowerCase()}), ${fmtNum(cost.tonsPerMonth, 3)} tons a month at ${formatCents(cost.tipFeeCentsPerTon)}/ton`,
      value: formatCents(cost.disposalCents),
    },
    { label: 'Direct cost', value: formatCents(cost.directCents), rule: true },
    { label: `Indirect (${formatPct(cost.indirectPct)} of direct)`, value: formatCents(cost.indirectCents) },
    { label: 'Full cost to serve', value: formatCents(cost.fullCostCents), strong: true, rule: true },
    { label: `Target margin (${formatPct(cost.targetMarginPct)} of price)`, value: formatCents(cost.marginCents) },
    { label: 'Target price', detail: 'full cost / (1 - margin)', value: formatCents(cost.targetPriceCents), strong: true },
  ];

  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card" aria-label="Cost to serve">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-h2 font-bold">Cost to serve</h2>
          <p className="mt-0.5 text-small text-muted">Per container per month, from the assumptions panel</p>
        </div>
        <p className="text-small text-muted">
          Target range <span className="font-mono text-mono font-semibold text-ink">{formatCents(cost.fullCostCents)}</span> to{' '}
          <span className="font-mono text-mono font-semibold text-ink">{formatCents(cost.targetPriceCents)}</span>
        </p>
      </div>

      <div className="mt-4" aria-hidden="true">
        <div className="flex h-3 overflow-hidden rounded-pill bg-surface-muted">
          {segments.map((s) => (
            <span key={s.label} className={s.cls} style={{ width: pctOf(s.cents) }} title={`${s.label} ${formatCents(s.cents)}`} />
          ))}
        </div>
        <div className="relative mt-1 h-10">
          {pricePoints.map((p, i) => (
            <span key={p.label} className="absolute flex -translate-x-1/2 flex-col items-center" style={{ left: pctOf(p.cents), top: i % 2 === 0 ? 0 : 18 }}>
              <span className={['h-2 w-0.5', p.cents < cost.fullCostCents ? 'bg-danger' : 'bg-ink'].join(' ')} />
              <span className={['whitespace-nowrap text-eyebrow font-semibold', p.cents < cost.fullCostCents ? 'text-danger' : 'text-ink'].join(' ')}>
                {p.label} {formatCents(p.cents)}
              </span>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 text-eyebrow text-muted">
          {segments.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1">
              <span className={`h-2 w-2 rounded-pill ${s.cls}`} />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      <dl className="mt-3">
        {rows.map((r) => (
          <div key={r.label} className={['flex items-baseline justify-between gap-4 py-1.5', r.rule ? 'border-t border-line' : ''].join(' ')}>
            <dt className="min-w-0">
              <span className={r.strong ? 'text-body font-bold text-ink' : 'text-body text-ink'}>{r.label}</span>
              {r.detail && <span className="block text-small text-muted">{r.detail}</span>}
            </dt>
            <dd className={['shrink-0 font-mono', r.strong ? 'text-body font-bold' : 'text-mono', 'text-ink'].join(' ')}>{r.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-sm bg-surface-muted px-3 py-2.5">
        <div>
          <p className="text-body font-bold text-ink">Minimum defensible price</p>
          <p className="text-small text-muted">Full cost to serve with no margin. Below this the truck loses money on every lift.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="font-mono text-body font-bold text-ink" data-testid="minimum-defensible">
            {formatCents(cost.minimumDefensibleCents)}
          </span>
          {below.length > 0 ? (
            <Pill tone="danger" dot title={below.map((p) => `${p.label} ${formatCents(p.cents)}`).join(', ')}>
              Below cost to serve: {below.map((p) => p.label.toLowerCase()).join(', ')}
            </Pill>
          ) : (
            <Pill tone="success" dot>
              Prices cover cost
            </Pill>
          )}
        </div>
      </div>
    </section>
  );
}
