export type Tab = 'overview' | 'billing' | 'requests';

export const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'billing', label: 'Billing' },
  { id: 'requests', label: 'Requests' },
];

/** Left nav. Plain React state, no router: the current tab is owned by App and survives site and account switches. */
export function Tabs({ current, onChange }: { current: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav className="flex flex-col gap-1" aria-label="Portal sections">
      {TABS.map((t) => {
        const active = t.id === current;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            aria-current={active ? 'page' : undefined}
            className="text-left text-sm px-3 py-2 rounded-md"
            style={{
              background: active ? 'var(--color-accent-soft)' : 'transparent',
              color: active ? 'var(--color-accent)' : 'var(--color-ink-2)',
              fontWeight: active ? 'var(--weight-semibold)' : 'var(--weight-regular)',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}
