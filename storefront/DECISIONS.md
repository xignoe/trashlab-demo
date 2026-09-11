# DECISIONS.md: TrashLab Storefront

Every judgment call, with the why. Newest phase at the bottom.

## Phase 1

1. **addresses.json is a storefront-only seed file.** The contract has no address lookup entity, and the brief needs six typeable addresses that each land on a branch. `src/seed/addresses.json` (id, label, line1, city, state, zip, zoneId, routeId?, franchiseHolder?, boundaryReason?) stands in for geocoding and polygon matching. Its type `SeedAddress` lives in `src/seed/index.ts`, not in `src/types.ts`, which stays verbatim. Other surfaces can ignore the file; nothing in the contract references it.

2. **Fixed TODAY clock.** `src/store/clock.ts` exports `TODAY = '2026-09-10'` (a Thursday). Every "next pickup", deadline, and "delivered 34 days ago" in seed and UI is computed from this constant so the runbook scenarios give the same answer on any day. Timestamps in the seed use Eastern daylight time (`-04:00`) because the hauler is an open-market Southeast city; the held quote deadline "tomorrow 10am local" is `2026-09-11T10:00:00-04:00`.

3. **Tax rule line types.** One TaxRule per taxed zone (zone_open, zone_boundary, zone_franchise) at 7% with `appliesTo: ['recurring', 'event', 'fee']`. `fee` is included so the one-time cart delivery fee is taxed like the service it accompanies; `lateFee` is never listed, matching the contract's "late fees are never taxed". zone_notserved has no TaxRule because nothing is ever charged there.

4. **Franchise holder in the zone name.** `zone_franchise` is named "Ashford city franchise (Southeast Sanitation)" so the franchise stop screen and the agent transcript can name the holder from the Zone record alone; the same name sits on the seed address as `franchiseHolder` for the storefront copy. The franchise zone carries `franchiseFeePct: 17` (the Jacksonville nonresidential figure from the research brief) so a later pricing surface has a realistic number; the storefront never prices this zone.

5. **Untyped contract fields.** SHARED_CONTRACT.md lists many fields without a type (`id; name; address; grossLbs`). `src/types.ts` reads them as: ids, names, addresses, numbers, facilities, materials, drivers, `by`, and `deliveredVia` are `string`; anything ending in `Cents`, `Pct`, `Lbs`, `Tons`, `Days`, `Day`, `Stops`, `qty`, `value` is `number`; dates are ISO strings. Fields with listed union literals keep them exactly. Nothing was added, renamed, or removed.

6. **All seed files come from one script.** `scripts/gen_seed.mjs` writes every file in `src/seed/`, not only the generated accounts, so the exact IDs, the route stop lists, and the invoice arithmetic are produced in one place and `scripts/validate_seed.mjs` proves the references. Edit the script, never the JSON.

7. **Maple's past due $87.45 is a carried-forward balance.** Under this rate card a 96 gal quarter is $102.61 all in, so $87.45 cannot be a computed total. The seed records it as one posted Charge with `baseCents: 8745`, no fees, no tax, `source.type: 'manual'`, and `ruleWon: 'manualException'` on invoice `inv_maple_2026q3` (due 2026-07-01, still unpaid, account status `pastDue`). Invariant 2 holds (base, fees, tax, source, ruleWon all present) and the number matches the contract.

8. **Oakridge is billed in arrears, one consolidated invoice per month.** net30 with `billedInAdvance: false`, four sites each with a PO number, one Charge per site per month (base 2900, fuel 203, environmental 100, tax 217 on base plus fuel = 3420), so each invoice is 13680 and `pay_chk_oakridge` is 41040 allocated across the three invoices (June, July, August 2026). That is the "one invoice" per cycle the contract describes, and the three-invoice check it names.

9. **batch_0908 payments are unallocated on purpose.** The 14 card payments sum to exactly 131842 (twelve full 96 gal quarters at 10261 and two partial payments of 4355) with 4120 in processor fees; they sit on acct_res_001..014 with `processorBatchId` set and no PaymentAllocation rows, because the contract names no invoices for the generic accounts and a lump deposit waiting to be reconciled is the account-tracker scenario. Allocations exist only for the named Oakridge check and the prepaid roll off.

10. **Roll off haul is an `event` line with fuel.** `chg_ro_homeowner_haul` is base 57500, fuel 7% (4025), tax 7% on base plus fuel (4307), total 65832, prepaid by card on 2026-08-05 and delivered 2026-08-07 (34 days before TODAY). The environmental fee applies to recurring lines only, so it is not on the haul.

11. **Rate versions beyond the contract's list.** Added `rv_fl_2yd_open_weekly` ($95/mo) so the generic frontload accounts that use a 2 yd container can resolve, and zone-less "standard" versions for the four residential items (same prices as zone_open) so zone_boundary resolves through the second precedence rule. All effectiveFrom 2026-01-01, published 2025-12-15.

12. **quote_bakery_request lines.** A commercialRequest Quote still needs `lines`; the bakery's request is one 2 yd container weekly with `priceCents: 0` (no price is ever shown for commercial requests), expiresAt 30 days after TODAY-ish (2026-10-09).

13. **quote_held_ridge numbers come from the Phase 2 expected values.** dueTodayCents 12936 (quarter 10261 plus delivery 2500 plus 175 tax on delivery) and recurringCents 10261 so the seed already matches what buildOffer will compute; created 2026-09-08 10:00, holdDeadline 72 hours later, expiresAt 7 days after creation.

14. **Paper quota.** The Paper file was created (fileId in DESIGN.md) but the weekly MCP limit was reached before fonts or tokens could be written. The token set was written to `src/styles/tokens.css` and DESIGN.md as the single source; the next phase that touches Paper should push the same values with create_tokens and confirm with get_tokens before drawing artboards.

