# PORT_DECISIONS.md: account port (Phase 2, boxes 2A.1 to 2A.5)

Judgment calls made while porting account/src into the merged app. The manager merges these into the root DECISIONS.md.
Each entry names the call, the alternative, and the reason. Figures come from the running app on port 5201 and from
the tests in src/surfaces/account/__tests__, both on billing's seed (the merged seed), on the demo day 2026-09-10.

## Where things live

| Prototype | Merged |
|---|---|
| account/src/store/engine.ts | Gone. Every engine call goes to src/store/engine.ts in its trailing-db form. Surface-only helpers are in src/surfaces/account/lib/engine.ts (explainPrice, previewNextRun, planServiceChange, itemStatusForAccountStatus, statusAfterReinstatement, buildReinstatementFee, balances, allocateChecked) |
| account/src/store/useStore.ts | src/store/slices/account.ts (AccountSlice, createAccountSlice) |
| account/src/store/selectors.ts | src/surfaces/account/selectors.ts, rewritten over the Db arrays |
| account/src/store/clock.ts | src/surfaces/account/lib/clock.ts (date math); today() comes from src/store/clock.ts |
| engine id counters | src/surfaces/account/lib/ids.ts |
| components, pages | src/surfaces/account/components, src/surfaces/account/pages (NavBar dropped) |
| tokens.css, index.css | src/styles/surfaces/account.css, all under .surface-account |
| engine.test.ts | src/surfaces/account/__tests__ (engine, slice, selectors, render: 64 tests) |

## Store and slice

1. **Store keys: officeNotes, proposedCharges, accountEdits.** accountEdits is `{ ledgerWrites, statusChanges }`, the two edit logs the prototype kept as separate top-level keys. *Alternative:* keep ledgerWrites and statusChanges at the top level, or call the log `edits`. *Why:* billing owns the store key `edits` (its charge edit sidecar), and composeSlices throws at startup on a duplicate key. The prototype had no key literally named `edits`; its two edit logs are what the checklist's "edits" sidecar means, so they sit together under the name the manager suggested. The slice's header comment now says so.
2. **Two actions renamed: setAccountStatus is changeAccountStatus, allocate is allocatePayment.** *Alternative:* keep the prototype names. *Why:* portal's prototype store also has a setAccountStatus, and `allocate` is the engine's own function name and the most generic word in the store. A collision throws at startup and takes every surface down, and the four ports write their slices at the same time. Every other action keeps its prototype name.
3. **postInvoices, appendCharges, and waiveCharge are not in the account slice.** *Alternative:* port all of the prototype's store actions. *Why:* shared/OWNERSHIP.md gives Charge, Invoice, and WaivedCharge writes to billing, whose slice already has post, waive, and approve. The account UI never called them; only the prototype's own tests did. Invariant 5 is still asserted for this slice (no action name contains delete, remove, drop, or clear), and billing's waive and post suites cover the rest.
4. **One store update per action.** Each action commits its db rows through mutateDb(fn) and the sidecar rows through its patch, so a service change writes the item, container, work order, and office note in one update (tested: one subscriber call). Reinstating writes the status, the item flips, the status change, and the fee in one update. *Alternative:* sequential set calls, as the prototype made. *Why:* root DECISIONS.md entry 7. The prototype's reinstate made three updates, and a render between them could show the status without the fee.
5. **Selectors read the Db arrays directly.** *Alternative:* build the prototype's keyed collections (byId, ids) from the Db once per render and keep the selectors as they were. *Why:* the canonical engine reads arrays, and every drawer preview runs the engine on a shadow db. With an adapter every preview would convert back and forth between two shapes. With arrays there is one shape everywhere. The table names are billing's: accounts, catalog, allocations, hauler.
6. **Runtime ids come from the rows they will join, not from module counters** (lib/ids.ts). An id is the prefix, the `ac` infix, and one above the highest trailing number in that table (addendum C12). *Alternative:* the prototype's per-prefix counters seeded from its own seed file, plus peekId for previews. *Why:*
   - a preview and its confirm read the same rows, so they agree by construction, with no peek and consume pair
   - ids stay above rows other surfaces add at runtime
   - nothing needs rewinding when the store resets

   Observed on a fresh load: wo_ac_0004, si_ac_0097, cont_ac_0001, note_ac_0001, pay_ac_0808, cm_ac_0001, sc_ac_0001, chg_ac_0827, lw_ac_0001.
