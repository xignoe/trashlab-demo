# RUNBOOK (billing surface)

How to start the billing surface, a scripted walkthrough of its five scenarios with the number you should see at
every step, and where each contract invariant is proved and where it shows on screen.

Every figure below was taken from a clean run and is asserted by `src/store/runbook.test.ts`, which drives the
store through this exact walkthrough. If that test changes, this file changes with it.

## Start

```
cd billing
npm install
npm run dev -- --port 5179 --strictPort     # or plain `npm run dev` on Vite's default port
npx vitest run                              # 14 test files, 220 tests
npm run build                               # typecheck and production build
```

Open http://localhost:5179/billing (`/` redirects there). All state lives in memory: reloading the page returns to
the seed, the October cycle, and the demo clock.

## Before you start: facts a demo viewer will notice

- **The clock.** Today is 2026-09-10 (Eastern daylight time, `-04:00`). The run on screen is the Oct 1 cycle,
  worked on Sep 10, so October invoices are issued Sep 10. Next cycle moves the cycle date to Nov 1 and the clock
  one month to 2026-10-10 (DECISIONS.md entry 41).
- **Maple's quarterly 96 gal line is $102.61 (10261 cents).** Base 8700 is 3 months x $29.00, fuel 609 is 7% of
  base, env 300 is the $1 flat fee once per whole month in the quarter (addendum C5), and tax 652 is 7% of base plus
  fuel. Her October invoice adds the extra cart ($33.91) and recycling ($44.22), for $180.74. She is past due with
  $87.45 open on INV-2026-0203, which is why Haul-E suggests approving her extra bags rather than waiving them.
- **pay_card_011 leaves $12.00 (1200) open on inv_res_020_2026q3** (INV-2026-0208, Howard Pruitt). It short paid
  by exactly that amount (DECISIONS.md entry 29). On the Payments tab its batch row reads "Short $12.00, still open
  on invoice". That is an open invoice balance. It is not unapplied cash.
- **pay_card_014's $15.30 (1530) can only be applied after the October invoices post.** It overpaid Sonia
  Petrov's (acct_res_011) only seeded invoice, INV-2026-0209, which is paid in full. Before October posts, Apply
  offers only Leave on account. After posting, her October invoice INV-2026-0237 ($102.61) is open and takes the
  $15.30.
- **pay_chk_unknown** is a $65.00 check from Nadia Karim (acct_res_017) with no allocation. Her INV-2026-0204 is
  open for $102.61.
- **Six rate changes before anyone touches a rate.** The seed already publishes cat_res_64 at $27.00 from Oct 1
  (up from $26.00), so every 64 gal account due on Oct 1 is flagged "rate version changed 2600 to 2700".
- **Priscilla Nguyen (acct_res_007)** added an extra cart on Sep 15 (work order wo_res_007_deliver), so October is
  her first invoice after a service change.
- **Kerr is suspended** and gets no charges; its route stops show skippedSuspended. **Holt is on vacation hold and
  still bills**, because Piedmont's proration policy is none (DECISIONS.md entry 4).

## Walkthrough

Work top to bottom in one page load. Money on screen is dollars; the cents in brackets are what the tests assert.

### Step 0. Open /billing

| Where | Expect |
|---|---|
| Header | "October 2026 cycle", pill "Not run yet", cycle date Oct 1 |
| Tiles | Invoices to generate 0, Clean 0, Need decisions 0, Dollars at issue $0.00 |
| Exception queue | "Run the cycle to see exceptions" |
| Leakage, last 3 cycles | $65.84 across 4 seeded waives (Aug 1 cycle $40.07, Sep 1 $0.00, Oct 1 $25.77) |

### Step 1. Run the cycle

Click **Run cycle**. The run creates 63 proposed charges: 56 recurring lines, 5 field event lines, and 2 overages.

