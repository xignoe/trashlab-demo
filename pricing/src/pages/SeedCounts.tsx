import { useStore } from '../store/store';

/** Phase 1 proof that the store loads the canonical seed. Replaced by real screens in later phases. */
export default function SeedCounts() {
  const s = useStore();
  const counts: [string, number][] = [
    ['catalog items', s.catalog.length],
    ['rate versions', s.rateVersions.length],
    ['accounts', s.accounts.length],
    ['sites', s.sites.length],
    ['service items', s.serviceItems.length],
    ['contracts', s.contracts.length],
    ['zones', s.zones.length],
    ['fee rules', s.feeRules.length],
    ['tax rules', s.taxRules.length],
    ['service events', s.serviceEvents.length],
    ['charges', s.charges.length],
    ['invoices', s.invoices.length],
    ['payments', s.payments.length],
    ['quotes', s.quotes.length],
  ];
  return (
    <section className="rounded-card border border-line bg-surface p-6 shadow-card">
      <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-accent">Seed loaded</p>
      <p className="mt-1 text-body text-muted">
        {counts
          .slice(0, 3)
          .map(([label, n]) => `${n} ${label}`)
          .join(', ')}
      </p>
      <ul className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 text-body sm:grid-cols-4">
        {counts.map(([label, n]) => (
          <li key={label} className="flex items-baseline justify-between border-b border-line py-1">
            <span className="text-muted">{label}</span>
            <span className="font-mono text-mono font-semibold">{n}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
