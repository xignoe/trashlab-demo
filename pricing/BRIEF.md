Read MANAGER.md and follow it as your operating procedure. Read SHARED_CONTRACT.md and use it verbatim. Then build the surface below.

# Surface brief: Pricing modeler, ratebook and quote workbench
Read context/persona-pricing-modeler.md. Build only the pricing surface in /pricing.

The owner is pricing risk. Their fears, in order: an increase hitting a contract account by mistake, a fee computed on the wrong base, a price the truck can't serve profitably, a rate edit rewriting history. Every screen should visibly address one of these.

Screen 1, Ratebook:
- Tabs by line of business. Table of ServiceCatalog rows with the published RateVersion per zone and frequency, effective date, and a version history drawer.
- Zones panel: serviceability, tax, franchise fee, delivery fee, publicPricing toggle.
- Fee and tax rules panel showing base and appliesTo explicitly ("7% of service lines, taxable").
- Create a draft RateVersion (single row or "increase all residential by X%"). Publish opens a blast-radius preview: count and list of accounts that move, accounts excluded because a Contract override covers that catalog item (listed by name with the contract reason), before and after invoice for three representative accounts (acct_res_maple, acct_res_001, acct_bakery), and total monthly revenue delta. Confirm creates a new published RateVersion with supersedesId set; the old version is never edited.

Screen 2, Quote workbench:
- Inputs: address, container (catalog), material, frequency, access flags (gate, lock, enclosure).
- Output: zone match, list price from resolvePrice, and a cost-to-serve estimate using the method in the brief: truck day cost divided by lifts per day for labor and truck, plus disposal at lb per yard by material times the tip fee, plus 15% indirect and a target margin. Put the assumptions in an editable panel so changing one recomputes the price.
- Quoted price field. If below list, show "X% below ratebook, est. $Y/yr" and require a reason; saving writes a Contract override on the account with pctBelowRateCard.

Agent panel on the Ratebook: proposed annual increase by account with rationale (months since last increase, margin vs cost to serve, contract eligibility, churn risk placeholder), approve per row or in bulk. Approving creates draft RateVersions or Contract escalator entries, never publishes.

Scenarios for the final pass: publish a 4% residential increase and show acct_bakery and the contracted frontload accounts excluded; quote Sunrise Bakery's 3 yd at $198 against a $220 list and see the exception saved; open version history for cat_res_96 and confirm the old version is intact.
