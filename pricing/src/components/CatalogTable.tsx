import { Fragment, useState, type ReactNode } from 'react';
import type { Zone } from '../types';
import { FREQUENCY_LABEL } from '../store/engine';
import { formatCents } from '../lib/money';
import { zoneLabel, type CatalogGroup, type CatalogLine } from '../lib/ratebook';
import Pill from './Pill';

// Column minimums sum to 824px (+48 gaps, +40 padding = 912px), which fits the 974px main column at 1440 wide,
// so History is visible without a sideways scroll (box 7.9). Price is the widest because the unwrapped
// "Scheduled $30.16 from 2026-10-01" pill (196px) appears there after a publish; Item only holds the size label.
const GRID = 'grid grid-cols-[minmax(56px,0.5fr)_92px_minmax(104px,0.8fr)_minmax(200px,1.2fr)_84px_minmax(140px,1fr)_148px] items-center gap-x-2';

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className={['transition-transform', open ? 'rotate-90' : ''].join(' ')}>
      <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LineRow({ line, zones, sizeLabel, drafting, onHistory, onNewDraft }: { line: CatalogLine; zones: Zone[]; sizeLabel: string; drafting: boolean; onHistory: (line: CatalogLine) => void; onNewDraft: (line: CatalogLine) => void }) {
  const v = line.current;
  const draft = line.drafts[0];
  const scheduled = line.scheduled[0];
  return (
    <li className={`${GRID} min-h-12 border-b border-line px-5 py-2 text-body`}>
      <span className="pl-4 text-muted">{sizeLabel}</span>
      <span className="text-ink">{zoneLabel(zones, line.zoneId)}</span>
      <span className="text-ink">{line.frequency ? FREQUENCY_LABEL[line.frequency] : 'any frequency'}</span>
      <span className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
        {v ? <span className="font-mono text-mono font-bold text-ink">{formatCents(v.priceCents)}</span> : <span className="text-small text-muted">no published rate</span>}
        {draft && (
          <Pill tone="warning" title={`${line.drafts.length} draft${line.drafts.length > 1 ? 's' : ''} pending, effective ${draft.effectiveFrom}`}>
            Draft {formatCents(draft.priceCents)}
            {line.drafts.length > 1 ? ` +${line.drafts.length - 1}` : ''}
          </Pill>
        )}
        {scheduled && (
          <Pill tone="accent" title={`Published ${scheduled.id}, in force from ${scheduled.effectiveFrom}; the current price applies until then`}>
            Scheduled {formatCents(scheduled.priceCents)} from {scheduled.effectiveFrom}
          </Pill>
        )}
      </span>
      <span className="font-mono text-mono text-ink">{v?.effectiveFrom ?? ''}</span>
      <span className="flex min-w-0 flex-col items-start gap-1">
        {v && <span className="truncate font-mono text-small text-muted" title={v.id}>{v.id}</span>}
        <span className="flex flex-wrap items-center gap-1">
          {v && line.effectiveToday && <Pill tone="success">{line.ruleWon === 'zoneRate' ? 'zone rate' : 'standard rate'}</Pill>}
          {v && !line.effectiveToday && <Pill tone="warning" title="Latest published version; not yet in force">effective {v.effectiveFrom}</Pill>}
          {line.versionCount > 1 && <Pill tone="muted">{line.versionCount} versions</Pill>}
        </span>
      </span>
      <span className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={() => onNewDraft(line)}
          aria-pressed={drafting}
          className={['rounded-md px-2 py-1 text-mono font-semibold', drafting ? 'bg-accent text-surface' : 'text-accent hover:bg-accent-soft'].join(' ')}
        >
          New draft
        </button>
        <button type="button" onClick={() => onHistory(line)} className="rounded-md px-2 py-1 text-mono font-semibold text-accent hover:bg-accent-soft">
          History
        </button>
      </span>
    </li>
  );
}

/** The heart of the screen: one group per catalog item in the active LOB, one line per (zone, frequency)
 *  with the published RateVersion that prices today, its effective date and id, a Draft pill when a draft
 *  is pending, and a Scheduled pill when a published version is not yet in force. Prices are read from
 *  resolvePrice, so what is shown is what a customer is billed. "New draft" opens the inline form
 *  (draftForm) under the line; the page owns that state so only one form is open at a time. */
export default function CatalogTable({
  groups, zones, today, onHistory, onNewDraft, draftForm,
}: {
  groups: CatalogGroup[];
  zones: Zone[];
  today: string;
  onHistory: (line: CatalogLine) => void;
  onNewDraft: (line: CatalogLine) => void;
  /** The line key whose inline form is open, and the form to render under it. */
  draftForm?: { key: string; node: ReactNode };
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <div className="overflow-x-auto">
        <div className="min-w-[912px]">
          <div className={`${GRID} h-10 border-b border-line bg-surface-muted px-5 text-eyebrow font-bold uppercase tracking-[0.08em] text-muted`}>
            <span>Item</span>
            <span>Zone</span>
            <span>Frequency</span>
            <span className="text-right">Price</span>
            <span>Effective</span>
            <span>Version</span>
            <span className="text-right">Actions</span>
          </div>
          {groups.length === 0 && <p className="px-5 py-8 text-center text-body text-muted">No catalog items in this line of business.</p>}
          {groups.map(({ item, lines }) => {
            const open = !collapsed.has(item.id);
            const draftCount = lines.reduce((n, l) => n + l.drafts.length, 0);
            return (
              <div key={item.id}>
                <button
                  type="button"
                  onClick={() => toggle(item.id)}
                  aria-expanded={open}
                  className="flex h-9 w-full items-center gap-2 border-b border-line px-5 text-left hover:bg-surface-muted"
                >
                  <span className="text-muted"><Chevron open={open} /></span>
                  <span className="text-body font-bold text-ink">{item.name}</span>
                  <span className="font-mono text-small text-muted">{item.id}</span>
                  {item.public ? <Pill tone="accent">public</Pill> : <Pill tone="muted">not public</Pill>}
                  <span className="text-small text-muted">
                    {lines.length} line{lines.length === 1 ? '' : 's'}
                  </span>
                  {draftCount > 0 && <Pill tone="warning" dot>{draftCount} draft{draftCount === 1 ? '' : 's'}</Pill>}
                </button>
                {open && (
                  <ul>
                    {lines.length === 0 && <li className="border-b border-line px-5 py-3 pl-9 text-small text-muted">No rate versions for this item yet.</li>}
                    {lines.map((line) => (
                      <Fragment key={line.key}>
                        <LineRow line={line} zones={zones} sizeLabel={item.sizeLabel} drafting={draftForm?.key === line.key} onHistory={onHistory} onNewDraft={onNewDraft} />
                        {/* NewDraftForm renders its own <li>, so it sits inside this <ul> as a row. */}
                        {draftForm?.key === line.key && draftForm.node}
                      </Fragment>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          <p className="bg-surface-muted px-5 py-2.5 text-small text-muted">
            Prices resolved with resolvePrice as of {today}. A draft never changes what a customer is billed until it is published as a new version.
          </p>
        </div>
      </div>
    </section>
  );
}
