import { useState, type KeyboardEvent } from 'react'
import type { Zone } from '../../../types'
import { FREQUENCY_LABEL } from '../lib/engine'
import { firstOfNextMonth } from '../lib/dates'
import { dollarsToCents, formatCents } from '../lib/money'
import { zoneLabel, type CatalogGroup, type CatalogLine } from '../lib/ratebook'
import Pill from './Pill'

// Column minimums sum to 836px (+48 gaps, +40 padding = 924px), which fits the main column at 1440 wide, so History is
// visible without a sideways scroll (pricing box 7.9). Price is the widest because the unwrapped
// "Scheduled $30.16 from 2026-10-01" pill appears there after a publish; Item only holds the size label. Effective is
// wide enough for the date input an in-place edit puts there.
const GRID = 'grid grid-cols-[minmax(56px,0.5fr)_92px_minmax(104px,0.8fr)_minmax(200px,1.2fr)_128px_minmax(140px,1fr)_116px] items-center gap-x-2'

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className={['transition-transform', open ? 'rotate-90' : ''].join(' ')}>
      <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export interface LineEdit {
  priceCents: number
  effectiveFrom: string
}

const centsToDollarsText = (cents: number): string => (cents / 100).toFixed(2)

const INPUT = 'h-8 rounded-sm border border-line bg-surface px-2 font-mono text-mono text-ink outline-none focus:border-accent'

/** A line in edit mode: Price and Effective become inputs in place, Save and Cancel replace the actions. Enter saves,
 *  Escape cancels. Saving queues the price as a draft (a published version is never edited), prefilled from the
 *  line's pending draft when there is one so a second edit adjusts it rather than stacking another. */
function EditingCells({ line, today, onSave, onCancel }: { line: CatalogLine; today: string; onSave: (edit: LineEdit) => void; onCancel: () => void }) {
  const current = line.current
  const pending = line.drafts[0]
  const [price, setPrice] = useState(() => centsToDollarsText((pending ?? current)?.priceCents ?? 0))
  const [effectiveFrom, setEffectiveFrom] = useState(pending?.effectiveFrom ?? firstOfNextMonth(today))
  const [error, setError] = useState<string | null>(null)

  const cents = dollarsToCents(price)
  const delta = cents !== null && current ? cents - current.priceCents : null
  const deltaPct = delta !== null && current && current.priceCents > 0 ? (delta / current.priceCents) * 100 : null

  const save = () => {
    if (cents === null || cents <= 0) return setError('Enter a price in dollars, for example 30.16')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) return setError('Enter an effective date')
    if (effectiveFrom < today) return setError(`Effective date cannot be before today (${today}); a version never rewrites past billing`)
    onSave({ priceCents: cents, effectiveFrom })
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      save()
    } else if (e.key === 'Escape') onCancel()
  }

  return (
    <>
      <span className="flex min-w-0 flex-col items-end gap-0.5">
        <span className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center font-mono text-mono text-muted">$</span>
          <input
            type="text"
            inputMode="decimal"
            autoFocus
            value={price}
            onChange={e => {
              setPrice(e.target.value)
              setError(null)
            }}
            onFocus={e => e.target.select()}
            onKeyDown={onKeyDown}
            aria-label="Price in dollars"
            className={`${INPUT} w-24 pl-5 text-right font-bold`}
          />
        </span>
        <span className="font-mono text-eyebrow text-muted">
          {delta === null || delta === 0 ? (current ? `now ${formatCents(current.priceCents)}` : 'first version') : `${delta > 0 ? '+' : ''}${formatCents(delta)} (${delta > 0 ? '+' : ''}${deltaPct?.toFixed(1)}%)`}
        </span>
      </span>
      <input
        type="date"
        value={effectiveFrom}
        min={today}
        onChange={e => {
          setEffectiveFrom(e.target.value)
          setError(null)
        }}
        onKeyDown={onKeyDown}
        aria-label="Effective from"
        className={`${INPUT} w-full min-w-0 px-1.5`}
      />
      <span className="min-w-0 truncate font-mono text-small text-muted" title={current?.id}>
        {current ? `supersedes ${current.id}` : 'new line'}
      </span>
      <span className="flex items-center justify-end gap-1">
        <button type="button" onClick={save} className="rounded-md bg-accent px-2.5 py-1 text-mono font-semibold text-surface hover:bg-accent-strong">
          Save
        </button>
        <button type="button" onClick={onCancel} className="rounded-md px-2 py-1 text-mono font-semibold text-muted hover:text-ink">
          Cancel
        </button>
      </span>
      {error && (
        <p className="col-span-full pl-4 text-small font-semibold text-danger" role="alert">
          {error}
        </p>
      )}
    </>
  )
}

