/**
 * The pricing configuration the Ratebook edits (DECISIONS.md entry 65): dimensions and their values, services and
 * their categories, and the flat rate table in which a rate may be keyed by any number of dimensions. Pure functions
 * over a Db; nothing here writes. Pass withDrafts(db, drafts) to see pending drafts as rows.
 */
import type { Frequency, LOB, PricingDimension, RateVersion, ServiceCatalog, ServiceCategory } from '../../../types'
import type { Db } from '../../../store/db'
import { FREQUENCIES, FREQUENCY_LABEL, resolveRate } from './engine'
import { fieldValueId } from '../../../store/engine'
import { catalogGroups, type CatalogLine } from './ratebook'

export interface DimValue {
  id: string
  label: string
}

export const LOB_NAME: Record<LOB, string> = { residential: 'Residential', frontload: 'Frontload', rolloff: 'Roll-off' }
export const ALL_LOBS: LOB[] = ['residential', 'frontload', 'rolloff']

/** The cycles the billing engine runs. New kinds of cycle are billing engine work (src/store/cycles.ts). */
export const CYCLE_LABEL: Record<string, string> = { monthly: 'Monthly', quarterly: 'Quarterly', perJob: 'Per job', net30: 'Net 30' }

export const SOURCE_LABEL: Record<PricingDimension['source'], string> = {
  zone: 'Zone type of the site',
  geoZone: 'Zone drawn on the map, from the site location',
  frequency: 'Frequency of the service',
  service: 'The service itself',
  category: 'Category of the service',
  lob: 'Line of business',
  cycle: 'Billing cycle of the account',
  dayOfWeek: 'Route day or service date',
  material: 'Roll-off material on the ticket',
  account: 'Set on each customer account',
  site: 'Set on each service site',
  serviceLine: 'Set on each service line',
  input: 'Asked when quoting',
}

/** The sources a person can create a dimension with. The others are built in and read from the line. */
export const CUSTOM_SOURCES: PricingDimension['source'][] = ['account', 'site', 'serviceLine', 'input']

export type FieldType = NonNullable<PricingDimension['type']>
export const FIELD_TYPES: FieldType[] = ['choice', 'number', 'yesNo', 'text']
export const FIELD_TYPE_LABEL: Record<FieldType, string> = { choice: 'Choice', number: 'Number', yesNo: 'Yes or no', text: 'Text' }
export const FIELD_TYPE_HINT: Record<FieldType, string> = {
  choice: 'One of a list you name: VIP, national broker, standard.',
  number: 'A number in a unit, priced by bands (20 to 29 cubic yards) or used as a quantity (collections per month).',
  yesNo: 'On or off: include equipment rental, entry required.',
  text: 'Kept for reference (a PO number, a gate code). Never changes a price.',
}
export const YES_NO_VALUES = [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }]

export const fieldTypeOf = (dim: Pick<PricingDimension, 'type'>): FieldType => dim.type ?? 'choice'

/** A field a price can depend on: every field but text. */
export const isPriceable = (dim: Pick<PricingDimension, 'type'>): boolean => fieldTypeOf(dim) !== 'text'

/** Number fields, which a service can multiply its price by. */
export function numberFields(db: Db): PricingDimension[] {
  return dimensions(db).filter(d => d.type === 'number')
}

/** "12 collections per month", "Yes", "VIP": a raw field value as a person reads it. */
export function rawValueText(dim: PricingDimension, raw: string | undefined): string {
  if (raw === undefined || raw === '') return ''
  const type = fieldTypeOf(dim)
  if (type === 'number') return `${raw}${dim.unit ? ` ${dim.unit}` : ''}`
  if (type === 'text') return raw
  if (type === 'yesNo') return raw === 'yes' ? 'Yes' : raw === 'no' ? 'No' : raw
  return dim.values.find(v => v.id === raw)?.label ?? raw
}

/** "20 to 29", "40 or more", "under 5": a band's range in the field's unit. */
export function bandText(band: { min?: number; max?: number }, unit?: string): string {
  const u = unit ? ` ${unit}` : ''
  if (band.min !== undefined && band.max !== undefined) return `${band.min} to under ${band.max}${u}`
  if (band.min !== undefined) return `${band.min} or more${u}`
  if (band.max !== undefined) return `under ${band.max}${u}`
  return `any${u}`
}

export type PriceUnit = NonNullable<ServiceCatalog['priceUnit']>
export const PRICE_UNITS: PriceUnit[] = ['month', 'pickup', 'haul', 'ton', 'day', 'item', 'oneTime']
export const PRICE_UNIT_LABEL: Record<PriceUnit, string> = {
  month: 'per month', pickup: 'per pickup', haul: 'per haul', ton: 'per ton', day: 'per day', item: 'each', oneTime: 'one time',
}
export const PRICE_UNIT_SHORT: Record<PriceUnit, string> = {
  month: '/mo', pickup: '/pickup', haul: '/haul', ton: '/t', day: '/day', item: ' each', oneTime: ' once',
}

