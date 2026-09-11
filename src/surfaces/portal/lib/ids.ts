/**
 * Portal-minted ids (moved from portal/src/store/ids.ts, box 2C.1; addendum C12).
 *
 * Every row the portal creates carries the `_p` infix (`req_p0001`, `wo_p0001`, `pay_p0001`, `chg_p0001`,
 * `hold_p0001`, `chgreq_p0001`, `quote_p0001`), which no seed row uses. The prototype kept a module counter per prefix;
 * here the next id is one above the highest `<prefix>_p####` already in the table, so ids are deterministic, survive
 * Reset seed without a counter to rewind, and never collide with billing's `_bl_` or storefront's `_sf` rows.
 */

/** Highest numeric suffix among ids shaped `${prefix}_p####`, or 0 when there are none. */
function maxPortalSuffix(ids: Iterable<string>, prefix: string): number {
  const head = `${prefix}_p`
  let max = 0
  for (const id of ids) {
    if (!id.startsWith(head)) continue
    const rest = id.slice(head.length)
    if (/^\d+$/.test(rest)) max = Math.max(max, Number(rest))
  }
  return max
}

/** The next unused `${prefix}_p####` id given the ids already taken. */
export function nextPortalId(prefix: string, taken: Iterable<string>): string {
  return `${prefix}_p${String(maxPortalSuffix(taken, prefix) + 1).padStart(4, '0')}`
}

/** `n` consecutive unused ids for one prefix, for an action that mints several rows at once (one hold per item). */
export function nextPortalIds(prefix: string, taken: Iterable<string>, n: number): string[] {
  const start = maxPortalSuffix(taken, prefix)
  return Array.from({ length: n }, (_, i) => `${prefix}_p${String(start + 1 + i).padStart(4, '0')}`)
}
