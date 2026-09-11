# Haulers, sign-in, and the three onboarding workflows

TrashLab now runs as one build serving several haulers. This file says how a hauler is modeled, how you sign in as
one, what each of the three onboarding workflows does, and what is not built yet.

Source of the three New Jersey haulers: their live sites, read 2026-09-11. Piedmont Disposal is the original seeded
demo hauler and is unchanged.

## How a hauler is modeled

A tenant is not a column on every row. The store already holds the entire world in one `Db` (`src/store/db.ts`), so a
hauler **is** a `Db`. Signing in swaps it. Nothing in the engine, the selectors, or any screen knows there is more
than one hauler, and there is no `haulerId` anywhere to forget to filter on.

| File | What |
|---|---|
| `src/tenants/types.ts` | `TenantConfig` (what makes a hauler) and `TenantSession` (who is signed in) |
| `src/tenants/build.ts` | `buildTenantDb(config)`: turns a configuration into a whole `Db` |
| `src/tenants/wasteIndustries.ts`, `omniWaste.ts`, `directWaste.ts` | The three haulers, as configuration |
| `src/tenants/index.ts` | The registry, plus Piedmont Disposal's hand-written profile |
| `src/shell/SignIn.tsx` | `/login`: pick a hauler, then a seat |

A hauler configuration carries its lines of business, zones, routes, the container sizes it stocks, what it charges,
its tax and fuel and environmental numbers, the addresses its storefront recognises, and the customers already on its
books. Everything else is derived.

Ids that surfaces match on are the same in every hauler on purpose (`zone_open`, `zone_notserved`, `cat_res_96`,
`cat_ro_20yd`). A hauler varies the **name, size label, description, the price, and whether a size is stocked at
all**, never the id. Waste Industries, for example, sells its smallest box as one "10-15 cubic yard" class with the
sheet's dimensions and capacity in the description, on the shared `cat_ro_10yd` id. The storefront's commercial form
shows that description under the size picker, so a buyer sees the hauler's own words for the box they chose. The
storefront's address matcher looks up `zone_notserved` by id, and its commercial form lists sizes from a fixed table,
so a size a hauler does not stock is simply absent from its catalog and the form filters it out.

## The four haulers

| Hauler | Lines | Notable |
|---|---|---|
| Piedmont Disposal | Residential, Commercial, Roll-off | The seeded demo. Full billing history, the seven scenarios, 45 accounts |
| Waste Industries | Residential, Commercial, Roll-off | Full service. 6.625% NJ tax, Newark municipal franchise zone. Roll-off classes (10-15, 20, 30, 40 yd, with dimensions) from its real spec sheet |
| Omni Waste Services | Commercial, Roll-off | **No residential.** 8.875% NY metro tax, NYC commercial waste zone |
| Direct Waste Services | Residential, Commercial, Roll-off | Roll-off led. 10, 20, 30 yd only. No 40 yd, no compactor |

The three New Jersey haulers start with their rate card, routes, and existing customers, but **no invoices, charges,
or payments**. They are new to TrashLab, so the first bill run is one you watch happen. Piedmont keeps its history.

## Signing in

`/login` is the front door. There are no passwords: a seat is a demo identity, the way the persona bar is a demo
persona.

- **A customer** opens that customer's portal.
- **Owner** opens the ratebook, **Office** opens accounts and the approvals queue.
- **Onboard a new customer** opens the storefront at the right starting screen for that line of business.

The signed-in hauler is kept in `sessionStorage` so a reload comes back to the same company. Only the seat is kept,
never the hauler's data, so a reload still starts that hauler's world fresh. This is deliberate: every other piece of
demo state is in memory, but silently landing a reload in a different company's data is the one failure a build
serving several haulers cannot have.

## The three onboarding workflows

The product has two shapes of onboarding, not three.

### Residential: self-serve, priced and paid on the spot

Storefront landing, address, offer, checkout, done. The engine prices a complete offer from the address alone, the
card is authorized, and the account exists at the end of the flow with its first cycle charged.

Worked example, Waste Industries, 204 Bayway Ave, Elizabeth NJ:

| | |
|---|---|
| 96 gal cart, weekly | $34.00/mo |
| Service, 3 months | $102.00 |
| One-time cart delivery | $25.00 |
| Fuel surcharge, 7% | $7.14 |
| Environmental fee, $1.50/mo | $4.50 |
| Estimated tax, 6.625% | $8.89 |
| **Due today** | **$147.53** |
| Then every quarter | $120.87 |