15. **Tailwind v3, not v4.** v3's `tailwind.config.cjs` theme accepts `var(--token)` strings for colors, radii, fonts and spacing, so components use `bg-accent`, `text-ink-muted`, `rounded-lg` and never a hex literal. Opacity modifiers (`bg-accent/50`) are not available with this setup and are not needed.

16. **Container serials and driver names are invented.** Serials use PD-C (carts), PD-F (front load), PD-R (roll off) prefixes; drivers M. Ortega (residential), T. Boudreaux (front load), R. Vance (roll off); facility "Piedmont Regional Landfill". They exist only so field records read as real.

## Phase 2

17. **The engine is pure; state is an argument.** Every function in `src/store/engine.ts` keeps the contract's first argument verbatim and takes an optional second `state` argument (defaulting to the store snapshot) so tests and hypothetical pricing can hand it any tables. Nothing in engine.ts writes to the store. The billing-side functions (generateRecurringCharges, generateEventCharges, postInvoices, allocate) keep their signatures and throw `not implemented in storefront`.

18. **"$1/mo" environmental fee scales by whole months in the period.** `fee_env_1` is flat 100 cents. computeCharge multiplies a flat fee on a recurring line by `wholeMonthsBetween(period.start, period.end)` (minimum 1, default 1 when no period is given), so a quarter carries 300 and a monthly line carries 100. Percent fees never scale; they are already proportional to the base.

19. **Cart delivery is a `fee` line Charge priced by the zone.** Base is `zone.deliveryFeeCents` (2500), no FeeRule applies (fuel covers recurring and event, environmental covers recurring), and the zone TaxRule's `fee` line type taxes it: 175, total 2675. `pricing.ruleWon` is `zoneRate` with no rateVersionId because the Zone record, not a RateVersion, set the number; `source` is the primary cart's ServiceItem because the delivery exists for that cart. Due today for a single 96 gal cart is therefore 10261 + 2675 = 12936, matching quote_held_ridge.

20. **First-cycle Charges are written by the storefront as `approved`, never posted.** Signup writes the quarter's recurring Charges plus the delivery Charge with status approved, source the new ServiceItem, and a settled card Payment for the same total; no Invoice or PaymentAllocation is created. The billing run should (a) post those approved charge ids into the account's first Invoice, (b) allocate the settled Payment to it, and (c) skip any ServiceItem whose period is already covered by an existing serviceItem-sourced Charge, so the first quarter is never billed twice. Because proration is `none`, the first period runs startDate to startDate plus 3 months, not a calendar quarter.

21. **One deliver WorkOrder per ServiceItem.** Each selected line (cart, extra cart, recycling) is its own ServiceItem with `containerIds: []` and its own `deliver` WorkOrder scheduled for `dayBefore(startDate)`, status scheduled, no containerId (dispatch assigns the physical cart). Three lines mean three work orders; the driver can still complete them in one stop.

22. **`quoteIntake` and `paymentTokens` are storefront-only tables.** The contract's Quote has no contact, notes, photo, start date, material, or approver, and no token entity exists, so the store carries `quoteIntake` (keyed by quoteId) and `paymentTokens` (brand, last4, expiry, never a PAN). Seed rows for `quote_held_ridge` (token `tok_ridge_4242`, contact Priya Ridgeway, delivery notes, startDate 2026-09-15) and `quote_bakery_request` live inline in `src/store/store.ts`, not in `src/seed/`, because the Phase 1 seed is closed and other surfaces must not depend on them.

23. **Offers price against a provisional account and site.** buildOffer overlays `acct_offer` and `site_offer` (the matched zone and route, taxExempt false) on the state so resolvePrice and computeCharge run exactly as they will for the real account before any record exists. Offer charge ids and sources are placeholders (`chg_offer_<catalogId>`, source `offer:<catalogId>`); signup replaces id, accountId, siteId, and source with the real ids and keeps every cent.

24. **A fixed NOW beside TODAY.** `NOW = 2026-09-10T10:00:00-04:00` stamps receivedAt and createdAt, and drives held deadlines (NOW + 72h = Sun Sep 13 at 10:00 AM), held expiry (NOW + 7 days), and commercial expiry (NOW + 30 days). Transcript messages are stamped one minute apart from NOW.

25. **`nextId` is a module counter that survives `reset()`.** Ids look like `party_sf_0004`: the `sf` segment marks records created in this session so they can never collide with seed ids and the Phase 6 inspector can filter on them. The counter is the only side effect outside setState; a declined authorization spends one id, which is harmless.

26. **resolvePrice readings the contract leaves open.** A contract override counts only while the contract is in term on onDate, and is found by `contract.accountId` (not `account.contractId`) so the generic front load accounts resolve too. An override or RateVersion with no frequency matches any frequency. Ties on effectiveFrom go to the latest publishedAt.

27. **computeCharge accepts optional `id`, `description`, and `pricing`.** These sit beyond the contract's argument list and each has a default: a deterministic id from source and date, a description from the catalog name and period, and `ruleWon: manualException` when no pricing is supplied (a base handed in without a rate reference is by definition a manual number). A percent fee whose base is `allLines` compounds on the fees computed before it; no seed rule uses that.

28. **Monthly equivalent is the all-in quarter divided by three.** `recurringMonthlyEquivalentCents = roundHalfUp(recurringQuarterlyCents / 3)` (3420 for a single cart), not the 2900 base, because the buyer wants what they will actually pay per month; each line still exposes its own monthly base price.

29. **Approving a held quote honours the promised price.** Lines are re-resolved on the (possibly moved) start date for the rate reference; if the rate card moved, the preserved price wins and the line is marked `manualException`. The token is charged for the quote's own dueTodayCents. A preserved start date on or before TODAY moves to the next route day because the cart cannot arrive the day before. Autopay defaults to false because the boundary intake has no consent checkbox. The decline reason, approver, and review time live on the intake row since the Quote has no field for them.

