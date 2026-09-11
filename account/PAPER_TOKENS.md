# Paper design context, extracted by the manager on 2026-09-10

Source: Paper file `01M24VYMM89TECB7A4ZC0WYY57` ("TrashLab, Haul-E Dispatch"), artboard "Haul-E Dispatch, Agent Console" (node `1-0`, 1440x900). Read with `get_computed_styles` and `get_jsx`; the file declares no design tokens, so these are the computed values from the artboard itself. The Phase 1 subagent hit a Paper quota and used the flow-map fallback; this file is the real reference and supersedes it.

## Colors (light mode, as drawn)

| Role | Hex | Where it appears |
| --- | --- | --- |
| Page ground | #F7F7FF | artboard background; also the "reasoning" inset block |
| Surface | #FFFFFF | approval cards, activity card, autopilot pill |
| Card border | #D3D1FF | approval card border, autopilot pill border |
| Card border, quiet | #ECEBFF | compact approval row border, secondary button border, icon tile background |
| Card shadow | #D3D1FF66 0px 10px 15px -3px, #D3D1FF66 0px 4px 6px -4px | approval cards, activity card |
| Brand navy | #312D97 | nav bar, primary button fill, route health card, icon strokes |
| Ink | #1A174F | headings, card titles, body text |
| Ink muted | #6260AF | subtitles, meta lines, tertiary "Skip" text |
| Eyebrow | #5149D7 | uppercase 11px labels ("Haul-E · Dispatch agent", "Why Haul-E suggests this") |
| Accent periwinkle | #818DF0 | reasoning block left rule, avatar fill, "adjusted" bar, dot field |
| Accent cyan | #10D6E6 | "on time" progress bar |
| Warn amber | #F5A524 | "Decide by 11:30" dot, "down" bar |
| Warn amber bg | #FFF4DF | "Decide by" pill background |
| Lavender text on navy | #D3D1FF | secondary text inside the navy card |
| Nav translucent | #FFFFFF1A border, #FFFFFF1F active tab, #FFFFFF29 search border | nav bar controls on navy |
| Secondary button ink | #2F2A90 | "Adjust" button label |

No red or green exists on the artboard. For past due (danger) and in sync (ok) states, derive from the same scene: danger #C8382D on #FDE8E6, ok #1F9D6B on #E3F6EE, keeping chroma near the amber pill. Record them as chosen in DESIGN.md.

## Type

One family: **Manrope** (system-ui, sans-serif fallback). Google Fonts has it. Weights used: 500 (meta), 600 (buttons, small labels), 700 (headings, eyebrows, pill text), 800 (the 44px big stat).

| Role | Size / line | Weight | Tracking | Color |
| --- | --- | --- | --- | --- |
| Page title | 28 / 34 | 700 | -0.01em | Ink |
| Big stat | 44 / 44 | 800 | -0.02em | white on navy |
| Card title | 16 / 22 | 700 | 0 | Ink |
| Card head label | 15 / 18 | 700 | 0 | Ink or white |
| Body | 14 / 21 | 400 | 0 | Ink |
| Meta and subtitle | 13 / 16 | 500 | 0 | Ink muted |
| Page subtitle | 14 / 18 | 500 | 0 | Ink muted |
| Button label | 14 / 18 | 600 | 0 | white, or #2F2A90 on secondary |
| Pill label | 12 / 16 | 700 | 0 | Ink |
| Small label | 12 / 16 | 600 | 0 | lavender on navy |
| Eyebrow | 11 / 14 | 700 | 0.16em, uppercase | Eyebrow |

Money and IDs are not shown on this artboard. Keep a mono stack for those (IBM Plex Mono or ui-monospace) and record it as a chosen addition.

## Shape and spacing

- Card radius 16px, inset block radius 12px, icon tile radius 12px, pills and buttons and search and avatar 999px.
- Card padding 22px block, 24px inline, internal gap 16px. Compact card 16 / 24 with gap 14. Card head 18 top, 14 bottom, 20 inline.
- Reasoning inset: 14 / 16 padding, 3px left rule in periwinkle, ground color, gap 6.
- Page: nav 64px tall, 40px inline padding; page header 36px top and 24px bottom; workspace gap 24px; main column 936px, side column 400px on a 1440 canvas.
- Buttons 40px tall: primary navy fill, 22px inline padding; secondary white with 2px #ECEBFF border, 20px inline padding; tertiary text only, 12px inline padding.
- Status pill: 5px block, 10px inline padding, 6px dot, 6px gap, 12px 700 label.
- Progress bars 8px tall, pill radius, track #FFFFFF1F on navy.
- Nav: navy bar with white wordmark, pill tabs (active tab #FFFFFF1F), pill search 240x36, bell 36, avatar 36 periwinkle.

## How to apply

Map these onto the existing token names in `src/styles/tokens.css` so component code keeps working: `--bg` = #F7F7FF, `--surface` = #FFFFFF, `--surface-2` = #ECEBFF, `--surface-3` = #F7F7FF, `--ink` = #1A174F, `--ink-2` = #6260AF, `--ink-3` = #8B89C4 (a lighter step of ink muted, chosen), `--line` = #D3D1FF, `--line-quiet` = #ECEBFF, `--accent` = #312D97, `--accent-ink` = #2F2A90, `--accent-2` = #818DF0, `--eyebrow` = #5149D7, `--warn` = #F5A524, `--warn-bg` = #FFF4DF, `--info` = #10D6E6, `--code-bg` = #ECEBFF. Fonts: `--font-heading` and `--font-body` = Manrope, `--font-mono` = IBM Plex Mono. Radii: `--radius-sm` 8px (fields), `--radius-md` 12px (insets), `--radius-lg` 16px (cards), `--radius-pill` 999px. Shadow `--shadow-card` as above.

Dark mode: the artboard is light only. Derive dark values from the same scene (navy ground #14123A, surface #1E1B4F, line #3A368A, ink #EEEDFF, ink muted #B4B2E6) and say in DESIGN.md that they are derived, not read from Paper.
