# PORT_DECISIONS.md: pricing port (CHECKLIST.md boxes 2B.1 to 2B.5)

Judgment calls made while porting pricing/src into the merged app, for the manager to merge into the root DECISIONS.md. Each entry names the call, the alternative, and the reason. Figures observed on billing's merged seed are recorded next to the prototype's under "Scenario figures".

Files written: src/surfaces/pricing/ (index.tsx, pages/, components/, components/quote/, lib/, __tests__/), src/store/slices/pricing.ts, src/styles/surfaces/pricing.css. Nothing else was edited.

## Decisions

### Store and engine

P1. **Drafts live in the pricing slice; publish appends them to db.rateVersions.** `pricingDrafts` holds pending RateVersions with status draft. `publishRateVersions` appends published copies (status published, publishedAt set, supersedesId kept) to db.rateVersions through mutateDb, and removes them from the slice. *Alternative:* keep drafts in db.rateVersions as the prototype did (it stored everything in one table and swapped status on publish). *Why:* box 2B.2 says drafts stay in the slice. It also means no other surface ever sees a draft, and publish only appends, so every existing RateVersion (the superseded one included) stays the same object with the same fields (invariant 1). The Ratebook reads a view, `withDrafts(db, drafts)`, so its selectors did not change.

P2. **A new contract override is written first in its contract.** `contractWithOverride` puts the new row at index 0; earlier rows for the same item stay after it as history. `overrideInForce` (and so the workbench and the confirmation) reads a contract the same way. *Alternative:* append the new row, as the prototype did, and ask for the canonical resolvePrice to take the last matching row. *Why:* the canonical resolvePrice (addendum C1, src/store/engine.ts) bills the FIRST override whose catalogId matches and whose frequency is absent or equal. Appending would make billing, account, and portal keep billing the old price after an owner saved a lower one. Writing newest first makes every surface bill the saved price today with no engine change, and keeps the prototype's "earlier rows are kept as history". The confirmation now reads "The newest, listed first, is the one billed". See request 2.

P3. **Runtime rate version ids carry the pricing infix: rv_pr_<cat>_<zone>_<freq>_<yyyymmdd>** (for example rv_pr_res_96_open_weekly_20261001), with _2, _3 when taken. *Alternative:* the prototype's rv_res_96_open_weekly_20261001. *Why:* addendum C12 (runtime ids carry a surface infix, like billing's rv_bl_ and storefront's _sf), and uniqueness is checked against both db and the slice. Contract ids keep addendum K3's exact form, contract_<accountId>_<yyyymmdd>.

P4. **Every date comes from the engine clock, src/store/clock.ts (addendum K2).** The prototype's dates.ts is now lib/dates.ts with only pure helpers; "today" is `today()`, read in components as `useStore(() => today())` like the persona bar. publishedAt is `<today>T09:MM:00-04:00` (TZ_OFFSET from clock.ts), one minute later per publish in a session (the prototype's publishedAtFor). *Alternative:* keep a TODAY constant. *Why:* billing's Next cycle moves the clock; pricing's effective-date defaults and "as of" labels now follow it, and a reset returns them to 2026-09-10.

P5. **Pricing's engine.ts is deleted; the generateEventCharges, postInvoices, and allocate stubs with it.** Everything calls src/store/engine.ts in its trailing-db form (addendum C2). lib/engine.ts keeps only what the canonical signatures do not cover: `resolveRate` (the canonical resolvePrice requires zoneId and accountId; the ratebook needs "no account" and standard lines need "no zone", so '' is passed, which matches no zone row and no contract, the canonical meaning of both), `pricingOf`, `FREQUENCY_LABEL` (built from the canonical frequencyLabel), and `withPreviewChargeIds`. `toEngineState` is gone: the Db is the engine state, and every helper takes a Db. *Alternative:* keep a wrapper engine. *Why:* C1; one engine means the preview, the ratebook, and the billing run can never disagree.

