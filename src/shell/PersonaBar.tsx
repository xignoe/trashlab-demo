import { Link, useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { today } from '../store/clock'
import { describeOpenItems, OPEN_ITEM_SELECTORS, type OpenItemKey } from './openItems'
import { isScreenActive, PERSONAS, personaFor, type Screen } from './routes'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-09-10" as "Sep 10, 2026", from the string alone (no Date, addendum E1). */
function clockLabel(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`
}

/**
 * Every open-item count, one subscription each. Each selector returns a number, so the bar re-renders only when a
 * count moves (a fresh object from one selector would re-render on every store change).
 */
function useOpenItemCounts(): Record<OpenItemKey, number> {
  return {
    proposedCharges: useStore(OPEN_ITEM_SELECTORS.proposedCharges),
    openRequests: useStore(OPEN_ITEM_SELECTORS.openRequests),
    heldSignups: useStore(OPEN_ITEM_SELECTORS.heldSignups),
    pricingDrafts: useStore(OPEN_ITEM_SELECTORS.pricingDrafts),
  }
}

const keysOf = (screens: Screen[]): OpenItemKey[] => screens.flatMap(s => s.openItems ?? [])

/**
 * The count badge. aria-hidden keeps the link's accessible name the persona or screen label; the breakdown is in the
 * link's title, which assistive technology reads as its description.
 */
function Count({ keys, counts, testId }: { keys: OpenItemKey[]; counts: Record<OpenItemKey, number>; testId: string }) {
  const n = keys.reduce((sum, k) => sum + counts[k], 0)
  if (n === 0) return null
  return <span className="pb-count" aria-hidden="true" data-testid={testId}>{n}</span>
}

/**
 * The only cross-surface navigation (DECISIONS.md entry 4). Three persona tabs, the screens under the active persona,
 * the demo clock, and Reset seed. Persona comes from the URL, so a reload or a shared link lands on the same view.
 * Each persona tab and screen link carries a live count of the hand-offs waiting on it (box 3.7).
 */
export function PersonaBar() {
  const { pathname } = useLocation()
  const active = personaFor(pathname)
  // The engine clock is module state; selecting it re-renders the bar whenever the store changes (Next cycle, reset).
  const day = useStore(() => today())
  const reset = useStore(s => s.reset)
  const counts = useOpenItemCounts()

  return (
    <header className="pb-bar" data-testid="persona-bar">
      <Link to="/" className="pb-brand">TrashLab</Link>
      <nav className="pb-personas" aria-label="Persona">
        {PERSONAS.map(p => {
          const keys = keysOf(p.screens)
          return (
            <Link
              key={p.id}
              to={p.home}
              className="pb-persona"
              data-active={p.id === active?.id ? 'true' : undefined}
              aria-current={p.id === active?.id ? 'true' : undefined}
              title={describeOpenItems(keys, counts) || undefined}
            >
              {p.label}
              <Count keys={keys} counts={counts} testId={`open-items-${p.id}`} />
            </Link>
          )
        })}
      </nav>
      {active && (
        <nav className="pb-screens" aria-label={`${active.label} screens`}>
          {active.screens.map(s => {
            const on = isScreenActive(s, pathname)
            const keys = s.openItems ?? []
            return (
              <Link
                key={s.to}
                to={s.to}
                className="pb-screen"
                data-active={on ? 'true' : undefined}
                aria-current={on ? 'page' : undefined}
                title={describeOpenItems(keys, counts) || undefined}
              >
                {s.label}
                <Count keys={keys} counts={counts} testId={`open-items-${s.to}`} />
              </Link>
            )
          })}
        </nav>
      )}
      <div className="pb-right">
        <span className="pb-clock" title="Demo clock. Every surface reads this date; Next cycle on Accounts moves it.">
          <span className="pb-clock-label">Today</span> {clockLabel(day)}
        </span>
        <button type="button" className="pb-reset" onClick={() => reset()} title="Reload the seed and clear every surface's state">
          Reset seed
        </button>
      </div>
    </header>
  )
}
