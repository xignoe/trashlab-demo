# DESIGN.md: account view tokens and patterns

## Paper status

Source of truth: `PAPER_TOKENS.md`. On 2026-09-10 the manager read the Paper file `01M24VYMM89TECB7A4ZC0WYY57` ("TrashLab, Haul-E Dispatch") with `get_computed_styles` and `get_jsx` on the artboard "Haul-E Dispatch, Agent Console" (node `1-0`, 1440x900) and wrote the computed colors, type, shape, and spacing into that file. The file declares no design tokens, so every value below is a computed style read off the artboard itself, not an imported token.

History: the Phase 1 subagent reached Paper for `get_basic_info` only (the weekly MCP quota blocked screenshots and styles) and shipped a fallback token set from `../trashlab/context/billing-flow-map.html` with Archivo and IBM Plex Sans. Phase 1b replaced that set with the artboard values. Nothing in the app reads the flow map any more; its only trace is the token names, which were kept so component code did not change.

The artboard is light only. Every dark value is derived from the same navy scene (the five anchors named in PAPER_TOKENS.md plus steps of them) and was never read from Paper. The Phase 3 read of the "Account view" artboard `D3-0` and its drift list are below.

**Current status (Phase 7).** Paper was last read in Phase 3. The Phase 7 check (addendum F3: the manager screenshots the running `/account/acct_bakery` against `D3-0` and notes drift here) has not been done: only the manager session calls Paper, and the Phase 7 subagent did not. Until the manager does it, the Phase 3 drift list below is the latest comparison with the artboard, and the Phase 7 visual pass further down checks the screen against the tokens, not against Paper.

Three kinds of source appear in the tables below:
- **artboard**: read from node `1-0`, with the element it was read from.
- **chosen**: not on the artboard; picked to sit with the artboard palette (the checklist needs red, green, a fourth pill color, a mono face, and a lighter ink step).
- **derived**: computed as a step of an artboard color, used for dark mode and hover states.

## Color tokens (src/styles/tokens.css)

Light values are on `:root`; dark values are redefined under `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])` and again under `:root[data-theme="dark"]`, so system dark, pinned dark, and pinned light all resolve from the same file. Verified in the browser on 2026-09-10 by toggling `data-theme` on the root element.

| Token | Light | Dark | Light source | Dark source |
| --- | --- | --- | --- | --- |
| `--bg` | #F7F7FF | #14123A | artboard: page ground, reasoning inset | derived: navy ground named in PAPER_TOKENS.md |
| `--surface` | #FFFFFF | #1E1B4F | artboard: approval cards, activity card | derived: named in PAPER_TOKENS.md |
| `--surface-2` | #ECEBFF | #2A2668 | artboard: icon tile background | derived: one step above dark surface |
| `--surface-3` | #F7F7FF | #232059 | artboard: reasoning inset (same as ground); table stripe and hover | derived: half step above dark surface |
| `--ink` | #1A174F | #EEEDFF | artboard: headings, card titles, body | derived: named in PAPER_TOKENS.md |
| `--ink-2` | #6260AF | #B4B2E6 | artboard: subtitles, meta, tertiary text | derived: named in PAPER_TOKENS.md |
| `--ink-3` | #8B89C4 | #8D8BC9 | chosen: lighter step of ink muted for hints and placeholders | derived |
| `--line` | #D3D1FF | #3A368A | artboard: approval card border, autopilot pill border | derived: named in PAPER_TOKENS.md |
| `--line-quiet` | #ECEBFF | #2A2668 | artboard: compact row border, secondary button border | derived: equals dark surface-2 |
| `--accent` | #312D97 | #6F7BEA | artboard: brand navy (nav bar, primary button, route health card) | derived: navy lifted so a filled button reads on the navy ground |
| `--accent-ink` | #2F2A90 | #A9B2F5 | artboard: "Adjust" secondary button label | derived: link ink with contrast on dark surface |
| `--accent-2` | #818DF0 | #98A3F5 | artboard: periwinkle (inset left rule, avatar, adjusted bar) | derived: one step lighter |
| `--eyebrow` | #5149D7 | #A9B2F5 | artboard: uppercase 11px labels | derived: same as dark accent-ink |
| `--code-bg` | #ECEBFF | #2A2668 | artboard: icon tile background reused for inline code | derived |
| `--gap-bg` | #FFF4DF | #3D2E10 | artboard: "Decide by" pill background (kept from Phase 1 as an alias of warn-bg) | derived |
| `--on-accent` | #FFFFFF | #FFFFFF | artboard: wordmark, big stat, head label on navy | same |
| `--on-accent-2` | #D3D1FF | #D3D1FF | artboard: lavender secondary text on navy | same |
| `--on-accent-line` | #FFFFFF1A | #FFFFFF1A | artboard: nav bar hairline | same |
| `--on-accent-active` | #FFFFFF1F | #FFFFFF1F | artboard: active nav tab, progress track | same |
| `--on-accent-border` | #FFFFFF29 | #FFFFFF29 | artboard: search border on navy | same |
| `--warn` / `--warn-bg` | #F5A524 / #FFF4DF | #F5A524 / #3D2E10 | artboard: "Decide by 11:30" dot and pill background, "down" bar | derived: amber kept, bg darkened |
| `--info` / `--info-bg` | #10D6E6 / #E0FBFD | #10D6E6 / #0F3A44 | artboard: "on time" bar; bg chosen (cyan tint at the amber pill's lightness) | derived |
| `--ok` / `--ok-bg` | #1F9D6B / #E3F6EE | #3FBF8A / #123A2C | chosen: no green on the artboard, chroma kept near the amber pill | derived |
| `--danger` / `--danger-bg` | #C8382D / #FDE8E6 | #F0766B / #45201D | chosen: no red on the artboard, chroma kept near the amber pill | derived |
| `--hold` / `--hold-bg` | #5149D7 / #ECEBFF | #A9B2F5 / #2A2668 | chosen: the eyebrow indigo on the icon tile tint, so hold is distinct from ok, warn, danger | derived |

