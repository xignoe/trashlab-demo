# Data Model in Practice

Haulers separate who receives service, who pays, what happens operationally, and how it is priced. Those often coincide for a small customer but must remain separate in the model.

## Concepts

- Party / customer: the commercial relationship. A national retailer is one customer with 500 stores. Support parent-child parties.
- Billing account: the invoice-producing relationship: payer, cycle, terms, tax treatment, delivery, PO requirements, credit status. One customer may have one consolidated account, one per site, or several groupings.
- Site / service address: the physical place. Independent of mailing address and current customer, because ownership and occupancy change.
- Line of business: frontload, residential, recycling, organics, rolloff, compactor, portable sanitation. One site can have several.
- Service: a time-bounded commitment to perform work at a site: material stream, container requirement, schedule or on-call behavior, instructions. Not merely "container + frequency": containers get swapped, shared, removed, or are customer-owned.
- Container: a physical asset or spec. Keep the asset separate from the service and record assignments over time.
- Rate: a versioned pricing rule with unit, applicability, effective dates, minimums, tiers, inclusions, surcharges, escalation.
- Contract: the umbrella governing term, scope, pricing, escalation, renewal, termination, SLAs. May cover all sites, selected accounts, a region, an LOB, or specific services.

## Messy cases

- Many sites: one consolidated invoice, grouped by region, or one per location. Connect services to sites and charges to billing accounts; do not assume customer → site → invoice.
- One site, many LOBs: separate service agreements, each with its own account, contract, equipment, schedule, pricing.
- Recurring vs one-time: recurring charges come from active service periods; one-time from a work order, ticket, or measured event. Both become charge records; provenance differs.
- Contract vs rate card precedence: explicit service-level negotiated rate → contract or customer override → account/site/market rate plan → standard rate card → manual exception requiring approval. Preserve which rule produced the price. Never recalculate a posted invoice from today's table.
- Mid-cycle changes: effective-date old and new service versions. Policy decides prorate, full period, or next cycle. Ops may change immediately while billing changes later; track both dates.
- Seasonal: model active, suspended, resumed periods with rules for rental during suspension, restart fees, minimums, asset removal.
- Shared containers: model participation separately; allocate by percentage, usage, unit count, or designated payer.

## Proposed entity diagram

```
PARTY
  1 --< PARTY_RELATIONSHIP >-- 1 PARTY
  1 --< BILLING_ACCOUNT
  1 --< SITE_PARTY_ROLE >-- 1 SITE   (occupant, owner, manager; effective-dated)

SITE
  1 --< SERVICE_AGREEMENT (line_of_business, material_stream, billing_account_id, contract_scope_id, effective/status periods)

SERVICE_AGREEMENT
  1 --< SERVICE_VERSION (container requirement, billing config, effective dates)
  1 --< SCHEDULE_VERSION
  1 --< SERVICE_STATUS_PERIOD
  1 --< WORK_ORDER / SERVICE_EVENT
  1 --< RECURRING_CHARGE_RULE

CONTAINER_ASSET >--< ASSET_ASSIGNMENT >-- SERVICE_AGREEMENT  (effective-dated; swaps and sharing)

SHARED_SERVICE_GROUP 1 --< PARTICIPATION (service/account, allocation method, share/effective dates)

CONTRACT
  1 --< CONTRACT_VERSION
  1 --< CONTRACT_SCOPE >-- customer/account/site/LOB/service
  1 --< PRICE_OVERRIDE
  >-- RATE_PLAN

RATE_PLAN 1 --< RATE_VERSION (charge type and unit, applicability, tiers/minimums/inclusions, effective dates)

WORK_ORDER / SERVICE_EVENT --< CHARGE
RECURRING_CHARGE_RULE       --< CHARGE
CHARGE (billing_account_id, service/site provenance, quantity and unit, resolved rate/version, service and accounting dates)

BILLING_ACCOUNT 1 --< INVOICE 1 --< INVOICE_LINE
CHARGE >--< INVOICE_LINE_ALLOCATION
INVOICE --< PAYMENT_ALLOCATION >-- PAYMENT
```

## Ten edge cases naive designs get wrong

1. Consolidated billing: 100 sites on one invoice, grouped by site and PO.
2. Split responsibility: landlord pays trash, tenants pay recycling or contamination.
3. Site turnover: tenant leaves; history and container location stay with the site.
4. Container swaps: damaged 4 yd replaced without creating a new service.
5. Shared containers: three tenants, one compactor, unequal allocation.
6. Mid-cycle change: weekly becomes 3x/wk on the 12th with contract-specific proration.
7. Seasonal suspension: pickup stops for winter, rental continues, restart fee.
8. Rate escalation: annual CPI with floor, cap, anniversary date.
9. Event pricing: a rolloff haul with separate haul, disposal weight, fuel, tax, overweight charges.
10. Retroactive correction: a credit or backdated rate fix adjusts prior billing without mutating the original invoice.

Central principle: relationships and effective dates are first-class. Operational truth, contractual entitlement, pricing logic, and accounting results reference one another but are not collapsed into one "service" row.
