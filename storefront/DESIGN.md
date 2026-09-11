# DESIGN.md: TrashLab Storefront

## Paper file

- Paper file: "TrashLab Storefront", fileId `01M26F99HT7HE6DJN4SE0FBQ89`, https://app.paper.design/file/01M26F99HT7HE6DJN4SE0FBQ89
- Created fresh with create_file. The existing "TrashLab, Haul-E Dispatch" file was not opened, read, or written.
- Paper status during Phase 1: create_file succeeded, then every further call (open_file, get_font_family_info, create_tokens) returned "Weekly MCP limit reached. It resets tomorrow." The token set below was written locally first.
- Paper status at the start of Phase 3: the quota had reset. get_guide loaded, open_file on the fileId above worked, get_font_family_info confirmed Inter is installed in every weight 100 to 900 (system-ui is not a Paper font; the code keeps it as the CSS fallback). create_tokens pushed all 45 tokens from src/styles/tokens.css (21 colors including the 5 semantic aliases as var() references, font family, 4 sizes, 4 line heights, display tracking, 4 weights, 8 spacing steps, 2 radii) and get_tokens returned the same values, so Paper and code now share one source.

## Brief (written before any tokens)

- Mood candidates: mineral, maritime, alpine, botanical, editorial.
- Mood chosen: mineral (limestone dust, weathered slate, oxidized copper). Not the first instinct for a waste hauler (that would be botanical green or industrial orange); mineral reads calm and durable, which is what a buyer wants from a utility they will pay every quarter.
- Direction: calm, address-first, price-forward, mobile-first. Every screen is designed at 390px wide sitting inside a 1440x900 desktop artboard; the desktop layout is the mobile column centered with generous margin, so one layout serves both. The address field is the only strong element on the landing screen. Prices are typeset larger than labels and never hidden behind a click. One accent color, used for the primary action and the matched-address confirmation only. Information sits directly on the surface; cards are reserved for the price panel and the drawer.

### Palette (one accent, neutral grays, success, warning, danger)

| Token | Value | Role |
|---|---|---|
| --color-gray-50 | #F7F5F0 | page ground (limestone dust) |
| --color-gray-100 | #ECE9E2 | subtle fill, table stripes |
| --color-gray-200 | #D9D5CC | lines and borders (mortar) |
| --color-gray-400 | #9A9891 | placeholder text, disabled |
| --color-gray-600 | #5B6367 | muted text (slate) |
| --color-gray-900 | #1F2426 | ink |
| --color-white | #FFFFFF | surface (panels, inputs) |
| --color-accent | #1F6F5F | oxidized copper: primary button, links, matched address |
| --color-accent-strong | #175649 | hover and pressed |
| --color-accent-soft | #E1EFEA | accent tint for selected radio and pill |
| --color-success | #2E7A4B | moss: accepted, paid, active pill |
| --color-success-soft | #E3F1E7 | success pill fill |
| --color-warning | #92581A | ochre: held, provisional, past due pill |
| --color-warning-soft | #F8ECD9 | warning pill fill |
| --color-danger | #B0402C | iron oxide: declined, error text |
| --color-danger-soft | #F7E3DE | danger pill fill |

Semantic aliases used by components: --color-bg, --color-surface, --color-ink, --color-ink-muted, --color-line.

### Type scale (Inter, system-ui fallback)

| Token | Size / line height | Weight | Use |
|---|---|---|---|
| display | 32px / 40px, tracking -0.02em | 700 | landing headline, due today amount |
| heading | 22px / 28px | 600 | screen titles, panel titles |
| body | 16px / 24px | 400 | everything readable |
| small | 13px / 18px | 400 or 500 | labels, helper text, pills, rule footer |

### Spacing (4px steps)

--spacing-1 4px, --spacing-2 8px, --spacing-3 12px, --spacing-4 16px, --spacing-5 20px, --spacing-6 24px, --spacing-8 32px, --spacing-12 48px.

### Radii

--radius-sm 6px (inputs, buttons, pills), --radius-lg 12px (panels, drawer, cards).

