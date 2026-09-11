# RUNBOOK.md: pricing surface

## How to start

From a clean checkout:

```
cd /Users/kevinquimbo/Projects/TrashLabWorkTrial/pricing
rm -rf node_modules      # only for a clean run
npm install
npm run dev -- --port 5180 --strictPort
```

Dev URL: http://localhost:5180/pricing. The port is fixed by shared/CONTRACT_ADDENDUM.md G; `--strictPort` makes a busy port fail loudly instead of drifting. Plain `npm run dev` also works and uses Vite's default 5173, which is storefront's port, so avoid it when other surfaces are running. `checkin/start.sh` (one level up) starts all six surfaces on their fixed ports.

Routes:
- `/` redirects to `/pricing`
- `/pricing` Ratebook (with the publish preview, version history drawer, and agent proposals drawer)
- `/pricing/quote` Quote workbench

State lives in memory (zustand, seeded from src/seed). A page reload resets everything to seed. Writing docs (any .md), dashboard.html, progress.json, scripts/, or context/ no longer reloads the page: vite.config.ts lists them in server.watch.ignored (box 7.10; DECISIONS 65, 99, 113), so ticking boxes and rebuilding the dashboard mid-walk is safe. Edits under src/ still hot-update or reload as usual.

## How to run checks

```
npm test            # vitest, 11 files, 108 tests
npm run build       # tsc -b then vite build
npx tsc --noEmit -p tsconfig.app.json
```

Test files: src/seed/seed.test.ts (seed integrity), src/store/engine.test.ts (precedence, fees, tax), src/store/invariants.test.ts (invariant 1), src/store/preview.test.ts (previewInvoice, blastRadius, store actions), src/store/publishFlow.test.ts (scenario a through the store), src/store/quoteFlow.test.ts (scenario b and the lapsed contract path), src/store/costToServe.test.ts, src/store/contracts.test.ts, src/store/agentProposals.test.ts, src/store/emptyStates.test.ts (no-change drafts, zero moved, resolve errors, agent confirm labels), src/lib/ratebook.test.ts.

## Scenario walkthroughs

Start each scenario from a fresh load of the URL (the store resets to seed). The three are independent; running them in one session also works, and the numbers below are what the Phase 7 run saw.

### (a) Publish a 4 percent residential increase

1. Open http://localhost:5180/pricing. The Residential tab is active. The header pill reads "15 published, 0 drafts".
2. Click "Increase all residential by 4%" at the right of the tab row. The popover shows Increase 4 and Effective from 2026-10-01 (first of next month).
3. Click "Create drafts". A toast reads "8 residential drafts created at +4%." The header pill reads "15 published, 8 drafts", the drafts tray reads "8 drafts pending", and every residential line shows a Draft pill with the new price beside the published one.
4. Click "Preview publish" in the drafts tray. The publish preview opens:
   - Header: "31 accounts move, 4 protected by contract, monthly revenue +$43.76 before fees and tax." Both sides priced as of 2026-10-01. Stats: Accounts move 31, Protected by contract 4 (1 contract ended), Monthly delta +$43.76.
   - Who changes: 31 accounts (the 30 generic residential accounts plus Maple Street Homeowner; Holt is held and Kerr suspended, so neither moves). Maple goes $50.00 to $52.00 a month; a 96 gal account goes $41.00 to $42.64.
   - Who does not change: Sunrise Bakery (acct_bakery, contract_bakery, "competitive match"), Riverside Dental Group (acct_fl_001, contract_fl_001), Copper Kettle Diner (acct_fl_002, contract_fl_002), and Northgate Auto Body (acct_fl_003, contract_fl_003), each with "no service in this draft's scope, contract still protects it". Pinecrest Veterinary Clinic (acct_fl_004, contract_fl_004) carries the warning pill "contract ended 2026-08-31, no longer protected".
   - What the invoice looks like: Maple Street Homeowner, quarterly, $180.74 before and $187.60 after (+$6.86 per quarter), each line naming its rule, for example "zone rate rv_res_96_open_weekly" before and "zone rate rv_res_96_open_weekly_20261001" after. Alvarez (acct_res_001) +$3.98 per quarter. Sunrise Bakery is labelled "Unchanged: contract override", $424.47 on both sides, each line "contract override contract_bakery".
   - Revenue delta: +$43.76 monthly, +$525.12 annualised, "service lines before fees and tax".
