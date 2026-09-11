# DECISIONS.md: account view build

Every place this build chose between two reasonable models, with the options and the reason. Later phases append below. The shared contract wins whenever it speaks; these entries cover what it leaves open.

## Manager-level decisions

### App location and route
Options: build inside `trashlab/` next to the context docs, or as a sibling directory `account/` at the repo root. Chose `account/` at the repo root (`/Users/kevinquimbo/Projects/TrashLabWorkTrial/account`) because the merge brief expects five parallel prototypes (storefront, account, billing, pricing, portal) that later merge into one app at the root. The account view is served at `/account` and `/account/:accountId`; `/` redirects there.

### Fixed demo clock
Options: use the real wall clock, or a fixed TODAY. Chose a fixed `TODAY = '2026-09-10'` (a Thursday) exported from `src/store/clock.ts`, because seed dates ("last 14 days", "delivered 34 days ago", "next Monday") must stay stable for the runbook scenarios. Nothing calls `new Date()` for business logic.

### Contract shorthand expansion
Options: let each phase interpret the shorthand, or fix the expansion rules once. Chose to fix them in CHECKLIST.md (all dates are ISO strings, all money and weights are numbers, `escalator.anniversary` is `MM-DD`, `period` is `{ start, end }`). The contract says "escalator 4% on Jan 1", so `"01-01"` is the faithful reading. Nothing is added to types.ts.

### Flat fees on multi-month charges
Options: a flat fee applies once per charge line, or once per month covered by the line. Chose once per month in the period, because the contract describes `fee_env_1` as "$1/mo environmental fee" and a quarterly line covers three months. A single-day event charge carries the flat fee once, but `fee_env_1` only applies to recurring lines anyway.

### Maple's past due balance
Options: make the whole Q3 invoice past due (which would not equal $87.45 given three service lines), or make the past due balance $87.45 via a partial check. Chose a partial check `pay_chk_maple` allocated against `inv_maple_q3`, leaving exactly 8745 cents open. Partial payments are routine in the office and this keeps the contract's number.

### Oakridge check left unallocated in seed
Options: seed `pay_chk_oakridge` already allocated across the three invoices, or seed it settled and unapplied so the allocation is a live demo action. Chose unapplied, because the surface brief's scenario is "allocate pay_chk_oakridge across three invoices". The merge should keep whichever surface owns the payments run; the billing surface may seed it allocated.

### Kerr is seeded suspended
Options: seed Kerr active so the demo can suspend it, or seed it suspended as the contract says. Chose suspended (the contract wins) with two seeded skippedSuspended events. The drawer on Kerr opens in the Reinstate state; reinstating and suspending again flips the route stub live, and Maple can be suspended directly for the same demo.

### Hold versus suspension and billing
Options: a vacation hold pauses recurring charges, or charges continue. Chose that charges continue under a hold (Piedmont does not prorate, and small haulers do not credit vacation weeks), and stop entirely under a suspension (invariant 4). Both set active ServiceItems to `held` without touching effective dates.

### Event charge amounts
Options: leave exceptions unpriced until a later phase (so the "did you miss me" card could not show what an exception costs), or pick amounts now. The contract does not price exceptions. Chose loose bags 250 per event (Preferred Waste bills $2.50 per loose bag), overload 1500, contamination 2500, dryRun 2500 (research brief ranges), rolloff overage from the catalog (7000 per ton over 3 tons), extra days from the catalog (700 per day over 30). These are engine constants, easy to move to FeeRules later.

### Paper design context
Options: stop and wait for Paper Desktop, or build from the closest TrashLab-authored visual and retry Paper each phase. Chose to keep building. Paper Desktop was not running when the build started (the MCP bridge was up, but no app listened on port 29979 and `get_basic_info` returned "Could not find Paper"). Per the contract, tokens were derived from the CSS variables in `../trashlab/context/billing-flow-map.html` (the one TrashLab-authored visual in the context pack) and the fallback is recorded in DESIGN.md. Each phase retries Paper once.

## Phase 1

### Paper: reachable for basic info only
Options: treat Paper as unreachable and use the fallback tokens, or keep retrying until screenshots came through. `get_basic_info` on `01M24VYMM89TECB7A4ZC0WYY57` succeeded (two artboards, font Manrope, zero design tokens), but `get_tokens`, `get_screenshot`, and `get_tree_summary` all failed with "Weekly MCP limit reached, resets tomorrow". Chose the fallback token set from `billing-flow-map.html` as the checklist directs, recorded the exact outcome in DESIGN.md, and did not adopt Manrope because the flow map is the closer reference for an office tool. Phase 3 retries once.

### Seed generator writes every seed file
Options: hand-write the focus accounts as JSON and script only the 30 residential and 8 frontload generics, or generate everything from one script. Chose one script (`scripts/gen_seed.mjs`) that also builds the focus accounts, because it computes fee and tax arithmetic in one place and the invoice totals cannot drift from their charges. The JSON is the committed artifact; the script is the audit trail and is run once.

### `Invoice.deliveredVia` type
Options: `string`, or the same union as `BillingAccount.deliveryMethod`. The contract gives no type. Chose `'email' | 'mail' | 'portal'` because an invoice is delivered by the account's delivery method and a free string would let the two drift.

### PaymentAllocation and WaivedCharge in the keyed store
Options: force every entity into `Record<id, entity>` by synthesizing keys, or keep the two id-less contract types in their natural shape. `PaymentAllocation` has no id and one payment may legitimately hit one invoice twice, so it is an append-only array `paymentAllocations: PaymentAllocation[]`. `WaivedCharge` is keyed by `chargeId` (one waiver per charge) with the store row carrying `id = chargeId`; types.ts is untouched. Selectors filter the array.

### Generic residential accounts are quarterly, and the card batch pays Q3 late
Options: bill the generics monthly (then 14 card payments of about $94 each fit nothing in the seed) or quarterly like Maple (a 96 gal quarter is exactly 10261 cents). Chose quarterly. `batch_0908` is 12 full payments of 10261 plus two partial payments of 5000 and 3710 on `acct_res_007` and `acct_res_022`, which sum to exactly 131842 and leave those two accounts genuinely past due with a real open balance. The other 16 generics paid by check or autopay in July. The 14 card payers paid two months late; the story is "quarterly customers pay when the reminder lands", which is ordinary for a small hauler.

### Items on held and suspended accounts are seeded `held`
Options: seed Kerr's and Holt's ServiceItems as `active` with only the account status changed, or as `held`. Chose `held`, matching what Phase 6's confirm action will do, so reinstating Kerr in the demo flips real state back rather than starting from an inconsistent one. Effective dates are untouched.

