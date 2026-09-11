# Shared contract
Every parallel build uses this exact contract. Do not rename, add to, or reinterpret it without writing the change to DECISIONS.md. Read context/synthesis.md and context/billing-pricing-research-brief.md before anything else.

## Conventions
- Money is integer cents. Dates are ISO 8601 strings. IDs are stable strings with the prefixes below.
- Stack: TypeScript, React 18, Vite, Tailwind (tokens as CSS variables), zustand for the store. No backend. Seed from JSON in src/seed/. Types in src/types.ts. Store and engine in src/store/.
- Copy src/types.ts and src/seed/ verbatim from this contract. Build your surface on top of them. Never edit types.ts locally.
- Prices are never stored on a ServiceItem. They are resolved on the service date by resolvePrice(). Fees and tax are computed when a Charge is created, not at invoice time, and the base is kept.
- No em dashes anywhere in UI copy or docs.

## src/types.ts
type LOB = 'residential' | 'frontload' | 'rolloff';
type Frequency = 'weekly' | 'eow' | '2x' | '3x' | 'onCall';
type LineType = 'recurring' | 'event' | 'fee' | 'lateFee';

Hauler { id; name; policy: { proration: 'none' | 'nextCycle' | 'daily'; lateFeeCents; lateFeeDay; graceMissedPickups; suspendAfterDays; reinstatementFeeCents } }
Party { id; name; kind: 'homeowner' | 'business' | 'contractor' | 'propertyManager' | 'hoa' }
BillingAccount { id; payerPartyId; cycle: 'monthly' | 'quarterly' | 'perJob' | 'net30'; billedInAdvance: boolean; autopay: boolean; paymentMethodOnFile?: 'card' | 'ach'; status: 'active' | 'pastDue' | 'suspended' | 'hold'; deliveryMethod: 'email' | 'mail' | 'portal'; taxExempt: boolean; contractId? }
Site { id; accountId; occupantPartyId?; address; zoneId; routeId?; accessNotes?; poNumber? }
Zone { id; name; serviceability: 'open' | 'franchise' | 'boundary' | 'notServed'; taxRatePct; franchiseFeePct; deliveryFeeCents; publicPricing: boolean }
Route { id; day: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri'; lob; stopSiteIds: string[]; capacityStops }
ServiceCatalog { id; lob; name; sizeLabel; unit: 'cart' | 'container' | 'box'; rolloff?: { includedTons; includedDays; extraDayCents; overageCentsPerTon }; public: boolean }
Container { id; serial; catalogId; siteId?; assignedFrom? }
ServiceItem { id; siteId; catalogId; qty; frequency; containerIds: string[]; effectiveFrom; effectiveTo?; status: 'active' | 'held' | 'ended' }
RateVersion { id; catalogId; zoneId?; frequency?; priceCents; effectiveFrom; status: 'draft' | 'published'; publishedAt?; supersedesId? }
FeeRule { id; name; kind: 'percent' | 'flat'; value; base: 'serviceLines' | 'allLines'; appliesTo: LineType[]; taxable: boolean }
TaxRule { id; zoneId; ratePct; appliesTo: LineType[] }
Contract { id; accountId; termStart; termEnd; renewalNoticeDays; overrides: { catalogId; frequency?; priceCents; reason?; pctBelowRateCard? }[]; escalator?: { kind: 'fixedPct' | 'cpi'; pct; anniversary } }
Quote { id; kind: 'residentialSignup' | 'commercialRequest'; address; zoneId?; lines: { catalogId; qty; frequency; priceCents }[]; dueTodayCents; recurringCents; status: 'draft' | 'held' | 'accepted' | 'declined' | 'expired'; holdReason?; holdDeadline?; expiresAt; paymentTokenId?; createdVia: 'storefront' | 'agent' | 'phone' }
WorkOrder { id; siteId; kind: 'deliver' | 'swap' | 'remove' | 'extraPickup' | 'recovery' | 'dumpAndReturn'; status: 'open' | 'scheduled' | 'done' | 'cancelled'; scheduledFor; serviceItemId?; containerId?; requestId?; completedAt? }
ServiceEvent { id; siteId; routeId; date; outcome: 'completed' | 'missed' | 'blocked' | 'skippedSuspended'; exception?: 'extraBags' | 'overload' | 'contamination' | 'dryRun' | 'notOut'; photoUrl?; note?; driver }
ScaleTicket { id; workOrderId; containerId; facility; material; grossLbs; tareLbs; netLbs; ticketedAt }
Charge { id; accountId; siteId; lineType: LineType; catalogId?; description; source: { type: 'serviceItem' | 'serviceEvent' | 'scaleTicket' | 'manual'; id }; period?: { start; end }; servicedOn?; baseCents; fees: { feeRuleId; cents }[]; taxCents; totalCents; pricing: { rateVersionId?; contractId?; ruleWon: 'contractOverride' | 'zoneRate' | 'standardRate' | 'manualException' }; status: 'proposed' | 'approved' | 'waived' | 'posted'; evidenceIds: string[] }
WaivedCharge { chargeId; reason: 'goodwill' | 'salesPromise' | 'insufficientEvidence' | 'operationalFault' | 'immaterial'; note?; by; at }
Invoice { id; accountId; number; chargeIds: string[]; subtotalCents; feeCents; taxCents; totalCents; issuedAt; dueAt; postedAt?; locked: boolean; deliveredVia }
CreditMemo { id; accountId; invoiceId?; cents; reason; by; at }
Payment { id; accountId; method: 'check' | 'card' | 'ach' | 'autopay' | 'cash'; cents; receivedAt; processorBatchId?; status: 'pending' | 'settled' | 'returned' }
PaymentAllocation { sourceType: 'payment' | 'creditMemo'; sourceId; invoiceId; cents }
ProcessorBatch { id; depositedAt; grossCents; feeCents; netCents; paymentIds: string[] }
Request { id; accountId; siteId; kind: 'extraPickup' | 'vacationHold' | 'cartChange' | 'missedPickup' | 'quote'; status: 'open' | 'scheduled' | 'done' | 'declined'; createdVia: 'portal' | 'phone' | 'agent' | 'storefront'; workOrderId?; note? }

## Engine functions (src/store/engine.ts). Same signatures everywhere. Implement only what your surface needs, but do not change the signature.
resolvePrice({ catalogId, frequency, zoneId, accountId, onDate }) => { priceCents; rateVersionId?; contractId?; ruleWon }
  Precedence: contract override for this account and catalog > published RateVersion matching zone and frequency > published RateVersion with no zone > throw. Uses the version whose effectiveFrom is latest but not after onDate.
computeCharge({ accountId, siteId, lineType, baseCents, servicedOn|period, source, catalogId? }) => Charge
  Applies FeeRules whose appliesTo includes lineType (percent fees use baseCents when base is serviceLines), then TaxRule for the site's zone on base plus taxable fees. Account taxExempt skips tax. Late fees are never taxed.
generateRecurringCharges({ cycleDate }) => Charge[]   (advance billing per BillingAccount.cycle, from active ServiceItems)
generateEventCharges() => Charge[]   (from ServiceEvents with exceptions and ScaleTickets where netLbs/2000 exceeds includedTons)
postInvoices({ chargeIds }) => Invoice[]   (sets locked true; posting is irreversible; corrections are CreditMemos)
allocate({ sourceType, sourceId, invoiceIds, cents[] }) => PaymentAllocation[]

## Canonical seed (src/seed/*.json). Every build ships these exact IDs so the merge works.
Hauler hauler_piedmont "Piedmont Disposal", open-market Southeast city. policy: proration none, lateFee $10 on day 5, grace 2 missed pickups, suspend after 30 days, reinstatement $25.
Zones: zone_open (open, tax 7%, franchise 0%, delivery $25, publicPricing true), zone_boundary (boundary, same fees), zone_franchise (franchise, publicPricing false), zone_notserved.
Routes: route_mon_res, route_tue_res, route_wed_fl, route_thu_ro.
Catalog: cat_res_96 ($29/mo weekly in zone_open), cat_res_64 ($26/mo), cat_res_extra_cart ($9/mo), cat_res_recycling ($12/mo eow), cat_fl_2yd, cat_fl_3yd ($220/mo at 2x), cat_fl_3yd_wood ($190/mo at 2x), cat_ro_20yd (haul $575, includedTons 3, includedDays 30, extraDay $7, overage $70/ton).
Fee rules: fee_fuel_7pct (percent 7, base serviceLines, appliesTo recurring and event, taxable true), fee_env_1 (flat $1, appliesTo recurring, taxable false).
Accounts (all in zone_open unless noted):
  acct_res_maple: homeowner, 96 gal + extra cart + recycling, quarterly in advance, past due $87.45, one extraBags event with photo.
  acct_res_holt: homeowner, 96 gal, autopay, on vacationHold.
  acct_res_kerr: homeowner, suspended, route stops show skippedSuspended.
  acct_bakery: "Sunrise Bakery", cat_fl_3yd 2x + cat_fl_3yd_wood 2x, contract override 10% below rate card with reason "competitive match", escalator 4% on Jan 1.
  acct_pm_oakridge: propertyManager, 4 sites, one invoice, net30, PO per site.
  acct_contractor_hale: contractor, net30, 3 rolloff boxes across 2 job sites, two ScaleTickets over the cap (net 8,400 lb and 7,100 lb on 3 ton caps).
  acct_ro_homeowner: one prepaid 20 yd, card on file, delivered 34 days ago.
Plus 30 generic residential accounts acct_res_001..030 on route_mon_res and route_tue_res, and 8 generic frontload accounts acct_fl_001..008 on route_wed_fl, half with contracts.
Payments: one check pay_chk_oakridge covering three Oakridge invoices; one ProcessorBatch batch_0908 of 14 card payments, gross $1,318.42, fees $41.20.
Field events for the last 14 days: extraBags (acct_res_maple), overload (acct_res_014), dryRun x2 (acct_fl_003, acct_contractor_hale), contamination (acct_bakery wood container).
Quotes: quote_held_ridge (residentialSignup, zone_boundary, held, reason "confirm private road access", deadline tomorrow 10am); quote_bakery_request (commercialRequest, draft).

## Design context via the Paper MCP
Paper Desktop must be open with the TrashLab design file loaded (MCP at http://127.0.0.1:29979/mcp). First: get_screenshot and get_computed_styles on the existing artboards and write the tokens (colors, type scale, spacing, radii, table and panel and pill patterns) to src/styles/tokens.css and DESIGN.md. For each screen: create_artboard, write_html the layout, get_screenshot to check it sits next to the existing screens as a TrashLab surface, then implement in code and screenshot again. If the Paper MCP is not reachable, write a neutral token set, note it in DESIGN.md, and continue; do not stall.

## Non-negotiable invariants (enforce in code, prove in the runbook)
1. Publishing a RateVersion never changes a posted Invoice.
2. Every Charge carries base, fees, tax, source, and ruleWon.
3. A ServiceItem change creates a WorkOrder and appears in the next generateRecurringCharges run.
4. Suspended accounts produce skippedSuspended events, never charges.
5. WaivedCharge rows are never deleted.
6. Allocation is many-to-many; a batch splits into gross, fees, and per-invoice allocations.
7. Agents draft; rules authorize; a human approves anything that moves money or touches a relationship.
