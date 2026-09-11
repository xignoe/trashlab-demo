import { Link } from 'react-router-dom';
import type { Contract, Frequency, Quote } from '../../types';
import { FREQUENCY_LABEL } from '../../store/engine';
import { formatCents, formatPct } from '../../lib/money';
import Pill from '../Pill';

export interface SavedQuote {
  catalogName: string;
  catalogId: string;
  frequency: Frequency;
  quote?: Quote;
  contract?: Contract;
  /** The last matching override on the returned contract, read back after the save. */
  override?: Contract['overrides'][number];
  createdContract: boolean;
  overrideCount: number;
}

/** What Save just wrote, read back from the store's return values. */
export default function SaveConfirmation({ saved, onDismiss }: { saved: SavedQuote; onDismiss: () => void }) {
  const { override, contract, quote } = saved;
  return (
    <section className="rounded-card border border-line border-l-[3px] border-l-success bg-surface p-5 shadow-card" aria-label="Saved" role="status">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-success">Saved</p>
          <h2 className="mt-0.5 text-h2 font-bold">{override ? 'Exception saved as a contract override' : 'Pricing request priced'}</h2>
        </div>
        <button type="button" onClick={onDismiss} className="rounded-md px-2 py-1 text-small font-semibold text-muted hover:text-ink">
          Dismiss
        </button>
      </div>

      {override && contract && (
        <dl className="mt-3 grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-body" data-testid="saved-override">
          <dt className="text-muted">Contract</dt>
          <dd className="flex items-center gap-2 font-mono text-mono">
            {contract.id}
            {saved.createdContract && <Pill tone="accent">new, {contract.termStart} to {contract.termEnd}</Pill>}
          </dd>
          <dt className="text-muted">Catalog item</dt>
          <dd>
            {saved.catalogName} <span className="font-mono text-mono text-muted">{override.catalogId}</span>
          </dd>
          <dt className="text-muted">Frequency</dt>
          <dd>{override.frequency ? FREQUENCY_LABEL[override.frequency] : 'any'}</dd>
          <dt className="text-muted">Price</dt>
          <dd className="font-mono text-mono font-semibold">{formatCents(override.priceCents)}</dd>
          <dt className="text-muted">pctBelowRateCard</dt>
          <dd className="font-mono text-mono font-semibold">{override.pctBelowRateCard !== undefined ? formatPct(override.pctBelowRateCard) : 'not set'}</dd>
          <dt className="text-muted">Reason</dt>
          <dd>{override.reason ?? 'none'}</dd>
        </dl>
      )}
      {override && saved.overrideCount > 1 && (
        <p className="mt-2 text-small text-muted">
          {contract?.id} now has {saved.overrideCount} overrides for this item and frequency. The latest is the one billed; earlier rows are kept as history.
        </p>
      )}

      {quote && (
        <div className="mt-3 rounded-sm bg-surface-muted px-3 py-2">
          <p className="text-small font-semibold text-ink">
            Pricing request <span className="font-mono text-mono">{quote.id}</span>, {quote.status}, created via {quote.createdVia}
          </p>
          <ul className="mt-1 text-small text-ink">
            {quote.lines.map((l) => (
              <li key={`${l.catalogId}-${l.frequency}`} className="font-mono text-mono">
                {l.qty} x {l.catalogId}, {FREQUENCY_LABEL[l.frequency]}, {formatCents(l.priceCents)}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-small text-muted">recurringCents {quote.recurringCents} ({formatCents(quote.recurringCents)} a month)</p>
        </div>
      )}

      <Link to="/pricing" className="mt-3 inline-block text-body font-semibold text-accent hover:underline">
        Back to the Ratebook
      </Link>
    </section>
  );
}
