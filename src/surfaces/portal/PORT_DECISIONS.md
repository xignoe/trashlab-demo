# PORT_DECISIONS.md: portal port (CHECKLIST.md boxes 2C.1 to 2C.5)

Judgment calls made while porting portal/src into the merged app. The manager merges these into the root DECISIONS.md. Each entry gives the call, the alternative, and the reason.

## Store and slice

1. **Slice keys: four tables by their checklist names, everything else prefixed `portal`.** `holds`, `pendingChanges`, `quoteRequests`, and `paymentMethods` keep their names so Phase 3 finds them. The session, the log, and every action are `portalSession`, `portalLog`, `portalPlaceHold`, `portalRecordPayment`, and so on.
   - *Alternative:* the prototype's bare names (`session`, `placeHold`, `recordPayment`).
   - *Why:* three other slices were being written at the same time, and generic action names are the likeliest to collide. `composeSlices` throws at startup on a collision, so the prefix removes the risk without coordination.
2. **The portal writes db only through `get().mutateDb(fn, patch)`.** Every action commits its db rows and its slice rows (holds, log, pendingChanges) in one update. Examples: a payment with its allocations and the status flip; an extra pickup's charge, payment, request, and work order.
   - *Alternative:* the prototype's chain of small writers (`addPayment` then `addAllocations` then `refreshAccountStatus`), each its own `set`.
   - *Why:* one commit means one render and no half-applied state. A thrown validation writes nothing, which is what the prototype's tests asserted.
3. **Screens read a flat view of the store** (`src/surfaces/portal/store.ts`: `usePortal`, `portalState`, `viewOf`).
   - The view is db's tables (with the pending-seed events, entry 5), the four slice tables, `session`, `log`, and the actions under the prototype's names.
   - It is built once per root state and cached in a WeakMap, so zustand selectors over it return stable references.
   - *Alternative:* rewrite every screen to read `state.db.x` and `state.portalX`.
   - *Why:* the 22 screen and component files moved with import changes and a handful of edits, which keeps them diffable against portal/src.
4. **Dropped writers the portal does not own:** `updateInvoice`, `updateCharge`, `addCharge`, `addPayment`, `addAllocations`, `setPaymentMethod`, `updateServiceItem`, `addServiceItem`, `addQuote`, `setAccountStatus`, `updateRequest`.
   - *Alternative:* port them with their guards (`updateInvoice` threw on a locked invoice).
   - *Why:* OWNERSHIP.md gives those entities to billing, account, pricing, and storefront. No screen called them; only tests did. The guards' intent is now structural: the slice has no action that can touch an invoice, a posted charge, a service item, or a quote. `store.test.ts` "never writes an entity another surface owns" asserts it.
5. **Pending-seed field events** (`src/surfaces/portal/lib/fieldEvents.ts`). Billing's seed has only two Maple events: 2026-08-31 completed, and 2026-09-07 completed with extra bags (billing's scenario 4 anchor). So portal/RUNBOOK.md scenario 2, a blocked stop with a photo and then a real miss that books a recovery, was unreachable.
   - The two prototype events wait in a read-only sidecar that only the portal's reads merge in: 2026-08-17 missed ("Stop skipped, truck full, no photo") and 2026-08-24 blocked, with the driver note, R. Alvarez, and `/photos/blocked-driveway.svg`.
   - An event there drops out as soon as db has any event for the same site and day, so once the seed carries the rows (request 1) the file is inert and can be deleted.
   - *Alternative:* write the events into db from the slice (they would vanish on Reset seed, and ServiceEvent is seed-only), or leave scenario 2 broken.
   - *Why:* it keeps the scenario's behaviour, stays out of src/seed, and changes no billing figure. Neither event has a billable exception, and neither is in db.
