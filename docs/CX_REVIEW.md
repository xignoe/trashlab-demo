# Customer experience review, Sep 11, 2026

Final review of the merged app, customer experience first. Every screen was walked in the browser as a customer, then as the office and the owner, at Piedmont Disposal and Waste Industries, on desktop and at phone width. Four code-reading passes backed the walkthrough. Typecheck clean, 726 of 726 tests pass. Other sessions were editing the repo during the review, so re-walk the customer path after the current batch lands.

Findings are ordered by how much they cost the customer. File references are under src/.

## High

1. **A reload signs the customer out and breaks every link the app hands them.** State is memory only. The held status page's "view this status again any time" URL shows "We could not find that request" on a fresh load; a reload mid-checkout lands on "Pick an address first"; a Waste Industries customer who refreshes becomes Ruth Maple at Piedmont. Persist db, tenant session, and storefront ui to localStorage; Reset seed is the escape hatch. `store/useStore.ts`, `surfaces/storefront/ui/HeldStatus.tsx`.
2. **Customers see the developer Invariants panel.** Every portal Overview ends with "Invariants, 4 of 4 pass" and allocation ids; at Waste Industries it says "2 failing" and lists Piedmont's waived charge ids. Remove it from the customer surface. `surfaces/portal/screens/Overview.tsx:277`.
3. **The portal's "Signed in as" menu opens other customers' accounts.** Hard-coded Piedmont ids; at other haulers they render as raw ids and throw when picked. Show the session's own name and a sign-out link. `surfaces/portal/components/TopBar.tsx:9-52`.
4. **Internal ids and enum values in customer copy.** Success page (acct_sf_0002, site_sf_0005, wo_sf_0008, pay_sf_0003), "Request quote_sf_0001 received", "Quote quote_sf_0002", "route route_mon_res", CNT_WI_REYES_0_0, tok_seed_maple, pay_p0001, req_p0001, evt_maple_missed_0817, pills extraBags / scheduled / settled / perJob. Add one customer-facing formatter per entity and a label map per enum. `storefront/ui/Success.tsx:49-78`, `Commercial.tsx:48`, `HeldStatus.tsx:68`, `portal/screens/Overview.tsx:119,252`, `portal/screens/billing/*`.
5. **Every storefront outcome ends with "Start over."** No link into the portal after paying, no receipt to keep, the new account cannot sign in, the unserved screen shows no phone or service area, no footer. Add "Open your account" that signs the session in as the new account; render tenant phone, service area, and promo. `storefront/ui/Success.tsx:95`, `NotServed.tsx`, `Commercial.tsx:99`, `index.tsx`, `tenants/types.ts`.
6. **The portal does not fit a phone.** At 375px the stat tiles stay in four columns, the rail stays open, the document is 790px (Overview) and 987px (Billing) wide. Stack tiles, collapse the rail, wrap tables in overflow containers. `portal/screens/Overview.tsx`, `Billing.tsx`, `portal/index.tsx`.
7. **Looking at a request can file it, and nothing can be cancelled.** HandoffCard creates an open Request in a mount effect; there is no withdraw action. File only on an explicit button; add Cancel request. `portal/components/HandoffCard.tsx:29-41`, `portal/screens/requests/OpenItems.tsx`.
8. **Paying has no failure path, clamps silently, and offers nothing to keep.** 500 becomes 87.45 on blur with no message; every payment settles; no pay-full-balance; "A PDF invoice with a pay link" is promised but not produced. `portal/screens/billing/PaymentSheet.tsx:57-68,127-129`, `DeliveryPanel.tsx:16`.
9. **Portal and office disagree on the next invoice.** Ruth Maple Oct to Dec: portal $180.74 over 3 lines, office $183.61 over 4 (the Sep 7 extra-bags event). Use the office preview in the portal and label the event "Adds $X to your next bill." `portal/screens/Overview.tsx:45-77`, `account/selectors.ts:454-457`.

## Medium

