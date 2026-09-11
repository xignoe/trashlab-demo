// Buyer-facing wording for an error a transaction throws. Validation the buyer can fix gets plain words;
// anything else gets the caller's generic line, so an engine id or field name never reaches the buyer.
// The raw error still goes to the console for whoever is debugging.

export function buyerError(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/expired/i.test(message)) return 'That card has expired. Check the expiry date, or use a different card.';
  if (/last4/i.test(message)) return 'Enter the last 4 digits of your card.';
  console.error(err);
  return fallback;
}
