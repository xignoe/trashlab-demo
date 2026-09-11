#!/usr/bin/env node
// Generates every file in src/seed/ from the canonical seed in SHARED_CONTRACT.md.
// Run: node scripts/gen_seed.mjs   (then node scripts/validate_seed.mjs)
// Money is integer cents. Dates are ISO 8601. TODAY is 2026-09-10 (Thursday), Eastern time.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'seed');
mkdirSync(OUT, { recursive: true });

const TZ = '-04:00'; // Eastern daylight time in September
const at = (date, time = '09:00:00') => `${date}T${time}${TZ}`;
const pct = (cents, rate) => Math.round((cents * rate) / 100);

// ---------------------------------------------------------------- hauler
const hauler = {
  id: 'hauler_piedmont',
  name: 'Piedmont Disposal',
  policy: {
    proration: 'none',
    lateFeeCents: 1000,
    lateFeeDay: 5,
    graceMissedPickups: 2,
    suspendAfterDays: 30,
    reinstatementFeeCents: 2500,
  },
};

// ---------------------------------------------------------------- zones
const zones = [
  { id: 'zone_open', name: 'Piedmont open market', serviceability: 'open', taxRatePct: 7, franchiseFeePct: 0, deliveryFeeCents: 2500, publicPricing: true },
  { id: 'zone_boundary', name: 'Piedmont boundary', serviceability: 'boundary', taxRatePct: 7, franchiseFeePct: 0, deliveryFeeCents: 2500, publicPricing: true },
  { id: 'zone_franchise', name: 'Ashford city franchise (Southeast Sanitation)', serviceability: 'franchise', taxRatePct: 7, franchiseFeePct: 17, deliveryFeeCents: 2500, publicPricing: false },
  { id: 'zone_notserved', name: 'Outside service area', serviceability: 'notServed', taxRatePct: 0, franchiseFeePct: 0, deliveryFeeCents: 0, publicPricing: false },
];

// ---------------------------------------------------------------- catalog
const catalog = [
  { id: 'cat_res_96', lob: 'residential', name: '96 gallon cart', sizeLabel: '96 gal', unit: 'cart', public: true },
  { id: 'cat_res_64', lob: 'residential', name: '64 gallon cart', sizeLabel: '64 gal', unit: 'cart', public: true },
  { id: 'cat_res_extra_cart', lob: 'residential', name: 'Extra 96 gallon cart', sizeLabel: '96 gal', unit: 'cart', public: true },
  { id: 'cat_res_recycling', lob: 'residential', name: 'Recycling cart', sizeLabel: '96 gal', unit: 'cart', public: true },
  { id: 'cat_fl_2yd', lob: 'frontload', name: '2 yard front load container', sizeLabel: '2 yd', unit: 'container', public: false },
  { id: 'cat_fl_3yd', lob: 'frontload', name: '3 yard front load container', sizeLabel: '3 yd', unit: 'container', public: false },
  { id: 'cat_fl_3yd_wood', lob: 'frontload', name: '3 yard front load container, wood waste', sizeLabel: '3 yd', unit: 'container', public: false },
  {
    id: 'cat_ro_20yd', lob: 'rolloff', name: '20 yard roll off box', sizeLabel: '20 yd', unit: 'box',
    rolloff: { includedTons: 3, includedDays: 30, extraDayCents: 700, overageCentsPerTon: 7000 },
    public: false,
  },
];

// ---------------------------------------------------------------- rate versions
// Residential rows mirror ../pricing/src/seed/rateVersions.json exactly (addendum C4): same ids, zoneIds,
// frequencies, priceCents, effectiveFrom, publishedAt, and supersedesId. Every residential row carries a
// zoneId and zone_boundary has its own higher prices. There are no zone-less residential rows; the no-zone
// fallback in resolvePrice is for zones with no seeded row, not the normal path for a named zone.
const resRv = (id, catalogId, zoneId, frequency, priceCents, effectiveFrom, publishedAt, supersedesId) => ({
  id, catalogId, zoneId, frequency, priceCents, effectiveFrom, status: 'published', publishedAt, ...(supersedesId ? { supersedesId } : {}),
});
const RES_FROM = '2025-01-01';
const RES_PUB = '2024-12-10T09:00:00';
// Frontload and rolloff rows are the storefront's own (unchanged by the addendum).
const RV_FROM = '2026-01-01';
const RV_PUB = at('2025-12-15', '12:00:00');
const rv = (id, catalogId, priceCents, frequency, zoneId) => ({
  id, catalogId, ...(zoneId ? { zoneId } : {}), frequency, priceCents, effectiveFrom: RV_FROM, status: 'published', publishedAt: RV_PUB,
});
const rateVersions = [
  // residential, zone_open (the 2024 row is superseded by rv_res_96_open_weekly)
  resRv('rv_res_96_open_weekly_2024', 'cat_res_96', 'zone_open', 'weekly', 2700, '2024-01-01', '2023-12-15T09:00:00'),
  resRv('rv_res_96_open_weekly', 'cat_res_96', 'zone_open', 'weekly', 2900, RES_FROM, RES_PUB, 'rv_res_96_open_weekly_2024'),
  resRv('rv_res_64_open_weekly', 'cat_res_64', 'zone_open', 'weekly', 2600, RES_FROM, RES_PUB),
  resRv('rv_res_extra_open_weekly', 'cat_res_extra_cart', 'zone_open', 'weekly', 900, RES_FROM, RES_PUB),
  resRv('rv_res_recycling_open_eow', 'cat_res_recycling', 'zone_open', 'eow', 1200, RES_FROM, RES_PUB),
  // residential, zone_boundary (its own, higher prices)
  resRv('rv_res_96_boundary_weekly', 'cat_res_96', 'zone_boundary', 'weekly', 3100, RES_FROM, RES_PUB),
  resRv('rv_res_64_boundary_weekly', 'cat_res_64', 'zone_boundary', 'weekly', 2800, RES_FROM, RES_PUB),
  resRv('rv_res_extra_boundary_weekly', 'cat_res_extra_cart', 'zone_boundary', 'weekly', 1000, RES_FROM, RES_PUB),
  resRv('rv_res_recycling_boundary_eow', 'cat_res_recycling', 'zone_boundary', 'eow', 1300, RES_FROM, RES_PUB),
  // frontload, zone_open
  rv('rv_fl_2yd_open_weekly', 'cat_fl_2yd', 9500, 'weekly', 'zone_open'),
  rv('rv_fl_3yd_open_2x', 'cat_fl_3yd', 22000, '2x', 'zone_open'),
  rv('rv_fl_3yd_wood_open_2x', 'cat_fl_3yd_wood', 19000, '2x', 'zone_open'),
  // rolloff haul, zone_open
  rv('rv_ro_20yd_open_haul', 'cat_ro_20yd', 57500, 'onCall', 'zone_open'),
];

