# RUNBOOK: Account view

How to run the account view and prove its invariants by hand. Five scripted scenarios, each with the numbers you should see: A (Maple cart change), B (Oakridge check allocation), C (Kerr suspension and skipped stops), D (Bakery: why the 3 yd price is $198 not $220), and E (the next billing run preview proves invariant 3, plus where this surface proves invariants 2, 4, 5, and 6). Run them in order on one page load, or reload between them to start each from seed.

## Start

```
npm install && npm run dev
```

`npm run dev` starts Vite on port **5199** with `strictPort` (`server.port` in `vite.config.ts`, shared/CONTRACT_ADDENDUM.md section G), so a busy port fails loudly instead of drifting. Open http://localhost:5199/account. It opens the default account, Dana Maple (`acct_res_maple`); the left rail pins the other four focus accounts: Sunrise Bakery (`acct_bakery`), Oakridge Property Management (`acct_pm_oakridge`), Hale Construction (`acct_contractor_hale`), and Lewis Kerr (`acct_res_kerr`). The rail search finds any of the 45 accounts by name, id, address, or PO.

**Demo clock.** TODAY is fixed at Thursday **2026-09-10**, exported from `src/store/clock.ts` and used everywhere instead of `new Date()`. Every "days late", "next run", and effective-date default below is computed from that date, so the numbers match on any machine on any day.

**State.** The store is in memory. A page reload returns every account to seed; nothing else does. Running `python3 scripts/build_dashboard.py CHECKLIST.md` or editing a doc mid-scenario does not reload the page (Vite and Tailwind do not watch `dashboard.html`, `progress.json`, or `*.md`).

**Checks.** `npm run build` (typecheck and bundle) and `npx vitest run` (engine and seed tests). The numbers in every scenario below are also asserted in `src/store/engine.test.ts` or `src/seed/seed.test.ts`.

## Scenario A: Maple changes the 96 gal cart to a 64 gal cart (invariant 3)

Dana Maple calls on Thursday 2026-09-10 to downsize her trash cart from next Monday. Proves invariant 3: a ServiceItem change creates a WorkOrder and appears in the next `generateRecurringCharges` run.

### Before

On `/account/acct_res_maple`:

| Where | Expected |
|---|---|
| Past due | $87.45 (PD-2026-0404, the Q3 invoice, due Jul 5, 2026) |
| Next invoice, Oct 1 | $183.61 estimated (18361 cents): 96 gal $102.61 (10261), extra cart $33.91 (3391), recycling $44.22 (4422), loose bag fee from the Sep 7 extra bags $2.87 (287) |
| Service table | 96 gal trash cart, weekly, PD-CART-0100, $29.00 per month, Rate card, Active |
| Sync chips | Dispatch, Billing, QuickBooks all in sync |
| Open items | nothing open |

### Steps

1. In the 412 Maple St service table, click **Change** on the 96 gal trash cart row. The Change service drawer opens with "Replaces" set to the 96 gal cart and the effective date set to next Monday, **2026-09-14**. The preview reads "This is the line as it is today" until something differs.
2. Set **New service** to **64 gal trash cart**. Leave quantity 1 and frequency weekly.
3. Read the preview before confirming:
   - **Dispatch effect:** Swap work order `wo_ac_0004` (the first work order of a fresh session), Open, scheduled for Sep 14, 2026 at 412 Maple St. Pull: 96 gal trash cart `PD-CART-0100`. Drop: 64 gal trash cart `PD-CART-9001`, new container.
   - **Billing effect:** before $29.00 per month, Rate card `rv_res_96_v1`; after $26.00 per month, Rate card `rv_res_64_v1`; rate change -$3.00 per month.
   - **Current cycle (Jul 1 to Sep 30, 2026): no adjustment, Piedmont Disposal does not prorate.** The 96 gal cart stays billed through Sep 30, 2026 as posted on PD-2026-0404; no credit for the days after Sep 14.
   - **Next invoice:** before $183.61, after $173.30, change -$10.31 (-1031 cents; base -$9.00 before fees and tax). Next run Oct 1, 2026; the 64 gal line first bills on that run. The line table shows "Drops" 96 gal trash cart, 2026-10-01 to 2026-12-31, -$102.61 and "Adds" 64 gal trash cart, 2026-10-01 to 2026-12-31, +$92.30.
4. Click **Confirm and create swap**. The drawer closes and a toast reads "Work order wo_ac_0004 created: Swap at 412 Maple St on Sep 14, 2026. 96 gal trash cart ends and 64 gal trash cart starts Sep 14, 2026."