Every figure comes from that hauler's own configuration. The same address at Direct Waste prices differently because
its rate card, fuel percent, and environmental fee differ.

### Commercial and roll-off: requested, priced by a person, then accepted

The same path serves both; they differ only in the container and how it is billed.

1. The buyer sends a request from the storefront. This writes a draft `commercialRequest` Quote and nothing else. **No
   price is shown to a business buyer** (Kevin's ruling, addendum N) and nothing is charged.
2. The office opens `/office/approvals`, sees the rate card beside each line, writes a price per container, and sends
   it.
3. The customer's answer is recorded. On accept, the account, site, service lines, containers, and delivery work
   orders are created, and the written price goes on the account's contract so billing charges what was quoted.

Choosing **One-time project** narrows the container list to roll-off boxes and drops the compactor, which is the only
place the two lines visibly diverge in the form.

## What a hauler that does not sell a line does

Omni Waste sells no residential service. The storefront does not offer the residential side at all: the
Residential/Business switch is replaced with "Business and job sites", and its sign-in card offers no homeowner login.
Nothing throws, and no cart can be priced, because Omni stocks no cart, publishes no cart rate, and runs no
residential route.

## Tests

| File | Covers |
|---|---|
| `src/tenants/tenants.test.ts` | Every hauler's world hangs together: rates point at stocked services, customers sit on real routes and zones, addresses are in defined zones, logins exist, and signing in swaps the world |
| `src/tenants/session.test.ts` | The signed-in hauler survives a reload, and sign out clears it |
| `src/tenants/restore.test.ts` | A page load with a stored session opens that hauler, pointed at an account it actually has |
| `src/flows/tenantOnboarding.test.ts` | All three onboarding workflows run end to end, for every hauler that sells each line, through the real store actions |

The onboarding tests derive their fixtures from each hauler's own configuration, so a hauler added to the registry is
covered the moment it is listed.

## Bugs this work found and fixed

Each was found by walking the workflows rather than by reading code, and each has a test.

1. **A reload moved you to another company.** Only the data was in memory; which hauler you were signed in to was too,
   so any reload silently dropped you into the seeded hauler's world. The seat is now kept in `sessionStorage`.
2. **A restored session crashed the portal.** The store rebuilt the restored hauler's `Db` but the portal slice kept
   its own default account, which belongs to the seeded hauler, so the portal opened on an account that did not exist
   and the Overview rendered a blank page.
3. **The address book was a module global.** Signing in rebound a module-level variable, which leaked across every
   reader in the process. The address book is now derived from the view's tenant. This showed up as 72 failing tests
   when the suite was run in a single process, and would have shown up in the app as one hauler's storefront offering
   another hauler's addresses.
4. **The portal's invariants panel was written against the seeded hauler's rows.** It named specific charge, payment,
   and batch ids, so every other hauler's customer saw "2 failing" on their own portal. Both checks now test the
   property against whatever is on that hauler's books.
5. **The commercial form offered sizes a hauler does not stock.** The size list came from a fixed id table and was not
   filtered by the hauler's catalog, so a hauler missing a size rendered the raw id (`cat_fl_2yd`) as an option.

## Known gaps

- **Omni's half yard mini container** is advertised on its site but not stocked here: the shared catalog has no size
  below 2 yards, and the storefront's commercial form lists sizes from a fixed id table, so a genuinely new size would
  need an id added to that table before a buyer could order it.
- **Roll-off is quoted as a monthly price** on the approvals screen. The input is correctly labelled `/haul` and the
  contract override is per haul, but the summary line beside it reads "a month". Cosmetic, but it reads wrong for an
  on-call box.
- **Roll-off onboarding does not ask what a roll-off customer actually needs**: the delivery date, how long they keep
  the box, the material, and the weight allowance are the heart of a roll-off order, and the real sites ask for all of
  them. Today the request carries a container, a material, and access notes. The roll-off pricing model
  (`rolloffRates`, `rolloffMaterials`, `rolloffPolicy`) is configured per hauler and drives billing, but the buyer's
  request never reaches it.
- **A hauler is not a Party.** These are demo tenants, not customers of TrashLab with their own billing.
