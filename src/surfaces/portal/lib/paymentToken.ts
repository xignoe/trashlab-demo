// Mock hosted payment field. The real product would embed a processor's hosted iframe so the card number,
// expiry, and CVC never touch our code. This stub plays that iframe's part: it hands back a token id and a
// last four and nothing else. There is no input anywhere in the portal that accepts raw card or bank data.

export type PaymentMethodKind = 'card' | 'ach';

export interface PaymentToken {
  tokenId: string;
  kind: PaymentMethodKind;
  last4: string;
  /** Display label the processor would return, for example "Visa" or "Checking". */
  brand: string;
}

let tokenCounter = 0;

function randomLast4(): string {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

/** Pretend the hosted field collected and vaulted a method. Returns only a token and non-sensitive display data. */
export function tokenizeMockMethod(kind: PaymentMethodKind): PaymentToken {
  tokenCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return {
    tokenId: `tok_${rand}${String(tokenCounter).padStart(2, '0')}`,
    kind,
    last4: randomLast4(),
    brand: kind === 'card' ? 'Visa' : 'Checking',
  };
}
