# DESIGN.md: pricing surface

## Current token source (Phase 7)

Since Phase 7 (addendum F2) the token values come from ../shared/tokens.css, the canonical set read from the Paper file 01M24VYMM89TECB7A4ZC0WYY57 with get_computed_styles. src/styles/tokens.css copies its :root values unchanged (block 1) and keeps every name this surface used in Phases 1 to 6 as an alias pointing at a shared value (block 2), so src/index.css and component code did not change. The Phase 1 section below records where the original approximations came from and is kept as history. Full detail and before and after values: "Phase 7 token adoption" at the end of this file.

## Token source and caveat (Phase 1)

Paper file: "TrashLab, Haul-E Dispatch" (https://app.paper.design/file/01M24VYMM89TECB7A4ZC0WYY57/1-0). Artboards present:

| Artboard | Node id | Size | Read in Phase 1 |
|---|---|---|---|
| Haul-E Dispatch, Agent Console | 1-0 | 1440 x 900 | get_screenshot at 1x succeeded; get_children succeeded (Nav 2-0, Page header U-0, Workspace 17-0) |
| TrashLab.com Redesign | 68-0 | 1440 x 6010 | not read |

Sequence run: get_guide("paper-mcp-instructions") ok, get_basic_info ok (font family Manrope, no token set in the file), get_screenshot(1-0) ok, get_children(1-0) ok, then get_children(68-0) and get_computed_styles(1-0, 2-0, U-0, 17-0) both failed with "Weekly MCP limit reached. It resets tomorrow." Per the contract's fallback rule the tokens in src/styles/tokens.css are read off the Agent Console screenshot, not from computed styles. Treat every hex, size, and radius as approximate. When Paper is reachable again, replace them with get_computed_styles values and update the table below.

## Patterns and where they came from

All patterns are from artboard 1-0 unless noted. Node ids below the top level were not readable this session, so the source is named by layer and visible element.

| Pattern | Seen in | What was taken |
|---|---|---|
| Top bar | Nav (2-0): white bar, 64px tall, 1px bottom rule, wordmark left, text links, active link in a soft indigo pill with a dot, search field and avatar right | --tl-nav-height 64px, --tl-surface, --tl-border, active pill uses --tl-accent-soft and --tl-accent |
| Page header | Page header (U-0): eyebrow "HAUL-E · DISPATCH AGENT" letterspaced small caps in indigo, 28px bold headline, muted meta line | --tl-text-eyebrow 11px with 0.08em tracking, --tl-text-display 28px, --tl-text-muted |
| Card / side panel | Workspace (17-0): white cards with 1px border, 12px radius, faint shadow; right rail "Haul-E is handling" list panel and the dark indigo "Today's routes" summary card | --tl-surface, --tl-border, --tl-radius-lg 12px, --tl-shadow-card, --tl-accent-strong for the dark card |
| Callout | "Why Haul-E suggests this" block: muted lavender ground with a 3px indigo left rule | --tl-surface-muted, --tl-accent |
| Status pill | "Decide by 11:30" amber pill with a leading dot; "Waiting on you 3" count badge | --tl-warning, --tl-warning-soft, --tl-radius-pill, --tl-text-small |
| Button | "Approve reroute" solid indigo, white text, ~8px radius; "Adjust" outlined; "Skip" text only | --tl-accent, --tl-radius-md 8px, --tl-border for the outlined variant |
| Form field | Nav search input: light ground, 1px border, pill radius, muted placeholder | --tl-surface-muted, --tl-border, --tl-text-muted |
| Table row / list row | "Haul-E is handling" rows: time column, fixed width icon slot, text, 1px rules between rows | --tl-border, --tl-text-small for the time column, --tl-success for check icons |
| Tab | Nav links double as the tab pattern: text link, active state is the soft pill | same as top bar |
| Progress bars | "Today's routes": light blue (on time), indigo (adjusted), amber (down) | --tl-info, --tl-accent, --tl-warning |

The pricing surface reuses these as: top bar (App.tsx header), page header (eyebrow + display title on both pages), card (SeedCounts panel), and will add table, drawer, and pill variants in Phases 3 to 5.

## Type scale

Manrope is loaded from Google Fonts in index.html with a system fallback stack (`--tl-font-sans`). Sizes: display 28, h1 22, h2 17, body 14, small 12, mono 13, eyebrow 11. Weights used on the artboard: 400, 500, 600, 700, 800.

## Tailwind wiring

src/index.css imports Tailwind v4 and tokens.css, then maps every token through `@theme inline` so utilities read the CSS variables: `bg-bg`, `bg-surface`, `bg-surface-muted`, `border-line`, `text-ink`, `text-muted`, `text-accent`, `bg-accent-soft`, `text-success`, `text-warning`, `text-danger`, `font-sans`, `font-mono`, `text-display`, `text-h1`, `text-h2`, `text-body`, `text-small`, `text-mono`, `text-eyebrow`, `rounded-sm`, `rounded-md`, `rounded-card`, `rounded-pill`, `shadow-card`, `shadow-raised`. Components should use these classes and never a raw hex.

## Artboards created by this surface

| Artboard | Node id | Size | Phase | Notes |
|---|---|---|---|---|
| Pricing, Ratebook | IA-0 | 1440 x fit-content (about 1300 tall) | 3 | Paper was reachable again (the weekly limit had reset). Built with create_artboard plus write_html in nine groups: Nav (IB-0), Workspace (IS-0) holding Main column (IT-0: Page header IW-0, LOB tabs J5-0, Catalog table JN-0) and Right rail (IU-0: Zones panel JY-0, Fee and tax rules panel NU-0, Worked example OF-0, Agent panel slot OX-0). Column lanes: Item 160, Zone 100, Frequency 90, Price 160 (published price plus an amber Draft pill), Effective 120, Version flex with the id stacked over a "zone rate" pill, History 80. The artboard uses the token hex values from tokens.css inline because the Paper file still has no token set. |
| Pricing, Publish preview | 13E-0 | 1440 x fit-content | 4 | Built by the manager (addendum F3). Modal over a dimmed ground at canvas 3840, 634, beside IA-0. Sections: header with as-of date, counts strip (31 move, 4 + 1 lapsed, +$43.76 a month), accounts that move, protected by contract with acct_fl_004 in a warning callout, three representative invoices, footer stating old versions stay published. Numbers were computed by hand from the seed and match the running preview exactly. |
| Pricing, Quote workbench | 17F-0 | 1440 x fit-content | 5 | Built by the manager. Nav cloned from IA-0 with Quote workbench active. Three columns: request inputs (340), results (zone match, list price, cost waterfall, dark quoted price card with the exception line and reason), assumptions (330, every value editable). Scenario shown: Sunrise Bakery 3 yd 2x, mixed trash, full cost $169.10, target $198.94, quoted $198.00, "10% below ratebook, est. $264/yr". |
| Pricing, Agent proposals drawer | 1BW-0 | 1440 x 900 | 6 | Built by the manager. 1000 wide right drawer, brand header carrying "Agent drafts. Rules authorize. You approve. Nothing here publishes.", a summary line counting drafts and escalator entries, rows with rationale, current to proposed, margin, contract eligibility, placeholder churn pill, and action. Includes a lapsed contract row and an already scheduled escalator row. Residential margins assume 600 stops a day. |

Phase 4 adds "Publish preview", Phase 5 "Pricing, Quote workbench", Phase 6 the agent panel. Record ids here as they are created. If the Paper weekly limit is in force when those phases run, note that here and build from the tokens above.

## Drift notes

Phase 1: the placeholder pages use the eyebrow, display title, card, and nav pill patterns. No artboard exists for them, so there is nothing to diff against yet.

Phase 3 (running /pricing at 1440 wide against artboard IA-0):
- Right rail is 360px in code, 380px on the artboard. At the page's 1360px content width the seven table columns did not fit beside a 380px rail without a horizontal scroll, so the rail gave up 20px. Columns in code (box 7.9): Item minmax 56 / 0.5fr (it holds only the size label), Zone 92, Frequency minmax 104 / 0.8fr, Price minmax 200 / 1.2fr (widest, because the unwrapped "Scheduled $30.16 from 2026-10-01" pill is 196px), Effective 84, Version minmax 140 / 1fr (the version id truncates with a title), Actions 148 (New draft and History), 8px gutters. Minimums total 912px with padding, inside the 974px scroll container at 1440 wide.
- Catalog group rows carry a chevron collapse control and a "N drafts" pill; the artboard shows the group header without a chevron. Lines whose group has more than one version show a "N versions" pill next to the rule pill (the artboard has only "zone rate").
- Frontload and rolloff lines read "All zones" in the Zone column and a "standard rate" pill; the artboard only drew residential lines.
- The Phase 4 controls ("Increase all <LOB> by %", "New draft") render disabled with a tooltip so the header keeps its final shape; on the artboard they look live.
- The nav on the artboard has an "As of 2026-09-10" pill and an avatar on the right; App.tsx (Phase 1) has neither. Left for a later phase since App.tsx is not a Phase 3 file. The "as of" date appears in the table footer and the drawer header instead.
- Fee and tax rules panel lists all three TaxRules (open, boundary, franchise); the artboard shows only tax_open.
- Version history drawer (not on the artboard): 440px right drawer with a dimmed backdrop, one card per version with price, status pill, current marker, effective from, published at, supersedes and superseded by links, lock plus "Published versions are never edited" on published rows, Discard on drafts.
- Everything else (page header, tabs, pills, zones panel, worked example callout, dark agent slot) matches the artboard in token, size, and placement.

Phase 5 (running /pricing/quote against artboard 17F-0 as described in the table above; addendum F3 keeps subagents off the Paper MCP, so the comparison is against that description and the running screen, not a fresh Paper screenshot):
- Column lanes match: Request inputs 340, results flex, Assumptions 330, 24px gutters, inside the same 1360 content width as the Ratebook.
- Numbers match the artboard: Sunrise Bakery 3 yd 2x mixed trash gives full cost $169.10, target $198.94, quoted $198.00, "10% below ratebook, est. $264/yr".
- Zone match and List price sit side by side (5:7 split) at the top of the results column so the cost waterfall starts above the fold at 1440; the artboard lists them as the first two results.
- Added in code, not on the artboard: an account match box under the address (account name, status pill, ids, contract on file), a "Pricing request quote_bakery_request" callout with the requested lines, a Qty field, the site access note beside the flags, an "as of" pill in the page header, a stacked cost bar with price markers (ratebook, contract, quoted) and a "Target range" line, a "Save will" list naming every write, a green-ruled confirmation card, and "edited" chips plus "in use" dots in the Assumptions panel.
- List price card shows the ratebook price on a secondary line when a contract override wins, plus the existing override's reason and term, or a warning when that contract has lapsed.
- Dark quoted price card uses --tl-accent-strong ground with a white Save button, as on the artboard; the reason select only appears when the quote is below the ratebook.
- No hex values in src/components/quote or src/pages/QuoteWorkbench.tsx; every color is a token utility.
- The nav still lacks the artboard's "As of" pill and avatar (App.tsx, noted in Phase 3).

Phase 6 (running /pricing at 1440 x 900 against artboard 1BW-0 as described in the table above; addendum F3 keeps subagents off the Paper MCP, so the comparison is against that description and the running screen):
- The Phase 3 dark agent slot in the right rail is now the live card: eyebrow "Agent proposals", title "Annual increase", the rule line, three counts for the current LOB (to approve, scheduled, drafted), and a white "Review N <lob> proposals" button. Screenshot of the running Ratebook taken in the Browser pane on 2026-09-10; the card sits under the Worked example exactly where the slot was.
- The drawer is 1200px wide, not 1000. The 11 columns checklist 6.3 lists (select, account, current, proposed, pct, months since increase, margin, contract eligibility, churn risk, rationale, approve) clipped the rationale at 1000. Measured in the running page: drawer x 240, width 1200, height 900 (full viewport). Below 1180px the table scrolls sideways inside the drawer.
- Brand header matches the artboard: accent-strong ground, "Agent proposals: annual increase", and "Agent drafts. Rules authorize. You approve. Nothing here publishes." in accent-soft.
- Added in code, not on the artboard: LOB filter tabs inside the drawer (they drive the Ratebook's own tab), an always-visible "Approve all eligible: Creates N draft rate versions covering M accounts. Nothing publishes." line, a sticky confirm bar at the bottom listing every draft and escalator entry before any write, a green "Approved" banner, a "placeholder" caption under each churn pill, a "cost $X" caption under each margin, and an "Action:" line under each rationale.
- Lapsed contract row (acct_fl_004) carries a warning pill "contract ended 2026-08-31"; already scheduled rows (bakery, fl_001, fl_002) show an accent "Already scheduled" pill in place of Approve, as on the artboard.
- Ratebook header gains a second status pill, "N drafts pending from agent proposals", under the published and draft count; the drafts tray labels agent drafts with an "agent" pill.
- No hex values in src/components/AgentPanel.tsx; every color is a token utility.

Phase 4 (Publish preview, running /pricing at 1440 x 900 against artboard 13E-0 as described in the table above; addendum F3 keeps subagents off the Paper MCP, so the comparison is against that description and the running screen). Added in Phase 7, where box 7.4 found this note missing:
- The modal is 1120px wide and inset 24px top and bottom (measured: x 160, width 1120, height 852 at 1440 x 900), over an ink tinted backdrop, as on the artboard. The body scrolls; header and footer stay put.
- Counts strip has four stats, not three: Accounts move, Protected by contract (with "1 contract ended" under it), Monthly delta, and "Evaluated as of" (2026-10-01, the latest draft effective date). The artboard folds the date into the header only.
- Accounts that move is a table (account and id, before, after, delta with percent), first 10 rows and "Show all 31 (21 more)".
- Protected by contract is a table with Account, Contract (with the catalog items it covers), Override reason, and Why it is protected. acct_fl_004 is a row with the warning pill "contract ended 2026-08-31, no longer protected"; the artboard draws it as a separate warning callout.
- Representative invoices show before and after side by side with base, fees, tax, and total per line and the rule per line ("zone rate rv_res_96_open_weekly"); Sunrise Bakery carries "Unchanged: contract override".
- Revenue delta is its own accent band with Monthly and Annualised, above the footer; the artboard puts the delta in the counts strip only.
- Footer: "Confirm creates N published versions with supersedesId set..." and Cancel plus "Confirm and publish N versions", as on the artboard.
- Phase 7 adds a "No accounts move..." banner in the header when nothing moves (box 7.7).

## Phase 7 token adoption

Source: ../shared/tokens.css (read only; H1). Copied on 2026-09-10 into block 1 of src/styles/tokens.css. index.html now also loads IBM Plex Mono (400 to 700) beside Manrope, because the shared mono stack names it first.

Rule for names: a Phase 1 name that shared also defines takes the shared value; a Phase 1 name shared does not define becomes an alias of the nearest shared token. One exception: --tl-border stays a color (alias of --tl-line) because the Tailwind theme reads it as one; shared uses the name for a border shorthand, which block 1 leaves out (DECISIONS 102, Request for shared/ 5).

| Phase 1 name | Was (screenshot estimate) | Now | Source in shared |
|---|---|---|---|
| --tl-bg | #f5f6fb | #F7F7FF | --tl-bg (same name) |
| --tl-surface | #ffffff | #FFFFFF | --tl-surface |
| --tl-surface-muted | #f3f4fa | #F7F7FF | --tl-surface-muted |
| --tl-border (color) | #e4e7f2 | #D3D1FF | alias of --tl-line |
| --tl-text | #1b1f3b | #1A174F | alias of --tl-ink |
| --tl-text-muted | #6b7194 | #6260AF | alias of --tl-ink-2 |
| --tl-accent | #2e3a8f | #5149D7 | --tl-accent (same name) |
| --tl-accent-soft | #e9ecfa | #D3D1FF | --tl-accent-soft (same name, = --tl-line) |
| --tl-accent-strong | #262f73 | #312D97 | alias of --tl-brand |
| --tl-success / -soft | #2f9e6b / #e6f6ee | #1F9D6B / #ECEBFF | alias of --tl-ok / --tl-ok-soft |
| --tl-warning / -soft | #d99a1c / #fff3d6 | #F5A524 / #FFF4DF | alias of --tl-warn / --tl-warn-soft |
| --tl-danger / -soft | #d2434b / #fde8e9 | #C8382D / #FDE8E6 | same names |
| --tl-info | #7fb3ff | #5149D7 | --tl-info (same name, = accent) |
| --tl-font-mono | system mono | "IBM Plex Mono", ui-monospace, Menlo | --tl-font-mono |
| --tl-font-sans | Manrope, system stack | Manrope, Helvetica Neue, Arial | --tl-font-sans |
| --tl-text-display / h1 / h2 | 28 / 22 / 17 | 28 / 22 / 15 | --tl-text-28 / 22 / 15 |
| --tl-text-body / small / mono / eyebrow | 14 / 12 / 13 / 11 | unchanged | --tl-text-14 / 12 / 13 / 11 |
| --tl-leading-tight / body | 1.2 / 1.5 | 1.15 / 1.5 | --tl-leading-tight / --tl-leading-normal |
| --tl-tracking-eyebrow | 0.08em | 0.16em | alias of --tl-tracking-caps (no component reads it; eyebrows use a literal 0.08em class) |
| --tl-radius-sm / md / lg / pill | 6 / 8 / 12 / 999 | 8 / 12 / 16 / 999 | same names |
| --tl-shadow-card | grey, 2 layers | #D3D1FF66 lavender, 2 layers | --tl-shadow-card |
| --tl-shadow-raised | grey, 8px 24px | = card shadow | alias of --tl-shadow-panel |
| --tl-space-*, --tl-nav-height, --tl-page-gutter | 4px steps, 64, 40 | unchanged | --tl-space-*, --tl-nav-height, --tl-page-inline |

Re-screenshot (Browser pane, 1440 x 900, 2026-09-10) of /pricing, /pricing/quote, the publish preview (31 moved and zero moved), and the version history drawer; the agent proposals drawer was checked through its DOM text, not a screenshot. Visible changes, all from the table above:
- Accent is brighter violet (#5149D7): primary buttons, the active nav pill text, eyebrows, links, and the fear strip rule. The active nav pill and selected chips sit on #D3D1FF instead of a pale grey blue.
- Lines are lavender (#D3D1FF) instead of grey blue, so card edges and table rules read as TrashLab purple.
- Rounder: cards 16px, buttons 12px, inputs and small callouts 8px.
- Card and panel titles drop from 17px to 15px bold, matching the Paper panel titles.
- Numbers, ids, and money columns render in IBM Plex Mono. No column changed width (measured, DECISIONS 104).
- Success pills ("open", "zone rate", "Prices cover cost") keep a green dot and text but now sit on the lavender soft ground: shared's --tl-ok-soft is derived from --tl-line-soft because Paper names only the healthy dot. They read less green than before.
- The dark cards (agent proposals card, dark quoted price card) and the agent drawer header use --tl-accent-strong, which now aliases the Paper brand #312D97.

Phase 7 drift notes per screen (against the artboards above):
- Ratebook (IA-0): the artboard carries the Phase 1 screenshot estimates as inline hex values, so it is now greyer and squarer than the running screen (grey blue lines, #2e3a8f accent, 12px cards). The manager can refresh it with the shared values (Paper: manager, addendum F3). New: the fear strip under the page description (box 7.5). Pre-existing, measured this phase: at 1440 wide the catalog table's scroll container is 974px and its content 1018px, so History needs a 44px sideways scroll inside the table. The same numbers hold with the Phase 6 token values injected, so the token change did not cause it; the cause is the grid's minimum lanes since Phase 4 (DECISIONS 105). The page body never scrolls sideways. Fixed in box 7.9 (DECISIONS 112): with the narrower lanes above, scrollWidth equals clientWidth (974) on Residential, Frontload, and Rolloff at 1440 x 900, including after a 4 percent residential publish when all 8 Scheduled pills show, and every History button ends at x 995 inside the container's right edge at 1015.
- Publish preview (13E-0): see the Phase 4 note above; Phase 7 adds the zero moved banner and "monthly revenue unchanged".
- Version history drawer (no artboard): unchanged in layout; picks up the lavender lines and 16px cards.
- Drafts tray (part of IA-0's table area): new "no change, cannot publish" pill per draft and a danger soft banner when any draft repeats its superseded price; Preview publish disables when every draft does (box 7.7).
- Quote workbench (17F-0): new fear strip under the page description (box 7.5). Layout and numbers unchanged (Sunrise Bakery 3 yd 2x: full cost $169.10, target $198.94).
- Agent proposals drawer (1BW-0): the confirm button label now follows the plan ("Approve, create drafts only", "Approve, write escalator only", "Approve, create drafts and escalators"; box 7.8). The header ground is now the brand #312D97, matching the artboard's brand header more closely than before.
