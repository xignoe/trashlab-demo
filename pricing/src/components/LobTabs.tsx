import type { ReactNode } from 'react';
import type { LOB } from '../types';

export const LOB_LABEL: Record<LOB, string> = { residential: 'Residential', frontload: 'Frontload', rolloff: 'Rolloff' };
export const LOBS: LOB[] = ['residential', 'frontload', 'rolloff'];

/** Line of business tabs (the nav pill pattern) with an actions slot on the right. Phase 4 fills the slot
 *  with "Increase all <LOB> by X%" and "New draft"; the header is laid out so they fit now. */
export default function LobTabs({ lob, counts, onChange, actions }: { lob: LOB; counts: Record<LOB, number>; onChange: (lob: LOB) => void; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="tablist" aria-label="Line of business" className="flex items-center gap-1">
        {LOBS.map((l) => {
          const active = l === lob;
          return (
            <button
              key={l}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => onChange(l)}
              className={[
                'flex items-center gap-2 rounded-pill px-3.5 py-1.5 text-body font-semibold transition-colors',
                active ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink',
              ].join(' ')}
            >
              {LOB_LABEL[l]}
              <span className={['rounded-pill px-1.5 text-small font-bold', active ? 'bg-surface text-accent' : 'text-muted'].join(' ')}>{counts[l]}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  );
}
