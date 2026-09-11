/**
 * Read-side selectors for the Ratebook (moved from pricing/src/lib/ratebook.ts). Pure functions over a Db, so they
 * are testable without React and so the history drawer and the table agree on what "current" means. Pass the view
 * from withDrafts(db, drafts) to see pending drafts beside the published versions.
 */
import type { FeeRule, Frequency, LOB, RateVersion, ServiceCatalog, TaxRule, Zone } from '../../../types'
import type { Db } from '../../../store/db'
import { dateOnly } from './dates'
import { resolveRate } from './engine'
import { dimsKey } from './rateVersions'
import { formatCents, formatPct } from './money'

export interface RateGroupKey {
  catalogId: string
  zoneId?: string
  frequency?: Frequency
  /** Extra dimension values (RateVersion.dims). */
  dims?: Record<string, string>
}

export const groupKeyOf = (k: RateGroupKey): string =>
  `${k.catalogId}|${k.zoneId ?? ''}|${k.frequency ?? ''}${dimsKey(k.dims) ? `|${dimsKey(k.dims)}` : ''}`

const FREQUENCY_ORDER: Record<string, number> = { weekly: 0, eow: 1, '2x': 2, '3x': 3, '4x': 4, '5x': 5, '6x': 6, onCall: 7, '': 8 }

/** Newest first: latest effectiveFrom, then latest publishedAt (drafts have none and sort after a published row with
 *  the same date), then id so the order is stable. */
