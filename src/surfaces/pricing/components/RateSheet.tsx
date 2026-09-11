/**
 * The rate sheet (DECISIONS.md entry 68): every rate line of every service in one table the owner can read and edit
 * like a spreadsheet. Columns come from the fields the rates are keyed by, not from a fixed list, so a field the owner
 * adds (customer tier, container yards, equipment rental) becomes a column the moment a service is priced by it.
 *
 * Two views over the same rows:
 * - List: one row per rate line, grouped by category, line of business, service, or any field.
 * - Grid: one field's values across (zones, tiers, bands), everything else down, the way a rate card is printed.
 *   An empty cell is a combination with no rate yet; clicking it adds one.
 *
 * Clicking a price edits it in place. Enter saves and moves down, Tab saves and moves right, Escape cancels. A saved
 * price is a draft from the "New prices from" date; nothing a customer is billed changes until it is published.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react'
import type { LOB } from '../../../types'
import { useStore } from '../../../store/useStore'
import { ALL_LOBS, dimensionLabel, filterRateRows, LOB_NAME, valueLabel, valuesOf, type RateFilter, type RateRow } from '../lib/config'
import { cellDraftArgs, groupRows, newestPublished, pivot, pivotFields, sheetColumns, sheetTsv, unitText, type GroupBy } from '../lib/sheet'
import { firstOfNextMonth } from '../lib/dates'
import { dollarsToCents, formatCents } from '../lib/money'
import Pill from './Pill'
import { BUTTON_LINK, BUTTON_SECONDARY, INPUT, Select } from './form'

const PAGE_SIZE = 100

type Move = 'down' | 'up' | 'right' | 'left' | 'close'

const STATE_OPTIONS: { value: NonNullable<RateFilter['state']>; label: string }[] = [
  { value: 'all', label: 'All rate lines' },
  { value: 'drafts', label: 'Drafts pending' },
  { value: 'scheduled', label: 'Scheduled changes' },
  { value: 'noRate', label: 'No published rate' },
]

export interface RateSheetProps {
  /** Every rate line, drafts included (rateRows over withDrafts(db, drafts)). */
  rows: RateRow[]
  today: string
  /** The line of business shown. Lifted so the bulk increase and drafts tray follow it. */
  lob: LOB | 'all'
  onLob: (lob: LOB | 'all') => void
  onHistory: (row: RateRow) => void
  /** Open Add rate, prefilled with a service and values (a variant of a line, or a group's service). */
  onAddRate: (prefill: { catalogId?: string; values?: Record<string, string> }) => void
  /** Open the rate form on one line (its service, values, and price) to change any of them. */
  onEditRate: (prefill: { catalogId: string; values: Record<string, string>; priceCents?: number }) => void
  /** Toolbar buttons, given the rows the filters show (Adjust rates by x%, Add rate). */
  actions?: (shown: RateRow[]) => ReactNode
}

/** A price input in place of the cell. Commits once: on Enter, Tab, or leaving the cell with a change. */
function PriceEditor({ initialCents, label, onDone }: { initialCents?: number; label: string; onDone: (cents: number | null, move: Move) => boolean | void }) {
  const [text, setText] = useState(initialCents === undefined ? '' : (initialCents / 100).toFixed(2))
  const [error, setError] = useState<string | null>(null)
  const done = useRef(false)

  const finish = (move: Move) => {
    if (done.current) return
    const t = text.trim()
    if (t === '') {
      done.current = true
      onDone(null, move)
      return
    }
    const cents = dollarsToCents(t)
    if (cents === null || cents <= 0) {
      setError('Enter a price in dollars, like 31.50')
      return
    }
    done.current = true
    if (onDone(cents === initialCents ? null : cents, move) === false) done.current = false
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center font-mono text-mono text-muted">$</span>
        <input
          type="text"
          inputMode="decimal"
          autoFocus
          value={text}
          aria-label={label}
          onFocus={e => e.target.select()}
          onChange={e => {
            setText(e.target.value)
            setError(null)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              finish(e.shiftKey ? 'up' : 'down')
            } else if (e.key === 'Tab') {
              e.preventDefault()
              finish(e.shiftKey ? 'left' : 'right')
            } else if (e.key === 'Escape') {
              e.preventDefault()
              done.current = true
              onDone(null, 'close')
            }
          }}
          onBlur={() => finish('close')}
          className={`${INPUT} h-8 w-24 pl-5 text-right font-mono font-bold`}
        />
      </span>
      {error && (
        <span role="alert" className="text-eyebrow font-semibold text-danger">
          {error}
        </span>
      )}
    </span>
  )
}

