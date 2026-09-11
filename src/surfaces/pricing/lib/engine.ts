/**
 * The pricing surface's thin layer over the canonical engine (src/store/engine.ts, addendum C1). Pricing's own
 * engine.ts is gone: every price here comes from the canonical resolvePrice, computeCharge, and
 * generateRecurringCharges, called in their trailing-db form (addendum C2) so a preview can price a copy of the db
 * with drafts treated as published without touching the live store.
 *
 * What stays surface-side is only what the canonical signatures do not cover:
 * - resolveRate: the canonical resolvePrice requires a zoneId and an accountId. The ratebook asks "what does this
 *   line cost with no account", and a standard (no zone) line has no zone. Passing '' for either matches no zone
 *   row and no contract, which is exactly the canonical rule for "no zone" and "no account".
 * - pricingOf: Charge.pricing from a resolvePrice result without undefined keys.
 * - withPreviewChargeIds: the canonical charge id generator keeps a session counter, so a preview that builds
 *   charges would otherwise advance the ids the next billing run hands out.
 */
import type { Charge, Frequency } from '../../../types'
import type { Db } from '../../../store/db'
import { frequencyLabel, resolvePrice, setChargeIdGenerator, type ResolvedPrice } from '../../../store/engine'

export type { ResolvedPrice }

export const FREQUENCIES: Frequency[] = ['weekly', 'eow', '2x', '3x', '4x', '5x', '6x', 'onCall']

/** "weekly", "every other week", "2x weekly", "3x weekly", "on call": the canonical engine's labels. */
export const FREQUENCY_LABEL = Object.fromEntries(FREQUENCIES.map(f => [f, frequencyLabel(f)])) as Record<Frequency, string>

export interface RateQuery {
  catalogId: string
  frequency: Frequency
  /** Omit for a standard (no zone) price. */
  zoneId?: string
  /** Omit for the ratebook price: no contract can win. */
  accountId?: string
  onDate: string
  /** Dimension values for the line (customer tier, service speed, and so on), so a dimension rate can win. */
  context?: Record<string, string>
  /** The service line being priced, so a rate for new service only skips a line already in service. Omit for new service. */
  serviceItemId?: string
  siteId?: string
}

/** Canonical resolvePrice against db, with the zone and the account optional. Throws what the engine throws. */
export function resolveRate(q: RateQuery, db: Db): ResolvedPrice {
  return resolvePrice({
    catalogId: q.catalogId, frequency: q.frequency, zoneId: q.zoneId ?? '', accountId: q.accountId ?? '', onDate: q.onDate,
    ...(q.context ? { context: q.context } : {}),
    ...(q.serviceItemId ? { serviceItemId: q.serviceItemId } : {}),
    ...(q.siteId ? { siteId: q.siteId } : {}),
  }, db)
}

/** Charge.pricing built from a resolvePrice result without undefined keys, so deep-equal comparisons stay predictable. */
export function pricingOf(r: ResolvedPrice): Charge['pricing'] {
  return {
    ...(r.rateVersionId !== undefined ? { rateVersionId: r.rateVersionId } : {}),
    ...(r.contractId !== undefined ? { contractId: r.contractId } : {}),
    ruleWon: r.ruleWon,
  }
}

let previewDepth = 0

/**
 * Run fn with throwaway charge ids (chg_pr_preview_N), then restore the canonical generator. Nested calls share the
 * outer generator, so a blast radius that previews three invoices restores the default exactly once.
 */
export function withPreviewChargeIds<T>(fn: () => T): T {
  if (previewDepth > 0) return fn()
  let n = 0
  previewDepth += 1
  setChargeIdGenerator(() => `chg_pr_preview_${++n}`)
  try {
    return fn()
  } finally {
    previewDepth -= 1
    setChargeIdGenerator()
  }
}
