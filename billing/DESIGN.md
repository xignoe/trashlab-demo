# DESIGN.md (billing surface)

## Where the values came from

The token set in `src/styles/tokens.css` and the pattern classes in `src/styles/index.css` carry the exact
values of the TrashLab Paper file (id 01M24VYMM89TECB7A4ZC0WYY57). The values were read by the manager from
Paper, because the subagent Paper MCP quota was exhausted on 2026-09-10 and no subagent could call the Paper
tools. The manager ran `get_jsx` and `get_computed_styles` on the file and wrote every computed value into
`docs/paper-reference.md`; this document and the two CSS files were written from that reference, and every
number below is a copy of a value in it. Tokens were read, not written; the two billing artboards (P2-0, XV-0) were later created by the manager, see the Billing run section below.

Two Paper sources are named throughout:

- Artboard "Account view - Office", node D3-0 (1440 wide, worldX 2320, worldY -450), built by the sibling
  account surface. It supplies the page, header, card, stat tile, table, pill, callout, button, side panel,
  and dark summary card patterns.
- The dispatch nav, node 2-0, read from the "Haul-E Dispatch - Agent Console" artboard before that artboard
  was removed from the file. It supplies the nav box (height, padding, color, bottom rule); the tab pills on
  it were read from D3-0. The eyebrow (W-0) and title (X-0) were also read from that earlier artboard and
  D3-0 uses the same values.

The Paper file has no design tokens defined and lists two font families: Manrope and IBM Plex Mono. Both load
from Google Fonts through the `<link>` in `index.html` (Manrope 500, 600, 700; IBM Plex Mono 400, 500, 600).

New artboards for this surface go to the right of D3-0: worldX 3840 for Billing run and worldX 5360 for
Payments, both at worldY -450, width 1440, height fit-content.

Every variable is prefixed `--tl-` and mirrored into a Tailwind v4 `@theme` block, so utilities such as
`bg-brand`, `text-ink-2`, `border-line-soft`, `rounded-lg`, `shadow-card`, `text-12`, and `font-mono` resolve
to the same values as the classes.

## Color tokens

| Token | Value | Paper source |
|---|---|---|
| `--tl-brand` | #312D97 | Nav background (2-0), primary button and dark summary card (D3-0) |
| `--tl-brand-deep` | #2F2A90 | Secondary button text (D3-0) |
| `--tl-brand-active-bg` | #FFFFFF1F | Active nav tab background (D3-0) |
| `--tl-brand-line` | #FFFFFF1A | Nav bottom rule (2-0), search field background (D3-0) |
| `--tl-brand-line-strong` | #FFFFFF29 | Search field border (D3-0) |
| `--tl-brand-tab-ink` | #F1F5F9CC | Inactive nav tab text (D3-0) |
| `--tl-brand-meta` | #FFFFFFB3 | Dark summary card meta text (D3-0) |
| `--tl-ink` | #1A174F | Title (X-0), primary cells, pill text, callout body, avatar initials (D3-0) |
| `--tl-ink-2` | #6260AF | Subtitle, stat caption, table header, panel meta, date column (D3-0) |
| `--tl-ink-3` | alias of `--tl-ink-2` | Paper uses two ink levels only; kept for existing markup |
| `--tl-accent` | #5149D7 | Eyebrow (W-0), stat tile and callout eyebrows (D3-0) |
| `--tl-lavender` | #818DF0 | Avatar, neutral pill dot, callout left rule (D3-0) |
| `--tl-cyan` | #10D6E6 | Active nav tab dot (D3-0) |
| `--tl-bg` | #F7F7FF | Page background, callout background (D3-0) |
| `--tl-surface` | #FFFFFF | Card, secondary button, side panel list card (D3-0) |
| `--tl-surface-muted` | #F7F7FF | Alias of the page background for inset areas and row hover |
| `--tl-line` | #D3D1FF | Card border, table header rule, photo placeholder, dark card labels and footnote (D3-0) |
| `--tl-line-soft` | #ECEBFF | Table row rule, list row rule, secondary button border, neutral pill background (D3-0) |
| `--tl-on-brand` | #FFFFFF | Text on `--tl-brand` (D3-0) |
| `--tl-danger` | #C8382D | Past due pill dot, negative stat eyebrow (D3-0) |
| `--tl-danger-soft` | #FDE8E6 | Past due pill background (D3-0) |
| `--tl-warn` | #F5A524 | Warning pill dot (D3-0) |
| `--tl-warn-soft` | #FFF4DF | Warning pill background (D3-0) |
| `--tl-ok` | #1F9D6B | Healthy pill dot (D3-0) |
| `--tl-ok-soft` | #ECEBFF | Derived: the reference names the healthy dot only, so the neutral background is used |
| `--tl-neutral` | #818DF0 | Neutral pill dot (D3-0) |
| `--tl-neutral-soft` | #ECEBFF | Neutral pill background (D3-0) |
| `--tl-info`, `--tl-info-soft` | #5149D7, #ECEBFF | Derived: Paper has no info variant; eyebrow accent on the neutral background |
| `--tl-accent-ink`, `--tl-accent-soft` | #312D97, #D3D1FF | Derived: Paper has no selected variant; brand dot on the line color |
| `--tl-on-accent` | #FFFFFF | Text on `--tl-accent-ink` |
| `--tl-code-bg` | #ECEBFF | Alias of `--tl-line-soft` for inline code |