P6. **Previews use throwaway charge ids.** `withPreviewChargeIds` swaps in a `chg_pr_preview_N` generator around every preview and restores the canonical one (nested calls share one swap). *Alternative:* let previews use the default generator. *Why:* the canonical generator keeps a session counter, so every preview would have shifted the ids the next billing run hands out. A test proves the next id after three previews is still the next one.

P7. **previewInvoice prices the account's next billing date on or after the requested day** (`invoiceDateFor`, using the canonical isDue). *Alternative:* price exactly on the evaluated date, as the prototype's engine did (it billed every account on any date). *Why:* the canonical generateRecurringCharges bills a quarterly account only on quarter starts. For the runbook's 2026-10-01 drafts nothing changes; for an agent draft effective 2026-11-01 the representative Maple invoice shows its real next invoice, 2027-01-01, instead of an empty one. Each representative card now says "billed quarterly, invoice of <date>".

P8. **The history proof picks its invoice from what the publish superseded, and snapshots it.** At publish the slice finds the latest posted, locked invoice with a line priced by a superseded version, preferring the preview's representative accounts (Maple, acct_res_001, bakery), and records its totals in `pricingLastPublish.proof`. The card shows the live invoice beside "at publish $X" and says "unchanged" only when every total and rate version still match. *Alternative:* the prototype's fixed PROOF_INVOICE_ID 'inv_res_maple_0001'. *Why:* that id does not exist in billing's seed, and the brief forbids hard-coding an invoice id. The snapshot turns the proof into a comparison instead of a claim. The record lives in the slice, so it survives switching tabs.

P9. **Bulk increase replaces the lob's pending drafts in one write** (`replacePending: true`). *Alternative:* the prototype page discarded each draft and then created new ones (several writes). *Why:* one set, one render, and the agent-draft labels of replaced drafts are dropped with them.

P10. **saveQuote is not ported.** *Alternative:* keep it. *Why:* OWNERSHIP.md gives Quote creation to storefront; the prototype's workbench never called it (only a test did). The workbench prices the storefront's commercialRequest with priceCommercialRequest and never creates a Quote.

P11. **The K3 account repoint is recorded, not written.** A save that opens contract_<accountId>_<yyyymmdd> records `{ accountId, field: 'contractId', from, to, applied: false }` in `pricingAccountLinks`. *Alternative:* write BillingAccount.contractId from the pricing slice. *Why:* BillingAccount is account's to write (OWNERSHIP.md, addendum K4 and L), and box 3.6 routes pricing's linkAccountToContract to account's action. Nothing depends on the link meanwhile: the canonical resolvePrice finds a contract by Contract.accountId.

P12. **Slice keys are prefixed.** State: pricingDrafts, pricingAgentDraftIds, pricingPublishCount, pricingLastPublish, pricingAccountLinks. The prototype's discardDraft is discardDraftRateVersion and approveProposals is approvePricingProposals. The four actions the checklist names keep their names. *Alternative:* the prototype's names. *Why:* one flat store (root DECISIONS 6); generic names like discardDraft could collide with another port.

P13. **Agent proposals are computed, never stored; approval is a slice action.** `proposeIncreases` is pure over the db; `approvePricingProposals` only calls createDraftRateVersion and setContractEscalator. *Alternative:* store proposal rows. *Why:* they are a function of the db, so storing them would go stale on the next write. A test replaces publishRateVersions with a thrower and approves everything.

P14. **setZonePublicPricing refuses to make a not-served zone public**, and ignores a no-op. *Alternative:* rely on the disabled toggle, as the prototype did. *Why:* once the write is a store action, other surfaces can call it; the rule belongs with the write.

P15. **createDraftRateVersion and saveContractOverride validate their input** (known catalog, positive price, ISO date, known account). *Why:* the Phase 3 billing delegate will call them without the Ratebook's form checks.

### Screen

