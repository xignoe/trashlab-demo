import { useEffect, useState, type ReactNode } from 'react'
import type { ServiceCatalog, Zone } from '../../../types'
import { FREQUENCY_LABEL } from '../lib/engine'
import { formatCents } from '../lib/money'
import { zoneLabel, type HistoryRow, type RateGroupKey } from '../lib/ratebook'
import Pill from './Pill'

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="shrink-0">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-small text-muted">{label}</dt>
      <dd className="text-right font-mono text-small text-ink">{children}</dd>
    </div>
  )
}

/** Right-side drawer listing every RateVersion for one (catalogId, zoneId, frequency) newest first. Published rows
 *  carry a lock and the sentence the owner needs to read: published versions are never edited. Drafts can be
 *  discarded; nothing else on this panel writes. Stacks above the persona bar (z-30). */
export default function VersionHistoryDrawer({
  group, item, zones, rows, today, onClose, onDiscard,
}: {
  group: RateGroupKey | null
  item?: ServiceCatalog
  zones: Zone[]
  rows: HistoryRow[]
  today: string
  onClose: () => void
  onDiscard: (id: string) => void
}) {
  const [highlight, setHighlight] = useState<string | null>(null)
  const open = group !== null

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!highlight) return
    document.getElementById(`rv-${highlight}`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    const t = window.setTimeout(() => setHighlight(null), 1600)
    return () => window.clearTimeout(t)
  }, [highlight])

  if (!open || !group) return null

  return (
    <div className="fixed inset-0 z-40" role="presentation">
      <button type="button" aria-label="Close history" onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <aside role="dialog" aria-modal="true" aria-labelledby="history-title" className="absolute inset-y-0 right-0 flex w-full max-w-[440px] flex-col bg-surface shadow-raised">
        <header className="border-b border-line px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-accent">Version history</p>
              <h2 id="history-title" className="mt-1 text-h1 font-bold tracking-tight">
                {item?.name ?? group.catalogId}
              </h2>
              <p className="mt-1 text-body text-muted">
                {zoneLabel(zones, group.zoneId)}, {group.frequency ? FREQUENCY_LABEL[group.frequency] : 'any frequency'}
              </p>
              <p className="mt-1 font-mono text-small text-muted">
                {group.catalogId} / {group.zoneId ?? 'no zone'} / {group.frequency ?? 'any'}
              </p>
            </div>
            <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-body font-semibold text-muted hover:bg-surface-muted hover:text-ink">
              Close
            </button>
          </div>
          <p className="mt-3 text-small text-muted">
            {rows.length} version{rows.length === 1 ? '' : 's'}, newest first. Current as of {today} is marked.
          </p>
        </header>

        <ol className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
          {rows.length === 0 && <li className="text-body text-muted">No versions for this line.</li>}
          {rows.map(({ version: v, supersededBy, isCurrent }) => {
            const published = v.status === 'published'
            return (
              <li
                id={`rv-${v.id}`}
                key={v.id}
                data-version={v.id}
                className={['rounded-card border p-4 transition-colors', highlight === v.id ? 'border-accent bg-accent-soft' : isCurrent ? 'border-accent/40 bg-surface' : 'border-line bg-surface'].join(' ')}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-mono font-semibold text-ink" title={v.id}>
                      {v.id}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {published ? <Pill tone="success">published</Pill> : <Pill tone="warning" dot>draft</Pill>}
                      {isCurrent && <Pill tone="accent">current</Pill>}
                      {published && supersededBy && <Pill tone="muted">superseded</Pill>}
                    </div>
                  </div>
                  <p className="shrink-0 font-mono text-h2 font-bold text-ink">{formatCents(v.priceCents)}</p>
                </div>

                <dl className="mt-3 space-y-1">
                  <Field label="Effective from">{v.effectiveFrom}</Field>
                  <Field label="Status">{v.status}</Field>
                  <Field label="Published at">{v.publishedAt ?? 'not published'}</Field>
                  <Field label="Supersedes">
                    {v.supersedesId ? (
                      <button type="button" onClick={() => setHighlight(v.supersedesId!)} className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
                        {v.supersedesId}
                      </button>
                    ) : (
                      'none'
                    )}
                  </Field>
                  <Field label="Superseded by">
                    {supersededBy ? (
                      <button type="button" onClick={() => setHighlight(supersededBy)} className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
                        {supersededBy}
                      </button>
                    ) : (
                      'none'
                    )}
                  </Field>
                </dl>

                <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
                  {published ? (
                    <p className="flex items-center gap-1.5 text-small font-semibold text-muted">
                      <LockIcon />
                      Published versions are never edited
                    </p>
                  ) : (
                    <>
                      <p className="text-small text-muted">Not in force. Discarding removes only this draft.</p>
                      <button type="button" onClick={() => onDiscard(v.id)} className="rounded-md border border-line px-3 py-1 text-small font-semibold text-danger hover:bg-danger-soft">
                        Discard
                      </button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </aside>
    </div>
  )
}