// ---------------------------------------------------------------- fee and tax rules
const feeRules = [
  { id: 'fee_fuel_7pct', name: 'Fuel surcharge', kind: 'percent', value: 7, base: 'serviceLines', appliesTo: ['recurring', 'event'], taxable: true },
  { id: 'fee_env_1', name: 'Environmental fee', kind: 'flat', value: 100, base: 'serviceLines', appliesTo: ['recurring'], taxable: false },
];
const taxRules = zones
  .filter((z) => z.taxRatePct > 0)
  .map((z) => ({ id: `tax_${z.id.replace('zone_', '')}`, zoneId: z.id, ratePct: z.taxRatePct, appliesTo: ['recurring', 'event', 'fee'] }));

// ---------------------------------------------------------------- collections
const parties = [];
const accounts = [];
const sites = [];
const serviceItems = [];
const containers = [];
const contracts = [];
const workOrders = [];
const serviceEvents = [];
const scaleTickets = [];
const charges = [];
const invoices = [];
const payments = [];
const allocations = [];
const batches = [];
const creditMemos = [];
const waivedCharges = [];
const requests = [];
const requestsSeen = requests; // alias for readability below

const routeStops = { route_mon_res: [], route_tue_res: [], route_wed_fl: [], route_thu_ro: [] };
const addStop = (routeId, siteId) => routeStops[routeId].push(siteId);

let serialCounter = { cart: 1000, container: 200, box: 100 };
const serialFor = (catalogId) => {
  const cat = catalog.find((c) => c.id === catalogId);
  const prefix = { cart: 'PD-C', container: 'PD-F', box: 'PD-R' }[cat.unit];
  return `${prefix}-${(serialCounter[cat.unit] += 1)}`;
};

function addContainer(id, catalogId, siteId, assignedFrom) {
  containers.push({ id, serial: serialFor(catalogId), catalogId, siteId, assignedFrom });
  return id;
}

function addServiceItem({ id, siteId, catalogId, frequency, qty = 1, effectiveFrom, status = 'active', containerId }) {
  const containerIds = containerId ? [addContainer(containerId, catalogId, siteId, effectiveFrom)] : [];
  serviceItems.push({ id, siteId, catalogId, qty, frequency, containerIds, effectiveFrom, status });
  return id;
}

// ---------------------------------------------------------------- named accounts
const FROM = '2024-03-04';

