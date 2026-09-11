# Ownership map

Who owns what, so five agents never work over each other. "Owns" means: is the only surface that writes this in the merged store, and is the source the merge agent copies from. "Reads" means: may display it, may call the engine on it, never mutates it. If your surface needs a write it does not own, stub it behind a clearly named function, say so in DECISIONS.md, and move on.

## Entities

| Entity | Owner (writes) | Readers | Note |
|---|---|---|---|
| Hauler, Zone, Route | seed only, except pricing writes Zone.publicPricing | all | The publicPricing toggle is the only runtime write (addendum K1). |
| ServiceCatalog, RateVersion, FeeRule, TaxRule | pricing | storefront, account, billing, portal | Publishing a RateVersion is pricing's action. Invariant 1: never touches a posted Invoice. |
| Contract (overrides, escalator) | pricing (quote workbench) | account, billing, portal | Account shows contract as price source. Billing resolves through it. |
| Quote | storefront (create, hold) and pricing (price a commercialRequest) | account | Storefront owns residentialSignup end to end. Pricing owns pricing a commercialRequest. Office approval of a held quote is a storefront screen (Phase 4). |
| Party, BillingAccount, Site | storefront (create at signup) and account (edit status, hold, suspend) | all | Account owns status transitions. Storefront only creates. |
| ServiceItem, Container | account (add, change, end) and storefront (first item at signup) | billing, portal, pricing | Portal cart change is a Request that account turns into a ServiceItem change. |
| WorkOrder | account and portal (create) | billing | Storefront creates the delivery WorkOrder at signup. Portal creates extraPickup and recovery orders. |
| ServiceEvent, ScaleTicket | seed only | account, billing, portal | Driver data. Nobody creates these at runtime in the MVP. |
| Charge | billing (generate, approve, edit, waive, post) | account, portal | Storefront writes the first-cycle charges as approved (addendum C13). Account may propose a Charge from a service change; billing decides it. |
| WaivedCharge | billing | account | Invariant 5: never deleted. |
| Invoice | billing (postInvoices) | account, portal | Invariant 1. Portal displays and pays. |
| Payment, PaymentAllocation, ProcessorBatch | account (take a payment, allocate) and portal (customer pays) and billing (batch split) | all | Allocation logic is one engine function, allocate(), in billing's engine. |
| CreditMemo | account | billing, portal | |
| Request | portal (create) | account (resolve) | Requests appear as open items on the account view. |

## Screens

| Screen | Owner | Route | Port |
|---|---|---|---|
| Ratebook, blast radius, publish | pricing | /pricing | 5180 |
| Quote workbench | pricing | /pricing/quote | 5180 |
| Account view and its four actions | account | /account/:id | 5199 |
| Billing run, exception queue, posting, leakage, payments tab | billing | /billing | 5179 |
| Storefront: address, offer, checkout, success, franchise stop, boundary hold, commercial request, office approval | storefront | / | 5173 |
| Portal: overview, billing and pay, requests | portal | / | 5175 |
| Agent panel drawer | each surface owns its own drawer | | |
| Persona switcher (Owner, Office, Customer) | merge only | | |

## Cross-surface flows and who proves them

These are the flows the merge brief (prompts/06-merge.md) requires. Each has a producer and a consumer. Producers ship the data shape now. Consumers may read seed that imitates it now. The merge wires them.

| Flow | Producer | Consumer | Status at check-in |
|---|---|---|---|
| Storefront signup creates Party, BillingAccount, Site, ServiceItem, WorkOrder, approved first-cycle Charges, Payment | storefront (done, Phase 2) | account (view), billing (first invoice, addendum C13) | Producer done. Consumer side is a billing follow-up dispatch (addendum I3). |
| Boundary hold: held Quote, office approves, then charge and activate | storefront (done, quote_held_ridge approves, charges 13623, activates) | account | Producer done. Merge wires the activated account into the account view. |
| Commercial request lands in the quote workbench | storefront (Phase 4) | pricing (done, priceCommercialRequest writes onto the existing Quote) | Both sides done against seed. Merge wires live. |
| Contract override shows as price source on account view and on the invoice line in portal | pricing (done) | account (done), portal (done) | All three done against seed. |
| Portal request appears as open item on account view | portal (done) | account (done) | Both sides done against seed. Merge wires live. |
| Published RateVersion changes storefront price and next billing run, never a posted invoice | pricing (Phase 4) | storefront, billing, portal | Billing side proved (posted INV-2026-0227 unchanged after cat_res_96 moves to $31). Pricing publish done (8 versions with supersedesId, inv_res_maple_0001 unchanged). |
| Portal cart change mid-quarter shows effective date, swap WorkOrder, next-invoice adjustment on account view | portal (done, proposeCartChange) | account (done, Scenario A) | Both sides done. Merge routes portal's pendingChanges into account's service change. |
| Driver extra bags event with photo lands in exception queue, waived as goodwill, leakage updates | seed | billing | Done. Proved in billing/RUNBOOK.md. |
| Rolloff overage with scale ticket, approved, charged to card | seed | billing, account | Done in billing. Proved in billing/RUNBOOK.md. |

## Folder rules

- Each surface writes only inside its own folder.
- shared/ is written only by the check-in or merge agent.
- prompts/ and trashlab/ are read-only inputs.
- checkin/ is tooling. Any agent may run checkin/build_status.py, none edits it.