function FieldCell({ fieldId, valueId }: { fieldId: string; valueId?: string }) {
  const db = useStore(s => s.db)
  if (!valueId) return <span className="text-muted">Any</span>
  return <span className="text-ink">{valueLabel(db, fieldId, valueId)}</span>
}

/** Draft and scheduled markers beside a price. */
function LineMarkers({ row, compact = false }: { row: RateRow; compact?: boolean }) {
  const draft = row.drafts[0]
  const scheduled = row.scheduled[0]
  return (
    <>
      {draft && (
        <Pill tone="warning" title={`${row.drafts.length} draft${row.drafts.length === 1 ? '' : 's'} pending, from ${draft.effectiveFrom}; not billed until published`}>
          {compact ? `Draft ${formatCents(draft.priceCents)}` : `Draft ${formatCents(draft.priceCents)} from ${draft.effectiveFrom}`}
        </Pill>
      )}
      {scheduled && (!row.current || row.effectiveToday || scheduled.id !== row.current.id) && (
        <Pill tone="accent" title={`Published ${scheduled.id}, in force from ${scheduled.effectiveFrom}`}>
          {compact ? `${formatCents(scheduled.priceCents)} from ${scheduled.effectiveFrom.slice(5)}` : `Scheduled ${formatCents(scheduled.priceCents)} from ${scheduled.effectiveFrom}`}
        </Pill>
      )}
    </>
  )
}

/** What a cell shows as its price: in force today, else the newest scheduled, else nothing yet. */
function cellPrice(row: RateRow): number | undefined {
  if (row.current && row.effectiveToday) return row.current.priceCents
  return newestPublished(row)?.priceCents
}