30. **Signup takes `tokenId` beside `consent: { autopay }`.** The checklist's argument list names no token, but a card must be charged, so the token id is an explicit argument. A declined card throws `CardDeclinedError` before the single setState and nothing is written. The Site's address is `line1, city, state zip` (matching the seed sites), the payer party is also the occupant, and boundary delivery notes become `Site.accessNotes`.

31. **matchAddress and the business toggle.** An address matches by id, by case-insensitive substring of line1, or when the typed full address contains line1; `searchAddresses` returns every match for the typeahead. Unknown text lands on zone_notserved with no address. In the transcript the "for a business" toggle wins over the zone (any address goes commercial), matching Phase 4's "enter any address". The franchise holder comes from the address, else the parenthetical in the zone name.

32. **The commercial transcript ends with a handoff card that carries the reason.** Phase 2 wants the branch to end with the one-sentence reason and Phase 5 wants it to end with a handoff card, so the last message is a handoff whose text is the reason sentence plus the reply-by day (next business day after TODAY). The reason sentence is one constant, `COMMERCIAL_NO_PRICE_REASON`, shared with the Phase 4 screen.

## Phase 3

33. **A second zustand store for UI state.** `src/store/ui.ts` holds `screen`, the typed query, the picked address id, the business toggle, the configurator selections, contact, autopay, the completed signup, and the agent drawer flag. It is separate from the data tables in `store.ts` so the Phase 2 transactions never see UI state and `reset()` never moves the buyer. Routing is the single `screen` union; no router library, no URL state. The Phase 4 screens (`franchise`, `boundary`, `commercial`, `office`) already exist as values and render an honest placeholder with a way back and no price, so every seed address lands somewhere sensible today.

34. **Variant addresses preselect through an id map.** `ADDRESS_PRESETS` in `ui.ts` maps `addr_open_second_cart` to `extraCart: true` and `addr_open_recycling` to `recycling: true`. The seed file has no field for "what this address is for" beyond its label, and matching on label text would be fragile, so the map is keyed by the stable seed ids. The buyer can still change either toggle.

35. **Business toggle wins over the zone.** `screenForBranch` sends any match to the commercial screen when "For a business" is on, including an unknown address, matching decision 31 and the Phase 4 wording "enter any address".

36. **Menu prices come from resolvePrice, not the offer.** The offer only prices the selected lines, but the configurator shows a price beside every option (both cart sizes, extra cart, recycling). `menuPrices` in `src/ui/hooks.ts` calls resolvePrice for each catalog id on the offer's start date against the same provisional account and site that buildOffer uses, so the number next to an unselected option is the number the panel will show once it is selected.

37. **Fee rows are labelled from the FeeRule and summed from the charges.** The price panel does not hard-code "Fuel 7%" or "$1/mo"; it renders `rule.name` plus `rule.value` for every id in `offer.rules.feeRuleIds` and sums `charge.fees[].cents` per rule across the first-cycle charges (`feeTotals`). The tax row uses the zone's `taxRatePct`. Base and delivery come from `feeBreakdown`. If a rule is added to the seed the panel grows a row without a code change.

38. **The card widget accepts brand, last 4, and expiry only.** There is no card number field in the DOM, no PAN validation, and nothing to paste a number into; the last-4 input strips non-digits and caps at four. `tokenizeCard` writes a `paymentTokens` row before signup runs, so a declined card (last 4 ending in 0002) leaves one token row behind and nothing else: no Party, BillingAccount, Site, ServiceItem, WorkOrder, Charge, or Payment, because `completeInstantSignup` throws before its single setState. The decline message says the card, that nothing was charged, and that no account was created.

39. **Autopay defaults to checked.** The persona's flow has the buyer "complete hosted payment and autopay consent" as one step; the checkbox is on by default and the copy says it can be turned off any time. The success screen reads the flag back to say how the next quarter is charged.

40. **Desktop is two columns; 390px is one.** The Paper artboards show the configurator or form on the left and the panel on the right at 1440px. In code the same groups sit in a CSS grid (`md:grid-cols-[minmax(0,1fr)_440px]`) that collapses to one column below 768px in DOM order: configurator, price panel, continue button. Widths use Tailwind arbitrary values (`max-w-[1120px]`, `md:pt-[120px]`) because the token set has no container or breakpoint scale; colors, radii, and type never do.

41. **"Start over" clears the form, not the store.** The success screen's Start over resets the ui store only, so the account and work order just created stay in the data store for the Phase 6 inspector and the runbook scenarios. "Reset to seed" is the inspector's job.

42. **The Agent view and Office controls are wired to placeholders.** "Agent view" toggles `agentOpen` and renders a right-side panel with the Phase 5 title and a Close button (Escape also closes); "Office" routes to the `office` placeholder screen. Phase 5 and Phase 4 replace the bodies without touching the top bar.

## Addendum check-in (2026-09-10)

shared/CONTRACT_ADDENDUM.md now governs where it disagrees with the entries above. Earlier entries stay as written; these notes record which addendum item replaces them.

43. **Entry 5 (deliveredVia read as string) is overridden by addendum B2.** src/types.ts becomes a byte-identical copy of shared/types.ts, where Invoice.deliveredVia is 'email' | 'mail' | 'portal'. The "never edit types.ts" rule now means "never diverge from shared/types.ts".

44. **The escalator anniversary "01-01" in scripts/gen_seed.mjs is overridden by addendum B1.** contract_bakery.escalator.anniversary becomes "2027-01-01", a full ISO date.

45. **Entry 11 (zone-less standard residential rates so zone_boundary resolves) is overridden by addendum C4.** Residential RateVersions follow pricing's scheme: every row carries a zoneId, and zone_boundary has its own higher prices (96 gal 3100, 64 gal 2800, extra cart 1000, recycling 1300). The no-zone fallback stays in resolvePrice for zones with no seeded row.