### Holt has no ServiceEvents during the hold
Options: seed Holt's Tuesday stops as `skippedSuspended` or leave them out. The contract has no "skipped (hold)" outcome and `skippedSuspended` would misreport a vacation hold as a suspension. Chose no events for Holt in the 14 day window (hold started 2026-08-28), so Phase 3's field panel shows its empty state for Holt. Phase 6 projects hold stops as "skipped (hold)" in the drawer only.

### Bakery's two posted invoices are paid in full
Options: leave September open (issued 2026-08-20, due 2026-09-01, so already past due on TODAY) or pay both by ACH. An open September invoice would contradict `status: active`. Chose both paid (`pay_ach_bakery_0801`, `pay_ach_bakery_0901`), so Bakery's demo is purely about price explanation and the contract card.

### Oakridge invoices are arrears, named by issue date, and all three are past due
Options: name `inv_oak_0601` by period (May) or by issue date (June 1). Chose issue date: `billedInAdvance: false` means the June 1 invoice covers May, net30 makes it due July 1. All three are past due on TODAY, which is exactly why a single check for their sum arrived on 2026-09-08. The account status stays `active` as the checklist says; the header will show a red past due figure until Scenario B allocates the check.

### Hale's invoiced hauls are event lines sourced from the ServiceItem
Options: model the three August deliveries as `recurring` lines, or as `event` lines with `source.type = 'serviceItem'`. Chose `event` (fuel applies, the flat environmental fee does not, tax on base plus fuel) because an on-call haul is a dated service, not a period. The dump-and-return hauls on 2026-09-01 and 09-04 are not invoiced in seed; the overage charges on their tickets are what Phase 2 generates. `ev_hale_dryrun` and `ev_fl_003_dryrun` carry `outcome: 'blocked'` with `exception: 'dryRun'`, so Phase 2 must key event charges on `exception`, never on `outcome`.

### Roll-off homeowner is prepaid perJob
Options: cycle `monthly` or `perJob`. Chose `perJob` with `billedInAdvance: true`, one posted haul invoice paid by card the day before delivery. The box is out 34 days against a 30 day allowance, so Phase 2 will propose 4 extra days at 700 cents.

### Invoice due dates in seed
Options: derive every seed due date from the engine's future rule (net30 plus 30 days, otherwise plus 10), or follow the checklist's Maple dates (issued 2026-06-20, due 2026-07-01, which is 11 days). Chose the checklist pattern for advance-billed seed invoices (issued the 20th of the prior month, due on the period start) and net30 for Oakridge and Hale. Phase 2's `postInvoices` keeps the contract's plus 10 rule for new invoices; seed invoices are historical data and do not have to match it.

### Invoice numbers
Options: random or sequential. Chose sequential `PD-2026-0401` upward in issue date order, so the numbers read like a real ledger and the office can sort by them.

### Quote `dueTodayCents` for the held storefront quote
Options: first month only, or delivery fee plus first month. Chose 5400 = 2500 zone delivery fee plus 2900 first month for `quote_held_ridge`, matching what a storefront signup would collect. The commercial request quote has 0 due today because it is a draft awaiting a site visit.

### Tokens beyond the flow map
Options: use only the flow map's variables, or add semantic status colors. The flow map has no red and no purple, but the checklist needs four distinct status pill colors and a red past due figure. Added `--danger`, `--info`, and `--hold` pairs (with `--ok` from the flow map's green lane and `--warn` reusing the accent), and 3px and 6px radii where the flow map is square-cornered. Every addition is named in DESIGN.md with its origin; Tailwind's default palette is cleared in `@theme` so nothing else can be used.

### Route capacities and extra zone fields
Options: leave the fields the contract requires but does not value at zero, or fill them with plausible numbers. Chose plausible filler, because a zero capacity would read as a broken route in the route stub. `capacityStops` (220 residential, 60 frontload, 12 roll-off) and the franchise zone's 5% franchise fee are filler the contract leaves open; nothing prices off them. The notServed zone has 0% tax and no delivery fee because nothing is sold there.

## Phase 1b

### Retokening from the Paper artboard
Options: keep the flow-map fallback tokens (Archivo, IBM Plex Sans, orange accent, square corners) and only add the Paper colors alongside, or replace every value with the computed styles the manager extracted from artboard `1-0` in `PAPER_TOKENS.md`. Chose full replacement with the token names kept: `--bg`, `--surface`, `--ink`, `--accent` and the rest now carry the artboard values, so `AccountPage` and the Tailwind utilities kept working without edits. Added `--line-quiet`, `--accent-2`, `--eyebrow`, `--radius-lg`, `--shadow-card`, `--radius-xs`, `--text-2xs`, `--text-3xl`, the four `--weight-*` steps, the `--on-accent-*` set for text and controls on navy, and the artboard's named measures (`--card-pad-*`, `--control-height`, `--nav-height`, `--page-inline`, `--page-top`, `--main-width`, `--side-width`, `--workspace-gap`). `--gap-bg` stays as an alias of `--warn-bg` so nothing referencing it breaks.

### Danger, ok, hold, and info-bg are chosen, not read
Options: leave past due in amber (the only warning color on the artboard) or add red and green. The checklist needs a red past due figure, an "in sync" green, and four distinct status pills, so `--danger` #C8382D on #FDE8E6 and `--ok` #1F9D6B on #E3F6EE were chosen with chroma near the amber pill, `--hold` reuses the eyebrow indigo on the icon tile tint, and `--info-bg` is a cyan tint at the amber pill's lightness. All four are labelled chosen in DESIGN.md.

### Pills color the dot, never the label
Options: color the pill label with the status color (the Phase 1 pattern) or keep the label in ink and put the status in a 6px dot on a tinted background. The artboard's "Decide by 11:30" pill does the latter, and amber text on the amber tint would fail contrast, so pills now set `--pill-dot` and a background and keep `--ink` for the label. Phase 3 should not add colored text inside pills.

