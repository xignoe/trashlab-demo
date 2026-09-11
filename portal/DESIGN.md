# Portal design notes

## Where the tokens came from

The Paper MCP was reachable at http://127.0.0.1:29979/mcp and `get_basic_info` returned the open file "Forgiving kale" with 0 artboards, 0 tokens, and no font families. There was nothing to extract, so per the contract's fallback the token set in `src/styles/tokens.css` is a neutral set written by the portal build. No artboard was read to derive them. Phase 6 will create the portal artboards in Paper and record any drift here.

Every token is a CSS custom property on `:root`. Tailwind 3 (`tailwind.config.js`) maps its color, font, size, radius, spacing, and shadow utilities onto those variables, so a screen can use either `bg-surface` or `var(--color-surface)` and get the same value. Component classes (`.tl-*`) at the bottom of tokens.css compose the patterns below.

## Token groups

| Group | Variables | Notes |
|---|---|---|
| Surfaces and ink | `--color-bg`, `--color-surface`, `--color-surface-2`, `--color-border`, `--color-border-strong`, `--color-ink`, `--color-ink-2`, `--color-ink-3` | Off-white page, white panels, three ink weights |
| Accent | `--color-accent`, `--color-accent-hover`, `--color-accent-ink`, `--color-accent-soft` | One deep green, used only for primary actions and focus |
| Status | `--color-ok`, `--color-warn`, `--color-danger`, `--color-info`, `--color-neutral`, each with a `-soft` background | Drives pills: active is ok, pastDue is danger, hold is warn, suspended is neutral, informational is info |
| Type scale | `--font-sans`, `--font-mono`, `--text-xs` 12 through `--text-2xl` 26, `--leading-*`, `--weight-*` | System font stack, 14px body |
| Spacing | `--space-1` 4 through `--space-8` 32 | 4px base |
| Radii | `--radius-sm` 4, `--radius-md` 8, `--radius-lg` 12, `--radius-pill` | |
| Elevation | `--shadow-panel`, `--shadow-drawer` | |
| Layout | `--topbar-height`, `--drawer-width`, `--content-max` | |

## Component patterns

| Pattern | Tokens | Class | Used for |
|---|---|---|---|
| Table | `--table-row-height`, `--table-cell-padding`, `--table-head-bg`, `--table-head-ink`, `--table-row-border`, `--table-row-hover` | `.tl-table`, `.num` for right-aligned money | Invoice list, invoice lines, payment history, open items |
| Side panel or drawer | `--drawer-width`, `--shadow-drawer` | `.tl-drawer` | "Why this charge" provenance, payment sheet |
| Status pill | `--pill-padding`, `--pill-font-size`, `--pill-weight`, `--pill-radius`, status colors | `.tl-pill`, `.tl-pill--ok`, `--warn`, `--danger`, `--info` | Account status, invoice status, event outcome, request status |
| Button | `--button-height`, `--button-padding`, `--button-radius`, `--button-font-size`, `--button-weight` | `.tl-button`, `--secondary`, `--ghost` | Pay now, Confirm, Cancel, links that act |
| Form field | `--field-height`, `--field-padding`, `--field-radius`, `--field-border`, `--field-focus-ring` | `.tl-field`, `.tl-label` | Request forms, payment amount, date pickers |
| Card | `--panel-padding`, `--panel-radius`, `--panel-border`, `--panel-bg` | `.tl-panel` (elevated), `.tl-card` (flat) | Overview summary blocks, handoff card, receipt |
| Money | `font-variant-numeric: tabular-nums` | `.tl-money` | Every cents value, formatted by one `money()` helper in Phase 3 |

## Canonical tokens (addendum F2, Phase 6)

The portal now takes its values from the canonical TrashLab tokens, which billing read from the Paper file (01M24VYMM89TECB7A4ZC0WYY57) with get_computed_styles. `../shared/tokens.css` is read only, so it is copied to `src/styles/tl-tokens.css` without its trailing `@theme` block: that block is Tailwind v4 syntax and the portal runs Tailwind 3, whose `tailwind.config.js` already maps utilities onto the portal names. `src/styles/tokens.css` imports the copy and keeps every portal variable name as an alias of a `--tl-` value, so no component or Tailwind class changed. Manrope and IBM Plex Mono load from Google Fonts in `index.html`, with the stack's system fallbacks behind them.

