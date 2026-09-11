/**
 * Live "open items" counts for the persona bar (box 3.7): the hand-offs waiting on each persona.
 *
 * Office: proposed charges awaiting a billing decision (every Charge in db with status proposed: the run's queue, an
 * office-proposed reinstatement fee, anything a producer left proposed), open customer requests (status open or
 * scheduled, the same rule as the account view's Open items card), and held signups waiting for approval.
 * Owner: pricing's pending draft RateVersions.
 *
 * Each selector returns a number, so a zustand subscriber re-renders only when the count moves. The db counts are
 * memoized on the table array: mutateDb always builds a new array for a table it changes and keeps the others, so a
 * store update that does not touch charges, requests, or quotes costs one WeakMap lookup.
 */
import type { RootState } from '../store/slices/types'

export type OpenItemKey = 'proposedCharges' | 'openRequests' | 'heldSignups' | 'pricingDrafts'

function countBy<T>(predicate: (row: T) => boolean) {
  const cache = new WeakMap<readonly T[], number>()
  return (rows: readonly T[]): number => {
    const hit = cache.get(rows)
    if (hit !== undefined) return hit
    let n = 0
    for (const row of rows) if (predicate(row)) n += 1
    cache.set(rows, n)
    return n
  }
}

const proposed = countBy<RootState['db']['charges'][number]>(c => c.status === 'proposed')
const openRequests = countBy<RootState['db']['requests'][number]>(r => r.status === 'open' || r.status === 'scheduled')
const held = countBy<RootState['db']['quotes'][number]>(q => q.status === 'held')

export const OPEN_ITEM_SELECTORS: Record<OpenItemKey, (s: RootState) => number> = {
  proposedCharges: s => proposed(s.db.charges),
  openRequests: s => openRequests(s.db.requests),
  heldSignups: s => held(s.db.quotes),
  pricingDrafts: s => s.pricingDrafts.length,
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** How each count reads in the persona bar's tooltip. */
export const OPEN_ITEM_LABEL: Record<OpenItemKey, (n: number) => string> = {
  proposedCharges: n => `${plural(n, 'proposed charge', 'proposed charges')} awaiting a decision`,
  openRequests: n => `${plural(n, 'open customer request', 'open customer requests')}`,
  heldSignups: n => `${plural(n, 'held signup', 'held signups')} awaiting approval`,
  pricingDrafts: n => `${plural(n, 'draft rate version', 'draft rate versions')} not published`,
}

/** One line per non-zero count, for a title attribute. Empty when nothing is open. */
export function describeOpenItems(keys: readonly OpenItemKey[], counts: Record<OpenItemKey, number>): string {
  return keys.filter(k => counts[k] > 0).map(k => OPEN_ITEM_LABEL[k](counts[k])).join('\n')
}