## Type tokens

Families: `--tl-font-sans` "Manrope", `--tl-font-mono` "IBM Plex Mono", `--tl-font-display` is an alias of
sans (Paper has no separate display face).

| Size token | Line height token | Where Paper uses it |
|---|---|---|
| `--tl-text-11` 11px | `--tl-leading-11` 14px | Eyebrow (W-0, D3-0): 700, 0.16em, uppercase |
| `--tl-text-12` 12px | `--tl-leading-12` 16px | Pill 700, table header 700, panel meta 600, dark card lines 600, footnote 500, date column, ids (D3-0) |
| `--tl-text-13` 13px | `--tl-leading-13` 18px | Stat caption 500, avatar initials 700 (D3-0) |
| `--tl-text-14` 14px | `--tl-leading-14` 21px | Callout body at 21px, nav tab 500, subtitle 500, primary cell 600, money 600, buttons 600 (D3-0) |
| `--tl-text-15` 15px | `--tl-leading-15` 20px | Panel title 700, dark card title 700 (D3-0) |
| `--tl-text-16` 16px | `--tl-leading-16` 22px | Reserved by the manager; no artboard use recorded in the reference |
| `--tl-text-22` 22px | `--tl-leading-22` 28px | Reserved by the manager; no artboard use recorded in the reference |
| `--tl-text-28` 28px | `--tl-leading-28` 34px, `--tl-leading-28-stat` 32px | Page title 700 at 34px, -0.01em (X-0); stat value IBM Plex Mono 600 at 32px (D3-0) |
| `--tl-text-40` 40px | `--tl-leading-40` 44px | Dark summary big number IBM Plex Mono 600, -0.02em (D3-0) |

Line heights the reference states exactly: 11 at 14px, 14 at 21px (callout body), 28 at 34px (title) and 32px
(stat value). The line heights for 12, 13, 15, 16, 22, and 40 are derived and rounded to the 4px grid.

Weights `--tl-weight-regular` 400, `-medium` 500, `-semibold` 600, `-bold` 700. Tracking `--tl-tracking-caps`
0.16em (eyebrow), `--tl-tracking-tight` -0.01em (title), `--tl-tracking-display` -0.02em (big number). Role
aliases `--tl-text-xs` (11), `-sm` (13), `-md` (14), `-lg` (16), `-xl` (22), `-2xl` (28), `-3xl` (40) are kept for
existing markup. Body line height `--tl-leading-normal` is 1.5, which puts 14px body at 21px like the callout.

## Spacing, radii, shadow, layout

