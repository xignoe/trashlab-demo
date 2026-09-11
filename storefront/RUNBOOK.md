# RUNBOOK: TrashLab Storefront

The prospective customer storefront for Piedmont Disposal: an address check, a complete price, and a signup. Four branches: open zone (instant signup), franchise stop, boundary (held for review, then office approval), and commercial request.

## Start

From `/Users/kevinquimbo/Projects/TrashLabWorkTrial/storefront`:

```sh
npm install
npm run dev      # http://localhost:5173 (always 5173; if the port is busy it exits with "Port 5173 is already in use")
npm test         # vitest, 62 tests
npm run build    # tsc --noEmit, then vite build
npm run validate:seed   # optional: every seed reference resolves
```

- The clock is fixed. Today is Thu Sep 10 2026 and "now" is 10:00 AM Eastern (`TODAY` and `NOW` in src/store/clock.ts), so every date and deadline below is the same on any day you run it.
- Refresh the checklist dashboard with `python3 scripts/build_dashboard.py CHECKLIST.md`. This is safe while the dev server runs, because Vite ignores dashboard.html, progress.json, and the root .md files, so the page does not reload.
- The address field suggests the six seed addresses as you type. Pick one with the mouse, or with the arrow keys and Enter.

## Walk all four branches in under 3 minutes

Open http://localhost:5173 in a fresh tab. The address field is already focused. Each step lists its time budget, what to do, and the exact text you should see. Ids like `acct_sf_0002` are numbered by the session, so yours may differ.

### 1. Open zone, single cart (0:00 to 0:40)

1. Type `412 Larkspur` and press Enter.
   - Headline: "We serve 412 Larkspur Ln. Pickup is every Tuesday."
   - The price panel shows:
     - 96 gallon cart, weekly: $29.00/mo
     - Service, 3 months: $87.00
     - One-time cart delivery: $25.00
     - Fuel surcharge, 7%: $6.09
     - Environmental fee, $1.00/mo: $3.00
     - Estimated tax, 7%: $8.27
     - **Due today $129.36**, then **every quarter $102.61**, "About $34.20 a month, all in"
   - First pickup options: Tue Sep 15 (cart arrives Mon Sep 14) and Tue Sep 22.
2. Click **Continue to checkout**. Fill in Full name, Email, and Last 4 digits `4242`. Click **Pay $129.36 and start service**.
   - Headline: "Cart arrives Mon Sep 14, first pickup Tue Sep 15."
   - "Your account" shows `acct_sf_...`, `site_sf_...`, and one work order `wo_sf_...`. "What you paid" shows $129.36.
   - Optional decline check: use last 4 `0002` instead. Expect "Your card ending in 0002 was declined by the payment provider. Nothing was charged and no account was created. Try a different card." Nothing is written to the store.
3. Click **Start over**.

### 2. Open zone, second cart (0:40 to 0:55)

1. Type `88 Copper` and press Enter.
   - Headline: "We serve 88 Copper Kettle Ct. Pickup is every Monday."
   - The Extra cart toggle is already on. The panel shows "Extra 96 gallon cart, weekly $9.00/mo", **Due today $163.27**, and **every quarter $136.52**.
2. Click **Check a different address**.

### 3. Open zone, recycling (0:55 to 1:10)

1. Type `2071 Meadow` and press Enter.
   - Headline: "We serve 2071 Meadowbrook Dr. Pickup is every Tuesday."
   - The Recycling toggle is already on. The panel shows "Recycling cart, every other week $12.00/mo", **Due today $173.58**, and **every quarter $146.83**.
2. Click **Check a different address**.

### 4. Franchise stop (1:10 to 1:25)

1. Type `530 Main` and press Enter.
   - Headline: "Your address is served under a franchise agreement with Southeast Sanitation. Here is how to start."
   - Three numbered steps: Call or visit Southeast Sanitation, Have this ready, When service starts. There is no price anywhere on the screen.
2. Click **Check a different address**.

### 5. Boundary, held, then office approval (1:25 to 2:25)

1. Type `1180 Ridge` and press Enter.
   - Headline: "We can probably serve 1180 Ridge Hollow Rd. Pickup would be every Tuesday."
   - A "Provisional price" pill, and the sentence "We can probably serve this address but need to confirm private road access before we start. Your price is held for 72 hours."
   - Boundary rates apply: 96 gallon cart $31.00/mo, **Due when approved $136.23**, **every quarter $109.48**.
2. Click **Continue to hold my price**. Fill in Full name, Email, Mobile (required on this path), and Last 4 digits `4242`. Delivery notes and the driveway photo are optional. Click **Hold my price and submit for review**.
   - Pill "Held for review", then "Quote quote_sf_...".
   - Headline: "Your price is held while we confirm your address."
   - Deadline bar: "We will text you by Sun Sep 13 10:00 AM at <your mobile>."
   - The panel shows $136.23 due when approved and "This price is held until Thu Sep 17."
