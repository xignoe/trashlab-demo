// The buyer's place in the flow: the typed address, the selections, the contact, and this session's receipts. It
// lives in the storefront slice as `sfUi` (src/store/slices/storefront.ts), so Reset seed in the persona bar clears it
// with everything else. Which screen shows is the URL (nested routes under /customer/store, lib/paths.ts), not state.
import { DEFAULT_COMMERCIAL_LINE, type CommercialLine, type CommercialRequestResult, type ServiceTerm } from './commercial';
import type { ApproveResult } from './held';
import type { Offer } from './offer';
import type { AddressMatch } from './serviceability';
import type { SignupResult } from './signup';
import type { Contact } from './types';

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
  | 'office';

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
 * Addresses whose label promises a variant preselect it, keyed by address id (storefront DECISIONS.md, Phase 3).
 * The buyer can still change the selection on the offer screen.
 */
export const ADDRESS_PRESETS: Record<string, Partial<Selections>> = {
  addr_open_second_cart: { extraCart: true },
  addr_open_recycling: { recycling: true },
};

export const DEFAULT_SELECTIONS: Selections = { cartCatalogId: 'cat_res_96', extraCart: false, recycling: false };

/** The commercial form's answers, kept in the slice so the agent drawer can echo them as they change. */
export interface CommercialDraft {
  address: string;
  businessType: string;
  term: ServiceTerm;
  lines: CommercialLine[];
  extras: string[];
  /** Preferred start, an ISO date, or '' for as soon as possible. */
  startDate: string;
  accessNotes: string;
}

export const DEFAULT_COMMERCIAL_DRAFT: CommercialDraft = {
  address: '',
  businessType: '',
  term: 'ongoing',
  lines: [DEFAULT_COMMERCIAL_LINE],
  extras: [],
  startDate: '',
  accessNotes: '',
};

export const EMPTY_CONTACT: Contact = { name: '', email: '', phone: '' };

export interface StorefrontUi {
  /** The text in the address field (or the picked address, formatted). */
  query: string;
  /** The matched address id once one is picked. */
  addressId?: string;
  /** The "For a business" toggle in the storefront header. */
  business: boolean;
  selections: Selections;
  contact: Contact;
  autopay: boolean;
  signup?: CompletedSignup;
  /** The commercial request just submitted, for the receipt view. */
  commercialReceipt?: CommercialRequestResult;
  /** Office approvals made this session, keyed by quote id, so the created ids stay visible inline. */
  approvals: Record<string, ApproveResult>;
  /** The commercial form's answers, shared with the agent drawer. */
  commercialDraft: CommercialDraft;
  /** The "Agent view" drawer: the intake transcript for the current screen. */
  agentOpen: boolean;
}

export function initialStorefrontUi(): StorefrontUi {
  return {
    query: '',
    addressId: undefined,
    business: false,
    selections: DEFAULT_SELECTIONS,
    contact: EMPTY_CONTACT,
    autopay: true,
    signup: undefined,
    commercialReceipt: undefined,
    approvals: {},
    commercialDraft: DEFAULT_COMMERCIAL_DRAFT,
    agentOpen: false,
  };
}

/** Which screen a matched address lands on. The business toggle wins over the zone (storefront DECISIONS.md, 31). */
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
