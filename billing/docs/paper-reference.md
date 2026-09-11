# Paper reference (read by the manager from the TrashLab Paper file, id 01M24VYMM89TECB7A4ZC0WYY57)

The Paper file changed during the build. It originally held two artboards, "Haul-E Dispatch - Agent Console" (node 1-0) and "TrashLab.com - Redesign" (68-0). It now holds one artboard, "Account view - Office" (node D3-0, 1440 wide, worldX 2320, worldY -450), built by the sibling account surface. Font families in the file: Manrope and IBM Plex Mono. The file has no design tokens defined.

New artboards for this surface should be placed to the right of D3-0: worldX 3840 (Billing run) and worldX 5360 (Payments), worldY -450, width 1440, height fit-content.

## Computed styles read from the dispatch console before it was removed
- Nav (2-0): flex, height 64px, paddingInline 40px, backgroundColor #312D97, borderBottom 1px solid #FFFFFF1A
- Page eyebrow (W-0): Manrope 11px 700, lineHeight 14px, letterSpacing 0.16em, uppercase, color #5149D7
- Page title (X-0): Manrope 28px 700, lineHeight 34px, letterSpacing -0.01em, color #1A174F

## Full inline-style JSX of the Account view artboard (D3-0)
The manager read the full inline-style JSX; the values below are exact copies from it:
- Page background #F7F7FF. Nav #312D97 with pill tabs (paddingBlock 8px, paddingInline 14px, radius 999px, text #F1F5F9CC Manrope 14px 500); active tab background #FFFFFF1F with a 7px dot #10D6E6 and white 600 text. Search field #FFFFFF1A with border #FFFFFF29, height 36px, radius 999px. Avatar 36px circle #818DF0 with #1A174F 13px 700 initials.
- Page header: paddingTop 32px, paddingInline 40px, paddingBottom 20px. Eyebrow as above. Title 28px. Subtitle Manrope 14px 500 #6260AF.
- Status pill: radius 999px, paddingBlock 5px, paddingInline 10px, 6px dot, Manrope 12px 700 #1A174F. Variants: past due bg #FDE8E6 dot #C8382D; warning bg #FFF4DF dot #F5A524; neutral bg #ECEBFF dot #818DF0; healthy dot #1F9D6B.
- Card: bg #FFFFFF, border 1px #D3D1FF, radius 16px, shadow "#D3D1FF66 0px 10px 15px -3px, #D3D1FF66 0px 4px 6px -4px", paddingBlock 18px to 22px, paddingInline 20px to 24px.
- Stat tile: eyebrow 11px 700 #5149D7 (or #C8382D for a negative state), value IBM Plex Mono 28px 600 lineHeight 32px #1A174F, caption Manrope 13px 500 #6260AF, gap 6px.
- Table: header row Manrope 12px 700 #6260AF with borderBottom 1px #D3D1FF and paddingBottom 8px; body rows paddingBlock 6px with borderTop 1px #ECEBFF; primary cell Manrope 14px 600 #1A174F; ids and numbers IBM Plex Mono 12px to 14px; money IBM Plex Mono 14px 600 right aligned.
- Callout ("Why $29.00"): bg #F7F7FF, borderLeft 3px #818DF0, radius 12px, paddingBlock 14px, paddingInline 16px, eyebrow 11px 700 #5149D7, body Manrope 14px lineHeight 21px #1A174F.
- Primary button: bg #312D97, radius 999px, height 40px, paddingInline 22px, text #FFFFFF Manrope 14px 600.
- Secondary button: bg #FFFFFF, border 2px #ECEBFF, radius 999px, height 40px (36px compact), paddingInline 20px, text #2F2A90 Manrope 14px 600.
- Side panel list card: bg #FFFFFF, radius 16px, shadow as card, header paddingTop 18px paddingBottom 14px paddingInline 20px with title Manrope 15px 700 #1A174F and right meta 12px 600 #6260AF; rows borderTop 1px #ECEBFF, paddingBlock 14px, paddingInline 20px, date column IBM Plex Mono 12px #6260AF width 44px, photo placeholder 48px square #D3D1FF radius 8px.
- Dark summary card: bg #312D97, radius 16px, padding 20px, title 15px 700 #FFFFFF, meta #FFFFFFB3 12px 600, big number IBM Plex Mono 40px 600 letterSpacing -0.02em #FFFFFF, line labels #D3D1FF 12px 600, line values IBM Plex Mono 12px 600 #FFFFFF, footnote #D3D1FF 12px 500.
- Column layout: main column 936px, side column 400px, gap 24px, paddingInline 40px, paddingBottom 32px, vertical gap 20px between cards, 16px between tiles.