| Where | Expect |
|---|---|
| Tiles | Invoices to generate **43**, Clean **31**, Need decisions **12**, Dollars at issue **$692.79** (69279) |
| Header pill | 14 decisions open |
| Queue, 14 rows | Sunrise Bakery contamination $22.90; Copperline Auto Body dry run $28.62 (Review, low: no photo); Hale Construction dry run $28.62; Grant Ellison overload $11.45; Ruth Maple extra bags $2.87; Hale overages $96.17 and $44.08; Priscilla Nguyen service change $11.30; six rate changes at 2600 to 2700 (Colleen Harper, Howard Pruitt, Kimberly Osei, Leon Adeyemi at $95.74 quarterly; Helen Marsh, Walter Finch at $31.91 monthly) |
| Ready to post card | Clean total $4,212.86, run total $5,864.63 |

### Step 2. Waive Maple's extra bags as goodwill and watch leakage

Select the **Ruth Maple, Extra bags** row.

| Where | Expect |
|---|---|
| Proposed amount | Base $2.50, Fuel surcharge $0.18, tax $0.19, total **$2.87** (287) |
| Evidence | Photo maple-extra-bags.jpg, note "3 bags beside cart, lid closed", Sep 7 |
| Customer context | Open balance $87.45, past due, no prior waives |
| Haul-E suggests | Approve, medium (past due account) |

Click **Waive**, choose **Goodwill**, optionally add a note, and click **Waive $2.87**. The person overrides the
agent here, which is the point of invariant 7.

| Where | Expect |
|---|---|
| Leakage | **$65.84 to $68.71** (6584 to 6871), 5 waives; Oct 1 cycle $25.77 to $28.64; By reason: Goodwill 2, $31.49 |
| Tiles | Clean 32, Need decisions 11, Dollars at issue $689.92 |
| Queue | The Maple row stays, with a Waived pill. Nothing is deleted |

### Step 3. Approve the Hale overages with their tickets

Select the **$96.17 Hale overage**. Evidence shows ticket_hale_1: gross 30,400 lb, tare 22,000 lb, net 8,400 lb
(4.20 t), 1.20 t over the 3 t cap, work order wo_hale_haul_1. Amount: base $84.00 (1.20 t x $70), fuel $5.88,
tax $6.29, total $96.17 (9617). Haul-E suggests Approve, high. Click **Approve $96.17**.

The second overage is ticket_hale_2: net 7,100 lb (3.55 t), 0.55 t over, base $38.50, fuel $2.70, tax $2.88,
total **$44.08** (4408). Click **Approve $44.08**.

