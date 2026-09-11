const TABS = [
  { label: 'Dispatch', href: '#dispatch' },
  { label: 'Routes', href: '#routes' },
  { label: 'Customers', href: '#customers' },
  { label: 'Billing', href: '/billing' },
  { label: 'Haul-E', href: '#haul-e' },
]

function initials(name: string): string {
  return name.split(/[\s.]+/).filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase()
}

/** Office nav (dispatch nav 2-0 box, D3-0 tabs, search, and avatar) with Billing as the active tab. */
export function NavBar({ actor, active = 'Billing' }: { actor: string; active?: string }) {
  return (
    <nav className="tl-nav" aria-label="Primary">
      <span className="tl-nav-brand">TrashLab</span>
      <div className="tl-nav-tabs">
        {TABS.map(t => (
          <a
            key={t.label}
            className="tl-nav-tab"
            href={t.href}
            data-active={t.label === active ? 'true' : undefined}
            aria-current={t.label === active ? 'page' : undefined}
          >
            {t.label}
          </a>
        ))}
      </div>
      <div className="tl-nav-right">
        <input className="tl-nav-search" type="search" placeholder="Search accounts, invoices" aria-label="Search accounts and invoices" />
        <span className="tl-avatar" title={actor} aria-label={`Signed in as ${actor}`}>{initials(actor)}</span>
      </div>
    </nav>
  )
}
