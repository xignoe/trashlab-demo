// Navy nav bar cloned from the dispatch console artboard: wordmark, pill tabs (Customers active), search, bell, avatar.
// Only the Customers tab is live; the rest are the console's placeholders and go nowhere in this surface.

const TABS = ['Dispatch', 'Routes', 'Customers', 'Billing', 'Haul-E'] as const;

export function NavBar() {
  return (
    <header className="nav">
      {/* One-word "TrashLab" mark as on the dispatch console (Paper node 4-0): a 28px periwinkle tile with the bin
          glyph, then "Trash" in white 700 and "Lab" in lavender 500, no space. About 111 by 28. Tokens only. */}
      <a className="nav-wordmark" href="/account" aria-label="TrashLab">
        <svg className="nav-glyph" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
          <rect width="28" height="28" rx="8" fill="var(--accent-2)" />
          <path d="M8 10h12M12 10V8.5h4V10M9.5 10l1 10h7l1-10M12.5 13v4.5M15.5 13v4.5" fill="none" stroke="var(--on-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="nav-wordmark-text">Trash<span className="nav-wordmark-lab">Lab</span></span>
      </a>
      <nav className="nav-tabs" aria-label="Console">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`nav-tab${tab === 'Customers' ? ' nav-tab-active' : ''}${tab === 'Haul-E' ? ' nav-tab-dot' : ''}`}
            aria-current={tab === 'Customers' ? 'page' : undefined}
            title={tab === 'Customers' ? 'Account view' : 'Part of the dispatch console, not this surface'}
          >
            {tab}
          </button>
        ))}
      </nav>
      <div className="nav-right">
        <div className="nav-search" role="presentation" title="Use the account search in the left rail">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="M20 20l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Search customers, routes...
        </div>
        <span className="nav-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2zM10 20a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="nav-avatar" title="Office manager">MR</span>
      </div>
    </header>
  );
}
