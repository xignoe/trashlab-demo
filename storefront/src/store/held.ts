// Boundary zone: hold the price, save the card without charging, and let the office approve or decline.
import type { Quote } from '../types';
import { addHours, isBefore, nextServiceDays, NOW, TODAY } from './clock';
import { resolvePrice } from './engine';
import { assembleOffer, OFFER_ACCOUNT_ID, type Offer, type PricedLine } from './offer';
import { matchAddress } from './serviceability';
import { planSignup, signupPatch, type SignupResult } from './signup';
import { nextId, useStore, type Contact, type QuoteIntake } from './store';

export const HOLD_HOURS = 72;
export const HOLD_EXPIRY_DAYS = 7;

/** "confirm private road access": what a person must check before a boundary address can start. */
export function holdReasonFor(address: { boundaryReason?: string }): string {
  return `confirm ${address.boundaryReason ?? 'service at this address'}`;
}

export interface HeldQuoteArgs {
  offer: Offer;
  contact: Contact;
  deliveryNotes: string;
  photoName?: string;
  /** From tokenizeCard. Saved on the Quote, never charged here. */
  tokenId: string;
  addressId: string;
}

export interface HeldQuoteResult {
  quoteId: string;
  holdReason: string;
  holdDeadline: string;
  expiresAt: string;
}

/** Creates a held Quote plus its intake row in one setState. No Payment is created. */
export function createHeldQuote(args: HeldQuoteArgs): HeldQuoteResult {
  const state = useStore.getState();
  const address = state.addresses[args.addressId];
  if (!address) throw new Error(`Unknown address ${args.addressId}`);
  if (!args.offer.provisional) throw new Error('Only a provisional (boundary zone) offer can be held');
  if (address.zoneId !== args.offer.zoneId) throw new Error('Offer zone does not match the address');
  if (!state.paymentTokens[args.tokenId]) throw new Error(`Unknown payment token ${args.tokenId}`);
  if (!args.contact.name.trim() || !args.contact.email.trim()) throw new Error('Contact name and email are required');

  const holdReason = holdReasonFor(address);
  const quote: Quote = {
    id: nextId('quote'),
    kind: 'residentialSignup',
    address: `${address.line1}, ${address.city}, ${address.state} ${address.zip}`,
    zoneId: args.offer.zoneId,
    lines: args.offer.lines.map((l) => ({ catalogId: l.catalogId, qty: l.qty, frequency: l.frequency, priceCents: l.priceCents })),
    dueTodayCents: args.offer.dueTodayCents,
    recurringCents: args.offer.recurringQuarterlyCents,
    status: 'held',
    holdReason,
    holdDeadline: addHours(NOW, HOLD_HOURS),
    expiresAt: addHours(NOW, HOLD_EXPIRY_DAYS * 24),
    paymentTokenId: args.tokenId,
    createdVia: 'storefront',
  };
  const intake: QuoteIntake = {
    quoteId: quote.id,
    contact: { name: args.contact.name.trim(), email: args.contact.email.trim(), ...(args.contact.phone ? { phone: args.contact.phone } : {}) },
    addressId: address.id,
    startDate: args.offer.startDate,
    deliveryNotes: args.deliveryNotes.trim(),
    ...(args.photoName ? { photoName: args.photoName } : {}),
    createdAt: NOW,
  };

  useStore.setState((s) => ({
    quotes: { ...s.quotes, [quote.id]: quote },
    quoteIntake: { ...s.quoteIntake, [quote.id]: intake },
  }));
  return { quoteId: quote.id, holdReason, holdDeadline: quote.holdDeadline!, expiresAt: quote.expiresAt };
}

export interface ApproveResult extends SignupResult {
  quoteId: string;
  /** The start date actually used; moved forward when the preserved one had passed. */
  startDate: string;
  startDateMoved: boolean;
}

/**
 * Office approval: flips the Quote to accepted, charges the saved token for the quote's dueTodayCents,
 * and creates the same records as completeInstantSignup from the preserved lines and start date, all in
 * one setState. A preserved start date on or before TODAY moves to the next route day.
 */
