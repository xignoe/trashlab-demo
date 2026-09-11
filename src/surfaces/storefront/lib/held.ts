// Boundary zone: hold the price, save the card without charging, and let the office approve or decline. Every
// function here is a pure planner; the storefront slice commits what it returns in one mutateDb.
import type { Quote } from '../../../types';
import { addHours, isBefore, nextServiceDays, now, today } from './clock';
import type { MintId } from './ids';
import { assembleOffer, OFFER_ACCOUNT_ID, type Offer, type PricedLine } from './offer';
import { resolvePrice } from '../../../store/engine';
import { formatAddress, matchAddress } from './serviceability';
import { planSignup, type SignupPlan, type SignupResult } from './signup';
import type { Contact, QuoteIntake } from './types';
import type { SfView } from './view';

export const HOLD_HOURS = 72;
export const HOLD_EXPIRY_DAYS = 7;

/** "confirm private road access": what a person must check before a boundary address can start. */
export function holdReasonFor(address: { boundaryReason?: string }): string {
  return `confirm ${address.boundaryReason ?? 'service at this address'}`;
}

/**
 * The card saved on a held quote: the Quote's own paymentTokenId. The seed's quote_held_ridge carries one since box
 * 3.7c, so the storefront's former seed sidecar fallback is gone (box 3.7g).
 */
export function savedTokenId(quote: Pick<Quote, 'paymentTokenId'>): string | undefined {
  return quote.paymentTokenId;
}

export interface HeldQuoteArgs {
  offer: Offer;
  contact: Contact;
  deliveryNotes: string;
  photoName?: string;
  /** From the slice's sfTokenizeCard. Saved on the Quote, never charged here. */
  tokenId: string;
  addressId: string;
}

export interface HeldQuoteResult {
  quoteId: string;
  holdReason: string;
  holdDeadline: string;
  expiresAt: string;
}

export interface HeldQuotePlan {
  quote: Quote;
  intake: QuoteIntake;
  result: HeldQuoteResult;
}

/** A held Quote plus its intake row. No Payment. */
export function planHeldQuote(args: HeldQuoteArgs, view: SfView, mint: MintId): HeldQuotePlan {
  const address = view.addresses[args.addressId];
  if (!address) throw new Error(`Unknown address ${args.addressId}`);
  if (!args.offer.provisional) throw new Error('Only a provisional (boundary zone) offer can be held');
  if (address.zoneId !== args.offer.zoneId) throw new Error('Offer zone does not match the address');
  if (!view.paymentTokens[args.tokenId]) throw new Error(`Unknown payment token ${args.tokenId}`);
  if (!args.contact.name.trim() || !args.contact.email.trim()) throw new Error('Contact name and email are required');

  const at = now();
  const holdReason = holdReasonFor(address);
  const quote: Quote = {
    id: mint('quote'),
    kind: 'residentialSignup',
    address: formatAddress(address),
    zoneId: args.offer.zoneId,
    lines: args.offer.lines.map((l) => ({ catalogId: l.catalogId, qty: l.qty, frequency: l.frequency, priceCents: l.priceCents })),
    dueTodayCents: args.offer.dueTodayCents,
    recurringCents: args.offer.recurringQuarterlyCents,
    status: 'held',
    holdReason,
    holdDeadline: addHours(at, HOLD_HOURS),
    expiresAt: addHours(at, HOLD_EXPIRY_DAYS * 24),
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
    createdAt: at,
  };
  return { quote, intake, result: { quoteId: quote.id, holdReason, holdDeadline: quote.holdDeadline!, expiresAt: quote.expiresAt } };
}

export interface ApproveResult extends SignupResult {
  quoteId: string;
  /** The start date actually used; moved forward when the preserved one had passed. */
  startDate: string;
  startDateMoved: boolean;
}

/** What approving a held quote would book and charge, before anything is written. */
export interface ApprovalPreview {
  offer: Offer;
  startDate: string;
  startDateMoved: boolean;
  contact: Contact;
  tokenId: string;
  addressId: string;
  accessNotes?: string;
  autopay: boolean;
}

/**
 * The offer an approval books: the quote's preserved lines and prices, at the preserved start date (moved to the
 * next route day when it is today or earlier). Preserved prices are a promise to the buyer: each line is re-resolved
 * only for its rate reference, and when the rate card has moved the promised price is kept and marked manualException.
 */