## Patterns (names used from Phase 3 on)

panel, pill, table, primary button, field, drawer. Each pattern uses only the tokens above; no hex literals in components.

## Artboards

| Artboard | Node id | Size | What it shows |
|---|---|---|---|
| Landing | `1-0` | 1440x900 | Top bar (brand, "For a business" toggle, "Agent view" button, "Office" link), a 560px centered column with the accent eyebrow, display headline, the exact address sentence, the address field with the primary button beside it, the typeahead panel with the first match selected, and three reassurance facts (complete price, start next week, no phone call). |
| Offer and checkout | `2-0` | 1440, height fit-content (about 1420) | Top bar (clone of the Landing top bar), an 1120px content column. Offer row: configurator on the left (address confirmed line, display headline "We serve 412 Larkspur Ln. Pickup is every Tuesday.", cart size radio cards with monthly prices, extra cart and recycling toggle rows, two first-pickup radio cards with "Cart arrives" under each, "Continue to checkout"), price panel on the right (service line, fee stack, Due today at display size, Then every quarter at heading size, monthly equivalent, the billing sentence, the conditions note). Checkout row: contact fields, the card widget on a gray-100 surface with the hosted-provider label (brand, last 4, expiry only), the autopay consent, and the order summary panel with the "Pay $129.36 and start service" button. |

Review notes from get_screenshot (Phase 3): both artboards use only the file's tokens. Landing needed no fix. "Offer and checkout" was created at 1400px tall and the consent row touched the bottom edge, so the artboard was switched to height fit-content with 48px bottom padding (update_styles) instead of guessing a new height. The desktop layout is two columns (configurator or form on the left, panel on the right); at 390px the code stacks the same groups in DOM order, which is the mobile-first column the brief describes.

Numbers on the artboard are the real single-cart figures from buildOffer for 412 Larkspur Ln: $29.00/mo, service $87.00, delivery $25.00, fuel $6.09, environmental $3.00, tax $8.27, due today $129.36, then $102.61 a quarter, about $34.20 a month.

### Phase 4 artboards: Paper: manager

"Franchise stop", "Held for review", "Office approvals", and "Commercial request" are not drawn yet. Addendum F3 reserves the Paper MCP for the manager session, so this box is left for the manager. The four screens were coded from the Phase 3 patterns so the artboards can be drawn from the running app:

- Franchise stop: neutral pill, display headline naming the holder, three numbered step cards (panel with an accent-soft number badge), primary button. No price.
- Held for review (status): warning pill plus quote id, display headline, warning-soft deadline bar ("We will text you by Fri Sep 11 10:00 AM"), panel with the preserved price, the saved link. The boundary offer and intake reuse the offer and checkout layouts with a warning "Provisional price" pill.
- Office approvals: one bordered row per quote with id and status pill, a 6 column dl (kind, address, due today, hold reason, deadline) that folds to 2 columns at 390px, an intake box on the page ground, Approve (primary) and Decline (secondary, then a danger confirm), and a success-soft receipt listing the created ids.
- Commercial request: accent pill, headline, accent-soft reason sentence, radio cards for container, material, and pickups, access notes, contact, and a "What happens next" panel with the submit button. No price.

## Artboards drawn by the manager (Phases 4 and 5)

Drawn in the "TrashLab Storefront" Paper file by the manager session, per addendum F3. Each one reuses the Phase 1 top bar, tokens, and type scale, and was screenshotted and corrected in Paper before this note.

| Artboard | Paper id | What it shows |
|---|---|---|
| Franchise stop | 5U-0 | Address line, the franchise sentence naming Southeast Sanitation, three numbered steps, a "Check a different address" button. No price. |
| Held for review | 5V-0 | "Held for review" pill, deadline headline (Sun Sep 13, 10:00 am), the reason, and a held price panel: $31.00/mo, $136.23 charged on approval, $109.48 each quarter, card saved not charged, held until Thu Sep 17. |
| Office approvals | 5W-0 | Held and commercial counters, then one table: quote_held_ridge with Approve and Decline, an accepted row showing the created account and work order inline, and quote_bakery_request with its intake summary and no price. |
| Commercial request | 5X-0 | Form (address, 2 or 3 yard, material chips, pickups per week, access notes, contact) beside a "What happens next" panel with the no-price sentence and a "Send quote request" button. |
| Agent drawer | CU-0 | Boundary offer under a scrim, with a 460px right drawer: header, text thread (customer bubbles right in accent, agent bubbles left on surface), a "Handoff to a person" card in warning tones, and a "Rules used" footer of rule chips. |