5. Click "Confirm and publish 8 versions". The modal closes, the toast reads "Published 8 versions. Old versions kept.", and the header pill reads "23 published, 0 drafts". Each residential line keeps its price in force today and shows "Scheduled $X from 2026-10-01" (96 gal Open market: $29.00, Scheduled $30.16).
6. Below the table the History proof card reads "Posted invoice unchanged by this publish": INV-1001, Maple Street Homeowner, $87.45, posted 2026-07-01, locked, with each charge still priced by the version it was billed with (the 96 gal charge by rv_res_96_open_weekly, published, $29.00 effective 2025-01-01).

### (b) Quote Sunrise Bakery 3 yd 2x at $198 against the $220 list

1. Open http://localhost:5180/pricing/quote.
2. In Service address type "88 Commerce Way" (or pick the suggestion). The account box reads "Sunrise Bakery, active, acct_bakery, site_bakery, zone_open, Contract on file: contract_bakery", and a callout reads "Pricing request quote_bakery_request" (commercialRequest, draft, from storefront, 1 x cat_fl_3yd, 2x weekly, $220.00).
3. Container: "3 yd frontload". Frequency: "2x weekly". Material stays Mixed trash (MSW).
4. Zone match reads Open market, tax 7%, franchise fee 0%, delivery $25.00, public pricing on. List price reads $198.00 "contract override", "from contract contract_bakery", with a second line "Ratebook $220.00, standard rate rv_fl_3yd_2x" and "Existing contract price $198.00 (competitive match)". Cost to serve: full cost $169.10, target price $198.94, target range $169.10 to $198.94, "Prices cover cost".
5. The quoted price defaults to $198.00 and the line reads "10% below ratebook, est. $264/yr" ((22000 - 19800) x 12 = 26400 cents), with "Measured against the ratebook, not the contract."
6. Reason: "Competitive match". The "Save will" list names both writes: price quote_bakery_request, and add a contract override on contract_bakery.
7. Click "Save quote". The confirmation card reads "Exception saved as a contract override": Contract contract_bakery, Catalog item 3 yd frontload cat_fl_3yd, Frequency 2x weekly, Price $198.00, pctBelowRateCard 10%, Reason competitive match, "contract_bakery now has 2 overrides for this item and frequency. The latest is the one billed; earlier rows are kept as history.", and the request priced at recurringCents 19800.

Notes for this scenario and the agent panel:
- Quoting acct_fl_004 below the ratebook opens a new contract, contract_acct_fl_004_20260910 (term 2026-09-10 to 2027-09-10), because contract_fl_004 ended 2026-08-31 and a lapsed contract is never written to (DECISIONS 80, 83, 84). The "Save will" list says so before Save. Covered by src/store/quoteFlow.test.ts; not walked in the Phase 7 browser run.
- Effective dates differ on purpose: the bulk increase and the New draft form default to 2026-10-01 (first of next month), while drafts created by approving agent proposals take effect 2026-11-01, the first of the month at least 30 days out, so customers get notice (DECISIONS 93). The agent confirm bar lists that date on every draft, for example "Draft cat_fl_3yd, all zones, 2x: $220.00 to $228.80 (+4%) from 2026-11-01".

### (c) Version history for cat_res_96 shows the old version intact

Run after (a) to see a publish in the chain; before (a) the drawer shows two versions.

1. On the Ratebook, Residential tab, find "96 gal cart", line "Open market, weekly". Click "History" at the end of the line (at 1440 wide the whole table fits with no sideways scroll; box 7.9).
2. The drawer "Version history, 96 gal cart, Open market, weekly, cat_res_96 / zone_open / weekly" lists 3 versions newest first:
   - rv_res_96_open_weekly_20261001: $30.16, published, effective 2026-10-01, published at 2026-09-10T09:00:00-04:00, Supersedes rv_res_96_open_weekly, Superseded by none.
   - rv_res_96_open_weekly: $29.00, published, current, effective 2025-01-01, published at 2024-12-10T09:00:00, Supersedes rv_res_96_open_weekly_2024, Superseded by rv_res_96_open_weekly_20261001. Its price, status, and effective date are what the seed shipped.
   - rv_res_96_open_weekly_2024: $27.00, published, effective 2024-01-01, Superseded by rv_res_96_open_weekly.
   Every published card carries a lock and "Published versions are never edited".