7. **The reinstatement fee's id is chg_ac_####, not ch_ac_####.** *Alternative:* keep the prototype's `ch` prefix. *Why:* billing's seed and billing's runtime ids use `chg_`, so Phase 3 can move the row into db.charges unchanged.
8. **New container serials follow the merged seed's patterns:** C64-9001 for carts, FL-9001 for front load, RO20-9001 for roll-off. *Alternative:* the prototype's PD-CART-9001. *Why:* billing's seed serials are C96-10231, FL-451, and RO20-2001. The 9xxx block never occurs in the seed.
9. **Previews mint throwaway charge ids (chg_ac_preview_N).** lib/engine.ts withPreviewChargeIds swaps the canonical engine's charge id generator for the preview and then restores it, the same swap billing's computePriorChanges uses. *Alternative:* let previews use the default generator. *Why:* the next-run card, the change drawer, and the hold drawer call the generators on every render. Each call would advance billing's chg_bl_ counter, so billing's next run would get different ids depending on how long someone looked at an account. Tested: after a preview, the next billing id is still chg_bl_0001.
10. **previewNextRun works on one account and never double counts.** It narrows the db to the account (its account row, sites, service events, and scale tickets; every other table whole) and drops a generated recurring line when db.charges already has a charge for the same item and period start. *Alternative:* the prototype generated for the whole store and filtered afterwards, and its own dedup skipped a charge in any status. *Why:* the canonical generator skips only approved and posted charges. So after billing runs the cycle (and its proposed lines sit in db.charges), the account view would have counted every line twice. Tested: after billing's runCycle, Maple still reads 18361, all four lines under "Already proposed".
11. **A vacation hold leaves items active; only a suspension holds them** (itemStatusForAccountStatus). *Alternative:* the prototype set items to `held` for both. *Why:* the canonical generateRecurringCharges bills only `active` items. The prototype decided a hold keeps billing (the hauler does not prorate or credit vacation weeks), and billing's seed already carries acct_res_holt on hold with its item active. Keeping the prototype's flip would have silently stopped billing on every hold. The hold drawer's preview therefore shows no item change for a hold, and the next invoice unchanged (18361 on Maple), exactly as the prototype's runbook says.
12. **Dates come from today() at call time, never from a TODAY constant.** *Alternative:* keep `TODAY = '2026-09-10'` as the prototype did. *Why:* billing's Next cycle moves the one engine clock forward a month (root DECISIONS.md entry 23). The account hooks subscribe to the clock through the store, as the persona bar does, so the view follows it.
13. **Hooks subscribe to db, each sidecar, and the clock separately, then memoize.** *Alternative:* the prototype's whole-store subscription. *Why:* the merged store holds five slices, and a whole-store subscription would rebuild the account view whenever the ratebook or the storefront changed a field. It keeps the prototype's rule that no selector returns a fresh object, since zustand v5 loops on that.
14. **allocateChecked wraps the canonical allocate()** with the checks the prototype engine made and the canonical one leaves to its callers: the source exists, a returned payment is never applied, there is something to allocate, and every invoice belongs to the source's account. *Alternative:* call allocate() bare. *Why:* the canonical allocate() accepts an invoice on another account. Billing's stub adds its own checks for the same reason.
15. **The "rate card it beat" comes from the canonical resolvePrice** run on a copy of the db with the contracts set aside. *Alternative:* port the prototype's findRateVersion. *Why:* the explanation then uses the same precedence code billing charges with, so the two can never disagree. The winner is the canonical call itself.
16. **Event lines read as the canonical engine writes them.** An extra bags event is "Extra bags, Sep 7", ruleWon standardRate, with the event id in evidenceIds. The prototype said "Loose bag fee" with manualException. *Alternative:* relabel in the view. *Why:* these are the rows billing will actually propose, and the account view should show billing's words for them.
17. **Roll-off extra days are shown but never priced as a charge.** *Alternative:* keep the prototype's extra-day line in lib/engine.ts. *Why:* the canonical generateEventCharges has no extra-day rule, and the account view must not preview a charge billing will never produce. The roll-off card still shows days out and extra days, and says what they would cost with "not billed by the billing run". No focus account is affected: Hale's three boxes are 23, 17, and 23 days out against 30. See request 3.
18. **The view counts an office-proposed charge once, even after billing takes it** (selectors.ts pendingOfficeCharges). The sidecar stays as it is for Phase 3, but the view ignores a sidecar row whose id is already in db.charges. *Alternative:* leave it to Phase 3. *Why:* Phase 3 moves the reinstatement fee into billing's table with the same id. Without the filter the fee would be counted twice, in the sidecar and in db.charges. Tested.