P16. **The prototype's header becomes a tab row of role="tab" buttons that navigate**, like billing's BillingTabs. The TrashLab brand is dropped and the row is not sticky. *Alternative:* keep two NavLinks. *Why:* the persona bar owns top navigation, is sticky, and already has Ratebook and Quote workbench links; a second pair of links with the same names broke src/shell/routes.test.tsx (getByRole('link', { name: 'Quote workbench' }) found two) and put two aria-current="page" on the page.

P17. **Pricing's overlays stack at z-40 (toast z-50)**, one step above the prototype's. *Alternative:* the prototype's z-20 and z-30. *Why:* the persona bar is sticky at z-30. At the old values the history drawer's header and the agent drawer slid under it. The walk checks that the publish preview and the drawer cover the persona bar.

P18. **Nothing on screen names a seed row that billing's seed does not have.** The address placeholder comes from the data (the first open commercial request's address, "880 Commerce St") instead of the prototype's "88 Commerce Way". The worked example's synthetic account and site exist only in the copy of the db handed to computeCharge.

### Style bridge (box 2B.4)

P19. **--tl-border is renamed --tl-border-color (addendum K5)** and --rt-color-line points at it. Pricing's other block 2 aliases (--tl-text, --tl-text-muted, --tl-accent-strong, --tl-success, --tl-warning, the --tl-text-* sizes, --tl-leading-body, and so on) are declared on .surface-pricing, not :root. Pricing's block 1 was shared/tokens.css copied unchanged, which src/styles/tokens.css already provides, so it is not repeated.

P20. **eyebrow and mono line heights are the inherited body line height, --tl-leading-body (1.5).** Neither size carried a line height in the prototype, so their text inherited the body's.

P21. **leading-tight and tracking-tight are set back to Tailwind's 1.25 and -0.025em inside the wrapper.** Pricing's tokens.css had no @theme block, so the prototype got Tailwind's defaults; src/styles/tokens.css's @theme changes both app wide (the Phase 1 hazard).

P22. **text-eyebrow's font size is restored with a scoped rule** (see request 1). The merged build turns text-eyebrow into a color only, so pricing's eyebrows, pills, and table headers rendered at 14px instead of 11px. pricing.css adds `.surface-pricing .text-eyebrow { font-size; line-height through --tw-leading }`, sets `--rt-color-eyebrow: currentColor` so the color half inherits (as in the prototype), and pins each color class pricing pairs with text-eyebrow (accent, accent-soft, muted, muted/60, ink, success, warning, danger). *Alternative:* rename the class in pricing's components. *Why:* the bridge exists so no className is renamed. Result: 223 of 225 computed style properties on 15 Ratebook elements now equal the running prototype's on 5180 (before the fix, 211). The two left are content, not style: "13 published" is narrower than "15 published", and the 64 gal line carries a Scheduled pill on billing's seed.

### Tests (box 2B.5)

P23. **The prototype's tests are ported to src/surfaces/pricing/__tests__ with billing's seed figures**, and no test hard-codes a rate version or invoice id: each is found by what it prices. seed.test.ts (the prototype's own seed) and engine.test.ts (the prototype's own engine) are not ported; the canonical engine has its tests, and engineRules.test.ts pins what pricing relies on from it. Added: slice.test.ts (the slice contract) and surface.test.tsx (the three runbook scenarios through the real screens in jsdom, failing on any console error or warning).

## Scenario figures: prototype (pricing/RUNBOOK.md) against merged (billing's seed)

Walked headless on 5202 at 1440 x 900 (scratchpad pricing-walk.mjs, 71 of 71 checks, no console errors) and asserted in __tests__/publishFlow.test.ts, quoteFlow.test.ts, and surface.test.tsx.

### (a) 4 percent residential increase

