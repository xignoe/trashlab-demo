// Which intake the agent drawer shows for the screen the buyer is on. Pure: reads the flow state and the keyed view,
// returns the arguments for runIntake (or the reason there is no transcript). The drawer adds the page's own Offer on
// the screens that show a price panel, so both read one buildOffer call.
import type { TranscriptArgs } from '../lib/agent';
import { CART_CATALOG_IDS, EXTRA_CART_CATALOG_ID, RECYCLING_CATALOG_ID } from '../lib/offer';
import { matchAddress } from '../lib/serviceability';
import { ADDRESS_PRESETS, DEFAULT_SELECTIONS, type Screen, type StorefrontUi } from '../lib/ui';
import type { SfView } from '../lib/view';

export interface AgentContext {
  args?: TranscriptArgs;
  /** Shown above the thread when the transcript is for something other than the live page (a saved quote). */
  note?: string;
  /** Shown instead of a thread when this screen has no buyer conversation yet. */
  empty?: string;
}

/** The flow state the drawer reads, plus the screen and status quote id that now come from the URL. */
export type AgentUi = Pick<StorefrontUi, 'query' | 'addressId' | 'business' | 'selections' | 'commercialDraft'> & {
  screen: Screen;
  statusQuoteId?: string;
};

/** Screens whose price panel comes from useOfferView; the drawer passes that same Offer into the transcript. */
export const OFFER_SCREENS: ReadonlySet<Screen> = new Set<Screen>(['offer', 'boundary', 'checkout', 'boundaryIntake', 'success']);

export function agentContextFor(ui: AgentUi, tables: SfView): AgentContext {
  switch (ui.screen) {
    case 'office':
      return {
        empty:
          'The office is where a person picks up what the agent hands off. Open a quote status, or check an address, to see a transcript.',
      };

    case 'landing': {
      const query = ui.query.trim();
      if (!query) return { empty: 'Type an address and this shows how an intake agent would answer it, using the same rules as this page.' };
      const id = matchAddress(query, tables).address?.id;
      const preset = id ? ADDRESS_PRESETS[id] ?? {} : {};
      return { args: { query, business: ui.business, ...DEFAULT_SELECTIONS, ...preset } };
    }

    case 'commercial': {
      const d = ui.commercialDraft;
      // The agent transcript asks about one container; it follows the form's first line.
      const first = d.lines[0];
      return {
        args: {
          query: d.address || ui.query,
          business: true,
          ...DEFAULT_SELECTIONS,
          commercial: { containerCatalogId: first?.catalogId, material: first?.material, frequency: first?.frequency, accessNotes: d.accessNotes },
        },
      };
    }

    case 'held': {
      const quote = ui.statusQuoteId ? tables.quotes[ui.statusQuoteId] : undefined;
      if (!quote) return { empty: 'There is no saved request on this screen to replay.' };
      const intake = tables.quoteIntake[quote.id];
      const query = intake?.addressId ?? quote.address;
      const note = `Replaying the intake for ${quote.id} as it was submitted.`;
      if (quote.kind === 'commercialRequest') {
        const line = quote.lines[0];
        return {
          note,
          args: {
            query,
            business: true,
            ...DEFAULT_SELECTIONS,
            commercial: { containerCatalogId: line?.catalogId, material: intake?.material, frequency: line?.frequency, accessNotes: intake?.accessNotes },
          },
        };
      }
      const ids = quote.lines.map((l) => l.catalogId);
      const cart = ids.find((id) => (CART_CATALOG_IDS as readonly string[]).includes(id)) ?? DEFAULT_SELECTIONS.cartCatalogId;
      return {
        note,
        args: {
          query,
          business: false,
          cartCatalogId: cart,
          extraCart: ids.includes(EXTRA_CART_CATALOG_ID),
          recycling: ids.includes(RECYCLING_CATALOG_ID),
          ...(intake?.startDate ? { startDate: intake.startDate } : {}),
          ...(quote.holdDeadline ? { holdDeadline: quote.holdDeadline } : {}),
        },
      };
    }

    case 'notServed':
    case 'offer':
    case 'boundary':
    case 'checkout':
    case 'boundaryIntake':
    case 'success':
    case 'franchise':
      return { args: { query: ui.addressId ?? ui.query, business: false, ...ui.selections } };
  }
}
