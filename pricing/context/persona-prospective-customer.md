# Persona: Prospective Customer (storefront and portal)

One persona, one flow, with three branch points. Sub-cases (homeowner instant, homeowner franchise/HOA hard stop, bakery quote request, contractor on account) are test scenarios, not separate personas.

Branch points:
1. Can the address price itself? Residential cart yes, retail rolloff yes (zone plus size), commercial no (needs material and frequency), contractor rolloff yes if they have an account. If no, the flow ends at a structured quote request.
2. Is money collected now or later? Card now for homeowners and one-off rolloff, terms for accounts.
3. Does the job end? Subscriptions run until cancelled; rolloff has a rental clock and a true-up. Affects the portal, not signup.

## Buyer principle

The buyer is not shopping for waste software. They are trying to make trash disappear reliably, at a known price, with minimal effort and no surprises. The winning experience replaces uncertainty with a credible commitment.

## What matters in the first 30 seconds

| Rank | Buyer question | Why |
|---|---|---|
| 1 | Do you serve my address? | Nothing else matters until confirmed. Address entry is the primary action. |
| 2 | What will I actually pay? | Show first charge and recurring charge, including mandatory fees and estimated tax. |
| 3 | When can service start? | "As soon as Tuesday" beats "weekly service available." |
| 4 | Can I finish without talking to someone? | Especially after hours; will accept a short review for a credible reason. |

The biggest avoidable sale-killer is withholding the total price. An unsupported address ends the transaction legitimately; "call for pricing" sends a qualified buyer back to Google, WM, or the neighbor's recommendation.

## Conditions for safe instant signup

| Condition | Normal handling | Review trigger |
|---|---|---|
| Address in serviceable zone | Geocode, normalize, match to active polygon | Border address, new subdivision, private road, multi-unit, failed geocode |
| Cart available | Check inventory by yard, size, committed deliveries | Inventory unavailable, stale, or below reserve |
| Route has capacity | Map to route/day; evaluate stop, time, weight, growth limits | No valid route, route near limit, unusual access |
| First cycle collected | Calculate exact initial charge; collect via tokenized provider | Decline, AVS mismatch, fraud flag, pricing exception |
| Delivery work order exists | Create automatically after all prior checks pass | Scheduling collision, unsupported instructions, manual site assessment |

Automation should be policy-based, not optimistic. The review experience should: preserve the quoted price for a stated period; avoid charging until acceptance (or clearly label a temporary authorization); give a specific reason; give a deadline ("we'll text you by 10 a.m. tomorrow"); let the buyer upload gate notes or a driveway photo; confirm service and payment by text/email without another call.

## Honest pricing without unnecessary exposure

Do not publish one universal rate sheet. Publish an address-qualified, product-specific price. After address entry, show: service (96 gal cart, weekly) $32/mo; one-time cart delivery $20; setup $0; fuel/environmental surcharge $3.50/mo; estimated tax $1.78/mo; due today $57.28; normal monthly bill $37.28; next pickup and billing cadence; conditions that can change the amount (extra material, contamination).

Self-serve candidates: standard residential carts; second carts with published pricing; recycling or yard waste add-ons; simple small-business cart service with standardized frequency, material, access, pricing.

Behind a qualified quote: commercial dumpsters with variable frequency, enclosure, locks, overages, contract terms; compactors; contractor rolloff (material, weight, haul distance, placement, permits, availability); hazardous or unusual waste.

## What the portal should absorb

| Request | Handling |
|---|---|
| Balance, invoices, receipts, autopay | Fully absorb |
| Vacation hold | Fully absorb when dates and policy qualify |
| Extra pickup | Fully absorb when price, capacity, material rules are known; create a paid work order |
| Missed pickup | Fully absorb when account active, route event supports the claim, no exception recorded; create recovery work order. Partial if driver recorded blockage, contamination, late set-out |
| Cart size or second cart | Fully absorb for standard inventory and published pricing; create delivery/exchange and retrieval work orders |
| Disputed fees, repeated misses, damage, safety | Human handoff carrying transcript, account facts, photos, requested resolution |

A request becomes a work order without office involvement when identity, eligibility, price, capacity, and fulfillment instructions are deterministic. AI can conduct the conversation, but a rules engine authorizes the action.

## The agentic buyer experience

The agent needs: address normalization, service polygons, route/day assignment, capacity; executable pricing rules (fees, taxes, proration, promotions, second-cart pricing, quote expiration); real-time cart inventory and delivery slots; account, contact, site, billing, and work-order APIs; idempotency; hosted payment collection, autopay consent, communication consent, auditable quote snapshot; exception codes and human handoff with context.

It should never: override service boundaries or capacity, invent a price or pickup date, waive disputed charges, negotiate contracts, approve unusual waste, handle raw card details in text/voice, or make safety and access exceptions.

## Flows

Instant homeowner signup
1. Buyer enters address.
2. System confirms zone and assigns Tuesday's route.
3. Buyer selects one 96 gal cart.
4. System confirms inventory and capacity.
5. Checkout shows due-today and recurring totals.
6. Buyer verifies contact details, completes hosted payment and autopay consent.
7. Payment succeeds.
8. Account, subscription, and cart-delivery work order created atomically.
9. Buyer receives "Cart arrives Monday; first pickup is Tuesday" plus portal access.

Homeowner signup held for review
1. Buyer enters an address on a zone boundary.
2. System finds a probable match but cannot confirm private-road access.
3. Buyer sees a provisional complete price and estimated start date.
4. Buyer supplies contact, delivery instructions, optional driveway photo.
5. Payment method tokenized, no final charge.
6. Application enters an "access confirmation" queue with quote preserved 72 hours.
7. Buyer receives a response deadline and status link.
8. Staff approves or declines with a reason.
9. On approval, system charges payment and creates account and work order; no second conversation.

## Most important needs, ranked

1. Do you serve my address.
2. What will I actually pay, all in, first charge and recurring.
3. When can you start.
4. Can I finish without calling, and if not, a stated reason and a deadline.
5. Once signed up, pay and make routine requests without the office.
