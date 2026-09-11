// Visible pass or fail rows. Every request flow shows its checks this way before it acts.

import type { EligibilityCheck } from '../../store/selectors';

export interface CheckRow {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export function CheckRows({ checks, title }: { checks: (CheckRow | EligibilityCheck)[]; title?: string }) {
  return (
    <div className="flex flex-col gap-1" data-testid="check-rows">
      {title && <div className="tl-label">{title}</div>}
      <ol className="flex flex-col gap-1" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {checks.map((c, i) => (
          <li
            key={c.id}
            className="flex items-center gap-3 text-sm rounded-md px-3 py-2"
            style={{ background: c.ok ? 'var(--color-ok-soft)' : 'var(--color-danger-soft)' }}
            data-check={c.id}
            data-ok={c.ok ? 'true' : 'false'}
          >
            <span className={`tl-pill ${c.ok ? 'tl-pill--ok' : 'tl-pill--danger'}`} style={{ minWidth: 48, justifyContent: 'center' }}>
              {c.ok ? 'Pass' : 'Fail'}
            </span>
            <span className="text-ink-3 text-xs" style={{ width: 16 }}>{i + 1}.</span>
            <span className="font-medium">{c.label}</span>
            <span className="text-ink-2 ml-auto text-right">{c.detail}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