## Screen

19. **The prototype's navy nav bar is gone.** *Alternative:* keep the dispatch console nav with its inert tabs. *Why:* the persona bar owns navigation, and billing's port removed its console tabs for the same reason (root DECISIONS.md entry 22). As a result the workspace starts 48px from the top, under the persona bar, where the prototype started 64px down under its nav. The rail's sticky top now clears the persona bar (48px plus 24px). Rail links go to /office/account/:id.
20. **Light only.** The prototype's dark values are not ported. *Alternative:* port its three-state dark guard, scoped to the wrapper. *Why:*
    - the persona shell and billing are light only, and a dark account view under a light persona bar would look broken
    - theme.test.ts forbids a line starting with `:root`, which that guard needs
    - the dark values stay in account/src/styles/tokens.css for an app-wide dark theme later

    Worth knowing when comparing screens: headless Chrome on this machine reports a dark color scheme, so the running prototype renders dark in it. The comparison at 1440 was made in light.
21. **account.css keeps the prototype's cascade.** The tokens, the --rt-* values, and the ground are plain rules on .surface-account. The element rules sit in `@layer base` and the pattern classes in `@layer components`, both nested under the wrapper. *Alternative:* one unlayered block, as billing's file is. *Why:* in the prototype a Tailwind utility beat a pattern class on the same element, because the patterns sat in the components layer. Keeping the layers keeps that.
22. **The drawer scrim sits at z-index 35, above the persona bar's 30.** *Alternative:* the prototype's 30. *Why:* a drawer covered the prototype's whole page, nav included. At 30 it would tie with the sticky persona bar and depend on DOM order.
23. **Photos go through resolvePhoto.** Billing's seed names evidence files that were never shipped (/evidence/bakery-wood-contamination.jpg). PhotoThumb maps them to absolute /photos/ paths, and falls back to the file name block when a photo has no real file. Checked in the browser: Bakery's contamination thumbnail loads /photos/ev_bakery_contamination.svg.
24. **Compared with the prototype at 1440, by measurement.** Measured with headless Chrome on the running prototype (5199, light) and the port (5201):
    - layout: rail 152px, main column 800px, side column 400px, service table scroll width equal to its width (750px), on all five focus accounts
    - type: h1 Manrope 28/34 700; stat figures IBM Plex Mono 28/34 600; pills Manrope 12/16 700; meta Manrope 14/18 500; eyebrow Manrope 11/14 700; service table cells Manrope 13/18
    - color: ground #F7F7FF, ink #1A174F, navy card #312D97
    - shape: card radius 16px, the same card shadow

    The only differences are the missing nav (entry 19) and the seed's own data.

## Tests

25. **The prototype's tests were moved by what they test.**
    - *Tests of the prototype engine's internals* (resolvePrice precedence, computeCharge fees and tax, the recurring and event generators, postInvoices, waiveCharge) test code that no longer exists. The canonical engine's suites cover the same rules on the merged seed: src/store/engine.test.ts, generate.test.ts, post.test.ts, waive.test.ts, and allocate.test.ts.
    - *Everything the account view adds on top of the engine* moved to src/surfaces/account/__tests__ with the merged figures: the price chain, the next-run preview, balances, allocation checks, service change plans, the hold and reinstate rules, runtime ids, every slice action, every drawer preview, and Scenarios A to E.
    - *account/src/seed/seed.test.ts* is not moved. It asserted account's own seed, which the merge replaced with billing's, and src/seed/seed.test.ts covers the merged seed.
    - *What that leaves out:* the prototype test that re-priced exceptions from a modified eventRates is gone too, because the merged eventRates is a module constant in the canonical engine, not store state.
