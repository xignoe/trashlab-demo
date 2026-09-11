# Synthesis of the five DECISIONS.md files

Written 2026-09-10 by the mid-build check-in pass. Sources read in full: prompts/SHARED_CONTRACT.md and the DECISIONS.md in storefront, account, billing, pricing, portal. This is the evidence file. The normative resolutions live in CONTRACT_ADDENDUM.md.

## 1. Conflicts

### 1.1 Quarterly flat-fee scaling (env fee) breaks Maple's total across surfaces
Storefront (Phase 2, #18) and Account (Phase 1, "Flat fees on multi-month charges") both decided a flat FeeRule like fee_env_1 scales by whole months in the charge's period, so a quarterly 96 gal cart carries env 300 (3 x 100). Pricing (#21) independently landed on the same rule. Correction (billing, 2026-09-10 evening): through Phase 3 billing applied the flat fee once, producing 10061, the same as Portal (#7). Billing has since applied addendum C5 and now produces 10261, matching Storefront, Account, and Pricing. That change raised every quarterly invoice in billing's seed; pay_card_011 now leaves 1200 cents open on inv_res_020_2026q3 so batch_0908 stays at exactly 131842 (billing DECISIONS.md entry 29).
Resolution: flat fee applies once per whole month in the charge's period. Billing's computeCharge encodes this. Portal's seed derivation is corrected to 10261 at its next phase.

### 1.2 Whether RateVersions carry zone rows, and how boundary pricing is expressed
Pricing (#2) made residential RateVersions zoned (zone_open and a higher zone_boundary row, 96 gal $29 vs $31) while frontload and rolloff RateVersions carry no zone.
Storefront (Phase 1, #11) did the opposite: zoned frontload rate plus zone-less "standard" residential versions so zone_boundary resolves through the no-zone fallback. Under Storefront's model boundary residential prices equal zone_open; under Pricing's model they are higher.
Resolution: prefer Pricing's approach. Boundary pricing is real and differentiated. The no-zone RateVersion is the fallback for genuinely unseeded zones, not the standard path for a named zone.

### 1.3 Event and exception charge amounts diverge
Account set extraBags 250, overload 1500, contamination 2500, dryRun 2500 as engine constants.
Billing (#1) built src/seed/eventRates.json with extraBags 250, overload 1000, contamination 2000, dryRun 2500.
Resolution: Billing's eventRates.json values are canonical. Account recomputes against them.

### 1.4 Non-net30 invoice due-date offset
Account: +30 days for net30, +10 otherwise. Billing (#7): +30 for net30, +15 for monthly and quarterly.
Resolution: Billing's +15.

### 1.5 Quarterly advance billing and cycle anchoring for new signups
Storefront (Phase 2, #20) bills a new signup's first period startDate to startDate + 3 months and expects the billing run to fold the storefront's approved first-cycle charges into the first Invoice, allocate the signup payment, and skip any ServiceItem already covered.
Billing (#3) and Pricing (#38) run generateRecurringCharges on fixed calendar cycle dates. Neither handles an item whose effectiveFrom falls mid-quarter.
Resolution: Billing's calendar-cycle model is canonical for steady state. The mid-cycle signup reconciliation is an explicit rule in the addendum and a named merge task. Nobody has implemented it yet.

### 1.6 Contract override term bounds
All five agree an override applies only when onDate is within termStart..termEnd. Billing (#20) and Pricing (#28) both flag the bakery escalator landing after termEnd as a renewal question for a person. Operational behavior on lapse is an open question.

### 1.7 Invoice numbering, invoice and quote ids, and seed totals
Account uses PD-2026-0401 style numbers; Billing INV-2026-0001; Pricing inv_res_maple_0001; Portal inv_maple_2026q3. The same named invoices exist under different ids, totals, and numbering in each seed. quote_held_ridge.dueTodayCents was seeded as three values: Storefront 12936, Account 5400, Pricing 11800.
Resolution: Billing's seed and INV-2026-#### numbering are canonical. Derived seed tables in other surfaces are regenerated against Billing's engine at merge, not reconciled by hand.

### 1.8 Runtime-created id collision risk
Storefront (#25) infixes session ids with _sf; Portal (#19) with _p; Billing (#21) uses a plain counter chg_0001 with no namespace guard; Account has no scheme.
Resolution: every runtime-created id carries a surface infix. Billing's counter starts above the highest seed id.

### 1.9 zone_franchise.franchiseFeePct
Storefront (Phase 1, #4): 17 (Jacksonville nonresidential figure). Account: 5.
Resolution: 17, since it is sourced.

### 1.10 Found by the check-in pass, not in any DECISIONS.md
- Pricing seeds fee_env_1 with base allLines; the other four use serviceLines. Contract says serviceLines. Pricing fixes at its next phase.
- Escalator anniversary is "01-01" in storefront, account, portal and "2027-01-01" in billing, pricing. Canonical: a full ISO date, "2027-01-01", because the contract says dates are ISO 8601 strings.
- TaxRule coverage: storefront, billing, pricing seed three zones; account seeds only zone_open; portal seeds two. Canonical: three (open, boundary, franchise), none for notserved.
- cat_res_extra_pickup exists only in portal (see 3).
- Five different engines, five different token files, three token naming schemes (--color-*, --*, --tl-*), and three palettes. See CONTRACT_ADDENDUM.md sections on engine and design.

## 2. Convergent decisions (now written into the addendum)
- Fixed demo clock TODAY = '2026-09-10', no new Date() in business logic. Five for five.
- Engine state as an explicit trailing parameter defaulting to the live store. Five for five.
- Contract overrides are term-bounded. Five for five.
- Half-up rounding via Math.round on cents, applied to tax. Four confirmed on the Maple example (651.63 to 652).
- Environmental fee is never taxed, late fees are never taxed.
- ruleWon inference: manualException for hand-set amounts, standardRate for catalog-formula lines (rolloff overage, extra days).
- Deterministic readable ids for engine-generated records, never random.

## 3. Surface-local extensions

Fine to keep local:
- Storefront: addresses.json and SeedAddress, quoteIntake and paymentTokens tables, src/store/ui.ts.
- Account: edits sidecar for audited manual charge changes; PaymentAllocation as an id-less array; WaivedCharge keyed by chargeId.
- Billing: eventRates.json (canonical), docs/paper-reference.md.
- Portal: HOLD_POLICY constants, holds table, mock paymentToken.ts, portal-local paymentMethods table.
- Pricing: design/<screen>.html Paper fallbacks, blast-radius selectors.

Leak into shared entities, need reconciliation:
- Portal's cat_res_extra_pickup catalog SKU vs Account's extraBags event exception. One definition of extra pickup is needed. Addendum resolves it.
- The exception-rate table exists as Account inline constants and Billing eventRates.json. Promote to one seed file.
- Invoice.deliveredVia typed as a union in billing, account, pricing but as string in storefront and portal. Union everywhere.
- zone_franchise.franchiseFeePct conflict (1.9).

## 4. Open questions for Kevin (answered 2026-09-10, recorded in CONTRACT_ADDENDUM.md section I)
1. Contract lapse vs escalator anniversary (bakery: termEnd 2026-12-31, anniversary 2027-01-01). Auto-renew, drop to standard rate, or alert only? Answer: auto-renew.
2. Who owns unapplied cash at merge: should pay_chk_oakridge and batch_0908 be seeded pre-allocated or left as a live demo action? Answer: seed them pre-allocated.
3. The storefront to billing first-invoice handoff (1.5) is described but not built or tested anywhere. It is a merge task unless you want billing to take it in Phase 4. Answer: billing owns it. Billing finished every phase before this answer landed, so it is a billing follow-up dispatch, not a merge task.
4. Are the contract's literal cent figures (batch_0908 gross 131842, fees 4120) exact targets seed generation must hit, or illustrative? Billing added two extra posted lines to hit them exactly. Answer: illustrative. Seeds need not hit them to the cent.
