# DESIGN.md: merged app

How five differently styled prototypes share one Tailwind 4 build without renaming a single className. This file
documents the theme bridge (CHECKLIST.md box 1.7, DECISIONS.md entries 3 and 11 to 16). Each prototype's own
DESIGN.md still describes its screens; this file covers only how their styles coexist at the repo root.

## Files and load order

`src/index.css` is the only stylesheet entry. It imports, in order:

| File | What it holds |
|---|---|
| `tailwindcss` with `source(".")` | Tailwind 4. `source(".")` is relative to src/index.css, so Tailwind scans `src/` and nothing else. The five prototype folders at the repo root never add a class to this build |
| `src/styles/tokens.css` | shared/tokens.css byte for byte: the Paper tokens as `--tl-*` on `:root`, plus a small `@theme` block of its own |
| `src/styles/theme.css` | The bridge: one `@theme inline` block and one `:root` block of defaults |
| `src/styles/shell.css` | The persona bar and page shell. Uses `--tl-*` directly; it is the one piece of UI outside every surface wrapper |
| `src/styles/surfaces/<name>.css` | One file per surface. Everything in it is nested under `.surface-<name>` |

## How the bridge works

Four layers, from the build down to the surface.

1. **Tailwind names become runtime variables.** `theme.css` declares every Tailwind theme name any prototype used as
   `--<namespace>-<name>: var(--rt-<namespace>-<name>)`, for example `--color-accent: var(--rt-color-accent)`.
2. **`inline` puts the variable in the utility itself.** Because the block is `@theme inline`, Tailwind compiles the
   utility to the `--rt-*` reference instead of to a `:root` value:
   `.bg-accent { background-color: var(--rt-color-accent) }`,
   `.text-display { font-size: var(--rt-text-display); line-height: var(--tw-leading, var(--rt-text-display--line-height)); letter-spacing: var(--tw-tracking, var(--rt-text-display--letter-spacing)) }`.
3. **`:root` gives every `--rt-*` a default** (the second block in theme.css), so a utility outside any filled
   wrapper still renders something sensible. The rules for the defaults:
   - Names Tailwind ships (`white`, `gray-*`, `text-xs` to `text-3xl`, bare `rounded` and `rounded-xs` to `rounded-xl`,
     spacing `1` to `12`) default to Tailwind's own value, which is what a prototype got when it did not define the name.
   - Custom names default to the Paper token from tokens.css (addendum F1): `--rt-color-accent: var(--tl-brand)`.
   - Fonts default to the Paper faces (Manrope, IBM Plex Mono), which all five prototypes used.
4. **Each surface overrides the defaults on its wrapper.** `src/styles/surfaces/<name>.css` sets `--rt-*` inside
   `.surface-<name> { }`. Custom properties inherit, so every utility inside that subtree reads the surface's value.
   The same class therefore means different things in different places: `text-sm` can be 13px in the account view
   and 14px in the portal, and `bg-accent` can be Paper indigo in billing and trashlab.com indigo in the storefront.

Each surface's default export mounts inside its wrapper (`<div className="surface-billing">`), and
`src/shell/routes.test.tsx` asserts the wrapper class for every route.

### How the prototypes' config keys map to Tailwind 4 namespaces

| Prototype key (v3 config or v4 @theme) | Namespace in theme.css | Utility example |
|---|---|---|
| colors | `--color-<name>` | `bg-ink-2`, `text-on-brand-85`, `border-line` |
| fontSize (with line height, letter spacing) | `--text-<name>`, `--text-<name>--line-height`, `--text-<name>--letter-spacing` | `text-display` |
| fontFamily | `--font-<name>` | `font-mono` |
| borderRadius (DEFAULT is bare `--radius`) | `--radius`, `--radius-<name>` | `rounded`, `rounded-pill` |
| spacing | `--spacing-<name>` | `p-4`, `h-header`, `gap-button` |
| boxShadow | `--shadow-<name>` | `shadow-drawer` |
| maxWidth | `--container-<name>` | `max-w-page` |

### What is outside the bridge

- Tailwind's static utilities keep Tailwind's values everywhere: `rounded-none`, `rounded-full`, `bg-transparent`,
  `text-current`, and numeric spacing steps nobody named (`gap-7` is `calc(var(--spacing) * 7)`).
- Tailwind names no prototype used keep Tailwind's defaults. Account and storefront could not use them (account reset
  `--color-*`; storefront replaced `colors` wholesale), so this only matters for portal and pricing, which extended.
- tokens.css has its own `@theme` block. It is not inline and not scoped, and it changes `leading-tight` and
  `tracking-tight` app wide (1.15 and -0.01em). A surface that relied on Tailwind's defaults for those two sets them
  back inside its wrapper.

## Where each surface's values come from

