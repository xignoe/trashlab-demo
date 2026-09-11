# Shared contract addendum (normative)

Written 2026-09-10 at the mid-build check-in, after Phase 3 of every surface. This file extends prompts/SHARED_CONTRACT.md. Where the two disagree, this file wins. Where a surface's DECISIONS.md disagrees with this file, this file wins and the surface records the change in its DECISIONS.md at its next phase. Evidence for every item is in DECISIONS_SYNTHESIS.md.

Every agent reads this file before resuming. Nothing here requires stopping a phase in progress. Items marked "next phase" are applied at the start of the surface's next phase. Items marked "polish" are applied only in the surface's final phase. Items marked "merge" are done by the merge agent (prompts/06-merge.md) and no surface should attempt them.

## A. Canonical files in shared/

| File | Rule |
|---|---|
| shared/types.ts | Every surface src/types.ts must be identical below the header. Today they are identical except deliveredVia (see B4). |
| shared/tokens.css | The design token set the merge will use. Adopt at polish only. |
| shared/OWNERSHIP.md | Who owns which entity, screen, and flow. Do not build a screen or write an entity you do not own. |
| shared/STATUS.md | Generated. Do not edit. |
| shared/DECISIONS_SYNTHESIS.md | Evidence. Read if you want to know why. |

## B. Types

