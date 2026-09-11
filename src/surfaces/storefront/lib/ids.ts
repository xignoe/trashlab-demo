// Runtime ids for everything the storefront creates carry the `_sf_` infix (addendum C12): party_sf_0004,
// acct_sf_0002, chg_sf_0008. One counter serves every prefix, as in the prototype, so the ids of one signup read in
// the order they were minted. The counter starts above the highest `_sf_` suffix already in the Db and the slice's
// sidecars, and keeps counting across Reset seed, so an id never repeats in a session and never collides with a
// row another surface or an earlier signup wrote.
import type { SfView } from './view';

const SF_SUFFIX = /_sf_(\d+)$/;

let counter = 0;

const floors = new WeakMap<SfView, number>();

/** Highest numeric `_sf_` suffix among every id in the view (Db tables, quote intake, payment tokens). */
export function highestSfSuffix(view: SfView): number {
  const known = floors.get(view);
  if (known !== undefined) return known;
  let max = 0;
  const scan = (id: string) => {
    const m = SF_SUFFIX.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  };
  for (const rows of Object.values(view.db)) {
    for (const row of rows as { id?: string }[]) if (typeof row.id === 'string') scan(row.id);
  }
  Object.keys(view.quoteIntake).forEach(scan);
  Object.keys(view.paymentTokens).forEach(scan);
  floors.set(view, max);
  return max;
}

/** A minting function for one transaction: each call returns the next `${prefix}_sf_####`. */
export type MintId = (prefix: string) => string;

export function idMint(view: SfView): MintId {
  return (prefix: string) => {
    counter = Math.max(counter, highestSfSuffix(view)) + 1;
    return `${prefix}_sf_${String(counter).padStart(4, '0')}`;
  };
}

/** True for a record the storefront created at runtime. The store inspector lists exactly these. */
export function isStorefrontId(id: string): boolean {
  return id.includes('_sf_');
}
