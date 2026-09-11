import { NavLink } from 'react-router-dom';

/** Where the portal mounts (App.tsx, `customer/portal/*`). */
export const PORTAL_BASE = '/customer/portal';

export type Tab = 'overview' | 'billing' | 'requests';

/** The three sections, each a sub-route of /customer/portal (PORT_DECISIONS.md entry 12). */
export const TABS: { id: Tab; label: string; path: string }[] = [
  { id: 'overview', label: 'Overview', path: PORTAL_BASE },
  { id: 'billing', label: 'Billing', path: `${PORTAL_BASE}/billing` },
  { id: 'requests', label: 'Requests', path: `${PORTAL_BASE}/requests` },
];

/** Left nav. The prototype kept the tab in React state; here it is the URL, so switching site or account keeps it. */
export function Tabs() {
  return (
    <nav className="flex flex-col gap-1" aria-label="Portal sections">
      {TABS.map((t) => (
        <NavLink
          key={t.id}
          to={t.path}
          end={t.id === 'overview'}
          className="block text-left text-sm px-3 py-2 rounded-md"
          style={({ isActive }) => ({
            background: isActive ? 'var(--color-accent-soft)' : 'transparent',
            color: isActive ? 'var(--color-accent)' : 'var(--color-ink-2)',
            fontWeight: isActive ? 'var(--weight-semibold)' : 'var(--weight-regular)',
            textDecoration: 'none',
          })}
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