Corrections made in Paper: the franchise retry button no longer wraps, the office held counter matches the rows, the office address column was narrowed so reasons fit on one line, the commercial artboard fits its content, and the drawer subtitle no longer leaves an orphan word.


## Phase 6: tokens after F2, patterns, and drift

### Tokens after F2

Since Phase 6 the code no longer uses the mineral palette above. Addendum F2 made `../shared/tokens.css` (the `--tl-` set read from the TrashLab Paper file) the only source of values. src/index.css imports it first, and src/styles/tokens.css keeps the storefront names (`--color-accent`, `--text-body`, `--radius-lg`, ...) as aliases of `--tl-` values. tailwind.config.cjs and the components did not change. The main pairs:

| Storefront name | Now | Value |
|---|---|---|
| --color-accent | --tl-brand | #312D97 |
| --color-accent-strong (hover) | --tl-ink | #1A174F |
| --color-accent-soft | --tl-accent-soft (= --tl-line) | #D3D1FF |
| --color-bg, gray-50 | --tl-bg | #F7F7FF |
| --color-surface, white | --tl-surface | #FFFFFF |
| --color-line, gray-200 | --tl-line | #D3D1FF |
| gray-100 | --tl-line-soft | #ECEBFF |
| gray-400 | --tl-lavender | #818DF0 |
| --color-ink-muted, gray-600 | --tl-ink-2 | #6260AF |
| --color-ink, gray-900 | --tl-ink | #1A174F |
| success / warning / danger | --tl-ok / --tl-warn / --tl-danger | #1F9D6B / #F5A524 / #C8382D |
| --font-sans | --tl-font-sans | Manrope (loaded in index.html) |
| display / heading / body / small | --tl-text-28 / 22 / 16 / 13 | 28/34, 22/28, 16/22, 13/18 |
| --radius-sm / --radius-lg | --tl-radius-sm / --tl-radius-lg | 8px / 16px |

The reasons for each pair are in DECISIONS.md entry 79. **Paper follow-up (Paper: manager):** the "TrashLab Storefront" Paper file still holds the Phase 1 mineral tokens that create_tokens pushed in Phase 3. Every storefront artboard therefore drifts from the running app in color, font, and radius until the manager either pushes the `--tl-` values into that file or redraws on the TrashLab file. (Resolved: the manager remapped the Paper tokens at the final pass and again for the trashlab.com language in Phase 7.)

### Patterns and where each screen uses them

| Pattern | Component | Screens |
|---|---|---|
| panel | `Panel` in src/ui/components.tsx: surface, 1px line border, 16px radius | Offer and boundary (price panel), Checkout (order summary), Boundary intake (held price), Held status (preserved price), Success (account, what you paid, what recurs), Commercial (what happens next, what you sent), Franchise (step cards, same classes), Office (quote rows), Store (summary bar, tables) |
| pill | `Pill`: soft tone fill, ink text, tone dot, fully rounded | Offer ("Provisional price"), Franchise ("Franchise area"), Not served, Held status (status), Success ("Service active"), Commercial ("Business service", "Request received"), Office (status per row, "Office"), Store (created and changed counts), Agent drawer (branch) |
| table | Store inspector `RecordTable`: header rule, soft row rules, a JSON toggle per row, horizontal scroll inside its own box | Store inspector (8 tables). Office approvals uses a definition grid per row (6 columns at md, 2 at 390) instead of one table so each row can carry intake details and the inline approval receipt. |
| primary button | `PrimaryButton`: brand fill, white text, 56px or 48px tall, 8px radius | Landing ("Check my address"), Offer ("Continue to checkout", "Continue to hold my price"), Checkout ("Pay $129.36 and start service"), Boundary intake ("Hold my price and submit for review"), Commercial ("Send my request"), Franchise, Not served, Held status, Success, Office ("Approve") |
| field | `Field` + `TextInput` / `Select` / `TextArea`: label above, helper under, 48px control | Landing (address, 56px), Checkout and Boundary intake (contact, card widget), Commercial (address, access notes, contact), Office (decline reason) |
| drawer | `AgentDrawer`: 460px right sheet, header, text thread, "Rules used" footer | Every screen, from "Agent view" |

