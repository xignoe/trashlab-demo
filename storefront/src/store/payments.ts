// Mock tokenized card. A token holds brand, last4, and expiry only; a card number is never accepted,
// stored, or logged. Authorization is pure (returns the Payment it would write); chargeToken commits it.
import type { Payment } from '../types';
import { NOW, TODAY } from './clock';
import { nextId, useStore, type PaymentToken, type StoreTables } from './store';

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
  constructor(public readonly tokenId: string) {
    super('Card declined');
    this.name = 'CardDeclinedError';
  }
}

/** Validates the card summary and stores a token. Throws on anything that looks like a card number. */
export function tokenizeCard(card: CardDetails): { tokenId: string } {
  const last4 = String(card.last4).trim();
  if (!/^\d{4}$/.test(last4)) throw new Error('last4 must be exactly four digits');
  const brand = String(card.brand).trim().toLowerCase();
  if (!brand) throw new Error('brand is required');
  const expMonth = Number(card.expMonth);
  const expYear = Number(card.expYear);
  if (!Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12) throw new Error('expMonth must be 1 to 12');
  if (!Number.isInteger(expYear) || expYear < 2000) throw new Error('expYear must be a four digit year');
  const [todayYear, todayMonth] = TODAY.split('-').map(Number);
  if (expYear < todayYear || (expYear === todayYear && expMonth < todayMonth)) throw new Error('Card is expired');

  const token: PaymentToken = { id: nextId('tok'), brand, last4, expMonth, expYear, createdAt: NOW };
  useStore.setState((s) => ({ paymentTokens: { ...s.paymentTokens, [token.id]: token } }));
  return { tokenId: token.id };
}

/**
 * Pure authorization: returns the settled card Payment that charging this token would create, or
 * throws CardDeclinedError. Transactions include the returned Payment in their own single setState.
 */
export function authorizeToken(
  tokenId: string,
  cents: number,
  accountId: string,
  state: Pick<StoreTables, 'paymentTokens'> = useStore.getState(),
): Payment {
  const token = state.paymentTokens[tokenId];
  if (!token) throw new Error(`Unknown payment token ${tokenId}`);
  if (!Number.isInteger(cents) || cents <= 0) throw new Error('Charge amount must be a positive number of cents');
  if (token.last4.endsWith(DECLINE_SUFFIX)) throw new CardDeclinedError(tokenId);
  return { id: nextId('pay'), accountId, method: 'card', cents, receivedAt: NOW, status: 'settled' };
}

/** Charges a token and writes the Payment in one setState. Throws CardDeclinedError without writing. */
export function chargeToken(tokenId: string, cents: number, accountId: string): Payment {
  const payment = authorizeToken(tokenId, cents, accountId);
  useStore.setState((s) => ({ payments: { ...s.payments, [payment.id]: payment } }));
  return payment;
}
