// Mock tokenized card. A token holds brand, last4, and expiry only; a card number is never accepted, stored, or
// logged. Both functions are pure: the storefront slice commits what they return.
import type { Payment } from '../../../types';
import { now, today } from './clock';
import type { MintId } from './ids';
import type { Keyed, PaymentToken } from './types';

export interface CardDetails {
  last4: string;
  brand: string;
  expMonth: number;
  expYear: number;
}

/** last4 ending in this string is declined by the mock processor, for the decline path. */
export const DECLINE_SUFFIX = '0002';

export class CardDeclinedError extends Error {
  readonly code = 'card_declined';
  readonly tokenId: string;
  constructor(tokenId: string) {
    super('Card declined');
    this.name = 'CardDeclinedError';
    this.tokenId = tokenId;
  }
}

/** Validates the card summary and returns the token to store. Throws on anything that looks like a card number. */
export function buildToken(card: CardDetails, mint: MintId): PaymentToken {
  const last4 = String(card.last4).trim();
  if (!/^\d{4}$/.test(last4)) throw new Error('last4 must be exactly four digits');
  const brand = String(card.brand).trim().toLowerCase();
  if (!brand) throw new Error('brand is required');
  const expMonth = Number(card.expMonth);
  const expYear = Number(card.expYear);
  if (!Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12) throw new Error('expMonth must be 1 to 12');
  if (!Number.isInteger(expYear) || expYear < 2000) throw new Error('expYear must be a four digit year');
  const [todayYear, todayMonth] = today().split('-').map(Number);
  if (expYear < todayYear || (expYear === todayYear && expMonth < todayMonth)) throw new Error('Card is expired');
  return { id: mint('tok'), brand, last4, expMonth, expYear, createdAt: now() };
}

/**
 * Pure authorization: returns the settled card Payment that charging this token would create, or throws
 * CardDeclinedError. Transactions include the returned Payment in their own single mutateDb.
 */
export function authorizeToken(tokenId: string, cents: number, accountId: string, tokens: Keyed<PaymentToken>, mint: MintId): Payment {
  const token = tokens[tokenId];
  if (!token) throw new Error(`Unknown payment token ${tokenId}`);
  if (!Number.isInteger(cents) || cents <= 0) throw new Error('Charge amount must be a positive number of cents');
  if (token.last4.endsWith(DECLINE_SUFFIX)) throw new CardDeclinedError(tokenId);
  return { id: mint('pay'), accountId, method: 'card', cents, receivedAt: now(), status: 'settled' };
}
