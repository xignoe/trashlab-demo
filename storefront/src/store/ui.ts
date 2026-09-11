// Screen routing and buyer selections for the storefront UI. This is a second, small zustand store
// beside the data tables in store.ts, so the transactions there never see UI state and reset() never
// touches the buyer's place in the flow. Routing is one `screen` value; there is no router library.
// Two screens are also reachable from the URL hash (#office and #status/<quoteId>, see src/ui/hashRoute.ts).
import { create } from 'zustand';
import { COMMERCIAL_CONTAINER_IDS, COMMERCIAL_FREQUENCIES, COMMERCIAL_MATERIALS, type CommercialRequestResult } from './commercial';
import type { ApproveResult } from './held';
import type { Offer } from './offer';
import { formatAddress, matchAddress, type AddressMatch } from './serviceability';
import type { SignupResult } from './signup';
import type { Contact } from './store';
import type { Frequency } from '../types';

export type Screen =
  | 'landing'
  | 'notServed'
  | 'offer'
  | 'checkout'
  | 'success'
  | 'franchise'
  /** Boundary zone offer: the open-zone configurator and price panel, marked provisional. */
  | 'boundary'
  /** Boundary intake: contact, delivery notes, driveway photo name, and a saved (not charged) card. */
  | 'boundaryIntake'
  /** Customer status for one quote, reachable by quote id. */
  | 'held'
  | 'commercial'
  | 'office'
  /** The store inspector, the "Store" tab beside office approvals (Phase 6 proof view). */
  | 'store';

export interface Selections {
  cartCatalogId: string;
  extraCart: boolean;
  recycling: boolean;
  /** One of offer.startDateOptions. Undefined means the first option. */
  startDate?: string;
}

/** What the success screen shows: the signup result plus the offer and token it was made from. */
export interface CompletedSignup {
  result: SignupResult;
  offer: Offer;
  tokenId: string;
}

/**
 * Seed addresses whose label promises a variant preselect it, keyed by address id (see DECISIONS.md,
 * Phase 3). The buyer can still change the selection on the offer screen.
 */
export const ADDRESS_PRESETS: Record<string, Partial<Selections>> = {
  addr_open_second_cart: { extraCart: true },
  addr_open_recycling: { recycling: true },
};

export const DEFAULT_SELECTIONS: Selections = { cartCatalogId: 'cat_res_96', extraCart: false, recycling: false };

/**
 * The commercial form's answers. They live here rather than in component state so the agent drawer
 * can echo them as they change (Phase 5).
 */
export interface CommercialDraft {
  address: string;
  containerCatalogId: string;
  material: string;
  frequency: Frequency;
  accessNotes: string;
}

export const DEFAULT_COMMERCIAL_DRAFT: CommercialDraft = {
  address: '',
  containerCatalogId: COMMERCIAL_CONTAINER_IDS[0],
  material: COMMERCIAL_MATERIALS[0],
  frequency: COMMERCIAL_FREQUENCIES[0],
  accessNotes: '',
};
const EMPTY_CONTACT: Contact = { name: '', email: '', phone: '' };