export function priceUnitOf(item: Pick<ServiceCatalog, 'priceUnit' | 'lob'>): PriceUnit {
  return item.priceUnit ?? (item.lob === 'rolloff' ? 'haul' : 'month')
}

/** The dimensions a service's rates are keyed by: its pricedBy, else zone and frequency (zone alone for a haul). */
export function pricedByOf(item: Pick<ServiceCatalog, 'pricedBy' | 'lob'>): string[] {
  if (item.pricedBy?.length) return item.pricedBy
  return item.lob === 'rolloff' ? ['zone'] : ['zone', 'frequency']
}

export function dimensions(db: Db): PricingDimension[] {
  return db.pricingDimensions ?? []
}

export function dimensionById(db: Db, id: string): PricingDimension | undefined {
  return dimensions(db).find(d => d.id === id)
}

export function dimensionLabel(db: Db, id: string): string {
  return dimensionById(db, id)?.name ?? id
}

/** A dimension's values: its own list, or the rows of the table it reads from. */
export function dimensionValues(db: Db, dim: Pick<PricingDimension, 'source' | 'values'>): DimValue[] {
  switch (dim.source) {
    case 'zone':
      return db.zones.map(z => ({ id: z.id, label: z.name }))
    case 'geoZone':
      return (db.geoZones ?? []).map(z => ({ id: z.id, label: z.name }))
    case 'frequency':
      return FREQUENCIES.map(f => ({ id: f, label: FREQUENCY_LABEL[f] }))
    case 'service':
      return db.catalog.map(c => ({ id: c.id, label: c.name }))
    case 'category':
      return (db.serviceCategories ?? []).map(c => ({ id: c.id, label: c.name }))
    case 'lob':
      return ALL_LOBS.map(l => ({ id: l, label: LOB_NAME[l] }))
    case 'cycle': {
      const seen = new Set([...Object.keys(CYCLE_LABEL), ...db.accounts.map(a => a.cycle)])
      return [...seen].map(id => ({ id, label: CYCLE_LABEL[id] ?? id }))
    }
    case 'material':
      return (db.rolloffMaterials ?? []).map(m => ({ id: m.id, label: m.name }))
    default:
      return dim.values
  }
}

export function valuesOf(db: Db, dimId: string): DimValue[] {
  const dim = dimensionById(db, dimId)
  return dim ? dimensionValues(db, dim) : []
}

export function valueLabel(db: Db, dimId: string, valueId: string): string {
  return valuesOf(db, dimId).find(v => v.id === valueId)?.label ?? valueId
}

export function categoryOf(db: Db, item: Pick<ServiceCatalog, 'categoryId'>): ServiceCategory | undefined {
  return item.categoryId ? (db.serviceCategories ?? []).find(c => c.id === item.categoryId) : undefined
}

export interface CategoryGroup {
  category?: ServiceCategory
  items: ServiceCatalog[]
}

/** Services grouped by category in category order; items with no category come last. */
export function servicesByCategory(db: Db): CategoryGroup[] {
  const groups: CategoryGroup[] = (db.serviceCategories ?? []).map(category => ({ category, items: db.catalog.filter(c => c.categoryId === category.id) }))
  const known = new Set((db.serviceCategories ?? []).map(c => c.id))
  const loose = db.catalog.filter(c => !c.categoryId || !known.has(c.categoryId))
  if (loose.length) groups.push({ items: loose })
  return groups
}

export interface ServiceUsage {
  /** Active service lines that bill this item. */
  activeLines: number
  /** Containers of this type in inventory (placed or in the yard). */
  containers: number
  /** Rate versions, drafts included when the db is a view with drafts. */
  rates: number
}

export function serviceUsage(db: Db, catalogId: string): ServiceUsage {
  return {
    activeLines: db.serviceItems.filter(si => si.catalogId === catalogId && si.status === 'active').length,
    containers: db.containers.filter(c => c.catalogId === catalogId).length,
    rates: db.rateVersions.filter(rv => rv.catalogId === catalogId).length,
  }
}

/** A rate line with every value it is keyed by spelled out (zone, frequency, and extra dims), for the flat table. */
export interface RateRow extends CatalogLine {
  item: ServiceCatalog
  category?: ServiceCategory
  values: Record<string, string>
}

export function rateRows(db: Db, today: string): RateRow[] {
  return ALL_LOBS.flatMap(lob =>
    catalogGroups(db, lob, today).flatMap(({ item, lines }) =>
      lines.map(line => ({
        ...line,
        item,
        ...(categoryOf(db, item) ? { category: categoryOf(db, item) } : {}),
        values: {
          ...(line.zoneId ? { zone: line.zoneId } : {}),
          ...(line.frequency ? { frequency: line.frequency } : {}),
          ...(line.dims ?? {}),
        },
      })),
    ),
  )
}

export interface RateFilter {
  lob?: LOB
  categoryId?: string
  catalogId?: string
  search?: string
  /** Dimension id to value id. A row matches when it has that value or is not keyed by the dimension ("any"). */
  values?: Record<string, string>
  state?: 'all' | 'drafts' | 'scheduled' | 'noRate'
}