Spacing: `--tl-space-1` 4, `-1-5` 6, `-2` 8, `-2-5` 10, `-3` 12, `-3-5` 14, `-4` 16, `-4-5` 18, `-5` 20, `-6` 24,
`-8` 32, `-10` 40. Each value appears in D3-0 (nav tab 8 by 14, pill 5 by 10 with 6px dot and gap 6, card
18 to 22 by 20 to 24, callout 14 by 16, list row 14 by 20, panel header 18 top 14 bottom, page 32 top 40 inline,
tiles 16 apart, cards 20 apart, columns 24 apart).

Radii: `--tl-radius-lg` 16px (card, side panel, dark summary card), `--tl-radius-md` 12px (callout),
`--tl-radius-sm` 8px (photo placeholder), `--tl-radius-pill` 999px (nav tab, pill, buttons, search field).

Shadow: `--tl-shadow-card` is `#D3D1FF66 0px 10px 15px -3px, #D3D1FF66 0px 4px 6px -4px` (D3-0 card);
`--tl-shadow-panel` is the same value because the side panel list card uses the card shadow.

Layout: `--tl-nav-height` 64px (2-0), `--tl-page-max` 1440px, `--tl-page-inline` 40px, `--tl-main-width` 936px,
`--tl-panel-width` 400px, `--tl-column-gap` 24px, `--tl-card-gap` 20px, `--tl-tile-gap` 16px,
`--tl-control-height` 40px, `--tl-control-height-compact` 36px, `--tl-avatar-size` 36px, `--tl-photo-size` 48px
(all D3-0).

## Patterns

Classes live in `src/styles/index.css`. Each row names the Paper source and the exact values in use.

