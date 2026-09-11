/**
 * Portal date helpers (moved from portal/src/store/clock.ts, box 2C.1).
 *
 * The prototype pinned "now" to a constant TODAY. The merged app has one engine clock (src/store/clock.ts, addendum
 * E1) that billing's Next cycle can move, so every default here reads today() from it and the portal always agrees
 * with the persona bar's date. Everything is UTC day math on ISO strings, so nothing drifts with the local time zone.
 */
import { today } from '../../../store/clock'

export { today }

export type RouteDay = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri'

const DAY_INDEX: Record<RouteDay, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5 }

/** Parse an ISO date (YYYY-MM-DD, or a full timestamp) as a UTC date. */
export function parseISO(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** Format a Date as YYYY-MM-DD using its UTC fields. */
export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Add whole days to an ISO date and return an ISO date. Negative values go backwards. */
export function addDays(iso: string, days: number): string {
  const d = parseISO(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return toISODate(d)
}

/** 0 = Sunday ... 6 = Saturday, for an ISO date. */
export function weekday(iso: string): number {
  return parseISO(iso).getUTCDay()
}

/** The next date strictly after fromDate on the route's weekday (a Monday asking for Mon gets the following Monday). */
export function nextRouteDay(routeDay: RouteDay, fromDate: string = today()): string {
  let delta = (DAY_INDEX[routeDay] - weekday(fromDate) + 7) % 7
  if (delta === 0) delta = 7
  return addDays(fromDate, delta)
}

/** The next business day (Mon to Fri) strictly after fromDate, at 10:00 office time, as an ISO timestamp. */
export function nextBusinessDay10am(fromDate: string = today()): string {
  let d = addDays(fromDate, 1)
  while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, 1)
  return `${d}T10:00:00`
}

/** The ISO date for the day after fromDate. */
export function tomorrow(fromDate: string = today()): string {
  return addDays(fromDate, 1)
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Monday, Sep 14" */
export function formatDayLong(iso: string): string {
  const d = parseISO(iso)
  return `${WEEKDAY_NAMES[d.getUTCDay()]}, ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/** "Sep 14, 2026" */
export function formatDate(iso: string): string {
  const d = parseISO(iso)
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

/** "Friday, Sep 11, 10:00 am" from an ISO timestamp. A bare date reads as 12:00 am, as in the prototype. */
export function formatDateTime(isoTs: string): string {
  const day = formatDayLong(isoTs)
  const time = isoTs.length > 10 ? isoTs.slice(11, 16) : '00:00'
  const [hh, mm] = time.split(':').map(Number)
  const suffix = hh >= 12 ? 'pm' : 'am'
  const h12 = hh % 12 === 0 ? 12 : hh % 12
  return `${day}, ${h12}:${String(mm).padStart(2, '0')} ${suffix}`
}

/** The latest date on or before onOrBefore on the route's weekday (onOrBefore itself when it matches). */
export function lastRouteDayOnOrBefore(routeDay: RouteDay, onOrBefore: string = today()): string {
  const back = (weekday(onOrBefore) - DAY_INDEX[routeDay] + 7) % 7
  return addDays(onOrBefore, -back)
}

/** The earliest date on or after onOrAfter on the route's weekday (onOrAfter itself when it matches). */
export function firstRouteDayOnOrAfter(routeDay: RouteDay, onOrAfter: string): string {
  const ahead = (DAY_INDEX[routeDay] - weekday(onOrAfter) + 7) % 7
  return addDays(onOrAfter, ahead)
}

/** True when the ISO date falls on the route's weekday. */
export function isRouteDay(routeDay: RouteDay, iso: string): boolean {
  return weekday(iso) === DAY_INDEX[routeDay]
}

/** "Monday" for "Mon". */
export function routeDayName(routeDay: RouteDay): string {
  return WEEKDAY_NAMES[DAY_INDEX[routeDay]]
}
