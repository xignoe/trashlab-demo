/** Display helpers for the billing screens. Dates are parsed from ISO strings without a Date object so nothing drifts by timezone. */
import type { Confidence } from '../../store/suggest'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return [y, m, d]
}

/** "Oct 1, 2026" */
export function longDate(iso: string): string {
  const [y, m, d] = parts(iso)
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

/** "Oct 1" */
export function dayLabel(iso: string): string {
  const [, m, d] = parts(iso)
  return `${MONTHS[m - 1]} ${d}`
}

/** "October 2026" */
export function monthYear(iso: string): string {
  const [y, m] = parts(iso)
  return `${MONTHS_LONG[m - 1]} ${y}`
}

/** "Sep 3, 10:15" from an ISO timestamp (local wall time as written). */
export function stampLabel(iso: string): string {
  const time = iso.length > 10 ? iso.slice(11, 16) : ''
  return time ? `${dayLabel(iso)}, ${time}` : dayLabel(iso)
}

/** "5 yr 5 mo", "8 mo", "Under 1 mo" */
export function tenureLabel(months: number): string {
  if (months < 1) return 'Under 1 mo'
  const years = Math.floor(months / 12)
  const rest = months % 12
  if (years === 0) return `${rest} mo`
  return rest === 0 ? `${years} yr` : `${years} yr ${rest} mo`
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function lbs(n: number): string {
  return `${n.toLocaleString('en-US')} lb`
}