3. Click **Office** in the top bar. The new quote is listed with the held quotes, and `quote_held_ridge` from the seed sits beside it. On the `quote_sf_...` row, click **Approve**.
   - Green receipt: "Approved. Charged $136.23 to Visa ending 4242. Cart arrives Mon Sep 14, first pickup Tue Sep 15." It also lists the created account, party, site, service item, work order, payment, and charges.
4. On the same row, click **Customer status**.
   - Pill "Approved", then the headline "Approved. Cart arrives Mon Sep 14, first pickup Tue Sep 15." The buyer has nothing left to do.
5. Click **Start over**.

### 6. Commercial request (2:25 to 2:55)

1. Switch **For a business** on in the top bar. Type `1500 Commerce` and press Enter.
   - Headline: "Tell us what your business needs."
   - The reason sentence: "Commercial pricing depends on material, frequency, and access, so we confirm it with you rather than guess." There is no price anywhere on the screen.
2. Pick **3 yard front load container**, **Cardboard**, and **Twice a week**. Type an access note. Fill in Full name and Email. Click **Send my request**.
   - Headline: "Request quote_sf_... received. A person will reply by Fri Sep 11 with a written price."
3. Switch **For a business** off.

### 7. Proof (2:55 to 3:00)

Click **Office**, then the **Store** tab. The records from this walk appear in the tables described below.

## Scenarios for the final pass, and where the proof appears

The store inspector is at **Office**, then the **Store** tab (also `#store`). It lists every record whose id is not in the seed (ids contain `_sf_`), and each row expands to its raw JSON. "Seed records changed" above the tables shows seed rows a transaction edited, with before and after. "Reset to seed" returns everything to the seed.

| # | Scenario | Where the proof appears in the store inspector |
|---|---|---|
| 1 | Instant signup lands an account and work order | **Billing accounts**: one quarterly, in advance, autopay on, card, active. **Sites**: the address on zone_open and route_tue_res. **Service items**: cat_res_96 weekly from 2026-09-15. **Work orders**: `deliver`, scheduled for 2026-09-14, scheduled. **Payments**: card, settled, $129.36. **Charges**: two approved charges. The recurring one has baseCents $87.00, fees fee_fuel_7pct $6.09 and fee_env_1 $3.00, taxCents $6.52, totalCents $102.61, and ruleWon zoneRate on rv_res_96_open_weekly. The delivery fee is $25.00 plus $1.75 tax, $26.75, zoneRate. **Seed records changed**: routes route_tue_res stopSiteIds. |
| 2 | Held signup is approved and activates | **Quotes**: the `quote_sf_...` residentialSignup, now accepted, due today $136.23, recurring $109.48, and the hold deadline. **Billing accounts, Sites, Service items, Work orders, Payments** ($136.23), and **Charges** (recurring $109.48 on rv_res_96_boundary_weekly, plus delivery) for the new account. If you approve the seed `quote_held_ridge` instead, **Seed records changed** shows quotes quote_held_ridge status, and quoteIntake quote_held_ridge reviewedBy and reviewedAt. |
| 3 | Franchise address stops | Nothing is written. The created-record count and every table stay where they were before the franchise check. The franchise screen and its agent transcript carry no dollar amount. |
| 4 | Commercial request saves a Quote | **Quotes**: a commercialRequest in draft on zone_open, due today $0.00, recurring $0.00. The header counts one more intake row, which holds the material, access notes, and contact. The same request shows in **Office approvals** with its intake details and "Priced by a person". |

## Notes

- **The store is in memory.** A reload, or "Reset to seed", returns every table to the seed. Status links like `#status/<quoteId>` for quotes created in a session stop working after a reload ("We could not find that request."). The seeded `#status/quote_held_ridge` link always works.
- **The boundary branch prices at boundary rates.** It is $136.23 due when approved and $109.48 each quarter, from zone_boundary's own rate versions ($31.00/mo for a 96 gallon cart), not the open zone's $129.36 and $102.61. The seed quote `quote_held_ridge` carries the same numbers.
- **Agent view.** The button in the top bar opens "How an intake agent would run this" on every screen. The thread is generated from the same address match, rate card, and clock as the page, and ends in a "Handoff to a person" card on the boundary and commercial branches. Escape closes it.
- **Card data.** The card widget takes brand, last 4, and expiry only. No card number field exists, and the store keeps a token (brand, last 4, expiry).

## Final-pass results

