# Synthesis: Billing and Pricing Product for TrashLab

Personas: 3 | Recommended v1: Frontload billing loop | Core review unit: Exception | AI posture: Draft, don't decide

## Core thesis

Waste billing is an operational-to-financial control loop, not an invoice generator. The product must connect commercial intent (what was sold), operational fact (what happened), and financial consequence (what was charged, paid, waived, or reconciled) with a reproducible audit trail.

## Persona priorities

| Persona | Top job | Must-have surface | Trust requirement |
|---|---|---|---|
| Office manager / CSR | Keep account, dispatch, billing, payments, and QuickBooks coherent | Account workbench + exception-based billing run + reconciliation | Every amount and sync state is explainable; corrections never erase history |
| Owner / GM | Protect margin without losing density or strategic accounts | Rate simulator/publisher + quote workbench + annual increase command center | See blast radius, assumptions, contracts, before/after invoices, and rollback path |
| Prospective / existing customer | Get reliable service at a known all-in price without unnecessary calls | Address-first offer + honest checkout + billing/payment portal + tracked requests | Never promise price or start date until serviceability, capacity, inventory, and policy pass |

## Build priority is a dependency order, not a value judgment

1. Establish trustworthy operational and financial truth for the office.
2. Give the owner safe pricing control.
3. Expose deterministic pieces to customers.

Public signup built before the underlying service, pricing, inventory, and work-order APIs are reliable will create polished operational failures.

## Narrowest coherent v1

Recurring commercial frontload billing for existing accounts, plus common exceptions. It exercises customer-specific pricing, contracts, effective-dated service changes, extra lifts, blocked access, contamination, field evidence, batch billing, payments, and QuickBooks, without also taking on rolloff true-ups, residential serviceability, or specialized sanitation/scale billing.

1. Model commercial truth: customer, payer, site, active service, container requirement, contract, effective-dated rate.
2. Connect operational facts: consume completed service events, photos, tickets, weights, and exceptions from existing TrashLab workflows.
3. Create charge candidates: generate recurring and exception charges with provenance; flag uncertainty.
4. Review and post: bulk-approve clean invoices; review individual exceptions; post immutable invoices.
5. Collect and reconcile: allocate payments, split processor deposits, sync posted events to QuickBooks, and surface conflicts.
6. Serve customers minimally: invoices, receipts, payments, autopay, and request status in the portal.

## Do not build yet

All lines of business at once; autonomous broad price changes; automatic contract interpretation; a general ledger; silent two-way QuickBooks sync; commercial/rolloff instant signup; fully autonomous credits, write-offs, disputes, or suspension; deep optimization before cost and route data are trustworthy.

## Shared product foundation

- Commercial spine: Party → billing account/payer → site → service agreement → effective-dated service/rate versions
- Operational spine: Work order → service event → evidence/ticket/weight → charge candidate
- Financial spine: Charge → immutable invoice line → payment allocation → processor settlement → accounting sync
- Pricing: composable rate components, explicit precedence, scoped exceptions, immutable quote/invoice snapshots
- Accounting boundary: TrashLab owns the operational subledger; QuickBooks owns GL, closed periods, bank reconciliation, tax reporting, and financial statements
- Payment boundary: processor owns tokenization and execution; TrashLab stores references, consent, status, allocations, and reconciliation metadata

## Non-negotiable invariants

- Never overwrite commercial history; effective-date rates, services, schedules, payers, contracts, and asset assignments.
- Price invoices using the rule version applicable on the service date.
- Every non-recurring charge retains source evidence and calculation lineage.
- Posted invoices are immutable; correct with controlled credits/adjustments.
- Payment receipt, allocation, settlement, return/refund, and reconciliation remain distinct.
- Waived charges remain measurable with structured reasons.
- External sync is idempotent and conflicts are visible.
- Agents may draft and explain; rules or humans authorize commitments.

## Recommended build sequence

- Phase 0: Validate the wedge and source-of-truth map. Observe a real billing run, service change, disputed charge, unmatched payment, and QuickBooks reconciliation.
- Phase 1: Canonical account/service model. Party, payer, site, service versions, statuses, audit history, migration, and export.
- Phase 2: Pricing kernel and safe publish. Rate versions/components, eligibility, precedence, surcharges/taxes, contract overrides, invoice previews, and blast-radius controls.
- Phase 3: Operational events to exception billing. Charge candidates, evidence review, batch approval, waive-with-reason, immutable posting.
- Phase 4: Payments and reconciliation. Many-to-many allocation, returns/refunds, processor batches, QuickBooks IDs/conflicts, and daily control totals.
- Phase 5: Account workbench and minimal portal. One-glance support view plus customer billing, payment, receipts, and autopay.
- Phase 6: Deterministic service requests and signup. Only expose actions when eligibility, price, capacity, inventory, fulfillment, and idempotency are dependable.

## Highest-value validation before committing scope

- Which single line of business creates the most billing effort, disputes, and missed revenue?
- Show the last service change end to end. Where did systems diverge?
- Show the last missed charge and last disputed invoice. What evidence was absent or decisive?
- What exceptions must a human review, how many occur per cycle, and what dollars are at issue?
- What is the real rate precedence when standard, zone, contract, site exception, and salesperson promise conflict?
- Which system owns AR today, and which system wins when TrashLab and QuickBooks disagree?
- What proof and reconciliation behavior would let the office retire the shadow spreadsheet?
- For signup, which serviceability, inventory, route-capacity, tax, and start-date checks are truly authoritative?

## Persona sub-cases (test scenarios, not separate personas)

Prospective customer: homeowner who completes instantly; homeowner whose address is franchise/HOA and gets a hard stop; bakery that ends at a structured quote request; contractor ordering a box on an existing account.

Pricing modeler: annual increase; new zone; one negotiated commercial contract.

Account tracker: mid-cycle cart add; rolloff overage after the ticket arrives; lump processor deposit to reconcile.

## Where the three surfaces pull against each other

- Price by street vs price you can publish. Zones carry the density judgment; the storefront shows the price for the matched zone only; the owner decides which zones and services are public. Commercial stays behind a quote request.
- Structure vs the ad hoc deal. Exceptions are explicit, scoped, dated, and measured against the ratebook. Too much friction at quote time sends the owner back to Excel.
- Bill every exception vs protect the relationship. The review queue makes the decision visible and cheap; waive with reason turns judgment into data. The human stays in the loop on relationship-sensitive charges by design.
- Effective-dated changes vs "we don't prorate." Proration is a per-hauler policy on the billing cycle, not a product default.