// acct_res_maple: homeowner, 96 gal + extra cart + recycling, quarterly in advance, past due $87.45, one extraBags event with photo
parties.push({ id: 'party_res_maple', name: 'Dana Maple', kind: 'homeowner' });
accounts.push({ id: 'acct_res_maple', payerPartyId: 'party_res_maple', cycle: 'quarterly', billedInAdvance: true, autopay: false, status: 'pastDue', deliveryMethod: 'email', taxExempt: false });
sites.push({ id: 'site_res_maple', accountId: 'acct_res_maple', address: '917 Sycamore Ave, Piedmont, GA 30512', zoneId: 'zone_open', routeId: 'route_tue_res' });
addStop('route_tue_res', 'site_res_maple');
addServiceItem({ id: 'si_maple_96', siteId: 'site_res_maple', catalogId: 'cat_res_96', frequency: 'weekly', effectiveFrom: FROM, containerId: 'cont_maple_96' });
addServiceItem({ id: 'si_maple_extra', siteId: 'site_res_maple', catalogId: 'cat_res_extra_cart', frequency: 'weekly', effectiveFrom: '2025-06-02', containerId: 'cont_maple_extra' });
addServiceItem({ id: 'si_maple_recycling', siteId: 'site_res_maple', catalogId: 'cat_res_recycling', frequency: 'eow', effectiveFrom: '2025-06-02', containerId: 'cont_maple_recycling' });
charges.push({
  id: 'chg_maple_2026q3', accountId: 'acct_res_maple', siteId: 'site_res_maple', lineType: 'recurring', catalogId: 'cat_res_96',
  description: 'Q3 2026 service balance carried forward from the prior billing system',
  source: { type: 'manual', id: 'import_2026q3_maple' }, period: { start: '2026-07-01', end: '2026-09-30' },
  baseCents: 8745, fees: [], taxCents: 0, totalCents: 8745, pricing: { ruleWon: 'manualException' }, status: 'posted', evidenceIds: [],
});
invoices.push({
  id: 'inv_maple_2026q3', accountId: 'acct_res_maple', number: 'INV-2026-0712', chargeIds: ['chg_maple_2026q3'],
  subtotalCents: 8745, feeCents: 0, taxCents: 0, totalCents: 8745, issuedAt: at('2026-07-01'), dueAt: at('2026-07-01'), postedAt: at('2026-07-01'), locked: true, deliveredVia: 'email',
});
serviceEvents.push({ id: 'se_maple_0908', siteId: 'site_res_maple', routeId: 'route_tue_res', date: '2026-09-08', outcome: 'completed', exception: 'extraBags', photoUrl: '/evidence/se_maple_0908.jpg', note: 'Four bags beside the cart', driver: 'M. Ortega' });

// acct_res_holt: homeowner, 96 gal, autopay, on vacationHold
parties.push({ id: 'party_res_holt', name: 'Rowan Holt', kind: 'homeowner' });
accounts.push({ id: 'acct_res_holt', payerPartyId: 'party_res_holt', cycle: 'quarterly', billedInAdvance: true, autopay: true, paymentMethodOnFile: 'card', status: 'active', deliveryMethod: 'email', taxExempt: false });
sites.push({ id: 'site_res_holt', accountId: 'acct_res_holt', address: '44 Birchwood Ct, Piedmont, GA 30512', zoneId: 'zone_open', routeId: 'route_mon_res' });
addStop('route_mon_res', 'site_res_holt');
addServiceItem({ id: 'si_holt_96', siteId: 'site_res_holt', catalogId: 'cat_res_96', frequency: 'weekly', effectiveFrom: FROM, containerId: 'cont_holt_96' });
requestsSeen.push({ id: 'req_holt_vacation', accountId: 'acct_res_holt', siteId: 'site_res_holt', kind: 'vacationHold', status: 'scheduled', createdVia: 'portal', note: 'Hold pickups 2026-09-07 through 2026-09-21' });

// acct_res_kerr: homeowner, suspended, route stops show skippedSuspended
parties.push({ id: 'party_res_kerr', name: 'Jamie Kerr', kind: 'homeowner' });
accounts.push({ id: 'acct_res_kerr', payerPartyId: 'party_res_kerr', cycle: 'quarterly', billedInAdvance: true, autopay: false, status: 'suspended', deliveryMethod: 'mail', taxExempt: false });
sites.push({ id: 'site_res_kerr', accountId: 'acct_res_kerr', address: '2306 Foxglove Dr, Piedmont, GA 30512', zoneId: 'zone_open', routeId: 'route_tue_res' });
addStop('route_tue_res', 'site_res_kerr');
addServiceItem({ id: 'si_kerr_96', siteId: 'site_res_kerr', catalogId: 'cat_res_96', frequency: 'weekly', effectiveFrom: FROM, status: 'held', containerId: 'cont_kerr_96' });
serviceEvents.push({ id: 'se_kerr_0901', siteId: 'site_res_kerr', routeId: 'route_tue_res', date: '2026-09-01', outcome: 'skippedSuspended', driver: 'M. Ortega' });
serviceEvents.push({ id: 'se_kerr_0908', siteId: 'site_res_kerr', routeId: 'route_tue_res', date: '2026-09-08', outcome: 'skippedSuspended', driver: 'M. Ortega' });

