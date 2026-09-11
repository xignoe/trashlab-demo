import type { Zone } from '../types';
import { formatCents, formatPct } from '../lib/money';
import Pill, { type PillTone } from './Pill';

const SERVICEABILITY: Record<Zone['serviceability'], { label: string; tone: PillTone }> = {
  open: { label: 'open', tone: 'success' },
  boundary: { label: 'boundary', tone: 'warning' },
  franchise: { label: 'franchise', tone: 'accent' },
  notServed: { label: 'not served', tone: 'danger' },
};

function Toggle({ on, disabled, label, onChange }: { on: boolean; disabled: boolean; label: string; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={[
        'relative h-5 w-9 shrink-0 rounded-pill transition-colors',
        on ? 'bg-accent' : 'bg-line',
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
      ].join(' ')}
    >
      <span className={['absolute top-0.5 left-0.5 h-4 w-4 rounded-pill bg-surface shadow-card transition-transform', on ? 'translate-x-4' : ''].join(' ')} />
    </button>
  );
}

/** One row per Zone. The publicPricing toggle writes through setZonePublicPricing; a zone that is not
 *  served cannot be made public, so its toggle is disabled. */
export default function ZonesPanel({ zones, onPublicPricing }: { zones: Zone[]; onPublicPricing: (zoneId: string, publicPricing: boolean) => void }) {
  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <h2 className="text-h2 font-bold">Zones</h2>
      <p className="mt-0.5 text-small text-muted">Serviceability, tax, franchise fee, delivery fee, public pricing</p>
      <ul className="mt-2">
        {zones.map((z) => {
          const s = SERVICEABILITY[z.serviceability];
          const notServed = z.serviceability === 'notServed';
          return (
            <li key={z.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={['text-body font-semibold', notServed ? 'text-muted' : 'text-ink'].join(' ')}>{z.name}</span>
                  <Pill tone={s.tone}>{s.label}</Pill>
                </div>
                <p className="text-small text-muted">
                  tax {formatPct(z.taxRatePct)}, franchise {formatPct(z.franchiseFeePct)}, delivery {formatCents(z.deliveryFeeCents)}
                </p>
              </div>
              <div className="flex items-center gap-1.5" title={notServed ? 'Not served zones cannot be published' : 'Show these prices on the public storefront'}>
                <span className={['text-eyebrow', notServed ? 'text-muted/60' : 'text-muted'].join(' ')}>public</span>
                <Toggle on={z.publicPricing} disabled={notServed} label={`Public pricing for ${z.name}`} onChange={(next) => onPublicPricing(z.id, next)} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