### After

| Where | Expected |
|---|---|
| Service table | 64 gal trash cart, weekly, `PD-CART-9001`, since Sep 14, 2026, $26.00 per month, Rate card, "Starts" (hover shows Sep 14, 2026). The 96 gal row is hidden; "Show ended (1)" reveals it with "to Sep 14, 2026" and "Ends". |
| Open items | Swap 64 gal trash cart, `wo_ac_0004`, Open, Sep 14, with the office note "Cart change by phone, note_ac_0001: Change 96 gal trash cart to 64 gal trash cart, effective 2026-09-14" and a **Mark scheduled** button. No Request row is written (Portal owns Requests). |
| Next billing run preview | $173.30; the lines show the 64 gal cart for Oct 1 to Dec 31, 2026 at base $78.00, fuel $5.46, env $3.00, tax $5.84, total $92.30. No 96 gal line. |
| Next invoice (money strip) | $173.30 |
| Dispatch chip | stale: "Work order wo_ac_0004 for 2026-09-14 is open and not yet scheduled on a route" |
| Past due | still $87.45: the current quarter's invoice PD-2026-0404 is untouched (invariant 1 by construction; posted invoices are never recomputed) |

5. Click **Mark scheduled** on the work order. It turns Scheduled, the button disappears, and the Dispatch chip returns to in sync.

### Expected numbers in one place

- Swap WorkOrder on 2026-09-14 at 412 Maple St.
- Next invoice (2026-10-01) drops the quarter by **900 cents base** before fees and tax (3 months x $3.00): 96 gal line 8700 base / 10261 total becomes 64 gal line 7800 base / 9230 total, a total drop of 1031 cents.
- Current quarter unchanged: PD-2026-0404 total 18074, open balance 8745.

The same numbers are asserted in `src/store/engine.test.ts` ("Phase 4: change a service", "scenario A numbers").

## Scenario B: Oakridge's check is applied across three invoices (invariant 6)

Oakridge Property Management mailed one check, `pay_chk_oakridge`, for $2,278.92 (227892 cents), received Tuesday 2026-09-08. It sits on the account unapplied while all three net30 invoices are past due. Proves invariant 6: allocation is many-to-many, one payment split across several invoices by explicit PaymentAllocations.

### Before

On `/account/acct_pm_oakridge`:

| Where | Expected |
|---|---|
| Balance | $2,278.92, with "$2,278.92 unapplied payment" under the figure |
| Past due | $2,278.92 (PD-2026-0401 due Jul 1, 2026, 71 days late) |
| Invoices | PD-2026-0401 (issued Jun 1, due Jul 1), PD-2026-0435 (Jul 1, due Jul 31), PD-2026-0437 (Aug 1, due Aug 31): each total $759.64 (75964), paid $0.00, open $759.64, Past due 71d, 41d, 10d |
| Payments | `pay_chk_oakridge`, Settled, Sep 8, 2026, Check, $2,278.92, Not applied, unapplied $2,278.92, with an **Allocate** button |
| Sync chips | Dispatch, Billing, QuickBooks all in sync |

### Steps

1. Click **Take a payment** in the side column. Under **Unapplied payments** the drawer lists `pay_chk_oakridge` $2,278.92, "Check received Sep 8, 2026, $2,278.92 total". (The **Allocate** button in the payments table under the invoices opens the same screen directly.)
2. Click **Allocate** next to it. The drawer becomes "Apply payment pay_chk_oakridge" with $2,278.92 available and the three open invoices, oldest due first, each with an empty Apply field. Unallocated remainder reads $2,278.92.
3. Click **Auto-allocate oldest first**. Each row fills with 759.64 (75964 cents); Applied $2,278.92; Unallocated remainder $0.00.
4. Read the preview before confirming:
   - **Invoices:** PD-2026-0401, PD-2026-0435, PD-2026-0437: open now $759.64, applied -$759.64, new open **Paid in full**.
   - **Account:** balance $2,278.92 before, $0.00 after; past due $2,278.92 before, $0.00 after.
   - **QuickBooks:** in sync to stale, "Payment not yet synced: allocation of pay_chk_oakridge recorded 2026-09-10, after the last sync on 2026-09-08."
5. Click **Apply $2,278.92**. The drawer closes and a toast reads "pay_chk_oakridge applied: $2,278.92 across 3 invoices (PD-2026-0401, PD-2026-0435, PD-2026-0437). Balance now $0.00."