| Step | Prototype | Merged |
|---|---|---|
| Header pill before | 15 published, 0 drafts | 13 published, 0 drafts |
| Bulk toast | 8 residential drafts created at +4% | same, 8 drafts |
| Draft for 96 gal Open market | rv_res_96_open_weekly_20261001, $30.16, supersedes rv_res_96_open_weekly | rv_pr_res_96_open_weekly_20261001, $30.16, supersedes rv_res_96_2026 |
| 64 gal Open market | $26.00 to $27.04 | the seed already publishes $27.00 from 2026-10-01 (rv_res_64_2026q4, shown as "Scheduled $27.00 from 2026-10-01" before any draft); the bulk draft supersedes that one, $27.00 to $28.08 |
| Accounts move | 31 | 31 |
| Protected by contract | 4 (1 contract ended: Pinecrest, contract_fl_004, 2026-08-31) | 5, none ended (contract_bakery, contract_fl_002, contract_fl_004, contract_fl_006, contract_fl_008 all run 2026-01-01 to 2026-12-31), each "no service in this draft's scope, contract still protects it" |
| Monthly delta | +$43.76 | +$40.04 |
| Annualised | +$525.12 | +$480.48 |
| Maple a month | $50.00 to $52.00 | $50.00 to $52.00 (Ruth Maple) |
| A 96 gal account | $41.00 to $42.64 | $41.00 to $42.64 (acct_res_004 and five others) |
| Maple quarterly invoice | $180.74 to $187.60, +$6.86 a quarter | $180.74 to $187.60, +$6.86 a quarter |
| Maple line rule | zone rate rv_res_96_open_weekly, then rv_res_96_open_weekly_20261001 | zone rate rv_res_96_2026, then rv_pr_res_96_open_weekly_20261001 |
| acct_res_001 | Alvarez, +$3.98 a quarter | Alicia Brandt, billed monthly, $34.20 to $35.53, +$1.33 a month |
| Sunrise Bakery | Unchanged: contract override, $424.47 | Unchanged: contract override, $424.47 |
| Header pill after | 23 published, 0 drafts | 21 published, 0 drafts |
| 96 gal Open market after | $29.00, Scheduled $30.16 from 2026-10-01 | $29.00, Scheduled $30.16 from 2026-10-01 |
| History proof | INV-1001, Maple Street Homeowner, $87.45, posted 2026-07-01 | INV-2026-0203, Ruth Maple, $180.74 (at publish $180.74), posted 2026-07-01, locked, lines priced by rv_res_96_2026, rv_res_extra_2026, rv_res_recycling_2026 |
| Every invoice and charge | unchanged | unchanged (deep equal before and after, all three lobs) |

### (b) Sunrise Bakery 3 yd 2x at $198 against the $220 list