### Dark mode is derived
Options: ship light only (the artboard is light only) or derive dark from the same navy scene. The Phase 1 three-state guard already existed and the checklist asks for both, so dark values are derived from the five anchors PAPER_TOKENS.md names (ground #14123A, surface #1E1B4F, line #3A368A, ink #EEEDFF, ink muted #B4B2E6) with the accent lifted to #6F7BEA so a navy button stays visible on the navy ground. Every dark value is labelled derived in DESIGN.md and none was read from Paper.

### Manrope for both heading and body, mono kept for money
Options: keep Archivo for headings as a second voice, or use the artboard's single family. The artboard uses only Manrope, so `--font-heading` and `--font-body` both resolve to it (the two names stay so a later split costs nothing). IBM Plex Mono stays for `--font-mono` because money and ids are not on this artboard and a mono face with tabular numerals is what a ledger column needs; recorded as a chosen addition.

### Tailwind text scale gets artboard line heights
Options: leave Tailwind's default `--text-*--line-height` ratios (which leaked through because `--text-*` was not cleared in Phase 1) or clear the namespace and set the artboard's pixel line heights. Chose to clear it and set 14, 16, 16, 21, 18, 22, 28, 34, 44 so `text-sm` and friends match the type table exactly.

## Phase 2

### State is a trailing parameter, never a hidden read
Options: engine functions read `useStore.getState()` internally (simple call sites, but impossible to run on a shadow copy), or take the state as an explicit argument. Chose a trailing `state: EntityState` parameter on every reader that defaults to the live store, so the contract's first argument is untouched (`resolvePrice({ ... })` still works) while `previewNextRun` and Phase 4's before-and-after preview can pass a shadow copy. React code must pass the hooked state (`useStore((s) => previewNextRun(id, s))`) or it will not re-render on changes. `EntityState` is now the data-only half of the store and `StoreState` adds the actions; engine.ts and useStore.ts import each other but only touch each other inside function bodies, so the cycle is safe at module load.

### "Active ServiceItem" means in force at the period start, not the status flag
Options: bill only items whose status is `active`, or bill every non-ended item whose effective window covers the period start. Holt's items are seeded `held` and DECISIONS already says a vacation hold keeps billing, so the status flag alone would silently drop Holt from the run. Chose the effective window: an item bills when `effectiveFrom <= period.start` and (`effectiveTo` is unset and status is not `ended`, or `effectiveTo > period.start`). Suspended accounts are skipped at the account level (invariant 4), so a `held` item on a suspended account never bills either. A consequence of proration `none`: an item closed with an `effectiveTo` later in the period still bills the full period, and its replacement starts at the next cycle.

### On-call items never recur
Options: treat Hale's `onCall` roll-off items like any other line (a monthly 57500 haul charge per box, which is wrong), or exclude `onCall` from `generateRecurringCharges`. Chose to exclude them; a haul is a dated event line sourced from the ServiceItem, as the seed already does for August. `generateEventCharges` does not invent haul charges for the two September dump-and-return work orders because nothing in the contract prices a haul from a WorkOrder; the billing surface owns that run and the report flags it.

### Arrears accounts bill the period just ended
Options: bill every account for the month or quarter starting on the cycle date, or honour `billedInAdvance`. Chose to honour it: Oakridge and Hale (`billedInAdvance: false`) get September lines on the October 1 run, matching Phase 1's reading that the June 1 invoice covers May. Prices are still resolved on the cycle date as the checklist says.

### Recurring lines are not produced twice for the same item and period
Options: let `generateRecurringCharges` re-propose a line that already exists as a Charge for that item and period start, or skip it. Chose to skip, keyed on `source.id` plus `period.start`, so a run on 2026-07-01 proposes nothing for accounts already invoiced for Q3 and a posted run is idempotent. Event charges skip any source (`serviceEvent`, `scaleTicket`) that already has a Charge, per the checklist.

### ruleWon for lines with no rate card
Options: force every event charge through `resolvePrice` (there is no RateVersion for an overload fee) or pick the closest literal. Chose `manualException` for the exception constants (extraBags 250, overload 1500, contamination 2500, dryRun 2500) and `standardRate` for lines priced from the catalog's roll-off terms (tonnage overage, extra days), with no `rateVersionId` on either. `evidenceIds` carries the ticket id on an overage, the event id when a photo exists, and the deliver WorkOrder id on an extra-day line; that WorkOrder id is also how the extra-day line is deduplicated (there is no `workOrder` source type in the contract, so the source is the ServiceItem). Extra days are proposed once for the whole time out; re-billing further days after a posted extra-day line is left to the billing surface.

### Contract overrides apply only inside the term
Options: an override applies whenever the account has the contract, or only when `onDate` falls between `termStart` and `termEnd`. Chose the term window, so `explainPrice` on a date after the term shows the rate card winning; the Phase 3 contract card can say what happens at term end.

### previewNextRun also returns existing proposed charges
Options: return exactly `{ cycleDate, recurring, events, totalCents }`, or add `proposed` for charges already in the store with status proposed or approved. Phase 6 appends a reinstatement fee as a proposed Charge and wants the next-run panel to list it, and the recurring dedup above means a re-run would not re-propose an appended line. Chose to add `proposed` and include it in `totalCents`. Nothing is written to the store by the preview; the test asserts the charge ids are unchanged.

### postInvoices is pure; the store action marks charges posted
Options: have the engine function mutate charge status (impure), or return the invoices and let `useStore.postInvoices` append them and flip the charges. Chose the latter. Invoice numbers continue the seed's sequence (`PD-2026-0449` is the next), `issuedAt` and `postedAt` are TODAY, due at +30 days for net30 and +10 otherwise, `deliveredVia` is the account's delivery method, and a charge that is already posted or waived is refused.

### Payment status by method, and card references
Options: settle every payment on entry, or settle only what the office actually holds. Chose settled for check and cash and pending for card and ach (Phase 5's rule), with the optional reference stored in `processorBatchId` only for card. `takePayment` validates its allocation against a shadow state that already contains the payment and writes nothing when validation fails.

### Credit memo note folds into reason
Options: drop the optional note (the contract's `CreditMemo` has only `reason`), or store `"reason: note"`. Chose the fold so the note survives without touching types.ts; the surface splits on the first colon if it wants the select value back.

### setAccountStatus flips items, and a hold files a Request
Options: only change `BillingAccount.status`, or also move the account's non-ended items between `active` and `held` and append a `vacationHold` Request (status scheduled) for holds. Chose the fuller action so the seed's Kerr and Holt shape (items `held`) is what the action produces and reinstatement restores `active`. Effective dates are never touched; `ended` items stay ended.

### Waivers and work orders in the store
Options: leave `WaivedCharge` and WorkOrder status to later phases, or add the two small append-only actions now while the store is open. Added `waiveCharge` (appends the row keyed by chargeId and marks the charge waived; a posted charge is refused and must be corrected with a CreditMemo) and `setWorkOrderStatus` (Phase 4's "mark scheduled"). The test asserts no store action name contains delete, remove, drop, or clear (invariant 5).

### The manager's expected test numbers held
Options: copy the manager's expected numbers into the tests as given, or recompute each from the rules first and change any that disagreed. Chose to recompute, so a test could not pass on a typo. Every number in the Phase 2 test box was recomputed from the rules and none needed changing: Maple 96 gal for three months is base 8700, fuel 609, env 300, tax 652 (7% of 9309 = 651.63, rounded half up), total 10261; tk_hale_1 is 4.2 tons, 1.2 over at 7000 = 8400; tk_hale_2 is 3.55 tons, 0.55 over = 3850; the roll-off homeowner box is 34 days out, 4 over at 700 = 2800.

## Phase 3

### Paper artboard read, and where the coded screen drifts from it
Options: build from the checklist description alone, or read the manager's artboard "Account view, Office" (node `D3-0`) and match it. `get_screenshot` on `D3-0` succeeded on 2026-09-10 (the quota that blocked Phase 1 had reset), so the screen follows the artboard: navy nav cloned from the dispatch console, eyebrow plus name plus status pill plus meta line, a sync chip group on the right, four stat cards, one site card per site with the service table and the "why this price" inset, and the side column with four action buttons, field history, open items, and the navy next-run card. Drift is recorded in DESIGN.md; the main one is the left rail the checklist requires, which the artboard does not draw.

### The rail costs the main column its 936px
Options: keep the artboard's 936px main column and push the 400px side column below the fold on a 1440 canvas, or let the main column flex between the 260px rail and the 400px side column. Chose to flex: the rail and the side column are fixed, the main column takes the rest. Under 1520px the rail narrows to 208px and the page inline padding drops from 40px to 24px so the eight-column service table still fits at 1440 (main column 736px). Above 1520px the rail is the full `--rail-width`.

### Price explanation is an inset, not a floating popover
Options: a floating popover anchored to the price cell (needs outside-click and positioning code), or the artboard's inset block under the service table, opened from the price or its source pill. Chose the inset because that is what the artboard draws ("WHY $29.00 FOR THE 96 GAL CART"), it reads better for three-sentence prose, and it cannot clip inside the table's horizontal scroll. One inset per site card; clicking the same price again or pressing Escape closes it. Phase 7's "popovers close on outside click" applies to whatever Phases 4 to 6 add; this inset closes on Escape and its Close link.

### Explanation prose comes from a selector, not the engine
Options: put the sentences in `explainPrice` (engine returns prose), or keep the engine structural and build the sentences in `explainServiceLine` in selectors.ts. Chose the selector so engine signatures stay as the contract has them and the wording can change without touching a tested function. The Bakery sentence reads "Contract contract_bakery override of $198.00 per month won over the $220.00 zone rate, 10% below rate card for "competitive match"." and the Maple one names rv_res_96_v1, its effective and published dates, and the superseded rv_res_96_v0 at $27.00 as the reason the January invoice changed.

### Sync chips: three deterministic stubs
Options: fake a clock-based "stale since 9:02" like the artboard, or derive each chip from data so an action flips it. Chose data rules: dispatch is stale when a WorkOrder on one of the account's sites has status `open` and either no `scheduledFor` or one before TODAY (a `scheduled` WorkOrder is dispatch's problem no longer); billing is stale when any Charge on the account has status `proposed` (the preview's would-be lines are not in the store, so seed accounts start in sync and Phase 6's appended reinstatement fee flips it); QuickBooks is stale when a posted Invoice (`postedAt`) or a settled Payment (`receivedAt`) on the account is dated strictly after `LAST_QUICKBOOKS_SYNC = 2026-09-08`. The Oakridge check is dated 2026-09-08 itself, so it counts as synced; a payment taken TODAY does not. The reason sentence is the chip's `title` and its aria-label, so it shows on hover and to a screen reader. The chip group's trailing note reads "all in sync" or "N stale".

### Next-run preview lives in the side column with its lines collapsed
Options: a collapsed panel under the header as the checklist says, or the artboard's navy card in the side column. Chose the navy side card with the checklist's collapse: the cycle date, the total, and the line counts are always visible; the per-line table (description, period, base, fees, tax, total, source, ruleWon) opens from "Show N lines". A suspended account shows the sentence "Suspended: no charges will be generated" in place of the toggle. The card renders from `previewNextRun` on the hooked state, so a store change re-renders it.

### Whole-store subscription with useMemo, not a selector that builds an object
Options: `useStore((s) => buildAccountView(id, s))` as the Phase 2 note suggests, or `const state = useStore()` plus `useMemo` on the state reference. zustand v5 compares selector results by reference and re-renders in a loop when a selector returns a fresh object on every call, so the hook form would spin. Chose the whole-store subscription and memo: any store change re-renders the page once, which is exactly the "re-computes on every render" the checklist wants. Every hook in selectors.ts (`useAccountView`, `useAccountSearch`, `usePinnedAccounts`) and every component that calls an engine reader (`ContractCard`, `RolloffDetail`, `PriceInset`) follows the pattern. Phases 4 to 6 should do the same for drawer previews, or use zustand's `useShallow` for primitive-only selections.

### Payments and credit memos sit under the invoices table, all invoices behind "show paid"
Options: an "open invoices only" table, or every invoice. Chose open by default with a "Show paid (N)" toggle, so Bakery (both invoices paid) does not show an empty ledger and Phase 5's allocation of the Oakridge check can be watched moving three rows from past due to paid. Payments list every allocation with its invoice number and the unapplied remainder; a payment with no allocation shows a "Not applied" pill, which is the Oakridge check today. Credit memos use the same shape; there are none in seed.

### Roll-off boxes are a separate panel, priced from generateEventCharges
Options: fold the box detail into the service table row, or a panel after the site cards for accounts with a `cat_ro_20yd` item. Chose the panel: each box shows its serial, site, delivered date (from the done deliver WorkOrder, else `assignedFrom`), days out against the catalog's included days, and its ScaleTickets with tons, tons over cap, and the proposed overage taken from `generateEventCharges` by `source.id`. When a ticket is over cap but already charged, the cell says so instead of inventing a number. Hale's two tickets read $84.00 and $38.50 base, matching the Phase 2 tests.

### On-call lines are priced per haul
Options: print every price as "per month" as the checklist column says, or say "per haul" when the frequency is `onCall`. Chose "per haul" because a 20 yd roll-off at $575.00 "per month" would be wrong on its face, and the engine never recurs on-call items.

### Photos never break
Options: trust `photoUrl`, or render through a component that swaps a failed image for a tinted block carrying the file name. Chose the component (`PhotoThumb`). The seed placeholders in `public/photos` do load, so the fallback is only reached on a missing file.

### Action buttons are real buttons with no handlers
Options: render disabled buttons, or live buttons whose `onAction` prop is optional. Chose live buttons with an optional `onAction` so Phases 4 to 6 wire them without touching markup; while unwired their title says "Opens its drawer in a later phase". The fourth button's label follows status: "Hold or suspend" when active or past due, "Reinstate" when suspended, "Resume" when on hold. An empty `<div id="drawer-root">` at the end of the page is the portal target for the drawers.

## Addendum (shared/CONTRACT_ADDENDUM.md, 2026-09-10 check-in)

The addendum is normative and wins over the entries above. Those entries stay as written; the items below now govern them.

- "Contract shorthand expansion" (anniversary as `MM-DD`): addendum B1 governs. The anniversary is a full ISO date such as `2027-01-01`.
- "Event charge amounts" (overload 1500 and contamination 2500 as engine constants): addendum B4 governs. Rates live in `src/seed/eventRates.json` at extraBags 250, overload 1000, contamination 2000, dryRun 2500.
- "Invoice due dates in seed" and "postInvoices is pure; the store action marks charges posted" (plus 10 days): addendum C9 governs. net30 is issuedAt plus 30 days; monthly and quarterly are plus 15.
- The Phase 2 runtime id scheme (the `_new_` infix in `newId`, recorded only in the engine comment): addendum C12 governs. Runtime ids carry the account infix `ac`, with counters above the highest seed id.
- The Phase 1 filler franchise fee of 5% for zone_franchise: addendum D4 governs. It is 17.
- The single tax rule `tax_open` from CHECKLIST Phase 1: addendum C8 governs. One 7% rule each for zone_open, zone_boundary, and zone_franchise, none for zone_notserved.
- "Arrears accounts bill the period just ended": addendum C14 governs. C14 carries no surface tag, but C1 says no surface may diverge on section C rules, so the period is cycleDate to cycleDate plus the cycle length for every account.
- "setAccountStatus flips items, and a hold files a Request": shared/OWNERSHIP.md governs the Request half. Portal owns Request creation, so Phase 4 and Phase 6 move office-created requests to a surface-local sidecar behind `recordOfficeRequest()`. The same map says billing owns Charge writes, so Phase 6 holds the reinstatement fee in a `proposedCharges` sidecar behind `proposeReinstatementFee()`.
- Kebab-case seed file names (CHECKLIST rules): addendum D3 governs at polish. Phase 7 renames them to camelCase plural.
- Paper: addendum F3 governs. Only the manager session calls Paper; the Phase 7 Paper box is the manager's.
- Dev port: addendum G governs. Account runs on 5199 with `--strictPort`; the Phase 3 subagent's use of 5191 was before the addendum.

## Phase 4

### Addendum B1: the anniversary is the first escalation date, rolled forward
Options: keep reading `MM-DD` and pin a year on it at render time, or store the full ISO date and roll it forward. The addendum requires a full date, so `contract_bakery` and `contract_fl_001..004` carry `"2027-01-01"` (written by `scripts/gen_seed.mjs`). `nextAnniversary` in selectors.ts treats the stored date as the first escalation and adds a year at a time until the date is after TODAY, so a contract whose first anniversary has passed still shows its next one. It throws on anything that is not `YYYY-MM-DD` rather than guess. The contract card still reads Jan 1, 2027.

### Addendum B4: event rates are a seed object held in state
Options: a keyed collection like every other entity, or a plain `Record<exception, cents>` in state. The rates are a lookup table with no ids, so `src/seed/eventRates.json` is the same flat object billing ships, `SeedData.eventRates` and `EntityState.eventRates` hold it, and `generateEventCharges` reads it through `eventRateCents(exception, state)`. The `EXCEPTION_CENTS` constant is gone. `notOut` has no rate and never charges. Overload moves from 1500 to 1000 and contamination from 2500 to 2000; the tests were updated to the addendum values and a new test re-prices every exception from a modified `eventRates` to prove nothing is hard-coded. The generator writes the file so it stays the audit trail.

### Addendum C9: due dates derived in the generator, not typed per invoice
Options: edit each literal `dueAt` in `gen_seed.mjs`, or derive it from the account's cycle in `addInvoice` and delete the literals. Chose derivation (`dueDateFor`, the same rule as the engine's exported `dueDateFor`), so seed and `postInvoices` cannot drift. Effects: quarterly Q3 invoices issued 2026-06-20 are now due 2026-07-05 (Maple stays 8745 past due), monthly frontload invoices are due on the 4th, the roll-off homeowner's on 2026-08-20; Oakridge and Hale (net30) are unchanged and all three Oakridge invoices stay past due. A seed test asserts the rule for every invoice.

### Addendum C12: runtime ids carry `ac`, counters start above the seed
Options: one global counter, or one per prefix starting above that prefix's seed ids. The addendum asks for per prefix. "Highest numeric suffix" is read literally: the trailing number of every seed id with that prefix, so `ch` starts at 902 (`ch_fl_008_0901`), `si` and `cont` at 97 (`si_maple_96`), `wo` at 4, `pay` at 31, `cm` and `note` at 1. `peekId` returns the next id without consuming it; the Change service preview plans with peeked ids, so the WorkOrder id the drawer shows is the id confirm writes (tested). Previews still consume `ch` ids, because `previewNextRun` builds Charges through `computeCharge` on every render. Those preview charges are never stored, so the gaps only affect which number the next stored charge gets.

### Addendum C8 and D4
Options: keep the single Phase 1 `tax_open` rule and let zones without a rule untaxed, or add one rule per served zone as the addendum says. Chose the addendum, because C8 carries no surface tag and C1 forbids divergence on section C. Three 7% tax rules (`tax_open`, `tax_boundary`, `tax_franchise`) applying to recurring, event, and fee lines, none for `zone_notserved`; `zone_franchise.franchiseFeePct` is 17. No seeded site sits in the boundary or franchise zone, so no seeded number moves. Both are asserted in the seed test.

### Addendum C14: every run bills forward from its cycle date
Options: keep billing arrears accounts for the month just ended, or bill cycleDate to cycleDate plus the cycle length for everyone. C14 carries no surface tag, but C1 says no surface may diverge on section C, so `billingPeriod` now ignores `billedInAdvance`: Oakridge's Oct 1 run bills Oct 1 to Oct 31. Copy that said "in arrears" now reads "Net 30 terms" in the header, and the money strip and next-run card name the period the run bills. Known gap, left for merge per D2: the seeded Oakridge invoices were built under the old reading (May, June, July), so August and September service is on no invoice. Regenerating derived tables is a merge task.

### Portal owns Requests: the phone request goes to an `officeNotes` sidecar
Options: keep writing a `cartChange` Request (Phase 2 behaviour), or record the office's side somewhere Portal does not own. shared/OWNERSHIP.md gives Request creation to Portal, so `planServiceChange` returns an `officeRequest` draft instead of a Request, `changeServiceItem` writes no Request, and the store action `recordOfficeRequest()` appends an `OfficeNote` (kind, accountId, siteId, workOrderId, createdVia phone, note, id `note_ac_####`, at TODAY) to the surface-local `officeNotes` sidecar. The WorkOrder's `requestId` is left unset because no Request exists. The open items panel lists each note under the WorkOrder it produced. The sidecar is not part of EntityState, engine functions never read it, and `resetToSeed` empties it. Phase 6's `setAccountStatus` still writes its vacationHold Request until that phase moves it.

### Dispatch chip: open means not yet dispatched
Options: keep the Phase 3 rule (stale only when an open WorkOrder's date has passed), or treat every `open` WorkOrder as stale until dispatch schedules it. The checklist wants the new swap to turn the chip stale and "mark scheduled" to flip it back, and the swap is dated in the future, so the old rule would never fire. Chose: stale while any WorkOrder on the account is `open`, or when a `scheduled` one has no date or a past date and is not done. No seeded WorkOrder is `open`, so every seed account still starts in sync. The "Mark scheduled" button on an open WorkOrder row calls `setWorkOrderStatus(id, 'scheduled')`.

### planServiceChange refuses changes that cannot be billed or dispatched
Options: let the drawer validate and keep the engine permissive, or reject bad plans in the engine. An unpriced item would make `resolvePrice` throw inside `generateRecurringCharges` and take down the whole next-run preview, so the engine refuses: a catalog outside the site route's line of business, an item with no published price on its effective date, an effective date on or before the replaced item's start, a quantity below 1, and a change that changes nothing. The drawer only offers catalog entries for the site's line of business and frequencies that resolve to a price, so these errors are the backstop.

### The replaced row shows as ended at once
Options: leave the old item `active` until its `effectiveTo` passes, or set `ended` at confirm as the checklist says. Chose the checklist: confirm sets `status: 'ended'` and `effectiveTo = effectiveFrom`, and the row moves behind "show ended" with an "Ends Sep 14" pill. The new row shows "Starts Sep 14". Billing is unaffected either way, because `generateRecurringCharges` reads the effective window, not the flag.

### Change service drawer defaults
Options: open blank, or open on the line the office clicked. A row's "Change" opens with that item as "Replaces" and its catalog, qty, and frequency filled in, so the office edits one field. Until something differs, the preview says it is the line as it is today instead of showing an error. The site header's "Add service" opens in add mode; the side column button opens on the first active line of the first site, with a site picker when the account has several. The effective date defaults to next Monday (2026-09-14) and cannot be before TODAY. The mid-cycle note names the posted invoice that already covers the current period, so the office can say "your September is already billed".

### Drawer shell and toast
Options: a centered modal, or a right-hand drawer over the page. Chose the drawer, because the office confirms a change while still reading the account behind it (balance, service table, next run). The drawer portals into `#drawer-root` over a scrim (ink at 28%, derived from a token, no new color), closes on Escape or a scrim click, focuses its first field, and returns focus to the control that opened it. The confirm button sits in a pinned footer. After confirm a toast names the WorkOrder id, kind, address, and date, and dismisses itself after 8 seconds.

## Phase 5

### Take a payment validates through one allocate call before any write
Options: write the Payment, then call the store's `allocate` (two writes, a failed allocation leaves an orphan payment), or validate the allocation against a shadow state holding the draft payment and write both at once. Chose the shadow: `takePayment` calls the engine's `allocate` exactly once with every invoice id and cents, on a shadow that already holds the payment, and only then appends the Payment and its PaymentAllocations in a single `set`. An AllocationError leaves the store untouched (tested: the payments, allocations, and ledgerWrites references are unchanged). The drawer's preview runs the same engine call on the same shadow, so a preview with no error is one confirm accepts.

### Reference number is kept only for card payments
The checklist stores the optional reference in `processorBatchId` only when the method is card, and the contract gives a check or ACH number no field. Options: add a field (forbidden by addendum B3), fold it into another field, or drop it. Chose to drop it for check, ACH, and cash and say so under the field ("Only card references are saved ... the payment record has no field for a check or ACH number"), so nobody thinks it was recorded. Request for shared/: a `reference` on Payment would let the office find a check by number.

### Allocation amounts are typed in dollars, held in cents
Options: make the per-row allocation input take raw cents (literal reading of "editable allocation cents"), or take dollars like the amount field and hold cents. Chose dollars in the input, parsed from the string by `parseDollars` (no float multiplication), with the cents value printed under each row and every validation, preview, and engine call in integer cents. Blank means zero; rows at zero are left out of the allocate call because the engine rejects non-positive cents.

### Auto-allocate fills oldest due first
Options: pre-fill the rows oldest first when the drawer opens, or start empty and fill on request. Chose empty rows with an "Auto-allocate oldest first" button, so the office decides where money goes and a customer's instruction ("apply this to the June invoice") is not overwritten. Oldest first means earliest `dueAt`, then `issuedAt`, then number, over invoices with an open balance. It fills up to the amount available (the new payment's amount, or an existing source's unallocated remainder) and leaves later rows at zero. The rows start empty rather than pre-filled, so the office chooses; a per-row "Fill" button takes the smaller of the open balance and what is left. The remainder is shown live and turns into "Over by" in red when the rows exceed the amount.

### Unapplied payments and credits allocate in the same drawer
Options: a separate "Apply payment" drawer for money already on the account, or one drawer for both. Chose one drawer, because recording and applying money use the same allocation table and preview. The Take a payment drawer lists every unapplied Payment (and unapplied CreditMemo) on the account above the form, each with Allocate, which swaps the form for the source's summary and the same allocation table against its remainder; confirm calls the store's `allocate` once. The payments and credit memos tables under the invoices table carry the same Allocate button, which opens the drawer straight on that source. Returned payments are never offered.

### QuickBooks chip: a session ledger sidecar, not a date rule
Options: keep the Phase 3 date rule (stale when a settled payment is dated after the last sync, 2026-09-08), or record the office's own money writes. The date rule misses the checklist's main case: `pay_chk_oakridge` was received on 2026-09-08, so allocating it would leave the chip in sync, and a pending card payment would never go stale. Chose a surface-local `ledgerWrites` sidecar (like `officeNotes`, addendum B3, not part of EntityState): `takePayment`, `allocate`, and `issueCreditMemo` each append an entry, and `buildQuickbooksSync` is stale with "Payment not yet synced" (or "Credit not yet synced") while any entry exists for the account. The Phase 3 date rule still applies when there are none, so seed accounts start as before. The previews compute the chip on the shadow with the pending entries added, so the drawer shows the chip going stale before confirm. `resetToSeed` empties the sidecar.

### Issue credit: over-balance is refused, not split
Options: when the credit is larger than the chosen invoice's open balance, apply what fits and leave the rest unapplied, or refuse and let the office choose. Chose refuse: the preview says the invoice's open amount and asks to lower the credit or leave it unapplied, and confirm is disabled. A silent split would put money on the account the office did not decide to put there. The Other reason requires a note; the rest take an optional note, folded into `reason` after a colon as in Phase 2, and shown with a readable label ("Missed pickup: Missed Aug 24").

### Unapplied credits in the header
Options: net unapplied credit and payments into the Balance figure, or keep Balance as open invoice balances and show the unapplied money under it. Chose the second. The Balance stat card carries a line under the figure when the account holds unapplied credit or unapplied payments ("$5.00 unapplied credit, $2,278.92 unapplied payment"). Balance itself stays the sum of open invoice balances (`accountBalance`), because an unapplied credit has not reduced any invoice yet; the line tells the office there is money to apply.

### Credit memos and payments are reachable from each invoice row
Options: only the side column buttons, which make the office pick the invoice in the drawer, or also a per-row action with the invoice preselected. Chose both, because a credit is usually about one invoice the office is already looking at. Every open invoice row has a small Credit action that opens Issue credit with that invoice preselected. The side column buttons open both drawers with nothing preselected.

## Requests for shared/

- Payment `reference` field (from the Phase 5 entry "Reference number is kept only for card payments"): the contract's Payment has no field for a check or ACH number, so the office cannot find a check by number. Proposed: an optional `reference: string` on Payment. Until then the account drawer saves a reference only for card payments, in `processorBatchId`.

## Phase 6

### Portal owns Requests: the vacation hold goes to the officeNotes sidecar
Options: keep `setAccountStatus` writing a `vacationHold` Request (Phase 2 behaviour), or record the office's side in the Phase 4 sidecar. shared/OWNERSHIP.md gives Request creation to Portal, so `setAccountStatus` writes no Request. A hold calls `recordOfficeRequest()` with kind `vacationHold`, createdVia phone, the first site, and a note built from the dates ("Vacation hold from 2026-09-10, resume 2026-09-28" plus any office note). The open items panel lists it as a loose note (there is no WorkOrder). The seeded `req_holt_hold` is Portal's row and is untouched.

### The reinstatement fee is proposed into a proposedCharges sidecar, not the Charge table
Options: append the fee to `charges` through `appendCharges` (what Phase 2 planned), or hold it in a surface-local sidecar. shared/OWNERSHIP.md says billing owns Charge writes and account may propose only from a service change, so `proposeReinstatementFee()` builds the fee with the engine's `buildReinstatementFee` (which calls `computeCharge` with lineType fee, source manual, status proposed, dated TODAY at the account's first site) and appends it to `proposedCharges`. The Charge table is unchanged (tested). The fee's manual source id is the reinstatement's status change id (`sc_ac_####`), so the charge points back at the office action that caused it. No fee rule applies to fee lines, and tax_open (7%, addendum C8) does, so $25.00 base plus $1.75 tax totals $26.75. The next-run panel lists it as "Proposed by office, waiting for billing", the header estimate includes it, and the billing sync chip is stale while it exists. It is not part of EntityState, engine functions never read it, and `resetToSeed` empties it. Known gap for merge: billing needs a way to take these rows.

### Status changes are kept in a statusChanges sidecar
Options: drop the suspension reason, effective date, and resume date (BillingAccount has no fields for them, and addendum B3 forbids adding any), or keep them surface-local. Chose a `statusChanges` sidecar: every hold, suspend, resume, and reinstate appends one row (from, to, effectiveFrom, resumeOn, reason, note, the item ids it flipped, at). The reinstate drawer reads the latest one to say why and since when the account was suspended, the route stub reads an open hold's resume date from it, and the reinstatement fee names it as its source.

### Status changes at confirm, and the effective date drives the route stub
Options: schedule the status change for the effective date, or set the status at confirm and use the effective date for the stops. The demo clock never moves and the contract has no scheduled status change, so confirm sets `BillingAccount.status` and the item statuses at once, as the checklist says. The effective date (default TODAY, never earlier) decides which projected stops flip: the stub lists the next four service days on the site's route from the effective date, and every stop on or after it flips. A hold's resume date turns the stops on or after it back to completed. Reinstate and resume take effect TODAY and have no date field.

### Reinstatement returns to pastDue when anything is past due
Options: always return to active, or re-derive the status. `statusAfterReinstatement` returns pastDue when `pastDue(account) > 0`, else active, as the checklist says. Kerr (PD-2026-0403, $102.61 open since Jul 5) and Maple ($87.45) both come back as Past due. Items go from held back to active with effective dates untouched; ended items are never touched.

### The route stub: recorded stops, then projected ones, with the outcome now and after
Options: list projected stops alone, or put the field record in front of them. Chose both: the last two recorded ServiceEvents at the site (Kerr's Sep 1 and Sep 8 Tuesday skips), then the four projected service days, each with a Now and an After confirm pill and "flips" where they differ. A projected stop reads completed on an active or past due account, skipped suspended on a suspended one, and "Skipped, hold" on a held one. "Skipped, hold" is display-only (`StubOutcome`), because the contract's ServiceEvent outcomes have no hold value, and the stub never writes a ServiceEvent. The stub also names the route and counts its other stops ("Tuesday route, 16 other stops still run every Tuesday"), so the office can tell the customer that only their stop is skipped. A site with no route says it is served on call.

### A suspended account's estimate leaves out charges the office proposed earlier
Options: keep the header and next-run total as the run total plus every proposed charge, or leave the office's proposed charges out while suspended. Reinstating Kerr and suspending again would otherwise show "Next invoice $26.75" beside "no charges will be generated". Chose `nextRunEstimate`: while suspended, the estimate is the run's own total ($0.00 for Kerr), and the next-run card lists the fee separately as "Already proposed before the suspension and still waiting for billing". The billing chip stays stale because the fee is still there.

### A hold keeps billing
Options: stop recurring charges during a hold (a credit for skipped weeks), or keep billing. The hauler policy is proration none, and `generateRecurringCharges` skips only suspended accounts, so a held account is billed as usual. The drawer's billing effect says so and shows the next invoice before and after with the same figure (tested).

### Drawer defaults
Options: open every account on the same default (hold), or pick the default from the account's state. Chose the account's state, because a past due account is almost always suspended for non-payment and an active one usually calls about a vacation. A past due account opens on Suspension with reason Non-payment. Every other active account opens on Vacation hold with a resume date 14 days out (2026-09-24). Holds require a resume date after the start. A held or suspended account opens straight into Resume or Reinstate. The suspend button uses the danger style. The fee preview is built on every render, so it consumes `ch` ids the same way `previewNextRun` does (Phase 4 note on addendum C12): the fee id confirm writes is the next free id, not the one in the preview chip's tooltip. The source id (`sc_ac_####`) is peeked, so it matches.

## Phase 7

### Dev reload fix: the watcher and Tailwind both skip the dashboard and docs
Options: move `dashboard.html` and `progress.json` out of the Vite root (change `scripts/build_dashboard.py` to write elsewhere), or keep them where they are and tell Vite and Tailwind not to watch them. Chose the second, because every surface (billing, portal, pricing, storefront, account) keeps its own copy of the script writing `dashboard.html` next to its CHECKLIST.md, and moving only account's would make it the odd one out for no gain; nothing else reads the file, so the change is contained to how this dev server watches. `vite.config.ts` sets `server.watch.ignored` to `**/dashboard.html`, `**/progress.json`, and `**/*.md`; `src/index.css` carries matching `@source not` rules so Tailwind neither rescans them nor lifts class names out of the dashboard. Proved on port 5199: with the Hold or suspend drawer open and a marker set on `window`, running the dashboard script and touching two docs left the marker and the drawer in place, with no reload and no CSS hot update. Before the fix the same run reloaded the page.

### Addendum D3: seed file names follow the contract entity, not the other surfaces' short names
Options: copy the names the other four surfaces already use (`catalog.json`, `allocations.json`, singular `hauler.json`), or name each file after its contract entity in camelCase plural as the checklist asks. Chose the entity names: `accounts.json` (the addendum's own example for BillingAccount), `serviceCatalog.json`, `paymentAllocations.json`, `haulers.json`, and the plain camelCase form of the rest. The `SeedData` keys already use these names, so file, key, and entity now read the same. The three files that differ from billing's set (`serviceCatalog`, `paymentAllocations`, `haulers`) are for the merge to settle; the content is unchanged. Proved by re-running `scripts/gen_seed.mjs` after the rename: all 26 files are byte-identical to the pre-rename copies. A seed test now fails if a non-camelCase JSON file appears or if `index.ts` stops importing exactly the files on disk.

### The price explanation closes like a popover
Options: leave the "why this price" inset closing only from its Close button and Escape (it is an inset in the page flow, not a floating layer), or give it popover behavior. Chose popover behavior, because it opens from a price or source pill and the office reads it and moves on, so a click anywhere else closing it matches what the office expects. A `pointerdown` outside the inset closes it; the price and source pill buttons are left out of the outside test because they already toggle it and switch it between rows. Escape closes it only when no drawer is open, so Escape in a drawer closes the drawer alone. Drawers already closed on Escape and scrim click and hand focus back to their opener; checked on Maple for all four drawers, the enabled confirm button is the last Tab stop in each.

### Visual pass: a changed figure keeps the money face
Options: drop `status-text` from money cells (losing the emphasis on a figure that changed or is still open), or let the money face win when both classes meet. Chose the second: `.status-text.money, .status-text.mono` restore IBM Plex Mono and keep the 600 weight. The audit that found it (Maple's open $87.45 on PD-2026-0404 was rendering in Manrope because `.status-text` sits later in the components layer than `.money`) now passes on all five focus accounts and inside every drawer: each dollar figure is mono and each money cell is right aligned. Three unapplied and open-after figures in the payment drawer gained `mono` for the same reason. The same pass counted every visible element's computed color, background, and border against the resolved token values in light and in dark (264 elements each, transitions disabled so a hidden pane cannot freeze a button mid-fade) and found none outside the tokens. Panels share the 16px radius; the four stat cards use the compact 18 / 20 padding and every content panel the artboard's 22 / 24. Pill labels measure 10.6:1 or better against their tint.

### `npm run dev` carries the fixed port in the config
Options: leave `npm run dev` as bare `vite` and tell people to type `npx vite --port 5199 --strictPort`, or put the port in `vite.config.ts`. Chose the config (`server.port: 5199`, `strictPort: true`), because the checklist and RUNBOOK say `npm run dev`, and bare `vite` lands on 5173, which is storefront's port under addendum G. The command in the addendum still works; the CLI flags and the config agree. Checked by running `npm run dev` while the 5199 server was up: it stopped with "Port 5199 is already in use" instead of drifting to another port.

### DECISIONS entries without their options were completed, not rewritten
Options: leave the eleven entries from Phases 1 to 6 that stated only the choice, or add the option that was set aside to each. Chose to add one "Options:" sentence to each, naming the alternative that was actually on the table and why it lost, and left the rest of each entry as written.

### Paper drift 1 and 2: the rail gives way, not the side column or the table's columns
Options: give the service table fixed column widths inside the old 736px main column (the widest row needs about 750px, so names and frequencies would still wrap), narrow the 400px side column (it is an artboard measure), or narrow the rail (the one element the artboard does not have). Chose the rail: below 1600 it flexes from 260px down to 152px with `clamp(152px, 100vw - 1288px, 260px)` and the page inline padding drops to 20px, so the main column is never under 800px and the side column keeps 400px. The old 1520 breakpoint also left a gap: from 1521 to about 1600 the 260px rail came back and squeezed the main column to 733px, and that is closed now. The rail's search placeholder became "Search accounts" (the fields it searches are in its tooltip) because "Name, id, address, or PO" truncated at 152px.

### Paper drift 1 and 2: auto layout sized to content, not fixed column widths
Options: fixed widths for every column (the checklist's example), or auto layout with the name and frequency cells set to nowrap. Chose auto layout, because fixed widths would have to hold the worst case of every account at once, Bakery's "3 yd front load, wood waste" and Maple's "Every other week" together, and that does not fit 752px. Auto layout lets each account's own longest name and frequency set the width, and every focus account fits with room left over. A 740px `min-width` makes the table scroll inside its card below 1440 instead of squashing. The other savings: 6px inline cell padding, compact 3 / 8 pills, "per month" in Manrope, and bare 12px mono serials as on the artboard.

### Paper drift 2: Change sits under the status pill, and the pill drops its date
Options: keep Change in its own ninth column (73px the table does not have at 1440), or stack it under the status pill. Chose to stack it, because the Phase 3 column list never had an action column and each open row still gets its own Change button with the same accessible name. The pills now say "Starts" or "Ends" without the date, with the full date on hover. Options there: keep "Starts Sep 14", which makes the Status column about 40px wider and brings back the overflow on Maple after Scenario A, or drop the date, which the Since column already shows as "Sep 14, 2026" or "to Sep 14, 2026". Chose to drop it; RUNBOOK Scenario A now expects "Starts" and "Ends".

### Paper drift 3 and 4: navy card head and the wordmark
Navy card options: right-align the cycle meta without wrapping (too long for 400px: "Oct 1, 2026 · Quarterly, bills Oct 1 to Dec 31, 2026"), or put it on its own line under the title. Chose its own line, so the title stays on one line. Wordmark options: fetch the Paper asset or draw the mark. Chose to draw it (the checklist forbids fetching the asset URL), and the glyph is not readable without Paper: a 28px `--accent-2` tile with a white bin mark in inline SVG. "Lab" uses the lighter weight in `--on-accent-2` rather than periwinkle, because periwinkle on navy is about 3:1 at 18px, under the large-text threshold, and lavender is well above it. The old mark read as two words because the text sat in a flex container with an 8px gap between its text nodes; the text is now one span.
