/**
 * Billing cycle calendar (DECISIONS.md entry 3).
 *   monthly and net30: due on day 1 of every month, period is that month.
 *   quarterly:         due on Jan 1, Apr 1, Jul 1, Oct 1, period is three months.
 *   perJob:            never due for recurring charges.
 *   daily, weekly:     every day; every Monday (only an account that left a group keeps one of these).
 * An account in a billing group follows the group's schedule instead (BillingSchedule, addendum Q): every N days, weeks,
 * months, or quarters from its start date, and each bill covers the day it bills through the day before the next one.
 *
 * All date math is on YYYY-MM-DD strings so there is no timezone drift.
 */
import type { BillingAccount, BillingGroup, BillingSchedule } from '../types'

export type Cadence = BillingAccount['cycle']

/** What decides an account's bill dates: its cycle, and its billing group's schedule when it has one. */
export type CadenceOf = Pick<BillingAccount, 'cycle'> & { schedule?: BillingSchedule }

/** The account's cadence with its billing group's schedule (none when the account has no group). */
export function cadenceOf(account: Pick<BillingAccount, 'cycle' | 'billingGroupId'>, groups: readonly BillingGroup[] = []): CadenceOf {
  const group = account.billingGroupId ? groups.find(g => g.id === account.billingGroupId) : undefined
  return group?.schedule ? { cycle: account.cycle, schedule: group.schedule } : { cycle: account.cycle }
}

/** A group's schedule as a cadence, for callers that start from the group rather than an account. */
export function groupCadence(group: Pick<BillingGroup, 'schedule'>): CadenceOf {
  return { cycle: group.schedule.frequency, schedule: group.schedule }
}

