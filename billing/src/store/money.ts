/** Money helpers. All amounts are integer cents; formatting happens only at the edge. */

const dollars = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Render cents as `$1,234.56`. Negative amounts render in parentheses: `($5.00)`.
 * Non-integer input is rounded to the nearest cent first, so `fmt(99.6)` is `$1.00`.
 */
export function fmt(cents: number): string {
  if (!Number.isFinite(cents)) return '$0.00'
  const rounded = Math.round(cents)
  const body = `$${dollars.format(Math.abs(rounded) / 100)}`
  return rounded < 0 ? `(${body})` : body
}

/** Render cents as a signed figure for deltas: `+$1.00`, `-$1.00`, `$0.00`. */
export function fmtSigned(cents: number): string {
  const rounded = Math.round(cents)
  if (rounded === 0) return fmt(0)
  return rounded < 0 ? `-${fmt(-rounded)}` : `+${fmt(rounded)}`
}

/**
 * Parse a dollars string typed by a person (`"12.34"`, `"$1,234.5"`, `"(5)"`, `"-5"`) into integer cents.
 * Returns null when the text is not a number. Half cents round to the nearest cent.
 */
export function parseDollars(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const negative = /^\(.*\)$/.test(trimmed) || trimmed.startsWith('-')
  const cleaned = trimmed.replace(/[()$,\s-]/g, '')
  if (!/^\d*(\.\d*)?$/.test(cleaned) || cleaned === '' || cleaned === '.') return null
  // Exponent form keeps 1.005 exact (Number('1.005e2') is 100.5) where 1.005 * 100 would float to 100.49.
  const cents = Math.round(Number(`${cleaned}e2`))
  return negative ? -cents : cents
}
