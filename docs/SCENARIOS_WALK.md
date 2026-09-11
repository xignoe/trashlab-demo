# Scenario walk: the seven scenarios, the ten-minute demo, and the invariant proofs

Phase 4 hand-off for the RUNBOOK.md writer (boxes 4.1 to 4.7a). Every click path and figure below was walked in headless Chrome at 1440 x 900 against the merged app, each scenario from a fresh **Reset seed**, with no console errors, warnings, or failed requests. The same figures are asserted to the cent by `src/flows/scenarios.test.tsx`, which drives the store and the real screens under jsdom. If a figure here changes, that test fails first.

Screenshots are in `docs/screenshots/scenarios/`, named `<scenario>-<step>.png` (the demo chain is `demo-<nn>-<step>.png`).

## Before you start

- **Start:** `npm run dev` serves the app on http://localhost:5200 (strict port). The walk for this document ran the same app on 5208; nothing differs but the port.
- **Checks:** `npx vitest run` (59 files, 634 tests) and `npm run build`.
- **Clock:** the persona bar shows **Today Sep 10, 2026**. Every surface reads it. Only the **Next cycle, Nov 1** button on Accounts moves it (one month, to Oct 10, 2026).
- **Cycle button:** beside the **Accounts** title. Before the run it reads **Run Oct 1 cycle**; clicking it runs the cycle and filters the table to **To review**. Until anything posts it reads **Cancel run** (undoes the run; asks first if decisions would be lost; disabled once a charge is waived), while the cycle banner's pill reads "N charges to review", then "Ready to post"; after posting it reads **Next cycle, Nov 1**.
- **Reset seed** is the button at the right end of the persona bar. It reloads the seed, returns the clock to Sep 10, and clears every surface's state. It does not change the URL, so after a reset use the persona tabs to move. A browser reload does the same thing as Reset seed.
- **Navigation:** the persona bar has three persona tabs, **Customer**, **Office**, **Owner**. Under each is a row of screen links:
  - Customer: **Storefront**, **Portal**
  - Office: **Accounts**, **Payments**, **Approvals** (the old /office/billing redirects to /office/payments)
  - Owner: **Ratebook** (the Quote workbench was removed, DECISIONS.md entry 66; scenario 3's steps 1 to 4 below no longer have a screen)

  The Office and Owner tabs carry a count badge (proposed charges, open requests, held signups; pending drafts).
- **Where things are on each screen:**
  - Storefront: the address field takes a typed address; press Enter.
  - Accounts: the account table with a search box, a **To review** filter chip, and a **Review** column (undecided charges per account). After the run, an "October 2026 cycle" banner above the table carries **Approve N rate changes** (when there are any), **Bulk approve N clean**, and **Post invoices**, and its meta line gives the invoice count, run total, and accounts waiting on a decision. Click a row to open that account's page.
  - Account page: the left rail lists the pinned accounts (Ruth Maple, Sunrise Bakery, Oakridge Property Group, Hale Construction, Lena Kerr, then every storefront signup, newest first) and has a search box. After the run, a "Charges to review" card lists the account's items; click a row to select it. The detail's buttons read **Approve $x.xx**, **Edit**, **Waive**. After the last decision it links "Next account to review: <name>".
  - Payments ("Payments and deposits"): the payment tiles and cards, plus **Posted this cycle** (click an invoice number to open its lines) and **Leakage, last 3 cycles**.
  - Portal: "Signed in as" is a select at the top right. Its logins are Ruth Maple, Oakridge Property Group, and Sunrise Bakery. The section links are in the portal's own nav: **Billing**, **Requests**, and so on.
- **Ids** such as `acct_sf_0002` are numbered by the session. The ids below are what a fresh Reset seed produces when the steps are followed exactly.

## Scenario 1: a homeowner signs up instantly at a zone_open address (box 4.1)

Proves that an instant signup creates the delivery work order, and that the next billing run takes the signup's charges into one first invoice that the signup payment clears.

| # | Persona, screen | Do | See |
|---|---|---|---|
| 1 | Customer, Storefront | Type `412 Larkspur`, press Enter | Path /customer/store/offer. "We serve 412 Larkspur Ln. Pickup is every Tuesday." The price panel reads: 96 gal cart, weekly $29.00/mo; Service, 3 months $87.00; One-time cart delivery $25.00; Fuel surcharge, 7% $6.09; Environmental fee, $1.00/mo $3.00; Estimated tax, 7% $8.27; **Due today $129.36**; **Then every quarter $102.61**. First pickup Tue Sep 15 (cart arrives Mon Sep 14). Screenshot `1-offer.png` |
| 2 | same | Click **Continue to checkout**. Fill Full name `Dana Larkspur`, Email `dana@example.com`, Last 4 digits `4242` | The button reads **Pay $129.36 and start service**. `1-checkout.png` |
| 3 | same | Click **Pay $129.36 and start service** | "Cart arrives Mon Sep 14, first pickup Tue Sep 15." Your account shows acct_sf_0002, site_sf_0005, work order wo_sf_0008, payment pay_sf_0003. `1-success.png` |
| 4 | Office, Accounts | Open **Dana Larkspur** (her row, or the rail) | Balance $0.00 with "$129.36 unapplied payment"; Next invoice Oct 1 **$129.36**, "Estimated, 2 lines"; Autopay On, Card on file; the 96 gal cart (container SF-0007) since Sep 15, 2026 at $29.00 per month; the delivery work order wo_sf_0008 open; the payment pay_sf_0003 $129.36, "Not applied". `1-account.png` |
| 5 | Office, Accounts | Click **Run Oct 1 cycle** beside the Accounts title | The table filters to **To review**. The run: Invoices to generate **45**, Clean 32, Need decisions 13, Dollars at issue $724.85. The banner reads "45 invoices" and "13 accounts waiting on a decision"; the banner pill "15 charges to review". The signup is intake: its two approved charges are in the run and are not charges to review |
| 6 | same | Decide the 15 charges to review: open each account in the To review list (or follow **Next account to review**), select each row in its Charges to review, and click **Approve $x.xx**. The six rate changes can instead be approved together with the banner's **Approve 6 rate changes**, then **Approve 6 rate changes** in its confirmation. Then, on Accounts, click **Bulk approve 49 clean**, then **Approve 49** | The bulk confirmation reads "Approve 49 clean charges totaling $5,171.84?" |
| 7 | same | Click **Post invoices** in the banner | "Post **45** invoices totaling **$6,026.05**? Numbers **INV-2026-0223 to INV-2026-0267**, one per account, from 66 approved charges." Click **Post 45 invoices** |
| 8 | Office, Payments | In Posted this cycle, click **INV-2026-0267** | Dana Larkspur, 2 lines, due Sep 25, **$129.36**. Lines: 96 gal cart, weekly, 2026-09-15 to 2026-12-14, base $87.00, rv_res_96_2026, $102.61; One-time cart delivery, Open market, base $25.00, zoneRate, $26.75; **Payment applied pay_sf_0003 ($129.36)**; **Balance $0.00**. `1-posted.png` |

What it proves: the signup's recurring charge covers Sep 15 to Dec 14, so the Oct 1 run adds no second recurring charge (addendum C13). The signup is numbered last (INV-2026-0267), so every seeded invoice number is unchanged, and Maple is still INV-2026-0223.

## Scenario 2: a zone_boundary signup is held, then approved by the office (box 4.2)

Approve before anything moves the clock: the held price expires Thu Sep 17.

| # | Persona, screen | Do | See |
|---|---|---|---|
| 1 | Customer, Storefront | Type `1180 Ridge`, press Enter | Path /customer/store/boundary. "We can probably serve 1180 Ridge Hollow Rd. Pickup would be every Tuesday." "We can probably serve this address but need to confirm private road access before we start. Your price is held for 72 hours." 96 gal cart $31.00/mo; **Due when approved $136.23**; every quarter **$109.48**. `2-offer.png` |
| 2 | same | Click **Continue to hold my price**. Fill Full name `Priya Ridgeway`, Email `priya@example.com`, Mobile `404-555-0142`, Last 4 digits `4242` | `2-intake.png` |
| 3 | same | Click **Hold my price and submit for review** | Quote quote_sf_0002, "Your price is held while we confirm your address." Deadline bar: "We will text you by Sun Sep 13 10:00 AM at 404-555-0142." "This price is held until Thu Sep 17. Visa ending 4242 is saved, not charged." Due when approved $136.23. Nothing is charged. `2-held.png` |
| 4 | Office, Approvals | Find the quote_sf_0002 row | Held. Kind Residential signup; Address 1180 Ridge Hollow Rd, Piedmont, GA 30512; Due today $136.23; **Hold reason confirm private road access**; **Deadline Sun Sep 13 10:00 AM**; Card "Visa ending 4242, saved, not charged". The seed's own held quote, quote_held_ridge, is listed too (same address, same contact name). `2-approvals.png` |
| 5 | same | Click **Approve** on the quote_sf_0002 row | "Approved. Charged **$136.23** to Visa ending 4242. Cart arrives Mon Sep 14, first pickup Tue Sep 15." It lists Account acct_sf_0003, Party party_sf_0005, Site site_sf_0006, Service items si_sf_0007, Containers cart_sf_0008, Work orders wo_sf_0009, Payment pay_sf_0004, Charges (approved) chg_sf_0010, chg_sf_0011. `2-approved.png` |
| 6 | same | Click **Customer status** on the same row | Path /customer/store/status/quote_sf_0002, "Approved. Cart arrives Mon Sep 14, first pickup Tue Sep 15." The customer has nothing left to do: no second conversation. `2-customer-status.png` |
| 7 | Office, Accounts | Open **Priya Ridgeway** (her row, or the rail) | Active; "$136.23 unapplied payment"; Next invoice $136.23 (recurring $109.48 at the boundary rate rv_res_96_2026_boundary, plus delivery $26.75). `2-account.png` |

To show billing's half, run October afterwards as in scenario 1: the approval posts as its own invoice, paid to $0.00 by pay_sf_0004 (in the demo chain it is INV-2026-0268, $136.23, Balance $0.00). Approving the seeded quote_held_ridge instead gives the same $136.23 and $109.48.

## Scenario 3: the bakery quote, 10% under the ratebook with a contract exception (box 4.3)

**Frequency (DECISIONS.md entry 55).** The seeded storefront request, quote_bakery_request, asks for **3x** weekly. Only **2x** is published for the 3 yd front load, so the workbench offers 2x alone and prices the request as 2x. Talk track: "The bakery asked about 3x for the holidays. There is no 3x rate in the ratebook, so the workbench offers 2x, and that is what the quote records."

| # | Persona, screen | Do | See |
|---|---|---|---|
| 1 | Owner, Quote workbench | In Service address type `880 Commerce St`, press Enter | Account box: "Sunrise Bakery, active, acct_bakery, site_bakery, zone_open, Contract on file: contract_bakery". Callout: "Pricing request quote_bakery_request, commercialRequest, draft, from storefront, expires 2026-10-10, 1 x cat_fl_3yd, 3x weekly, $0.00" |
| 2 | same | Read the form | Frequency offers only **2x weekly**. The quoted price field reads **198.00**. List price: "contract override $198.00/mo from contract contract_bakery"; "Ratebook **$220.00** zone rate rv_fl_3yd_2026"; "Existing contract price $198.00 (competitive match)". "**10% below ratebook**, est. $264/yr". Cost to serve: target range $169.10 to $198.94 |
| 3 | same | Reason: choose **competitive match** | "Save will": price request quote_bakery_request, 1 x 3 yd frontload container, 2x weekly, at $198.00 a month; and add a contract override on contract_bakery, $198.00, 10% below ratebook, reason "competitive match". `3-workbench.png` |
| 4 | same | Click **Save quote** | "Exception saved as a contract override": Contract contract_bakery, 3 yd frontload container cat_fl_3yd, 2x weekly, Price $198.00, pctBelowRateCard 10%, Reason competitive match; "contract_bakery now has 2 overrides for this item and frequency. The newest, listed first, is the one billed"; request quote_bakery_request, 2x weekly, $198.00, recurringCents 19800. `3-saved.png` |
| 5 | Office, Accounts, then Payments | **Run Oct 1 cycle**, decide the 15 charges to review, **Bulk approve 49 clean**, **Post invoices**, **Post 44 invoices** (figures as in scenario 5) | Then on Payments, in Posted this cycle, click **INV-2026-0225**: Sunrise Bakery, 3 lines, **$447.37**. "3 yd frontload container, 2x weekly, Oct 1 to Oct 31, **base $198.00 · contract_bakery**, $227.69"; wood waste base $171.00 · contract_bakery $196.78; Contamination, Sep 9, base $20.00 · standardRate $22.90. `3-posted.png` |
| 6 | Office, Accounts | Open **Sunrise Bakery** (its row, or the rail) | Contract card: the new $198.00 override first, the older $198.00 row struck through as "Replaced, kept as history (competitive match)". `3-account.png` |
| 7 | Customer, Portal | Signed in as **Sunrise Bakery**; click **Billing**; on INV-2026-0225 click **View**; on the 3 yd line click **Why this charge** | The 3 yd line reads $198.00, fees $14.86, tax $14.83, total $227.69, and "Why this charge" names **contract_bakery**. `3-portal.png` |

A request the storefront creates also lands in the workbench. Customer, Storefront: switch **For a business** on, type `1500 Commerce`, press Enter, then choose **3 yd frontload container**, **Cardboard**, **Twice a week**, fill Full name and Email, and click **Send my request**. You see "Request quote_sf_0001 received. A person will reply by Fri Sep 11 with a written price." (`3-storefront-request.png`). In Owner, Quote workbench, typing `1500 Commerce` suggests "1500 Commerce Way, Suite B, Piedmont, GA 30512, No account yet, zone_open, pricing request quote_sf_0001". The callout shows "1 x cat_fl_3yd, 2x weekly", but the match box reads "No account matched, save disabled" (`3-workbench-storefront-request.png`). A contract exception needs an account, which is why the scenario uses the seeded bakery request.

## Scenario 4: Maple's extra bags, waived as goodwill (box 4.4)

| # | Persona, screen | Do | See |
|---|---|---|---|
| 1 | Office, Payments | Read the **Leakage, last 3 cycles** card | Waived total **$65.84** (4 seeded waives) |
| 2 | Office, Accounts | Click **Run Oct 1 cycle**, then open **Ruth Maple** from the To review list (or the rail) | Her Charges to review shows the Extra bags row selected. Detail "Extra bags, Ruth Maple, Sep 7, 412 Maple Ave". Proposed amount: Base $2.50, Fuel surcharge $0.18, Tax $0.19, Total **$2.87**. Evidence: the **driver's photo** (ev_maple_extrabags.svg, alt "Driver photo, Extra bags, Sep 7"), "Driver Marcus Bell · completed", "3 bags beside cart, lid closed". Customer context: open balance $87.45, past due, 0 prior waives. Haul-E suggests **Approve**, medium confidence. `4-queue-photo.png` |
| 3 | same | Click **Waive**, choose **Goodwill** | `4-waive-form.png` |
| 4 | same | Click **Waive $2.87** | The Extra bags row stays in Charges to review with a **Waived** pill; nothing is deleted. The person overrode the agent's suggestion. The run: 44 invoices, Clean 32, Need decisions 12, Dollars at issue $721.98 (the Accounts banner reads "44 invoices" and "12 accounts waiting on a decision"). On Payments, Leakage **$65.84 to $68.71**, "5 waived charges", "Oct 1 cycle, this one $28.64", Goodwill (2) $31.49. `4-waived.png` |

## Scenario 5: Hale's roll-off overage, approved, posted, charged to the card on file (boxes 4.5 and 4.5a)

Hale Construction now has a card on file, with autopay off (seeded through scripts/gen_seed.ts). Posting never charges a card; the office clicks **Charge card on file** (DECISIONS.md entry 54).

| # | Persona, screen | Do | See |
|---|---|---|---|
| 1 | Office, Accounts | Click **Run Oct 1 cycle**, open **Hale Construction** (its row, or the rail), and in Charges to review click the Overage row at $96.17 | "Overage 1.20 t over 3 t cap". Proposed: Base $84.00, Fuel $5.88, Tax $6.29, Total **$96.17**. Evidence: **Ticket ticket_hale_1**: Gross 30,400 lb, Tare 22,000 lb, Net 8,400 lb (4.20 t), Over cap 1.20 t over 3 t, Piedmont Transfer Station, C&D, ticketed Sep 3, 14:22, work order wo_hale_haul_1. Policy: (net tons minus 3 t) x $70.00. Customer context: "Autopay off, card on file, Net 30". Haul-E suggests Approve, high. `5-overage.png` |
| 2 | same | Click **Approve $96.17**; decide the other 14 charges to review on their accounts' pages (follow **Next account to review**); on Accounts, **Bulk approve 49 clean**, **Approve 49**; **Post invoices** | "Post **44** invoices totaling **$5,893.82**? Numbers INV-2026-0223 to INV-2026-0266". Click **Post 44 invoices**. No payment is created by posting |
| 3 | Office, Payments | In Posted this cycle, click **INV-2026-0265** | Hale Construction, 3 lines, due Oct 10, **$168.87**: Dry run, Sep 3, $28.62; Overage 1.20 t over 3 t cap, $96.17; Overage 0.55 t over 3 t cap, $44.08. A button **Charge card on file** sits under the lines. `5-posted.png` |
| 4 | same | Click **Charge card on file** | Confirmation: "Charge $168.87 to Hale Construction's card on file for INV-2026-0265? This records a settled card payment for the open balance and applies it to this invoice. Posting never charges a card; this click does." `5-charge-confirm.png` |
| 5 | same | Click **Charge $168.87** | Notice: "Charged $168.87 to Hale Construction's card on file: pay_bl_0001 applied to INV-2026-0265, balance $0.00." The lines now end "Payment applied pay_bl_0001 ($168.87)", "Balance $0.00", and the button is gone. `5-charged.png` |
| 6 | same | Read the tiles and cards at the top of Payments | Tiles: Received this week **$3,490.29** (was $3,321.42), Applied **$3,409.99** (was $3,241.12), Unapplied cash $80.30, Processor fees $41.20. New card "**Charged to card on file**, 1 charge · $168.87": pay_bl_0001, "Card, settled, Sep 10, by M. Alvarez", Hale Construction, applied to **INV-2026-0265 $168.87**, amount $168.87, invoice balance $0.00. `5-payments.png` |
| 7 | Office, Accounts | Open **Hale Construction** (its row, or the rail) | Payments table: "pay_bl_0001, Settled, Sep 10, 2026, Card, $168.87, Applied to INV-2026-0265 $168.87, Unapplied $0.00"; INV-2026-0265 is no longer open. `5-account.png` |

## Scenario 6: the owner publishes a 4% residential increase effective 2026-10-01 (box 4.6)

Publish **before** running October, so October prices at the new rates.

| # | Persona, screen | Do | See |
|---|---|---|---|
| 1 | Owner, Ratebook | Read the header pill | "13 published, 0 drafts" |
| 2 | same | Click **Residential**, then **Adjust rates by x%**, and type 4 in Change by | The modal shows Effective from 2026-10-01 and the 8 residential lines with their new prices. `6-increase.png` |
| 3 | same | Click **Create 8 drafts** | Toast "8 drafts created: adjusted lines." |
| 4 | same | Click **Preview publish** | "**31 accounts move, 5 protected by contract**, monthly revenue **+$40.04** before fees and tax." Priced as of 2026-10-01. Who changes: Ruth Maple $50.00 to $52.00; a 96 gal account $41.00 to $42.64. Who does not change, **5 protected by contract**: Sunrise Bakery (contract_bakery), Pine Street Laundromat (contract_fl_002), Two Rivers Brewing (contract_fl_004), Lantern Hill Bistro (contract_fl_006), Northgate Fitness (contract_fl_008), each "no service in this draft's scope, contract still protects it". Invoice example: Ruth Maple, quarterly, +$6.86 per quarter ($180.74 before). Revenue: +$40.04 monthly, +$480.48 annualised. `6-preview.png` |
| 5 | same | Click **Confirm and publish 8 versions** | "Published 8 versions. Old versions kept." Pill "21 published, 0 drafts". Each residential line shows "Scheduled $X from 2026-10-01": 96 gal open **$30.16**, 96 gal boundary $32.24, 64 gal open $28.08, 64 gal boundary $29.12, extra cart $9.36 and $10.40, recycling $12.48 and $13.52. History card: "Posted invoice unchanged by this publish". `6-published.png` |
| 6 | Office, Accounts | Click **Run Oct 1 cycle** | The run: 44 invoices, Clean **8**, Need decisions **36**, Dollars at issue **$3,286.32**; banner pill "**50** charges to review". **41** of the 50 are Rate change (a monthly 96 gal row reads $35.53, for example on Alicia Brandt's Charges to review). `6-queue.png` |
| 7 | same | In the banner, click **Approve 41 rate changes** | Confirmation: "Approve 41 rate changes totaling **$3,007.83**? Each is a recurring line priced at a rate version the owner published since the prior cycle. The other 9 charges under review stay one decision each." `6-rate-confirm.png` |
| 8 | same | Click **Approve 41 rate changes** in the confirmation | The run: Clean 37, Need decisions 7, Dollars at issue $278.49; banner pill "9 charges to review" |
| 9 | same | Approve the other 9 one at a time on their accounts' pages (**Approve $x.xx**); on Accounts, **Bulk approve 14 clean** ("Approve 14 clean charges totaling $2,722.55?"), **Approve 14**; **Post invoices** | "Post 44 invoices totaling **$6,008.87**? Numbers INV-2026-0223 to INV-2026-0266". Click **Post 44 invoices** |
| 10 | Office, Payments | In Posted this cycle, click **INV-2026-0223** | Ruth Maple, 4 lines, **$190.47**: 96 gal cart, weekly, Oct 1 to Dec 31, **base $90.48 · rv_pr_res_96_open_weekly_20261001**, $106.59; extra cart base $28.08, $35.15; recycling base $37.44, $45.86; Extra bags, Sep 7, $2.87. `6-posted.png` |
| 11 | Office, Accounts | Open **Ruth Maple** (her row, or the rail) | INV-2026-0203 unchanged: issued Jul 1, 2026, total **$180.74**, paid $93.29, open **$87.45**, past due. INV-2026-0223: $190.47, open. `6-account.png` |
| 12 | Customer, Portal | Signed in as **Ruth Maple**, click **Billing** | INV-2026-0223 $190.47 Open, and INV-2026-0203 $180.74, paid $93.29, open $87.45, Past due. `6-portal.png` |
| 13 | Office, Accounts, then Customer, Storefront | Click **Next cycle, Nov 1** (the clock reads Oct 10, 2026), then in the storefront type `412 Larkspur` and press Enter | 96 gal cart **$30.16/mo**, first pickup Tue Oct 13; Service, 3 months $90.48; delivery $25.00; fuel $6.33; env $3.00; tax $8.53; **Due today $133.34**; **every quarter $106.59** ("About $35.53 a month, all in"). The storefront's start dates are the next route days, so the Oct 1 price shows only once the clock is past Oct 1 (DECISIONS.md entry 48). `6-storefront.png` |

The run flags **41** rate changes, not "about 50": 50 is every charge to review, and 9 of it are the usual field events, overages, extra days, and the service change. The confirmed group approval is DECISIONS.md entry 56.

## Scenario 7: Maple changes 96 gal to 64 gal in the portal mid-quarter (box 4.7)

| # | Persona, screen | Do | See |
|---|---|---|---|
| 1 | Office, Accounts | Open **Ruth Maple** (her row, or the rail) | Next billing run preview **$183.61** (Oct 1 to Dec 31: 96 gal $102.61, extra cart $33.91, recycling $44.22, extra bags $2.87). `7-before.png` |
| 2 | Customer, Portal | Signed in as **Ruth Maple**, click **Requests**, then **Cart size change** | "The swap happens on your next route day; the price changes on your next billing cycle." Current cart 96 gal cart, weekly; change to 64 gal cart; checks pass. `7-portal-form.png` |
| 3 | same | Click **Confirm change** | "Switching to 64 gal cart on **Oct 1, 2026**. Our driver swaps the cart on Monday, Sep 14. Your current invoice does not change; the new price starts on Oct 1, 2026." Work order **wo_ac_0004** (swap, Monday, Sep 14), Request req_p0001, "Current service 96 gal cart bills through Sep 30, 2026". `7-portal-done.png` |
| 4 | Office, Accounts | Open **Ruth Maple** again | Service table: "64 gal cart, 1, Weekly, C64-9001, **Oct 1, 2026**, **$27.00 per month**". Open items: "Sep 14, Swap 64 gal cart, **Open**, wo_ac_0004, 412 Maple Ave, C64-9001, item si_ac_0097, for request req_p0001", a **Mark scheduled** button, and "Dispatch has not put it on a route yet"; Request "Cart change, Scheduled, req_p0001, via portal". Next billing run preview **$176.74**, "3 recurring lines, 1 event, 0 proposed charges", "Piedmont Disposal does not prorate: lines bill the full period they are in force at the period start." `7-account.png` |
| 5 | same | Click **Mark scheduled** | The work order reads **Scheduled** and the button is gone. `7-scheduled.png` |

The adjustment is $183.61 to $176.74 (-$6.87). The 96 gal quarter ($87.00 base, $102.61) is replaced by the 64 gal quarter at the Oct 1 rate ($81.00 base, $95.74). There is no credit or partial line for Sep 14 to Sep 30, and INV-2026-0203 is untouched. The swap work order stays Open until the office clicks Mark scheduled.

## The ten-minute demo, in persona order, in one session

One Reset seed at the start, then no reset. This chain covers all seven scenarios. Walked end to end; screenshots `demo-*.png`.

| Time | Persona, screen | Do | See |
|---|---|---|---|
| 0:00 | (persona bar) | **Reset seed** | Today Sep 10, 2026 |
| 0:00 to 1:00 | Customer, Storefront | Scenario 1 steps 1 to 3 (412 Larkspur, pay $129.36) | "Cart arrives Mon Sep 14, first pickup Tue Sep 15." (`demo-01-offer.png`, `demo-01-checkout.png`, `demo-01-success.png`) |
| 1:00 to 1:45 | Customer, Storefront | Click **Start over**. Scenario 2 steps 1 to 3 (1180 Ridge, hold) | Held quote quote_sf_0012, $136.23 due when approved, deadline Sun Sep 13 10:00 AM |
| 1:45 to 2:30 | Customer, Portal | Scenario 7 steps 2 and 3 (Maple, cart size change) | "Switching to 64 gal cart on Oct 1, 2026", work order wo_ac_0009 |
| 2:30 to 3:30 | Office, Accounts | Open **Dana Larkspur**, then **Ruth Maple** (rows or rail); on Maple click **Mark scheduled** | Larkspur next invoice $129.36 and the delivery work order (`demo-02-signup-account.png`); Maple next invoice **$176.74**, the swap now Scheduled (`demo-03-maple-account.png`) |
| 3:30 to 4:00 | Office, Approvals | **Approve** on the quote_sf_0012 row | "Approved. Charged $136.23 to Visa ending 4242..." |
| 4:00 to 6:30 | Office, Accounts | **Run Oct 1 cycle** | The run: 46 invoices, Clean 33, Need decisions 13, $820.59 at issue; banner pill "16 charges to review" (Maple's 64 gal line is a Service change row at $95.74 on her Charges to review) |
| | | Open Ruth Maple, Extra bags row: **Waive**, **Goodwill**, **Waive $2.87** | Leakage (on Payments) $65.84 to **$68.71** |
| | | Open Hale Construction, the $96.17 row: **Approve $96.17** | Ticket ticket_hale_1 in the evidence (`demo-04-billing-decisions.png`) |
| | | Banner: **Approve 6 rate changes**, confirm ("...totaling $446.78?") | the other 8 stay one decision each |
| | | Approve the other 8 on their accounts' pages; **Bulk approve 48 clean** ("Approve 48 clean charges totaling $5,069.23?"); **Post invoices**, **Post 46 invoices** | "Post 46 invoices totaling **$6,152.54**? Numbers INV-2026-0223 to INV-2026-0268". Maple INV-2026-0223 **$173.87**; Hale INV-2026-0265 $168.87; Priya Natarajan INV-2026-0266 $32.06; Dana Larkspur INV-2026-0267 $129.36, Balance $0.00; Priya Ridgeway INV-2026-0268 $136.23, Balance $0.00 |
| | Office, Payments | In Posted this cycle open **INV-2026-0265**, **Charge card on file**, **Charge $168.87** | "Charged $168.87 to Hale Construction's card on file: pay_bl_0001 applied to INV-2026-0265, balance $0.00." (`demo-05-posted-and-charged.png`) |
| | | The tiles at the top | Received this week $3,755.88, Applied $3,675.58, Unapplied cash $80.30, Processor fees $41.20; "Charged to card on file" lists pay_bl_0001 (`demo-06-payments.png`) |
| 6:30 to 8:00 | Owner, Ratebook | **Residential**, **Adjust rates by x%** (4), **Create 8 drafts**, **Preview publish** | "**33 accounts move**, 5 protected by contract, monthly revenue **+$42.36**" (the two new signups are residential, so 33, not 31); Maple's invoice example +$6.59 per quarter on $173.87 (`demo-07-preview.png`) |
| | | **Confirm and publish 8 versions** | "Published 8 versions. Old versions kept." History card "Posted invoice unchanged by this publish" |
| 8:00 to 8:45 | Owner, Quote workbench | Scenario 3 steps 1 to 4 (880 Commerce St, competitive match, **Save quote**) | "Exception saved as a contract override", $198.00 against $220.00 |
| 8:45 to 9:00 | Office, Accounts | **Next cycle, Nov 1** | Clock Today Oct 10, 2026 |
| 9:00 to 10:00 | Customer, Storefront | **Start over** if shown; type `412 Larkspur`, press Enter | The new price: 96 gal cart **$30.16/mo**, due today $133.34, every quarter $106.59 (`demo-08-storefront-new-price.png`) |
| | Customer, Portal | Signed in as **Ruth Maple**, **Billing** | The old invoices unchanged: INV-2026-0203 **$180.74** (open $87.45, past due) and INV-2026-0223 **$173.87** (posted before the publish; now past due, because the clock is Oct 10) (`demo-09-portal-invoices.png`) |

**What chains, and where a Reset seed is needed:**
- Scenarios 1, 2, 4, 5 and 7 chain in one session in any order before the October run. Approve scenario 2 before **Next cycle** (the held price expires Sep 17), and do scenario 7 before the October run if its $183.61 to $176.74 figures are wanted.
- Scenario 6 as the checklist states it (the October invoices priced at the new rates, 31 move, 41 rate changes, Maple $190.47) needs the publish **before** **Run Oct 1 cycle**. In the persona-order demo the publish comes after the run, so invariant 1 is shown on invoices posted minutes earlier, and the new price is shown on the storefront after Next cycle. To show scenario 6's own figures, **Reset seed** and walk it alone.
- Scenario 3's invoice proof (INV-2026-0225 carrying contract_bakery) needs the quote saved before **Run Oct 1 cycle**. In the demo the quote is saved after posting, and October's bakery line already reads contract_bakery at $198.00. To show the portal's "Why this charge" step, walk scenario 3 alone after a **Reset seed**.
- Do not add a November run to the demo. It prices the eight monthly 96 gal accounts at $30.16 but flags no rate change (a known gap, DECISIONS.md entry 61).

## Invariant proof table

Test names are `describe` › `it`, exactly as written. Every test listed passes in `npx vitest run`.

| # | Invariant | Test file | Test name | Screen |
|---|---|---|---|---|
| 1 | Editing a rate never changes a posted invoice | `src/store/post.test.ts` | "invariant 1: publishing a RateVersion never changes a posted Invoice" › "a new cat_res_96 rate leaves the posted October invoice and its charges byte for byte unchanged, while the November run uses the new price" | Owner, Ratebook: History card "Posted invoice unchanged by this publish". Office, Accounts, Ruth Maple: INV-2026-0203 stays $180.74, open $87.45 (scenario 6 step 11). Customer, Portal: the same invoice (scenario 6 step 12; demo 9:00) |
| 1 | (same) | `src/flows/scenarios.test.tsx` | "scenario 6 (box 4.6): the owner publishes a 4% residential increase effective 2026-10-01" › "the preview protects the 5 contract accounts, October bills the new rates, and INV-2026-0203 stays $180.74" | as above |
| 1 | (same) | `src/store/decisions.test.ts` | "scenario chain: waive, approve overages, bulk approve, post, publish $31, next cycle (invariant 1)" › "the posted October invoice keeps 2900 while the November run prices the same line at 3100" | Office, Payments: the "Posted, Oct 1 cycle" card after Next cycle |
| 2 | Every Charge shows its provenance (service item or event, rate version, rule that won) | `src/store/engine.test.ts` | "invariant 2: every charge carries base, fees, tax, source, and ruleWon" › "holds for recurring, event, fee, lateFee, contract, and taxExempt charges from computeCharge", and › "also holds for every historical charge in the seed" | Office, an account's Charges to review: the detail panel's Proposed amount, Evidence, and Policy (scenarios 4 and 5); Office, Payments: posted lines "base $198.00 · contract_bakery" (scenario 3 step 5) |
| 2 | (same) | `src/store/generate.test.ts` | "generateEventCharges" › "invariant 2: every generated charge carries base, fees, tax, source, and ruleWon" | Customer, Portal: "Why this charge" names contract_bakery (scenario 3 step 7) |
| 3 | A service change on the account view appears in both the work order list and the next billing run | `src/store/generate.test.ts` | "generateRecurringCharges" › "invariant 3: acct_res_007 extra cart appears in the 2026-10-01 run, not in the 2026-07-01 run, and wo_res_007_deliver exists" | Office, Accounts, after the run: Priscilla Nguyen's Charges to review shows the "Service change" row |
| 3 | (same) | `src/surfaces/account/__tests__/slice.test.ts` | "Scenario E: the next billing run preview recomputes on every store change (invariant 3)" › "Maple before 18361, after the swap 17674, with the 96 gal line gone and the posted Q3 invoice unchanged (invariant 1)" | Office, Accounts, Ruth Maple: Open items (swap work order) and the Next billing run preview $176.74 (scenario 7 step 4) |
| 3 | (same) | `src/flows/scenarios.test.tsx` | "scenario 7 (box 4.7): Maple changes 96 gal to 64 gal in the portal mid-quarter" › "the account view shows Oct 1, the open swap work order, $183.61 to $176.74 with no proration, and Mark scheduled" | as above |
| 4 | A suspended account's stops show as skipped in the route view stub | `src/surfaces/account/__tests__/slice.test.ts` | "Scenario C: Kerr is suspended, the route skips him (invariant 4)" › "Kerr before: suspended, nothing generated, route stub shows the recorded Tuesday skips" | Office, Accounts, **Lena Kerr** (acct_res_kerr, 77 Kerr Ln): the Next billing run preview reads $0.00, "Suspended: no charges will be generated". Click **Reinstate**: the drawer's route stub for route_tue_res lists Sep 1 and Sep 8 "Recorded, Tasha Green" as "Skipped, suspended", and Sep 15, Sep 22, Sep 29, Oct 6 "Projected" as "Skipped, suspended" now and "Completed" after confirm. Close the drawer without confirming |
| 4 | (same) | `src/store/generate.test.ts` | "generateRecurringCharges" › "invariant 4: suspended acct_res_kerr produces zero charges while its route events are skippedSuspended", and "generateEventCharges" › "invariant 4: an exception event on a suspended account produces nothing" | Office, Accounts, after the run: Kerr's Review column reads 0 and he is not in To review; Office, Payments: no posted invoice names him |
| 5 | Waived charges are never deleted; they appear in the leakage tile | `src/store/waive.test.ts` | "invariant 5: WaivedCharge rows are never deleted" › "after waiving, re-running generation, and posting, the WaivedCharge row is still present and the waived charge is on no invoice", › "applyWaive only ever appends to waivedCharges", and › "no function in src/store removes a WaivedCharge (static scan of the store sources)" | Office, Ruth Maple's Charges to review: the Extra bags row stays with a Waived pill; Office, Payments: Leakage $65.84 to $68.71 (scenario 4 step 4) |
| 5 | (same) | `src/flows/scenarios.test.tsx` | "scenario 4 (box 4.4): Maple extra bags, waived as goodwill" › "the event is in the queue with its photo; the goodwill waive moves leakage from $65.84 to $68.71 and deletes nothing" | as above |
| 6 | Payment allocation is many-to-many: one check paying three invoices, one processor deposit split into 14 payments plus fees | `src/store/allocate.test.ts` | "allocate" › "pay_chk_oakridge splits across three invoices and each invoice balance drops accordingly", and › "invariant 6: batch_0908 gross minus fees equals net, and its 14 allocations plus the unapplied remainder equal gross" | Office, **Payments**: the "Check: Oakridge Property Group" card (one check, three invoices) and the "Processor batch batch_0908" card (gross $1,318.42, fees ($41.20), net $1,277.22, 14 rows) |
| 6 | (same) | `src/flows/scenarios.test.tsx` | "scenario 5 (boxes 4.5 and 4.5a): Hale roll-off overage, approved, posted, then charged to the card on file" › "proposes $96.17 with ticket_hale_1, posts INV-2026-0265 at $168.87, and \"Charge card on file\" pays it with the allocation visible" | Office, Payments: "Charged to card on file"; Office, Accounts, Hale Construction: the payments table (scenario 5 steps 6 and 7) |
| 7 | Agents draft; rules authorize; a human approves anything that moves money | `src/store/post.test.ts` | "postInvoices" › "a proposed charge cannot be posted; a person approves first" | Office, an account's Charges to review: "Agents draft. A person approves anything that moves money." in the detail panel; Office, Accounts: the banner's **Post invoices** stays disabled while any charge to review is undecided |
| 7 | (same) | `src/store/useStore.test.ts` | "decisions" › "post refuses while a queue item is undecided, then posts approved charges as inv_bl_ invoices" | as above |
| 7 | (same) | `src/store/suggest.test.ts` | "suggestFor" › "every suggestion names its evidence and never mutates the charge or the db" | Scenario 4: Haul-E suggested Approve and the person waived |
| 7 | (same) | `src/flows/scenarios.test.tsx` | "scenario 5 (boxes 4.5 and 4.5a): ..." (as above; it asserts posting creates no payment), and › "refuses an account with no card on file and an invoice that is not posted, writing nothing" | Scenario 5 steps 3 to 5: the card is charged only by **Charge card on file** and its confirmation; scenario 2 step 5: **Approve** is what charges the held card; scenario 6 step 7: rate changes need their own confirmation |

## Notes the runbook writer needs

- **Figures changed in Phase 4:**
  - Hale Construction has a card on file.
  - The Payments tiles change only after **Charge card on file** is clicked (Received $3,490.29 and Applied $3,409.99 in scenario 5).
  - The Accounts cycle banner gains **Approve N rate changes** on any run with rate changes (6 on a plain seed run).
  - The charge detail shows the evidence photo instead of a file name.
  - The portal has a third login, Sunrise Bakery.
  - The account page prices a future line on its start date ($27.00 for the 64 gal cart from Oct 1).

  Everything else on a plain seed run matches Phase 3G (DECISIONS.md entry 53): October 44 invoices, bulk 49 for $5,171.84, post 44 for $5,893.82, leakage $65.84 to $68.71.
- **A signup before the run changes the October totals.** With the scenario 1 signup: 45 invoices, $6,026.05, INV-2026-0223 to INV-2026-0267. With the whole demo chain: 46 invoices, $6,152.54, INV-2026-0223 to INV-2026-0268.
- **The Ratebook's header pill reads "13 published, 0 drafts"** on a fresh seed (Residential tab), and "21 published, 0 drafts" after the 4% publish. The pricing prototype's runbook says 15 and 23; do not copy those.
- **Box 4.7a:** neither follow-up shows in any scenario before 2027, because no seeded contract is past its term. With the clock at 2027-01-15:
  - Sunrise Bakery's account page, contract card, reads "Auto-renewed on Jan 1, 2027".
  - The pricing agent's bakery row shows an "auto-renewed 2027-01-01" pill and says the contract still prices the account.

  `src/flows/scenarios.test.tsx`, "box 4.7a", proves both.
- **The demo does not need the Store tab** under Approvals, but it lists every record a storefront step created, which is useful if a viewer asks.
