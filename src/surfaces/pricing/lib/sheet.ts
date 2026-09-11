/**
 * The rate sheet (DECISIONS.md entry 68): every rate line of every service in one table, whatever fields it is keyed
 * by. Pure functions over RateRow (lib/config.ts rateRows); nothing here writes. The sheet can be grouped by category,
 * line of business, service, or any field, and pivoted so one field's values become columns (zones across, services
 * down), which is the grid a hauler's rate card usually is.
 */
import type { RateVersion, ServiceCatalog } from '../../../types'
import type { Db } from '../../../store/db'
import type { CreateDraftRateVersionArgs } from './rateVersions'
import {
  categoryOf, dimensionById, dimensionLabel, LOB_NAME, PRICE_UNIT_LABEL, pricedByOf, priceUnitOf, rateFieldsOf, valueLabel, valuesOf, type RateRow,
} from './config'

/**
 * The field columns for these rows: zone and frequency first, then every other field a row is keyed by or its service
 * is priced by, in first-seen order. A row not keyed by a column's field shows "Any" there.
 */
export function sheetColumns(rows: RateRow[]): string[] {
  const seen: string[] = []
  const add = (id: string) => {
    if (id !== 'service' && !seen.includes(id)) seen.push(id)
  }
  for (const row of rows) {
    for (const d of pricedByOf(row.item)) add(d)
    for (const d of Object.keys(row.values)) add(d)
  }
  const rank = (id: string) => (id === 'zone' ? 0 : id === 'frequency' ? 1 : 2)
  return seen.map((id, i) => ({ id, i })).sort((a, b) => rank(a.id) - rank(b.id) || a.i - b.i).map(x => x.id)
}

export type GroupBy = 'category' | 'lob' | 'service' | 'none' | `field:${string}`

export interface SheetGroup {
  id: string
  label: string
  rows: RateRow[]
}

/** Rows split into groups, in the order the owner's tables list them (categories and services in catalog order). */
export function groupRows(db: Db, rows: RateRow[], by: GroupBy): SheetGroup[] {
  if (by === 'none') return rows.length ? [{ id: 'all', label: 'All rates', rows }] : []
  const groups = new Map<string, SheetGroup>()
  const push = (id: string, label: string, row: RateRow) => {
    const g = groups.get(id) ?? { id, label, rows: [] }
    g.rows.push(row)
    groups.set(id, g)
  }
  for (const row of rows) {
    if (by === 'category') push(row.category?.id ?? '_none', row.category?.name ?? 'No category', row)
    else if (by === 'lob') push(row.item.lob, LOB_NAME[row.item.lob], row)
    else if (by === 'service') push(row.item.id, row.item.name, row)
    else {
      const field = by.slice('field:'.length)
      const v = row.values[field]
      push(v ?? '_any', v ? valueLabel(db, field, v) : `Any ${dimensionLabel(db, field).toLowerCase()}`, row)
    }
  }
  const out = [...groups.values()]
  if (by === 'category') {
    const order = new Map((db.serviceCategories ?? []).map((c, i) => [c.id, i] as [string, number]))
    out.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999))
  }
  if (by.startsWith('field:')) {
    const order = new Map(valuesOf(db, by.slice('field:'.length)).map((v, i) => [v.id, i] as [string, number]))
    out.sort((a, b) => (order.get(a.id) ?? -1) - (order.get(b.id) ?? -1))
  }
  return out
}

export interface PivotRow {
  /** Service plus every value but the pivot field's: one row of the grid. */
  key: string
  item: ServiceCatalog
  values: Record<string, string>
  /** Pivot value id ('' for rates not keyed by the field) to the rate line in that cell. */
  cells: Map<string, RateRow>
}

export interface Pivot {
  field: string
  columns: { id: string; label: string }[]
  rows: PivotRow[]
}

/**
 * One field's values as columns. Every value of the field is a column, used or not, so an empty cell is a rate the
 * owner has not set yet (click to add). Rates not keyed by the field sit in an "Any" column first.
 */
