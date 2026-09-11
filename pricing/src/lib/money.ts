// Shared money formatting. Money is integer cents everywhere; this is the only place cents become text.

/** 2900 -> "$29.00", 123456 -> "$1,234.56", -150 -> "-$1.50". Fractional input is rounded to a cent. */
export function formatCents(cents: number): string {
  const rounded = Math.round(cents);
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  const rest = String(abs % 100).padStart(2, '0');
  return `${sign}$${dollars}.${rest}`;
}

/** 7 -> "7%", 2.5 -> "2.5%". */
export function formatPct(pct: number): string {
  return `${Number.isInteger(pct) ? pct : Number(pct.toFixed(2))}%`;
}

/** Whole dollar amounts drop the cents: 26400 -> "$264", 123450 -> "$1,234.50". Used for annual estimates. */
export function formatCentsCompact(cents: number): string {
  const rounded = Math.round(cents);
  const text = formatCents(rounded);
  return rounded % 100 === 0 ? text.slice(0, -3) : text;
}
