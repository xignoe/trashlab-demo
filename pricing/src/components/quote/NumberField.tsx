import { useId, useState } from 'react';

/** Numeric assumption field. Keeps its own text so a half typed value ("0.") does not fight the input;
 *  commits only valid numbers. scale converts the shown unit to the stored one (dollars shown, cents
 *  stored: scale 100). Remount with a new key to resync after "Reset to defaults". */
export default function NumberField({
  label, value, onCommit, unit, scale = 1, min = 0, minExclusive = false, max, step = 'any', inUse = false, changed = false,
}: {
  label: string;
  value: number;
  onCommit: (next: number) => void;
  unit?: string;
  scale?: number;
  min?: number;
  minExclusive?: boolean;
  /** Exclusive upper bound. */
  max?: number;
  step?: number | 'any';
  inUse?: boolean;
  changed?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(String(Number((value / scale).toFixed(4))));
  const shown = Number(text);
  const valid = text.trim() !== '' && Number.isFinite(shown) && (minExclusive ? shown > min : shown >= min) && (max === undefined || shown < max);
  const rule = `${minExclusive ? 'above' : 'at least'} ${min}${max !== undefined ? ` and below ${max}` : ''}`;

  return (
    <div className="flex items-center gap-2 py-1">
      <label htmlFor={id} className="flex min-w-0 flex-1 items-center gap-1.5 text-small text-ink">
        {inUse && <span className="h-1.5 w-1.5 shrink-0 rounded-pill bg-accent" title="Used by the current quote" aria-hidden="true" />}
        <span className={['truncate', inUse ? 'font-semibold' : ''].join(' ')}>{label}</span>
        {changed && <span className="rounded-pill bg-warning-soft px-1.5 text-eyebrow font-semibold text-warning">edited</span>}
      </label>
      <div className="flex shrink-0 items-center gap-1">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step={step}
          value={text}
          aria-invalid={!valid}
          title={valid ? undefined : `Must be ${rule}`}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            const n = Number(next);
            const ok = next.trim() !== '' && Number.isFinite(n) && (minExclusive ? n > min : n >= min) && (max === undefined || n < max);
            if (ok) onCommit(scale === 1 ? n : Math.round(n * scale));
          }}
          className={[
            'h-8 w-[84px] rounded-sm border bg-surface px-2 text-right font-mono text-mono text-ink outline-none focus:border-accent',
            valid ? 'border-line' : 'border-danger bg-danger-soft',
          ].join(' ')}
        />
        <span className="w-[44px] text-eyebrow text-muted">{unit}</span>
      </div>
    </div>
  );
}