## Billing run artboard (created by the manager, Paper node P2-0, "Billing run, Office")
Placed by Paper at worldX 2320, worldY 2012, 1440 wide, fit-content height (about 1350px). Layout, top to bottom:
- Nav (64px, #312D97) with Billing as the active pill tab (dot #10D6E6), search field, MR avatar.
- Page header: eyebrow "OFFICE · BILLING RUN", title "October 2026 cycle" with a warning pill "12 decisions open", subtitle "Cycle date Oct 1, 2026 · Monthly and quarterly in advance · Events through Sep 9 · Piedmont Disposal". Right side: secondary buttons Rates and Payments, primary button Run cycle.
- Four stat tiles in one row: Invoices to generate (43), Clean (31, eyebrow #1F9D6B), Need decisions (12, eyebrow #F5A524), Dollars at issue ($486.20 in #C8382D). The mock numbers are placeholders; the app computes them.
- Workspace: main column 936px, side column 400px, gap 24px.
  - Main: "Exception queue" card with header actions "Bulk approve 31 clean" (secondary) and "Post invoices" (disabled look: bg #ECEBFF, text #6260AF). Table lanes: Account 220px (name 14px 600 plus mono id line), Kind 150px (pill: warning tone for field events, danger tone for overage, neutral for service and rate change), Route 130px, Proposed 100px right aligned mono, Haul-E suggests 150px (action 13px 600 plus confidence 12px 500, "Review" in #C8382D), Status 90px (neutral pill). Selected row bg #ECEBFF radius 10px, other rows borderTop #ECEBFF, row padding 8px.
  - Main, below: "Leakage, last 3 cycles" card with a segmented control (By reason, By route, By account; active segment #312D97 with white text), a Waived total stat on the left (200px) and horizontal bars on the right (label 150px, bar 10px tall radius 999 on #ECEBFF track, value mono right aligned 70px).
  - Side: Detail panel card (no border, shadow only) with sections separated by 1px #ECEBFF: header (title 15px 700 plus mono date, subtitle), Amount (28px mono total plus base, fuel, tax lines), Evidence (96px photo placeholder #D3D1FF with file name, eyebrow, headline, quoted note), Policy (eyebrow plus 13px body), Customer context (three columns Tenure, Balance, Prior waives, values mono 14px 600, negative balance in #C8382D), Agent suggestion callout (bg #F7F7FF, borderLeft 3px #818DF0, eyebrow "HAUL-E SUGGESTS: ...", confidence pill, 14px/21px rationale, mono evidence chips on #ECEBFF, footnote "Agents draft. A person approves anything that moves money."), Actions row (primary "Approve $2.87", secondary Edit, secondary Waive).
  - Side, below: dark card "Ready to post" (#312D97) with 40px mono total, "31 clean invoices / 12 waiting on you", footnote "Posting is irreversible. Corrections after posting are credit memos."

## Payments artboard (created by the manager, Paper node XV-0, "Billing payments, Office")
Placed at worldX 3840, worldY 2012, 1440 wide, fit-content height (about 1180px). Same nav (Billing active). Layout:
- Page header: eyebrow "OFFICE · BILLING RUN · PAYMENTS", title "Payments and deposits", subtitle "One check across three invoices, one processor batch split 14 ways, and whatever did not match." Right side: a segmented control Run | Payments (active segment #312D97 white text, container white with 1px #ECEBFF border, radius 999px, 3px padding). In code this is the tab switch on /billing.
- Four stat tiles: Received this week, Applied (eyebrow #1F9D6B), Unapplied cash (eyebrow #F5A524), Processor fees (eyebrow #C8382D). Values computed from payments and allocations.
- Main column 936px:
  - "Processor batch batch_0908" card: header with subtitle "Deposited Sep 8 · 14 card payments · one line in the bank feed" and three right-aligned figures Gross (mono 18px 600), Fees in #C8382D shown in parentheses, Net deposited (eyebrow #1F9D6B). Table lanes: Payment 130px mono 12px #6260AF, Account 230px 14px 600, Invoice 150px mono 12px, Paid 110px right mono 14px 600, Applied 110px right mono, Unapplied 110px right mono (#6260AF when zero, #C8382D 600 when positive). Footer row with borderTop #D3D1FF: "14 payments", sums for Paid, Applied, Unapplied. Below the table a callout (bg #F7F7FF, borderLeft 3px #818DF0) "Why the bank shows $1,277.22" explaining gross less fees equals net and allocations plus unapplied equal gross.
  - "Check, Oakridge Property Group" card: subtitle "pay_chk_oakridge · received Sep 4 · memo ...", right figure Check amount. Table lanes: Invoice 180px mono 13px, Period 200px, Invoice total 130px right, Allocated 130px right 600, Remaining 130px right (#1F9D6B when zero). Footer "3 allocations", "Check fully applied" in #1F9D6B, allocated sum, remaining 0.
- Side column 400px:
  - "Unapplied cash" list card (shadow only): header with count, one row per payment with a positive remainder: title 14px 600, meta 13px #6260AF, amount mono 16px 600 right (flexShrink 0), then an action row with a primary "Apply" button (36px tall) and secondary "Leave on account". Footer note "Unapplied is the payment amount minus its allocations. Nothing here changes a balance until a person applies it."
  - Dark card "Allocation rules" (#312D97) with three 13px #D3D1FF sentences: many to many; a batch splits into gross, fees, per-invoice allocations and fees never touch an invoice; an allocation cannot exceed the invoice balance or the payment's unapplied amount.
