# Customer portal runbook

The portal is the customer-facing surface for Piedmont Disposal. Every date is fixed at Thursday 2026-09-10 (`TODAY` in src/store/clock.ts), and every screen reads one in-memory store seeded from src/seed. A page reload resets everything to the seed.

## Start

```sh
npm install && npm run dev
```

The portal always runs on http://localhost:5175, its fixed port from the shared contract addendum. The dev script uses `--strictPort`, so if 5175 is busy it fails loudly instead of drifting to another port. Stop whatever holds 5175 and run it again. Other commands:

| Command | What it does |
|---|---|
| `npm run build` | Typecheck and production build |
| `npx vitest run` | Engine, store, request, and invariant tests |
| `node scripts/check_seed.mjs` | Seed referential and money checks |

## The two logins

Use the "Signed in as" select in the top bar. There is no password.

| Login | Account | What to expect |
|---|---|---|
| Dana Maple | acct_res_maple, one site (412 Maple Hollow Ln), Monday route, quarterly | Past due, $87.45 open on the Q3 invoice |
| Oakridge Property Management | acct_pm_oakridge, four sites with PO numbers, Wednesday route, net 30 | Active, one open September invoice; a site switcher appears above every screen |

The Overview footer shows the Invariants panel. All four checks should read pass before and after every scenario.

## Five minute walkthrough

Reload the page before starting so the store is back to seed.

### 1. Maple pays the past-due invoice and enrolls in autopay (about 1 minute)

1. Signed in as Dana Maple, open **Billing**.
2. On invoice inv_maple_2026q3 (past due, open $87.45) click **Pay now**. The sheet defaults to $87.45 and the saved Visa ending 4242. Confirm.
3. The receipt shows the payment id, $87.45, the card, and one allocation to inv_maple_2026q3.
4. In the Autopay panel turn autopay on. It reads "Autopay on: we charge your saved method on each due date".
5. Check: the invoice shows paid with open $0.00 and no Pay now button, the account pill reads active, and Payment history lists the new payment first; expand it to see the allocation.

### 2. Maple reports a missed pickup (about 1 minute)

1. Open **Requests**, pick **Missed pickup**. The date defaults to Monday 2026-09-07. Look it up.
2. The portal shows the driver note ("Cart blocked by a parked vehicle in the driveway"), R. Alvarez, and the blocked driveway photo, and explains no recovery is scheduled. No work order is created.
3. Change the date to 2026-08-24 and look it up. That stop was missed, so the portal books a recovery work order for Friday, Sep 11 and the open items list shows a scheduled missedPickup request with the work order id.

### 3. Maple requests an extra pickup (about 1 minute)

1. In **Requests**, pick **Extra pickup**. Three checks show pass: account status, route capacity on Monday, Sep 14, and an active service at the site.
2. The price stack shows base $25.00, fuel fee, tax, and the total.
3. Pay with the saved card. The confirmation names the extraPickup work order id and Monday, Sep 14.
4. Open items shows the extraPickup request as scheduled with the work order id and Monday, Sep 14.

### 4. Oakridge requests a quote for a second container (about 1 minute)

1. Switch "Signed in as" to Oakridge Property Management.
2. In the site switcher pick site 2 (100 Oakridge Commons, Bldg B, PO-OAK-1042).
3. Open **Requests**, pick **Request a quote**. The site defaults to site 2. Choose a size, material, and frequency, add access notes, and submit.
4. Open items shows the quote request as open with the quote id and "Priced by a person, we will send the quote by Friday, Sep 11, 10:00 am".

## Edge states worth a look

- Oakridge Billing groups the September invoice lines by site with each PO in the group header.
- "Why this charge" opens from any invoice line; the late fee line says it carries no fuel fee and no tax.
- A suspended account (acct_res_kerr) cannot book an extra pickup; the flow shows the handoff card. It is not in the login list; the store test `src/store/requests.test.ts` signs in as Kerr.