1. Money is integer cents. Dates are ISO 8601 strings. This includes Contract.escalator.anniversary, which is a full date such as "2027-01-01", never "01-01". (next phase: storefront, account, portal seed)
2. Invoice.deliveredVia is the union 'email' | 'mail' | 'portal', matching BillingAccount.deliveryMethod. (next phase: storefront, portal)
3. No surface adds fields to a contract entity. Surface-local data lives in surface-local tables or sidecars (Storefront addresses.json, Portal holds, Account edits). These stay local and are not part of the merge store.
4. Exception rates are a seed file, src/seed/eventRates.json, with the billing values: extraBags 250, overload 1000, contamination 2000, dryRun 2500, extraPickup 2500 (portal's value, ruled canonical in K6). Not engine constants. (next phase: account)

## C. Engine

1. billing/src/store/engine.ts is the canonical engine. At merge every other engine.ts is deleted and every surface routes through billing's. Until merge, each surface keeps its own engine but must not change any signature below and must not diverge on the rules in this section.
2. Signature shape: the contract's first argument object stays exactly as written. State is an optional trailing parameter that defaults to the live store. Example: resolvePrice(args, state = live()). Five surfaces already do this. Billing does it through withEngineDb; at merge billing exposes the trailing-parameter form.
3. resolvePrice precedence: contract override for this account and catalog, only when onDate is within termStart..termEnd, then published RateVersion matching zone and frequency, then published RateVersion with no zone, then throw. Use the version whose effectiveFrom is latest but not after onDate.
4. RateVersions for residential carry a zoneId. zone_boundary has its own rows and its own higher price. The no-zone RateVersion is the fallback for zones with no seeded row, not the normal path for a named zone. (next phase: storefront regenerates residential rate rows per pricing's scheme; billing and portal already match)
5. Flat fees on multi-month charges apply once per whole month in the charge's period. Quarterly 96 gal carries fee_env_1 at 300. Maple's quarterly recurring total is 10261. (next phase: portal seed)
6. Rounding: Math.round on cents, half up, applied after each percentage step.
7. fee_env_1 is never taxed (taxable false). Late fees are never taxed. fee_fuel_7pct is taxable. fee_env_1.base is serviceLines. (next phase: pricing seed)
8. TaxRules: one per taxed zone (zone_open, zone_boundary, zone_franchise) at 7% with appliesTo recurring, event, fee. None for zone_notserved. (next phase: account, portal seed)
9. Invoice due dates: net30 is issuedAt + 30 days. Monthly and quarterly are issuedAt + 15 days. (next phase: account)
10. Invoice.number format is INV-2026-#### sequential across the hauler. Seed entity ids may differ per surface until merge; the merge regenerates derived tables from billing's generator. (merge)
11. ruleWon: manualException for hand-set amounts, standardRate for catalog-formula lines such as rolloff overage and extra days.
12. Runtime-created ids carry a surface infix so they can never collide at merge: party_sf_0004 (storefront), req_p0001 (portal), chg_bl_0001 (billing), and so on. Counters start above the highest seed id. (next phase: billing, account)
13. New signup first period. Storefront bills startDate to startDate + one cycle and writes those Charges as approved with a Payment. The next generateRecurringCharges run must skip any ServiceItem whose approved charges already cover the cycle, post the approved charges into the account's first Invoice, and allocate the signup payment. Nobody has built this. Kevin assigned it to billing (section I3). Billing completed its checklist before the assignment landed, so it is a billing follow-up dispatch, not a merge task. (next phase: billing)
14. generateRecurringCharges runs on calendar cycle dates (monthly on the 1st, quarterly on Jan 1, Apr 1, Jul 1, Oct 1). Period is cycleDate to cycleDate + cycle length. Proration is none per hauler policy.

## D. Seed

1. Top-level ids are shared and already agree across all five surfaces: 45 accounts, 8 catalog items, 4 zones, 4 routes, 2 quotes, 2 fee rules. Do not rename any of these.
2. Derived tables (rateVersions, serviceItems, containers, sites beyond the first 39, invoices, charges, payments, events, tickets, work orders, requests) have surface-specific ids today. That is accepted until merge. Do not spend a phase reconciling them by hand.
3. Seed file names: camelCase plural, matching the contract's entity names (accounts.json, rateVersions.json, feeRules.json). Account uses kebab-case names today. Account keeps them until polish, then renames. (polish: account)
4. zone_franchise.franchiseFeePct is 17. (next phase: account)
5. Extra pickup is an event exception priced from eventRates.json, not a catalog SKU. Portal's cat_res_extra_pickup is retired at portal's next phase; portal's extra pickup request creates a WorkOrder of kind extraPickup and, when eligible, a Charge with lineType event and source type manual. (next phase: portal)
6. quote_held_ridge.dueTodayCents is what storefront's checkout computes for the seeded lines. Other surfaces display whatever storefront computes; they do not invent the number. Storefront is the source. (merge)

## E. Clock and time

1. src/store/clock.ts exports TODAY = '2026-09-10'. No new Date() in business logic. Timestamps use Eastern daylight time, -04:00. Billing keeps its TODAY inside engine.ts until polish, then moves it to clock.ts. (polish: billing)

## F. Design

1. shared/tokens.css is the canonical token set. It carries the values read from the Paper file with get_computed_styles. Variable names use the --tl- prefix.
2. No surface restyles mid-phase. At polish, storefront, portal, and pricing adopt shared/tokens.css, keeping their existing variable names as aliases that point at the --tl- values so component code does not change.
3. Paper artboards: the Paper MCP is rate limited and only the manager session can call it. Do not dispatch a subagent to Paper. If a checklist box needs Paper, the manager does that box itself or leaves it unticked with the note "Paper: manager". Do not stall on it.

## G. Ports and running

Fixed dev ports. Start with --port N --strictPort so a busy port fails loudly instead of drifting.

| Surface | Port | Entry path |
|---|---|---|
| storefront | 5173 | / |
| portal | 5175 | / |
| billing | 5179 | /billing |
| pricing | 5180 | /pricing |
| account | 5199 | /account |
| check-in hub | 5170 | / |

checkin/start.sh starts all six. .claude/launch.json has a "checkin" configuration that does the same.

## H. Process rules for the remaining phases

1. Work only inside your surface folder. Never write into another surface folder or into shared/. If you need something changed in shared/, write the request in your DECISIONS.md under a heading "Requests for shared/" and continue.
2. Tick boxes as you go and run scripts/build_dashboard.py so shared/STATUS.md can be regenerated by the check-in script.
3. Before reporting a phase done: npm run build and npm test pass from your folder.
4. No em dashes anywhere.

## I. Decisions by Kevin, 2026-09-10 evening

Answers to the four open questions in DECISIONS_SYNTHESIS.md section 4.

1. Contract lapse: contracts auto-renew. When onDate is past termEnd, resolvePrice treats the contract as renewed for another term of the same length, with the escalator applied on its anniversary. No human step. The account view may show "auto-renewed on <date>" as the price source detail. (next phase: pricing, account; billing engine at its follow-up)
2. Unapplied cash: pay_chk_oakridge and batch_0908 ship pre-allocated in seed. The demo does not depend on a live allocation step. Billing's payments tab already shows both allocated. (next phase: account, storefront seed)
3. Storefront first-invoice handoff (C13): billing owns it. Dispatch it to billing as a follow-up phase: skip ServiceItems whose approved charges already cover the cycle, post the approved charges into the account's first Invoice, allocate the signup payment. Prove it in billing's RUNBOOK.md.
4. Contract cent figures (batch_0908 gross 131842, fees 4120, past due 8745, and similar) are illustrative. Seeds need not hit them to the cent. Billing's current seed hits them and may keep doing so; no other surface should spend a box on it. (all surfaces)

## J. Billing is complete (2026-09-10 evening)

Billing reported 76 of 76 boxes, 220 tests, clean install verified. Its engine is canonical (C1). Two stubs are labeled on screen for the merge to route to their owners: publishRateVersionStub (pricing) and applyUnappliedStub (account), in billing/src/store/stubs.ts. Not built in billing: late fee generation, QuickBooks sync, the C13 handoff (now a billing follow-up per I3). Billing's Paper artboards are "Billing run, Office" (node P2-0) and "Billing payments, Office" (node XV-0).

## K. Rulings on hand-off requests, 2026-09-10 evening

Pricing, portal, and account all reported complete (88/88, 93/93, 108/108, clean installs, tests and builds pass). Their "Requests for shared/" are ruled here. Nothing below requires a completed surface to reopen; every item tagged (merge) is done by the merge agent.

1. Zone.publicPricing (pricing request 1): pricing owns the write on Zone.publicPricing. It is the only runtime write on Zone. OWNERSHIP.md is updated. Keep setZonePublicPricing as built.
2. Clock file name (pricing request 2): pricing keeps src/store/dates.ts. The merge collapses every clock into one src/store/clock.ts. (merge)
3. Lapsed contract on write (pricing request 3, decisions 74 and 80): ruled canonical and compatible with I1. Read side: resolvePrice auto-renews a lapsed contract (I1). Write side: a new override or escalator on an account whose contract term has ended opens contract_<accountId>_<yyyymmdd> and repoints the account; the ended contract stays as history and is never written to.
4. Account-to-contract link (pricing request 4): account is complete and does not reopen. The merge wires linkAccountToContract to account's store. (merge)
5. --tl-border clash (pricing request 5): shared/tokens.css keeps --tl-border as a border shorthand. Pricing's color token is renamed --tl-border-color at merge. (merge)
6. extraPickup rate (portal request 1): 2500, added to B4. Portal's local value is now the canonical one.
7. Payment reference for check and ACH numbers (account request): types.ts stays frozen through the merge. Account's sidecar stands. If the merged runbook needs a check number on screen, the merge agent adds an optional reference field to Payment and records it here. (merge)
8. Late fee generation (billing entry 42) and QuickBooks sync stay out of the MVP.

## L. Merge notes collected from the hand-offs

- Seed totals moved after the C5 reseed in every surface that reseeded. Per I4 these figures are illustrative: portal's batch_0908 is 2 cents short on one invoice, billing's leaves 1200 cents open on another, account's Oakridge invoices cover May to July only under C14. The merge regenerates every derived table from billing's generator (D2) and does not chase cents.
- Account seed file names still differ (serviceCatalog.json, paymentAllocations.json, haulers.json). Rename at merge.
- Sidecars the merge routes to their owners: account officeNotes (cart change, vacation hold) to portal Requests; account proposedCharges (reinstatement fee) to billing Charges; portal holds, pendingChanges, quoteRequests to account and storefront; portal's approved extra pickup Charge and unallocated Payment to billing's next post; billing's publishRateVersionStub to pricing and applyUnappliedStub to account; pricing's linkAccountToContract to account.
- Storefront first-invoice handoff is a billing follow-up (I3), not started.
- React Router 6 has 4 moderate npm audit advisories; the fix is a breaking upgrade to 7. Decide at merge.
- Paper artboards by surface: billing P2-0, XV-0; pricing IA-0 (older look), 13E-0, 17F-0, 1BW-0; portal 1FE-0 to 1FH-0 at y 3500; account D3-0. Storefront pending.
- Ticking checklist boxes rewrites dashboard.html inside a Vite-watched folder and reloads the running app, wiping demo state. Walk a scenario first, tick after.

## M. Storefront hand-off, 2026-09-10 evening

Storefront reported 110 of 110, clean install, 62 tests, build clean, 5173 with strictPort. All five surfaces are now complete. Verified by the check-in.

Recorded facts:
- quote_held_ridge.dueTodayCents is 13623 (D6). Other surfaces display this value at merge.
- Storefront's Paper file is separate: "TrashLab Storefront", fileId 01M26F99HT7HE6DJN4SE0FBQ89, nine artboards. Phase 7 references are "Landing, trashlab.com language" and "Offer, trashlab.com language".
- Paper gotcha for anyone drawing artboards: text nodes do not inherit fontFamily from the artboard. Set the font on each text node and verify with get_computed_styles on a text node.
- pricing's residential publishedAt values carry no time zone offset. E1 requires -04:00. (merge)
- .claude/launch.json: autoPort removed everywhere, storefront-dev now passes --port 5173 --strictPort.

Open decision for Kevin (not ruled here, it changes the look of four finished surfaces):
- Kevin directed the storefront to follow trashlab.com's design language. It now uses values shared/tokens.css does not have: cyan #10A6CC for eyebrows, brand deep #201A69, section ground #F6F7FB, card border #E2E8F0, 48/60 display and 40/50 title, 32px radius, pill buttons at 50px and 44px. Two names collide with shared: --tl-brand-deep (shared #2F2A90, site #201A69) and --tl-cyan (shared #10D6E6, site #10A6CC). Details in storefront/DECISIONS.md entry 97 and storefront/docs/trashlab-design-language.md. Options: (a) the merge keeps the Paper tokens (F1) and the storefront alone reads as trashlab.com, which is defensible since it is the public page; (b) the merge repoints shared/tokens.css to the trashlab.com values so every persona matches. Until Kevin picks, F1 stands and the merge does not restyle.
- The cyan eyebrow is below WCAG AA (2.67:1 on light ground, 3.76:1 on indigo). Storefront kept it because trashlab.com uses it and every eyebrow's meaning is repeated in dark text. Kevin decides whether the merged app keeps it.

## N. Commercial instant estimate, 2026-09-11

Kevin ruled that the storefront gives business buyers an instant estimate, and approved widening the shared catalog for it.

- B: Frequency gains '4x', '5x', '6x' (shared/types.ts and src/types.ts, identical). Every Record<Frequency> and frequency list in the merged app carries them (store engine, account, pricing FREQUENCIES, costToServe liftsPerMonth 17.33 / 21.67 / 26, ratebook order).
- D: catalog appends cat_fl_4yd, cat_fl_6yd, cat_fl_8yd, cat_ro_10yd, cat_ro_30yd, cat_ro_40yd, and cat_ro_compactor_30yd (rolloff lob, no rate: always priced by a person). scripts/gen_seed.ts is the source; regenerating moved only catalog.json and rateVersions.json.
- D: 12 published zone_open RateVersions for the new sizes (4, 6, 8 yd at weekly, 2x, 3x; 10, 30, 40 yd on call), publishedAt PUB_2026. 25 published in the seed now. The 2 yd and 3 yd rows are unchanged on purpose: scenario 3 depends on the bakery's 3x request having no published 3x rate.
- Storefront: a commercialRequest Quote may now carry several lines and estimated unit prices (priceCents > 0) where the published rate card covers them, with recurringCents as pricing's sum of priceCents x qty. It stays a draft; the quote workbench confirms or replaces each line through priceCommercialRequest. Lines with priceCents 0 still need a person.
- Amended later on 2026-09-11: Kevin ruled that business buyers see no price. The commercial form and its receipt show no estimate; the buyer sends a request and a person sends a written quote. The store still writes the rate-card priceCents onto the draft Quote so the workbench starts from them. Residential is unchanged and keeps showing prices. Only src/surfaces/storefront is updated; the standalone storefront/ copy is not.

## O. More portal request kinds, 2026-09-11

Kevin asked the portal Requests page to cover more requests and to add an "Other" option.

- B: Request.kind gains 'damagedCart', 'bulkyItem', 'addCart', 'stopService', 'billingQuestion', 'other' (shared/types.ts and src/types.ts, identical). Both Record<Request['kind']> label maps carry them (portal OpenItems KIND_LABEL, account REQUEST_KIND_LABEL).
- The new kinds are always handled by a person. The portal files one Request with status open, createdVia portal, no work order, and a note of the form "<choice>; <date label> <date>; <free text>" (parts left out when empty). Nothing is charged or scheduled. 'addCart' is offered to residential accounts only; 'billingQuestion' and 'other' need free text.
- No engine, seed, or store change. The standalone portal/ copy is not updated.

## P. Billing groups, invoice delivery, and staggered cycles, 2026-09-11

Kevin asked for billing groups (customers billed together), a record of how each customer wants invoices, and a way to manage the cycle (monthly or quarterly).

- B: new BillingGroup { id, name, cycle 'monthly' | 'quarterly', quarterStartMonth? 1 | 2 | 3, termsDays, defaultDelivery, note? }. BillingAccount gains billingGroupId?. New InvoiceDelivery = 'email' | 'mail' | 'text' | 'portal' for BillingAccount.deliveryMethod and Invoice.deliveredVia ('text' is new). shared/types.ts and src/types.ts identical.
- D: new table billingGroups (Seed, emptyDb, scripts/gen_seed.ts). Seeded: grp_res_quarterly (Jan, Apr, Jul, Oct; 23 accounts), grp_res_quarterly_feb (Feb, May, Aug, Nov; empty, shows staggering), grp_res_monthly (10), grp_commercial_monthly (9). Net 30 and per job accounts stay ungrouped. Regenerating moved only accounts.json (billingGroupId added) plus the new file; every seeded account bills on the same dates as before.
- C: a member's cycle is its group's cycle. store/cycles.ts cadenceOf(account, groups) adds the group's quarterStartMonth, and isDue, priorCycleDate, nextCycleDate take that cadence. Callers that have a db pass cadenceOf: generateRecurringCharges, dueCadenceLabel, billing's prior-cycle comparison, account's next-run preview and service change preview, pricing's invoice preview. postInvoices dates an invoice due at the group's termsDays (engine invoiceTermsDays), else 30 on net30 and 15 otherwise, as before.
- Account slice (the office owns BillingAccount): saveBillingGroup, assignBillingGroup, setInvoiceDelivery, applyGroupDelivery. A change to an account's bill dates is refused while it has recurring charges generated and not posted (post or cancel the run first). There is no delete: the account slice never deletes, so an empty group stays and can be renamed or reused.
- Bridge charges: a move that would leave whole months unbilled (a quarterly account paid through Sep 30 joining the February group next bills Nov 1) proposes one recurring Charge per active line for the gap, priced by resolvePrice and computeCharge, id chg_ac_, description "Bridge to <group>: ...", on no invoice and in no run, so billing's next run takes it into its queue. A later move replaces that account's still-proposed bridge charges; an approved, waived, or posted one is never touched (invariant 5 holds). Lines never billed, or paid through mid-month, follow the hauler's proration policy.
- UI: Office > Billing groups at /office/groups (bill calendar, one card per group with cadence, next bill, terms, delivery mix, members; accounts not in a group). The account page's side column gains a Billing card (group, cycle, next bill, invoice delivery).
- Run one group on its own (later the same day): billing's runCycle, bulkApproveClean, and post take an optional { groupId } and then touch only that group's members (their recurring, event, and intake charges). RunRecord gains groupIds (groups run on their own) and ranAll (false while only some groups have run; a full run sets true). store/selectors uncoveredDueAccounts lists accounts due on the cycle date that no run has covered; advanceCycle refuses while any remain, and the Accounts cycle button offers "Run the rest of <date>" instead of Next cycle. Each group card on /office/groups runs, approves clean charges, and posts invoices for its group; items needing a person are decided on the account pages as before.
- Portal: the Billing screen gains "How you get your bill": the schedule from the customer's group (cadence, next bill date, days until due) and a choice of email, text, printed mail, or portal only, written by the portal slice's portalSetDeliveryMethod (BillingAccount.deliveryMethod only, logged like setAutopay). The portal's nextCycleStart and nextInvoicePeriod take the billing groups so a February start group reads Nov 1.
- Not done: accounts have no email or mobile number on file, so text and email delivery record the preference only. Bill day is always the 1st.

## Q. Billing group schedules, group delivery, and bulk membership, 2026-09-11

Kevin asked for billing groups built around three things: how the group's invoices go out, how often it bills (any start day, weekly, daily), and who is in it (add by zone, customer type, and so on).

- B: BillingGroup is now { id, name, schedule: BillingSchedule, termsDays, delivery: InvoiceDelivery, customerChoice, note? }. BillingSchedule = { frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly', every, startDate }; the start date anchors the weekday or day of month (the 29th to 31st clamp to a short month's end). cycle, quarterStartMonth, and defaultDelivery are gone. BillingAccount.cycle gains 'daily' and 'weekly' (a member's cycle is its group's frequency). shared/types.ts and src/types.ts identical.
- C (store/cycles.ts): CadenceOf carries the group schedule; isDue, periodFor (through the day before the next bill), priorCycleDate, nextCycleDate, billDateOnOrAfter follow it. billingFactor: months of the monthly rate one bill charges (quarter 3, month 1, week 12/52, day 12/365, times every). generateRecurringCharges bills round(price x qty x billingFactor) over periodFor(cadence). flatFeeMonths: whole months for a period of a month or more (as wholeMonths), days x 12/365 for a shorter one; computeCharge uses it and feeRuleCents rounds after the multiplier (unchanged for whole months). scheduleText says a schedule in words. Every seeded group bills on the 1st, so every seeded charge, invoice, and scenario is unchanged.
- Runs: store/selectors nextRunDate is the earliest date any account bills; advanceCycle moves there (the clock moves a month for a month, the same days otherwise) and the Accounts button reads "Next cycle, <that date>".
- Delivery: when customerChoice is false every member uses the group's delivery (saving switches them, joining takes it), and the account slice's setInvoiceDelivery and the portal's portalSetDeliveryMethod refuse another method.
- Membership (surfaces/account/lib/billingGroups.ts): accountFacts and matchAccounts filter by zone, customer type (party kind), service (LOB of the account's service and routes), route, current group, and name or address. Account slice: saveBillingGroup (planGroupSave), addAccountsToBillingGroup (planAddToGroup: skips, with the reason, accounts whose dates would change while they have unposted recurring charges), assignBillingGroup(id, group | null) (planTakeOut), setInvoiceDelivery, applyGroupDelivery. Bridge charges cover any gap, prorated by days when under a month.
- UI: /office/groups lists every group in a table built for hundreds (search, frequency filter, sort on every column, 25 a page; a row opens the group), and under it a table of customers not in a group, each with "add to a group". A group's page (?group=<id>, ?group=new to create) has a back link and three numbered sections: 1 how they get invoices, 2 how often, 3 who's in it (members, Add accounts with filter chips). A save bar previews what a save does (accounts moving, bridge charges, delivery switches) before it runs. Pricing's cycles section reads the schedule through scheduleText.
- Removing a group (Kevin's ask): account slice deleteBillingGroup(groupId, moveTo | null) moves the members to another group or out of any group (planRemoveGroup, with bridge charges where needed; refused while a member has unposted recurring charges), then drops the group row. It is the one delete in the account slice; the slice test that forbids delete names allows exactly this action, since a group is configuration and no financial record is removed.
- Known: cancelRun undoes the whole cycle date's run, including a group run followed by "Run the rest" (noted by the billing run session). Bill runs stay one per date; a daily group means a run every day.

## R. Office approvals answers every quote; Store inspector removed, 2026-09-11

Kevin asked to drop the Store inspector and to act on every approval, including the seeded quote_bakery_request, from /office/approvals.

- The Store tab and src/surfaces/storefront/ui/StoreInspector.tsx are gone; the storefront Screen type no longer has 'store'. /office/approvals/store and /customer/store/office/store redirect to /office/approvals.
- A commercialRequest in draft is answered on the page: the office writes a monthly price per line (prefilled from the Quote's priceCents or the published rate card, which is shown beside it) and sends it. Storefront's sfSendCommercialQuote writes the prices through pricing's priceCommercialRequest and stamps QuoteIntake.quotedAt and quotedBy (new optional intake fields). The Quote stays draft; the page shows "Price sent".
- The customer's answer is recorded next: sfAcceptCommercialQuote accepts the Quote. A new customer gets a business Party, a monthly BillingAccount, a Site (address book route, else the first route for the service), ServiceItems, containers, and deliver WorkOrders on the start date. An existing customer at the address (the bakery) keeps its account and the page links to it for a service change. Either way each written price goes onto the account's contract through pricing's saveContractOverride, so billing charges what was quoted (including lines with no published rate). QuoteIntake.acceptedAccountId names the account.
- Decline works on a held signup and on an open commercial request, before or after the price is sent (planDecline).

## S. Where invoices go, 2026-09-11

- BillingAccount gains optional invoiceEmail, invoicePhone, and mailingAddress: the destination for deliveryMethod email, text, and mail. shared/types.ts and src/types.ts identical.
- Portal: portalSetDeliveryMethod takes an optional contact and refuses email, text, or mail when none is given or on file (DECISIONS.md entry 70). The office's setInvoiceDelivery is unchanged.