Supporting patterns built from the same tokens: radio card (`RadioCard`, cart size, first pickup, container, material, pickups), toggle row (`Toggle`, extra cart, recycling), money row (`MoneyRow`), and the error note (`ErrorNote`, danger soft fill).

### Drift notes, per screen

Browser side: screenshots of the running app at 1440x900 and 390x844 (Phase 6 pass, every screen, no horizontal scroll at either width). Paper side: the artboard descriptions recorded above. The get_screenshot comparison of each artboard is a Paper MCP call and is left to the manager (addendum F3). Drift common to every screen is the token swap described above (brand indigo for copper, Manrope for Inter, 28px display, 16px panel radius, rounded pills with a dot). That drift is intended by F2, and it is resolved in Paper, not in code.

| Screen | Artboard | Drift found in the browser, and its disposition |
|---|---|---|
| Landing | Landing `1-0` | Same structure: 560px column, eyebrow, headline, the exact address sentence, field with the button beside it, typeahead with the first match selected, three facts. The headline is 28px, not 32px (token swap). No other drift. |
| Offer | Offer and checkout `2-0` (top row) | Same two columns: configurator (confirmation line, cart radio cards with prices, add-on toggles, two first-pickup cards with "Cart arrives" under each) and the price panel (lines, fee stack, due today, quarterly, monthly, billing sentence, conditions note). The continue button sits under the configurator, where the artboard also puts it. No layout drift. |
| Checkout | Offer and checkout `2-0` (bottom row) | The artboard stacks checkout under the offer so both can be reviewed at once. The app shows checkout as its own screen after "Continue to checkout". Accepted: that is the flow, and the artboard is a review sheet. Fields, the card widget label, the consent line, and the order summary match. |
| Boundary offer and intake | none (reuse `2-0`) | Same layout as Offer and Checkout plus the "Provisional price" pill and the warning-soft hold sentence. No artboard of its own. The Phase 4 notes say it reuses the offer patterns. |
| Franchise | Franchise stop `5U-0` | Matches: address line, franchise sentence naming Southeast Sanitation, three numbered step cards, "Check a different address". No price. No drift beyond tokens. |
| Held status | Held for review `5V-0` | The artboard's headline is the deadline. The app's headline is "Your price is held while we confirm your address." and the deadline sits in a warning bar: "We will text you by Sun Sep 13 10:00 AM". Accepted: the checklist's wording is "We will text you by <Day Mon D h:mm a>", and a sentence reads better as a headline than a timestamp. The artboard's "10:00 am" is "10:00 AM" in code for the same reason. The price panel matches ($31.00/mo, $136.23 when approved, $109.48 each quarter, held until Thu Sep 17). |
| Office approvals | Office approvals `5W-0` | The artboard shows counters and one table. The app shows a count sentence, Approvals and Store tabs (new in Phase 6), and one bordered row per quote holding the same columns (kind, address, due today, hold reason, deadline) plus intake details and the inline approval receipt. Accepted: the row holds more than one table line can, and it folds to two columns at 390px. |
| Commercial request | Commercial request `5X-0` | Same form beside a "What happens next" panel, with no price. The artboard's material chips are radio cards in the app (the same pattern as container and pickups), and its button "Send quote request" reads "Send my request". Accepted: one selection pattern per form, and the buyer's own voice on the button. |
| Agent drawer | Agent drawer `CU-0` | Thread, handoff card, and "Rules used" footer match. At 1280px and wider the drawer sits beside the page with no scrim (accepted in DECISIONS.md entry 69). Below 1280px it overlays with a scrim, as drawn. The handoff label is now ink beside a warning dot (entry 80). |
| Success, Not served, Commercial receipt, Store inspector | none | No artboard. Built from the patterns above. The store inspector is the one new screen in Phase 6. The manager can draw it from the running app if the merge wants it in Paper. |