Status pairs are used two ways: as a text color for figures (the red past due amount uses `--danger` directly) and as a 6px dot on a tinted background inside pills, where the label stays in `--ink` exactly as the artboard's "Decide by 11:30" pill does. Amber text on the amber tint would not pass contrast, so pills never color their label.

## Type tokens

One family on the artboard: Manrope, weights 500 (meta), 600 (buttons, small labels), 700 (headings, eyebrows, pill text), 800 (the 44px stat). `--font-heading` and `--font-body` are both Manrope with a system-ui fallback stack. `--font-mono` is IBM Plex Mono with `ui-monospace` fallbacks, a chosen addition because money and ids are not on this artboard. Google Fonts are linked in `index.html` (Manrope 500, 600, 700, 800; IBM Plex Mono 400, 500, 600); the fallback stacks render the page without network.

| Token | Value | Role on the artboard (size / line, weight, tracking) |
| --- | --- | --- |
| `--text-2xs` | 11px | eyebrow: 11 / 14, 700, 0.16em uppercase, `--eyebrow` |
| `--text-xs` | 12px | pill label 12 / 16 700 ink; small label 12 / 16 600 lavender on navy |
| `--text-sm` | 13px | meta and subtitle: 13 / 16, 500, `--ink-2` |
| `--text-base` | 14px | body 14 / 21 400; button label 14 / 18 600; page subtitle 14 / 18 500 |
| `--text-md` | 15px | card head label: 15 / 18, 700 |
| `--text-lg` | 16px | card title: 16 / 22, 700 |
| `--text-xl` | 22px | chosen: section title step between card title and page title (not on the artboard) |
| `--text-2xl` | 28px | page title: 28 / 34, 700, -0.01em |
| `--text-3xl` | 44px | big stat: 44 / 44, 800, -0.02em, white on navy |
| `--weight-meta` `--weight-label` `--weight-heading` `--weight-stat` | 500 600 700 800 | the four Manrope weights in use |

## Shape, shadow, and spacing tokens