export function filterRateRows(db: Db, rows: RateRow[], filter: RateFilter): RateRow[] {
  const q = filter.search?.trim().toLowerCase()
  return rows.filter(row => {
    if (filter.lob && row.item.lob !== filter.lob) return false
    if (filter.categoryId && row.item.categoryId !== filter.categoryId) return false
    if (filter.catalogId && row.item.id !== filter.catalogId) return false
    for (const [dimId, valueId] of Object.entries(filter.values ?? {})) {
      if (valueId && row.values[dimId] !== undefined && row.values[dimId] !== valueId) return false
    }
    if (filter.state === 'drafts' && row.drafts.length === 0) return false
    if (filter.state === 'scheduled' && row.scheduled.length === 0) return false
    if (filter.state === 'noRate' && row.current) return false
    if (q) {
      const text = [row.item.name, row.item.id, row.category?.name ?? '', ...Object.entries(row.values).map(([d, v]) => valueLabel(db, d, v))].join(' ').toLowerCase()
      if (!text.includes(q)) return false
    }
    return true
  })
}

/** The extra dimension columns the rows use beyond zone and frequency, in first-seen order. */
export function extraColumns(rows: RateRow[]): string[] {
  const seen: string[] = []
  for (const row of rows) for (const k of Object.keys(row.dims ?? {})) if (!seen.includes(k)) seen.push(k)
  return seen
}

/** Split a combination of values into RateVersion fields: zone and frequency are columns, the rest are dims. */
export function rateFieldsOf(values: Record<string, string>): { zoneId?: string; frequency?: Frequency; dims?: Record<string, string> } {
  const { zone, frequency, ...rest } = values
  const dims = Object.fromEntries(Object.entries(rest).filter(([, v]) => !!v))
  return {
    ...(zone ? { zoneId: zone } : {}),
    ...(frequency ? { frequency: frequency as Frequency } : {}),
    ...(Object.keys(dims).length ? { dims } : {}),
  }
}

/** Every combination of the chosen values across the axes, capped so a slip of the mouse cannot queue a million drafts. */
export const MAX_COMBINATIONS = 500

export function combinations(axes: { dimId: string; valueIds: string[] }[]): Record<string, string>[] {
  let out: Record<string, string>[] = [{}]
  for (const axis of axes) {
    if (axis.valueIds.length === 0) continue
    const next: Record<string, string>[] = []
    for (const combo of out) for (const v of axis.valueIds) next.push({ ...combo, [axis.dimId]: v })
    out = next
    if (out.length > MAX_COMBINATIONS) return out.slice(0, MAX_COMBINATIONS)
  }
  return out
}

/**
 * What a combination bills today with no account: the rate resolvePrice picks for those values (a less specific rate
 * when no rate is keyed by all of them), or undefined when nothing is published. Used to prefill a matrix and to say
 * which rate a new one would override.
 */
export function priceFor(db: Db, catalogId: string, values: Record<string, string>, onDate: string): { cents: number; rate?: RateVersion } | undefined {
  const item = db.catalog.find(c => c.id === catalogId)
  if (!item) return undefined
  const { zoneId, frequency, dims } = rateFieldsOf(values)
  const freq = frequency ?? (item.lob === 'rolloff' ? 'onCall' : 'weekly')
  try {
    const r = resolveRate({ catalogId, frequency: freq, ...(zoneId ? { zoneId } : {}), onDate, ...(dims ? { context: dims } : {}) }, db)
    const rate = r.rateVersionId ? db.rateVersions.find(rv => rv.id === r.rateVersionId) : undefined
    return { cents: r.priceCents, ...(rate ? { rate } : {}) }
  } catch {
    return undefined
  }
}

/** Lowercase words joined by underscores, for readable ids. */
export function slugify(text: string, max = 24): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, max) || 'item'
}

/** prefix_slug, then prefix_slug_2, _3, when taken. */
export function uniqueId(prefix: string, name: string, taken: ReadonlySet<string>): string {
  const base = `${prefix}_${slugify(name)}`
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}_${n}`)) n += 1
  return `${base}_${n}`
}

/** How often each value of a dimension is used: assignments, fee and tax conditions, and rate dims. */
export function dimensionUsage(db: Db, dimId: string, drafts: RateVersion[] = []): Map<string, number> {
  const counts = new Map<string, number>()
  const bump = (v: string) => counts.set(v, (counts.get(v) ?? 0) + 1)
  const dim = dimensionById(db, dimId)
  // A number field stores numbers; each counts for the band it falls in, so a band still holding numbers is in use.
  for (const v of Object.values(dim?.assignments ?? {})) {
    const id = dim?.type === 'number' ? fieldValueId(dim, v) : v
    if (id) bump(id)
  }
  for (const r of [...db.feeRules, ...db.taxRules]) for (const v of r.when?.[dimId] ?? []) bump(v)
  for (const rv of [...db.rateVersions, ...drafts]) if (rv.dims?.[dimId]) bump(rv.dims[dimId])
  for (const c of db.catalog) if (c.pricedBy?.includes(dimId)) bump('__pricedBy')
  return counts
}
