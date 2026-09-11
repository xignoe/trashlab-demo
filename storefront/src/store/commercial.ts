// Commercial quote request. No price is ever shown or stored; a person replies with a written price.
import type { Frequency, Quote } from '../types';
import { addHours, nextBusinessDay, NOW, TODAY } from './clock';
import { formatAddress, matchAddress } from './serviceability';
import { nextId, useStore, type Contact, type QuoteIntake } from './store';

export const COMMERCIAL_NO_PRICE_REASON =
  'Commercial pricing depends on material, frequency, and access, so we confirm it with you rather than guess.';

export const COMMERCIAL_EXPIRY_DAYS = 30;

export const COMMERCIAL_MATERIALS = ['trash', 'wood waste', 'cardboard', 'mixed recycling'] as const;
export type CommercialMaterial = (typeof COMMERCIAL_MATERIALS)[number];
export const COMMERCIAL_FREQUENCIES: Frequency[] = ['weekly', '2x', '3x'];
/** The container sizes the commercial form offers (2 yd, 3 yd). */
export const COMMERCIAL_CONTAINER_IDS = ['cat_fl_2yd', 'cat_fl_3yd'] as const;

export interface CommercialRequestArgs {
  /** The typed address; matched with matchAddress for the zone. */
  address: string;
  containerCatalogId: string;
  material: string;
  frequency: Frequency;
  accessNotes: string;
  contact: Contact;
}

export interface CommercialRequestResult {
  quoteId: string;
  /** The next business day after TODAY, when a person replies with a written price. */
  replyBy: string;
  expiresAt: string;
}

/** Saves a commercialRequest Quote (priceCents 0) and its intake row in one setState. */
export function createCommercialRequest(args: CommercialRequestArgs): CommercialRequestResult {
  const state = useStore.getState();
  const container = state.catalog[args.containerCatalogId];
  if (!container || container.lob !== 'frontload') throw new Error('Container size must be a front load catalog item');
  if (!args.material.trim()) throw new Error('Material is required');
  if (!COMMERCIAL_FREQUENCIES.includes(args.frequency)) throw new Error('Frequency must be weekly, 2x, or 3x');
  if (!args.contact.name.trim() || !args.contact.email.trim()) throw new Error('Contact name and email are required');

  const match = matchAddress(args.address, state);
  const quote: Quote = {
    id: nextId('quote'),
    kind: 'commercialRequest',
    address: match.address ? formatAddress(match.address) : args.address.trim(),
    zoneId: match.zone.id,
    lines: [{ catalogId: container.id, qty: 1, frequency: args.frequency, priceCents: 0 }],
    dueTodayCents: 0,
    recurringCents: 0,
    status: 'draft',
    expiresAt: addHours(NOW, COMMERCIAL_EXPIRY_DAYS * 24),
    createdVia: 'storefront',
  };
  const intake: QuoteIntake = {
    quoteId: quote.id,
    contact: { name: args.contact.name.trim(), email: args.contact.email.trim(), ...(args.contact.phone ? { phone: args.contact.phone } : {}) },
    ...(match.address ? { addressId: match.address.id } : {}),
    material: args.material.trim(),
    accessNotes: args.accessNotes.trim(),
    createdAt: NOW,
  };

  useStore.setState((s) => ({
    quotes: { ...s.quotes, [quote.id]: quote },
    quoteIntake: { ...s.quoteIntake, [quote.id]: intake },
  }));
  return { quoteId: quote.id, replyBy: nextBusinessDay(TODAY), expiresAt: quote.expiresAt };
}