export function previewApproval(quote: Quote, view: SfView): ApprovalPreview {
  if (quote.kind !== 'residentialSignup') throw new Error(`Quote ${quote.id} is a ${quote.kind}, not a residential signup`);
  const tokenId = savedTokenId(quote);
  if (!tokenId) throw new Error(`Quote ${quote.id} has no saved card`);

  const intake = view.quoteIntake[quote.id];
  const address = intake?.addressId ? view.addresses[intake.addressId] : matchAddress(quote.address, view).address;
  if (!address) throw new Error(`Quote ${quote.id} has no matching address`);
  if (!address.routeId) throw new Error(`Address ${address.id} has no route`);
  const route = view.routes[address.routeId];
  if (!route) throw new Error(`Unknown route ${address.routeId}`);

  const preserved = intake?.startDate;
  const startDateMoved = !preserved || !isBefore(today(), preserved);
  const startDate = startDateMoved ? nextServiceDays(route.day as never, 1, today())[0] : preserved;
  const zoneId = quote.zoneId ?? address.zoneId;

  const lines: PricedLine[] = quote.lines.map((line) => {
    const resolved = resolvePrice(
      { catalogId: line.catalogId, frequency: line.frequency, zoneId, accountId: OFFER_ACCOUNT_ID, onDate: startDate },
      view.db,
    );
    const pricing = resolved.priceCents === line.priceCents ? resolved : { priceCents: line.priceCents, ruleWon: 'manualException' as const };
    return { catalogId: line.catalogId, qty: line.qty, frequency: line.frequency, priceCents: line.priceCents, pricing };
  });

  const offer = assembleOffer({ zoneId, routeId: route.id, startDate, lines }, view);
  const contact: Contact = intake?.contact ?? { name: quote.address, email: '' };
  return {
    offer,
    startDate,
    startDateMoved,
    contact,
    tokenId,
    addressId: address.id,
    ...(intake?.deliveryNotes ? { accessNotes: intake.deliveryNotes } : {}),
    autopay: intake?.autopay ?? false,
  };
}

/**
 * The amounts a held quote shows: what approval would charge and what then recurs, from previewApproval. For a quote
 * the storefront created these equal the Quote's own dueTodayCents and recurringCents. The seed's quote_held_ridge
 * carries illustrative numbers (addendum I4) that are not what the engine computes for its line, so the storefront
 * shows the engine's figures, which are the ones approval actually charges. Falls back to the Quote's numbers when
 * the quote cannot be previewed (a commercial request, or no saved card).
 */
export function heldAmounts(quote: Quote, view: SfView): { dueTodayCents: number; recurringCents: number; fromQuote: boolean } {
  if (quote.kind === 'residentialSignup' && quote.status === 'held') {
    try {
      const { offer } = previewApproval(quote, view);
      return { dueTodayCents: offer.dueTodayCents, recurringCents: offer.recurringQuarterlyCents, fromQuote: false };
    } catch {
      // fall through to the Quote's own numbers
    }
  }
  return { dueTodayCents: quote.dueTodayCents, recurringCents: quote.recurringCents, fromQuote: true };
}

export interface ApprovalPlan {
  signup: SignupPlan;
  quote: Quote;
  intake: QuoteIntake;
  result: ApproveResult;
}

/**
 * Office approval: flips the Quote to accepted, charges the saved token, and creates the same records as an instant
 * signup from the preserved lines and start date. The charge is the approved first-cycle charges' total, so the
 * payment always equals what billing will post on the first invoice.
 */
export function planApproval(quoteId: string, by: string, view: SfView, mint: MintId): ApprovalPlan {
  const quote = view.quotes[quoteId];
  if (!quote) throw new Error(`Unknown quote ${quoteId}`);
  if (quote.status !== 'held') throw new Error(`Quote ${quoteId} is ${quote.status}, not held`);
  if (!by.trim()) throw new Error('An approver name is required');

  const preview = previewApproval(quote, view);
  if (!preview.contact.email) throw new Error(`Quote ${quoteId} has no contact on file`);
  const address = view.addresses[preview.addressId]!;

  const signup = planSignup(
    {
      offer: preview.offer,
      contact: preview.contact,
      address,
      autopay: preview.autopay,
      tokenId: preview.tokenId,
      accessNotes: preview.accessNotes,
    },
    view,
    mint,
  );

  const at = now();
  const intake: QuoteIntake = {
    ...(view.quoteIntake[quoteId] ?? { quoteId, contact: preview.contact, createdAt: at }),
    startDate: preview.startDate,
    reviewedBy: by.trim(),
    reviewedAt: at,
  };
  return {
    signup,
    quote: { ...quote, status: 'accepted' },
    intake,
    result: { ...signup.result, quoteId, startDate: preview.startDate, startDateMoved: preview.startDateMoved },
  };
}

/** Office decline: status declined, reason kept on the intake row. The card is never charged. */
export function planDecline(quoteId: string, reason: string, view: SfView): { quote: Quote; intake: QuoteIntake; reason: string } {
  const quote = view.quotes[quoteId];
  if (!quote) throw new Error(`Unknown quote ${quoteId}`);
  // A held signup, or an open commercial request (the office declines it, or records the customer declining the price).
  const open = quote.status === 'held' || (quote.kind === 'commercialRequest' && quote.status === 'draft');
  if (!open) throw new Error(`Quote ${quoteId} is ${quote.status}, not held`);
  const trimmed = reason.trim();
  if (!trimmed) throw new Error('A decline reason is required');
  const intake: QuoteIntake = {
    ...(view.quoteIntake[quoteId] ?? { quoteId, contact: { name: '', email: '' }, createdAt: now() }),
    declineReason: trimmed,
    reviewedAt: now(),
  };
  return { quote: { ...quote, status: 'declined' }, intake, reason: trimmed };
}