| Pattern | Paper source | Class | Values |
|---|---|---|---|
| Nav | Dispatch nav, node 2-0 | `.tl-nav` | flex, height 64px, paddingInline 40px, background #312D97, borderBottom 1px solid #FFFFFF1A |
| Nav brand | Not in the reference | `.tl-nav-brand` | white, Manrope 15px 700 (derived; the brand mark was not recorded) |
| Nav tab | Account view - Office, D3-0 | `.tl-nav-tab` | paddingBlock 8px, paddingInline 14px, radius 999px, text #F1F5F9CC, Manrope 14px 500 |
| Active tab | Account view - Office, D3-0 | `.tl-nav-tab[data-active="true"]` | background #FFFFFF1F, white 600 text, 7px dot #10D6E6 before the label (8px gap, derived) |
| Nav search | Account view - Office, D3-0 | `.tl-nav-search` | background #FFFFFF1A, border 1px #FFFFFF29, height 36px, radius 999px |
| Avatar | Account view - Office, D3-0 | `.tl-avatar` | 36px circle #818DF0, initials #1A174F 13px 700 |
| Page | Account view - Office, D3-0 | `.tl-page` | max 1440px, paddingTop 32px, paddingInline 40px, paddingBottom 32px |
| Page header | Account view - Office, D3-0 | `.tl-page-header` | flex, space-between, paddingBottom 20px |
| Page eyebrow | Node W-0 (also D3-0 tile and callout eyebrows) | `.tl-eyebrow` (alias `.tl-muted-label`) | Manrope 11px 700, lineHeight 14px, letterSpacing 0.16em, uppercase, #5149D7; `data-negative="true"` switches to #C8382D |
| Page title | Node X-0 | `.tl-page-title` | Manrope 28px 700, lineHeight 34px, letterSpacing -0.01em, #1A174F |
| Subtitle | Account view - Office, D3-0 | `.tl-page-subtitle` | Manrope 14px 500, #6260AF |
| Card | Account view - Office, D3-0 | `.tl-card`, `.tl-card-lg` | background #FFFFFF, border 1px #D3D1FF, radius 16px, shadow `--tl-shadow-card`, padding 18px 20px (`.tl-card-lg` 22px 24px, the top of the reference range) |
| Card title and meta | Account view - Office, D3-0 | `.tl-card-title`, `.tl-card-meta` | title Manrope 15px 700 #1A174F; meta 12px 600 #6260AF |
| Stat tile | Account view - Office, D3-0 | `.tl-stat`, `.tl-stat-value`, `.tl-stat-caption` | column gap 6px; eyebrow as above (#C8382D when negative); value IBM Plex Mono 28px 600 lineHeight 32px #1A174F; caption Manrope 13px 500 #6260AF |
| Table header | Account view - Office, D3-0 | `.tl-table th` | Manrope 12px 700 #6260AF, borderBottom 1px #D3D1FF, paddingBottom 8px |
| Table row | Account view - Office, D3-0 | `.tl-table td`, `.tl-primary`, `.tl-id`, `.tl-money` | paddingBlock 6px, borderTop 1px #ECEBFF; primary cell Manrope 14px 600 #1A174F; ids IBM Plex Mono 12px; money IBM Plex Mono 14px 600 right aligned. Hover #F7F7FF and selected #ECEBFF are derived states, not in the reference |
| Status pill | Account view - Office, D3-0 | `.tl-pill[data-tone]` | radius 999px, paddingBlock 5px, paddingInline 10px, 6px dot, Manrope 12px 700 #1A174F. `danger` (past due) bg #FDE8E6 dot #C8382D; `warn` bg #FFF4DF dot #F5A524; default (neutral) bg #ECEBFF dot #818DF0; `ok` (healthy) dot #1F9D6B on #ECEBFF (background derived); `info` and `accent` are derived, see below |
| Callout | Account view - Office, D3-0 ("Why $29.00") | `.tl-callout`, `.tl-callout-body` | background #F7F7FF, borderLeft 3px #818DF0, radius 12px, paddingBlock 14px, paddingInline 16px, eyebrow 11px 700 #5149D7, body Manrope 14px lineHeight 21px #1A174F |
| Primary button | Account view - Office, D3-0 | `.tl-btn.tl-btn-primary` | background #312D97, radius 999px, height 40px, paddingInline 22px, text #FFFFFF Manrope 14px 600 |
| Secondary button | Account view - Office, D3-0 | `.tl-btn.tl-btn-secondary` | background #FFFFFF, border 2px #ECEBFF, radius 999px, height 40px (`.tl-btn-compact` 36px), paddingInline 20px, text #2F2A90 Manrope 14px 600 |
| Side panel list card | Account view - Office, D3-0 | `.tl-list-card`, `-header`, `-title`, `-meta`, `-row`, `-date`, `.tl-photo-placeholder` | background #FFFFFF, radius 16px, card shadow; header paddingTop 18px paddingBottom 14px paddingInline 20px with title Manrope 15px 700 #1A174F and meta 12px 600 #6260AF; rows borderTop 1px #ECEBFF, paddingBlock 14px, paddingInline 20px; date column IBM Plex Mono 12px #6260AF width 44px; photo placeholder 48px square #D3D1FF radius 8px |
| Side panel (generic) | Account view - Office, D3-0 side column | `.tl-side-panel` | width 400px, same surface, radius, and shadow as the list card, padding 18px 20px 20px so free content sits where the list card header would |
| Dark summary card | Account view - Office, D3-0 | `.tl-summary-card`, `-title`, `-meta`, `-number`, `-line`, `-footnote` | background #312D97, radius 16px, padding 20px; title 15px 700 #FFFFFF; meta #FFFFFFB3 12px 600; big number IBM Plex Mono 40px 600 letterSpacing -0.02em #FFFFFF; line labels #D3D1FF 12px 600; line values IBM Plex Mono 12px 600 #FFFFFF; footnote #D3D1FF 12px 500 |
| Column layout | Account view - Office, D3-0 | `.tl-columns`, `.tl-stack`, `.tl-tiles` | main column 936px, side column 400px, gap 24px; 20px between cards; 16px between tiles |
| Money and ids | Billing convention | `.tl-mono` | IBM Plex Mono, tabular numerals |

## Values not in the reference

These are the only values that were not read from Paper. Each is built from Paper colors so nothing outside the
palette appears on screen.

- Healthy pill background: the reference names the dot #1F9D6B only; the neutral background #ECEBFF is used.
- `info` pill tone: no Paper variant; eyebrow accent #5149D7 dot on #ECEBFF. Used for "proposed".
- `accent` pill tone: no Paper variant; #312D97 dot on #D3D1FF. Used for the selected row marker.
- Table row hover (#F7F7FF) and selected row (#ECEBFF): the account view shows no interactive row states.
- Nav brand mark: white Manrope 15px 700; the reference does not record the brand text.
- Gap between the active tab dot and its label (8px) and between the pill dot and its label (6px).
- Line heights for 12, 13, 15, 16, 22, and 40px, listed in the type table above.
- Button hover: none defined; the reference records resting states only. Disabled buttons use opacity 0.55.

## Status color use

`danger` (past due, suspended), `warn` (review, hold), `ok` (approved, posted, healthy), neutral (waived),
`info` (proposed), `accent` (selected row and primary action marker).

## Billing run screen (Phase 4)

The manager made the artboard. "Billing run, Office" (Paper node P2-0) was created by the manager session,
not by a phase subagent, because the subagent Paper MCP quota was exhausted (DECISIONS.md entry 23). Its layout
is written in the "Billing run artboard" section of docs/paper-reference.md, and /billing is built from that
section: nav, header with cycle pill and Rates, Payments, Run cycle buttons, four stat tiles, the exception
queue with its six lanes (Account 220, Kind 150, Route 130, Proposed 100, Haul-E suggests 150, Status 90),
the leakage card, the detail panel (header, amount, evidence, policy, customer context, agent suggestion
callout, actions), and the dark "Ready to post" card. Components live in src/components/billing/ and the
screen specific classes are the "Billing run screen" block at the end of src/styles/index.css. Every figure
on the page comes from src/store/selectors.ts.

## Drift log

### Billing run, compared with Paper P2-0 on 2026-09-10 (browser pane at 800px and the artboard at 1440px)

Matches: nav box and active Billing pill with the cyan dot, eyebrow and title, warning pill for open decisions,
tile order and tones (Clean eyebrow #1F9D6B, Need decisions eyebrow #F5A524, Dollars at issue value #C8382D),
queue lane widths and the selected row (#ECEBFF, radius 10), kind pill tones (warning for field events,
danger for overage, neutral for service and rate change), detail sections split by #ECEBFF rules, 96px photo
placeholder with the file name, the agent callout with evidence chips and the "Agents draft" footnote, the
segmented control, and the dark ready-to-post card with the irreversibility footnote. The computed tiles
land on the artboard's own counts: 43 invoices, 31 clean, 12 need decisions.

Drift, each deliberate or left for a later phase:
- Data, not mock: dollars at issue is $692.79 (sum of the 14 undecided items) where the artboard shows $486.20; the
  header pill counts open items (14), the artboard shows 12. Names come from the seed (Ruth Maple, not Dana Maple).
- Queue sort: undecided first, then contamination, dry run, overload, extra bags, overage, service change, rate
  change. The artboard leads with Maple's extra bags and folds five rate changes into a footer line; the app lists
  all six rate change rows.
- Haul-E suggests is a pill plus a confidence line (the checklist asks for a suggestion pill); the artboard uses
  plain text with "Review" in #C8382D. Status reads "Proposed" where the artboard says "Open".
- Kind pills do not carry the tonnage ("Overage 1.20 t"); the tonnage is in the detail panel evidence and policy.
- Amount lines name each fee ("Fuel surcharge") without the rate suffix ("7% on service lines"); the rate is in the
  policy line.
- Leakage card is titled "Leakage" with "Waived charges on record" and shows all six seeded waives by reason; the
  three cycle window and the By route and By account tabs are Phase 5, so those two segments are disabled.
- Edit and Waive buttons, Bulk approve, Post invoices, Rates, and Payments are rendered disabled until Phase 5 and
  Phase 6 wire them. Approve works.
- Ready to post shows the clean total ($4,212.86) as the big number with clean, waiting, and run total lines; the
  artboard shows one figure with the two counts beside it.
- Nav has no logo glyph; the avatar shows the actor's initials (MA for M. Alvarez) where the artboard shows MR.
- Tile captions are shorter than the artboard's ("Accounts with charges this run" rather than "44 accounts due, 1
  suspended skipped").
- Below 1100px the side column stacks under the main column; the artboard is fixed at 1440.


## Billing run, Phase 5 additions

The artboard (P2-0) shows the resting screen only. The decision, posting, and rates states below reuse its values
(callout, card, pill, segmented control, dark card) and add only the form and drawer classes in the "Phase 5" block
of src/styles/index.css. No new colors: every value is a D3-0 token.

- Detail panel actions: Approve moves to the next undecided item. Edit opens an inline form in the Actions section
  (new base in dollars, required reason, a Proposed and After edit table with each fee by name, Confirm with the new
  total); after confirming, the amount shows the original total struck through beside the new one. Waive opens the
  five reasons as radio cards with one line of help each, the agent's suggested reason tagged "Haul-E suggests", an
  optional note, and "Waive $x.xx".
- Queue header: Bulk approve and Post invoices each open an inline confirmation bar under the card header (#F7F7FF,
  3px #312D97 left rule, radius 12). Post shows the invoice count, total, number range, and a scrollable list of
  accounts. Post uses the muted artboard look while blocked and the primary look once ready.
- Posted invoices card: between the queue and leakage in the main column, one row per invoice with a lock glyph,
  number, account, lines, due date, and total; a row expands to its locked lines. After advancing, earlier posted
  cycles stay reachable from a segmented control in the card header.
- Leakage card: title "Leakage, last 3 cycles" as on the artboard, with the waive window in the meta line, the three
  tabs working, and the per cycle figures under the Waived total.
- Rates drawer: 440px panel from the right over a #1A174F 28% backdrop, opened from the header Rates button. It holds
  the "Pricing publishes rates" callout, the published cat_res_96 versions (In effect and Local stand-in pills), and
  the publish form.
- After posting: the header pill reads Posted, the first two tiles become Invoices posted and Posted total, the dark
  card becomes "Posted", and the header gains a primary "Next cycle, Nov 1" button with Run cycle secondary.

Drift added in Phase 5: the artboard has no posted list, confirmation bars, forms, or drawer, so their layout is
this surface's own; they sit in the artboard's columns and do not move any artboard element.

## Payments tab (Phase 6)

The manager made the artboard. "Billing payments, Office" (Paper node XV-0) was created by the manager session,
not by a phase subagent, for the same reason as P2-0 (DECISIONS.md entry 23). Its layout is written in the
"Payments artboard" section of docs/paper-reference.md, and the Payments tab on /billing is built from that
section: the same nav with Billing active, header with eyebrow "Office · Billing run · Payments", title "Payments
and deposits", the artboard subtitle, and the Run | Payments segmented control on the right; four stat tiles
(Received this week, Applied with the #1F9D6B eyebrow, Unapplied cash with #F5A524, Processor fees with #C8382D);
the main column with the processor batch card (Gross, Fees in parentheses in #C8382D, Net deposited with a #1F9D6B
eyebrow, lanes Payment 130, Account 230, Invoice 150, Paid 110, Applied 110, Unapplied 110, footer over a #D3D1FF
rule, and the "Why the bank shows" callout) and the Oakridge check card (lanes Invoice 180, Period 200, Invoice total
130, Allocated 130, Remaining 130 in #1F9D6B at zero); the side column with the Unapplied cash list card (shadow only,
kind title, meta, mono 16px amount, primary Apply and secondary Leave on account, footnote) and the dark Allocation
rules card. The component is src/components/billing/PaymentsTab.tsx, the figures come from
src/store/paymentSelectors.ts, and the screen specific classes are the "Payments tab" block in src/styles/index.css.
No new colors: every value is a D3-0 token. The tab is store state (activeTab), so switching never reloads the page.

The artboard shows the resting screen only. The Apply form is this surface's own: it opens inside the unapplied row
on the #F7F7FF inset (radius 12), lists the payer's open invoices with an amount each (oldest filled first), shows
Applying and Stays unapplied totals over a #D3D1FF rule, and shows the engine's refusal in #C8382D on #FDE8E6. When the
payer has no open invoice it names the paid invoice and offers only Leave on account.

### Payments, compared with Paper XV-0 on 2026-09-10 (browser pane at 800px and the artboard at 1440px)

Matches: nav, header, segmented control, tile order, eyebrow tones and values (the seed lands on the artboard's own
$3,321.42 received, $3,241.12 applied, $80.30 unapplied, $41.20 fees), batch header figures and tones, batch lanes and
the #C8382D unapplied cell, the footer sums ($1,318.42, $1,303.12, $15.30), the callout title "Why the bank shows
$1,277.22", check card lanes with #1F9D6B zero remaining and "Check fully applied" in #1F9D6B, unapplied row titles
("Card overpayment", "Check, no invoice match"), the "Apply to INV-..." label when one invoice is open, the footnote,
and the dark Allocation rules card with its three sentences.

Drift, each deliberate:
- The batch table lists all 14 payments (the checklist requires 14 rows); the artboard shows four and "10 more rows".
- Names, invoice numbers, and amounts come from the seed (Alicia Brandt and INV-2026-0214, not Elena Ruiz and
  INV-2026-0203); the Oakridge August invoice is INV-2026-0210 in the seed where the artboard shows 0203.
- The check card title reads "Check: Oakridge Property Group" (the checklist wording) where the artboard uses a comma.
  Its subtitle says "check across 3 invoices" because Payment carries no memo field; the artboard shows a memo.
- Period reads "Jun 1 to Jun 30, 4 sites" where the artboard writes "June, 4 sites", matching the date style used
  on the run screen.
- The check footer spells out "Check $1,938.00 equals allocations" and adds the invoice total sum, and a note under
  the table explains many to many; the artboard footer has "Check fully applied" alone, which moved to that note.
- The batch footer adds "Equals gross" under Invoice; the callout adds a paragraph for pay_card_011's $12.00 short pay
  (an open balance, not unapplied cash) and two arithmetic lines.
- Batch rows carry a sub line when something needs a look: "Short $12.00, still open on invoice" in #C8382D and
  "Overpaid, see Unapplied cash".
- Tile captions are computed ("16 payments, Sep 4 to Sep 10") rather than the artboard's "2 checks, 14 card payments".
- The header adds a warning pill with the count of unapplied payments, as the run screen does for open decisions.
- The unapplied footnote adds "Account applies payments after merge." (the checklist requires it).
- Below 1100px the side column stacks under the main column; the artboard is fixed at 1440.

Screenshots: the resting Payments tab was screenshotted in the browser pane on port 5179 at 800px and compared with
the XV-0 screenshot above. The Apply states (no open invoice for pay_card_014 before October posts, the engine's
over-allocation refusal, pay_chk_unknown leaving $37.61 on INV-2026-0204, and pay_card_014's $15.30 applied to its
October invoice INV-2026-0237 after posting) were checked at 1440px through page text and the console, because the
browser pane was hidden and could not composite a screenshot at that point. Phase 7 saves the final screenshots.

## Final screenshots (Phase 7)

Saved at 1440 wide, full page, from the dev server on port 5179 after a clean `npm install`, captured with headless
Chrome over the DevTools protocol so they are repeatable. Each one sits next to the Paper artboard it was built from.

| Paper artboard | Screenshot | State |
|---|---|---|
| "Billing run, Office" (node P2-0) | [docs/screenshots/billing-run.png](docs/screenshots/billing-run.png) | Oct 1 cycle just after Run cycle: 43 / 31 / 12 / $692.79, 14 queue items, the Sunrise Bakery contamination selected, leakage $65.84 |
| "Billing run, Office" (node P2-0), posted state | [docs/screenshots/billing-run-posted.png](docs/screenshots/billing-run-posted.png) | After RUNBOOK.md steps 2 to 4: Maple waived as goodwill, every other item approved, 49 clean charges bulk approved, 43 invoices posted for $5,861.76 (INV-2026-0223 to INV-2026-0265), leakage $68.71 |
| "Billing payments, Office" (node XV-0) | [docs/screenshots/billing-payments.png](docs/screenshots/billing-payments.png) | Resting Payments tab: $3,321.42 received, $3,241.12 applied, $80.30 unapplied, $41.20 fees, batch_0908 with 14 rows, the Oakridge check |

The drift noted in the Phase 4 and Phase 6 logs above still holds; Phase 7 changed no layout.