| Surface | Wrapper | File | Source of its `--rt-*` values | State |
|---|---|---|---|---|
| billing | `.surface-billing` | surfaces/billing.css | billing/src/styles/tokens.css, which is shared/tokens.css. Billing used no Tailwind utilities, so every name is set to its Paper counterpart; billing/DESIGN.md maps each pattern class to its Paper artboard | Filled (Phase 1) |
| account | `.surface-account` | surfaces/account.css | account/src/styles/tokens.css and the `@theme inline` block in account/src/index.css | Filled (Phase 2, box 2A.4). Light only; the prototype's dark mode was not ported (src/surfaces/account/PORT_DECISIONS.md) |
| pricing | `.surface-pricing` | surfaces/pricing.css | pricing/src/styles/tokens.css and the `@theme inline` block in pricing/src/index.css. Rename the color token `--tl-border` to `--tl-border-color` (addendum K5) | Header only, box 2B.4 |
| portal | `.surface-portal` | surfaces/portal.css | portal/src/styles/tokens.css, portal/src/styles/tl-tokens.css, portal/tailwind.config.js | Filled (Phase 2, box 2C.4). Text sizes carry line height 1.5, restored Tailwind 3 button cursor and placeholder color (src/surfaces/portal/PORT_DECISIONS.md) |
| storefront | `.surface-storefront` | surfaces/storefront.css | storefront/src/styles/tokens.css, storefront/tailwind.config.cjs, storefront/docs/trashlab-design-language.md (trashlab.com values, addendum M) | Header only, box 2D.4 |

### The names each prototype uses

A port sets at least these names inside its wrapper. Names it does not list keep the `:root` default.

- **account**
  - color: bg, surface, surface-2, surface-3, ink, ink-2, ink-3, line, line-quiet, accent, accent-ink, accent-2, eyebrow, code-bg, gap-bg, on-accent, on-accent-2, on-accent-line, on-accent-active, on-accent-border, ok, ok-bg, warn, warn-bg, danger, danger-bg, info, info-bg, hold, hold-bg, white
  - font: heading, body, sans, mono
  - radius: xs, sm, md, lg, pill
  - shadow: card, drawer
  - text, each with its line height: 2xs, xs, sm, base, md, lg, xl, 2xl, 3xl
- **pricing**
  - color: bg, surface, surface-muted, line, ink, muted, accent, accent-soft, accent-strong, success, success-soft, warning, warning-soft, danger, danger-soft, info
  - font: sans, mono
  - text: display, h1, h2, body, small, mono, eyebrow
  - radius: sm, md, card, pill
  - shadow: card, raised
- **portal**
  - color: bg, surface, surface-2, border, ink, ink-2, ink-3, accent, accent-ink, accent-soft, ok, ok-soft, warn, warn-soft, danger, danger-soft, info, info-soft
  - font: sans, mono
  - text: xs, sm, base, lg, xl, 2xl
  - radius: sm, md, lg, pill
  - spacing: 1 to 6, 8
  - shadow: panel, drawer
- **storefront**
  - color: white, gray-50, gray-100, gray-200, gray-400, gray-600, gray-900, accent, accent-strong, accent-soft, brand, brand-deep, cyan, lavender, hairline-on-brand, on-brand, on-brand-85, on-brand-80, on-brand-25, on-brand-18, on-brand-12, success, success-soft, warning, warning-soft, danger, danger-soft, bg, surface, ink, ink-muted, line
  - font: sans
  - text, each with its line height: display (with letter spacing), title, stat, heading, eyebrow, lede, body, row, label, small
  - radius: bare `--rt-radius` (its DEFAULT, which the prototype set to its radius-sm), sm, md, lg, xl, pill
  - spacing: 1 to 6, 8, 12, header, button, button-compact
  - container: page
- **billing:** all of them (theme.test.ts requires it).

Line heights: portal's six sizes, and pricing's `eyebrow` and `mono`, carried no line height in the prototype, so they
inherited it from the parent. In the bridge every size sets a line height, so set those `--text-*--line-height`
values to the line height the text inherited in the prototype (usually the body's).

Tailwind 3 prototypes: portal and storefront were built on Tailwind 3. In Tailwind 4, `shadow-sm` became
`shadow-xs`, `outline-none` became `outline-hidden`, bare `ring` went from 3px to 1px, and bare `border` now uses
`currentColor` instead of gray-200. Check those utilities when comparing the port to the prototype at 1440.

## Rules for Phase 2 ports

1. **Never add a name to theme.css.** The bridge is the union of all five prototypes and is complete. If a port needs a
   name that is not there, write the request in DECISIONS.md under "Requests from <name> port" and use a
   wrapper-scoped custom property in the meantime. theme.test.ts fails if a surface sets an `--rt-*` name the bridge
   does not declare.
2. **Set `--rt-*` only inside `.surface-<name>`**, in `src/styles/surfaces/<name>.css`. Never on `:root`, `html`, or
   `body`; the test checks this too.
3. **Nest every pattern class under the wrapper.** Portal and billing both define `.tl-card`, `.tl-pill`,
   `.tl-table`, `.tl-drawer`, and `.tl-money` with different rules. Scoping is what keeps them apart.
4. **Put the ground on the wrapper.** The font family, size, color, and background a prototype set on `body` go on
   `.surface-<name>` itself (billing.css part 2 is the model).
5. **Copy the prototype's own custom properties into the wrapper**, not onto `:root`, so a surface's `--accent` or
   `--tl-border` never reaches another surface.
6. **Compare at 1440** against the running prototype. The bridge changes where values live, never the values.

## Verifying the bridge

- `src/styles/theme.test.ts` checks four things:
  - every `@theme` entry points at the `--rt-*` of the same name
  - every `--rt-*` has a `:root` default and nothing extra
  - billing sets every name
  - each surface file sets only declared names, only inside its wrapper
- The production CSS (`npm run build`, `dist/assets/*.css`) should contain a bridged utility only when a file under
  `src/` uses it.
