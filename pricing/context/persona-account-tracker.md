# Persona: Account Tracker (office manager or CSR)

The office manager's job is not "billing." It is maintaining a coherent story across customer promises, field reality, invoices, payments, and accounting, while the phone keeps ringing. Most waste comes from reconstructing that story after the fact.

## A typical day and billing-run week

Typical day

Morning: establish what actually happened. Read driver texts, paper notes, dispatch comments, voicemail. Resolve "not out," blocked access, contamination, extra material, overweight loads, swaps, missed service. Match scale tickets or disposal receipts to the correct customer, site, container, and job. Decide which exceptions require a return trip, a customer call, or a charge.

Throughout the day: interruption-driven account work. Answer "What do I owe?", "Why did my price change?", "When is my dumpster coming?" Change service frequency, swap containers, update access instructions, suspend service, promise a credit. Repeat the same change in dispatch, the billing system, QuickBooks, and sometimes a spreadsheet. Record enough context so another CSR can understand the promise.

Afternoon: money and cleanup. Open checks, identify accounts from memo lines, post payments, handle partial or combined payments. Investigate processor deposits that combine dozens of payments minus fees, refunds, chargebacks. Call past-due customers without antagonizing a reliable customer whose check is in the mail. Correct yesterday's mismatches.

The hours go less to typing invoices than to investigation and judgment: identifying what happened, connecting records, deciding what is fair, and explaining it credibly.

Billing-run week. A typical run compresses several weeks of unresolved operational ambiguity: confirm active services, quantities, frequencies, rates, taxes, periods; find service changes that dispatch implemented but billing did not, or vice versa; match tickets, weights, haul events, disposal fees, POs; review exceptions and decide which become charges; find missing, duplicate, unusual, or prorated charges; generate invoices, inspect high-risk accounts, send; answer the wave of questions; sync to QuickBooks and reconcile failures and processor deposits. A "four-hour billing run" often consumes two days because each ambiguity triggers a search across multiple systems.

## The single-account view

The first screen should answer, without interpretation:
- Financial: current balance, past due, unapplied credits, last payment, credit status, next invoice date, estimated next invoice.
- Sites and services: each location, containers, sizes, serials, frequency, service days, status, access instructions.
- Pricing: current price beside each service, effective date, and provenance (rate card, contract, negotiated override, promotion). Show the prior price and who changed it.
- Field history: recent services, missed attempts, exceptions, weights, tickets, driver notes, GPS/time evidence, photos.
- Customer commitments: open requests, promised callbacks, disputes, credits under review, scheduled changes, PO requirements.
- System state: whether dispatch, billing, autopay, collections, and QuickBooks are synchronized.

From that screen they should be able to: add, change, pause, resume, or end service with effective dates; schedule a container delivery, swap, removal, or extra pickup; change a rate with reason, authority, and future effective date; correct billing contacts, invoice delivery, PO numbers, terms, tax status; take and allocate a payment; issue or request a credit, waive a charge, resend an invoice, open a dispute, place a hold; see the operational and billing consequences before confirming. One action should create one coordinated change, not several tasks for the CSR to remember.

## The feared failure modes

- Billing/dispatch divergence: the customer changes service but only one system updates.
- Unsafe status divergence: service continues for a suspended account, or stops after payment.
- Unsupported charges: an exception fee reaches an invoice without a ticket, photo, timestamp, or intelligible note.
- Duplicate money: a payment is entered locally, imported from the processor, and synced again from QuickBooks.
- Wrong effective dates: a rate increase, cancellation, or container change billed too early or too late.
- Silent omissions: valid overweight, extra-haul, or contamination charges disappear because reviewing them was too difficult.
- Relationship damage: the system is technically correct but sends a $2.50 charge that costs a valuable customer.

The product must optimize for recoverability and explanation, not merely automation.

## The agentic billing run

The agent can complete deterministic work end to end: draft recurring charges from active services and effective-dated rates; prorate starts, stops, swaps, frequency changes; match scale tickets and disposal receipts to jobs; deduplicate field events and payment records; draft exception charges when evidence and policy agree; detect missing services, unusual quantities, price changes, duplicates, margin anomalies; import checks or processor transactions, propose allocations, split net deposits into gross, fees, refunds, chargebacks; produce invoices and accounting entries in draft.

Humans decide: ambiguous ticket matches; disputed or weakly evidenced charges; relationship-sensitive fees; contract interpretation and retroactive changes; large credits, write-offs, overrides, unusual allocations.

Review queue. The right unit is per exception inside a batch, not every invoice. The summary should say: "1,842 invoices; 1,706 clean; 103 changed from last cycle; 33 require decisions; $18,420 at issue." Queues: missing evidence; conflicting service state; unusual price or quantity; low-confidence ticket match; first invoice after a change; relationship-sensitive charge; payment or deposit mismatch. Each item needs proposed action, dollar impact, evidence, policy, confidence, customer context. Approve clean items in bulk; require individual decisions only where judgment matters.

Waive with reason should remain one click but require a reason taxonomy: goodwill, sales promise, insufficient evidence, operational fault, disputed policy, immaterial amount. Record the original potential charge and waived amount rather than deleting it. Report leakage by reason, account, employee, route, and service type.

QuickBooks boundary. The product owns the operational subledger: accounts, sites, services, rates, field evidence, invoice detail, payment allocation, deposit composition. QuickBooks owns the chart of accounts, general ledger, bank reconciliation, closed periods, tax reporting, financial statements. Push posted invoices, credits, payments, and deposit batches to QuickBooks with immutable external IDs. No silent two-way overwrites. If someone records a payment directly in QuickBooks, import it into a duplicate-check queue before changing balances. Reconcile totals daily and make every mismatch visible.

## Trust vs the shadow spreadsheet

They will abandon the spreadsheet when the system never loses effective dates, evidence, or promises; shows exactly why every amount exists; makes dispatch and billing state visibly consistent; reconciles to QuickBooks and processor deposits daily; supports corrections without erasing history; surfaces uncertainty instead of pretending confidence; lets them export everything.

They will keep a shadow ledger if changes disappear, sync status is vague, reports cannot reproduce invoice totals, automation posts irreversible decisions, or support cannot explain discrepancies.

## Most important needs, ranked

1. One screen that answers a customer call: services by site, price and where it came from, balance, next invoice, recent field events with photos, open requests.
2. A change made once lands in both billing and dispatch, with an effective date.
3. A billing run that surfaces only the items needing judgment, each with evidence and dollar impact, and lets everything else go in bulk.
4. Waive a charge in one click with a reason, so leakage is measured instead of invisible.
5. Payments and deposits reconcile to QuickBooks without duplicates or a shadow spreadsheet.