## Paper drift check at the final pass (manager)

After Phase 6 adopted shared/tokens.css, the manager remapped the storefront Paper file's tokens to the same values (brand #312D97, ink #1A174F, ground #F7F7FF, lines #D3D1FF, Manrope, display 28/34, radii 8 and 16). Every artboard reads its colors, type, and radii through those tokens, so all seven artboards (Landing, Offer and checkout, Franchise stop, Held for review, Office approvals, Commercial request, Agent drawer) now render in the TrashLab palette without a redraw. Each was compared by get_screenshot against the running app on the fresh install.

| Screen | Drift | Decision |
|---|---|---|
| All | Palette, font, and radii | Fixed: Paper tokens now equal the app's aliases of the --tl- set. |
| Pills and handoff label | Paper drew warning-colored text, which is too pale on the shared amber | Fixed in Paper: the text now uses ink, matching the app's dark text with a colored dot. |
| Top bar at phone width | The app wraps the business toggle and Office link to a second row under 400px; Paper shows desktop only | Accepted: the artboards are 1440px, and the app fits 390px with no horizontal scroll. |
| Franchise stop | The app adds a "Franchise area" pill and longer step copy | Accepted: the app copy was reviewed for the buyer voice in Phase 6. |
| Office approvals | Paper shows one table; the app shows one card per quote with labeled fields and the created ids inline | Accepted: cards carry the intake details (contact, notes, photo) that the table could not fit. |
| Agent drawer | At 1280px and wider the app places the drawer beside the page without a scrim | Accepted in Phase 5 so the configurator stays usable while the drawer is open. |
| Held for review | The app shows the seeded quote's own deadline (Fri Sep 11 10:00 AM) when opened from the seed link | Accepted: Paper shows a newly created hold (Sun Sep 13, 72 hours out); both come from the same clock helpers. |


## Phase 7: trashlab.com language

The user directed the storefront to follow the live trashlab.com site. Every value comes from **docs/trashlab-design-language.md**, which the manager read from the rendered trashlab.com DOM on 2026-09-10 at 1440px. The two Paper artboards in that language are in the "TrashLab Storefront" file (fileId 01M26F99HT7HE6DJN4SE0FBQ89):

- **"Landing, trashlab.com language" (ER-0):** the indigo hero band with the header inside it, the eyebrow, the 48/60 headline, the white pill address field, and three feature cards on the light ground.
- **"Offer, trashlab.com language" (ES-0):** the standalone 80px indigo header, then the two-column offer, with the 32px price card and the indigo stat block.

Code agents do not call Paper. The artboard descriptions above come from the reference file.

### Tokens

src/styles/tokens.css keeps every storefront name. The trashlab.com values that differ from shared/tokens.css are the only raw values in that file: ground #F6F7FB, card line #E2E8F0, cyan #10A6CC, brand deep #201A69, display 48/60 (30/37.5 under 640px), title 40/50 (30/37.5 under 640px), heading 24/32, body 16/24, radii 32px and 9999px, header 80px, container 1200px, buttons 50px and 44px. Everything else stays an alias of a `--tl-` token. The full table with a reason per row is in DECISIONS.md entry 88. The request to add these values to shared/ is entry 97.

### Patterns and the screens that use them