### After

| Where | Expected |
|---|---|
| Balance | $0.00; the unapplied line is gone |
| Past due | $0.00, "Nothing past due" |
| Invoices | "nothing open"; **Show paid (3)** lists the three at paid $759.64, open $0.00, **Paid** |
| Payments | `pay_chk_oakridge` applied to PD-2026-0401 $759.64, PD-2026-0435 $759.64, PD-2026-0437 $759.64; unapplied $0.00; no Allocate button |
| QuickBooks chip | stale, "Payment not yet synced: allocation of pay_chk_oakridge recorded 2026-09-10 ..." |
| Take a payment | the Unapplied payments list no longer appears |

### Try to break it

- Type 800.00 on PD-2026-0401: the row turns red, the preview reads "PD-2026-0401: $800.00 is more than its open balance of $759.64", and Apply is disabled.
- After step 5, record a new $10.00 cash payment and type 10.00 against any Oakridge invoice: there is no open invoice left to type it against. Through the store the engine refuses it ("exceeds its open balance of 0") and writes nothing.

### Expected numbers in one place

- 3 PaymentAllocations from `pay_chk_oakridge`: 75964 + 75964 + 75964 = 227892 cents, the whole check.
- Account balance 227892 before, 0 after. Past due 227892 before, 0 after. Unapplied on the check 227892 before, 0 after.

The same numbers are asserted in `src/store/engine.test.ts` ("Phase 5", "scenario B").

## Scenario C: Kerr is suspended and the route skips him (invariant 4)

Lewis Kerr (`acct_res_kerr`, 230 Birch Ln, Tuesday route `route_tue_res`) is seeded suspended for non-payment: PD-2026-0403 ($102.61, 10261 cents) has been open since Jul 5, and the field record shows his Sep 1 and Sep 8 stops as Skipped, suspended. Proves invariant 4: a suspended account produces skippedSuspended stops and no charges.

### Before

On `/account/acct_res_kerr`:

| Where | Expected |
|---|---|
| Status pill | Suspended |
| Past due | $102.61 |
| Next invoice | $0.00, "Suspended, no charges will be generated" |
| Next billing run preview | $0.00, "nothing will be generated", and the inset "Suspended: no charges will be generated" with the $25.00 reinstatement fee |
| Side column button | **Reinstate** (it reads Hold or suspend on an active account, Resume on a held one) |
| Sync chips | all in sync |

### Steps