| Token | Value | Source |
| --- | --- | --- |
| `--radius-xs` | 4px | chosen: inline code chips |
| `--radius-sm` | 8px | fields (PAPER_TOKENS.md "How to apply") |
| `--radius-md` | 12px | artboard: inset block, icon tile |
| `--radius-lg` | 16px | artboard: cards |
| `--radius-pill` | 999px | artboard: pills, buttons, search, avatar |
| `--shadow-card` | 0 10px 15px -3px #D3D1FF66, 0 4px 6px -4px #D3D1FF66 | artboard: approval and activity cards; dark uses black at 40% (derived) |
| `--shadow-drawer` | -8px 0 24px #1A174F1F | derived: ink at 12% for the Phase 4 side drawer |
| `--card-pad-block` / `--card-pad-inline` / `--card-gap` | 22px / 24px / 16px | artboard: card padding and internal gap |
| `--control-height` | 40px | artboard: buttons (fields match) |
| `--nav-height` / `--page-inline` / `--page-top` | 64px / 40px / 36px | artboard: nav bar height, page inline padding, page header top |
| `--main-width` / `--side-width` / `--workspace-gap` | 936px / 400px / 24px | artboard: main and side columns on the 1440 canvas |
| `--space-1` to `--space-8` | 4, 8, 12, 16, 20, 24, 32px | kept from Phase 1; the artboard's 6, 14, 18, 22 measures are written where they apply |
| `--drawer-width` / `--rail-width` | 420px / 260px | kept from Phase 1 for Phases 3 and 4 |

## Tailwind mapping (src/index.css)

`@theme inline` maps `--color-*` to every color token above, `--font-heading|body|sans|mono` to the font tokens, `--radius-xs|sm|md|lg|pill` to the radius tokens, `--shadow-card|drawer` to the shadow tokens, and `--text-2xs` to `--text-3xl` to the type scale with the artboard line heights. Tailwind's default palette, font, radius, shadow, and text namespaces are cleared (`--color-*: initial` and so on) so no invented values can slip in via utilities. `bg-surface`, `text-ink-2`, `border-line-quiet`, `text-eyebrow`, `font-mono`, `rounded-lg`, `shadow-card` all resolve to token variables and follow dark mode. Tailwind emits `--radius-sm: var(--radius-sm)` on `:root,:host` and tokens.css's later `:root` block overrides it, so the self-reference is harmless; keep `@import "./styles/tokens.css"` after `@import "tailwindcss"`.

## Patterns (base classes in src/index.css)

- Page: `.page`, grid with a 24px gap, padding 36 / 40 / 24, max width 1360 plus the inline padding (936 main plus 24 gap plus 400 side). `.page-title` 28 / 34 700 and `.page-subtitle` 14 / 18 500 muted. Phase 3 lays the header and the two columns inside it. Source: artboard workspace measures.
- Panel: `.panel`, `--surface` on a 1px `--line` border, `--radius-lg`, `--shadow-card`, 22 / 24 padding, 16 grid gap. `.panel-compact` is 16 / 24 with gap 14 and the quiet border (compact approval row). `.panel-head` is the card head band (18 top, 14 bottom, 20 inline, quiet rule under it) and `.panel-title` the 16 / 22 700 title. `.panel-navy` paints a panel in brand navy with `--on-accent` ink (the route health card; the header balance stat). Source: approval card, activity card, route health card.
- Inset: `.inset`, ground color, `--radius-md`, 14 / 16 padding, 3px `--accent-2` left rule, gap 6. Use for "why this price" explanations and the next-run preview. Source: reasoning block.
- Eyebrow: `.eyebrow`, Manrope 11 / 14 700, 0.16em uppercase, `--eyebrow`. Source: "Why Haul-E suggests this".
- Meta and stat: `.meta` 13 / 16 500 `--ink-2`; `.stat` 44 / 44 800 -0.02em for the big figure. Source: meta lines and the big stat.
- Code and money: `.code` mono 13px on `--code-bg` with `--radius-xs`; `.money` mono, tabular numerals, right aligned, no wrap. Chosen additions for ids and cents.
- Status pill: `.pill`, inline flex, 5 / 10 padding, pill radius, 12 / 16 700 label in `--ink`, 6px dot with a 6px gap. Base is `--surface` with the quiet border; `.pill-active` (ok), `.pill-pastDue` (danger), `.pill-suspended` (warn), `.pill-hold` (hold) set the dot color and tinted background via the `--pill-dot` custom property. Aliases `.pill-ok`, `.pill-warn`, `.pill-danger`, `.pill-info`, `.pill-accent` exist for non-status uses. Source: "Decide by 11:30" pill.
- Source pill: same `.pill` shape. Phase 3 assigns rate card = `.pill-info`, contract = `.pill-accent`, exception = `.pill-warn`.
- Button: `.btn` 40px tall pill, Manrope 14 / 18 600, 2px border. `.btn-primary` navy fill, `--on-accent` label, 22px inline; `.btn-secondary` `--surface` fill with a 2px `--line-quiet` border and `--accent-ink` label, 20px inline; `.btn-tertiary` text only in `--ink-2`, 12px inline; `.btn-danger` for destructive confirms; `.btn-sm` 32px variant for table rows. Hover states are `color-mix` steps toward ink (derived). Source: "Approve", "Adjust", "Skip".
- Field: `.field` (grid, gap 6) holding an `.eyebrow` label above `.input`, `.select`, or `.textarea`: 40px tall, `--radius-sm`, 1px `--line` border, `--surface`, 12px inline padding, focus border `--accent-2` with a 3px soft ring, `aria-invalid` turns the border `--danger`. `.input-mono` for cents. Chosen (fields are not on the artboard; radius from PAPER_TOKENS.md).
- Table: `.table`, full width, headers 12 / 16 600 `--ink-2` with a 1px `--line` rule, rows 14 / 21 `--ink` with `--line-quiet` tops, ground hover, `.money` cells right aligned, tfoot bold above a `--line` rule. Density chosen for a CSR screen.
- Side drawer: `.drawer`, fixed right, `--drawer-width`, `--surface`, 1px `--line` on the left, `--shadow-drawer`, card padding. Phase 4 adds open state and Escape.