46. **Entry 13 (quote_held_ridge at 12936 due today and 10261 recurring) is overridden by addenda C4 and D6.** With boundary pricing the seeded quote carries 13623 due today and 10948 recurring. D6 makes the storefront the source of this number for every other surface.

47. **Entry 14 and the Phase 3 Paper work are now governed by addendum F3.** Only the manager session calls the Paper MCP. Remaining Paper boxes are marked "Paper: manager" and no subagent is dispatched to Paper.

48. **The dev server port note in vite.config.ts (strictPort off, PORT honored) is overridden by addendum G.** The storefront runs on 5173 with --strictPort so a busy port fails loudly.

49. **Token adoption waits for polish per addendum F2.** src/styles/tokens.css stays the working set until Phase 6, when the storefront variables become aliases of the --tl- values in shared/tokens.css.


## Phase 4

50. **Addendum B2 applied.** src/types.ts is now a byte-identical copy of ../shared/types.ts, header included (`diff ../shared/types.ts src/types.ts` prints nothing), so Invoice.deliveredVia is 'email' | 'mail' | 'portal'. Entry 5 is retired.

51. **Addendum B1 applied, and the validator enforces it.** gen_seed.mjs writes contract_bakery.escalator.anniversary as "2027-01-01". validate_seed.mjs rejects any escalator anniversary that is not a real YYYY-MM-DD calendar date ("01-01" and "2027-02-30" both fail). The validator takes an optional seed directory argument so the failure can be proven on a mutated copy without touching src/seed.

52. **Addendum C4 applied: residential rate rows copied from pricing verbatim.** Nine residential RateVersions with pricing's ids, zoneIds, frequencies, priceCents, effectiveFrom (2024-01-01 and 2025-01-01), publishedAt, and supersedesId (rv_res_96_open_weekly supersedes rv_res_96_open_weekly_2024 at 2700). The four zone-less residential rows are gone. Frontload and rolloff rows are unchanged (effectiveFrom 2026-01-01). pricing's publishedAt values carry no UTC offset ("2024-12-10T09:00:00"); C4 says copy them exactly, so they are copied as written even though addendum E1 asks for -04:00 on new timestamps (see Requests for shared/). The validator now also rejects a residential RateVersion with no zoneId. The engine's no-zone fallback is still implemented and is proven with a fixture row inside engine.test.ts, on zone_franchise, which has no residential rows.

53. **Addendum D6: quote_held_ridge is what buildOffer computes.** One 96 gal weekly cart in zone_boundary: priceCents 3100, recurringCents 10948 (base 9300, fuel 651, environmental 300, tax 697), dueTodayCents 13623 (plus delivery 2500 and 175 tax). gen_seed.mjs is plain Node and cannot import the TypeScript engine, so the three numbers are written as literals with a comment, and held.test.ts pins them to buildOffer's output so the seed can never drift from the engine. Entries 13 and 46 are fulfilled.

54. **Addendum G applied: port 5173, strictPort.** The dev script is `vite --port 5173 --strictPort` and vite.config.ts sets port 5173 with strictPort true; PORT is no longer read. Proven: with one dev server on 5173 a second `npm run dev` exits 1 with "Port 5173 is already in use".

55. **The boundary offer is the open-zone offer screen, marked provisional.** Same configurator, same price panel, same resolvePrice and computeCharge path. Differences: a "Provisional price" pill (header and panel), the headline "We can probably serve <line1>. Pickup would be every <Day>.", the hold sentence built from `holdReasonFor(address)` and `HOLD_HOURS`, and the continue button going to the boundary intake. The panel's "Due today" label reads "Due when approved" on a provisional offer because nothing is charged today; the number is unchanged.

56. **Boundary intake fields.** Mobile is required on this path because the promise is "we will text you". There is no autopay checkbox (the checklist lists the fields), so approval creates the account with autopay false (entry 29). The driveway photo is a file input whose change handler keeps `file.name` only; the file is never read. The card widget is the checkout widget with the label "Your card is saved, not charged"; tokenizeCard stores brand, last 4, and expiry, and nothing is charged until approval.

57. **Status by quote id through the URL hash, not a router.** `#status/<quoteId>` opens the status screen and `#office` opens the office; the ui store's `screen` stays the single source and a small listener (src/ui/hashRoute.ts) keeps the hash in step with replaceState. The status screen prints the full link to save. The store is in memory, so a link to a quote created this session works until a reload; `#status/quote_held_ridge` always works because it is seed.

58. **Deadline format.** The status line is "We will text you by Sun Sep 13 10:00 AM" (`formatDayTime`, exactly Day Mon D h:mm a), with the buyer's mobile appended when known. The agent transcript keeps `formatDateTime` ("Sun Sep 13 at 10:00 AM") because Phase 2 tests assert that string.

59. **Office approval mechanics.** The office has no sign-in, so approvals are stamped `reviewedBy: "office"` (OFFICE_APPROVER). The approval result is kept in the ui store by quote id so the created ids (account, party, site, service items, work orders, payment, approved charges) stay visible inline after a re-render. A saved card that declines at approval (last 4 ending 0002) shows "The saved card ... was declined. Nothing was charged and the quote stays held." Decline requires a one-line reason (max 140 characters) and the row then reads "Declined, card was not charged."

60. **Office columns for commercial rows.** Due today shows "Priced by a person" instead of $0.00, and the deadline column shows "Reply by <next business day after the request>" computed from the intake's createdAt, because the Quote has no reply-by field. Hold reason reads "None".

61. **Commercial request shape.** Container size maps to cat_fl_2yd or cat_fl_3yd only; the material lives on the intake row and is not mapped to cat_fl_3yd_wood, because choosing the SKU is part of pricing a commercialRequest, which pricing owns (OWNERSHIP.md). The address is prefilled from the match and stays editable; an unmatched address is still accepted (on zone_notserved) with a hint that a person will confirm service. Mobile is optional here.