export function newestFirst(a: RateVersion, b: RateVersion): number {
  const byDate = dateOnly(b.effectiveFrom).localeCompare(dateOnly(a.effectiveFrom))
  if (byDate !== 0) return byDate
  const byPublished = (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')
  if (byPublished !== 0) return byPublished
  return a.id.localeCompare(b.id)
}

export interface CatalogLine extends RateGroupKey {
  key: string
  /** The version resolvePrice picks as of today, or the latest published in the group when none is in force yet. */
  current?: RateVersion
  /** True when `current` is what resolvePrice returned for today. */
  effectiveToday: boolean
  ruleWon?: 'zoneRate' | 'standardRate'
  drafts: RateVersion[]
  /** Published versions whose effectiveFrom is after today, newest first: shown as "Scheduled" beside the price. */
  scheduled: RateVersion[]
  versionCount: number
}

export interface CatalogGroup {
  item: ServiceCatalog
  lines: CatalogLine[]
}

export function versionsInGroup(db: Db, key: RateGroupKey): RateVersion[] {
  return db.rateVersions.filter(
    rv => rv.catalogId === key.catalogId && (rv.zoneId ?? '') === (key.zoneId ?? '') && (rv.frequency ?? '') === (key.frequency ?? '') && dimsKey(rv.dims) === dimsKey(key.dims),
  )
}

function pickCurrent(db: Db, key: RateGroupKey, versions: RateVersion[], today: string): Pick<CatalogLine, 'current' | 'effectiveToday' | 'ruleWon'> {
  const published = versions.filter(rv => rv.status === 'published')
  if (dimsKey(key.dims)) {
    // A dimension line bills only lines with those values, so "current" is simply its own version in force today.
    const inForce = published.filter(rv => dateOnly(rv.effectiveFrom) <= dateOnly(today)).sort(newestFirst)[0]
    if (inForce) return { current: inForce, effectiveToday: true, ruleWon: key.zoneId ? 'zoneRate' : 'standardRate' }
  } else if (key.frequency) {
    try {
      const r = resolveRate({ catalogId: key.catalogId, frequency: key.frequency, zoneId: key.zoneId, onDate: today }, db)
      const hit = published.find(rv => rv.id === r.rateVersionId)
      if (hit && (r.ruleWon === 'zoneRate' || r.ruleWon === 'standardRate')) return { current: hit, effectiveToday: true, ruleWon: r.ruleWon }
    } catch {
      // No published rate in force for this line today; fall through to "latest published in the group".
    }
  }
  return { current: [...published].sort(newestFirst)[0], effectiveToday: false, ruleWon: key.zoneId ? 'zoneRate' : 'standardRate' }
}

/** One group per catalog item of the lob, one line per (zoneId, frequency) that has any RateVersion. Lines are ordered
 *  by zone (standard first, then the zones table order) and frequency. */
export function catalogGroups(db: Db, lob: LOB, today: string): CatalogGroup[] {
  const zoneOrder = new Map<string, number>([['', -1], ...db.zones.map((z, i) => [z.id, i] as [string, number])])
  return db.catalog
    .filter(c => c.lob === lob)
    .map(item => {
      const keys = new Map<string, RateGroupKey>()
      for (const rv of db.rateVersions) {
        if (rv.catalogId !== item.id) continue
        const k: RateGroupKey = {
          catalogId: rv.catalogId, ...(rv.zoneId ? { zoneId: rv.zoneId } : {}), ...(rv.frequency ? { frequency: rv.frequency } : {}),
          ...(dimsKey(rv.dims) ? { dims: rv.dims } : {}),
        }
        keys.set(groupKeyOf(k), k)
      }
      const lines: CatalogLine[] = [...keys.values()]
        .sort((a, b) => {
          const z = (zoneOrder.get(a.zoneId ?? '') ?? 99) - (zoneOrder.get(b.zoneId ?? '') ?? 99)
          if (z !== 0) return z
          const f = (FREQUENCY_ORDER[a.frequency ?? ''] ?? 9) - (FREQUENCY_ORDER[b.frequency ?? ''] ?? 9)
          return f !== 0 ? f : dimsKey(a.dims).localeCompare(dimsKey(b.dims))
        })
        .map(k => {
          const versions = versionsInGroup(db, k)
          return {
            ...k,
            key: groupKeyOf(k),
            ...pickCurrent(db, k, versions, today),
            drafts: versions.filter(rv => rv.status === 'draft').sort(newestFirst),
            scheduled: versions.filter(rv => rv.status === 'published' && dateOnly(rv.effectiveFrom) > dateOnly(today)).sort(newestFirst),
            versionCount: versions.length,
          }
        })
      return { item, lines }
    })
}

export interface HistoryRow {
  version: RateVersion
  /** Id of the version whose supersedesId points at this one. */
  supersededBy?: string
  /** True for the version resolvePrice picks as of today. */
  isCurrent: boolean
}

/** Every RateVersion in the group, newest first, with the back link a reader needs to walk the chain. */
export function versionHistory(db: Db, key: RateGroupKey, today: string): HistoryRow[] {
  const versions = versionsInGroup(db, key)
  const currentId = pickCurrent(db, key, versions, today).current?.id
  const successorOf = new Map<string, string>()
  for (const rv of db.rateVersions) if (rv.supersedesId) successorOf.set(rv.supersedesId, rv.id)
  return [...versions].sort(newestFirst).map(version => ({
    version,
    ...(successorOf.has(version.id) ? { supersededBy: successorOf.get(version.id) } : {}),
    isCurrent: version.id === currentId,
  }))
}

export function zoneLabel(zones: Zone[], zoneId?: string): string {
  if (!zoneId) return 'All zone types'
  return zones.find(z => z.id === zoneId)?.name ?? zoneId
}

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** "Fuel surcharge: 7% of service lines, applies to recurring and event, taxable". */
export function feeRuleSentence(rule: FeeRule): string {
  const amount = rule.kind === 'percent' ? `${formatPct(rule.value)} of ${rule.base === 'serviceLines' ? 'service lines' : 'all lines'}` : `${formatCents(rule.value)} flat per line`
  return `${rule.name}: ${amount}, applies to ${joinAnd(rule.appliesTo)}, ${rule.taxable ? 'taxable' : 'not taxable'}`
}

/** "zone_open: 7% on recurring, event, fee. Never on late fees". */
export function taxRuleSentence(rule: TaxRule): string {
  return `${rule.zoneId}: ${formatPct(rule.ratePct)} on ${rule.appliesTo.join(', ')}. Never on late fees`
}

export interface LobDraft {
  draft: RateVersion
  item: ServiceCatalog
  /** The version the draft supersedes, when it names one and it still exists. */
  supersedes?: RateVersion
}

/** Every pending draft whose catalog item belongs to the lob, in catalog order then zone and frequency, with the item
 *  and the superseded version attached. The drafts tray, the bulk control's count, and the publish preview all read
 *  this so they can never disagree about what is about to publish. */
export function lobDrafts(db: Db, lob: LOB): LobDraft[] {
  const catalogIndex = new Map(db.catalog.map((c, i) => [c.id, i] as [string, number]))
  const zoneOrder = new Map<string, number>([['', -1], ...db.zones.map((z, i) => [z.id, i] as [string, number])])
  const byId = new Map(db.rateVersions.map(rv => [rv.id, rv] as [string, RateVersion]))
  return db.rateVersions
    .filter(rv => rv.status === 'draft' && db.catalog.find(c => c.id === rv.catalogId)?.lob === lob)
    .sort((a, b) => {
      const c = (catalogIndex.get(a.catalogId) ?? 99) - (catalogIndex.get(b.catalogId) ?? 99)
      if (c !== 0) return c
      const z = (zoneOrder.get(a.zoneId ?? '') ?? 99) - (zoneOrder.get(b.zoneId ?? '') ?? 99)
      if (z !== 0) return z
      const f = (FREQUENCY_ORDER[a.frequency ?? ''] ?? 9) - (FREQUENCY_ORDER[b.frequency ?? ''] ?? 9)
      if (f !== 0) return f
      return newestFirst(a, b)
    })
    .map(draft => {
      const item = db.catalog.find(c => c.id === draft.catalogId)!
      const supersedes = draft.supersedesId ? byId.get(draft.supersedesId) : undefined
      return { draft, item, ...(supersedes ? { supersedes } : {}) }
    })
}