## Verified

2026-09-10, Vite on port 5198, `/account/acct_res_maple`: light renders ground #F7F7FF, white panel with #D3D1FF border and the card shadow, Manrope 700 h1 at 28px, pastDue pill with a #C8382D dot on #FDE8E6 and an ink label, IBM Plex Mono on the id chip; dark (system and `data-theme="dark"`) renders ground #14123A, surface #1E1B4F, ink #EEEDFF. No console errors. `npm run build` and `npx vitest run` pass.

## Phase 3: Account view artboard

Read on 2026-09-10 with `get_screenshot` on node `D3-0` ("Account view, Office", world position 2320,-450) in file `01M24VYMM89TECB7A4ZC0WYY57`. The call succeeded on the first try, so the coded screen was built from the image; `get_jsx` was not needed because every value it would have given is already in PAPER_TOKENS.md. One line: a 1440-wide office screen with the dispatch console's navy nav (Customers active), an "Office · Account view" eyebrow over the account name, status pill, and meta line, a sync chip group top right, four stat cards (balance, past due in red, next invoice with date, autopay), a site card with the service table and a "why this price" inset, and a 400px side column with four pill buttons, a "Did you miss me? Last 14 days" card, an open items card, and a navy "Next billing run preview" card.

Drift between the artboard and `/account/:accountId`, in order of size:
- **Left rail.** The checklist requires a rail of pinned accounts plus search; the artboard has none. The rail is 260px (`--rail-width`) from 1600px up. Below 1600 the page inline padding drops to 20px and the rail flexes with `clamp(152px, 100vw - 1288px, 260px)`, so the main column never drops under 800px: on a 1440 canvas the rail is 152px and the main column 800px, against the artboard's 936px. The side column stays 400px. (Phase 7 follow-up; it was 208px and a 736px main column before.)
- **Stat figures** are IBM Plex Mono at 28px 600 (`--text-2xl`) rather than the artboard's slightly larger mono; the artboard's figure is not a token size and 28px is the page-title step.
- **Sync chips** read "all in sync" or "N stale" as the trailing note, with the reason on hover, instead of the artboard's "stale since 9:02"; the chip rules are data-driven (DECISIONS.md, Phase 3).
- **Service table** adds the checklist's Status column, with the row's Change action stacked under the status pill rather than in a ninth column. Since the Phase 7 follow-up the size label sits on the name's line and container serials are bare 12px mono as on the artboard (they were `.code` chips).
- **Next-run card** keeps the artboard's navy card, big mono total, and note line, but the per-line list is collapsed behind "Show N lines" as the checklist asks, and expands into a table with base, fees, tax, and total columns rather than the artboard's "$78.00 + fees and tax" shorthand.
- **Extra cards not on the artboard**: the contract card, the roll-off boxes card, and the invoices panel (with payments and credit memos) reuse `.panel`, `.kv`, and `.table-dense`. They sit in the main column after the site cards.
- The nav search and the other console tabs are drawn but inert; account search is the rail's field.