26. **The render test mounts the account surface on its own route** (render.test.tsx), not through AppRoutes. *Alternative:* extend src/shell/routes.test.tsx. *Why:* routes.test.tsx belongs to the shell, and it imports every surface, so another port's half-written import fails it at collection time (that happened twice during this port). The account's own suite stays green whatever the other ports are doing. It checks all five focus accounts, the unknown-account screen, the rail links, and Scenario A through the drawer.

## Figures: merged against prototype

Every merged figure below was observed on screen at 1440 (walk: 91 checks, 0 failed, no console output) and is asserted in the tests.

### Scenario A (and E): Maple changes the 96 gal cart to a 64 gal cart

| What | Prototype (account seed) | Merged (billing seed) |
|---|---|---|
| Address, route | 412 Maple St, Monday | 412 Maple Ave, route_mon_res (Monday) |
| Past due | $87.45 on PD-2026-0404, due Jul 5 | $87.45 on INV-2026-0203, due Jul 16, 56 days late |
| Next invoice, Oct 1 | $183.61: 102.61 + 33.91 + 44.22 + 2.87 | $183.61: 102.61 + 33.91 + 44.22 + 2.87 (same) |
| 96 gal line | base 8700, fees 909, tax 652, total 10261 | same |
| 96 gal serial | PD-CART-0100 | C96-10231 |
| Swap work order | wo_ac_0004, Sep 14 | wo_ac_0004, Sep 14 (same) |
| New container | PD-CART-9001 | C64-9001 (cont_ac_0001) |
| Drawer rate change | $29.00 rv_res_96_v1 to $26.00 rv_res_64_v1, -$3.00 per month | $29.00 rv_res_96_2026 to $26.00 rv_res_64_2026, -$3.00 per month |
| Next run after | $173.30, change -$10.31 (-1031; base -900) | **$176.74, change -$6.87 (-687; base -600)** |
| New 64 gal line on the run | base 7800, total 9230 | **base 8100, fuel 567, env 300, tax 607, total 9574**. Billing's seed publishes rv_res_64_2026q4 at $27.00 from 2026-10-01 (superseding $26.00), and the Oct 1 run prices on its period start, so the drawer shows $26.00 today while the run bills $27.00. The same rule as the prototype; the seed differs. |
| Drops and adds rows | -$102.61, +$92.30 | -$102.61, +$95.74 |
| Office note | note_ac_0001 | note_ac_0001 (same text) |
| Current quarter | PD-2026-0404 18074, 8745 open, untouched | INV-2026-0203 18074, 8745 open, untouched |
| Dispatch chip | stale, then in sync after Mark scheduled | same |

### Scenario B: one payment across several invoices (invariant 6)

The prototype seeded pay_chk_oakridge ($2,278.92) unapplied against three open Oakridge invoices of $759.64. Billing's seed already applies pay_chk_oakridge ($1,938.00, received Sep 4) across INV-2026-0201, INV-2026-0202, and INV-2026-0210 at $646.00 each: Oakridge is net 30 and tax exempt, and nothing is open. So the Oakridge part of the scenario is read only in the merged app, and the same allocation flow runs live on the two accounts billing's seed leaves with money to apply.

| What | Prototype | Merged |
|---|---|---|
| Oakridge balance, past due | $2,278.92 and $2,278.92, then $0.00 after allocating | $0.00 and $0.00 from the seed; the payments table shows the check split across the three invoices |
| Try to break it on Oakridge | $10.00 on a paid invoice refused, nothing written | same: "open balance is 0 cents", nothing written |
| Take a payment, auto-allocate oldest first | pay_chk_oakridge across 3 invoices | acct_res_003: a $68.40 check, pay_ac_0808, across INV-2026-0211 and INV-2026-0213 at $34.20 each. Balance $68.40 to $0.00, past due $34.20 to $0.00. QuickBooks stale: "Payment not yet synced" |
| Allocate an unapplied payment | pay_chk_oakridge, $2,278.92 | acct_res_017: pay_chk_unknown, $65.00, against INV-2026-0204. Typing $800.00 reads "INV-2026-0204: $800.00 is more than its open balance of $102.61" and Apply is disabled. Applying $65.00 takes the balance from $102.61 to $37.61 |