| Portal name | Canonical value | Note |
|---|---|---|
| `--color-bg`, `--color-surface`, `--color-surface-2` | `--tl-bg`, `--tl-surface`, `--tl-surface-muted` | |
| `--color-border`, `--color-border-strong` | `--tl-line-soft`, `--tl-line` | Paper has two line weights |
| `--color-ink`, `--color-ink-2`, `--color-ink-3` | `--tl-ink`, `--tl-ink-2`, `--tl-ink-3` | Paper has two ink levels; ink-3 equals ink-2 |
| `--color-accent`, `--color-accent-hover`, `--color-accent-ink`, `--color-accent-soft` | `--tl-brand`, `--tl-brand-deep`, `--tl-on-brand`, `--tl-line-soft` | The portal accent is the primary action color, which Paper calls brand |
| Status `--color-ok/warn/danger/info/neutral` and `-soft` | the matching `--tl-` status tokens | |
| `--font-sans`, `--font-mono` | `--tl-font-sans` (Manrope), `--tl-font-mono` (IBM Plex Mono) | |
| `--text-xs` through `--text-2xl` | `--tl-text-12`, `13`, `14`, `16`, `22`, `28` | Steps kept one to one |
| `--space-1` through `--space-8` | `--tl-space-1` through `--tl-space-8` | Same 4px steps |
| `--radius-sm/md/lg/pill` | `--tl-radius-sm/md/lg/pill` (8, 12, 16, pill) | Radii grow from 4/8/12 |
| `--shadow-panel` | `--tl-shadow-card` | Lavender card shadow |
| `--topbar-height`, `--drawer-width` | `--tl-nav-height` (64), `--tl-panel-width` (400) | |
| Button, field, table, pill, panel pattern variables | built from `--tl-` tokens | Buttons and pills become pill shaped; pill weight 700 |
| `--shadow-drawer`, `--content-max` | portal-local | Paper has no overlay drawer and its 1440 layout is the office view |

One class changed with the tokens: `.tl-pill` now follows the Paper status pill (ink text on a soft ground, status color carried by a 6px dot) instead of colored text, because `--tl-warn` (#F5A524) is too light to carry text.

## Drift

Redone by the manager on 2026-09-10 after drawing the portal artboards. The four artboards live in the TrashLab Paper file (not the empty "Forgiving kale" file), in a row below the office and pricing screens: "Portal, Overview (Maple)", "Portal, Billing with Why this charge", "Portal, Requests extra pickup", and "Portal, Oakridge site switcher". They use the canonical tokens and the office account view patterns, and their numbers match the running portal ($87.45 past due, $102.61 on the 96 gallon line, $28.62 extra pickup, quote_p0001 follow-up by Friday, Sep 11, 10:00 am).

Against those artboards, the running portal drifts in these ways:

| Area | Running portal | Portal artboards in Paper |
|---|---|---|
| Top bar | White bar with the hauler name and a "Customer portal" pill | Brand indigo nav (`--tl-brand`) with white text and a cyan active dot |
| Navigation | Left column of tabs | Tabs inside the top nav |
| Page width | 1120px single column (`--content-max`, portal-local) | 1440 page, 936 main column plus a 400 docked side panel |
| Drawers | "Why this charge" and the payment sheet overlay from the right | Side panel is docked in the layout, not an overlay |
| Headings | Page title 28px semibold | Page title 28px bold with -0.01em tracking, 11px uppercase eyebrow above |
| Summary cards | Four white stat cards on Overview | Paper pairs white stat tiles with one dark brand summary card (40px mono number) |

None of these are fixed in the portal build: the rule in shared/tokens.css is to adopt the tokens without restyling mid-phase. The merge, which owns the single stylesheet and the persona switcher, should close them against the artboards.