6. **The missed pickup window is 28 days** (prototype 21, `MISSED_PICKUP_WINDOW_DAYS` in lib/engine.ts).
   - *Alternative:* keep 21.
   - *Why:* inside 21 days (Aug 20 to Sep 10), the only Maple Monday the merged seed leaves free is Aug 24, and the scenario needs two free Mondays: one blocked, one missed. Four weeks reaches Aug 17. The constant is portal-local, as the prototype's own entry 47 raised it before.
7. **Portal ids are `<prefix>_p####`, one above the highest such id already in the table** (`lib/ids.ts`). The prefixes are req, wo, pay, chg, hold, chgreq, and quote.
   - *Alternative:* the prototype's module counters.
   - *Why:* ids are deterministic, restart at 0001 after Reset seed with nothing to rewind, and keep addendum C12's `_p` infix.
8. **The portal still writes three BillingAccount fields:** autopay, paymentMethodOnFile (on save), and the pastDue/active status flip after a payment. Suspended and hold are never touched.
   - *Alternative:* stub them for account as the hold and cart change are stubbed.
   - *Why:* runbook scenario 1 must end with the pill reading Active and autopay on, and the prototype's entry 36 kept these writes pending the merge's decision. Phase 3 may route them through account's actions.
9. **Runtime stamps use the engine clock.** Payment.receivedAt, PaymentMethod.savedAt, and portalLog.at are `stamp()`, noon EDT on today(). Date defaults are `today()`.
   - *Alternative:* the prototype's constant TODAY plus the wall clock.
   - *Why:* one clock across the app (addendum E1), so the portal agrees with the persona bar after billing's Next cycle. Payment history breaks a tie on receivedAt by the later id, so two payments in a session still list newest first.
10. **Preview charges carry an explicit id** (`PREVIEW_CHARGE_ID`). This covers the extra pickup quote, the next invoice estimate, and the cart change totals.
    - *Alternative:* call computeCharge without one, as the prototype did.
    - *Why:* the canonical computeCharge would call nextChargeId(), which advances billing's `chg_bl_` counter. Every portal render would then shift the ids billing's next run hands out. A booked extra pickup gets `chg_p####`.
11. **The extra pickup charge is ruleWon standardRate, source `{ type: 'manual', id: 'eventRates.extraPickup' }`, lineType event, approved.**
    - *Alternative:* let the canonical computeCharge default a manual source to manualException.
    - *Why:* it is a flat table rate (addendum C11), as billing prices every event exception, and the prototype's entry 39 made the same call.
    - The booking also refuses a suspended or held account itself (invariant 4), not only the screen.

## Routes and screens

12. **Sections are sub-routes: `/customer/portal` (Overview), `/customer/portal/billing`, `/customer/portal/requests`.** The left nav uses NavLinks, and an unknown sub-path lands on the Overview. The account and site switcher stays inside the surface, in the portal slice.
    - *Alternative:* keep the tab in React state.
    - *Why:* every section gets a URL (the walk and the screenshots use them), and App.tsx already mounts a splat. The session is store state, so a site or account switch keeps the section, as before.
13. **The drawer, its backdrop, and the portal top bar sit under the persona bar.** The drawer and backdrop start at `top: var(--pb-height)`; the sticky top bar sticks there.
    - *Alternative:* the prototype's `top: 0`, which would slide the top bar under the persona bar and cover the persona tabs with a sheet.
    - *Why:* the persona bar is the app's only cross-surface navigation, so it stays visible and clickable.
14. **The portal keeps its own look and 1120px column.** The four layout drifts portal/DESIGN.md lists against the Paper artboards are not closed here.
    - *Alternative:* restyle to the artboards now.
    - *Why:* box 2C.4 asks for the prototype's look at 1440, and the rule is not to restyle during a port. Computed values match the prototype exactly: body 14px/21px, text-xs 12px/18px, panel border and radius, pill padding and line height.

## Styles (src/styles/surfaces/portal.css)

15. **Line heights: all six portal sizes set `--rt-text-*--line-height` to 1.5**, the body's `--leading-normal`.
    - The prototype's config gave them none, so they inherited the body's unitless 1.5; setting the same unitless value reproduces it at every size.
    - Measured: text-xs is 12px/18px in both apps.
    - *Alternative:* the Paper per-size leadings (16px, 18px, ...), which would change every row height.