// acct_bakery: Sunrise Bakery, 3 yd 2x + 3 yd wood 2x, contract 10% below rate card, escalator 4% on Jan 1
parties.push({ id: 'party_bakery', name: 'Sunrise Bakery', kind: 'business' });
accounts.push({ id: 'acct_bakery', payerPartyId: 'party_bakery', cycle: 'monthly', billedInAdvance: true, autopay: false, status: 'active', deliveryMethod: 'email', taxExempt: false, contractId: 'contract_bakery' });
sites.push({ id: 'site_bakery', accountId: 'acct_bakery', address: '214 Depot St, Piedmont, GA 30512', zoneId: 'zone_open', routeId: 'route_wed_fl', accessNotes: 'Enclosure behind the loading dock, gate code 4471' });
addStop('route_wed_fl', 'site_bakery');
addServiceItem({ id: 'si_bakery_3yd', siteId: 'site_bakery', catalogId: 'cat_fl_3yd', frequency: '2x', effectiveFrom: '2026-01-01', containerId: 'cont_bakery_3yd' });
addServiceItem({ id: 'si_bakery_3yd_wood', siteId: 'site_bakery', catalogId: 'cat_fl_3yd_wood', frequency: '2x', effectiveFrom: '2026-01-01', containerId: 'cont_bakery_3yd_wood' });
contracts.push({
  id: 'contract_bakery', accountId: 'acct_bakery', termStart: '2026-01-01', termEnd: '2028-12-31', renewalNoticeDays: 60,
  overrides: [
    { catalogId: 'cat_fl_3yd', frequency: '2x', priceCents: 19800, reason: 'competitive match', pctBelowRateCard: 10 },
    { catalogId: 'cat_fl_3yd_wood', frequency: '2x', priceCents: 17100, reason: 'competitive match', pctBelowRateCard: 10 },
  ],
  escalator: { kind: 'fixedPct', pct: 4, anniversary: '2027-01-01' },
});
serviceEvents.push({ id: 'se_bakery_0902', siteId: 'site_bakery', routeId: 'route_wed_fl', date: '2026-09-02', outcome: 'completed', exception: 'contamination', photoUrl: '/evidence/se_bakery_0902.jpg', note: 'Plastic film and food waste in the wood waste container', driver: 'T. Boudreaux' });

// acct_pm_oakridge: propertyManager, 4 sites, net30, PO per site, three posted invoices paid by one check
parties.push({ id: 'party_pm_oakridge', name: 'Oakridge Property Management', kind: 'propertyManager' });
accounts.push({ id: 'acct_pm_oakridge', payerPartyId: 'party_pm_oakridge', cycle: 'net30', billedInAdvance: false, autopay: false, status: 'active', deliveryMethod: 'email', taxExempt: false });
const oakridgeSites = [
  ['site_oakridge_1', '1401 Willow Bend Rd, Piedmont, GA 30512', 'OAK-1401'],
  ['site_oakridge_2', '1409 Willow Bend Rd, Piedmont, GA 30512', 'OAK-1409'],
  ['site_oakridge_3', '62 Hollis Park Ln, Piedmont, GA 30512', 'OAK-0062'],
  ['site_oakridge_4', '70 Hollis Park Ln, Piedmont, GA 30512', 'OAK-0070'],
];
oakridgeSites.forEach(([id, address, poNumber], i) => {
  sites.push({ id, accountId: 'acct_pm_oakridge', address, zoneId: 'zone_open', routeId: 'route_mon_res', poNumber });
  addStop('route_mon_res', id);
  addServiceItem({ id: `si_oakridge_${i + 1}`, siteId: id, catalogId: 'cat_res_96', frequency: 'weekly', effectiveFrom: '2025-02-03', containerId: `cont_oakridge_${i + 1}` });
});
// one recurring charge per site per month, billed in arrears under net30
const OAK_MONTHS = [
  ['2026_06', '2026-06-01', '2026-06-30', '2026-07-01', '2026-07-31', 'INV-2026-0718'],
  ['2026_07', '2026-07-01', '2026-07-31', '2026-08-01', '2026-08-31', 'INV-2026-0819'],
  ['2026_08', '2026-08-01', '2026-08-31', '2026-09-01', '2026-10-01', 'INV-2026-0921'],
];
const oakridgeInvoiceIds = [];
for (const [key, start, end, issued, due, number] of OAK_MONTHS) {
  const chargeIds = [];
  let subtotal = 0, fee = 0, tax = 0;
  oakridgeSites.forEach(([siteId], i) => {
    const base = 2900;
    const fuel = pct(base, 7);
    const env = 100;
    const taxCents = pct(base + fuel, 7); // env fee is not taxable
    const id = `chg_oakridge_${key}_s${i + 1}`;
    charges.push({
      id, accountId: 'acct_pm_oakridge', siteId, lineType: 'recurring', catalogId: 'cat_res_96',
      description: `96 gal cart, weekly, ${start} to ${end}`, source: { type: 'serviceItem', id: `si_oakridge_${i + 1}` },
      period: { start, end }, baseCents: base, fees: [{ feeRuleId: 'fee_fuel_7pct', cents: fuel }, { feeRuleId: 'fee_env_1', cents: env }],
      taxCents, totalCents: base + fuel + env + taxCents, pricing: { rateVersionId: 'rv_res_96_open_weekly', ruleWon: 'zoneRate' }, status: 'posted', evidenceIds: [],
    });
    chargeIds.push(id); subtotal += base; fee += fuel + env; tax += taxCents;
  });
  const invId = `inv_oakridge_${key}`;
  oakridgeInvoiceIds.push(invId);
  invoices.push({ id: invId, accountId: 'acct_pm_oakridge', number, chargeIds, subtotalCents: subtotal, feeCents: fee, taxCents: tax, totalCents: subtotal + fee + tax, issuedAt: at(issued), dueAt: at(due), postedAt: at(issued), locked: true, deliveredVia: 'email' });
}
const oakridgeTotal = oakridgeInvoiceIds.reduce((s, id) => s + invoices.find((i) => i.id === id).totalCents, 0);
payments.push({ id: 'pay_chk_oakridge', accountId: 'acct_pm_oakridge', method: 'check', cents: oakridgeTotal, receivedAt: at('2026-09-04', '11:20:00'), status: 'settled' });
for (const id of oakridgeInvoiceIds) allocations.push({ sourceType: 'payment', sourceId: 'pay_chk_oakridge', invoiceId: id, cents: invoices.find((i) => i.id === id).totalCents });