No new colors, fonts, or radii were added. New layout classes (`.nav`, `.workspace`, `.rail`, `.stat-strip`, `.chip-group`, `.row-list`, `.thumb`, `.price-btn`, `.kv`, `.navy-line`) are in `src/index.css` and use only token variables.

## Phase 7: visual pass against the tokens (not against Paper)

Checked on 2026-09-10 on port 5199 by measuring computed styles in the running app, not by eye and not against the artboard:
- **Colors.** Every visible element's computed text color, background, and border on `/account/acct_res_maple` (264 elements) resolves to a token value, in light (`data-theme="light"`) and in dark (`data-theme="dark"`). Zero values outside the token set. Transitions were disabled for the count, because a hidden browser pane never paints and leaves a button stuck mid-fade on the previous theme's color.
- **Money.** Every dollar figure on all five focus accounts, and inside the drawers on Maple, renders in IBM Plex Mono with tabular numerals, and every money table cell is right aligned. One miss was fixed: a money cell that also carried `.status-text` (Maple's open $87.45) fell back to Manrope; `.status-text.money` and `.status-text.mono` now keep the mono face.
- **Panels.** All nine panels on Maple share the 16px radius. The four stat cards use the compact 18 / 20 padding with an 8px gap; every content panel uses the artboard's 22 / 24 with a 16px gap.
- **Pills.** Status and source pill labels are 12px 700 in `--ink` on their tint, 10.6:1 or better; the dot carries the status color.
- **Copy.** No U+2014 em dash anywhere under `src`.
- **Focus.** Every drawer closes on Escape and on the scrim, hands focus back to its opener, and its enabled confirm is the last Tab stop. The "why this price" inset now also closes on an outside click.

No new colors, fonts, radii, or spacing tokens were added in Phase 7.

## Phase 7: Paper comparison (manager, 2026-09-10)

Compared by the manager session (addendum F3). Paper artboard `D3-0` ("Account view, Office", Maple) was captured with `get_screenshot`. The running app was captured with headless Chrome at 1440 by 1500, light mode, from port 5199, for `/account/acct_res_maple` and `/account/acct_bakery`.

Matches the artboard: the navy nav with pill tabs and the Customers tab active; the eyebrow, name, and status pill header; the sync chip group; the four stat cards with mono money and the danger past due; the service table columns and source pills; the price explanation inset; the side column order (actions, field history, open items, navy next billing run card); card radii, borders, shadow, and the Manrope and IBM Plex Mono pairing.

Drift found:
1. The left account rail (a checklist requirement, not on the artboard) takes width from the main column. At 1440 the service table wraps the service name and frequency onto two or three lines where the artboard keeps them on one.
2. On Bakery the service table overflows its card: the row action column is clipped at the right edge and only "C" of "Change" shows.
3. The navy card title "Next billing run preview" wraps to four lines because the cycle meta sits beside it; the artboard keeps the title on one line.
4. The nav wordmark is a trash can icon with "Trash Lab" as two words. The artboard clones the dispatch console's "TrashLab" wordmark (node `4-0`), one word.
5. Action buttons sit at the top of the side column level with the header instead of below it, and the sync chips sit mid-header instead of at the right edge. Accepted: it keeps the four actions visible without scrolling.
6. Figures differ from the artboard (next invoice $183.61 against the artboard's $180.74) because the artboard used illustrative numbers before the extra bags fee was priced. Not drift.

Items 1 to 4 are fixed by the Phase 7 follow-up boxes in CHECKLIST.md, checked on 2026-09-10 at 1440 on port 5199 by measurement on all five focus accounts and by headless Chrome screenshots of Maple and Bakery (kept in the session scratchpad, not the repo):
1. **Fixed.** The rail flexes down to 152px below 1600 and the page padding to 20px, so the main column is 800px at 1440; service names (with the size label on the name's line) and frequencies are one line on every focus account.
2. **Fixed.** The service table uses auto layout with 6px cell padding, compact pills, and bare mono serials, and Change moved under the status pill, so the table's scroll width equals its width (750px) on every focus account and Bakery's Change shows in full.
3. **Fixed.** The navy card's title sits on its own line ("Next billing run preview", one 22px line) with the cycle meta on the line below.
4. **Fixed.** The wordmark is one word: a 28px periwinkle glyph tile, "Trash" in white 700, and "Lab" in lavender 500 with no space, 113 by 28 px, drawn in inline SVG and text from existing tokens.
