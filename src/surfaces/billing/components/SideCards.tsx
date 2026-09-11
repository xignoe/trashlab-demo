import { useState } from 'react'
import type { Leakage, LeakageRow, LeakageView } from '../../../store/selectors'
import { fmt } from '../../../store/money'
import { addDays } from '../../../store/cycles'
import { dayLabel } from './format'

const VIEWS: { key: LeakageView; label: string }[] = [
  { key: 'reason', label: 'By reason' },
  { key: 'route', label: 'By route' },
  { key: 'account', label: 'By account' },
]

/**
 * Leakage card: waived dollars over the current cycle and the two before it, with breakdowns by reason, route,
 * and account. Bars scale to the largest row in the chosen breakdown.
 */
export function LeakageCard({ leakage }: { leakage: Leakage }) {
  const [view, setView] = useState<LeakageView>('reason')
  const rows: LeakageRow[] = view === 'reason' ? leakage.byReason : view === 'route' ? leakage.byRoute : leakage.byAccount
  const max = Math.max(1, ...rows.map(r => r.cents))
  const current = leakage.cycles[leakage.cycles.length - 1]

  return (
    <section className="tl-card tl-card-lg" aria-labelledby="leakage-title">
      <header className="tl-card-header-plain">
        <div className="tl-card-titles">
          <h2 id="leakage-title" className="tl-card-title">Leakage, last 3 cycles</h2>
          <span className="tl-card-meta">
            Waives recorded {dayLabel(leakage.from)} to {dayLabel(addDays(leakage.to, -1))}, cycles {leakage.cycles.map(c => dayLabel(c.cycleDate)).join(', ')}
          </span>
        </div>
        <div className="tl-segmented" role="tablist" aria-label="Leakage breakdown">
          {VIEWS.map(v => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={view === v.key}
              aria-pressed={view === v.key}
              aria-controls="leakage-bars"
              onClick={() => setView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </header>
      <div className="tl-leakage">
        <div className="tl-leakage-side">
          <div className="tl-stat">
            <span className="tl-eyebrow" data-tone="danger">Waived total</span>
            <span className="tl-stat-value" data-testid="leakage-total">{fmt(leakage.totalCents)}</span>
            <span className="tl-stat-caption">{leakage.count} waived charge{leakage.count === 1 ? '' : 's'}</span>
          </div>
          <dl className="tl-leakage-cycles" aria-label="Waived by cycle">
            {leakage.cycles.map(c => (
              <div key={c.cycleDate} data-current={c === current ? 'true' : undefined}>
                <dt>{dayLabel(c.cycleDate)} cycle{c === current ? ', this one' : ''}</dt>
                <dd>{fmt(c.cents)}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div id="leakage-bars" role="tabpanel" aria-label={VIEWS.find(v => v.key === view)?.label}>
          {rows.length === 0 ? (
            <p className="tl-detail-body">Nothing waived in these three cycles.</p>
          ) : (
            <ul className="tl-bars">
              {rows.map(r => (
                <li key={r.key}>
                  <span className="tl-bar-label" title={r.label}>{r.label} <span className="tl-bar-count">({r.count})</span></span>
                  <span className="tl-bar-track" aria-hidden="true">
                    <span className="tl-bar-fill" style={{ width: `${Math.round((r.cents / max) * 100)}%` }} />
                  </span>
                  <span className="tl-bar-value tl-mono">{fmt(r.cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