export function pivot(db: Db, rows: RateRow[], field: string): Pivot {
  const out = new Map<string, PivotRow>()
  let anyUsed = false
  for (const row of rows) {
    const { [field]: col = '', ...rest } = row.values
    if (!col) anyUsed = true
    const key = `${row.item.id}|${Object.keys(rest).sort().map(k => `${k}=${rest[k]}`).join('&')}`
    const pr = out.get(key) ?? { key, item: row.item, values: rest, cells: new Map<string, RateRow>() }
    pr.cells.set(col, row)
    out.set(key, pr)
  }
  const columns = [
    ...(anyUsed ? [{ id: '', label: `Any ${dimensionLabel(db, field).toLowerCase()}` }] : []),
    ...valuesOf(db, field).map(v => ({ id: v.id, label: v.label })),
  ]
  return { field, columns, rows: [...out.values()] }
}

/** Fields that make a readable pivot: used by the rows, with a short list of values. */
export function pivotFields(db: Db, rows: RateRow[]): string[] {
  return sheetColumns(rows).filter(f => {
    const n = valuesOf(db, f).length
    return n > 0 && n <= 16
  })
}

/** "per month", "per pickup, x collections per month": what one price buys, with the quantity it is multiplied by. */
export function unitText(db: Db, item: ServiceCatalog): string {
  const base = PRICE_UNIT_LABEL[priceUnitOf(item)]
  const q = item.quantityField ? dimensionById(db, item.quantityField) : undefined
  return q ? `${base}, x ${q.unit ?? q.name.toLowerCase()}` : base
}

/** The newest published version of a line, which a new price supersedes: a scheduled one first, else the one in force. */
export function newestPublished(row: Pick<RateRow, 'scheduled' | 'current'>): RateVersion | undefined {
  return row.scheduled[0] ?? row.current
}

/** The price a cell shows: the pending draft's, else what is in force today, else the newest scheduled. */
export function shownPrice(row: Pick<RateRow, 'drafts' | 'current' | 'scheduled' | 'effectiveToday'>): { cents: number; kind: 'draft' | 'inForce' | 'scheduled' } | undefined {
  if (row.drafts[0]) return { cents: row.drafts[0].priceCents, kind: 'draft' }
  if (row.current && row.effectiveToday) return { cents: row.current.priceCents, kind: 'inForce' }
  const s = row.scheduled[0] ?? row.current
  return s ? { cents: s.priceCents, kind: 'scheduled' } : undefined
}

/** The draft a cell edit writes: the line's own fields, superseding its newest published version when it has one. */
export function cellDraftArgs(catalogId: string, values: Record<string, string>, priceCents: number, effectiveFrom: string, supersedes?: RateVersion): CreateDraftRateVersionArgs {
  return { catalogId, ...rateFieldsOf(values), priceCents, effectiveFrom, ...(supersedes ? { supersedesId: supersedes.id } : {}) }
}

/** Plain text of a row for search: service, category, and every value label. */
export function rowText(db: Db, row: RateRow): string {
  return [row.item.name, row.item.id, categoryOf(db, row.item)?.name ?? '', ...Object.entries(row.values).map(([d, v]) => valueLabel(db, d, v))].join(' ').toLowerCase()
}

/** Every value the sheet can show as tab-separated text, for pasting into a spreadsheet. */
export function sheetTsv(db: Db, rows: RateRow[], columns: string[]): string {
  const head = ['Service', 'Category', ...columns.map(c => dimensionLabel(db, c)), 'Price', 'Unit', 'Effective', 'Version']
  const lines = rows.map(r => {
    const price = shownPrice(r)
    return [
      r.item.name, r.category?.name ?? '',
      ...columns.map(c => (r.values[c] ? valueLabel(db, c, r.values[c]) : 'Any')),
      price ? (price.cents / 100).toFixed(2) : '', unitText(db, r.item), r.current?.effectiveFrom ?? '', r.current?.id ?? '',
    ].join('\t')
  })
  return [head.join('\t'), ...lines].join('\n')
}