export default function RateSheet({ rows, today, lob, onLob, onHistory, onAddRate, onEditRate, actions }: RateSheetProps) {
  const db = useStore(s => s.db)
  const createDraft = useStore(s => s.createDraftRateVersion)
  const discardDraft = useStore(s => s.discardDraftRateVersion)

  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [state, setState] = useState<NonNullable<RateFilter['state']>>('all')
  const [values, setValues] = useState<Record<string, string>>({})
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [groupBy, setGroupBy] = useState<GroupBy>('category')
  const [pivotField, setPivotField] = useState('zone')
  const [hidden, setHidden] = useState<string[]>([])
  const [effectiveFrom, setEffectiveFrom] = useState(firstOfNextMonth(today))
  const [editing, setEditing] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const inLob = useMemo(() => (lob === 'all' ? rows : rows.filter(r => r.item.lob === lob)), [rows, lob])
  const allColumns = useMemo(() => sheetColumns(inLob), [inLob])
  const columns = allColumns.filter(c => !hidden.includes(c))
  const categories = (db.serviceCategories ?? []).filter(c => lob === 'all' || c.lob === lob)
  const shown = useMemo(
    () => filterRateRows(db, rows, { ...(lob !== 'all' ? { lob } : {}), ...(categoryId ? { categoryId } : {}), search, values, state }),
    [db, rows, lob, categoryId, search, values, state],
  )
  const groups = useMemo(() => groupRows(db, shown, groupBy), [db, shown, groupBy])
  const ordered = useMemo(() => groups.flatMap(g => g.rows), [groups])
  const pivotOptions = useMemo(() => pivotFields(db, inLob), [db, inLob])
  const field = pivotOptions.includes(pivotField) ? pivotField : pivotOptions[0]
  const grid = useMemo(() => (field ? pivot(db, shown, field) : null), [db, shown, field])

  const total = view === 'list' ? ordered.length : (grid?.rows.length ?? 0)
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const pageRows = ordered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
  const pageKeys = new Set(pageRows.map(r => r.key))
  const pageGroups = groups.map(g => ({ ...g, rows: g.rows.filter(r => pageKeys.has(r.key)) })).filter(g => g.rows.length > 0)
  const gridRows = grid ? grid.rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE) : []
  const draftCount = shown.reduce((n, r) => n + r.drafts.length, 0)

  const resetPage = () => setPage(0)

  /** Save one cell as a draft. The line's pending drafts are replaced; a price equal to the published one clears them. */
  const saveCell = (catalogId: string, cellValues: Record<string, string>, line: RateRow | undefined, cents: number): boolean => {
    setProblem(null)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || effectiveFrom < today) {
      setProblem(`New prices must start on or after today (${today}). Change the date in the toolbar.`)
      return false
    }
    const base = line ? newestPublished(line) : undefined
    try {
      if (line) for (const d of line.drafts) discardDraft({ id: d.id })
      if (base && base.priceCents === cents) return true
      createDraft(cellDraftArgs(catalogId, cellValues, cents, effectiveFrom, base))
      return true
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
      return false
    }
  }

  const listNext = (key: string, move: Move): string | null => {
    if (move === 'close') return null
    const keys = pageRows.map(r => r.key)
    const i = keys.indexOf(key) + (move === 'down' || move === 'right' ? 1 : -1)
    return keys[i] ?? null
  }

  const gridNext = (rowIndex: number, colIndex: number, move: Move): string | null => {
    if (!grid || move === 'close') return null
    const cols = grid.columns
    let r = rowIndex
    let c = colIndex
    if (move === 'down') r += 1
    else if (move === 'up') r -= 1
    else if (move === 'right') {
      c += 1
      if (c >= cols.length) {
        c = 0
        r += 1
      }
    } else {
      c -= 1
      if (c < 0) {
        c = cols.length - 1
        r -= 1
      }
    }
    const row = gridRows[r]
    return row && cols[c] ? `${row.key}::${cols[c].id}` : null
  }

  const copySheet = async () => {
    try {
      await navigator.clipboard.writeText(sheetTsv(db, ordered, columns))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setProblem('Copying needs clipboard access in this browser.')
    }
  }

  const groupOptions = [
    { value: 'category', label: 'Group by category' },
    { value: 'lob', label: 'Group by line of business' },
    { value: 'service', label: 'Group by service' },
    ...allColumns.map(c => ({ value: `field:${c}`, label: `Group by ${dimensionLabel(db, c).toLowerCase()}` })),
    { value: 'none', label: 'No grouping' },
  ]

  const TH = 'sticky top-0 z-10 border-b border-line bg-surface-muted px-3 py-2 text-left text-eyebrow font-bold uppercase tracking-[0.08em] text-muted'
  const TD = 'border-b border-line px-3 py-2 align-middle'

  return (
    <section aria-label="Rate sheet" className="rounded-card border border-line bg-surface shadow-card">
      {/* Toolbar */}
      <div className="space-y-3 border-b border-line p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Line of business" className="flex rounded-md border border-line bg-surface-muted p-0.5">
            {(['all', ...ALL_LOBS] as const).map(l => {
              const active = lob === l
              const n = l === 'all' ? rows.length : rows.filter(r => r.item.lob === l).length
              const name = l === 'all' ? 'All' : LOB_NAME[l]
              return (
                <button
                  key={l}
                  type="button"
                  aria-pressed={active}
                  aria-label={`${name} rates`}
                  onClick={() => {
                    onLob(l)
                    setCategoryId('')
                    setValues({})
                    setEditing(null)
                    resetPage()
                  }}
                  className={['flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-body font-semibold', active ? 'bg-surface text-accent shadow-card' : 'text-muted hover:text-ink'].join(' ')}
                >
                  {name}
                  <span className="text-small font-bold text-muted">{n}</span>
                </button>
              )
            })}
          </div>
          <input
            type="search"
            value={search}
            onChange={e => {
              setSearch(e.target.value)
              resetPage()
            }}
            placeholder="Search services, zones, values"
            aria-label="Search rates"
            className={`${INPUT} w-60`}
          />
          <div className="w-44">
            <Select value={categoryId} onChange={v => { setCategoryId(v); resetPage() }} ariaLabel="Category" placeholder="All categories" options={categories.map(c => ({ value: c.id, label: c.name }))} />
          </div>
          <div className="w-44">
            <Select value={state} onChange={v => { setState(v as NonNullable<RateFilter['state']>); resetPage() }} ariaLabel="Rate state" options={STATE_OPTIONS} />
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">{actions?.(shown)}</div>
        </div>

        {allColumns.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by field">
            <span className="text-small font-semibold text-muted">Filter by field</span>
            {allColumns.map(c => (
              <div key={c} className="w-40">
                <Select
                  value={values[c] ?? ''}
                  onChange={v => {
                    setValues(f => ({ ...f, [c]: v }))
                    resetPage()
                  }}
                  ariaLabel={dimensionLabel(db, c)}
                  placeholder={`Any ${dimensionLabel(db, c).toLowerCase()}`}
                  options={valuesOf(db, c).map(v => ({ value: v.id, label: v.label }))}
                />
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="View" className="flex rounded-md border border-line bg-surface-muted p-0.5">
            {(['list', 'grid'] as const).map(v => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => {
                  setView(v)
                  setEditing(null)
                  resetPage()
                }}
                className={['rounded-sm px-3 py-1.5 text-body font-semibold', view === v ? 'bg-surface text-accent shadow-card' : 'text-muted hover:text-ink'].join(' ')}
              >
                {v === 'list' ? 'List' : 'Grid'}
              </button>
            ))}
          </div>
          {view === 'list' ? (
            <div className="w-56">
              <Select value={groupBy} onChange={v => { setGroupBy(v as GroupBy); resetPage() }} ariaLabel="Group rows" options={groupOptions} />
            </div>
          ) : (
            <div className="w-56">
              <Select
                value={field ?? ''}
                onChange={v => { setPivotField(v); setEditing(null) }}
                ariaLabel="Columns across"
                options={pivotOptions.map(f => ({ value: f, label: `${dimensionLabel(db, f)} across` }))}
              />
            </div>
          )}
          <details className="relative">
            <summary className={`${BUTTON_SECONDARY} cursor-pointer list-none py-1.5`}>Columns</summary>
            <div className="absolute z-20 mt-1 w-64 space-y-1 rounded-card border border-line bg-surface p-3 shadow-card">
              <p className="text-small text-muted">Fields shown as columns</p>
              {allColumns.map(c => (
                <label key={c} className="flex items-center gap-2 text-body">
                  <input
                    type="checkbox"
                    checked={!hidden.includes(c)}
                    onChange={e => setHidden(h => (e.target.checked ? h.filter(x => x !== c) : [...h, c]))}
                  />
                  {dimensionLabel(db, c)}
                </label>
              ))}
            </div>
          </details>
          <label className="flex items-center gap-2 text-small font-semibold text-muted">
            New prices from
            <input
              type="date"
              value={effectiveFrom}
              min={today}
              onChange={e => setEffectiveFrom(e.target.value)}
              aria-label="New prices from"
              className={`${INPUT} h-8 w-40 font-mono`}
            />
          </label>
          <button type="button" className={BUTTON_LINK} onClick={copySheet}>
            {copied ? 'Copied' : 'Copy as spreadsheet'}
          </button>
          <p className="ml-auto text-small text-muted" data-testid="sheet-summary">
            {shown.length} of {rows.length} rate line{rows.length === 1 ? '' : 's'}
            {draftCount > 0 ? `, ${draftCount} draft${draftCount === 1 ? '' : 's'} pending` : ''}. Click a price to change it.
          </p>
        </div>
        {problem && (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-small font-semibold text-danger">
            {problem}
          </p>
        )}
      </div>

      {/* Table */}
      <div className="max-h-[70vh] overflow-auto" data-testid="rate-sheet-scroll">
        {total === 0 ? (
          <p className="px-5 py-10 text-center text-body text-muted">
            {rows.length === 0 ? 'No rates yet. Add a service, then add its first rate.' : 'No rate lines match these filters.'}
          </p>
        ) : view === 'list' ? (
          <table className="w-full min-w-[960px] border-separate border-spacing-0 text-body">
            <thead>
              <tr>
                <th className={TH}>Service</th>
                {columns.map(c => (
                  <th key={c} className={TH}>
                    {dimensionLabel(db, c)}
                  </th>
                ))}
                <th className={`${TH} text-right`}>Price</th>
                <th className={TH}>Unit</th>
                <th className={TH}>Effective</th>
                <th className={TH}>Changes</th>
                <th className={`${TH} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageGroups.map(g => (
                <GroupRows
                  key={g.id}
                  label={g.label}
                  count={groups.find(x => x.id === g.id)?.rows.length ?? g.rows.length}
                  span={columns.length + 6}
                  onAdd={groupBy === 'service' ? () => onAddRate({ catalogId: g.id }) : undefined}
                  showHeader={groupBy !== 'none'}
                >
                  {g.rows.map(row => {
                    const editingThis = editing === row.key
                    return (
                      <tr key={row.key} data-line={row.key} className={editingThis ? 'bg-accent-soft/40' : 'hover:bg-surface-muted/60'}>
                        <td className={TD}>
                          <span className="block font-semibold text-ink">{row.item.name}</span>
                          <span className="block text-small text-muted">
                            {row.item.sizeLabel}
                            {groupBy !== 'category' && row.category ? `, ${row.category.name}` : ''}
                          </span>
                        </td>
                        {columns.map(c => (
                          <td key={c} className={TD}>
                            <FieldCell fieldId={c} valueId={row.values[c]} />
                          </td>
                        ))}
                        <td className={`${TD} text-right`}>
                          {editingThis ? (
                            <PriceEditor
                              initialCents={row.drafts[0]?.priceCents ?? newestPublished(row)?.priceCents}
                              label={`New price for ${row.item.name}`}
                              onDone={(cents, move) => {
                                if (cents !== null && !saveCell(row.catalogId, row.values, row, cents)) return false
                                setEditing(listNext(row.key, move))
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => setEditing(row.key)}
                              title="Click to change this price"
                              aria-label={`Price for ${[row.item.name, ...Object.entries(row.values).map(([d, v]) => valueLabel(db, d, v))].join(', ')}: ${cellPrice(row) !== undefined ? formatCents(cellPrice(row)!) : 'not set'}. Click to change`}
                              className="whitespace-nowrap rounded-sm px-2 py-1 font-mono text-mono font-bold text-ink hover:bg-accent-soft hover:text-accent"
                            >
                              {cellPrice(row) !== undefined ? formatCents(cellPrice(row)!) : <span className="font-sans text-small font-normal text-muted">Set a price</span>}
                            </button>
                          )}
                        </td>
                        <td className={`${TD} whitespace-nowrap text-small text-muted`}>{unitText(db, row.item)}</td>
                        <td className={`${TD} whitespace-nowrap font-mono text-mono text-ink`}>{row.current?.effectiveFrom ?? ''}</td>
                        <td className={TD}>
                          <span className="flex flex-wrap items-center gap-1">
                            <LineMarkers row={row} />
                            {row.current && (
                              <span className="max-w-[160px] truncate font-mono text-eyebrow text-muted" title={`${row.current.id}${row.versionCount > 1 ? `, ${row.versionCount} versions` : ''}`}>
                                {row.current.id}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className={`${TD} whitespace-nowrap text-right`}>
                          <button
                            type="button"
                            className={BUTTON_LINK}
                            onClick={() => {
                              const priceCents = row.drafts[0]?.priceCents ?? newestPublished(row)?.priceCents
                              onEditRate({ catalogId: row.catalogId, values: row.values, ...(priceCents !== undefined ? { priceCents } : {}) })
                            }}
                            aria-label={`Edit rate for ${row.item.name}`}
                            title="Change this rate's price, values, who pays it, and when"
                          >
                            Edit
                          </button>
                          <button type="button" className={BUTTON_LINK} onClick={() => onHistory(row)}>
                            History
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </GroupRows>
              ))}
            </tbody>
          </table>
        ) : grid ? (
          <table className="w-full min-w-[960px] border-separate border-spacing-0 text-body">
            <thead>
              <tr>
                <th className={TH}>Service</th>
                {columns.filter(c => c !== grid.field).map(c => (
                  <th key={c} className={TH}>
                    {dimensionLabel(db, c)}
                  </th>
                ))}
                {grid.columns.map(col => (
                  <th key={col.id || '_any'} className={`${TH} text-right normal-case tracking-normal text-small`}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gridRows.map((pr, rowIndex) => (
                <tr key={pr.key} data-grid-row={pr.key} className="hover:bg-surface-muted/60">
                  <td className={TD}>
                    <span className="block font-semibold text-ink">{pr.item.name}</span>
                    <span className="block text-small text-muted">{unitText(db, pr.item)}</span>
                  </td>
                  {columns.filter(c => c !== grid.field).map(c => (
                    <td key={c} className={TD}>
                      <FieldCell fieldId={c} valueId={pr.values[c]} />
                    </td>
                  ))}
                  {grid.columns.map((col, colIndex) => {
                    const cellKey = `${pr.key}::${col.id}`
                    const line = pr.cells.get(col.id)
                    const cellValues = col.id ? { ...pr.values, [grid.field]: col.id } : pr.values
                    const where = `${pr.item.name}, ${col.label}`
                    return (
                      <td key={col.id || '_any'} className={`${TD} text-right ${editing === cellKey ? 'bg-accent-soft/40' : ''}`}>
                        {editing === cellKey ? (
                          <PriceEditor
                            initialCents={line ? (line.drafts[0]?.priceCents ?? newestPublished(line)?.priceCents) : undefined}
                            label={`Price for ${where}`}
                            onDone={(cents, move) => {
                              if (cents !== null && !saveCell(pr.item.id, cellValues, line, cents)) return false
                              setEditing(gridNext(rowIndex, colIndex, move))
                            }}
                          />
                        ) : line ? (
                          <button type="button" onClick={() => setEditing(cellKey)} title={`${where}: click to change`} className="inline-flex flex-col items-end rounded-sm px-2 py-1 hover:bg-accent-soft">
                            <span className="font-mono text-mono font-bold text-ink">{cellPrice(line) !== undefined ? formatCents(cellPrice(line)!) : 'Set'}</span>
                            <span className="flex flex-wrap justify-end gap-1">
                              <LineMarkers row={line} compact />
                            </span>
                          </button>
                        ) : (
                          <button type="button" onClick={() => setEditing(cellKey)} aria-label={`Add a rate for ${where}`} className="rounded-sm px-2 py-1 text-small text-muted hover:bg-accent-soft hover:text-accent">
                            + add
                          </button>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-5 py-10 text-center text-body text-muted">These rates are not keyed by any field with a short list of values, so there is nothing to lay across.</p>
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-small text-muted">
          <span>
            Page {current + 1} of {pages}, {PAGE_SIZE} per page
          </span>
          <span className="flex gap-2">
            <button type="button" className={BUTTON_LINK} disabled={current === 0} onClick={() => setPage(current - 1)}>
              Previous
            </button>
            <button type="button" className={BUTTON_LINK} disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
              Next
            </button>
          </span>
        </div>
      )}
      <p className="rounded-b-card border-t border-line bg-surface-muted px-4 py-2 text-small text-muted">
        Enter saves and moves down, Tab saves and moves right, Escape cancels. Every change is a draft from {effectiveFrom}; nothing a customer is billed changes until it is published.
      </p>
    </section>
  )
}

function GroupRows({ label, count, span, onAdd, showHeader, children }: { label: string; count: number; span: number; onAdd?: () => void; showHeader: boolean; children: ReactNode }) {
  return (
    <>
      {showHeader && (
        <tr>
          <th colSpan={span} scope="colgroup" className="border-b border-line bg-surface px-3 pb-1.5 pt-4 text-left">
            <span className="flex items-center gap-2">
              <span className="text-body font-bold text-ink">{label}</span>
              <span className="text-small font-normal text-muted">
                {count} line{count === 1 ? '' : 's'}
              </span>
              {onAdd && (
                <button type="button" className={`${BUTTON_LINK} ml-auto`} onClick={onAdd}>
                  Add rate
                </button>
              )}
            </span>
          </th>
        </tr>
      )}
      {children}
    </>
  )
}
