import type { LOB, Zone } from '../types';
import { FREQUENCY_LABEL } from '../store/engine';
import { formatCents } from '../lib/money';
import { zoneLabel, type LobDraft } from '../lib/ratebook';
import { LOB_LABEL } from './LobTabs';
import Pill from './Pill';
import { isNoChangeDraft } from '../store/store';

/** Pending drafts for the current LOB, one row each, with Discard per draft and one "Preview publish"
 *  button. Nothing here publishes: the button opens the blast-radius preview, and only its Confirm writes. */
export default function DraftsTray({
  lob, drafts, zones, agentDraftIds = [], onDiscard, onDiscardAll, onPreview,
}: {
  lob: LOB;
  /** Pending drafts for the LOB. A draft whose price equals the version it supersedes is flagged "no change"
   *  and left out of Preview publish (checklist 7.7). */
  drafts: LobDraft[];
  zones: Zone[];
  /** Drafts created by approving agent proposals, labelled "agent" so their origin is visible. */
  agentDraftIds?: string[];
  onDiscard: (id: string) => void;
  onDiscardAll: () => void;
  onPreview: () => void;
}) {
  if (drafts.length === 0) return null;
  const label = LOB_LABEL[lob].toLowerCase();
  const noChange = drafts.filter(({ draft, supersedes }) => supersedes && isNoChangeDraft(draft, [supersedes]));
  const publishable = drafts.length - noChange.length;

  return (
    <section className="rounded-card border border-warning/40 bg-surface shadow-card" aria-label="Pending drafts">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div className="flex items-center gap-2">
          <Pill tone="warning" dot>
            {drafts.length} draft{drafts.length === 1 ? '' : 's'} pending
          </Pill>
          <p className="text-body text-ink">
            <span className="font-semibold">{LOB_LABEL[lob]} drafts.</span> Not in force. Nothing a customer is billed changes until you preview and confirm.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onDiscardAll} className="rounded-md border border-line bg-surface px-3 py-1.5 text-mono font-semibold text-muted hover:text-danger">
            Discard all {label}
          </button>
          <button
            type="button"
            onClick={onPreview}
            disabled={publishable === 0}
            title={publishable === 0 ? 'Every pending draft has the same price as the version it supersedes. Change a price or discard.' : undefined}
            className="rounded-md bg-accent px-3.5 py-2 text-mono font-semibold text-surface hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            {noChange.length > 0 && publishable > 0 ? `Preview publish ${publishable}` : 'Preview publish'}
          </button>
        </div>
      </header>
      {noChange.length > 0 && (
        <p className="border-b border-line bg-danger-soft px-5 py-2 text-small text-ink" role="status" data-testid="no-change-drafts">
          <span className="font-semibold">
            {noChange.length} draft{noChange.length === 1 ? ' has' : 's have'} no change and cannot be published.
          </span>{' '}
          {noChange.length === 1 ? 'Its price equals' : 'Their prices equal'} the version{noChange.length === 1 ? '' : 's'} they supersede, so publishing would bill nobody differently. Discard, or create a new draft with a different price.
          {publishable === 0 ? ' Nothing here can be published yet.' : ` Preview publish covers the other ${publishable}.`}
        </p>
      )}
      <div className="overflow-x-auto">
      <ul className="max-h-[260px] min-w-[860px] overflow-y-auto">
        {drafts.map(({ draft, item, supersedes }) => {
          const delta = supersedes ? draft.priceCents - supersedes.priceCents : null;
          const pct = delta !== null && supersedes && supersedes.priceCents > 0 ? (delta / supersedes.priceCents) * 100 : null;
          return (
            <li key={draft.id} className="grid grid-cols-[minmax(120px,1fr)_100px_110px_minmax(170px,auto)_90px_minmax(150px,1.2fr)_70px] items-center gap-x-2 border-b border-line px-5 py-2 text-body last:border-b-0">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-semibold text-ink" title={item.name}>{item.name}</span>
                {agentDraftIds.includes(draft.id) && <Pill tone="accent" title="Created by approving an agent proposal">agent</Pill>}
              </span>
              <span className="text-ink">{zoneLabel(zones, draft.zoneId)}</span>
              <span className="text-ink">{draft.frequency ? FREQUENCY_LABEL[draft.frequency] : 'any frequency'}</span>
              <span className="flex items-center gap-2 font-mono text-mono">
                {supersedes ? <span className="text-muted">{formatCents(supersedes.priceCents)}</span> : <span className="text-muted">new line</span>}
                <span className="text-muted" aria-hidden="true">to</span>
                <span className="font-bold text-ink">{formatCents(draft.priceCents)}</span>
                {delta === 0 && <Pill tone="danger">no change, cannot publish</Pill>}
                {delta !== null && delta !== 0 && pct !== null && (
                  <Pill tone={delta > 0 ? 'warning' : delta < 0 ? 'danger' : 'muted'}>
                    {delta > 0 ? '+' : ''}
                    {pct.toFixed(1)}%
                  </Pill>
                )}
              </span>
              <span className="font-mono text-mono text-ink">{draft.effectiveFrom}</span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-mono text-small text-muted" title={draft.id}>{draft.id}</span>
                {supersedes && (
                  <span className="truncate font-mono text-eyebrow text-muted" title={supersedes.id}>
                    supersedes {supersedes.id}
                  </span>
                )}
              </span>
              <span className="text-right">
                <button type="button" onClick={() => onDiscard(draft.id)} className="rounded-md px-2 py-1 text-mono font-semibold text-danger hover:bg-danger-soft">
                  Discard
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      </div>
    </section>
  );
}
