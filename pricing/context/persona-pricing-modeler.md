# Persona: Pricing Modeler (owner or GM)

## First principle: the owner is pricing risk, not "configuring rates"

The owner or GM is trying to keep every truck-hour economically worthwhile without losing route density or important accounts. They usually know costs within a useful range, not to the penny, and know the local competitive ceiling remarkably well. Excel works because it is flexible, visible, and easy to override. The product must preserve those advantages while preventing expensive mistakes.

## The 6 pricing decisions they actually make

| Decision | What they are balancing | Typical time today |
|---|---|---|
| Annual customer increase | Inflation, churn risk, contract terms, account history, how far each customer trails the market | 1 to 3 days for a small book; 1 to 2 weeks for hundreds of accounts |
| New residential zone or route expansion | Drive time, stops per hour, disposal distance, expected density, competitive household price | Half a day to 2 days, then months of informal adjustment |
| New commercial or contractor quote | Container, lifts, material weight, disposal cost, travel, contamination risk, bargaining room | 15 to 60 minutes normally; 2 to 4 hours for a consequential account |
| Fuel/environmental surcharge change | Recovering cost without making the invoice look predatory; percentage vs fixed; contractual eligibility | 2 to 6 hours, mostly checking accounts and formulas |
| Contract renewal or save decision | Market price, customer leverage, service problems, termination risk, accumulated underpricing | 30 minutes to 3 hours per account |
| Material/disposal rate change | Transfer-station increases, density assumptions, contamination, tonnage exposure, pass through now or later | 2 to 8 hours plus manual updates across quotes and billing |
| Strategic exception | Winning density, blocking a competitor, filling capacity, preserving a relationship | 10 to 45 minutes, but the exception may live forever |

The annual increase consumes the most administrative time. Bad commercial quotes and uncontrolled exceptions destroy the most margin.

## What one pricing definition must express

The system needs an operational ratebook, not merely a table of prices.

Service catalog. A sellable item must encode what the truck actually does: line of business and service type; container size and ownership; material or waste stream; frequency, scheduled lifts, on-call pulls, rental days; included weight, excess tonnage, contamination, dry-run and overage rules; operational constraints such as truck type or disposal facility. "8-yard dumpster" is not a complete product. An 8-yard cardboard container serviced weekly is economically different from an 8-yard mixed-waste container behind a restaurant.

Geography and density. Zones should express serviceability, distance from yard or disposal point, route or service-day compatibility, current or expected stop density, zone-specific minimums and trip charges. Residential pricing should not pretend geography is just mileage. Ten adjacent stops can be better than one closer stop.

Immutable rate versions. Every rate needs an effective start and optional end date; draft, approved, scheduled, and active states; the customers and channels it applies to; a complete audit trail. A quote uses the applicable version when quoted. An invoice uses the version and contract terms applicable to that service date. Editing tomorrow's price must never alter yesterday's economic record.

Fees, surcharges, and taxes. Rules must define eligibility, fixed vs percentage, calculation base, ordering, minimums, caps, exemptions, taxability, rounding, invoice presentation. "Fuel surcharge: 8%" is dangerously incomplete. Eight percent of service charges, disposal, rentals, other fees, or the entire subtotal?

Contract overrides and escalators. A contract needs explicit precedence over the standard ratebook: standard service rate → zone adjustment → contract or account override → scheduled escalator or renewal term → usage and material charges → fees, surcharges, taxes. Escalators need dates, indices or fixed percentages, notice requirements, caps, and approval status.

Where the hauler will resist. They will resist forcing every negotiated deal into standardized SKUs. Commercial selling often involves an all-in monthly number, waived fees, unusual included tonnage, temporary introductory pricing, or "match this competitor invoice." Do not eliminate exceptions. Contain them. Make each exception explicit, scoped, dated, and measurable against the standard price. An exception should show "12% below ratebook, costing an estimated $1,840 annually," not disappear into a custom spreadsheet cell.

## What the owner fears most

The fear is not that software recommends a slightly imperfect price. It is that software makes a broad, silent mistake.

- Selling unprofitable work: the public or quoted price ignores travel, density, material weight, or disposal economics.
- Breaking a promise: a general increase accidentally reaches a fixed-price contract, municipal account, or recently negotiated customer.
- Calculating a fee incorrectly: a surcharge applies to the wrong base, compounds with another fee, or is taxed incorrectly.
- Rewriting history: a rate edit changes old invoices, credits, reporting, or the apparent terms of an accepted quote.

The answer is not more settings. It is immutable versions, precise eligibility, invoice-level previews, exception reports, and a publish step that says exactly who changes and who does not.

## The agentic version

The agent should behave like a pricing analyst, not an autonomous revenue manager.

Agent drafts; owner approves:
- Annual increases: recommend account-level changes based on current rate, contract eligibility, service cost, last increase, market position, churn sensitivity.
- Commercial quotes: suggest a price range from estimated truck time, route fit, container economics, material density, disposal cost.
- Escalators: detect what is due, interpret structured terms, prepare notices, assemble an approval batch.
- Material adjustments: identify affected services and propose pass-through changes.
- Renewals: surface under-market or low-margin contracts before renewal windows.
- Competitor monitoring: collect evidence and flag market movement, but treat advertised prices as weak signals.

Fully human: strategic account concessions; entering a new geography before density exists; pricing intended to displace a competitor; ambiguous contract interpretation; accepting deliberately unprofitable work for route-building; final publication of broad customer increases.

For trust, every recommendation must show: current, recommended, and minimum defensible price; cost waterfall (truck time, disposal, container, overhead assumptions); expected margin per lift, account, and truck-hour; route-density or geographic evidence; contract eligibility and relevant clauses; confidence level and missing information; comparable customers and market evidence; customer invoice before/after; revenue impact, exception count, rollback path. The owner needs to disagree with one assumption and immediately see the revised price.

## The three "finally" workflows

1. Annual increase command center. A ranked account list showing recommended increase, contract eligibility, last increase, current margin, customer risk, invoice preview. The owner can approve 300 ordinary accounts, inspect 20 exceptions, and exclude five strategic customers.
2. Commercial quote workbench. Enter address, container, material, frequency. The system displays route fit, estimated cost per lift, target range, nearby compatible stops, comparable won/lost quotes. The salesperson may negotiate, but the owner sees the economic consequence instantly.
3. Rate-change simulator and publisher. Define a surcharge, disposal change, or new rate version once. Preview affected accounts and representative invoices, identify contract conflicts, approve the effective date, then publish consistently to quoting, billing, and public pricing.

## What sends them back to Excel

If the system cannot handle a one-off deal without either blocking the sale or contaminating the standard ratebook, they will leave. The winning product is structured underneath and permissive at the edge: one governed source of truth, with visible, intentional exceptions.

## Most important needs, ranked

1. Define a price once and trust it shows up correctly on every quote, invoice, and public page.
2. See who a change hits before it goes out, especially that an increase never touches a contract or municipal account by accident.
3. Make an exception for a deal without either blocking the sale or contaminating the standard ratebook.
4. Price from real cost to serve (route time, disposal, truck) instead of a guess.
5. Never have history rewritten by a rate edit.
