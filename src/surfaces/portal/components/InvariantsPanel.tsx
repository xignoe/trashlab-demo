// Overview footer: the contract invariants the portal can check, run live against the store so a mutation that
// broke one would show here at once. Pure checks live in ../lib/invariants.ts.

import { useStore } from '../../../store/useStore';
import { seed } from '../../../seed';
import { runInvariants, type StoreSurface } from '../lib/invariants';

const OUT_OF_SCOPE = '1 (rate publishing), 3 (recurring charge runs), and 7 (human approval) are billing and office runs the portal never performs.';

export function InvariantsPanel() {
  const root = useStore();
  const results = runInvariants(root as unknown as StoreSurface, root.db, seed.waivedCharges);
  const failing = results.filter((r) => !r.pass).length;

  return (
    <footer className="tl-card" data-testid="invariants" aria-label="Invariants">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-sm font-medium">Invariants</h2>
        <span className={`tl-pill ${failing ? 'tl-pill--danger' : 'tl-pill--ok'}`}>
          {failing ? `${failing} failing` : `${results.length} of ${results.length} pass`}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {results.map((r) => (
          <li key={r.id} className="flex items-start gap-3 text-xs" data-invariant={r.id} data-pass={r.pass}>
            <span className={`tl-pill ${r.pass ? 'tl-pill--ok' : 'tl-pill--danger'}`} style={{ minWidth: 52, justifyContent: 'center' }}>
              {r.pass ? 'pass' : 'fail'}
            </span>
            <span className="flex-1">
              <span className="font-medium text-ink">{r.number}. {r.title}</span>
              <span className="text-ink-3"> {r.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-3 mt-2">Not checked here: {OUT_OF_SCOPE}</p>
    </footer>
  );
}
