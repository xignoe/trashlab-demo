// Storefront sidecar rows for the two seed quotes. The shared contract has no table for card tokens or quote intake,
// so they live in the storefront slice's initial state (quoteIntake, paymentTokens), not in src/seed.
import type { PaymentToken, QuoteIntake } from './types';

export const SEED_PAYMENT_TOKENS: PaymentToken[] = [
  { id: 'tok_ridge_4242', brand: 'visa', last4: '4242', expMonth: 8, expYear: 2029, createdAt: '2026-09-08T10:00:00-04:00' },
];

export const SEED_QUOTE_INTAKE: QuoteIntake[] = [
  {
    quoteId: 'quote_held_ridge',
    contact: { name: 'Priya Ridgeway', email: 'priya.ridgeway@example.com', phone: '404-555-0142' },
    addressId: 'addr_boundary',
    startDate: '2026-09-15',
    deliveryNotes: 'Gravel drive past the mailbox cluster, leave the cart by the second gate.',
    photoName: 'ridge-hollow-driveway.jpg',
    createdAt: '2026-09-08T10:00:00-04:00',
  },
  {
    quoteId: 'quote_bakery_request',
    contact: { name: 'Sam Okafor', email: 'sam@sunrisebakery.example.com', phone: '404-555-0177' },
    material: 'cardboard',
    accessNotes: 'Enclosure behind the loading dock, gate code 4471',
    createdAt: '2026-09-09T15:30:00-04:00',
  },
];

/** Every id the storefront's own seed sidecars carry, so the store inspector can tell them from session rows. */
export const SEED_SIDECAR_IDS: ReadonlySet<string> = new Set([
  ...SEED_PAYMENT_TOKENS.map((t) => t.id),
  ...SEED_QUOTE_INTAKE.map((q) => q.quoteId),
]);