/** The months (1 to 12) a monthly-or-slower cadence bills in, or every month for faster ones. */
export function billingMonths(cadence: CadenceOf): number[] {
  if (cadence.cycle === 'perJob') return []
  const s = cadence.schedule
  if (s && s.frequency === 'quarterly') {
    const start = Number(s.startDate.slice(5, 7))
    const step = 3 * Math.max(1, s.every)
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter(m => ((m - start) % step + step) % step === 0)
  }
  if (!s && cadence.cycle === 'quarterly') return [1, 4, 7, 10]
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function ordinal(n: number): string {
  const t = n % 100
  if (t >= 11 && t <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/**
 * A schedule in words: "Every day", "Every Monday", "Every 2 weeks on Friday", "Monthly on the 15th",
 * "Every 2 months on the 1st", "Quarterly on the 1st: Jan, Apr, Jul, Oct".
 */
export function scheduleText(s: BillingSchedule): string {
  const every = Math.max(1, s.every)
  const { y, m, d } = parse(s.startDate)
  switch (s.frequency) {
    case 'daily':
      return every === 1 ? 'Every day' : `Every ${every} days`
    case 'weekly': {
      const day = WEEKDAY[(toDayNumber({ y, m, d }) % 7 + 11) % 7]
      return every === 1 ? `Every ${day}` : `Every ${every} weeks on ${day}`
    }
    case 'monthly':
      return every === 1 ? `Monthly on the ${ordinal(d)}` : `Every ${every} months on the ${ordinal(d)}`
    case 'quarterly': {
      const months = billingMonths({ cycle: 'quarterly', schedule: s }).map(x => MONTH_LONG[x - 1].slice(0, 3)).join(', ')
      return `${every === 1 ? 'Quarterly' : `Every ${every} quarters`} on the ${ordinal(d)}: ${months}`
    }
  }
}

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
  switch (cadence) {
    case 'quarterly': return 3
    case 'weekly': return 12 / 52
    case 'daily': return 12 / 365
    default: return 1
  }
}

/**
 * How many months of the monthly rate one bill charges (addendum Q): a quarter is 3, a month 1, a week 12/52 of a
 * month, a day 12/365, times the schedule's "every". Rates are monthly, so a weekly bill is 12/52 of the month's price.
 */
export function billingFactor(cadence: CadenceOf): number {
  const s = cadence.schedule
  if (!s) return periodMonths(cadence.cycle)
  const every = Math.max(1, s.every)
  switch (s.frequency) {
    case 'daily': return every * 12 / 365
    case 'weekly': return every * 12 / 52
    case 'monthly': return every
    case 'quarterly': return every * 3
  }
}

/**
 * Months a flat fee counts for a period (addendum C5 extended by Q): whole months for a period of a month or more,
 * as wholeMonths; the fraction of a month (days x 12 / 365) for a shorter one, so a weekly bill takes a quarter of a
 * monthly flat fee instead of all of it.
 */
export function flatFeeMonths(period: Period): number {
  const next = addDays(period.end, 1)
  const start = format(parse(period.start))
  if (next > start && addMonths(start, 1) > next) return daysBetween(start, next) * 12 / 365
  return wholeMonths(period)
}

/**
 * Whole months a period covers (addendum C5), counted by month arithmetic from the period start (Phase 3.2a,
 * storefront request R2): the largest m for which addMonths(start, m) is on or before the day after the end.
 * Periods end on their last day inclusive (Phase 3.2b), so the day after the end is where the next period starts.
 *   Oct 1 to Dec 31 is 3 and Oct 1 to Oct 31 is 1 (every calendar-aligned period counts as before).
 *   Sep 15 to Dec 14 is 3 (a mid-month quarter, which the old calendar-month count made 2).
 *   Sep 15 to Dec 15 is still 3 (a tolerant reading of an exclusive end).
 * A partial period floors at 1, so a charge with a period always takes a flat fee at least once.
 */
export function wholeMonths(period: Period): number {
  const start = format(parse(period.start))
  const next = addDays(period.end, 1)
  if (next <= start) return 1
  const s = parse(start)
  const n = parse(next)
  let m = (n.y - s.y) * 12 + (n.m - s.m)
  while (m > 0 && addMonths(start, m) > next) m -= 1
  return Math.max(1, m)
}

/** Calendar days from `from` to `to` (Aug 7 to Sep 10 is 34; the same day is 0; negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return toDayNumber(parse(to)) - toDayNumber(parse(from))
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

/** Days between schedule bill dates, for daily and weekly; months between them, for monthly and quarterly. */
function scheduleStep(s: BillingSchedule): { days?: number; months?: number } {
  const every = Math.max(1, Math.floor(s.every) || 1)
  switch (s.frequency) {
    case 'daily': return { days: every }
    case 'weekly': return { days: 7 * every }
    case 'monthly': return { months: every }
    case 'quarterly': return { months: 3 * every }
  }
}

function monthIndex(iso: string): number {
  const { y, m } = parse(iso)
  return y * 12 + (m - 1)
}

/** The schedule's k-th bill date from its start (k may be negative). */
function scheduleDate(s: BillingSchedule, k: number): string {
  const step = scheduleStep(s)
  return step.days ? addDays(s.startDate, k * step.days) : addMonths(s.startDate, k * step.months!)
}

/** The index k of the latest bill date on or before `iso`. */
function scheduleIndexAtOrBefore(s: BillingSchedule, iso: string): number {
  const step = scheduleStep(s)
  let k = step.days
    ? Math.floor(daysBetween(s.startDate, iso) / step.days)
    : Math.floor((monthIndex(iso) - monthIndex(s.startDate)) / step.months!)
  while (scheduleDate(s, k) > format(parse(iso))) k -= 1
  while (scheduleDate(s, k + 1) <= format(parse(iso))) k += 1
  return k
}

/** True when this cadence bills on cycleDate. */
export function isDue(account: CadenceOf, cycleDate: string): boolean {
  if (account.cycle === 'perJob') return false
  const day = format(parse(cycleDate))
  const s = account.schedule
  if (s) return scheduleDate(s, scheduleIndexAtOrBefore(s, day)) === day
  const { m, d } = parse(day)
  switch (account.cycle) {
    case 'daily':
      return true
    case 'weekly':
      return ((daysBetween('2026-01-05', day) % 7) + 7) % 7 === 0
    case 'monthly':
    case 'net30':
      return d === 1
    case 'quarterly':
      return d === 1 && (m === 1 || m === 4 || m === 7 || m === 10)
  }
}

/**
 * The advance billing period that starts on cycleDate for this cadence: through the day before the next bill date
 * on a schedule; otherwise the calendar months of the cycle (quarterly runs three months), a day, or a week.
 */
export function periodFor(account: CadenceOf, cycleDate: string): Period {
  const start = format(parse(cycleDate))
  if (account.schedule) return { start, end: addDays(nextCycleDate(account, start), -1) }
  if (account.cycle === 'daily') return { start, end: start }
  if (account.cycle === 'weekly') return { start, end: addDays(start, 6) }
  const months = account.cycle === 'quarterly' ? 3 : 1
  const lastMonthStart = shiftMonthStart(start, months - 1)
  const { y, m } = parse(lastMonthStart)
  return { start, end: format({ y, m, d: daysInMonth(y, m) }) }
}

/**
 * The latest due date for this cadence strictly before cycleDate.
 *   monthly 2026-10-01 -> 2026-09-01; quarterly 2026-10-01 -> 2026-07-01; quarterly 2026-11-01 -> 2026-10-01.
 * perJob has no cycles; the prior month start is returned so reporting code has something sensible.
 */
export function priorCycleDate(account: CadenceOf, cycleDate: string): string {
  const day = format(parse(cycleDate))
  const s = account.schedule
  if (s && account.cycle !== 'perJob') return scheduleDate(s, scheduleIndexAtOrBefore(s, addDays(day, -1)))
  if (account.cycle === 'daily') return addDays(day, -1)
  if (account.cycle === 'weekly') {
    let c = addDays(day, -1)
    while (!isDue(account, c)) c = addDays(c, -1)
    return c
  }
  const { y, m, d } = parse(day)
  const thisMonthStart = format({ y, m, d: 1 })
  // Walk back one month at a time until a due date strictly before cycleDate is found.
  let candidate = d > 1 ? thisMonthStart : shiftMonthStart(thisMonthStart, -1)
  if (account.cycle === 'perJob') return candidate
  let guard = 0
  while (!isDue(account, candidate) && guard++ < 12) candidate = shiftMonthStart(candidate, -1)
  return candidate
}

/** The next due date for this cadence strictly after cycleDate. Phase 5 uses this for the "Next cycle" control. */
export function nextCycleDate(account: CadenceOf, cycleDate: string): string {
  const day = format(parse(cycleDate))
  const s = account.schedule
  if (s && account.cycle !== 'perJob') return scheduleDate(s, scheduleIndexAtOrBefore(s, day) + 1)
  if (account.cycle === 'daily') return addDays(day, 1)
  if (account.cycle === 'weekly') {
    let c = addDays(day, 1)
    while (!isDue(account, c)) c = addDays(c, 1)
    return c
  }
  const { y, m } = parse(day)
  let candidate = shiftMonthStart(format({ y, m, d: 1 }), 1)
  if (account.cycle === 'perJob') return candidate
  let guard = 0
  while (!isDue(account, candidate) && guard++ < 12) candidate = shiftMonthStart(candidate, 1)
  return candidate
}

/** The first bill date on or after `from`. */
export function billDateOnOrAfter(account: CadenceOf, from: string): string {
  const day = format(parse(from))
  return isDue(account, day) ? day : nextCycleDate(account, day)
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
