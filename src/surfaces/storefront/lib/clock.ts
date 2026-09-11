// Storefront calendar helpers. All date math is calendar arithmetic on ISO strings; nothing reads the wall clock.
//
// The day comes from the engine clock (src/store/clock.ts, addendum E1), the one the persona bar shows, so the
// storefront follows Next cycle and Reset seed like every other surface. The prototype fixed TODAY at 2026-09-10;
// today() returns that same day until the billing run moves the clock. "Now" for intake timestamps (receivedAt,
// holdDeadline, expiresAt) is 10:00 AM Eastern on that day, as in the prototype, so a 72 hour hold made on Sep 10
// still reads "Sun Sep 13 10:00 AM".
import { today as engineToday, TZ_OFFSET } from '../../../store/clock';

/** The engine's day (YYYY-MM-DD). 2026-09-10 (a Thursday) until the billing run moves the clock. */
export function today(): string {
  return engineToday();
}

/** The wall-clock time of every intake timestamp the storefront writes. */
export const INTAKE_TIME = '10:00:00';

/** UTC offset the hauler operates in. Timestamps we create keep this offset. */
export const LOCAL_OFFSET = TZ_OFFSET;

/** The instant stamped on intake records: 10:00 AM Eastern on today(), e.g. 2026-09-10T10:00:00-04:00. */
export function now(): string {
  return `${today()}T${INTAKE_TIME}${LOCAL_OFFSET}`;
}

export type RouteDay = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri';
export type Weekday = 'Sun' | RouteDay | 'Sat';

const WEEKDAYS: Weekday[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_LONG: Record<Weekday, string> = {
  Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad2 = (n: number) => String(n).padStart(2, '0');

/** The YYYY-MM-DD part of any ISO string. */
export function datePart(iso: string): string {
  return iso.slice(0, 10);
}

function parseYmd(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = datePart(iso).split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Not an ISO date: ${iso}`);
  return { y, m, d };
}

function ymdFromUtc(ms: number): string {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Calendar day arithmetic on a date-only ISO string. */
export function addDays(isoDate: string, days: number): string {
  const { y, m, d } = parseYmd(isoDate);
  return ymdFromUtc(Date.UTC(y, m - 1, d + days));
}

/** Add whole months, clamping the day to the target month's length (Jan 31 plus 1 month is Feb 28). */
export function addMonths(isoDate: string, months: number): string {
  const { y, m, d } = parseYmd(isoDate);
  const total = y * 12 + (m - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = total - ty * 12; // 0 based
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${pad2(tm + 1)}-${pad2(Math.min(d, lastDay))}`;
}

/** Whole calendar months from start to end (2026-09-15 to 2026-12-15 is 3). Never below 0. */
export function wholeMonthsBetween(start: string, end: string): number {
  const a = parseYmd(start);
  const b = parseYmd(end);
  let months = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d < a.d) months -= 1;
  return Math.max(0, months);
}

export function dayBefore(isoDate: string): string {
  return addDays(isoDate, -1);
}

export function weekdayOf(isoDate: string): Weekday {
  const { y, m, d } = parseYmd(isoDate);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** "Tue" to "Tuesday", for copy. */
export function dayName(day: Weekday): string {
  return WEEKDAY_LONG[day];
}

/** ISO dates of the next `count` occurrences of `routeDay` strictly after `from` (default today()). */
export function nextServiceDays(routeDay: RouteDay, count: number, from: string = today()): string[] {
  const out: string[] = [];
  let cursor = datePart(from);
  while (out.length < count) {
    cursor = addDays(cursor, 1);
    if (weekdayOf(cursor) === routeDay) out.push(cursor);
  }
  return out;
}

/** The next Monday to Friday strictly after `from` (default today()). Holidays are not modelled. */
export function nextBusinessDay(from: string = today()): string {
  let cursor = datePart(from);
  for (;;) {
    cursor = addDays(cursor, 1);
    const wd = weekdayOf(cursor);
    if (wd !== 'Sat' && wd !== 'Sun') return cursor;
  }
}

/** Date-only comparison: true when a is strictly before b. */
export function isBefore(a: string, b: string): boolean {
  return datePart(a) < datePart(b);
}

function offsetMinutes(offset: string): number {
  if (offset === 'Z') return 0;
  const sign = offset.startsWith('-') ? -1 : 1;
  const [h, m] = offset.slice(1).split(':').map(Number);
  return sign * (h * 60 + m);
}

/** Normalise a date-only string to local midnight; timestamps pass through. */
function withTime(iso: string): string {
  return iso.length === 10 ? `${iso}T00:00:00${LOCAL_OFFSET}` : iso;
}

/** Add hours (fractions allowed) to an ISO timestamp, keeping the timestamp's own UTC offset. */
export function addHours(iso: string, hours: number): string {
  const full = withTime(iso);
  const match = full.match(/(Z|[+-]\d\d:\d\d)$/);
  const offset = match ? match[1] : LOCAL_OFFSET;
  const ms = Date.parse(match ? full : `${full}${LOCAL_OFFSET}`);
  if (Number.isNaN(ms)) throw new Error(`Not an ISO timestamp: ${iso}`);
  const shifted = new Date(ms + hours * 3_600_000 + offsetMinutes(offset) * 60_000);
  const y = shifted.getUTCFullYear();
  const mo = pad2(shifted.getUTCMonth() + 1);
  const d = pad2(shifted.getUTCDate());
  const h = pad2(shifted.getUTCHours());
  const mi = pad2(shifted.getUTCMinutes());
  const s = pad2(shifted.getUTCSeconds());
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${offset === 'Z' ? 'Z' : offset}`;
}

export function addMinutes(iso: string, minutes: number): string {
  return addHours(iso, minutes / 60);
}

/** "Tue Sep 15" from any ISO string. */
export function formatDay(iso: string): string {
  const { m, d } = parseYmd(iso);
  return `${weekdayOf(iso)} ${MONTHS[m - 1]} ${d}`;
}

/** "10:02 AM" from an ISO timestamp, reading the wall clock as written (no zone conversion). */
export function formatTime(iso: string): string {
  const full = withTime(iso);
  const hh = Number(full.slice(11, 13));
  const mm = full.slice(14, 16);
  const suffix = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${mm} ${suffix}`;
}

/** "Sun Sep 13 at 10:00 AM" from an ISO timestamp, reading the wall clock as written (no zone conversion). */
export function formatDateTime(iso: string): string {
  const full = withTime(iso);
  return `${formatDay(full)} at ${formatTime(full)}`;
}

/** "Sun Sep 13 10:00 AM" (Day Mon D h:mm a), the held status deadline format. Wall clock as written. */
export function formatDayTime(iso: string): string {
  return formatDateTime(iso).replace(' at ', ' ');
}
