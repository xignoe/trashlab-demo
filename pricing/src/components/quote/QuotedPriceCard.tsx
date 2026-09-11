import { useId } from 'react';
import { EXCEPTION_REASONS, type ExceptionReason, type ExceptionSummary, type SavePlan } from '../../lib/quote';
import { formatCents } from '../../lib/money';

const REASON_LABEL: Record<ExceptionReason, string> = {
  'competitive match': 'Competitive match',
  'route density': 'Route density',
  'strategic account': 'Strategic account',
  'relationship save': 'Relationship save',
  other: 'Other (add a note)',
};

/** The dark quoted-price card from artboard 17F-0. Typing a price below the ratebook shows how far below and
 *  what it costs a year, and Save stays disabled until a reason is chosen. The plan lists every write. */
export default function QuotedPriceCard({
  quotedText, onQuotedText, qty, summary, ratebookCents, listCents, reason, onReason, note, onNote, plan, onSave, alreadySaved,
}: {
  quotedText: string;
  onQuotedText: (t: string) => void;
  qty: number;
  summary: ExceptionSummary | undefined;
  ratebookCents: number | null;
  listCents: number | null;
  reason: ExceptionReason | '';
  onReason: (r: ExceptionReason | '') => void;
  note: string;
  onNote: (n: string) => void;
  plan: SavePlan;
  onSave: () => void;
  alreadySaved: boolean;
}) {
  const priceId = useId();
  const reasonId = useId();
  const noteId = useId();
  const below = summary?.kind === 'below';
  const contractList = listCents !== null && ratebookCents !== null && listCents !== ratebookCents;

  return (
    <section className="rounded-card bg-accent-strong p-5 text-surface shadow-raised" aria-label="Quoted price">
      <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-accent-soft">Quoted price</p>
      <div className="mt-2 flex flex-wrap items-end gap-4">
        <label htmlFor={priceId} className="block">
          <span className="text-small font-semibold text-accent-soft">Price per container per month</span>
          <div className="relative mt-1">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-h2 text-muted">$</span>
            <input
              id={priceId}
              type="text"
              inputMode="decimal"
              value={quotedText}
              onChange={(e) => onQuotedText(e.target.value)}
              className="h-12 w-[180px] rounded-md border border-line bg-surface pr-3 pl-7 font-mono text-h1 font-bold text-ink outline-none focus:border-accent"
            />
          </div>
        </label>
        <div className="min-w-0 flex-1 pb-1">
          <p className={['text-h2 font-bold', below ? 'text-warning' : 'text-surface'].join(' ')} data-testid="exception-line">
            {summary ? summary.text : 'Enter a price in dollars'}
          </p>
          <p className="text-small text-accent-soft">
            {ratebookCents !== null ? `Ratebook ${formatCents(ratebookCents)}` : 'No ratebook price'}
            {contractList && listCents !== null ? `, current contract ${formatCents(listCents)}` : ''}
            {qty > 1 ? `, qty ${qty}` : ''}. Measured against the ratebook, not the contract.
          </p>
        </div>
      </div>

      {below && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[220px_minmax(0,1fr)]">
          <label htmlFor={reasonId} className="block">
            <span className="text-small font-semibold text-accent-soft">
              Reason <span className="text-warning">required</span>
            </span>
            <select
              id={reasonId}
              value={reason}
              onChange={(e) => onReason(e.target.value as ExceptionReason | '')}
              className="mt-1 h-10 w-full rounded-sm border border-line bg-surface px-2.5 text-body text-ink outline-none focus:border-accent"
            >
              <option value="">Choose a reason</option>
              {EXCEPTION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {REASON_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          {reason === 'other' && (
            <label htmlFor={noteId} className="block">
              <span className="text-small font-semibold text-accent-soft">
                Note <span className="text-warning">required for other</span>
              </span>
              <input
                id={noteId}
                type="text"
                value={note}
                onChange={(e) => onNote(e.target.value)}
                placeholder="What makes this deal worth it"
                className="mt-1 h-10 w-full rounded-sm border border-line bg-surface px-2.5 text-body text-ink outline-none placeholder:text-muted focus:border-accent"
              />
            </label>
          )}
        </div>
      )}

      <div className="mt-4 border-t border-accent pt-3">
        {plan.writes.length > 0 && (
          <>
            <p className="text-small font-semibold text-accent-soft">Save will</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-small text-surface">
              {plan.writes.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </>
        )}
        {plan.notes.length > 0 && (
          <ul className="mt-2 space-y-1 text-small text-accent-soft">
            {plan.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        {plan.blockers.length > 0 && (
          <ul className="mt-2 space-y-1 text-small font-semibold text-warning" aria-live="polite">
            {plan.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onSave}
            disabled={!plan.canSave || alreadySaved}
            className="rounded-md bg-surface px-4 py-2 text-body font-bold text-accent-strong hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save quote
          </button>
          {alreadySaved && <span className="text-small text-accent-soft">Saved. Change the price or reason to save again.</span>}
        </div>
      </div>
    </section>
  );
}