| Where | Expect |
|---|---|
| Tiles | Need decisions 11 (Hale's dry run is still open), Dollars at issue $549.67 |

### Step 4. Decide the rest, bulk approve, post

Approve each of the other 11 queue items with **Approve**. The walkthrough approves Copperline's dry run even
though Haul-E flags it for review, which keeps the numbers fixed. Waiving it as insufficient evidence is the
realistic alternative and would add $28.62 to leakage.

| Where | Expect |
|---|---|
| Tiles | Invoices to generate 43, Clean 43, Need decisions 0, Dollars at issue $0.00 |
| Queue | "All decisions made. Ready to post." above the decided rows |

Post takes only approved charges, so bulk approve the clean lines first. Click **Bulk approve 49 clean**. The
confirmation reads "Approve 49 clean charges totaling **$5,171.84**?" (517184). Click **Approve 49**.

Click **Post invoices**. The confirmation reads "Post 43 invoices totaling **$5,861.76**?" (586176), numbered
**INV-2026-0223 to INV-2026-0265**. Click **Post 43 invoices**.

| Where | Expect |
|---|---|
| Header | Pill "Posted", button "Next cycle, Nov 1" |
| Tiles | Invoices posted 43, Posted total $5,861.76 |
| Posted this cycle | Ruth Maple INV-2026-0223 $180.74 due Sep 25; Oakridge Property Group INV-2026-0226 $646.00 due Oct 10 (net30, untaxed); Alicia Brandt INV-2026-0227 $34.20 due Sep 25; Sonia Petrov INV-2026-0237 $102.61; Hale Construction INV-2026-0265 $168.87 due Oct 10 (two overages plus the dry run). Every row shows a lock, and every invoice is issued Sep 10 |
| Leakage | Still $68.71 |

### Payments tab (between steps 4 and 5)

Click **Payments** in the header.

| Where | Expect |
|---|---|
| Tiles | Received this week $3,321.42 (16 payments, Sep 4 to Sep 10), Applied $3,241.12, Unapplied cash $80.30 (2 payments), Processor fees $41.20 |
| Processor batch batch_0908 | Gross $1,318.42, fees ($41.20), net $1,277.22; 14 rows; footer paid $1,318.42, applied $1,303.12, unapplied $15.30 |
| Check: Oakridge Property Group | $1,938.00 across three invoices, remaining $0.00 on each |

Under Unapplied cash, click **Apply to INV-2026-0237** on the card overpayment (pay_card_014). The form lists
INV-2026-0237 as open $102.61 and fills in $15.30. Click **Apply $15.30**, and the page shows **$87.31** (8731)
still open on Sonia Petrov's October invoice. Next, click **Apply** on the check with no invoice match
(pay_chk_unknown). After October posts, Nadia Karim has two open invoices, so the button reads "Apply" rather than
"Apply to INV-2026-0204". The form fills the oldest invoice, INV-2026-0204 (open $102.61), with $65.00. Click
**Apply $65.00**, which leaves **$37.61** (3761) open.

| Where | Expect |
|---|---|
| Tiles | Received $3,321.42, Applied $3,321.42, Unapplied cash $0.00, Processor fees $41.20 |
| Processor batch batch_0908 | Gross $1,318.42, fees ($41.20), net $1,277.22, all unchanged; the footer now reads applied $1,318.42, unapplied $0.00, because pay_card_014's allocation belongs to its batch payment |

Before step 4, the same rows read "Apply" (pay_card_014) and "Apply to INV-2026-0204" (pay_chk_unknown). Apply on
pay_card_014 then shows no open invoice and offers only Leave on account.

Click **Run** to go back.

### Step 5. Publish cat_res_96 at $31, post stays, next run reflects $31

Click **Rates**. Enter Monthly price **31.00**, Effective from **2026-11-01**, Zone **Open market** (zone_open), then click
**Publish locally**. The drawer lists **rv_bl_0001**, which supersedes rv_res_96_2026 and was published Sep 10.
Pricing owns publishing; this drawer stands in until merge.

In Posted this cycle, INV-2026-0227 (Alicia Brandt) still reads **$34.20**, and its 96 gal line still has base
$29.00. Posting locked the price.

Click **Next cycle, Nov 1**, then **Run cycle**. The cycle date is Nov 1 and the clock is 2026-10-10. The run
creates 27 charges.

| Where | Expect |
|---|---|
| Tiles | Invoices to generate 20, Clean 12, Need decisions 8, Dollars at issue $291.92 |
| Queue, 8 rows | Rate change "2900 to 3100", each **$36.49** (3649: base $31.00, fuel $2.17, env $1.00, tax $2.32), for the eight monthly 96 gal accounts: Alicia Brandt, Curtis Lane, Devin Okafor, Jeanette Cole, Marcy Whitlock, Omar Haddad, Priscilla Nguyen, Tomas Reyes. Quarterly accounts are not due on Nov 1 |
| Posted card | Titled "Posted, Oct 1 cycle": it keeps showing October until November posts. INV-2026-0227 Alicia Brandt is unchanged at $34.20; click the number to open its line, base $29.00 (invariant 1) |
| Leakage | $28.64 across 3 waives: Sep 1 cycle $0.00, Oct 1 $28.64, Nov 1 $0.00. The August waives fell out of the window |

Optional: approve the 8 rows, **Bulk approve 19 clean** ($2,827.15), then post 20 invoices numbered
INV-2026-0266 to INV-2026-0285 totaling $3,119.07, issued 2026-10-10 and due 2026-10-25. A waive made in this run
is stamped Oct 10 and counts toward the Nov 1 cycle (DECISIONS.md entries 36 and 41).

## Invariants: where each is proved and where it shows

Test names below are `describe` › `it` exactly as written in the file.

| # | Invariant | Proved by | Visible on |
|---|---|---|---|
| 1 | Publishing a RateVersion never changes a posted Invoice | `src/store/post.test.ts`: "invariant 1: publishing a RateVersion never changes a posted Invoice" › "a new cat_res_96 rate leaves the posted October invoice and its charges byte for byte unchanged, while the November run uses the new price". Also `src/store/decisions.test.ts`: "scenario chain: waive, approve overages, bulk approve, post, publish $31, next cycle (invariant 1)" › "the posted October invoice keeps 2900 while the November run prices the same line at 3100" | Billing run, step 5: the "Posted, Oct 1 cycle" card (INV-2026-0227 stays $34.20, line base $29.00) next to the Nov 1 queue's $36.49 rate change rows |
| 2 | Every Charge carries base, fees, tax, source, and ruleWon | `src/store/engine.test.ts`: "invariant 2: every charge carries base, fees, tax, source, and ruleWon" › "holds for recurring, event, fee, lateFee, contract, and taxExempt charges from computeCharge", and › "also holds for every historical charge in the seed". Also `src/store/generate.test.ts`: "generateEventCharges" › "invariant 2: every generated charge carries base, fees, tax, source, and ruleWon" | Billing run detail panel: Proposed amount (base, each fee by name, tax, total), Evidence (the source), and Policy (ruleWon and rate version or contract) |
| 3 | A ServiceItem change creates a WorkOrder and appears in the next generateRecurringCharges run | `src/store/generate.test.ts`: "generateRecurringCharges" › "invariant 3: acct_res_007 extra cart appears in the 2026-10-01 run, not in the 2026-07-01 run, and wo_res_007_deliver exists" | Billing run queue, step 1: Priscilla Nguyen "Service change" row; its evidence shows the service item, effective Sep 15, and "First invoice after service change". Billing does not make service changes itself. Account and dispatch do, and the seed carries the work order, so this test proves the billing half |
| 4 | Suspended accounts produce skippedSuspended events, never charges | `src/store/generate.test.ts`: "generateRecurringCharges" › "invariant 4: suspended acct_res_kerr produces zero charges while its route events are skippedSuspended", and "generateEventCharges" › "invariant 4: an exception event on a suspended account produces nothing" | Billing run, step 1: acct_res_kerr is not among the 43 invoices, and no queue row or posted invoice names Kerr |
| 5 | WaivedCharge rows are never deleted | `src/store/waive.test.ts`: "invariant 5: WaivedCharge rows are never deleted" › "after waiving, re-running generation, and posting, the WaivedCharge row is still present and the waived charge is on no invoice", › "applyWaive only ever appends to waivedCharges", and › "no function in src/store removes a WaivedCharge (static scan of the store sources)". Also `src/store/decisions.test.ts`: "waive (invariant 5: nothing is deleted)" › "creates a WaivedCharge row through waiveCharge and marks the item waived; the detail shows the row" | Billing run, step 2: the Maple row stays in the queue as Waived, its detail shows the waive record, and the Leakage card counts it. Maple's invoice INV-2026-0223 has 3 lines, not 4 |
| 6 | Allocation is many to many; a batch splits into gross, fees, and per invoice allocations | `src/store/allocate.test.ts`: "allocate" › "invariant 6: batch_0908 gross minus fees equals net, and its 14 allocations plus the unapplied remainder equal gross", and › "pay_chk_oakridge splits across three invoices and each invoice balance drops accordingly". Also `src/store/payments.test.ts`: "batch card: batch_0908" › "net equals gross minus fees, 14 rows, and the footer sums match gross and the unapplied remainder" | Payments tab: the batch_0908 card (gross, fees, net, 14 rows, footer) and the Oakridge check card (one check, three invoices) |
| 7 | Agents draft; rules authorize; a human approves anything that moves money or touches a relationship | `src/store/post.test.ts`: "postInvoices" › "a proposed charge cannot be posted; a person approves first". `src/store/useStore.test.ts`: "decisions" › "post refuses while a queue item is undecided, then posts approved charges as inv_bl_ invoices". `src/store/decisions.test.ts`: "post invoices" › "warns about clean charges left unapproved: they stay off the invoices". `src/store/suggest.test.ts`: "suggestFor" › "every suggestion names its evidence and never mutates the charge or the db". `src/store/payments.test.ts`: "applyUnappliedStub" › "is pure: returns allocation rows through the engine and writes nothing" | Billing run detail panel: the agent callout ends "Agents draft. A person approves anything that moves money."; Post invoices stays disabled until every queue item is decided. In step 2 the agent suggested approve and the person waived. On Payments, unapplied cash moves only when a person clicks Apply |

## Test coverage the checklist names

All of these pass in `npx vitest run`.

- **Fee base: fuel on service lines only.** `src/store/engine.test.ts`, "computeCharge fees and tax":
  - "a fee line (delivery) gets no fuel surcharge because fee_fuel_7pct is on serviceLines and excludes fee, but is taxed"
  - "an event line gets the fuel surcharge but not the environmental fee"
  - "recurring cat_res_96 for acct_res_maple at base 2900 over an Oct to Dec period: fuel 203, env 300 (three whole months, addendum C5), tax 217, total 3620"

  Also `src/store/generate.test.ts`, "generateEventCharges" › "each event charge carries fuel and tax (fuel applies to event lines, env fee does not)".
- **Late fee tax exclusion.** `src/store/engine.test.ts`, "computeCharge fees and tax":
  - "a lateFee line has zero fees and zero tax even in a taxed zone"
  - "a lateFee line stays untaxed even if a TaxRule wrongly lists lateFee"
- **taxExempt accounts.** `src/store/engine.test.ts`, "computeCharge fees and tax" › "a taxExempt account (acct_pm_oakridge) gets taxCents 0 with fees intact". Also `src/store/generate.test.ts`, "generateRecurringCharges" › "acct_pm_oakridge yields four charges on one account, one per site, untaxed".
- **Invariant 1.** `src/store/post.test.ts` › "a new cat_res_96 rate leaves the posted October invoice and its charges byte for byte unchanged, while the November run uses the new price"; `src/store/decisions.test.ts` › "the posted October invoice keeps 2900 while the November run prices the same line at 3100".
- **Invariant 4.** `src/store/generate.test.ts` › "invariant 4: suspended acct_res_kerr produces zero charges while its route events are skippedSuspended" and › "invariant 4: an exception event on a suspended account produces nothing".
- **Invariant 5.** `src/store/waive.test.ts` › "after waiving, re-running generation, and posting, the WaivedCharge row is still present and the waived charge is on no invoice", › "applyWaive only ever appends to waivedCharges", › "no function in src/store removes a WaivedCharge (static scan of the store sources)"; `src/seed/seed.test.ts` › "waived charges point at charges with status waived and are on no invoice (invariant 5)".
- **Invariant 6.** `src/store/allocate.test.ts` › "invariant 6: batch_0908 gross minus fees equals net, and its 14 allocations plus the unapplied remainder equal gross"; `src/seed/seed.test.ts` › "batch_0908 payments sum to gross, net equals gross minus fees, 14 distinct invoices, 1530 unapplied (invariant 6)".
- **This runbook.** `src/store/runbook.test.ts`, "RUNBOOK.md walkthrough" › "every number in the five scenarios, from a clean seed".
- **The clock (addendum E1).** `src/store/clock.test.ts`, which covers TODAY, the `-04:00` stamps, the scan for `new Date(` in src/store, and Next cycle moving the clock to 2026-10-10.