62. **Franchise steps avoid invented specifics.** No phone number or office address is made up. "Franchise service is often billed through the city" is backed by the research brief (city-billed systems in franchise areas); "typically one to two weeks" is stated as typical, not promised. The screen has no dollar amount (checked in the browser).

63. **Shared card widget and contact fields.** Checkout now renders `CardWidget` with its original label, so the boundary intake uses the same component rather than a copy. `ContactFields` serves the intake and the commercial form. The Phase 3 placeholder screen was retired (moved out of src) now that every branch has its real screen.

64. **Paper artboards for Phase 4 are left to the manager.** Addendum F3 says only the manager session calls the Paper MCP. This session was dispatched to do Phase 4, so the "Paper first" box stays unticked with the note "Paper: manager", and the four screens were built from the Phase 3 artboard patterns (panel, pill, field, primary button, radio card).

## Phase 5

65. **runIntake is the one intake function; buildIntakeTranscript wraps it.** runIntake returns the message thread, the Offer it quoted, the branch, and the rules that fired. buildIntakeTranscript keeps its Phase 2 signature and returns `runIntake(...).messages`, so the Phase 2 tests and callers are unchanged.

66. **The drawer quotes the price panel's own Offer object.** TranscriptArgs gained an optional `offer`. On the screens that show a price panel (offer, boundary, checkout, boundaryIntake, success) the drawer passes the Offer from useOfferView, the same object the panel renders, and runIntake quotes it as is when it prices the matched zone and route; otherwise it builds its own with buildOffer. So due today, the quarterly amount, and the monthly equivalent in the thread are read from one buildOffer call, not two that happen to agree. A test asserts `run.offer` is the very object passed in.

67. **Commercial form answers moved into the ui store.** The container, material, frequency, access notes, and address were component state; they are now `commercialDraft` in src/store/ui.ts so the drawer can echo them as customer replies while the buyer fills the form. submitAddress seeds it with the matched address and startOver resets it. The form's behaviour and copy are unchanged.

68. **Which transcript each screen shows** (src/ui/agentView.ts, pure and tested). Landing: the typed text, live, with the same address presets the offer applies; empty text shows a one-line prompt. Offer, boundary, checkout, boundary intake, success, franchise, not served: the picked address and current selections. Commercial: the form's draft. Held status: the saved quote replayed from its lines, intake start date, and recorded holdDeadline, with a note naming the quote id. Office: no buyer conversation, so a short explanation instead of a thread.

69. **The drawer is non-modal at 1280px and wider.** The page gains right padding equal to the drawer width (460px) and there is no scrim, so the configurator stays usable beside the transcript and a change is visible in both at once (the checklist asks for live updates while the drawer is open). Below 1280px the drawer overlays the page with a scrim that closes it on click; below 640px it is full width. Paper artboard CU-0 draws a scrim over the page at 1440; that is an accepted drift at xl, for the Phase 6 drift note.

70. **Commercial transcript shape.** The agent states the no-price sentence (COMMERCIAL_NO_PRICE_REASON) in its own bubble, then the handoff card follows the boundary pattern: "I can't price a 3 yd cardboard container twice a week on chat, a person will reply by Fri Sep 11 with a written price." The summary is built from the answers given; the reply day is nextBusinessDay(TODAY).

71. **Boundary wording matches the page.** The totals line says "due when approved" (the panel label from entry 55) and the dates line says "If we can serve it, your cart arrives ..." instead of "Done.", because nothing is booked until a person approves.

72. **Rules used footer contents.** Zone match (address id, zone id, serviceability), route day, one rate version row per line (catalog id: rateVersionId or contractId, ruleWon), the delivery fee rule, the fee rule ids that fired, and the tax rule id, all read from `offer.rules` and the delivery Charge, never recomputed. Branch extras: Hold (boundary), Franchise holder and No price (franchise), Container, No price, and Reply by (commercial), Handoff (not served).

73. **The dollar-literal guard is wider than asked.** The checklist asks that agent.ts contain no "$" followed by a digit; the test also checks AgentDrawer.tsx and agentView.ts, since those files feed the same thread.

