# PORT_DECISIONS.md: storefront port (CHECKLIST.md 2D.1 to 2D.5)

Judgment calls made while porting storefront/src into the merged app, for the manager to merge into the root
DECISIONS.md. Each entry names the call, the alternative, and the reason. Section order: structure, store, pricing and
figures, styles, tests, then requests from the storefront port.

## Structure

1. **Pure planners in src/surfaces/storefront/lib, commits in the slice.** lib/offer, signup, held, commercial,
   serviceability, payments, and agent return records and never write. The slice (src/store/slices/storefront.ts)
   calls a planner, which throws before anything is written on a declined card or a bad input, then commits the
   result in one `get().mutateDb(fn, patch)`. *Alternative:* keep the prototype's transaction modules that called
   `useStore.setState` themselves. *Why:* the store contract allows db writes only through mutateDb, and a pure planner
   can be tested without a store. It also keeps lib free of any import of useStore, so the slice can import lib without
   an import cycle.
2. **The prototype's engine.ts is gone; every price is the canonical engine.** lib/offer.ts calls `resolvePrice(args, db)`
   and `computeCharge(args, db)` from src/store/engine.ts with the trailing db (addendum C2). The prototype's
   `roundHalfUp` and `pctOf` went with it (C6 rounding is the engine's). *Alternative:* keep a storefront copy that
   agrees. *Why:* addendum C1 and box 2D.3.
3. **A keyed view over the Db (lib/view.ts `viewOf`).** The Db stores arrays; the storefront code looks rows up by id.
   `viewOf({ db, quoteIntake, paymentTokens })` builds keyed tables once per Db object and returns the same view object
   for the same three inputs. *Alternative:* rewrite every `catalog[id]` lookup as `db.catalog.find(...)`. *Why:* fewer
   edits to proven code, O(1) lookups, and a stable object that React selectors can return without re-rendering loops.
4. **Nested routes replace the hash router.** The prototype routed with one `screen` value plus `#office` and
   `#status/<id>`. Now each screen is a path under /customer/store (lib/paths.ts, routes.tsx): `` landing, `offer`,
   `boundary`, `boundary/hold`, `checkout`, `success`, `franchise`, `not-served`, `status/:quoteId`, `commercial`,
   `office`, `office/store`. An unknown sub-path redirects to the landing. *Alternative:* keep the hash listener inside
   the splat route. *Why:* box 2D.1 asks for nested routes; real paths make every screen linkable and the browser back
   button works. The status link the buyer saves is now `/customer/store/status/<quoteId>`.
5. **The storefront header stays, with its own four items.** TopBar keeps the hauler name (start over), the "For a
   business" switch, "Office", and "Agent view". *Alternative:* drop "Office" because the persona bar owns navigation.
   *Why:* those four are part of the storefront page, not cross-surface navigation. The office approval screen is a
   storefront screen (OWNERSHIP.md), and the persona bar has no link to it, so without "Office" it would be unreachable
   (request R7).
6. **The agent drawer and store inspector come along inside the wrapper.** The drawer now starts below the persona bar
   (`top: var(--pb-height)`) at z-index 20, so the bar stays clickable while the drawer is open. *Alternative:* the
   prototype's full-height drawer. *Why:* the persona bar is sticky at z-index 30 and the drawer would cover its right
   end (Reset seed).

## Store

7. **The slice holds quoteIntake, paymentTokens, and sfUi.** sfUi is the buyer's flow state (typed address, selections,
   contact, autopay, business toggle, drawer open, and this session's receipts). *Alternative:* keep the prototype's
   second zustand store for UI state. *Why:* one store (DECISIONS.md entry 2), and Reset seed in the persona bar
   rebuilds every slice, so receipts never point at a record the reset removed. Billing keeps its UI state in its slice
   the same way.
8. **Every key except quoteIntake and paymentTokens starts with `sf`** (sfUi, sfSubmitAddress, sfCompleteInstantSignup,
   sfApproveHeldQuote, and so on). *Alternative:* the prototype's names (`approveHeldQuote`, `tokenizeCard`). *Why:*
   keys must be unique across the store and three other ports are adding slices at the same time; quoteIntake and
   paymentTokens keep the names CHECKLIST.md gives them.
9. **What a signup writes, in one mutateDb:** Party, BillingAccount, Site, and per selected line one ServiceItem, one
   Container, and one deliver WorkOrder, then the approved first-cycle Charges (one recurring per line, then the
   delivery fee) and one settled card Payment. Office approval writes the same set plus the Quote flipped to accepted,
   in the same update, with the intake stamp and the receipt as the patch. *Alternative:* write in several set calls.
   *Why:* box 2D.2, and a test proves each transaction is exactly one store update.
10. **Containers are new.** The prototype left `containerIds: []`. Now each ServiceItem gets one cart
    (`cart_sf_####`, catalogId of the line, siteId, assignedFrom the delivery day), its id goes on
    `ServiceItem.containerIds` and on the deliver `WorkOrder.containerId`, as billing's seed does. The serial is a
    placeholder `SF-####` until the driver scans the real cart. *Alternative:* no Container until delivery. *Why:* box
    2D.2 lists containers, and the account view and billing read carts through containerIds.
11. **The signup no longer appends the site to `Route.stopSiteIds`.** *Alternative:* keep the prototype's route write.
    *Why:* OWNERSHIP.md makes Route seed-only, box 2D.2's write list has no routes, and the Site already carries its
    routeId, so the stop list can be derived.
12. **An instant signup writes no Quote.** Quotes are written by the held path (created held, then accepted or declined)
    and the commercial path (draft). *Alternative:* record every instant signup as an accepted residentialSignup Quote.
    *Why:* the prototype and its runbook never did, and a quote nobody reviewed would show up in the office list.
13. **Runtime ids: one `_sf_` counter across every prefix** (addendum C12). It starts above the highest `_sf_` suffix in
    the Db and the sidecars and keeps counting across Reset seed, as the prototype did. *Alternative:* a counter per
    prefix, or restarting at 1 after a reset. *Why:* the ids of one signup read in mint order, and no id repeats in a
    session.
14. **Offer charges carry fixed ids (`chg_offer_<catalogId>`, `chg_offer_delivery`).** *Alternative:* let computeCharge
    mint one. *Why:* the canonical computeCharge mints `chg_bl_####` from billing's module counter when no id is given,
    so pricing an offer on every keystroke would advance billing's charge ids.
15. **The storefront clock follows the engine clock.** lib/clock.ts `today()` is src/store/clock.ts `today()`, and
    `now()` is 10:00 AM Eastern on that day (the prototype's NOW). *Alternative:* keep the prototype's fixed TODAY.
    *Why:* the persona bar says every surface reads its date. When the billing run moves the clock, start dates and
    rates move with it, which is what Phase 3.4 needs (a test prints Sep 29 at 2600 and Oct 6 at 2700 for cat_res_64).
16. **The seed quotes' sidecars live in the slice's initial state** (lib/seedSidecars.ts): the intake rows for
    quote_held_ridge and quote_bakery_request, and the card token tok_ridge_4242. Billing's seed row for
    quote_held_ridge has no paymentTokenId, so `savedTokenId(quote)` falls back to `SEED_QUOTE_TOKENS` (request R4).
    Superseded in Phase 3 (root CHECKLIST box 3.7g): the seed row now carries tok_ridge_4242, so `SEED_QUOTE_TOKENS`
    and the fallback are deleted and `savedTokenId` reads the Quote's own paymentTokenId.
17. **A held quote shows and charges what the engine computes for its preserved lines** (`heldAmounts`,
    `previewApproval`). For a quote the storefront created this equals its own dueTodayCents and recurringCents (a test
    proves it). Billing's quote_held_ridge carries illustrative totals (11200 and 2900, addendum I4), so the office row,
    the status screen, the agent replay, and the charge all use the engine's figure for its line. The Payment always
    equals the sum of the approved charges. *Alternative:* charge the Quote's dueTodayCents as the prototype did. *Why:*
    on billing's seed that would charge $112.00 against $128.36 of approved charges and leave the first invoice open.
    Preserved prices are still a promise: when the rate card moved since the hold, the line keeps its promised price
    and is marked manualException (tested).

## Pricing and the figures on billing's seed

18. **The environmental fee on the first quarter is $2.00, not $3.00, and the port accepts the canonical engine.**
    The storefront bills startDate to startDate plus three months (Sep 15 to Dec 15, addendum C13). The canonical
    `wholeMonths` counts only calendar months the period fully covers (October and November), so fee_env_1 applies
    twice. The prototype's engine counted three. *Alternative:* add $1.00 back in the storefront. *Why:* box 2D.3 says
    prices come from the canonical engine, and this is an engine rule (request R2). The price panel labels the line
    "Environmental fee, $1.00/mo, 2 whole months" so the amount beside it adds up; it drops back to the prototype's
    label when the engine counts three.
19. **Merged seed names show as they are.** Zone names are billing's ("Open market", "Boundary", "City franchise"), so
    the offer reads "Open market zone." and the franchise screen "530 Main St is inside the City franchise." Catalog
    names are billing's ("96 gal cart", not "96 gallon cart"). Rate version and tax rule ids are billing's
    (rv_res_96_2026, rv_res_96_2026_boundary, tax_zone_open). No test hard-codes a derived id. *Alternative:* a
    storefront name map. *Why:* the seed is billing's, and the franchise holder still comes from the address.
20. **Storefront copy for frequencies stays storefront-local** (lib/offer.ts `frequencyLabel`: "every other week",
    "twice a week"). Billing's engine labels read "2x weekly". *Why:* buyer copy, not a charge description billing posts.

Figures observed on the merged seed at 1440, walked headless on 5204 (`/customer/store`), next to the prototype's
(storefront/RUNBOOK.md, 5173):

| Screen or record | Prototype | Merged | Why it moved |
|---|---|---|---|
| 412 Larkspur: 96 gal weekly | $29.00/mo | $29.00/mo | |
| Service, 3 months / delivery / fuel 7% | $87.00 / $25.00 / $6.09 | $87.00 / $25.00 / $6.09 | |
| Environmental fee | $1.00/mo: $3.00 | $1.00/mo, 2 whole months: $2.00 | entry 18 |
| Estimated tax, 7% | $8.27 | $8.27 | the environmental fee is not taxed |
| Due today / every quarter / a month | $129.36 / $102.61 / $34.20 | $128.36 / $101.61 / $33.87 | entry 18 |
| Recurring charge / delivery charge | 10261 / 2675 | 10161 / 2675 | entry 18 |
| Payment (dueTodayCents) | 12936 | 12836 | entry 18 |
| 88 Copper, extra cart on: due / quarter | $163.27 / $136.52 | $161.27 / $134.52 | entry 18 (two lines) |
| 2071 Meadow, recycling on: due / quarter | $173.58 / $146.83 | $171.58 / $144.83 | entry 18 (two lines) |
| 1180 Ridge, boundary: 96 gal | $31.00/mo | $29.00/mo | billing's seed prices zone_boundary like zone_open (R5) |
| 1180 Ridge: due when approved / quarter | $136.23 / $109.48 | $128.36 / $101.61 | R5 and entry 18 |
| Held quote dueTodayCents / recurringCents | 13623 / 10948 | 12836 / 10161 | R5 and entry 18 |
| Seed quote_held_ridge on the Quote row | 13623 / 10948 | 11200 / 2900 (billing's seed) | R4 |
| Seed quote_held_ridge approval charge | $136.23 | $128.36 | entries 17 and 18 |
| Dates | Cart Mon Sep 14, pickup Tue Sep 15; deadline Sun Sep 13 10:00 AM; held until Thu Sep 17; commercial reply Fri Sep 11 | identical | |
| Commercial Quote | draft, $0.00, expires 2026-10-10T10:00:00-04:00 | identical | |
| Rate version on the recurring charge | rv_res_96_open_weekly / rv_res_96_boundary_weekly | rv_res_96_2026 / rv_res_96_2026_boundary | billing's ids |
| Store inspector after the walk | 18 records | 20 records (2 more: the two Containers) | entry 10 |

## Styles (src/styles/surfaces/storefront.css)

21. **Only --rt-* variables are set, inside .surface-storefront.** The five trashlab.com values that differ from
    shared/tokens.css (cyan #10A6CC, brand deep #201A69, ground #F6F7FB, card border #E2E8F0, and the display, title,
    radius, and pill sizes) are raw values there, exactly as in the prototype's tokens.css. Every other value is its
    --tl- alias. No --tl- name is redefined, so the shared --tl-brand-deep (#2F2A90) and --tl-cyan (#10D6E6) keep their
    values everywhere, including inside the storefront. *Alternative:* redefine --tl-cyan and --tl-brand-deep inside the
    wrapper. *Why:* the brief, and a walk check proves :root and .surface-billing carry none of the five values.
22. **Bare `rounded` is 8px** (`--rt-radius: var(--tl-radius-sm)`), the prototype's DEFAULT = radius-sm.
23. **The prototype's html ground moves to the wrapper** (Manrope 16/24, ink on #F6F7FB, antialiased), and `.sf-page`
    fills the viewport below the persona bar instead of `min-h-screen`.
24. **Tailwind 3 to 4, checked utility by utility.**
    - Bare `border`: all 38 uses already carry an explicit color class (`border-line`, `border-warning`, and so on).
      The one conditional (the office tab's `border-b-2`) gets `border-accent` or `border-transparent`. A script over
      every class string confirmed it, so no border class changed.
    - `outline-none` became `outline-hidden` (9 uses) and `shadow-sm` became `shadow-xs` (1, the switch knob).
    - Bare `ring`: the one match in the prototype is inside a comment in components.tsx; no element uses it.
    - `flex-shrink-0` became `shrink-0` (11 uses). Tailwind 4 removed `flex-shrink-*`.
    - Tailwind 3's preflight gave buttons a pointer cursor; Tailwind 4 does not. It is restored in `@layer base` inside
      the wrapper, so `disabled:cursor-not-allowed` still wins.
    - `font-regular` (2 uses in the inspector) was not a Tailwind 3 class, so the prototype rendered those counts in
      the heading's semibold. shared/tokens.css now makes it a 400 utility. It is removed, so the counts look as they
      did.
    - A second scan compiled the app and confirmed every class the storefront uses has a rule in the built CSS.
25. **`text-eyebrow` is repaired inside the wrapper.** The bridge declares `eyebrow` as a color (account's
    `--color-eyebrow`) and as a font size (storefront's `--text-eyebrow`). Tailwind 4 emits only the color rule for
    `text-eyebrow`, so the eyebrow rendered 16/24 in #5149D7 and every screen sat 3px high. The wrapper sets
    `--rt-color-eyebrow` to the cyan (every storefront eyebrow is cyan) and restores the 18/27 size in
    `@layer utilities`. *Alternative:* rename the class to an arbitrary value. *Why:* the bridge exists so no className
    is renamed, and the collision is the bridge's to fix (request R6).

## Tests

26. **The prototype's nine test files are moved to src/surfaces/storefront/__tests__.** agent, agentDrawer, clock,
    commercial, held, offer, serviceability, and signup are moved and adapted to the slice and the view. engine.test.ts
    becomes pricing.test.ts: it now proves the canonical resolvePrice and computeCharge on billing's seed through the
    provisional site. The prototype's "not implemented in storefront" case is dropped, because the canonical engine
    implements those functions. Two files are new: slice.test.ts (the store contract: sf keys, a side-effect-free
    creator, reset, ids across reset, branch routing) and branches.test.tsx (jsdom: the four runbook branches plus the
    decline, driven through the rendered surface under /customer/store). 79 tests.
27. **Tests never hard-code a derived id.** Rate version and tax rule ids are looked up from the seed. Only the shared
    top-level ids (zones, routes, catalog, accounts, contracts, quotes) appear literally.

## Requests from storefront port

- **R1. src/store/slices/slices.test.ts (resolved upstream, no action).** Its old "placeholders contribute nothing
  yet" case expected the storefront slice to return `{}`, which box 2D.2 makes false. While this port ran, the file
  was rewritten to check that no two slices share a key, and the storefront slice passes it.
  src/surfaces/storefront/__tests__/slice.test.ts proves the storefront keys themselves.
- **R2. Engine `wholeMonths` (src/store/cycles.ts, used by computeCharge) and a mid-month quarter.** Addendum C5 says a
  quarterly 96 gal carries fee_env_1 at 300. The canonical engine charges 200 for the storefront's first period
  (Sep 15 to Dec 15), because it counts only calendar months the period fully covers. A count that also works for
  anniversary periods would be: the largest m with `addMonths(start, m)` on or before the day after `end`. That gives
  3 for Sep 15 to Dec 15 (exclusive end), 3 for Sep 15 to Dec 14 (inclusive end), and still 3 for Oct 1 to Dec 31,
  so billing's figures do not move. Until then the storefront shows the engine's figures (entry 18).
- **R3. Period end convention for C13.** Storefront charges carry `period: { start: startDate, end: startDate + 3
  months }`, which is Sep 15 to Dec 15 (the prototype's exclusive end, where Dec 15 also starts the next period).
  Billing's `periodFor` uses an inclusive end (Oct 1 to Dec 31). Please decide one convention before Phase 3.2. The
  storefront can switch to an inclusive end (`addMonths(start, 3) - 1 day`) in one line in lib/offer.ts
  `assembleOffer`.
- **R4. Seed quote_held_ridge (src/seed/quotes.json, billing's).** Addendum D6 says the storefront is its source.
  Billing's row has address "17 Ridge Rd" (not an address in addresses.json), dueTodayCents 11200, recurringCents 2900,
  no paymentTokenId, and holdDeadline Sep 11. Please set the address to "1180 Ridge Hollow Rd, Piedmont, GA 30512" and
  paymentTokenId to "tok_ridge_4242". Please set the totals to what the engine computes for its line: 12836 and 10161
  on the current engine, or 12936 and 10261 once R2 lands. The storefront works either way (entries 16 and 17).
- **R5. zone_boundary residential prices.** Addendum C4 says zone_boundary has its own rows and its own higher price.
  Billing's seed has its own rows (rv_*_2026_boundary) but at the open-zone prices (2900, 2600, 900, 1200). The
  prototype's seed had 3100, 2800, 1000, and 1300. The storefront reads whatever the seed publishes, so no storefront
  change is needed. Please decide whether the seed moves.
- **R6. Theme bridge collision: `--color-eyebrow` and `--text-eyebrow`** (src/styles/theme.css). Tailwind 4 emits only
  the color utility for `text-eyebrow`, so any surface using it as a font size loses the size. That is the storefront,
  and also pricing (BulkIncreaseControl.tsx, PublishPreviewModal.tsx). Storefront works around it inside its wrapper
  (entry 25). One way to fix it for every surface is to rename account's color token (say `--color-eyebrow-ink`) in
  theme.css and in account's classes.
- **R7. Persona bar: link the office approval screen.** It is a storefront screen at /customer/store/office (held
  signups approved, then charged and activated). Today it is reachable only from the storefront header's "Office" link.
  Please add it under the Office persona in src/shell/routes.ts, for example
  `{ label: 'Storefront approvals', to: '/customer/store/office', surface: 'storefront' }`.
- **R8. Fonts.** None needed: index.html already loads Manrope 400 to 800, which covers every storefront weight.
- **R9. Shell class `pb-main` is also a Tailwind utility** (src/shell/Layout.tsx, src/styles/tokens.css). tokens.css
  declares `--spacing-main` (the 936px Paper main width) in its `@theme`, and Tailwind scans the string `pb-main` in
  Layout.tsx. It therefore generates `.pb-main { padding-bottom: 936px }`, and every route gets 936px of empty page
  below its surface. Measured at 1440 x 900: on /customer/store the document is 1987px tall for 1003px of storefront;
  on /office/billing it is 1836px for 852px of billing. Renaming the shell class (for example `shell-main`) fixes it for
  every surface. The storefront itself is unaffected: its wrapper is exactly the prototype's height.

## Phase 3 notes

- Signup and approval write exactly these rows (ids are session-numbered; shapes are exact):
  - `parties`: `{ id: party_sf_####, name, kind: 'homeowner' }`
  - `accounts`: `{ id: acct_sf_####, payerPartyId, cycle: 'quarterly', billedInAdvance: true, autopay, paymentMethodOnFile: 'card', status: 'active', deliveryMethod: 'email', taxExempt: false }`
  - `sites`: `{ id: site_sf_####, accountId, occupantPartyId, address, zoneId, routeId, accessNotes? }`
  - `serviceItems`: per line `{ id: si_sf_####, siteId, catalogId, qty: 1, frequency, containerIds: [cart id], effectiveFrom: startDate, status: 'active' }`
  - `containers`: per line `{ id: cart_sf_####, serial: 'SF-####', catalogId, siteId, assignedFrom: startDate - 1 day }`
  - `workOrders`: per line `{ id: wo_sf_####, siteId, kind: 'deliver', status: 'scheduled', scheduledFor: startDate - 1 day, serviceItemId, containerId }`
  - `charges`, all `status: 'approved'`: per line a recurring charge `{ id: chg_sf_####, lineType: 'recurring', catalogId, source: { type: 'serviceItem', id: si }, period: { start: startDate, end: startDate + 3 months }, baseCents: monthly x 3, fees, taxCents, totalCents, pricing: { rateVersionId, ruleWon: 'zoneRate' } }`, then one delivery charge `{ lineType: 'fee', source: the first service item, servicedOn: startDate - 1 day, baseCents: zone.deliveryFeeCents, pricing: { ruleWon: 'zoneRate' } }`. `SignupResult.chargeIds` lists them in that order.
  - `payments`: `{ id: pay_sf_####, accountId, method: 'card', cents: sum of those charges' totalCents, receivedAt: '<today>T10:00:00-04:00', status: 'settled' }` (`SignupResult.paymentId`).
  - The held path adds the Quote update (`status: 'accepted'`), and the slice's quoteIntake gets reviewedBy and reviewedAt.
- For C13 the ids to fold into the first invoice are `SignupResult.chargeIds` and `SignupResult.paymentId`, also kept
  in the slice as `sfUi.signup.result` (instant) and `sfUi.approvals[quoteId]` (approved hold). From the Db alone they
  are: every Charge with `status: 'approved'` and an `_sf_` id on the account, and the Payment with an `_sf_` id on the
  account.
- Billing's `alreadyBilled` matches `period.start` exactly against the cycle date, so it will not skip the storefront's
  service item. The storefront period starts Sep 15, and billing's quarterly run is Oct 1 (Oct 1 to Dec 31). The
  October run would propose a second recurring charge for Oct 1 to Dec 31 on a new account, which is double billing
  for Oct 1 to Dec 15. Phase 3.2 needs a coverage rule (request R3).
