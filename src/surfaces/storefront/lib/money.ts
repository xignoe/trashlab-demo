// Money on the storefront is integer cents, formatted only at the edge. Fee and tax rounding is the canonical
// engine's (src/store/engine.ts computeCharge, addendum C6); the prototype's roundHalfUp and pctOf are gone with its
// engine. formatCents is the merged app's fmt ("$1,234.56"); the storefront never shows a negative amount.
import { fmt } from '../../../store/money';

export function formatCents(cents: number): string {
  return fmt(cents);
}
