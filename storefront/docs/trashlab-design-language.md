# TrashLab design language (read from trashlab.com)

Source: the live site at https://trashlab.com, read on 2026-09-10 at a 1440px viewport with getComputedStyle on the rendered DOM. The site is built with Tailwind, so the class names are quoted next to the computed values. This file is the only place a code agent should take these values from; the manager session made every Paper call.

## Type

| Role | Family | Size / line height | Weight | Color | Site class |
|---|---|---|---|---|---|
| Hero and section headline | Manrope | 48 / 60 (30 / 37.5 under 640px) | 700 | #FFFFFF on indigo, #1A174F on light | `text-3xl sm:text-4xl lg:text-5xl font-bold leading-tight` |
| Card title | Manrope | 24 / 32 (20 / 28 on phones) | 700 | slate-900 #0F172A | `text-xl sm:text-2xl font-bold text-slate-900` |
| Eyebrow | Manrope | 18 / 27 | 500 | cyan #10A6CC, with a small sparkle mark | `text-[18px] font-medium text-[#10A6CC]` |
| Body | Manrope | 16 / 24 | 400 | white on indigo, ink on light | |
| Small body | Manrope | 14 / 22.75 | 400 | | |
| Nav link | Manrope | 14 / 20 | 600 | white at 80% on indigo | |

Tracking is normal everywhere. The page never uses a second family for UI.

## Color

| Token idea | Value | Where the site uses it |
|---|---|---|
| brand | #312D97 | hero band, closing call-to-action band, primary pill on light sections |
| brand text on white pill | #2F2A90 | text of the white "Get started" pill on indigo |
| brand deep | #201A69 | footer, text of "Get a demo" pill |
| ink | #1A174F | headlines on light sections |
| ink 2 | #6260AF | 2px border on stat cards that sit on indigo; muted text |
| lavender | #818DF0 | icons, the most used accent after white |
| cyan | #10A6CC | eyebrow text and logo accent only |
| light section | #F6F7FB | every other section ground |
| lavender tints | #F7F7FF, #ECEBFF, #E0DEFF | soft fills and chips |
| card border | #E2E8F0 | 1px border on white cards (slate-200) |
| amber | #F5A524 | ratings and warm highlights |

## Layout

- Sections alternate: indigo #312D97, light #F6F7FB, white, with 96px vertical padding (64px on the final call-to-action band). The footer is #201A69.
- Content sits in a centered container, max width 1200px.
- The header sits on the indigo band: white logo, white nav text, a phone link, and a white pill "Get started".

## Components

- **Pill button, primary on light:** bg #312D97, white text, 16px semibold, padding 12px 28px, height about 50px, radius 9999px.
- **Pill button on indigo:** bg white, text #2F2A90, same size. A 44px compact version uses 14px semibold text and 20px side padding.
- **Ghost pill on indigo:** transparent with a 1px white border at 15% opacity.
- **White card:** bg white, 1px #E2E8F0 border, radius 16px, padding 24px. Testimonial cards add a large soft shadow.
- **Feature panel:** white, 1px #E2E8F0 border, radius 32px, padding 40px.
- **Stat card on indigo:** bg #312D97, 2px #6260AF border, radius 16px, padding 20px 24px, white text.
- **Eyebrow:** cyan sparkle icon plus cyan 18px medium text, sitting above a 48px headline.

## How the storefront applies it

- The landing screen becomes an indigo hero band: cyan eyebrow, 48px white headline, the required copy in white, and the address entry in a white card with an indigo pill button.
- Every button becomes a pill. Inputs keep an 8px radius, since the site shows no inputs to copy.
- Screens below the header use the #F6F7FB ground with white 16px cards bordered in #E2E8F0.
- Headlines use 48/60 on desktop and 30/37.5 on phones.
- Cyan is only for the eyebrow. Status colors (success, warning, danger) stay as in shared/tokens.css.

## Paper artboards that carry this language

File "TrashLab Storefront", fileId 01M26F99HT7HE6DJN4SE0FBQ89. Drawn by the manager session; code agents do not call Paper.

- "Landing, trashlab.com language" (ER-0): 80px indigo header inside the indigo band (white logo tile with a cyan square, white name, 14px semibold white-80% nav text, ghost pill "Agent view"), 80px gap, cyan sparkle eyebrow "Residential trash pickup", 48/60 bold white headline 720px wide, 18/28 white-85% copy 600px wide, then a 640px white pill address field (map pin icon, input text, indigo 50px pill button "Check my address" inset 8px). The band ends 88px below the field. Below it on #F6F7FB: three white cards, 16px radius, 1px #E2E8F0, 24px padding, a 40px lavender-tint icon tile, 24/32 bold title, 16/24 muted body.
- Landing proof card copy in ER-0, exactly (title, then body):
  1. "Complete price" / "Delivery, fuel, the environmental fee, and tax shown before you pay."
  2. "Start next week" / "Pick one of your route's next two pickup days. The cart arrives the day before."
  3. "No phone call" / "Finish online in about two minutes, any time of day."
  Each card's icon tile is a 40px square, 12px radius, filled with --color-gray-100 (#ECEBFF), holding a 14px lavender (#818DF0) dot. No other icon art.
- "Offer, trashlab.com language" (ES-0): the same header as a standalone 80px indigo bar, then a 1200px two-column section with 64px top padding. Left: cyan eyebrow "Address confirmed", 40/50 bold ink headline, 16/24 muted line, 14px semibold section labels, radio cards with 16px radius (selected: 2px brand border on #ECEBFF), add-ons as one white 16px-radius list with 1px dividers and 40x24 pill switches, and an indigo 50px pill "Continue to checkout". Right: a 440px white price card with a 32px radius and 32px padding, lines at 15/22, and "Due today" as an indigo stat block (2px #6260AF border, 16px radius, 20px 24px padding, 14px white-80% label, 40/48 bold white amount, 14px white-80% recurring line).