// acct_contractor_hale: contractor, net30, 3 rolloff boxes across 2 job sites, two ScaleTickets over the cap
parties.push({ id: 'party_contractor_hale', name: 'Hale Construction', kind: 'contractor' });
accounts.push({ id: 'acct_contractor_hale', payerPartyId: 'party_contractor_hale', cycle: 'net30', billedInAdvance: false, autopay: false, status: 'active', deliveryMethod: 'email', taxExempt: false });
sites.push({ id: 'site_hale_riverside', accountId: 'acct_contractor_hale', address: '3800 Riverside Pkwy, Piedmont, GA 30512', zoneId: 'zone_open', routeId: 'route_thu_ro', accessNotes: 'Boxes on the north lot, call the super 30 minutes ahead', poNumber: 'HALE-RS-22' });
sites.push({ id: 'site_hale_depot', accountId: 'acct_contractor_hale', address: '95 Old Depot Rd, Piedmont, GA 30512', zoneId: 'zone_open', routeId: 'route_thu_ro', accessNotes: 'Locked gate after 4 pm', poNumber: 'HALE-OD-07' });
addStop('route_thu_ro', 'site_hale_riverside');
addStop('route_thu_ro', 'site_hale_depot');
addServiceItem({ id: 'si_hale_box_101', siteId: 'site_hale_riverside', catalogId: 'cat_ro_20yd', frequency: 'onCall', effectiveFrom: '2026-08-13', containerId: 'cont_ro_101' });
addServiceItem({ id: 'si_hale_box_102', siteId: 'site_hale_riverside', catalogId: 'cat_ro_20yd', frequency: 'onCall', effectiveFrom: '2026-08-13', containerId: 'cont_ro_102' });
addServiceItem({ id: 'si_hale_box_103', siteId: 'site_hale_depot', catalogId: 'cat_ro_20yd', frequency: 'onCall', effectiveFrom: '2026-08-20', containerId: 'cont_ro_103' });
workOrders.push({ id: 'wo_hale_deliver_101', siteId: 'site_hale_riverside', kind: 'deliver', status: 'done', scheduledFor: '2026-08-13', serviceItemId: 'si_hale_box_101', containerId: 'cont_ro_101', completedAt: at('2026-08-13', '08:40:00') });
workOrders.push({ id: 'wo_hale_deliver_102', siteId: 'site_hale_riverside', kind: 'deliver', status: 'done', scheduledFor: '2026-08-13', serviceItemId: 'si_hale_box_102', containerId: 'cont_ro_102', completedAt: at('2026-08-13', '09:05:00') });
workOrders.push({ id: 'wo_hale_deliver_103', siteId: 'site_hale_depot', kind: 'deliver', status: 'done', scheduledFor: '2026-08-20', serviceItemId: 'si_hale_box_103', containerId: 'cont_ro_103', completedAt: at('2026-08-20', '10:15:00') });
workOrders.push({ id: 'wo_hale_dar_101', siteId: 'site_hale_riverside', kind: 'dumpAndReturn', status: 'done', scheduledFor: '2026-09-01', serviceItemId: 'si_hale_box_101', containerId: 'cont_ro_101', completedAt: at('2026-09-01', '13:50:00') });
workOrders.push({ id: 'wo_hale_dar_102', siteId: 'site_hale_riverside', kind: 'dumpAndReturn', status: 'done', scheduledFor: '2026-09-08', serviceItemId: 'si_hale_box_102', containerId: 'cont_ro_102', completedAt: at('2026-09-08', '14:30:00') });
workOrders.push({ id: 'wo_hale_dar_103', siteId: 'site_hale_depot', kind: 'dumpAndReturn', status: 'open', scheduledFor: '2026-09-03', serviceItemId: 'si_hale_box_103', containerId: 'cont_ro_103' });
scaleTickets.push({ id: 'st_hale_0901', workOrderId: 'wo_hale_dar_101', containerId: 'cont_ro_101', facility: 'Piedmont Regional Landfill', material: 'C&D debris', grossLbs: 22400, tareLbs: 14000, netLbs: 8400, ticketedAt: at('2026-09-01', '13:12:00') });
scaleTickets.push({ id: 'st_hale_0908', workOrderId: 'wo_hale_dar_102', containerId: 'cont_ro_102', facility: 'Piedmont Regional Landfill', material: 'C&D debris', grossLbs: 21100, tareLbs: 14000, netLbs: 7100, ticketedAt: at('2026-09-08', '13:48:00') });
serviceEvents.push({ id: 'se_hale_0903', siteId: 'site_hale_depot', routeId: 'route_thu_ro', date: '2026-09-03', outcome: 'blocked', exception: 'dryRun', photoUrl: '/evidence/se_hale_0903.jpg', note: 'Gate locked, box not reachable', driver: 'R. Vance' });

