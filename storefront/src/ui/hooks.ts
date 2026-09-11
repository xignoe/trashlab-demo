// React-side reads of the store: the current offer for the picked address and selections, and the
// menu prices the configurator shows beside every option. Nothing here writes to either store.
import { useMemo } from 'react';
import type { FeeRule } from '../types';
import { resolvePrice } from '../store/engine';
import { formatCents } from '../store/money';
import {
  buildOffer,
  CART_CATALOG_IDS,
  EXTRA_CART_CATALOG_ID,
  OFFER_ACCOUNT_ID,
  RECYCLING_CATALOG_ID,
  withProvisionalSite,
  type Offer,
} from '../store/offer';
import { matchAddress, type AddressMatch } from '../store/serviceability';
import { useStore, type StoreTables } from '../store/store';
import { useUi } from '../store/ui';

export interface OfferView {
  match?: AddressMatch;
  offer?: Offer;
  /** What the buyer reads when there is no offer. */
  error?: string;
  /** The engine's reason, never shown to the buyer. */
  detail?: string;
}

export const OFFER_UNAVAILABLE = 'We could not price this address online. Check a different address, or try again later.';

/** The priced offer for the picked address and current selections. Recomputes on any store or selection change. */
export function useOfferView(): OfferView {
  const tables = useStore();
  const addressId = useUi((s) => s.addressId);
  const selections = useUi((s) => s.selections);
  return useMemo(() => {
    if (!addressId) return {};
    const match = matchAddress(addressId, tables);
    if (!match.address || !match.route) return { match, error: 'We could not find a pickup route for this address. Check a different address.' };
    try {
      const offer = buildOffer({ zoneId: match.zone.id, routeId: match.route.id, ...selections }, tables);
      return { match, offer };
    } catch (e) {
      // Buyer copy on screen; the engine's reason stays on `detail` for debugging.
      return { match, error: OFFER_UNAVAILABLE, detail: e instanceof Error ? e.message : String(e) };
    }
  }, [tables, addressId, selections]);
}

/** Monthly prices for every configurator option, resolved the same way the offer resolves them. */
export type MenuPrices = Record<string, number | undefined>;

export function menuPrices(offer: Offer, tables: StoreTables): MenuPrices {
  const state = withProvisionalSite(tables, offer.zoneId, offer.routeId);
  const out: MenuPrices = {};
  const wanted: { catalogId: string; frequency: 'weekly' | 'eow' }[] = [
    ...CART_CATALOG_IDS.map((catalogId) => ({ catalogId, frequency: 'weekly' as const })),
    { catalogId: EXTRA_CART_CATALOG_ID, frequency: 'weekly' },
    { catalogId: RECYCLING_CATALOG_ID, frequency: 'eow' },
  ];
  for (const { catalogId, frequency } of wanted) {
    try {
      out[catalogId] = resolvePrice(
        { catalogId, frequency, zoneId: offer.zoneId, accountId: OFFER_ACCOUNT_ID, onDate: offer.startDate },
        state,
      ).priceCents;
    } catch {
      out[catalogId] = undefined;
    }
  }
  return out;
}

export function useMenuPrices(offer: Offer | undefined): MenuPrices {
  const tables = useStore();
  return useMemo(() => (offer ? menuPrices(offer, tables) : {}), [offer, tables]);
}

/** "$29.00/mo" or "Price unavailable". */
export function perMonth(cents: number | undefined): string {
  return cents === undefined ? 'Price unavailable' : `${formatCents(cents)}/mo`;
}

/** "Fuel surcharge, 7%" or "Environmental fee, $1.00/mo", from the FeeRule itself. */
export function feeLabel(rule: FeeRule): string {
  return rule.kind === 'percent' ? `${rule.name}, ${rule.value}%` : `${rule.name}, ${formatCents(rule.value)}/mo`;
}

/** Fee cents per FeeRule id across every first-cycle charge, so the panel shows what the charges carry. */
export function feeTotals(offer: Offer): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const charge of offer.charges) {
    for (const fee of charge.fees) totals[fee.feeRuleId] = (totals[fee.feeRuleId] ?? 0) + fee.cents;
  }
  return totals;
}