| Pattern | Code | Spec | Screens |
|---|---|---|---|
| Indigo header band | `TopBar`, plus Landing's hero `<section className="bg-accent">` | Brand ground, 80px tall (it wraps to two rows under 640px), content in the 1200px `Container`. White 32px logo tile with a 12px cyan square. Hauler name in 18px bold white. "For a business" switch on a white 18% track, with a 14px semibold white-80% label. "Office" as 14px semibold white-80% text. "Agent view" as a 44px ghost pill with a white 25% border. | Every screen (header). On the landing only, a 1px white-12% hairline runs under the header across the 1200px container (ER-0), because there the header sits inside the hero band. The Landing band continues it: 80px gap, then the eyebrow, headline, and copy 24px apart, the address pill 32px under the copy, and the band ending 88px under the field. |
| Eyebrow | `Eyebrow` and `Sparkle` in src/ui/components.tsx | A cyan four-point sparkle (20px, aria-hidden) beside 18/27 medium cyan text | Landing ("Residential trash pickup", or "Business waste service"). Offer ("Address confirmed", or "Provisional price" on the boundary branch). Boundary intake ("Provisional price"). Franchise ("Franchise area"). Commercial form ("Business service"). Not served ("Outside service area"). Office ("Office"). |
| Pill button | `PrimaryButton`, `SecondaryButton`, `DangerButton`, `GhostButton` | 50px tall, 28px side padding, 16px semibold, fully rounded. Secondary is a white pill with a 1px line border. `size="compact"` is 44px, 20px padding, 14px semibold. | Every screen. Compact: header "Agent view", office row actions, store inspector reset, drawer Close, and the boundary intake file button. |
| White card | `Panel`, the step and row cards, `RadioCard`, `ToggleList` | White, 1px #E2E8F0 border, 16px radius, 24px padding (20px on phones for `Panel`) | Checkout order summary, boundary intake held price, held status, success (three cards), commercial ("What happens next", "What you sent"), franchise steps, office rows, store inspector summary and tables, radio cards and the add-on list on offer and commercial. |
| Feature card | Landing proof row (`PROOF_CARDS` in src/ui/Landing.tsx) | A white card as above with 12px gaps: a 40px #ECEBFF icon tile with a 12px radius holding a 14px lavender dot (ER-0 draws no other icon art), a 24/32 bold title, and a 16/24 muted body. The copy is ER-0's, word for word. The row starts 56px below the band. The three cards stack at 390px. | Landing only |
| Price card | `PricePanel` | White, 32px radius (the site's feature panel), 32px padding (24px on phones), lines at 15/22 | Offer, boundary offer |
| Indigo stat block | `StatBlock` | Brand fill, 2px hairline-on-brand (#6260AF) border, 16px radius, 20px 24px padding, a 14px white-80% label, a 40/48 bold white amount, and 14px white-80% lines | Price card ("Due today", or "Due when approved"). Checkout order summary ("Due today"). Boundary intake ("Due when approved"). Held status ("Due when approved", or "Paid"). |
| Titles | `text-title font-bold` | 40/50 bold ink (30/37.5 under 640px) | The h1 of every screen below the header. Landing's hero uses `text-display`, 48/60 white. |

Unchanged on purpose:
- Inputs, selects, and text areas keep an 8px radius with a 1px line border and a 2px brand border on focus, since the site shows no inputs to copy.
- Status pills stay Paper's soft pill with an ink label and a tone dot. They report state; eyebrows name a place (DECISIONS.md entry 94).
- The agent drawer keeps its layout and takes the new buttons, cards, and heading.

### Drift against ER-0 and ES-0

Compared on 2026-09-10. The Paper side is get_screenshot and get_jsx (inline styles) of ER-0 and ES-0 in file 01M26F99HT7HE6DJN4SE0FBQ89. The app side is the running dev server at 1440x900 and 390x844, in the artboards' state: landing empty, and the offer for 412 Larkspur with recycling on. Values come from getComputedStyle and getBoundingClientRect, never from reading pixels. DECISIONS.md entry 98 records the reasons.

**Fixed in code (the app was off the artboard):**

| Screen | Drift found | Now |
|---|---|---|
| Landing | Proof cards used the Phase 3 short copy and my own line icons in an 8px tile, with the title and body nested at a 4px gap | ER-0 copy word for word. 40px #ECEBFF tile, 12px radius, 14px lavender dot. Flat 12px gaps. |
| Landing | Proof row started 64px below the band | 56px |
| Landing | Eyebrow, headline, and copy were 16px apart, and the field 32px under the copy | 24px, 24px, then 32px (phones keep 16px) |
| Landing | Map pin was 22px in brand | 20px lavender, ER-0's path and 1.6 stroke |
| Landing | No hairline under the header | 1px white 12% across the 1200px container, landing only |
| Offer | Radio cards had 16px padding, semibold title and price, and a 13px description | 20px padding (19px when selected, for the 2px border), bold, 14/20 description |
| Offer | Add-on rows had 16px padding, a 12px gap, and a 13px description. The switch knob was 20px on a 2px inset | 20px padding, 16px gap, 14/20 description. 18px knob on a 3px inset, still 40x24 |
| Offer | Continue button sat 48px under the configurator | 24px (grid row gap 24px, column gap 48px) |
| Offer | Price card had 20px gaps, and service lines were 15px semibold | 16px gaps. Service lines 16/24 regular, fee lines 15/22 |
| Offer | Stat block label was medium weight, flush under the fee lines | 14px semibold, 8px top margin |
| Offer | Billing sentence was in ink | Muted, as in ES-0 |

Measured after the fixes at 1440px:
- **Landing:** eyebrow bottom to headline 24px, headline to copy 24px, copy to field 32px, band bottom to cards 56px. Three cards of 384px. Card 16px radius, #E2E8F0 border, 24px padding, 12px gap. Tile 40x40, 12px radius, #ECEBFF. Dot 14px #818DF0. Title 24/32 700, body 16/24 #6260AF.
- **Offer:** columns 712px and 440px with a 48px gap, 64px top padding. Selected radio: 2px #312D97 on #ECEBFF. Unselected radio: 1px #E2E8F0, 20px padding. Toggle row 20px padding and 16px gap. Switch 40x24 with an 18px knob. Continue 50px pill 24px under the last fieldset. Price card 32px radius, 32px padding, 16px gap. Stat block 2px #6260AF, 16px radius, 20px 24px padding, 8px top margin, label 14/600, amount 40/48 700.
- **Both widths:** no horizontal scroll at 1440 or 390.

**Accepted (the difference is intended):**
- **Typeface in Paper:** resolved by the manager after Phase 7. Paper text nodes do not inherit an artboard's font-family, so every artboard had been drawing in system-ui. The manager set Manrope directly on all text nodes in all nine artboards. ER-0 now renders in Manrope and its 720px headline wraps to three lines, the same as the app, so there is no font drift left between Paper and code.
- **Header switch and ghost pill:** ES-0 and ER-0 draw the header switch at 36x20 and "Agent view" at 40px tall. The checklist sets 40x24 switches everywhere and a 44px compact pill, a 44px touch target. The app follows the checklist.
- **Logo tile:** ER-0 uses a 10px radius with a 14px cyan square (4px radius). The app uses 8px with 12px (3px). Accepted as imperceptible at 32px. No token exists for 10px, and adding one for a logo tile is not worth a token.
- **Stat block recurring line:** ES-0 has one line ("Then $146.83 a quarter, about $48.94 a month"). The app keeps two lines: "Then every quarter" is Phase 3's required total label, and it carries the `recurring-quarterly` test id (DECISIONS.md entry 93).
- **Offer extras ES-0 omits:** the "Check a different address" secondary pill beside Continue, and the conditions note under the billing sentence (both Phase 3 requirements).
- **Data labels:** "96 gallon cart" (the seed catalog name) against ES-0's "96 gal cart", and "Environmental fee, $1.00/mo" (built from the FeeRule) against "$1/mo". Both come from data, not UI copy.
- **Footnote leading:** 13/18 (--leading-small) against ES-0's 13/19. That is 1px, and the small token is shared by every screen.
- **Phone layouts:** ER-0 and ES-0 are desktop only. At 390px the header wraps to two rows, the landing pill becomes a stacked white card, and the price card uses 24px padding (DECISIONS.md entries 91 to 93).