// acct_ro_homeowner: one prepaid 20 yd, card on file, delivered 34 days ago (2026-08-07)
parties.push({ id: 'party_ro_homeowner', name: 'Priya Natarajan', kind: 'homeowner' });
accounts.push({ id: 'acct_ro_homeowner', payerPartyId: 'party_ro_homeowner', cycle: 'perJob', billedInAdvance: true, autopay: false, paymentMethodOnFile: 'card', status: 'active', deliveryMethod: 'email', taxExempt: false });
sites.push({ id: 'site_ro_homeowner', accountId: 'acct_ro_homeowner', address: '18 Quarry Ridge Ct, Piedmont, GA 30512', zoneId: 'zone_open', routeId: 'route_thu_ro', accessNotes: 'Box on the driveway apron, right side' });
addStop('route_thu_ro', 'site_ro_homeowner');
addServiceItem({ id: 'si_ro_homeowner', siteId: 'site_ro_homeowner', catalogId: 'cat_ro_20yd', frequency: 'onCall', effectiveFrom: '2026-08-07', containerId: 'cont_ro_104' });
workOrders.push({ id: 'wo_ro_homeowner_deliver', siteId: 'site_ro_homeowner', kind: 'deliver', status: 'done', scheduledFor: '2026-08-07', serviceItemId: 'si_ro_homeowner', containerId: 'cont_ro_104', completedAt: at('2026-08-07', '09:30:00') });
{
  const base = 57500, fuel = pct(base, 7), taxCents = pct(base + fuel, 7);
  charges.push({
    id: 'chg_ro_homeowner_haul', accountId: 'acct_ro_homeowner', siteId: 'site_ro_homeowner', lineType: 'event', catalogId: 'cat_ro_20yd',
    description: '20 yd roll off haul, 3 tons and 30 days included', source: { type: 'serviceItem', id: 'si_ro_homeowner' }, servicedOn: '2026-08-07',
    baseCents: base, fees: [{ feeRuleId: 'fee_fuel_7pct', cents: fuel }], taxCents, totalCents: base + fuel + taxCents,
    pricing: { rateVersionId: 'rv_ro_20yd_open_haul', ruleWon: 'zoneRate' }, status: 'posted', evidenceIds: ['wo_ro_homeowner_deliver'],
  });
  const total = base + fuel + taxCents;
  invoices.push({ id: 'inv_ro_homeowner', accountId: 'acct_ro_homeowner', number: 'INV-2026-0805', chargeIds: ['chg_ro_homeowner_haul'], subtotalCents: base, feeCents: fuel, taxCents, totalCents: total, issuedAt: at('2026-08-05'), dueAt: at('2026-08-05'), postedAt: at('2026-08-05'), locked: true, deliveredVia: 'email' });
  payments.push({ id: 'pay_card_ro_homeowner', accountId: 'acct_ro_homeowner', method: 'card', cents: total, receivedAt: at('2026-08-05', '16:02:00'), status: 'settled' });
  allocations.push({ sourceType: 'payment', sourceId: 'pay_card_ro_homeowner', invoiceId: 'inv_ro_homeowner', cents: total });
}

// ---------------------------------------------------------------- generic residential accounts acct_res_001..030
const FIRST = ['Avery', 'Blake', 'Casey', 'Devon', 'Elliot', 'Frankie', 'Greer', 'Harper', 'Indigo', 'Jules', 'Kendall', 'Lane', 'Morgan', 'Noel', 'Oakley', 'Parker', 'Quinn', 'Reese', 'Sawyer', 'Tatum', 'Umber', 'Vale', 'Wren', 'Xavi', 'Yael', 'Zion', 'Adair', 'Bellamy', 'Corin', 'Darcy'];
const LAST = ['Abernathy', 'Bledsoe', 'Calloway', 'Dabney', 'Eldridge', 'Fairchild', 'Gaskins', 'Hightower', 'Ingle', 'Jessup', 'Kimbrough', 'Lockhart', 'McAfee', 'Northcutt', 'Overstreet', 'Pruitt', 'Quarles', 'Rutledge', 'Satterfield', 'Threadgill', 'Upchurch', 'Varnell', 'Whitlock', 'Yarbrough', 'Zeigler', 'Ashcraft', 'Brantley', 'Coker', 'Dorsey', 'Etheridge'];
const STREETS = ['Magnolia Ave', 'Pecan Grove Rd', 'Laurel St', 'Hickory Ln', 'Mill Creek Dr', 'Chestnut Way', 'Dogwood Cir', 'Juniper Ct'];
const pad = (n) => String(n).padStart(3, '0');

