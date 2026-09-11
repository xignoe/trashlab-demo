import type { Zone } from '../../types';
import type { AddressMatch } from '../../lib/quote';
import { formatCents, formatPct } from '../../lib/money';
import Pill, { type PillTone } from '../Pill';

const SERVICEABILITY: Record<Zone['serviceability'], { label: string; tone: PillTone }> = {
  open: { label: 'open', tone: 'success' },
  boundary: { label: 'boundary', tone: 'warning' },
  franchise: { label: 'franchise', tone: 'accent' },
  notServed: { label: 'not served', tone: 'danger' },
};

const SOURCE: Record<AddressMatch['zoneSource'], string> = {
  site: 'from the matched site',
  request: 'from the pricing request',
  addressText: 'inferred from the address text',
  default: 'default for an address with no site',
};

/** Zone the address falls in, with its fees. Not served and franchise zones warn that the public ratebook
 *  cannot be quoted there. */
export default function ZoneMatchCard({ zone, match }: { zone: Zone | undefined; match: AddressMatch }) {
  if (!zone) {
    return (
      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="text-h2 font-bold">Zone match</h2>
        <p className="mt-2 text-small text-danger">Zone {match.zoneId} is not in the zone table.</p>
      </section>
    );
  }
  const s = SERVICEABILITY[zone.serviceability];
  const noPublic = zone.serviceability === 'notServed' || zone.serviceability === 'franchise';
  const rows: [string, string][] = [
    ['Tax rate', formatPct(zone.taxRatePct)],
    ['Franchise fee', formatPct(zone.franchiseFeePct)],
    ['Delivery fee', formatCents(zone.deliveryFeeCents)],
    ['Public pricing', zone.publicPricing ? 'on' : 'off'],
  ];
  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card" aria-label="Zone match">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-h2 font-bold">Zone match</h2>
          <p className="mt-0.5 text-small text-muted">{SOURCE[match.zoneSource]}</p>
        </div>
        <Pill tone={s.tone} dot>
          {s.label}
        </Pill>
      </div>
      <p className="mt-3 text-h1 font-bold tracking-tight">{zone.name}</p>
      <p className="font-mono text-mono text-muted">{zone.id}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-2 border-b border-line pb-1">
            <dt className="text-small text-muted">{k}</dt>
            <dd className="font-mono text-mono text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      {noPublic && (
        <p className="mt-3 rounded-sm border-l-[3px] border-warning bg-warning-soft px-3 py-2 text-small text-ink" role="note">
          {zone.serviceability === 'notServed'
            ? 'This address is outside the service area. The ratebook cannot be quoted publicly here; any price is a private exception.'
            : 'Franchise zone: the ratebook cannot be quoted publicly here. Price it privately and remember the franchise fee on gross receipts.'}
        </p>
      )}
      {!noPublic && !zone.publicPricing && (
        <p className="mt-3 text-small text-muted">Public pricing is switched off for this zone in the Ratebook, so this price is not shown on the storefront.</p>
      )}
    </section>
  );
}