### Empty and error states (box 7.7)

- New draft at the same price: on any line click "New draft" and Create draft without changing the price. The form refuses with "No change: $31.00 is already the price of rv_res_96_boundary_weekly. A draft must change the price to be published." A no-change draft that arrives another way (bulk or agent rounding) is flagged in the drafts tray as "no change, cannot publish", left out of Preview publish, and skipped by publishRateVersions.
- Zero moved: New draft on "96 gal cart, Boundary, weekly" at $32.00, then Preview publish. The header reads "No accounts move. Publishing adds this version to the ratebook and changes no current customer's bill." and "monthly revenue unchanged"; the list says the same. Cancel leaves the draft in the tray.
- No published rate in the quote workbench: the list price card shows "No published rate for this item and frequency" with the engine's message instead of throwing. The frequency select only offers published frequencies, so the seed does not reach this state through the UI; src/store/emptyStates.test.ts proves the catch (cat_fl_3yd_wood weekly).
- Agent confirm labels (box 7.8): approving a residential row reads "Approve, create drafts only"; Northgate Auto Body alone reads "Approve, write escalator only"; "Approve all eligible" on Frontload reads "Approve, create drafts and escalators". After approving the escalator the header still reads the same published count and the row shows "Already scheduled".

## Invariants

The seven invariants from SHARED_CONTRACT.md, and where this surface stands on each.

| # | Invariant | This surface | Where |
|---|---|---|---|
| 1 | Publishing a RateVersion never changes a posted Invoice. | Enforced in code. | src/store/store.ts publishRateVersions replaces only the pending drafts it is given and returns every other RateVersion object by identity; it never touches invoices or charges. A draft with no change is left as a draft. Proven by src/store/invariants.test.ts (deep equality of inv_res_maple_0001 and its charges, same object for the superseded version) and src/store/publishFlow.test.ts; shown on screen by src/components/HistoryProof.tsx. |
| 2 | Every Charge carries base, fees, tax, source, and ruleWon. | Enforced in code for every charge this surface builds. | src/store/engine.ts computeCharge always returns baseCents, fees[], taxCents, totalCents, source, pricing (ruleWon defaults to manualException), status, evidenceIds; generateRecurringCharges passes source serviceItem and the resolvePrice rule. Tests: src/store/engine.test.ts; seed charges checked in src/seed/seed.test.ts. Posting charges is billing's. |
| 3 | A ServiceItem change creates a WorkOrder and appears in the next generateRecurringCharges run. | Left to the account and storefront surfaces. | Pricing never writes ServiceItems or WorkOrders (OWNERSHIP.md). The second half holds here by construction: generateRecurringCharges in src/store/engine.ts reads the live serviceItems table on every run. |
| 4 | Suspended accounts produce skippedSuspended events, never charges. | Half enforced: never charges. | src/store/engine.ts generateRecurringCharges skips any account not active or pastDue, so acct_res_kerr produces nothing; blastRadius, previewInvoice (src/store/preview.ts) and proposeIncreases (src/store/agentProposals.ts) inherit that. Test: engine.test.ts "skips suspended accounts". Writing skippedSuspended ServiceEvents belongs to check-in and dispatch; the seed carries them for Kerr. |
| 5 | WaivedCharge rows are never deleted. | Left to billing and account. | The store holds waivedCharges from seed and has no action that writes or deletes them. |
| 6 | Allocation is many-to-many; a batch splits into gross, fees, and per-invoice allocations. | Left to billing. | src/store/engine.ts allocate is a stub that throws "not implemented" (DECISIONS 31); billing's engine is canonical (addendum C1). The seed shows the shape (pay_chk_oakridge across three invoices, batch_0908 gross, fee, net). |
| 7 | Agents draft; rules authorize; a human approves anything that moves money or touches a relationship. | Enforced in code. | src/store/agentProposals.ts approveProposals only calls createDraftRateVersion and setContractEscalator and never publishRateVersions; src/components/AgentPanel.tsx routes every approval through a confirm bar that lists each write, and its button says what it writes. Publishing only happens from the Confirm button in src/components/PublishPreviewModal.tsx. Quote exceptions need a human Save with a required reason (src/pages/QuoteWorkbench.tsx). Tests: agentProposals.test.ts, emptyStates.test.ts. |