Run on 2026-09-10 (the app's fixed clock). The setup was a fresh `rm -rf node_modules && npm install && npm run build && npm test` (62 tests pass), then a fresh `npm run dev` on 5173, then a fresh page load. At the start the store inspector showed 0 created records in every table. The Browser pane was hidden during this session and dropped real clicks and key presses. The steps were therefore driven in the running app with DOM events (`element.click()`, and the input value setter plus an input event), which run the app's own handlers. The runbook texts above were read back from the screen.

Before the scenarios, the new error copy was checked. Checkout with expiry 01/2026 showed "That card has expired. Check the expiry date, or use a different card." The screen stayed on Checkout and nothing was written.

| # | Scenario | Result on screen | Ids created (store inspector) |
|---|---|---|---|
| 1 | Instant signup lands an account and work order | Pass. `412 Larkspur`, then checkout with Visa 4242, showed "Cart arrives Mon Sep 14, first pickup Tue Sep 15." and $129.36 paid. | Account `acct_sf_0002` (quarterly, in advance, autopay on, card, active). Party `party_sf_0004`. Site `site_sf_0005`. Service item `si_sf_0006`. Work order `wo_sf_0007` (deliver, 2026-09-14, scheduled). Payment `pay_sf_0003` (card, settled, $129.36). Charge `chg_sf_0008`: recurring, base $87.00, fee_fuel_7pct $6.09, fee_env_1 $3.00, tax $6.52, total $102.61, source serviceItem:si_sf_0006, zoneRate on rv_res_96_open_weekly, approved. Charge `chg_sf_0009`: fee, base $25.00, tax $1.75, total $26.75, zoneRate, approved. Card token `tok_sf_0001`. Seed records changed: route_tue_res stopSiteIds. |
| 2 | Held signup is approved and activates | Pass. `1180 Ridge` showed "We can probably serve 1180 Ridge Hollow Rd. Pickup would be every Tuesday." with $136.23 due when approved and $109.48 each quarter. Hold showed "Your price is held while we confirm your address." and "We will text you by Sun Sep 13 10:00 AM at 404-555-0142." Office, then Approve, showed "Approved. Charged $136.23 to Visa ending 4242. Cart arrives Mon Sep 14, first pickup Tue Sep 15." Customer status then showed "Approved. Cart arrives Mon Sep 14, first pickup Tue Sep 15." | Quote `quote_sf_0011` (residentialSignup, zone_boundary, accepted, $136.23 due, $109.48 recurring, hold deadline 2026-09-13T10:00:00-04:00). Account `acct_sf_0012` (autopay off, per DECISIONS 29). Party `party_sf_0014`. Site `site_sf_0015`. Service item `si_sf_0016`. Work order `wo_sf_0017` (deliver, 2026-09-14, scheduled). Payment `pay_sf_0013` (card, settled, $136.23). Charge `chg_sf_0018`: recurring, base $93.00, fuel $6.51, environmental $3.00, tax $6.97, total $109.48, zoneRate on rv_res_96_boundary_weekly. Charge `chg_sf_0019`: delivery, $26.75. |
| 3 | Franchise address stops | Pass. `530 Main` showed "Your address is served under a franchise agreement with Southeast Sanitation. Here is how to start." There is no dollar amount on the screen. | None. The inspector's table counts were identical before and after the franchise check. |
| 4 | Commercial request saves a Quote | Pass. With For a business on, `1500 Commerce` showed "Tell us what your business needs.", with no dollar amount on the form. Choosing 3 yard, Cardboard, and Twice a week, then Send my request, showed "Request quote_sf_0020 received. A person will reply by Fri Sep 11 with a written price." | Quote `quote_sf_0020` (commercialRequest, zone_open, draft, $0.00 due, $0.00 recurring), plus its intake row (material cardboard, access notes, contact Sam Okafor). |

End state in the store inspector: Parties 2, Billing accounts 2, Sites 2, Service items 2, Work orders 2, Quotes 2, Payments 2, Charges 4, and one seed record changed (route_tue_res).

## Phase 7 results: trashlab.com language

Run on 2026-09-10 (the app's fixed clock) against a fresh `npm run dev` on 5173, first at a 390x844 viewport and then at 1440x900, each from a fresh page load. The Browser pane was hidden, so as in Phase 6 the walk was driven with DOM events that run the app's own handlers (`element.click()`, and the input value setter plus input and Enter keydown events), and every value below was read from the DOM with getComputedStyle. `npx tsc --noEmit`, `npm run build`, and `npm test` (62 tests, unchanged) pass.

**No horizontal scroll at either width** (documentElement.scrollWidth equals the viewport) on Landing, Offer (open and boundary), Checkout, Success, Franchise, Boundary intake, Held status, Office approvals, Customer status, Commercial form and receipt, Store inspector, and with the agent drawer open. At 390px the header is two rows (112px). At 1440px it is 80px with a 1200px content box. The drawer is full width at 390px. At 1440px it is 460px wide beside the page (page padding 460px, price card ends at 948px, drawer starts at 980px), with the handoff card and 7 rules on the boundary branch.

**Text contrast**:
- Ink on the #F6F7FB ground: 15.3:1.
- Muted ink: 5.2:1.
- White on brand: 10.8:1.
- White 85% (hero copy): 8.2:1.
- White 80% (nav, stat lines): 7.5:1.
- The cyan eyebrow: 2.67:1 on the ground and 3.76:1 on indigo. It is below AA, trashlab.com's own choice, and accepted in DECISIONS.md entry 95. Every eyebrow is restated in ink on the same screen.

**Measured against ER-0 and ES-0 at 1440px**:
- **Header:** brand #312D97, 80px, white 32px tile with a cyan square, name 18px bold white, switch 40x24 on a white 18% track, "For a business" and "Office" in 14px semibold white 80%, "Agent view" as a 44px pill with a white 25% border.
- **Landing hero:** band padding 80px top and 88px bottom. Eyebrow 18/27 medium #10A6CC with the sparkle. Headline 48/60 bold white, 720px wide. The required sentence in 18/28 white 85%. A 640px white pill field (8px inset) with a map pin and the 50px "Check my address" pill inside it.
- **Typeahead:** opens below the field as a white 16px card. ArrowDown moves the active option (addr_open_single to addr_open_recycling). A mouse click on 412 Larkspur opens its offer.
- **Proof row:** three cards on #F6F7FB in one row at 1440px (stacked, 358px each, at 390px). Each has a 16px radius, a 1px #E2E8F0 border, 24px padding, 12px gaps, a 40px #ECEBFF tile (12px radius) holding a 14px lavender dot, a 24/32 bold title, and a 16/24 muted body, with ER-0's copy word for word (updated at the Paper comparison, DECISIONS.md entry 98).
- **Titles:** every screen's title below the header is 40/50 bold (30/37.5 at 390px).
- **Offer:** section labels 14px semibold. The add-ons are one bordered list with a divider.
- **Controls:**
  - Primary pill: 50px tall, 28px side padding, 16px/600, radius 9999px.
  - Secondary pill: white with a 1px #E2E8F0 border, 50px.
  - Compact pills: 44px (Office Approve and Decline, Store "Reset to seed", drawer Close, the intake file button).
  - Switches: 40x24.
  - Selected radio card: a 2px brand border on #ECEBFF. Unselected: a 1px #E2E8F0 border. Both have a 16px radius.
  - Inputs: 8px radius, 1px #E2E8F0 border.
  - The focus-visible ring rules (brand ring, bg offset; a white ring with a brand offset on the header) are in the built CSS.
- **Price card:** 32px radius and 32px padding. The stat block has a 2px #6260AF border, 16px radius, and a 40/48 bold amount. Its label reads "Due today" on the open branch and "Due when approved" on the boundary branch. The Checkout order summary shows the same block with $129.36, and the boundary intake and held status show it too ($136.23, then "Paid" after approval).

**The four final-pass scenarios still pass** at both widths, with the same texts and the same ids as the Phase 6 run:

| # | Scenario | Result | Ids created |
|---|---|---|---|
| 1 | Instant signup | Pass. `412 Larkspur`: "We serve 412 Larkspur Ln. Pickup is every Tuesday.", due today $129.36. Checkout with Visa 4242 showed "Cart arrives Mon Sep 14, first pickup Tue Sep 15." | acct_sf_0002, party_sf_0004, site_sf_0005, si_sf_0006, wo_sf_0007, pay_sf_0003, chg_sf_0008, chg_sf_0009 |
| 2 | Held signup approved | Pass. `1180 Ridge`: eyebrow "Provisional price", "Due when approved" $136.23, then $109.48 every quarter. The hold showed "We will text you by Sun Sep 13 10:00 AM at 404-555-0142." Office, then Approve, showed "Approved. Charged $136.23 to Visa ending 4242. Cart arrives Mon Sep 14, first pickup Tue Sep 15." Customer status showed the same dates and "Paid $136.23". | quote_sf_0011, acct_sf_0012, party_sf_0014, site_sf_0015, si_sf_0016, wo_sf_0017, pay_sf_0013, chg_sf_0018, chg_sf_0019 |
| 3 | Franchise stops | Pass. `530 Main`: eyebrow "Franchise area", the Southeast Sanitation headline, and no dollar amount anywhere in the page. | None |
| 4 | Commercial request | Pass. For a business on, `1500 Commerce`: eyebrow "Business service", "Tell us what your business needs.", no dollar amount. 3 yard, Cardboard, and Twice a week, then Send, showed "Request quote_sf_0020 received. A person will reply by Fri Sep 11 with a written price." | quote_sf_0020 |

End state in the store inspector at each width: "18 records created this session". Parties 2, Billing accounts 2, Sites 2, Service items 2, Work orders 2, Quotes 2, Payments 2, Charges 4.