### Scenario C: Kerr is suspended and the route skips him (invariant 4)

| What | Prototype | Merged |
|---|---|---|
| Address, route | 230 Birch Ln, route_tue_res | 77 Kerr Ln, route_tue_res |
| Before | Suspended, past due $102.61, next invoice $0.00 | Suspended, **no invoices (past due $0.00)**, next invoice $0.00 |
| Recorded stops | Sep 1 and Sep 8, skipped suspended, T. Nguyen | Sep 1 and Sep 8, skipped suspended, Tasha Green |
| Projected stops | Sep 15, 22, 29, Oct 6 flip to Completed | same |
| Other stops on the route | 16 | **15** (route_tue_res lists 16 stops including Kerr's) |
| Reinstated status | Past due (10261 past due) | **Active** (nothing past due). Same rule |
| Items | si_kerr_96 held to active | si_kerr_96 is already active in billing's seed: no item flips on reinstatement; it is held on the next suspension |
| Next run | $0.00 to $129.36 (102.61 + 26.75) | $0.00 to $129.36 (same) |
| Reinstatement fee | ch_ac_####, base 2500, fees 0, tax 175, total 2675, source sc_ac_0001 | chg_ac_0827, base 2500, fees 0, tax 175, total 2675, source sc_ac_0001, in the proposedCharges sidecar; the Charge table is unchanged |
| Suspend again | drawer defaults to Suspension, Non-payment (past due) | Kerr is Active, so the drawer defaults to Vacation hold and Customer request; choosing Suspension and Non-payment, $129.36 to $0.00, fee listed as "Already proposed before the suspension" |
| Maple suspension | 18361 to 0, three lines held, 15 other stops | 18361 to 0, three lines held, **16** other stops on route_mon_res |
| Maple vacation hold | next invoice stays $183.61 | same; Sep 14 and Sep 21 read Skipped, hold, and Sep 28 on read Completed with a Sep 24 resume date |

### Scenario D: Bakery, why $198.00 and not $220.00

| What | Prototype | Merged |
|---|---|---|
| Address | 88 Commerce Ave | 880 Commerce St |
| Lines | 3 yd front load container PD-FL-0105; 3 yd front load, wood waste PD-FL-0106 | 3 yd frontload container FL-451; 3 yd wood waste container FL-452 |
| Price and source | $198.00 and $171.00, Contract | same |
| Explanation | contract override won over the $220.00 zone rate rv_fl_3yd_v1 | same sentence, rate card rv_fl_3yd_2026 (wood: rv_fl_3yd_wood_2026, $190.00) |
| Balance, last payment | $0.00, last payment $424.47 ACH Aug 31 | $0.00, **no invoices or payments** in billing's seed |
| Next invoice, Oct 1 | $447.37: 227.69 + 196.78 + 22.90 | $447.37: 227.69 + 196.78 + 22.90 (same; contamination event evt_bakery_contam, Sep 9) |
| Contract term | Jan 1, 2026 to Dec 31, 2027, 477 days, notice by Nov 1, 2027 | **Jan 1, 2026 to Dec 31, 2026, 112 days, notice by Nov 1, 2026 (52 days)** |
| Escalated prices | $205.92 and $177.84 after Jan 1, 2027 | same figures; in this seed Jan 1, 2027 falls after the term ends |
| Show paid (2) | PD-2026-0436 and PD-2026-0439 at $424.47 | none: Bakery has no posted invoices |

### Other focus accounts

| Account | Merged |
|---|---|
| Oakridge next run | $646.00: four 2 yd lines at $161.50 (15000 base, 1050 fuel, 100 env, untaxed), Oct 1 to Oct 31 |
| Hale next run | $168.87: dry run $28.62, ticket_hale_1 overage $96.17 (1.20 tons over), ticket_hale_2 overage $44.08 (0.55 tons over), which is billing's INV-2026-0265 |
| Hale roll-off card | RO20-2001, RO20-2002, RO20-2003 at 23, 17, and 23 days out of 30; ticket_hale_3 under cap |
| Maple credit example | a $7.45 billing error credit on INV-2026-0203 takes it from $87.45 to $80.00 open (cm_ac_0001), as in the prototype |

## Requests from account port

1. **src/store/slices/slices.test.ts, "placeholders contribute nothing yet".** It asserts that the account slice returns `{}`, so it fails now that box 2A.2 fills the slice, and it will fail for each port in turn. Please limit the loop to slices still empty, or assert instead that each slice returns an object with no core key. Account's own slice-shape tests are in src/surfaces/account/__tests__/slice.test.ts.
2. **DESIGN.md, "Where each surface's values come from".** Account's row should read "Filled (Phase 2)", and note that the account view is light only (entry 20).
3. **Billing engine: extra-day charges for roll-off boxes.** The prototype proposed extra days x catalog.rolloff.extraDayCents for a box out longer than includedDays, sourced from its ServiceItem, with the delivery work order as evidence. The canonical generateEventCharges has no such rule, so acct_ro_home's box (delivered 2026-08-07, 34 days out, 4 extra days at $7.00, which is $28.00) is not billed. Until billing adds it, the account view shows the days and the amount as not billed (entry 17).
4. **Payment reference (addendum K7).** The account drawer still keeps a reference only for card payments (as processorBatchId). If the merged runbook needs check numbers on screen, Payment needs the optional `reference` field K7 describes.

## For Phase 3: what the cross-surface flows call

| Flow | Call |
|---|---|
| 3.1 signup to account view | Nothing to call. The view reads db, so a storefront signup renders at /office/account/<new id> as soon as it is written. The rail search already finds any account by name, id, address, or PO. The pinned list is FOCUS_ACCOUNT_IDS in selectors.ts; to pin new signups, derive it from db (for example accounts whose id has the `_sf_` infix) |
| 3.3 portal requests as open items | Already live: the open items card lists every db.requests row on the account (buildRequests). A portal cart change becomes `changeServiceItem({ siteId, replaceItemId, catalogId, qty, frequency, effectiveFrom, createdVia: 'portal', note })`, which returns the plan (work order included). A portal hold is `changeAccountStatus(accountId, 'hold', { effectiveFrom, resumeOn, createdVia: 'portal', note })`, ended by `reinstateAccount(accountId)`. Both drawers take their previews from `buildServiceChangePreview` and `buildHoldPreview` in selectors.ts |
| 3.5 contract override as price source | Nothing to call. The service table and next-run lines resolve prices live through the canonical resolvePrice, so a contract pricing writes to db.contracts shows as "Contract" at once |
| 3.6 billing's applyUnappliedStub | `allocatePayment({ sourceType: 'payment', sourceId, invoiceIds, cents })`. It returns the rows, throws on any bad allocation (writing nothing), and records a ledgerWrites entry for the QuickBooks chip. The stub also checks that the invoice is posted; every invoice in db is posted today |
| 3.6 reinstatement fee to billing | Read `proposedCharges`: full Charge rows (status proposed, lineType fee, source manual sc_ac_####, id chg_ac_####), built by computeCharge. Append them to db.charges with the same ids (appendCharges). The account view then counts them from db.charges and ignores the sidecar copies (entry 18). The slice has no action that removes a row; by design, no account action name contains delete, remove, drop, or clear |
| 3.6 office notes to portal Requests | Read `officeNotes`: `{ id: note_ac_####, kind: cartChange or vacationHold, accountId, siteId, workOrderId?, createdVia, note, at }`. A cart change note carries its work order id. A Request row also needs a status (scheduled for both) |
| 3.6 pricing's linkAccountToContract | No account action exists yet. The view reads the account's contract as `account.contractId`, falling back to the first contract on the account (contractOf). Add the action to this slice as a db write on accounts |
| 3.7 persona bar counts | Office open items on the account side: officeNotes, proposedCharges not yet in db.charges (pendingOfficeCharges), and open db.requests. The office's session log is accountEdits (ledgerWrites and statusChanges) |
