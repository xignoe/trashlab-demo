// React-side reads of the store for the storefront: the keyed view, the buyer's flow state, the current offer, the
// menu prices beside every option, and navigation between the nested routes. Nothing here writes to the Db; writes
// go through the storefront slice's actions.
import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { resolvePrice } from '../../../store/engine';
import { useStore } from '../../../store/useStore';
import type { FeeRule } from '../../../types';
import { formatCents } from '../lib/money';
import {
  buildOffer, CART_CATALOG_IDS, EXTRA_CART_CATALOG_ID, OFFER_ACCOUNT_ID, RECYCLING_CATALOG_ID, withProvisionalSite, type Offer,
} from '../lib/offer';
import { pathFor, screenForPath, statusPath, STOREFRONT_BASE } from '../lib/paths';
import { matchAddress, type AddressMatch } from '../lib/serviceability';
import type { Contact } from '../lib/types';
import type { CommercialDraft, Screen, Selections, StorefrontUi } from '../lib/ui';
import { viewOf, type SfView } from '../lib/view';

/** The keyed view of the live Db and the storefront sidecars. The same object until one of them changes. */
export function useView(): SfView {
  return useStore((s) => viewOf(s));
}

const setUi: StorefrontUiSetter = (patch) => useStore.getState().sfSetUi(patch);
type StorefrontUiSetter = (patch: Partial<StorefrontUi> | ((ui: StorefrontUi) => Partial<StorefrontUi>)) => void;

/** The prototype's ui-store setters, now writing the slice's sfUi. Stable functions, safe to select. */
export const uiActions = {
  setQuery: (query: string) => setUi({ query }),
  setBusiness: (business: boolean) => setUi({ business }),
  setSelections: (patch: Partial<Selections>) => setUi((ui) => ({ selections: { ...ui.selections, ...patch } })),
  setContact: (patch: Partial<Contact>) => setUi((ui) => ({ contact: { ...ui.contact, ...patch } })),
  setAutopay: (autopay: boolean) => setUi({ autopay }),
  setCommercialDraft: (patch: Partial<CommercialDraft>) => setUi((ui) => ({ commercialDraft: { ...ui.commercialDraft, ...patch } })),
  toggleAgent: (open?: boolean) => setUi((ui) => ({ agentOpen: open ?? !ui.agentOpen })),
};

export type UiApi = StorefrontUi & typeof uiActions;

/** Select from the buyer's flow state and its setters, as the prototype's useUi did. */
export function useUi<T>(select: (ui: UiApi) => T): T {
  return useStore((s) => select({ ...s.sfUi, ...uiActions }));
}

/** Which storefront screen the URL shows, and the quote id on the status screen. */
export function useScreen(): { screen: Screen; quoteId?: string } {
  const { pathname } = useLocation();
  return useMemo(() => screenForPath(pathname), [pathname]);
}

/** Navigate to a storefront screen (the prototype's go(screen)). */
export function useGo(): (screen: Exclude<Screen, 'held'>) => void {
  const navigate = useNavigate();
  return useCallback((screen) => navigate(pathFor(screen)), [navigate]);
}

/** Open the customer status screen for a quote (the prototype's showStatus). */
export function useShowStatus(): (quoteId: string) => void {
  const navigate = useNavigate();
  return useCallback((quoteId) => navigate(statusPath(quoteId)), [navigate]);
}

/** Back to the landing screen with a clean form (the prototype's startOver). */
export function useStartOver(): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    useStore.getState().sfStartOver();
    navigate(STOREFRONT_BASE);
  }, [navigate]);
}

export interface OfferView {
  match?: AddressMatch;
  offer?: Offer;
  /** What the buyer reads when there is no offer. */
  error?: string;
  /** The engine's reason, never shown to the buyer. */
  detail?: string;
}

export const OFFER_UNAVAILABLE = 'We could not price this address online. Check a different address, or try again later.';

/** The priced offer for the picked address and current selections, from the canonical engine. */
export function offerViewFor(addressId: string | undefined, selections: Selections, view: SfView): OfferView {
  if (!addressId) return {};
  const match = matchAddress(addressId, view);
  if (!match.address || !match.route) return { match, error: 'We could not find a pickup route for this address. Check a different address.' };
  try {
    const offer = buildOffer({ zoneId: match.zone.id, routeId: match.route.id, ...selections }, view);
    return { match, offer };
  } catch (e) {
    // Buyer copy on screen; the engine's reason stays on `detail` for debugging.
    return { match, error: OFFER_UNAVAILABLE, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** The priced offer for the picked address and current selections. Recomputes on any Db or selection change. */
export function useOfferView(): OfferView {
  const view = useView();
  const addressId = useUi((s) => s.addressId);
  const selections = useUi((s) => s.selections);
  return useMemo(() => offerViewFor(addressId, selections, view), [view, addressId, selections]);
}

/** Monthly prices for every configurator option, resolved the same way the offer resolves them. */
export type MenuPrices = Record<string, number | undefined>;

export function menuPrices(offer: Offer, view: SfView): MenuPrices {
  const db = withProvisionalSite(view.db, offer.zoneId, offer.routeId);
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
        db,
      ).priceCents;
    } catch {
      out[catalogId] = undefined;
    }
  }
  return out;
}

export function useMenuPrices(offer: Offer | undefined): MenuPrices {
  const view = useView();
  return useMemo(() => (offer ? menuPrices(offer, view) : {}), [offer, view]);
}

/** "$29.00/mo" or "Price unavailable". */
export function perMonth(cents: number | undefined): string {
  return cents === undefined ? 'Price unavailable' : `${formatCents(cents)}/mo`;
}

/**
 * "Fuel surcharge, 7%" or "Environmental fee, $1.00/mo", from the FeeRule itself. When the engine applied a flat fee
 * for fewer whole months than the service months (the canonical engine counts whole calendar months, so a quarter
 * starting mid-month takes a monthly flat fee twice), the label says how many, so the amount beside it adds up.
 */
export function feeLabel(rule: FeeRule, wholeMonths?: number, serviceMonths = 3): string {
  if (rule.kind === 'percent') return `${rule.name}, ${rule.value}%`;
  const base = `${rule.name}, ${formatCents(rule.value)}/mo`;
  return wholeMonths !== undefined && wholeMonths !== serviceMonths ? `${base}, ${wholeMonths} whole months` : base;
}

/** How many whole months the engine applied a flat fee for on the offer's first recurring line, if it applied it. */
export function flatFeeMonths(offer: Offer, rule: FeeRule): number | undefined {
  if (rule.kind !== 'flat' || rule.value <= 0) return undefined;
  const line = offer.lines[0];
  const fee = line?.charge.fees.find((f) => f.feeRuleId === rule.id);
  return fee ? Math.round(fee.cents / (rule.value * line.qty)) : undefined;
}

/** Fee cents per FeeRule id across every first-cycle charge, so the panel shows what the charges carry. */
export function feeTotals(offer: Offer): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const charge of offer.charges) {
    for (const fee of charge.fees) totals[fee.feeRuleId] = (totals[fee.feeRuleId] ?? 0) + fee.cents;
  }
  return totals;
}
