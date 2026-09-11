import { useState, type FormEvent } from 'react';
import type { Zone } from '../types';
import { FREQUENCY_LABEL } from '../store/engine';
import { firstOfNextMonth } from '../store/dates';
import { formatCents } from '../lib/money';
import { zoneLabel, type CatalogLine } from '../lib/ratebook';

export interface NewDraftValues {
  priceCents: number;
  effectiveFrom: string;
}

/** "29.00" -> 2900. Returns null for anything that is not a non negative dollar amount. Scaling by 100
 *  and rounding keeps 29.99 exact (29.99 * 100 is 2998.9999 in binary floating point). */
export function dollarsToCents(text: string): number | null {
  const trimmed = text.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

const centsToDollarsText = (cents: number): string => (cents / 100).toFixed(2);

const INPUT = 'h-9 w-full rounded-sm border border-line bg-surface px-2.5 font-mono text-mono text-ink outline-none focus:border-accent';

/** Inline draft form for one catalog line. The price is typed in dollars and stored as cents; effectiveFrom
 *  defaults to the first of next month; the version it supersedes is shown read only so the owner sees that
 *  a draft never edits the published row, it queues a successor to it. */
export default function NewDraftForm({
  line, itemName, zones, today, onSubmit, onCancel,
}: {
  line: CatalogLine;
  itemName: string;
  zones: Zone[];
  today: string;
  onSubmit: (values: NewDraftValues) => void;
  onCancel: () => void;
}) {
  const current = line.current;
  const [price, setPrice] = useState(current ? centsToDollarsText(current.priceCents) : '');
  const [effectiveFrom, setEffectiveFrom] = useState(firstOfNextMonth(today));
  const [error, setError] = useState<string | null>(null);

  const cents = dollarsToCents(price);
  const delta = cents !== null && current ? cents - current.priceCents : null;
  const deltaPct = delta !== null && current && current.priceCents > 0 ? (delta / current.priceCents) * 100 : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (cents === null || cents <= 0) {
      setError('Enter a price in dollars, for example 30.16');
      return;
    }
    if (current && cents === current.priceCents) {
      setError(`No change: ${formatCents(cents)} is already the price of ${current.id}. A draft must change the price to be published.`);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
      setError('Enter an effective date');
      return;
    }
    if (effectiveFrom < today) {
      setError(`Effective date cannot be before today (${today}); a version never rewrites past billing`);
      return;
    }
    setError(null);
    onSubmit({ priceCents: cents, effectiveFrom });
  };

  return (
    <li className="border-b border-line bg-surface-muted px-5 py-3">
      <form onSubmit={submit} className="ml-4 rounded-card border-l-[3px] border-accent bg-surface p-4 shadow-card" aria-label={`New draft for ${itemName}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-accent">New draft</p>
            <p className="mt-0.5 text-body font-semibold text-ink">
              {itemName}, {zoneLabel(zones, line.zoneId)}, {line.frequency ? FREQUENCY_LABEL[line.frequency] : 'any frequency'}
            </p>
          </div>
          <p className="text-small text-muted">A draft changes nothing until it is published as a new version.</p>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[160px_180px_minmax(0,1fr)]">
          <label className="block">
            <span className="text-small font-semibold text-muted">Price (dollars)</span>
            <div className="relative mt-1">
              <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center font-mono text-mono text-muted">$</span>
              <input
                type="text"
                inputMode="decimal"
                autoFocus
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                aria-label="Draft price in dollars"
                className={`${INPUT} pl-6`}
              />
            </div>
            <span className="mt-1 block font-mono text-eyebrow text-muted">
              {cents !== null ? `stored as ${cents} cents` : 'dollars and cents only'}
              {delta === 0 && ', no change from the current price'}
              {delta !== null && deltaPct !== null && delta !== 0 && (
                <>
                  {', '}
                  {delta > 0 ? '+' : ''}
                  {formatCents(delta)} ({delta > 0 ? '+' : ''}
                  {deltaPct.toFixed(1)}%)
                </>
              )}
            </span>
          </label>
          <label className="block">
            <span className="text-small font-semibold text-muted">Effective from</span>
            <input type="date" value={effectiveFrom} min={today} onChange={(e) => setEffectiveFrom(e.target.value)} aria-label="Draft effective from" className={`mt-1 ${INPUT}`} />
            <span className="mt-1 block font-mono text-eyebrow text-muted">default first of next month</span>
          </label>
          <div className="block">
            <span className="text-small font-semibold text-muted">Supersedes</span>
            <p className="mt-1 flex h-9 items-center rounded-sm border border-dashed border-line bg-surface-muted px-2.5 font-mono text-mono text-ink" aria-readonly="true">
              {current ? (
                <span className="truncate" title={current.id}>
                  {current.id} <span className="text-muted">({formatCents(current.priceCents)}, {current.status})</span>
                </span>
              ) : (
                <span className="text-muted">none, first version for this line</span>
              )}
            </p>
            <span className="mt-1 block font-mono text-eyebrow text-muted">read only, the superseded version is never edited</span>
          </div>
        </div>

        {error && <p className="mt-2 text-small font-semibold text-danger" role="alert">{error}</p>}

        <div className="mt-3 flex items-center gap-2">
          <button type="submit" className="rounded-md bg-accent px-3.5 py-2 text-mono font-semibold text-surface hover:bg-accent-strong">
            Create draft
          </button>
          <button type="button" onClick={onCancel} className="rounded-md border border-line bg-surface px-3.5 py-2 text-mono font-semibold text-muted hover:text-ink">
            Cancel
          </button>
        </div>
      </form>
    </li>
  );
}