## Verified on 2026-09-10 (boxes 7.9 and 7.10)

Dev server `npm run dev -- --port 5180 --strictPort`, Browser pane at 1440 x 900, one session with no page reload.
- Box 7.9, before the change: the catalog table's scroll container on Residential measured scrollWidth 1018, clientWidth 974 (History behind a 44px sideways scroll).
- Box 7.9, after the change: scrollWidth 974, clientWidth 974 on Residential, Frontload, and Rolloff; every History button ends at x 995, inside the container's right edge at 1015; the page body is 1440 wide. Worst case, after scenario (a) published 8 residential versions: still 974 / 974, all 8 "Scheduled $X from 2026-10-01" pills inside their Price cells. Computed lanes: 78.7, 92, 125.9, 200, 84, 157.4, 148 px.
- Box 7.10: with the store at "23 published, 0 drafts" after scenario (a), `python3 scripts/build_dashboard.py CHECKLIST.md` rewrote dashboard.html and progress.json at 20:56:05, and edits to CHECKLIST.md, RUNBOOK.md, DESIGN.md, and DECISIONS.md followed. The page still read "23 published, 0 drafts" with the History proof card showing, performance.getEntriesByType('navigation') held only the original load, and the Vite log showed no reload (only hmr updates for src/components/CatalogTable.tsx).

## Verified on 2026-09-10 (Phase 7)

Clean run from this folder, port 5180 free:
- `rm -rf node_modules && npm install`: installed, 124 packages audited (npm audit reports 4 moderate advisories in dev dependencies; not addressed here).
- `npm test`: 11 files, 108 tests passed.
- `npm run build`: tsc -b clean, vite build 95 modules, no warnings.
- `npm run dev -- --port 5180 --strictPort`: "VITE v6.4.3 ready in 177 ms", Local http://localhost:5180/. Stopped after the walk.

Browser (Browser pane, 1440 x 900), in this order in one session:
- /pricing/quote rendered with the fear strip "This screen protects against: prices the truck cannot serve profitably, exceptions that hide from the ratebook". Scenario (b) as written above: list $198.00 from contract_bakery, Ratebook $220.00, full cost $169.10, target $198.94, "10% below ratebook, est. $264/yr", saved with pctBelowRateCard 10%, reason competitive match, quote_bakery_request at recurringCents 19800.
- /pricing rendered with the fear strip "This screen protects against: increases hitting contract accounts, fees on the wrong base, rate edits rewriting history". Scenario (a) as written above: 8 drafts, preview 31 move, 4 protected, fl_004 "contract ended 2026-08-31, no longer protected", +$43.76 a month and +$525.12 a year, Maple $180.74 to $187.60, bakery "Unchanged: contract override"; confirm gave "Published 8 versions. Old versions kept.", "23 published, 0 drafts", and the History proof at $87.45.
- Scenario (c) as written above: three versions, rv_res_96_open_weekly still $29.00, published, effective 2025-01-01, superseded by rv_res_96_open_weekly_20261001 at $30.16.
- Box 7.7: the same-price draft was refused with the "No change" message; a $32.00 boundary draft previewed with "No accounts move." and was cancelled, not published.
- Box 7.8: the three confirm labels appeared as listed; approving Northgate Auto Body's escalator left the header at "23 published, 1 draft" and turned the row into "Already scheduled".
- Console: no errors or warnings (only the Vite connect lines and the React DevTools notice).

## Verified on 2026-09-10 (Phase 1)

- `npx tsc --noEmit` on tsconfig.app.json and tsconfig.node.json: clean.
- `npm run build`: 64 modules, dist written, no warnings.
- `npm test`: 1 file, 3 tests passed (seed ids unique, references resolve, contract headline values).
- `npm run dev -- --port 5180 --strictPort`: ready in about 110 ms; curl of /pricing, /pricing/quote, and /src/main.tsx returned 200.
- Browser: /pricing and /pricing/quote render the top bar and the "Seed loaded" card reading "8 catalog items, 15 rate versions, 45 accounts"; `/` redirected to /pricing; console shows no errors or warnings.