export interface UiState {
  screen: Screen;
  /** The text in the address field (or the picked address, formatted). */
  query: string;
  /** The matched seed address id once one is picked. */
  addressId?: string;
  /** The "For a business" toggle in the top bar. */
  business: boolean;
  selections: Selections;
  contact: Contact;
  autopay: boolean;
  signup?: CompletedSignup;
  /** The quote the status screen shows. */
  statusQuoteId?: string;
  /** The commercial request just submitted, for the receipt view. */
  commercialReceipt?: CommercialRequestResult;
  /** Office approvals made this session, keyed by quote id, so the created ids stay visible inline. */
  approvals: Record<string, ApproveResult>;
  /** The commercial form's answers, shared with the agent drawer. */
  commercialDraft: CommercialDraft;
  /** The "Agent view" drawer: the intake transcript for the current screen. */
  agentOpen: boolean;
  go(screen: Screen): void;
  setQuery(query: string): void;
  setBusiness(business: boolean): void;
  /** Runs matchAddress on a typed query or a picked address id and routes to that branch's screen. */
  submitAddress(queryOrId: string): AddressMatch;
  setSelections(patch: Partial<Selections>): void;
  setContact(patch: Partial<Contact>): void;
  setAutopay(autopay: boolean): void;
  completeSignup(signup: CompletedSignup): void;
  /** Opens the status screen for a quote id. */
  showStatus(quoteId: string): void;
  setCommercialReceipt(receipt: CommercialRequestResult | undefined): void;
  setCommercialDraft(patch: Partial<CommercialDraft>): void;
  recordApproval(quoteId: string, result: ApproveResult): void;
  toggleAgent(open?: boolean): void;
  /** Back to the landing screen with a clean form. Store records and office approvals are kept. */
  startOver(): void;
  /** Forgets this session's receipts (signup, approvals, commercial receipt, status id) after "Reset to seed",
   *  so no screen points at a record the reset removed. The current screen stays. */
  clearSession(): void;
}

/** Which screen a matched address lands on. The business toggle wins over the zone (DECISIONS.md, 31). */
export function screenForBranch(match: AddressMatch, business: boolean): Screen {
  if (business) return 'commercial';
  switch (match.branch) {
    case 'open':
      return 'offer';
    case 'boundary':
      return 'boundary';
    case 'franchise':
      return 'franchise';
    case 'notServed':
      return 'notServed';
  }
}

export const useUi = create<UiState>()((set, get) => ({
  screen: 'landing',
  query: '',
  addressId: undefined,
  business: false,
  selections: DEFAULT_SELECTIONS,
  contact: EMPTY_CONTACT,
  autopay: true,
  signup: undefined,
  statusQuoteId: undefined,
  commercialReceipt: undefined,
  approvals: {},
  commercialDraft: DEFAULT_COMMERCIAL_DRAFT,
  agentOpen: false,

  go: (screen) => set({ screen }),
  setQuery: (query) => set({ query }),
  setBusiness: (business) => set({ business }),
  submitAddress: (queryOrId) => {
    const match = matchAddress(queryOrId);
    const address = match.address;
    const preset = address ? ADDRESS_PRESETS[address.id] ?? {} : {};
    set({
      query: address ? formatAddress(address) : queryOrId,
      addressId: address?.id,
      selections: { ...DEFAULT_SELECTIONS, ...preset },
      commercialDraft: { ...DEFAULT_COMMERCIAL_DRAFT, address: address ? formatAddress(address) : queryOrId },
      signup: undefined,
      commercialReceipt: undefined,
      screen: screenForBranch(match, get().business),
    });
    return match;
  },
  setSelections: (patch) => set((s) => ({ selections: { ...s.selections, ...patch } })),
  setContact: (patch) => set((s) => ({ contact: { ...s.contact, ...patch } })),
  setAutopay: (autopay) => set({ autopay }),
  completeSignup: (signup) => set({ signup, screen: 'success' }),
  showStatus: (quoteId) => set({ statusQuoteId: quoteId, screen: 'held' }),
  setCommercialReceipt: (commercialReceipt) => set({ commercialReceipt }),
  setCommercialDraft: (patch) => set((s) => ({ commercialDraft: { ...s.commercialDraft, ...patch } })),
  recordApproval: (quoteId, result) => set((s) => ({ approvals: { ...s.approvals, [quoteId]: result } })),
  toggleAgent: (open) => set((s) => ({ agentOpen: open ?? !s.agentOpen })),
  startOver: () =>
    set({
      screen: 'landing',
      query: '',
      addressId: undefined,
      selections: DEFAULT_SELECTIONS,
      contact: EMPTY_CONTACT,
      autopay: true,
      signup: undefined,
      statusQuoteId: undefined,
      commercialReceipt: undefined,
      commercialDraft: DEFAULT_COMMERCIAL_DRAFT,
      agentOpen: false,
    }),
  clearSession: () => set({ approvals: {}, signup: undefined, commercialReceipt: undefined, statusQuoteId: undefined }),
}));