| Step | Prototype | Merged |
|---|---|---|
| Address typed | 88 Commerce Way | 880 Commerce St |
| Account box | Sunrise Bakery, active, acct_bakery, site_bakery, zone_open, Contract on file: contract_bakery | same |
| Request callout | quote_bakery_request, 1 x cat_fl_3yd, 2x weekly, $220.00 | quote_bakery_request, commercialRequest, draft, from storefront, 1 x cat_fl_3yd, 3x weekly, $0.00 |
| Frequency | 2x weekly (chosen) | 2x weekly: the request asks for 3x, but only 2x is published for cat_fl_3yd, so the select offers and shows 2x |
| List price | $198.00 contract override, from contract contract_bakery | same |
| Ratebook line | $220.00, standard rate rv_fl_3yd_2x | $220.00, zone rate rv_fl_3yd_2026 (billing's seed zones the frontload rows) |
| Existing contract price | $198.00 (competitive match) | same |
| Cost to serve | full $169.10, target $198.94, range $169.10 to $198.94, Prices cover cost | same |
| Exception line | 10% below ratebook, est. $264/yr | same |
| Save writes | price quote_bakery_request; add an override on contract_bakery | same; the request's 3x line is replaced by 2x at $198.00, recurringCents 19800 |
| Confirmation | contract_bakery, 3 yd frontload, 2x weekly, $198.00, 10%, competitive match; "now has 2 overrides" | same; the newest is listed first |
| Lapsed-contract path | acct_fl_004 opens contract_acct_fl_004_20260910 (contract_fl_004 ended 2026-08-31) | billing's contract_fl_004 runs to 2026-12-31, so the seed has no lapsed contract; the K3 path is proven in quoteFlow.test.ts and slice.test.ts on a fixture that ends contract_fl_004 on 2026-08-31 |

### (c) Version history for cat_res_96, Open market, weekly

| | Prototype | Merged |
|---|---|---|
| Before (a) | 2 versions | 1 version (billing's seed has no 2024 version) |
| After (a) | 3 versions | 2 versions: rv_pr_res_96_open_weekly_20261001, $30.16, published, effective 2026-10-01, published at 2026-09-10T09:00:00-04:00, supersedes rv_res_96_2026; then rv_res_96_2026, $29.00, published, current, effective 2026-01-01, published at 2025-12-15T09:00:00-05:00, superseded by the new one, the same object with the same fields |

### Other figures

| | Prototype | Merged |
|---|---|---|
| "No change" message on 96 gal Boundary | $31.00, rv_res_96_boundary_weekly | $29.00, rv_res_96_2026_boundary |
| Zero moved | a $32.00 Boundary draft moves nobody | the same: no site is in zone_boundary |
| Approve all eligible agent proposals | 7 drafts covering 39 accounts, 1 escalator | 6 drafts covering 38 accounts, 4 escalators (contract_fl_002, 004, 006, 008 have no escalator and sit at 19.1% margin, so each gets a 6% escalator from 2027-01-01) |
| Approve acct_res_001 alone | 1 draft covering 29 accounts | 1 draft covering 25 accounts |
| Agent draft effective date | 2026-11-01 | 2026-11-01 |
| Worked example, $29.00 line in zone_open | $34.20 | $34.20 |
| Catalog at 1440 | scrollWidth 974, clientWidth 974 | 974, 974 (also after the publish) |

## Requests from pricing port

1. **theme.css: the class text-eyebrow cannot be both a color and a font size.** The bridge declares --color-eyebrow (account) and --text-eyebrow (pricing, storefront). Tailwind 4 emits only `.text-eyebrow { color: var(--rt-color-eyebrow) }`, so in the merged build text-eyebrow never sets a font size, for any surface. Pricing works around it inside .surface-pricing (P22). Storefront's port uses text-eyebrow as a size too and will hit the same thing; the pattern in src/styles/surfaces/pricing.css (the last block) carries over. A bridge-level fix needs one meaning per class name, which means renaming a class in one surface; that is the manager's call.

2. **Pin the canonical override order.** Pricing writes a new override first because the canonical resolvePrice bills the first matching override (P2). Please add a test in src/store/engine.test.ts that the first matching override on a contract wins, so the rule cannot drift. If the canonical rule ever becomes "last wins", `contractWithOverride` in src/surfaces/pricing/lib/contracts.ts must write last instead.

3. **Addendum I1 (auto-renew a lapsed contract on read) is not in the canonical resolvePrice**, which only considers contracts whose term contains the date. Pricing's write side follows K3 on its own and needs no change; the read side is a billing follow-up. Billing's seed has no lapsed contract, so nothing on screen shows the gap today.

4. **Phase 3 box 3.6 hand-offs (no action needed now):**
   - billing's publishRateVersionStub should delegate to pricing: `const draft = get().createDraftRateVersion({ catalogId, zoneId, frequency, priceCents, effectiveFrom, supersedesId })` then `get().publishRateVersions({ draftIds: [draft.id], publishedAt: stamp() })`. The stub's own supersedesId search (latest published version for the line on or before effectiveFrom) can stay in billing or move beside it.
   - pricing's `pricingAccountLinks` lists the BillingAccount.contractId repoints that account's action should apply.
