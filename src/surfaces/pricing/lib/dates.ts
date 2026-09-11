/**
 * Pure date helpers for the pricing surface (moved from pricing/src/store/dates.ts). Dates are ISO 8601 strings and
 * every comparison is on the yyyy-mm-dd prefix, so a timestamp and a plain date compare the way a person expects.
 *
 * The demo day is deliberately not defined here. Read it from the engine clock, today() in src/store/clock.ts
 * (addendum K2 and E1), so Next cycle and Reset seed move pricing's "today" along with billing's.
 */

export function dateOnly(iso: string): string {
  return iso.slice(0, 10)
}

export function yyyymmdd(iso: string): string {
  return dateOnly(iso).replace(/-/g, '')
}

function parts(iso: string): [number, number, number] {
  const [y, m, d] = dateOnly(iso).split('-').map(Number)
  return [y, m, d]
}

function fmt(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Adds calendar months, clamping the day to the target month's length (Jan 31 + 1 month = Feb 28 or 29). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = parts(iso)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  return fmt(ny, nm, Math.min(d, last))
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = parts(iso)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

export function addYears(iso: string, n: number): string {
  return addMonths(iso, n * 12)
}

/** Inclusive range check on the date part. */
export function within(iso: string, start: string, end: string): boolean {
  const d = dateOnly(iso)
  return d >= dateOnly(start) && d <= dateOnly(end)
}

/** First day of the month after iso's month: 2026-09-10 -> 2026-10-01. The default effectiveFrom for a draft. */
export function firstOfNextMonth(iso: string): string {
  const [y, m] = parts(iso)
  return addMonths(fmt(y, m, 1), 1)
}
