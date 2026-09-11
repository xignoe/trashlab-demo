/**
 * RateVersion write rules shared by the pricing slice and the Ratebook (moved from pricing/src/store/store.ts).
 * Pure: no store access, no clock reads.
 *
 * Drafts live in the pricing slice (pricingDrafts), never in db. The Ratebook reads a view of the db with the
 * drafts appended (withDrafts), and the canonical resolvePrice ignores any row whose status is not published, so a
 * draft can never change what a customer is billed until publishRateVersions appends it to db.rateVersions.
 */
import type { Frequency, RateVersion } from '../../../types'
import type { Db } from '../../../store/db'
import { TZ_OFFSET } from '../../../store/clock'
import { dateOnly, yyyymmdd } from './dates'

export interface CreateDraftRateVersionArgs {
  catalogId: string
  zoneId?: string
  frequency?: Frequency
  priceCents: number
  effectiveFrom: string
  supersedesId?: string
  /** Extra dimension values (RateVersion.dims). Empty or absent: the line is keyed by catalog, zone, and frequency only. */
  dims?: Record<string, string>
  /** 'newService': only service starting on or after effectiveFrom pays it. Absent or 'everyone': every matching line. */
  appliesTo?: RateVersion['appliesTo']
}

/** "customerTier=vip,serviceSpeed=sameDay": a stable key for a rate's extra dimensions, '' when it has none. */
export function dimsKey(dims?: Record<string, string>): string {
  if (!dims) return ''
  return Object.keys(dims).sort().map(k => `${k}=${dims[k]}`).join(',')
}

const hasDims = (dims?: Record<string, string>): dims is Record<string, string> => !!dims && Object.keys(dims).length > 0

/** Runtime rate versions carry the pricing infix (addendum C12), like billing's rv_bl_ and storefront's _sf. */
export const PRICING_RATE_VERSION_PREFIX = 'rv_pr_'

/** Readable, unique id: rv_pr_res_96_open_weekly_20261001, then _2, _3 when that id is taken. */
export function nextRateVersionId(taken: ReadonlySet<string>, args: CreateDraftRateVersionArgs): string {
  const cat = args.catalogId.replace(/^cat_/, '')
  const zone = args.zoneId ? args.zoneId.replace(/^zone_/, '') : 'std'
  const freq = args.frequency ?? 'any'
  const dims = hasDims(args.dims) ? `_${Object.keys(args.dims).sort().map(k => args.dims![k].replace(/[^A-Za-z0-9]+/g, '').toLowerCase()).join('_')}` : ''
  const base = `${PRICING_RATE_VERSION_PREFIX}${cat}_${zone}_${freq}${dims}_${yyyymmdd(args.effectiveFrom)}`
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}_${n}`)) n += 1
  return `${base}_${n}`
}

export function draftFrom(taken: ReadonlySet<string>, args: CreateDraftRateVersionArgs): RateVersion {
  return {
    id: nextRateVersionId(taken, args),
    catalogId: args.catalogId,
    ...(args.zoneId !== undefined ? { zoneId: args.zoneId } : {}),
    ...(args.frequency !== undefined ? { frequency: args.frequency } : {}),
    ...(hasDims(args.dims) ? { dims: { ...args.dims } } : {}),
    priceCents: Math.round(args.priceCents),
    effectiveFrom: dateOnly(args.effectiveFrom),
    status: 'draft',
    ...(args.supersedesId !== undefined ? { supersedesId: args.supersedesId } : {}),
    ...(args.appliesTo === 'newService' ? { appliesTo: 'newService' as const } : {}),
  }
}

/** One rate line: catalog item, zone, frequency, and any extra dimension values. */
export const rateGroupKey = (g: { catalogId: string; zoneId?: string; frequency?: Frequency; dims?: Record<string, string> }): string =>
  `${g.catalogId}|${g.zoneId ?? ''}|${g.frequency ?? ''}${dimsKey(g.dims) ? `|${dimsKey(g.dims)}` : ''}`

/**
 * A draft with no change: it supersedes a version at exactly the same price (pricing checklist 7.7). Publishing it
 * would add a version that bills nobody differently, so publishRateVersions leaves it as a draft and the drafts tray
 * flags it. A draft with no supersedesId opens a new line and is always a change.
 */
export function isNoChangeDraft(draft: RateVersion, rateVersions: RateVersion[]): boolean {
  if (draft.status !== 'draft' || !draft.supersedesId) return false
  const superseded = rateVersions.find(rv => rv.id === draft.supersedesId)
  return !!superseded && superseded.priceCents === draft.priceCents
}

/** The db with the slice's drafts appended to rateVersions, for the Ratebook's read side. */
export function withDrafts(db: Db, drafts: RateVersion[]): Db {
  return drafts.length === 0 ? db : { ...db, rateVersions: [...db.rateVersions, ...drafts] }
}

/**
 * For each (catalogId, zoneId, frequency) group among the given catalog ids, the published version that is latest
 * by effectiveFrom, then by publishedAt. A version published for a future date counts: a bulk increase supersedes
 * the newest price on the line, not only the one in force today.
 */
export function latestPublishedPerGroup(rateVersions: RateVersion[], catalogIds: ReadonlySet<string>): RateVersion[] {
  const latest = new Map<string, RateVersion>()
  for (const rv of rateVersions) {
    if (rv.status !== 'published' || !catalogIds.has(rv.catalogId)) continue
    const key = rateGroupKey(rv)
    const cur = latest.get(key)
    const newer =
      !cur ||
      dateOnly(rv.effectiveFrom) > dateOnly(cur.effectiveFrom) ||
      (dateOnly(rv.effectiveFrom) === dateOnly(cur.effectiveFrom) && (rv.publishedAt ?? '') > (cur.publishedAt ?? ''))
    if (newer) latest.set(key, rv)
  }
  return [...latest.values()]
}

/**
 * publishedAt for a publish made from the Ratebook (addendum E1: no new Date(), Eastern daylight time). The first
 * publish of a session is the clock's day at 09:00 -04:00; each later one is a minute after the last, so the history
 * drawer still orders publishes made in one sitting.
 */
export function publishedAtFor(day: string, publishIndex: number): string {
  const minutes = 9 * 60 + publishIndex
  const hh = String(Math.floor(minutes / 60) % 24).padStart(2, '0')
  const mm = String(minutes % 60).padStart(2, '0')
  return `${dateOnly(day)}T${hh}:${mm}:00${TZ_OFFSET}`
}