1. Click **Reinstate**. The drawer opens as "Reinstate account" and says the account was suspended before this session and reinstating takes effect today, Sep 10, 2026.
2. Read the preview:
   - **Writes:** account Suspended to **Past due** (8745 is not Kerr's, 10261 is: anything past due sends it to Past due, not Active); `si_kerr_96` 96 gal trash cart, weekly: held to active. Effective dates do not move.
   - **Route stub, 230 Birch Ln, `route_tue_res`:** Sep 1 and Sep 8 recorded (T. Nguyen), Skipped, suspended in both columns; Sep 15, Sep 22, Sep 29, Oct 6 projected, Now Skipped, suspended, After confirm **Completed**, each marked "flips". "Tuesday route, 16 other stops still run every Tuesday. 4 projected stops change for this site."
   - **Billing effect:** "Charges resume on the Oct 1, 2026 run, plus a $25.00 reinstatement fee". Next billing run $0.00 before, **$129.36** after (quarterly 96 gal $102.61 plus the fee $26.75). The proposed fee charge: "Reinstatement fee, Piedmont Disposal policy", Proposed, source manual `sc_ac_0001`, base $25.00, fees $0.00, tax $1.75, total $26.75. Billing chip in sync to stale.
3. Click **Reinstate account**. The toast reads "acct_res_kerr reinstated: Status Past due, 1 service line active again. Reinstatement fee ch_ac_#### proposed at $26.75; billing chip stale until billing takes it."
4. The header now shows **Past due**, Next invoice **$129.36**, the Billing chip is stale (hover: the fee id "proposed by the office and not yet taken by billing"), and the button reads **Hold or suspend**. The next-run card shows $129.36 with "1 recurring line, 0 events, 1 proposed charge"; **Show 2 lines** lists the 96 gal line and the fee as "Proposed by office, waiting for billing". The Charge table is untouched: billing owns it.
5. Click **Hold or suspend**. Because Kerr is past due, the drawer opens on **Suspension**, reason **Non-payment**, effective Sep 10, 2026. The route stub now reads the other way: Sep 15, Sep 22, Sep 29, Oct 6 Now **Completed**, After confirm **Skipped, suspended**. Billing effect: "Next billing run: no charges (suspended)", $129.36 before, **$0.00** after, and the $25.00 reinstatement fee noted as due on reinstatement.
6. Click **Suspend account**. The toast reads "acct_res_kerr suspended: Non-payment, from Sep 10, 2026. Status Suspended, 1 service line held; no charges will be generated."

### After

| Where | Expected |
|---|---|
| Status pill | Suspended; button reads Reinstate |
| Next invoice | $0.00, "Suspended, no charges will be generated" |
| Next billing run preview | $0.00 and "Suspended: no charges will be generated", plus "Already proposed before the suspension and still waiting for billing: Reinstatement fee, Piedmont Disposal policy $26.75" |
| Billing chip | stale (the fee is still proposed) |
| Reinstate drawer | "Suspended Sep 10, 2026, non-payment (sc_ac_0002)" and the four projected stops flipping back to Completed |

### The same thing on Maple (active account, past due)

On `/account/acct_res_maple` click **Hold or suspend**. It opens on Suspension, Non-payment. The route stub for 412 Maple St (`route_mon_res`, Monday) shows Aug 31 and Sep 7 recorded Completed, then Sep 14, Sep 21, Sep 28, Oct 5 flipping from Completed to **Skipped, suspended**, with 15 other stops still running. Three lines go from active to held (`si_maple_96`, `si_maple_extra`, `si_maple_recycling`). Next billing run **$183.61** before (three quarterly lines $102.61 + $33.91 + $44.22 and the $2.87 extra bags event), **$0.00** after. Confirm, and the header pill, Next invoice ($0.00), and next-run panel update at once. Switch to **Vacation hold** instead and the same stops read "Skipped, hold" up to the resume date and Completed from it; the next invoice stays $183.61 because Piedmont Disposal does not prorate.

### Expected numbers in one place

- Reinstatement fee: base 2500, fees 0, tax 175 (tax_open 7%), total 2675, lineType fee, source manual, status proposed, in the `proposedCharges` sidecar, not `charges`.
- Kerr next run: 0 suspended; 10261 + 2675 = 12936 after reinstating; 0 after suspending again.
- Maple next run: 18361 active; 0 suspended; 18361 on hold.
- Kerr route stub: 2 recorded plus 4 projected Tuesdays (2026-09-15, 09-22, 09-29, 10-06); `route_tue_res` has 16 other stops.

The same numbers are asserted in `src/store/engine.test.ts` ("Phase 6").

## Scenario D: Bakery, why the 3 yd price is $198.00 and not $220.00

Sunrise Bakery (`acct_bakery`, 88 Commerce Ave, Wednesday route) asks why its 3 yd front load is $198.00 a month when the published zone rate is $220.00. Read-only: nothing is written. Shows the price precedence (contract override beats zone rate inside the term) and that every line carries the rule that won.

### Before

On `/account/acct_bakery` (rail: Sunrise Bakery):

| Where | Expected |
|---|---|
| Status pill | Active |
| Balance | $0.00; "Last payment $424.47 ACH, Aug 31, 2026" |
| Past due | $0.00, "Nothing past due" |
| Next invoice, Oct 1 | $447.37, "Estimated, bills Oct 1 to Oct 31, 2026, 3 lines" (monthly, billed in advance) |
| Service table, 88 Commerce Ave | 3 yd front load container, 1, 2x per week, `PD-FL-0105`, since Jan 1, 2026, **$198.00 per month**, source **Contract**, Active. 3 yd front load, wood waste, 1, 2x per week, `PD-FL-0106`, $171.00 per month, Contract, Active |

### Steps

1. Click **$198.00** on the 3 yd front load container row (the **Contract** pill opens the same thing). The "why this price" inset opens under the table:
   - **Why $198.00 for the 3 yd front load container:** "Contract contract_bakery override of $198.00 per month won over the $220.00 zone rate, 10% below rate card for "competitive match"."
   - "Override applies to 3 yd front load container, 2x per week inside the term Jan 1, 2026 to Dec 31, 2027. After the term the rate card wins again."
   - "Rate card it beat: Zone rate rv_fl_3yd_v1 for Piedmont city (open market), 2x per week: $220.00 effective Jan 1, 2026, published Dec 15, 2025."
   - Chips: matched zone `zone_open`, frequency `2x per week`, on `2026-09-10`, contract `contract_bakery`, rate card `rv_fl_3yd_v1`.
2. Press **Escape** or click anywhere outside the inset to close it. Click **$171.00** for the wood waste line: the same contract wins over the $190.00 zone rate (`rv_fl_3yd_wood_v1`), also 10% below.
3. Read the **Contract** card: `contract_bakery`, term Jan 1, 2026 to Dec 31, 2027 (477 days until term end), renewal notice 60 days before term end (notice by Nov 1, 2027), escalator fixed 4%, next anniversary Jan 1, 2027. Overrides: 3 yd $198.00 against rate card $220.00, 10% below, competitive match, **$205.92 after Jan 1, 2027**; wood waste $171.00 against $190.00, $177.84 after Jan 1, 2027.
4. In **Next billing run preview**, click **Show 3 lines**. Each line names its source and the rule that won:

| Line | Source and rule | Base | Fees | Tax | Total |
|---|---|---|---|---|---|
| 3 yd front load container, Oct 1 to Oct 31, 2026 | serviceItem `si_bakery_3yd`, Contract `contract_bakery` | $198.00 | $14.86 | $14.83 | $227.69 |
| 3 yd front load, wood waste, Oct 1 to Oct 31, 2026 | serviceItem `si_bakery_wood`, Contract `contract_bakery` | $171.00 | $12.97 | $12.81 | $196.78 |
| Contamination fee, serviced Sep 2, 2026 (PD-FL-0106) | serviceEvent `ev_bakery_contamination`, Exception | $20.00 | $1.40 | $1.50 | $22.90 |
| Total | | $389.00 | $29.23 | $29.14 | **$447.37** |

5. Click **Show paid (2)** under Invoices: PD-2026-0436 (issued Jul 20, 2026) and PD-2026-0439 (issued Aug 20, 2026), each $424.47, paid by ACH. $424.47 is $227.69 + $196.78: the posted invoices were billed at the contract prices too.

### Expected numbers in one place

- `resolvePrice(cat_fl_3yd, 2x, zone_open, acct_bakery, 2026-09-10)` = **19800**, ruleWon `contractOverride`, contractId `contract_bakery`. The rate card it beat: `rv_fl_3yd_v1` at **22000**; 19800 is 10% below.
- 3 yd monthly line: base 19800; fees 1486 (fuel 7% = 1386, plus the flat env fee 100); tax 1483 (7% of 19800 + 1386 = 21186, rounded half up); total 22769.
- Wood waste line: base 17100, fees 1297, tax 1281, total 19678. Contamination event: base 2000, fuel 140 (no env fee on event lines), tax 150, total 2290. Oct 1 run: 22769 + 19678 + 2290 = **44737**.
- After the Jan 1, 2027 anniversary: 19800 x 1.04 = 20592 and 17100 x 1.04 = 17784. After Dec 31, 2027 the term ends and the 22000 rate card wins again.

Asserted in `src/store/engine.test.ts` ("bakery cat_fl_3yd 2x: contract override 19800 wins", "bakery 3 yd: contract 19800 won over the 22000 zone rate, 10% below for competitive match", "bakery: monthly lines at contract prices with contractId copied in") and `src/seed/seed.test.ts` ("Bakery: posted August and September invoices at contract prices").

## Scenario E: the next billing run preview proves invariant 3, and where the other invariants live

The navy **Next billing run preview** card is not a stored number. It is `previewNextRun` (in `src/store/engine.ts`), which calls `generateRecurringCharges` for the account's next cycle date plus `generateEventCharges`, recomputed from the store on every render. So a ServiceItem change shows up in the next run the moment it is confirmed, with no refresh and no separate "recalculate" step. That is invariant 3: a ServiceItem change creates a WorkOrder and appears in the next `generateRecurringCharges` run.

### Steps (fresh page load, on `/account/acct_res_maple`)

1. Read the card before anything changes: **$183.61**, "Oct 1, 2026 · Quarterly, bills Oct 1 to Dec 31, 2026". **Show 4 lines** lists the 96 gal trash cart $102.61 (base $87.00, fees $9.09, tax $6.52), extra trash cart $33.91, recycling cart $44.22, and the Sep 7 extra bags event $2.87. The Next invoice stat reads the same $183.61.
2. Click **Change** on the 96 gal trash cart row, set **New service** to **64 gal trash cart**, leave the effective date at **2026-09-14**. The drawer's billing effect shows the next run before $183.61 and after **$173.30**, change -$10.31.
3. Click **Confirm and create swap**. Without any reload:
   - **Open items** gains the swap work order `wo_ac_0004` for Sep 14, 2026 at 412 Maple St (the WorkOrder half of invariant 3).
   - The card now reads **$173.30**. **Show 4 lines** has the 64 gal trash cart for Oct 1 to Dec 31, 2026 at base $78.00, fees $8.46 (fuel $5.46, env $3.00), tax $5.84, total **$92.30**, and no 96 gal line (the next-run half).
   - The Next invoice stat reads $173.30. The posted Q3 invoice PD-2026-0404 is unchanged at total $180.74, open $87.45.

Expected: next run 18361 before, 17330 after (-1031); the 96 gal line (8700 base, 10261 total) is replaced by the 64 gal line (7800 base, 9230 total). Asserted in `src/store/engine.test.ts` ("Phase 4: change a service (invariant 3)" and "invariant 3: after closing si_maple_96 on 2026-09-14 and opening a 64 gal item, the next run has the 64 line and not the 96").

### Which invariants this surface proves, and where

| # | Invariant (shared contract) | On screen | In code |
|---|---|---|---|
| 1 | Publishing a RateVersion never changes a posted Invoice. | Scenario A and E: PD-2026-0404 keeps $180.74 and $87.45 open after the price change. Posted invoices are read from the store, never recomputed. | engine.test.ts "a posted invoice never changes when a new RateVersion is published (invariant 1)" |
| 2 | Every Charge carries base, fees, tax, source, and ruleWon. | Every expanded next-run line (Scenarios D and E) shows base, fees, tax, and total, with a meta line naming the source (`serviceItem si_bakery_3yd`, `serviceEvent ev_bakery_contamination`) and the rule that won (Contract, Rate card, Exception). The Kerr reinstatement fee in Scenario C is built through the same `computeCharge` and shows the same fields. | engine.test.ts `expectInvariant2` and "invariant 2 holds for every generated charge"; seed.test.ts "seed: invariant 2, every charge carries base, fees, tax, source, ruleWon" |
| 3 | A ServiceItem change creates a WorkOrder and appears in the next generateRecurringCharges run. | Scenario A and this scenario. | engine.test.ts "Phase 4: change a service (invariant 3)" |
| 4 | Suspended accounts produce skippedSuspended events, never charges. | Scenario C: Kerr's route stub shows every stop on or after the effective date as Skipped, suspended, and the next-run card reads $0.00, "Suspended: no charges will be generated". | engine.test.ts "2026-10-01: nothing for suspended acct_res_kerr (invariant 4)", "setAccountStatus suspends Maple: items held, no charges; reinstating brings them back (invariant 4)", and "Phase 6: hold or suspension with route stub (invariant 4)" |
| 5 | WaivedCharge rows are never deleted. | Not on this screen: billing owns waivers, and the account view offers no waive or delete control. | engine.test.ts "waiveCharge appends a row and there is no delete action anywhere in the store (invariant 5)": `waiveCharge` appends a WaivedCharge row and marks the Charge waived, a second waive is refused, and the store exposes no action whose name contains delete, remove, drop, or clear. |
| 6 | Allocation is many-to-many; a batch splits into gross, fees, and per-invoice allocations. | Scenario B: one check, three PaymentAllocations, three invoices. The payments table under Invoices lists each allocation per payment and per credit memo. The batch split into gross and fees belongs to billing and is not claimed here. | engine.test.ts "several sources on one invoice (invariant 6, many-to-many)" and "Phase 5: take a payment and issue a credit (invariant 6)" |
| 7 | Agents draft; rules authorize; a human approves anything that moves money or touches a relationship. | Every write on this surface is an office action confirmed in a drawer after a preview; there is no agent. | Not tested here. |

## Issue credit, in brief

On any account, **Issue credit** takes a reason (Goodwill, Missed pickup, Billing error, Sales promise, Operational fault, Other; Other needs a note), an amount in dollars, an optional note, and an optional invoice. With no invoice the preview reads "Unapplied credit on account: $0.00 to $X" and, after confirm, the Balance card shows "$X unapplied credit" and the credit memo appears under the invoices table as **On account** with an Allocate button. With an invoice, the preview shows its open balance before and after, and confirm writes the CreditMemo (by office, Sep 10, 2026) and its creditMemo allocation together. Example on Maple: a $7.45 billing error credit on PD-2026-0404 takes the open balance from $87.45 to $80.00 and past due to $80.00.