10. **Hauler jargon.** "Open market zone", "Boundary zone", "Open market, Union and Essex zone", "Posted and locked, corrections arrive as credit memos", Pass / Fail check rows, "1 open invoice(s)", "Next due date you must pay manually: Jul 16, 2026" when that date is past. `storefront/ui/Offer.tsx:63`, `portal/screens/billing/InvoiceDetail.tsx`, `requests/CheckRows.tsx:25`, `Billing.tsx:54-61`.
11. **Form errors one at a time, far from the field.** No aria-invalid, no focus move; empty address submit does nothing; business form has noValidate so past start dates pass; boundary and business submits have no busy state, so a double click files twice. `storefront/ui/ContactFields.tsx:8-12`, `Checkout.tsx:112,129`, `Landing.tsx:55-59`, `Commercial.tsx:259,336,356`, `BoundaryIntake.tsx:117`.
12. **Business customers get no price at all**, even for front-load sizes the ratebook prices, and the address is a free text box with no serviceability check. `storefront/ui/Commercial.tsx`, `lib/ui.ts:115-116`.
13. **Copy promises emails and texts the system never sends**, and office approvals, declines, and credits reach no customer channel. `storefront/ui/Success.tsx:38-40`, `Checkout.tsx:81,94`, `Office.tsx:440-444`, `account/components/CreditDrawer.tsx:164`.
14. **Franchise copy is residential only** and points the customer to the city for a phone number. `storefront/ui/Franchise.tsx:24-32`.
15. **Accessibility.** Cart radios named cat_res_96; add-on switches unnamed and their label click does nothing; ten request-type radios unnamed; autopay checkbox named "on"; drawers set aria-modal without focus management; invoice rows click only; persona bar counts aria-hidden. `storefront/ui/components.tsx:249-264`, `portal/screens/Requests.tsx:63-86`, `portal/components/Drawer.tsx`, `account/components/Drawer.tsx`, `pricing/components/form.tsx`, `shell/PersonaBar.tsx:38`.
16. **Wrong next-invoice date for per-job customers** in the empty state and autopay panel. `portal/screens/Billing.tsx:76-79`, `billing/AutopayPanel.tsx:61`, `store/cycles.ts:324`.
17. **The storefront agent drawer has no trigger.** `storefront/ui/TopBar.tsx:9`, `index.tsx:14-22`.
18. **A customer login can open Owner and Office.** Hide those tabs when the session role is customer. `shell/PersonaBar.tsx`, `shell/routes.ts`.
19. **Requests have no history or detail**: raw engine notes, "before today" created dates, no reply or comment. `portal/screens/requests/OpenItems.tsx:33,74`.

## Low (office and owner)

20. Approvals rows titled by quote id; result is an id dump with no link to the new account; the approved card re-sorts to the bottom. `storefront/ui/Office.tsx:275,371-390,432`.
21. No customer phone, email, or notes on the account view. `types.ts:22-26`, `account/components/AccountHeader.tsx:21-28`.
22. Payments page hard-wired to Piedmont's seed; other haulers see "Not in the seed." `billing/components/PaymentsTab.tsx:51,59-60,135`, `store/paymentSelectors.ts:18`.
23. Roll-off edits go live with no preview, draft, or undo; duplicate "New from" badge; same-day re-edit of a not-taken cell is refused. `store/slices/pricing.ts:493-518`, `pricing/sections/RolloffSection.tsx:296,305`, `RolloffForms.tsx:125`.
24. Rate version ids in the Changes column, "computeCharge ... zone_open" as a worked-example label, the word "placeholder" in the agent panel. `pricing/components/RateSheet.tsx`, `WorkedExample.tsx:52-55`, `AgentPanel.tsx:183,284`.

## What already works well

Address typeahead with keyboard support and a live price with due today, per quarter, and monthly equivalent. The boundary path with a 72 hour hold and a status page that flips to Approved. The franchise hand-off steps. Missed pickup with the driver's note and a booked recovery. The office accounts table, Add account drawer, and cycle run. Tenant configuration flowing through storefront and office without code changes.

## Suggested order

Persist the store; remove the invariants panel and account switcher from the portal; add id formatters and a portal link on success and status pages; then the portal phone layout. The rest is copy and validation polish, surface by surface.