74. **Handoff deadline format.** The boundary card keeps formatDateTime ("Sun Sep 13 at 10:00 AM", entry 58) while the status screen uses formatDayTime; both read the same clock value (now plus HOLD_HOURS, or the held quote's holdDeadline), so they never disagree on the time.

75. **Focus and Escape.** The drawer takes focus when it opens (it is labelled by its title), Escape closes it from anywhere on the page, and focus goes back to the "Agent view" button, which carries aria-expanded and aria-controls.

76. **A pricing failure hands off instead of breaking the drawer.** If buildOffer throws for a matched address (for example a zone with no route), the thread ends with a handoff card and the Rules footer shows the error, rather than the drawer crashing.

77. **Not-served wording in the thread.** The agent says "I checked <address> against our routes and could not find it on any of them." instead of lowercasing the zone name ("it is outside service area" read badly); the zone id still appears in the Rules used footer.

### Requests for shared/

- pricing's residential RateVersion publishedAt values ("2024-12-10T09:00:00", "2023-12-15T09:00:00") have no UTC offset, unlike addendum E1's -04:00 rule. Storefront copied them exactly per C4. Suggest the merge (or pricing) adds -04:00 in one place so every surface follows.
- .claude/launch.json's "storefront-dev" entry has `"autoPort": true`. The storefront now ignores PORT and uses --strictPort per addendum G, so autoPort does nothing except imply that the port can drift. Suggest removing it (the file is outside this surface folder).

## Phase 6

78. **The dev server ignores the checklist tooling's files.** `scripts/build_dashboard.py` rewrites dashboard.html, progress.json, and CHECKLIST.md mid-session, and Vite answers any change to an .html file under the root with a full page reload, which empties the in-memory store (a signup on screen disappears). vite.config.ts sets `server.watch.ignored` to `**/dashboard.html`, `**/progress.json`, `**/CHECKLIST.md`, and `<root>/*.md`. The root pattern is absolute because chokidar matches ignore globs against absolute paths, so a bare `*.md` would never match. Nothing the app imports lives in those files.

79. **Addendum F2: storefront token names kept, every value an alias of a --tl- token.** src/index.css imports ../../shared/tokens.css first, then src/styles/tokens.css, which now defines no raw values. tailwind.config.cjs and every component are unchanged, so screens restyle without a code change. The pairs that needed a judgment:
    - `--color-accent` is `--tl-brand` (#312D97, Paper's nav and primary button), not `--tl-accent` (#5149D7, which Paper uses only for eyebrows).
    - `--color-accent-strong` (hover and pressed) is `--tl-ink` (#1A174F). `--tl-brand-deep` (#2F2A90) is too close to the brand to show a hover.
    - `--color-accent-soft` is `--tl-accent-soft`, the shared file's derived selected-state fill.
    - `--color-gray-400` (placeholder, disabled) is `--tl-lavender`, the neutral dot color.
    - `--text-display` is Paper's page title, 28/34 with -0.01em tracking, down from 32/40.
    - `--text-body` stays 16px (`--tl-text-16`, 22px leading) rather than Paper's 14px office body. This is a buyer on a phone, and iOS zooms into inputs set below 16px.
    - Radii are 8px (`--tl-radius-sm`) and 16px (`--tl-radius-lg`, Paper's card radius).
    - `--spacing-12` is derived as twice `--tl-space-6` because the shared scale stops at 40px.
    - Manrope and IBM Plex Mono are loaded from Google Fonts in index.html, as billing and account already do. The shared file names the family but loads nothing.
    - The shared file ends in a Tailwind v4 `@theme` block. Tailwind v3 and browsers ignore unknown at-rules, so it is inert here. The merge uses it.

80. **Pills and the handoff label read in ink, with a tone dot.** Under F2 the warning color is `--tl-warn` (#F5A524). As text on `--tl-warn-soft` that is about 1.9:1, unreadable. Paper's pill (D3-0) is a soft fill, ink text, and a colored dot, fully rounded. The Pill component now draws exactly that for every tone. The agent drawer's "Handoff to a person" label moved from warning text to ink beside its existing warning dot. These are the only component class changes F2 caused, and neither adds a hex literal.

81. **The store inspector is a tab of the Office screen.** "Approvals" and "Store" share one header (`#office`, `#store`), and the ui store's `screen` gains `store`. The inspector itself works like this:
    - It lists parties, accounts, sites, serviceItems, workOrders, quotes, payments, and charges whose id is not in `SEED_IDS`. Every row expands to its raw JSON.
    - The charges table shows baseCents, fees (rule id and cents), taxCents, totalCents, source, and pricing.ruleWon (with the rate version or contract id). That makes invariant 2 visible on every row.
    - A "Seed records changed" list sits above the tables and compares the live quotes, quoteIntake, routes, accounts, and sites against a fresh seed copy, with before and after JSON. The id filter alone would hide half the held-signup proof: approving quote_held_ridge edits a seed quote and adds a stop to a seed route.
    - The header counts the session's intake rows and card tokens (brand, last 4, and expiry only).
    - "Reset to seed" asks once inline. It then calls `reset()` and the new `clearSession()`, which drops the ui store's signup, approvals, commercial receipt, and status id so no screen points at a record the reset removed.

82. **The franchise transcript names the holder once per message.** Before, it said "Southeast Sanitation" four times across two messages (the zone name carries it in parentheses, and then the text repeated it). The zone name now has the parenthetical stripped, as the franchise screen already does. The first message names the holder once. The second gives the same three steps as the screen (call or visit, what to bring, one to two weeks) and still ends with the holder's name, as Phase 2 requires. A test asserts no message names the holder twice.

83. **Copy review for the buyer voice.** Every string a buyer can reach was read, with these changes:
    - **Transcripts.** The open and boundary threads say "is in our <zone> service area" instead of "is in Piedmont open market". Add-on lines take an article ("plus an extra 96 gallon cart weekly"). The open thread says "Once you pay, your cart arrives ..." instead of "Done." before any payment. The commercial opener says "A few questions so a person can price it for you" instead of promising to "quote it right" and then declining, and it names the area without the franchise holder in parentheses. Every dollar amount still comes from the Offer (the dollar-literal test still passes).
    - **Errors.** A new `buyerError()` (src/ui/buyerError.ts) turns an expired card into "That card has expired. Check the expiry date, or use a different card." Any other thrown error becomes a generic line saying nothing was charged or sent, and the raw error goes to console.error. Before, checkout, the boundary intake, and the commercial form printed the engine's message. The offer screens print "We could not price this address online. ..." instead of the engine's "No published rate for ...", which stays on `OfferView.detail`.
    - **Empty states.** The success screen with no signup says "There is no finished signup to show yet. Start with your address." The other empty states ("We could not find that request.", "None created this session.", "No quotes yet.", the drawer's prompts) were already short and concrete.
    - **Loading.** There is no loading copy to review. Every read is synchronous against the in-memory store, so no screen ever waits.

84. **Keyboard.** No code change was needed. It was verified in the browser: the address input has focus on load, and Enter picks the highlighted match. Every radio (cart size, first pickup, container, material, pickups) is a real `input type=radio` (visually hidden, never tabindex -1), and every toggle (For a business, extra cart, recycling) is a `button role=switch`. On the offer screen all seven controls sit in the tab order and take focus. The Browser pane was hidden during this session, so real Tab presses were not delivered. Tab order was proven by calling focus() on each control and reading document.activeElement.

85. **Review of entries 1 to 77.** Every entry states its reason. These entries are superseded, and the later entry governs:
    - 5 (deliveredVia as string), by 43 and 50.
    - 11 (zone-less residential rates), by 45 and 52.
    - 13 (quote_held_ridge at $129.36), by 46 and 53. It is now $136.23.
    - 14 (Paper quota), by 47 and DESIGN.md's Phase 3 note.
    - 33 and 42 (placeholder screens and drawer), by the Phase 4 and 5 entries 63 and 65 to 77.
    - 48 (port drift), by 54.
    - The Phase 1 mineral palette in DESIGN.md, by 79.

86. **The DESIGN.md drift box is left for the manager.** The box asks for a get_screenshot of every Paper artboard, and addendum F3 reserves the Paper MCP for the manager session. DESIGN.md now carries the pattern table, the F2 token map, and a drift note per screen from the browser pass. What remains is the Paper side of each comparison, plus the token update in the "TrashLab Storefront" Paper file.

## Phase 7

87. **The user directed the storefront to follow trashlab.com.** Kevin asked for the storefront to take the look of the live trashlab.com site. The manager read it from the rendered DOM into docs/trashlab-design-language.md and drew two Paper artboards in that language: "Landing, trashlab.com language" (ER-0) and "Offer, trashlab.com language" (ES-0). Every Phase 7 value comes from that file. Because the user asked for this directly, it overrides addendum F2's "aliases only" rule for the values listed in entry 88. shared/ is still never edited. The storefront carries the new values in src/styles/tokens.css, and entry 97 asks the merge to adopt them.

88. **Tokens that now diverge from shared/tokens.css, and why.** These are the only raw values in src/styles/tokens.css. Every other storefront token keeps its `--tl-` alias.

    | Storefront token | Now | shared/tokens.css | Why |
    |---|---|---|---|
    | --color-bg | #F6F7FB | --tl-bg #F7F7FF | trashlab.com's light section ground. The cooler gray is what separates its white cards. |
    | --color-line | #E2E8F0 | --tl-line #D3D1FF | trashlab.com's 1px card border (slate-200). The lavender line tinted every card and field. |
    | --color-cyan (new) | #10A6CC | --tl-cyan #10D6E6 | The site's eyebrow and logo cyan. The shared cyan is Paper's nav dot and is far too light for text. |
    | --color-brand-deep (new) | #201A69 | --tl-brand-deep #2F2A90 | The site's footer indigo. The shared token of the same name is the text color of a white pill, a different color. The storefront name follows the site. |
    | --text-display | 48/60, tracking normal | --tl-text-28 28/34, -0.01em | The site's hero headline. 30/37.5 under 640px. |
    | --text-title (new) | 40/50 | --tl-text-40 at 44 | The page title under the header on every screen. It uses the shared size with the site's 1.25 leading. 30/37.5 under 640px. |
    | --text-heading | 24/32 | --tl-text-22 22/28 | The site's card title. |
    | --leading-body | 24px | --tl-leading-16 22px | The site's body is 16/24. |
    | --text-eyebrow, --text-lede (new) | 18/27, 18/28 | none | Eyebrow and hero copy. |
    | --text-stat, --text-row, --text-label (new) | 40/48, 15/22, 14/20 | 40/44, 15/20, 14/21 | The stat block amount, price card lines, and nav, label, and compact-button text, at ES-0's line heights. The sizes alias --tl-text-40/15/14. |
    | --radius-xl, --radius-pill (new) | 32px, 9999px | none, --tl-radius-pill 999px | The site's feature panel radius and its pill. They render the same as the shared pill. |
    | --size-header, --size-page, --size-button, --size-button-compact (new) | 80, 1200, 50, 44px | --tl-nav-height 64, --tl-page-max 1440, --tl-control-height 40/36 | The site's header, container, and pill button heights. |

    Also derived, not divergent: --color-hairline-on-brand is var(--tl-ink-2). --color-on-brand-85/80/25/18 are color-mix() of var(--tl-on-brand) at the opacities the site uses. --color-lavender is var(--tl-lavender).

89. **Font weight left the Tailwind font sizes.** display and heading used to carry a weight inside tailwind.config.cjs. A size utility and a `font-*` utility then both set font-weight, and which one wins depends on Tailwind's generation order. Every size now carries only size, line height, and tracking, and each element names its weight (every title and card title is `font-bold`). Every `text-display` and `text-heading` in src/ui was given an explicit weight in the same pass.

90. **Buttons are pills in two sizes.** PrimaryButton, SecondaryButton, and DangerButton are 50px tall with 28px side padding and 16px semibold text, fully rounded. SecondaryButton is white with a 1px line border. `size="compact"` is 44px tall, 20px padding, 14px semibold. It is used by the header's "Agent view" ghost pill, the office row actions (Approve, Decline, Decline do not charge, Cancel), the store inspector's reset pair, and the drawer's Close. Before Phase 7, SecondaryButton was a 36px small button, so "Check a different address", "Back to the storefront", and the commercial panel's secondary action are now full 50px pills, as on the site. The focus ring (2px brand, 2px offset) is unchanged. On the indigo band it is white with a brand offset (FOCUS_RING_ON_BRAND), since a brand ring vanishes on brand.

91. **Header at 390px.** The ES-0 header is exactly 80px with everything on one row. At 390px the name, the business switch, "Office", and "Agent view" do not fit on one row. The bar is therefore `min-height: 80px` and wraps: the name on row one, and the nav as a full-width second row spread edge to edge. From 768px it is exactly 80px. There is no horizontal scroll at any width.

92. **Landing details that ER-0 does not settle.**
    - The "Your address" label is visually hidden, since ER-0 draws none, but it stays in the DOM for screen readers.
    - Under 640px the white pill becomes a 32px-radius white card with the "Check my address" pill under the input, still inside the same white shape, so the typed address keeps a usable width.
    - The typing hint ("Matches appear as you type...") stays under the field in 14px white 80%.
    - The feature card copy: superseded by entry 98. The reference file now records ER-0's card copy and its dot tile, and the Paper comparison confirmed both, so the cards use ER-0's words and the 14px lavender dot instead of the Phase 3 short copy and my line icons.
    - The field keeps focus on load (Phase 6, entry 84), so its white focus ring shows on arrival. It stays, because the ring is the visible sign that typing goes there.

93. **Price card and stat blocks.**
    - The ES-0 price card has 32px padding. Phones get 24px, so the 390px column keeps room for the fee labels.
    - The quarterly amount and the monthly equivalent moved into the indigo stat block as its two 14px white-80% lines ("Then every quarter $102.61", "About $34.20 a month, all in"). The `due-today` and `recurring-quarterly` test ids moved with them.
    - Checkout's order summary uses the same block, and its separate "Then every quarter" row became the block's line.
    - The boundary intake's held price and the held status screen's preserved price also use the block ("Due when approved", or "Paid"). They are the boundary siblings of checkout, and a second style for the same number would read as a different number.
    - Success keeps a plain 40/48 amount inside its card, because it reports a payment already made, not an amount due.

94. **Eyebrow or status pill.** A kicker that names a place or a kind of service became an eyebrow: Franchise "Franchise area", Commercial "Business service", Not served "Outside service area", Office "Office", and the boundary intake's "Provisional price" (matching the boundary offer's eyebrow). A kicker that reports a state stays a status pill: the held status pill, Success "Service active", Commercial receipt "Request received", the office row statuses, the store counts, and the drawer's branch pill. The price card's "Provisional price" pill also stays, so the provisional state is always stated in ink.

95. **Cyan eyebrow contrast is below AA, accepted.** #10A6CC measures 2.67:1 on #F6F7FB and 3.76:1 on the brand indigo. That is under 4.5:1 for 18px medium text. It is trashlab.com's own treatment and the user asked for that look. No eyebrow says anything that is not also said in ink on the same screen: the headline follows every eyebrow, and "Provisional price" repeats as the ink pill and in the warning sentence. Every other text pair passes: white 85% on brand 8.2:1, white 80% 7.5:1, muted ink on the ground 5.2:1, ink 15.3:1. The #E2E8F0 card line is 1.15:1 on the ground. That is decorative: the white fill is what marks the card, as on the site.

96. **Selection controls.** A selected RadioCard is a 2px brand border on --color-gray-100 (#ECEBFF, ES-0's selected fill), and its padding drops from 16px to 15px so the card does not shift by the extra border pixel. The Offer add-ons are one ToggleList: a white 16px card with 1px dividers, role group, labelled "Add-ons". Its rows are the same Toggle without their own border. The switch is 40x24 in every place, including the header, where the track is white 18% and turns white, with a brand knob, when on.

### Requests for shared/

97. **Please add the trashlab.com values to the canonical set.** Every surface that follows the user's trashlab.com direction needs the same values:
    - cyan #10A6CC as a text cyan. Either replace --tl-cyan, or add --tl-cyan-text beside Paper's #10D6E6 dot color.
    - brand deep #201A69. The current --tl-brand-deep (#2F2A90) is the white pill's text color. Suggest renaming it (for example --tl-brand-on-white) and giving --tl-brand-deep the footer value.
    - section ground #F6F7FB and card line #E2E8F0.
    - display 48/60 with normal tracking, dropping to 30/37.5 under 640px.
    - a 32px radius (--tl-radius-xl).
    - pill buttons: 50px default and 44px compact, 28px and 20px side padding, 16px and 14px semibold, on the existing --tl-radius-pill.

### Paper comparison

98. **Running Landing and Offer compared against ER-0 and ES-0, drift fixed or accepted.** The comparison read exact values from Paper (get_jsx with inline styles, plus get_screenshot) and from the running app (getComputedStyle), so no value came from a screenshot. The fixes and the accepted differences are listed in DESIGN.md, "Drift against ER-0 and ES-0". Why each call went the way it did:
    - **ES-0 wins over the Phase 7 box wording where the box is silent.** Examples are the radio card padding (20px), bold option titles, 14/20 descriptions, 16/24 service lines, the semibold stat label, and the 24px step to the Continue button. The artboard is the design, and the checklist names it as the target.
    - **The checklist wins where it is explicit.** Switches are 40x24 everywhere, and the header pill is a 44px compact pill. ER-0 and ES-0 draw the header switch at 36x20 and the ghost pill at 40px. The checklist is the user's spec, and 44px is a touch target.
    - **Two new token names, both aliases, no new raw values.** `--radius-md` points at `--tl-radius-md` (12px, the feature tile). `--color-on-brand-12` is `--tl-on-brand` mixed to 12% (the landing header hairline). Neither diverges from shared/, so entry 88's divergence list and entry 97's request are unchanged.
    - **Paper renders in system-ui, the app in Manrope.** The Paper file has no Manrope loaded, and the site uses Manrope, so the font difference (and the three-line headline at 720px) is a Paper limitation, not app drift.
    - **Kept against ES-0 on purpose:** the two-line stat block recurring text (Phase 3 total label and test id), the secondary "Check a different address" pill, the conditions note, and the seed-driven labels ("96 gallon cart", "$1.00/mo").

99. **Paper now renders Manrope; supersedes the font bullet in entry 98.** Entry 98 recorded that Paper draws the artboards in system-ui. That was true when it was written. The manager then found the cause (Paper text nodes do not inherit the artboard's font-family) and set Manrope on every text node in all nine artboards. The landing headline wraps to three lines at 720px in both Paper and the app, so the font difference is gone. The manager also verified the Phase 7 Paper box independently: the running app matches ER-0 and ES-0 on measured values (title 40/50, price card 440px with a 32px radius and #E2E8F0 border, indigo due-today block with a 2px #6260AF border, 16px radio cards, 50px pills, and the proof-card copy word for word).

