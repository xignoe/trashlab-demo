/**
 * Calendar helpers for the account view, copied from account/src/store/clock.ts (box 2A.1).
 *
 * The prototype fixed TODAY in its own clock. The merged app has one engine clock (src/store/clock.ts, addendum E1),
 * and billing's Next cycle moves it forward a month, so every "today" here reads today() at call time instead of a
 * constant. The date math is pure string and UTC arithmetic, so no local time zone can shift a day.
 */
import { addDays } from '../../../store/cycles'

export { today, TODAY } from '../../../store/clock'
export { addDays }

const DAY_MS = 86_400_000
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
export type Weekday = (typeof WEEKDAYS)[number]

function parse(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function format(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function weekdayOf(iso: string): Weekday {
  return WEEKDAYS[parse(iso).getUTCDay()]
}

/** The next calendar date strictly after iso that falls on the given weekday. */
export function nextWeekday(iso: string, day: Weekday): string {
  const target = WEEKDAYS.indexOf(day)
  const current = parse(iso).getUTCDay()
  let delta = (target - current + 7) % 7
  if (delta === 0) delta = 7
  return addDays(iso.slice(0, 10), delta)
}

/** Whole days from a to b (positive when b is after a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / DAY_MS)
}

export function startOfNextMonth(iso: string): string {
  const d = parse(iso)
  return format(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)))
}

export function startOfNextQuarter(iso: string): string {
  const d = parse(iso)
  const quarterStartMonth = Math.floor(d.getUTCMonth() / 3) * 3
  return format(new Date(Date.UTC(d.getUTCFullYear(), quarterStartMonth + 3, 1)))
}

export function startOfMonth(iso: string): string {
  return iso.slice(0, 8) + '01'
}

export function endOfMonth(iso: string): string {
  return addDays(startOfNextMonth(iso), -1)
}
