// Money helpers. Every amount in the app is integer cents.
// Rounding is half up at each fee and tax step, applied to the step's own result.

/** Round half up to the nearest integer. The epsilon absorbs float noise such as 651.6299999. */
export function roundHalfUp(n: number): number {
  return Math.floor(n + 0.5 + 1e-9);
}

/** pct percent of cents, rounded half up. 7% of 9309 is 651.63, so 652. */
export function pctOf(cents: number, pct: number): number {
  return roundHalfUp((cents * pct) / 100);
}

/** "$1,234.56" style formatting for copy and transcripts. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}$${dollars.toLocaleString('en-US')}.${String(rem).padStart(2, '0')}`;
}