function LineRow({
  line, zones, sizeLabel, today, editing, onHistory, onEdit, onSave, onCancel, describeDims,
}: {
  line: CatalogLine
  describeDims?: (dims: Record<string, string>) => string[]
  zones: Zone[]
  sizeLabel: string
  today: string
  editing: boolean
  onHistory: (line: CatalogLine) => void
  onEdit: (line: CatalogLine) => void
  onSave: (line: CatalogLine, edit: LineEdit) => void
  onCancel: () => void
}) {
  const v = line.current
  const draft = line.drafts[0]
  const scheduled = line.scheduled[0]
  return (
    <li className={`${GRID} min-h-12 border-b border-line px-5 py-2 text-body ${editing ? 'bg-accent-soft/40' : ''}`} data-line={line.key}>
      <span className="pl-4 text-muted">{sizeLabel}</span>
      <span className="text-ink">{zoneLabel(zones, line.zoneId)}</span>
      <span className="flex min-w-0 flex-col items-start gap-1 text-ink">
        {line.frequency ? FREQUENCY_LABEL[line.frequency] : 'any frequency'}
        {line.dims && Object.keys(line.dims).length > 0 && (
          <span className="flex flex-wrap gap-1" data-testid="line-dims">
            {(describeDims ? describeDims(line.dims) : Object.entries(line.dims).map(([k, v]) => `${k}: ${v}`)).map(t => <Pill key={t} tone="accent">{t}</Pill>)}
          </span>
        )}
      </span>
      {editing ? (
        <EditingCells line={line} today={today} onSave={edit => onSave(line, edit)} onCancel={onCancel} />
      ) : (
        <>
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
            {v && <span className="max-w-full truncate font-mono text-small text-muted" title={v.id}>{v.id}</span>}
            <span className="flex flex-wrap items-center gap-1">
              {v && line.effectiveToday && <Pill tone="success">{line.ruleWon === 'zoneRate' ? 'zone rate' : 'standard rate'}</Pill>}
              {v && !line.effectiveToday && <Pill tone="warning" title="Latest published version; not yet in force">effective {v.effectiveFrom}</Pill>}
              {line.versionCount > 1 && <Pill tone="muted">{line.versionCount} versions</Pill>}
            </span>
          </span>
          <span className="flex items-center justify-end gap-1">
            <button type="button" onClick={() => onEdit(line)} className="rounded-md px-2 py-1 text-mono font-semibold text-accent hover:bg-accent-soft">
              Edit
            </button>
            <button type="button" onClick={() => onHistory(line)} className="rounded-md px-2 py-1 text-mono font-semibold text-accent hover:bg-accent-soft">
              History
            </button>
          </span>
        </>
      )}
    </li>
  )
}

/** The heart of the Ratebook: one group per catalog item in the active LOB, one line per (zone, frequency) with the
 *  published RateVersion that prices today, its effective date and id, a Draft pill when a draft is pending, and a
 *  Scheduled pill when a published version is not yet in force. Prices are read from the canonical resolvePrice, so
 *  what is shown is what a customer is billed. "Edit" turns the line's price and effective date into inputs in place. */
export default function CatalogTable({
  groups, zones, today, editingKey, onHistory, onEdit, onSave, onCancel, describeDims, emptyText,
}: {
  groups: CatalogGroup[]
  /** Labels for a line's extra dimension values ("Customer tier: VIP"). */
  describeDims?: (dims: Record<string, string>) => string[]
  /** Shown when no group is left, for example after filtering. */
  emptyText?: string
  zones: Zone[]
  today: string
  /** The line key being edited in place, if any. */
  editingKey?: string | null
  onHistory: (line: CatalogLine) => void
  onEdit: (line: CatalogLine) => void
  onSave: (line: CatalogLine, edit: LineEdit) => void
  onCancel: () => void
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <section className="overflow-hidden rounded-card border border-line bg-surface shadow-card" aria-label="Catalog">
      <div className="overflow-x-auto" data-testid="catalog-scroll">
        <div className="min-w-[924px]">
          <div className={`${GRID} h-10 border-b border-line bg-surface-muted px-5 text-eyebrow font-bold uppercase tracking-[0.08em] text-muted`}>
            <span>Item</span>
            <span>Zone</span>
            <span>Frequency</span>
            <span className="text-right">Price</span>
            <span>Effective</span>
            <span>Version</span>
            <span className="text-right">Actions</span>
          </div>
          {groups.length === 0 && <p className="px-5 py-8 text-center text-body text-muted">{emptyText ?? 'No catalog items in this line of business.'}</p>}
          {groups.map(({ item, lines }) => {
            const open = !collapsed.has(item.id)
            const draftCount = lines.reduce((n, l) => n + l.drafts.length, 0)
            return (
              <div key={item.id}>
                <button type="button" onClick={() => toggle(item.id)} aria-expanded={open} className="flex h-9 w-full items-center gap-2 border-b border-line px-5 text-left hover:bg-surface-muted">
                  <span className="text-muted">
                    <Chevron open={open} />
                  </span>
                  <span className="text-body font-bold text-ink">{item.name}</span>
                  <span className="font-mono text-small text-muted">{item.id}</span>
                  {item.public ? <Pill tone="accent">public</Pill> : <Pill tone="muted">not public</Pill>}
                  <span className="text-small text-muted">
                    {lines.length} line{lines.length === 1 ? '' : 's'}
                  </span>
                  {draftCount > 0 && (
                    <Pill tone="warning" dot>
                      {draftCount} draft{draftCount === 1 ? '' : 's'}
                    </Pill>
                  )}
                </button>
                {open && (
                  <ul>
                    {lines.length === 0 && <li className="border-b border-line px-5 py-3 pl-9 text-small text-muted">No rate versions for this item yet.</li>}
                    {lines.map(line => (
                      <LineRow
                        key={line.key}
                        line={line}
                        zones={zones}
                        sizeLabel={item.sizeLabel}
                        today={today}
                        editing={editingKey === line.key}
                        onHistory={onHistory}
                        onEdit={onEdit}
                        onSave={onSave}
                        onCancel={onCancel}
                        {...(describeDims ? { describeDims } : {})}
                      />
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
          <p className="bg-surface-muted px-5 py-2.5 text-small text-muted">
            Prices resolved with resolvePrice as of {today}. A draft never changes what a customer is billed until it is published as a new version.
          </p>
        </div>
      </div>
    </section>
  )
}