16. **Tailwind 3 to 4 audit.** The brief's four hazards, checked across every className in portal/src:
    - *Border:* every width utility (`border`, `border-t`, `border-b`) already pairs with `border-border`, so Tailwind 4's currentColor default never applies. The two bare `border` uses (the Overview photo and the drawer photo) render 1px #ECEBFF, the prototype's color.
    - *The rest:* `outline-none`, `shadow-sm`, and bare `ring` appear in no className. The one `outline: none` is inside `.tl-field:focus`, plain CSS that Tailwind does not rename.
    - *Not in the brief, also set back inside the wrapper:* Tailwind 3's preflight pointer cursor on buttons and its gray-400 placeholder color. Also `--rt-color-gray-200: #e5e7eb`, `--rt-color-white: #fff`, and bare `--rt-radius: 0.25rem` (Tailwind 3's values for the names the portal did not configure).
17. **The `--leading-tight` name clash.** Portal's own alias `--leading-tight` (1.15, read by `.tl-pill`) has the same name as the variable Tailwind's `leading-tight` utility reads. shared/tokens.css also changes that variable app wide.
    - The wrapper sets `--leading-tight: 1.25` (Tailwind 3's utility value, used by the drawer title) and `--tracking-tight: -0.025em`.
    - `.tl-pill` now reads `--tl-leading-tight` directly, so the pill keeps 1.15 (13.8px, measured in both apps).
    - *Alternative:* keep the alias, which silently makes the drawer title 1.15.
18. **Everything is nested under `.surface-portal`.** The portal's alias variables and all component classes are nested there, including .tl-card, .tl-pill, .tl-table, .tl-drawer, and .tl-money. The built CSS has no unscoped `.tl-panel` or `.tl-pill--*` rule.
    - The ground (font, 14px, 1.5, ink, bg) sits on the wrapper with `min-height: calc(100vh - var(--pb-height))`, as billing's does.
    - tl-tokens.css is not repeated, since it is src/styles/tokens.css.
19. **Photos resolve through src/seed's resolvePhoto to absolute `/photos/`.** Billing's `/evidence/maple-extra-bags.jpg` maps to `/photos/ev_maple_extrabags.svg`, and the pending blocked event's `/photos/blocked-driveway.svg` passes through. Both load at 1440 with no 404.

## Figures on the merged seed, against the prototype

| Figure | Prototype (portal/RUNBOOK.md, portal/DESIGN.md) | Merged app | Note |
|---|---|---|---|
| Maple past due (open on the Q3 invoice) | $87.45 (8745) | $87.45 (8745) | Invoice INV-2026-0203, total $180.74, paid $93.29 by pay_card_maple_0720. The prototype's inv_maple_2026q3 carried a late fee line and totaled $190.74. |
| Maple Q3 96 gal line | $102.61 | $102.61 | base $87.00, fees $9.09, tax $6.52 |
| Maple Q4 estimate at the site | not recorded | $180.74 | $150.00 + fees $19.50 + tax $11.24 |
| Scenario 1 payment | $87.45 to inv_maple_2026q3 | $87.45, pay_p0001, one allocation to INV-2026-0203 | Account pill Active, autopay on, Visa ending in 4242 |
| Missed pickup default date | 2026-09-07, blocked | 2026-09-07, completed with extra bags and photo | Billing's scenario 4 event owns that Monday |
| Blocked stop with photo, no recovery | 2026-09-07 | 2026-08-24 (pending-seed event, entry 5) | Driver note and R. Alvarez as in the prototype |
| Missed stop, recovery | 2026-08-24, recovery Friday, Sep 11 | 2026-08-17, recovery Friday, Sep 11 (wo_p0001) | Window 28 days (entry 6) |
| Extra pickup | $28.62 (base $25.00, fuel $1.75, tax $1.87), Monday, Sep 14 | same | Route capacity reads 103 open stops (prototype 8): billing's route_mon_res has 120 stops and 17 regular |
| Oakridge | Four sites, open September invoice $919.92, net30 in arrears | Four sites (site 2 is "Oakridge Commons Bldg B, 1500 Oakridge Pkwy", PO-OAK-B2026), three paid invoices of $646.00, balance $0.00, billed in advance, tax exempt | Billing's seed |
| Quote follow-up | quote_p0001, Friday, Sep 11, 10:00 am | quote_p0001, Friday, Sep 11, 10:00 am | Request req_p0003 in the walk (after the two Maple scenarios) |
| Invariants panel | 4 of 4 pass | 4 of 4 pass, before and after all four scenarios | |

## Requests from portal port

1. **Seed: two Maple field events** in billing's generator (scripts/gen_seed.ts), so lib/fieldEvents.ts can be deleted:
   - `evt_maple_missed_0817`: site_maple, route_mon_res, 2026-08-17, missed, note "Stop skipped, truck full, no photo", driver R. Alvarez.
   - `evt_maple_blocked_0824`: site_maple, route_mon_res, 2026-08-24, blocked, photoUrl `/photos/blocked-driveway.svg`, note "Cart blocked by a parked vehicle in the driveway", driver R. Alvarez.
   - Neither has an exception, so no billing figure moves.
2. **Seed: `paymentMethodOnFile`** `card` on acct_res_maple and `ach` on acct_pm_oakridge. The portal's saved methods (Visa 4242, ACH 6710) are ahead of the seed until then. Holt and the roll off homeowner already agree.
3. **src/store/slices/slices.test.ts "placeholders contribute nothing yet"** lists portal (and the other three) as empty placeholders, so it fails once any Phase 2 slice is filled. It already fails today on account's slice. It needs updating when the manager merges Phase 2; I did not touch it.

## For Phase 3 (box 3.3 and the L notes)

- **Requests** are in `db.requests`, `createdVia: 'portal'`, ids `req_p####`, with `workOrderId` set whenever a work order exists:
  - extraPickup: scheduled, work order kind extraPickup.
  - missedPickup: scheduled with a recovery work order, or open with no work order for a dispute, an office note, or a handoff.
  - vacationHold: scheduled, note `Vacation hold <start> to <end>, pickups resume <date>`, no work order.
  - cartChange: scheduled, swap work order.
  - quote: open, note names the quote_p id.
  - Any failed check files an open Request whose note is the reason.
- **pendingChanges** (`state.pendingChanges`, type `PendingChange` in src/store/slices/portal.ts): `{ id: 'chgreq_p####', serviceItemId, fromCatalogId, toCatalogId, effectiveFrom /* next cycle start */, requestId, workOrderId }`. There is one per service item. Account turns it into the ServiceItem change; the portal never edits ServiceItem.
- **holds** (`state.holds`, type `Hold`): `{ id: 'hold_p####', serviceItemId, start, end }`, one row per held item. The matching vacationHold Request is at the same site with the range in its note. `portalRequestServiceItemHold` only logs `stub:requestServiceItemHold` with the item ids and range; account applies ServiceItem.status and any account status.
- **quoteRequests** (`state.quoteRequests`, type `QuoteRequest`): `{ id: 'quote_p####', quote: Quote /* commercialRequest draft, priceCents 0, createdVia agent */, accountId, siteId, material, accessNotes?, requestId, followUpBy }`. Pricing's workbench takes `quote` as is.
- **Extra pickup money:** the approved `chg_p####` Charge (event, manual source) and its unallocated settled `pay_p####` Payment are in db. Billing's run does not pick up approved charges outside its generated set, so posting them and allocating the payment is the Phase 3 hand-off (addendum L). Until then, billing's Payments tab shows the payment as unapplied cash.
- **BillingAccount writes** (entry 8) are the candidates to route through account.
