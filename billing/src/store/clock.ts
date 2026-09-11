/**
 * The engine clock (addendum E1). The demo is set on 2026-09-10 in Eastern daylight time.
 *
 * Every date the billing store stamps comes from here: postInvoices' issuedAt and postedAt, WaivedCharge.at,
 * the edit sidecar's at, a run's ranAt, and the RateVersion stub's publishedAt. Nothing else in src/store
 * constructs a Date, so the demo is deterministic and a test can move the day with setToday().
 *
 * Next cycle moves this clock forward one month (DECISIONS.md entry 41), so the November run is worked on
 * 2026-10-10 the way the October run is worked on 2026-09-10.
 */

/** The demo day. The store starts here and reset() returns here. */
export const TODAY = '2026-09-10'

/** UTC offset of runtime timestamps: Eastern daylight time, matching the seed rows. */
export const TZ_OFFSET = '-04:00'

let current = TODAY

/** The engine's notion of today (YYYY-MM-DD). */
export function today(): string {
  return current
}

/** Move the clock (tests, and the store's Next cycle). Pass nothing to return to TODAY. Accepts a full timestamp. */
export function setToday(iso?: string): void {
  if (iso === undefined) {
    current = TODAY
    return
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) throw new Error(`setToday expects an ISO date, got ${iso}`)
  current = iso.slice(0, 10)
}

/** A runtime timestamp on the engine's day: noon Eastern daylight time, e.g. 2026-09-10T12:00:00-04:00. */
export function stamp(): string {
  return `${current}T12:00:00${TZ_OFFSET}`
}
