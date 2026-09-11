/**
 * Billing cycle calendar (DECISIONS.md entry 3).
 *   monthly and net30: due on day 1 of every month, period is that month.
 *   quarterly:         due on Jan 1, Apr 1, Jul 1, Oct 1, period is three months.
 *   perJob:            never due for recurring charges.
 *
 * All date math is on YYYY-MM-DD strings so there is no timezone drift.
 */
import type { BillingAccount } from '../types'

export type Cadence = BillingAccount['cycle']

export interface Period {
  start: string
  end: string
}

interface Ymd {
  y: number
  m: number
  d: number
}

function parse(iso: string): Ymd {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) throw new Error(`Expected an ISO date, got ${iso}`)
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function format({ y, m, d }: Ymd): string {
  return `${y}-${pad(m)}-${pad(d)}`
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

/** Number of days in a month (m is 1 based). */
export function daysInMonth(y: number, m: number): number {
  return m === 2 && isLeapYear(y) ? 29 : MONTH_DAYS[m - 1]
}

/** Days since 1970-01-01 for a civil date (proleptic Gregorian, H. Hinnant's days_from_civil). */
function toDayNumber({ y, m, d }: Ymd): number {
  const yy = m <= 2 ? y - 1 : y
  const era = Math.floor(yy / 400)
  const yoe = yy - era * 400
  const doy = Math.floor((153 * ((m + 9) % 12) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

/** The civil date for a day number from toDayNumber. */
function fromDayNumber(n: number): Ymd {
  const z = n + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp < 10 ? mp + 3 : mp - 9
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d }
}

/** First day of the month `months` after the month containing `iso` (negative moves back). */
function shiftMonthStart(iso: string, months: number): string {
  const { y, m } = parse(iso)
  const index = y * 12 + (m - 1) + months
  return format({ y: Math.floor(index / 12), m: (index % 12) + 1, d: 1 })
}

/** Months in one billing period for a cadence. perJob has no recurring period; it is treated as one month for reporting. */
export function periodMonths(cadence: Cadence): number {
  return cadence === 'quarterly' ? 3 : 1
}

/**
 * Whole calendar months a period covers (addendum C5). A month counts when the period includes its first
 * and last day. Oct 1 to Dec 31 is 3; Oct 1 to Oct 31 is 1; a partial period floors at 1 so a charge with a
 * period always takes a flat fee at least once.
 */
export function wholeMonths(period: Period): number {
  const s = parse(period.start)
  const e = parse(period.end)
  let firstFull = s.y * 12 + (s.m - 1)
  if (s.d !== 1) firstFull += 1
  let lastFull = e.y * 12 + (e.m - 1)
  if (e.d !== daysInMonth(e.y, e.m)) lastFull -= 1
  return Math.max(1, lastFull - firstFull + 1)
}

/** ISO date `days` after `iso` (YYYY-MM-DD in, YYYY-MM-DD out). */
export function addDays(iso: string, days: number): string {
  return format(fromDayNumber(toDayNumber(parse(iso)) + days))
}

/** The same day of the month `months` later (negative moves back), clamped to the month's last day: Jan 31 + 1 is Feb 28. */
export function addMonths(iso: string, months: number): string {
  const { y, m, d } = parse(iso)
  const index = y * 12 + (m - 1) + months
  const ny = Math.floor(index / 12)
  const nm = (index % 12 + 12) % 12 + 1
  return format({ y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) })
}

/** True when this account's cadence bills on cycleDate. */
export function isDue(account: Pick<BillingAccount, 'cycle'>, cycleDate: string): boolean {
  const { m, d } = parse(cycleDate)
  if (d !== 1) return false
  switch (account.cycle) {
    case 'monthly':
    case 'net30':
      return true
    case 'quarterly':
      return m === 1 || m === 4 || m === 7 || m === 10
    case 'perJob':
      return false
  }
}

/**
 * The advance billing period that starts on cycleDate for this cadence.
 * The period always starts on cycleDate as given (callers pass a due date); quarterly runs three months.
 */
export function periodFor(account: Pick<BillingAccount, 'cycle'>, cycleDate: string): Period {
  const start = format(parse(cycleDate))
  const months = periodMonths(account.cycle)
  const lastMonthStart = shiftMonthStart(start, months - 1)
  const { y, m } = parse(lastMonthStart)
  return { start, end: format({ y, m, d: daysInMonth(y, m) }) }
}

/**
 * The latest due date for this cadence strictly before cycleDate.
 *   monthly 2026-10-01 -> 2026-09-01; quarterly 2026-10-01 -> 2026-07-01; quarterly 2026-11-01 -> 2026-10-01.
 * perJob has no cycles; the prior month start is returned so reporting code has something sensible.
 */
export function priorCycleDate(account: Pick<BillingAccount, 'cycle'>, cycleDate: string): string {
  const { y, m, d } = parse(cycleDate)
  const thisMonthStart = format({ y, m, d: 1 })
  // Walk back one month at a time until a due date strictly before cycleDate is found.
  let candidate = d > 1 ? thisMonthStart : shiftMonthStart(thisMonthStart, -1)
  if (account.cycle === 'perJob') return candidate
  let guard = 0
  while (!isDue(account, candidate) && guard++ < 12) candidate = shiftMonthStart(candidate, -1)
  return candidate
}

/** The next due date for this cadence strictly after cycleDate. Phase 5 uses this for the "Next cycle" control. */
export function nextCycleDate(account: Pick<BillingAccount, 'cycle'>, cycleDate: string): string {
  const { y, m } = parse(cycleDate)
  let candidate = shiftMonthStart(format({ y, m, d: 1 }), 1)
  if (account.cycle === 'perJob') return candidate
  let guard = 0
  while (!isDue(account, candidate) && guard++ < 12) candidate = shiftMonthStart(candidate, 1)
  return candidate
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Oct 1" style label for a date. */
export function shortDate(iso: string): string {
  const { m, d } = parse(iso)
  return `${MONTHS[m - 1]} ${d}`
}

/** "Oct 1 to Dec 31" style label for a period, matching the seed charge descriptions. */
export function periodLabel(period: Period): string {
  return `${shortDate(period.start)} to ${shortDate(period.end)}`
}
