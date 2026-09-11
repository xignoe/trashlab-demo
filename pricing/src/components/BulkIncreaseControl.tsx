import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { LOB } from '../types';
import { firstOfNextMonth } from '../store/dates';
import { LOB_LABEL } from './LobTabs';
import Pill from './Pill';

export interface BulkIncreaseValues {
  pct: number;
  effectiveFrom: string;
}

const INPUT = 'h-9 w-full rounded-sm border border-line bg-surface px-2.5 font-mono text-mono text-ink outline-none focus:border-accent';

/** "Increase all <LOB> by X%" in the tab header. Opens a small popover with the percent and the effective
 *  date; applying creates one draft per current rate line of the LOB (the page discards that LOB's pending
 *  drafts first, since createBulkIncreaseDrafts does not dedupe). Shows "N drafts pending" for the LOB. */
export default function BulkIncreaseControl({
  lob, pendingCount, today, onApply,
}: {
  lob: LOB;
  pendingCount: number;
  today: string;
  onApply: (values: BulkIncreaseValues) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pct, setPct] = useState('4');
  const [effectiveFrom, setEffectiveFrom] = useState(firstOfNextMonth(today));
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const label = LOB_LABEL[lob].toLowerCase();
  const pctNumber = Number(pct);
  const pctValid = pct.trim() !== '' && Number.isFinite(pctNumber) && pctNumber > 0 && pctNumber <= 100;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!pctValid) {
      setError('Enter a percent between 0 and 100');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || effectiveFrom < today) {
      setError(`Effective date cannot be before today (${today})`);
      return;
    }
    setError(null);
    onApply({ pct: pctNumber, effectiveFrom });
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative flex items-center gap-2">
      {pendingCount > 0 && (
        <Pill tone="warning" dot>
          {pendingCount} draft{pendingCount === 1 ? '' : 's'} pending
        </Pill>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={[
          'rounded-md border px-3.5 py-2 text-mono font-semibold transition-colors',
          open ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-ink hover:border-accent hover:text-accent',
        ].join(' ')}
      >
        Increase all {label} by {pctValid ? `${pctNumber}%` : 'X%'}
      </button>

      {open && (
        <form
          onSubmit={submit}
          role="dialog"
          aria-label={`Increase all ${label}`}
          className="absolute top-full right-0 z-10 mt-2 w-[320px] rounded-card border border-line bg-surface p-4 shadow-raised"
        >
          <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-accent">Bulk increase</p>
          <p className="mt-0.5 text-small text-muted">
            One draft per current {label} rate line. Contract overrides are not touched; the publish preview shows who is protected.
          </p>
          <div className="mt-3 grid grid-cols-[110px_minmax(0,1fr)] gap-3">
            <label className="block">
              <span className="text-small font-semibold text-muted">Increase</span>
              <div className="relative mt-1">
                <input
                  type="text"
                  inputMode="decimal"
                  autoFocus
                  value={pct}
                  onChange={(e) => setPct(e.target.value)}
                  aria-label="Increase percent"
                  className={`${INPUT} pr-7`}
                />
                <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center font-mono text-mono text-muted">%</span>
              </div>
            </label>
            <label className="block">
              <span className="text-small font-semibold text-muted">Effective from</span>
              <input type="date" value={effectiveFrom} min={today} onChange={(e) => setEffectiveFrom(e.target.value)} aria-label="Bulk increase effective from" className={`mt-1 ${INPUT}`} />
            </label>
          </div>
          {pendingCount > 0 && (
            <p className="mt-2 text-small text-warning">
              Replaces the {pendingCount} pending {label} draft{pendingCount === 1 ? '' : 's'}.
            </p>
          )}
          {error && <p className="mt-2 text-small font-semibold text-danger" role="alert">{error}</p>}
          <div className="mt-3 flex items-center gap-2">
            <button type="submit" className="rounded-md bg-accent px-3.5 py-2 text-mono font-semibold text-surface hover:bg-accent-strong">
              Create drafts
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-line bg-surface px-3.5 py-2 text-mono font-semibold text-muted hover:text-ink">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