for (let n = 1; n <= 30; n += 1) {
  const id = pad(n);
  const routeId = n % 2 === 1 ? 'route_mon_res' : 'route_tue_res';
  const catalogId = n % 5 === 0 ? 'cat_res_64' : 'cat_res_96';
  const autopay = n % 2 === 0;
  parties.push({ id: `party_res_${id}`, name: `${FIRST[n - 1]} ${LAST[n - 1]}`, kind: 'homeowner' });
  accounts.push({ id: `acct_res_${id}`, payerPartyId: `party_res_${id}`, cycle: 'quarterly', billedInAdvance: true, autopay, ...(autopay ? { paymentMethodOnFile: 'card' } : {}), status: 'active', deliveryMethod: autopay ? 'email' : 'mail', taxExempt: false });
  const siteId = `site_res_${id}`;
  sites.push({ id: siteId, accountId: `acct_res_${id}`, address: `${100 + n * 7} ${STREETS[n % STREETS.length]}, Piedmont, GA 30512`, zoneId: 'zone_open', routeId });
  addStop(routeId, siteId);
  addServiceItem({ id: `si_res_${id}`, siteId, catalogId, frequency: 'weekly', effectiveFrom: FROM, containerId: `cont_res_${id}` });
}
serviceEvents.push({ id: 'se_res_014_0901', siteId: 'site_res_014', routeId: 'route_tue_res', date: '2026-09-01', outcome: 'completed', exception: 'overload', photoUrl: '/evidence/se_res_014_0901.jpg', note: 'Lid open more than 12 inches, cart overfilled', driver: 'M. Ortega' });

// ---------------------------------------------------------------- generic frontload accounts acct_fl_001..008, half with contracts
const FL_NAMES = ['Depot Street Diner', 'Ashford Auto Body', 'Larkspur Veterinary Clinic', 'Mill Creek Hardware', 'Piedmont Family Dental', 'Copper Kettle Cafe', 'Hollis Park Apartments', 'Riverside Fitness'];
const FL_ADDR = ['118 Depot St', '2200 Commerce Way', '640 Larkspur Ln', '905 Mill Creek Dr', '77 Court Square', '310 Main St', '50 Hollis Park Ln', '3720 Riverside Pkwy'];
for (let n = 1; n <= 8; n += 1) {
  const id = pad(n);
  const withContract = n % 2 === 1;
  const catalogId = n % 4 === 0 ? 'cat_fl_2yd' : 'cat_fl_3yd';
  const frequency = catalogId === 'cat_fl_2yd' ? 'weekly' : '2x';
  parties.push({ id: `party_fl_${id}`, name: FL_NAMES[n - 1], kind: 'business' });
  accounts.push({ id: `acct_fl_${id}`, payerPartyId: `party_fl_${id}`, cycle: 'monthly', billedInAdvance: true, autopay: n % 3 === 0, ...(n % 3 === 0 ? { paymentMethodOnFile: 'ach' } : {}), status: 'active', deliveryMethod: 'email', taxExempt: false, ...(withContract ? { contractId: `contract_fl_${id}` } : {}) });
  const siteId = `site_fl_${id}`;
  sites.push({ id: siteId, accountId: `acct_fl_${id}`, address: `${FL_ADDR[n - 1]}, Piedmont, GA 30512`, zoneId: 'zone_open', routeId: 'route_wed_fl' });
  addStop('route_wed_fl', siteId);
  addServiceItem({ id: `si_fl_${id}`, siteId, catalogId, frequency, effectiveFrom: '2025-01-06', containerId: `cont_fl_${id}` });
  if (withContract) {
    const listPrice = rateVersions.find((r) => r.catalogId === catalogId && r.frequency === frequency && r.zoneId === 'zone_open').priceCents;
    contracts.push({
      id: `contract_fl_${id}`, accountId: `acct_fl_${id}`, termStart: '2025-01-06', termEnd: '2027-01-05', renewalNoticeDays: 60,
      overrides: [{ catalogId, frequency, priceCents: Math.round(listPrice * 0.95), reason: 'two year term', pctBelowRateCard: 5 }],
    });
  }
}
serviceEvents.push({ id: 'se_fl_003_0909', siteId: 'site_fl_003', routeId: 'route_wed_fl', date: '2026-09-09', outcome: 'blocked', exception: 'dryRun', photoUrl: '/evidence/se_fl_003_0909.jpg', note: 'Delivery van parked across the enclosure', driver: 'T. Boudreaux' });

// ---------------------------------------------------------------- processor batch batch_0908: 14 card payments, gross $1,318.42, fees $41.20
const BATCH_AMOUNTS = [...Array(12).fill(10261), 4355, 4355]; // twelve full 96 gal quarters, two partial payments
const batchPaymentIds = [];
BATCH_AMOUNTS.forEach((cents, i) => {
  const id = `pay_card_0908_${pad(i + 1)}`;
  batchPaymentIds.push(id);
  payments.push({ id, accountId: `acct_res_${pad(i + 1)}`, method: i % 2 === 1 ? 'autopay' : 'card', cents, receivedAt: at(i < 7 ? '2026-09-06' : '2026-09-07', `${String(8 + i).padStart(2, '0')}:15:00`), processorBatchId: 'batch_0908', status: 'settled' });
});
const gross = BATCH_AMOUNTS.reduce((a, b) => a + b, 0);
if (gross !== 131842) throw new Error(`batch_0908 gross must be 131842, got ${gross}`);
batches.push({ id: 'batch_0908', depositedAt: at('2026-09-08', '06:00:00'), grossCents: gross, feeCents: 4120, netCents: gross - 4120, paymentIds: batchPaymentIds });