export function approveHeldQuote(quoteId: string, by: string): ApproveResult {
  const state = useStore.getState();
  const quote = state.quotes[quoteId];
  if (!quote) throw new Error(`Unknown quote ${quoteId}`);
  if (quote.status !== 'held') throw new Error(`Quote ${quoteId} is ${quote.status}, not held`);
  if (!quote.paymentTokenId) throw new Error(`Quote ${quoteId} has no saved card`);
  if (!by.trim()) throw new Error('An approver name is required');

  const intake = state.quoteIntake[quoteId];
  const address = intake?.addressId ? state.addresses[intake.addressId] : matchAddress(quote.address, state).address;
  if (!address) throw new Error(`Quote ${quoteId} has no matching address`);
  if (!address.routeId) throw new Error(`Address ${address.id} has no route`);
  const route = state.routes[address.routeId];
  if (!route) throw new Error(`Unknown route ${address.routeId}`);

  const preserved = intake?.startDate;
  const startDateMoved = !preserved || !isBefore(TODAY, preserved);
  const startDate = startDateMoved ? nextServiceDays(route.day, 1, TODAY)[0] : preserved;

  // Preserved prices are a promise to the buyer. Re-resolve for the rate reference; if the rate card
  // moved, keep the promised price and mark the line a manual exception.
  const lines: PricedLine[] = quote.lines.map((line) => {
    const resolved = resolvePrice(
      { catalogId: line.catalogId, frequency: line.frequency, zoneId: quote.zoneId ?? address.zoneId, accountId: OFFER_ACCOUNT_ID, onDate: startDate },
      state,
    );
    const pricing = resolved.priceCents === line.priceCents ? resolved : { priceCents: line.priceCents, ruleWon: 'manualException' as const };
    return { catalogId: line.catalogId, qty: line.qty, frequency: line.frequency, priceCents: line.priceCents, pricing };
  });

  const offer = assembleOffer({ zoneId: quote.zoneId ?? address.zoneId, routeId: route.id, startDate, lines }, state);
  const contact: Contact = intake?.contact ?? { name: quote.address, email: '' };
  if (!contact.email) throw new Error(`Quote ${quoteId} has no contact on file`);

  const plan = planSignup(
    {
      offer,
      contact,
      address,
      autopay: intake?.autopay ?? false,
      tokenId: quote.paymentTokenId,
      accessNotes: intake?.deliveryNotes,
      chargeCents: quote.dueTodayCents,
    },
    state,
  );

  useStore.setState((s) => ({
    ...signupPatch(plan.records, s),
    quotes: { ...s.quotes, [quoteId]: { ...s.quotes[quoteId], status: 'accepted' } },
    quoteIntake: {
      ...s.quoteIntake,
      [quoteId]: { ...(s.quoteIntake[quoteId] ?? { quoteId, contact, createdAt: NOW }), startDate, reviewedBy: by.trim(), reviewedAt: NOW },
    },
  }));

  return { ...plan.result, quoteId, startDate, startDateMoved };
}

/** Office decline: status declined, reason kept on the intake row. The card is never charged. */
export function declineHeldQuote(quoteId: string, reason: string): { quoteId: string; reason: string } {
  const state = useStore.getState();
  const quote = state.quotes[quoteId];
  if (!quote) throw new Error(`Unknown quote ${quoteId}`);
  if (quote.status !== 'held') throw new Error(`Quote ${quoteId} is ${quote.status}, not held`);
  const trimmed = reason.trim();
  if (!trimmed) throw new Error('A decline reason is required');

  useStore.setState((s) => ({
    quotes: { ...s.quotes, [quoteId]: { ...s.quotes[quoteId], status: 'declined' } },
    quoteIntake: {
      ...s.quoteIntake,
      [quoteId]: {
        ...(s.quoteIntake[quoteId] ?? { quoteId, contact: { name: '', email: '' }, createdAt: NOW }),
        declineReason: trimmed,
        reviewedAt: NOW,
      },
    },
  }));
  return { quoteId, reason: trimmed };
}
