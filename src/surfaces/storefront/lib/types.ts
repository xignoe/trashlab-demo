// Storefront-only shapes the shared contract does not define. They live in the storefront slice
// (src/store/slices/storefront.ts), never in the Db: quoteIntake sits beside a Quote, and a PaymentToken is the
// mock processor's card token.

export type Keyed<T> = Record<string, T>;

/** Who to reach about a signup or request. "phone" is the mobile number the UI collects. */
export interface Contact {
  name: string;
  email: string;
  phone?: string;
}

/** A tokenized card. Brand, last4, expiry only; a PAN is never accepted or stored. */
export interface PaymentToken {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  createdAt: string;
}

/** Storefront intake details that sit beside a Quote (the contract's Quote has no contact or notes). */
export interface QuoteIntake {
  quoteId: string;
  contact: Contact;
  addressId?: string;
  startDate?: string;
  deliveryNotes?: string;
  photoName?: string;
  material?: string;
  /** Commercial: the material of each container line, in line order. */
  lineMaterials?: string[];
  /** Commercial: the kind of business, as picked on the form. */
  businessType?: string;
  /** Commercial: ongoing service or a one-time project. */
  term?: 'ongoing' | 'project';
  /** Commercial: lock bar, casters, enclosure. */
  extras?: string[];
  accessNotes?: string;
  /** Set when the boundary intake asked for autopay. Approval defaults to false without it. */
  autopay?: boolean;
  declineReason?: string;
  /** Commercial: when the office sent the written price, and who. */
  quotedAt?: string;
  quotedBy?: string;
  /** Commercial: the account the accepted quote bills on (created for a new customer, or the existing one). */
  acceptedAccountId?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}