// ---------------------------------------------------------------- routes
const routes = [
  { id: 'route_mon_res', day: 'Mon', lob: 'residential', stopSiteIds: routeStops.route_mon_res, capacityStops: 400 },
  { id: 'route_tue_res', day: 'Tue', lob: 'residential', stopSiteIds: routeStops.route_tue_res, capacityStops: 400 },
  { id: 'route_wed_fl', day: 'Wed', lob: 'frontload', stopSiteIds: routeStops.route_wed_fl, capacityStops: 60 },
  { id: 'route_thu_ro', day: 'Thu', lob: 'rolloff', stopSiteIds: routeStops.route_thu_ro, capacityStops: 12 },
];

// ---------------------------------------------------------------- storefront addresses (storefront-only lookup table)
const addresses = [
  { id: 'addr_open_single', label: 'Single 96 gal cart, Tuesday route', line1: '412 Larkspur Ln', city: 'Piedmont', state: 'GA', zip: '30512', zoneId: 'zone_open', routeId: 'route_tue_res' },
  { id: 'addr_open_second_cart', label: 'Second cart household, Monday route', line1: '88 Copper Kettle Ct', city: 'Piedmont', state: 'GA', zip: '30512', zoneId: 'zone_open', routeId: 'route_mon_res' },
  { id: 'addr_open_recycling', label: 'Recycling add-on, Tuesday route', line1: '2071 Meadowbrook Dr', city: 'Piedmont', state: 'GA', zip: '30512', zoneId: 'zone_open', routeId: 'route_tue_res' },
  { id: 'addr_franchise', label: 'Inside the Ashford city franchise', line1: '530 Main St', city: 'Ashford', state: 'GA', zip: '30540', zoneId: 'zone_franchise', franchiseHolder: 'Southeast Sanitation' },
  { id: 'addr_boundary', label: 'Zone boundary, private road', line1: '1180 Ridge Hollow Rd', city: 'Piedmont', state: 'GA', zip: '30512', zoneId: 'zone_boundary', routeId: 'route_tue_res', boundaryReason: 'private road access' },
  { id: 'addr_commercial', label: 'Business storefront, front load route', line1: '1500 Commerce Way, Suite B', city: 'Piedmont', state: 'GA', zip: '30512', zoneId: 'zone_open', routeId: 'route_wed_fl' },
];

// ---------------------------------------------------------------- quotes
const ridge = addresses.find((a) => a.id === 'addr_boundary');
const quotes = [
  {
    id: 'quote_held_ridge', kind: 'residentialSignup', address: `${ridge.line1}, ${ridge.city}, ${ridge.state} ${ridge.zip}`, zoneId: 'zone_boundary',
    // Exactly what buildOffer computes for one 96 gal weekly cart in zone_boundary (addenda C4, D6; asserted in
    // src/store/__tests__/held.test.ts): quarter 9300 + fuel 651 + env 300 + tax 697 = 10948; plus delivery
    // 2500 + tax 175 = 13623 due today. Storefront is the source of this number for every other surface.
    lines: [{ catalogId: 'cat_res_96', qty: 1, frequency: 'weekly', priceCents: 3100 }],
    dueTodayCents: 13623, recurringCents: 10948, status: 'held', holdReason: 'confirm private road access',
    holdDeadline: at('2026-09-11', '10:00:00'), expiresAt: at('2026-09-15', '10:00:00'), paymentTokenId: 'tok_ridge_4242', createdVia: 'storefront',
  },
  {
    id: 'quote_bakery_request', kind: 'commercialRequest', address: '214 Depot St, Piedmont, GA 30512', zoneId: 'zone_open',
    lines: [{ catalogId: 'cat_fl_2yd', qty: 1, frequency: 'weekly', priceCents: 0 }],
    dueTodayCents: 0, recurringCents: 0, status: 'draft', expiresAt: at('2026-10-09', '17:00:00'), createdVia: 'storefront',
  },
];

// ---------------------------------------------------------------- write
const files = {
  'hauler.json': hauler, 'zones.json': zones, 'routes.json': routes, 'catalog.json': catalog, 'rateVersions.json': rateVersions,
  'feeRules.json': feeRules, 'taxRules.json': taxRules, 'parties.json': parties, 'accounts.json': accounts, 'sites.json': sites,
  'serviceItems.json': serviceItems, 'containers.json': containers, 'contracts.json': contracts, 'workOrders.json': workOrders,
  'serviceEvents.json': serviceEvents, 'scaleTickets.json': scaleTickets, 'charges.json': charges, 'invoices.json': invoices,
  'payments.json': payments, 'allocations.json': allocations, 'batches.json': batches, 'creditMemos.json': creditMemos,
  'waivedCharges.json': waivedCharges, 'requests.json': requests, 'quotes.json': quotes, 'addresses.json': addresses,
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 2) + '\n');
}
const counts = Object.entries(files).map(([n, d]) => `${n.replace('.json', '')}=${Array.isArray(d) ? d.length : 1}`).join(' ');
console.log(`wrote ${Object.keys(files).length} seed files to src/seed: ${counts}`);
