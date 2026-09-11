#!/usr/bin/env node
// Generates every file in src/seed/*.json deterministically. The JSON output is what ships;
// this script exists so the generic accounts and the charge math are reproducible.
// Charge math mirrors computeCharge from SHARED_CONTRACT.md and the addendum: percent fees on base, flat fees
// once per whole month in the charge's period (C5), tax on base plus taxable fees, half-up rounding after each
// percentage step (C6), late fees never taxed.
// Run: node scripts/gen_seed.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'src', 'seed');
mkdirSync(out, { recursive: true });

const TODAY = '2026-09-10';
const round = (x) => Math.floor(x + 0.5);
const write = (name, data) => writeFileSync(join(out, `${name}.json`), JSON.stringify(data, null, 2) + '\n');

// ---------- Hauler, zones, routes, catalog, rules ----------

const hauler = {
  id: 'hauler_piedmont',
  name: 'Piedmont Disposal',
  policy: { proration: 'none', lateFeeCents: 1000, lateFeeDay: 5, graceMissedPickups: 2, suspendAfterDays: 30, reinstatementFeeCents: 2500 },
};

const zones = [
  { id: 'zone_open', name: 'Piedmont city, open market', serviceability: 'open', taxRatePct: 7, franchiseFeePct: 0, deliveryFeeCents: 2500, publicPricing: true },
  { id: 'zone_boundary', name: 'County line, boundary', serviceability: 'boundary', taxRatePct: 7, franchiseFeePct: 0, deliveryFeeCents: 2500, publicPricing: true },
  { id: 'zone_franchise', name: 'Northside franchise area', serviceability: 'franchise', taxRatePct: 7, franchiseFeePct: 17, deliveryFeeCents: 2500, publicPricing: false },
  { id: 'zone_notserved', name: 'Outside service area', serviceability: 'notServed', taxRatePct: 0, franchiseFeePct: 0, deliveryFeeCents: 0, publicPricing: false },
];

const catalog = [
  { id: 'cat_res_96', lob: 'residential', name: '96 gallon trash cart', sizeLabel: '96 gal', unit: 'cart', public: true },
  { id: 'cat_res_64', lob: 'residential', name: '64 gallon trash cart', sizeLabel: '64 gal', unit: 'cart', public: true },
  { id: 'cat_res_extra_cart', lob: 'residential', name: 'Extra trash cart', sizeLabel: '96 gal', unit: 'cart', public: true },
  { id: 'cat_res_recycling', lob: 'residential', name: 'Recycling cart', sizeLabel: '96 gal', unit: 'cart', public: true },
  { id: 'cat_fl_2yd', lob: 'frontload', name: '2 yard front load container', sizeLabel: '2 yd', unit: 'container', public: false },
  { id: 'cat_fl_3yd', lob: 'frontload', name: '3 yard front load container', sizeLabel: '3 yd', unit: 'container', public: false },
  { id: 'cat_fl_3yd_wood', lob: 'frontload', name: '3 yard front load container, wood waste', sizeLabel: '3 yd', unit: 'container', public: false },
  { id: 'cat_ro_20yd', lob: 'rolloff', name: '20 yard roll off box', sizeLabel: '20 yd', unit: 'box', rolloff: { includedTons: 3, includedDays: 30, extraDayCents: 700, overageCentsPerTon: 7000 }, public: true },
];

const feeRules = [
  { id: 'fee_fuel_7pct', name: 'Fuel surcharge', kind: 'percent', value: 7, base: 'serviceLines', appliesTo: ['recurring', 'event'], taxable: true },
  { id: 'fee_env_1', name: 'Environmental fee', kind: 'flat', value: 100, base: 'serviceLines', appliesTo: ['recurring'], taxable: false },
];

const taxRules = [
  { id: 'tax_open', zoneId: 'zone_open', ratePct: 7, appliesTo: ['recurring', 'event', 'fee'] },
  { id: 'tax_boundary', zoneId: 'zone_boundary', ratePct: 7, appliesTo: ['recurring', 'event', 'fee'] },
  { id: 'tax_franchise', zoneId: 'zone_franchise', ratePct: 7, appliesTo: ['recurring', 'event', 'fee'] },
];

// Addendum B4 and D5: exception rates are a seed file, not engine constants. The first four are billing's
// canonical values; extraPickup is portal-local until shared/ names one (DECISIONS.md, Requests for shared/).
const eventRates = { extraBags: 250, overload: 1000, contamination: 2000, dryRun: 2500, extraPickup: 2500 };

const currentRates = [
  ['cat_res_96', 'weekly', 2900],
  ['cat_res_64', 'weekly', 2600],
  ['cat_res_extra_cart', 'weekly', 900],
  ['cat_res_recycling', 'eow', 1200],
  ['cat_fl_2yd', '2x', 18000],
  ['cat_fl_3yd', '2x', 22000],
  ['cat_fl_3yd_wood', '2x', 19000],
  ['cat_ro_20yd', undefined, 57500],
];
const olderRates = {
  cat_res_96: 2700,
  cat_res_64: 2400,
  cat_res_extra_cart: 800,
  cat_res_recycling: 1100,
};
const rateVersions = [];
for (const [catalogId, frequency, priceCents] of currentRates) {
  const id2026 = `rv_${catalogId.replace('cat_', '')}_2026`;
  const id2025 = `rv_${catalogId.replace('cat_', '')}_2025`;
  const hasOlder = catalogId in olderRates;
  if (hasOlder) {
    rateVersions.push({
      id: id2025, catalogId, zoneId: 'zone_open', ...(frequency ? { frequency } : {}),
      priceCents: olderRates[catalogId], effectiveFrom: '2025-01-01', status: 'published', publishedAt: '2024-12-15T09:00:00',
    });
  }
  rateVersions.push({
    id: id2026, catalogId, zoneId: 'zone_open', ...(frequency ? { frequency } : {}),
    priceCents, effectiveFrom: '2026-01-01', status: 'published', publishedAt: '2025-12-10T09:00:00',
    ...(hasOlder ? { supersedesId: id2025 } : {}),
  });
}
const rateFor = (catalogId) => currentRates.find((r) => r[0] === catalogId)[2];
const rateVersionIdFor = (catalogId) => `rv_${catalogId.replace('cat_', '')}_2026`;

// ---------- Charge math (mirror of computeCharge) ----------

// Whole calendar months covered by a period (start on the 1st, end on a month end). A servicedOn line is one month.
function monthsInPeriod(period) {
  if (!period) return 1;
  const [sy, sm] = period.start.split('-').map(Number);
  const [ey, em] = period.end.split('-').map(Number);
  return Math.max(1, (ey - sy) * 12 + (em - sm) + 1);
}

function computeCharge({ id, accountId, siteId, lineType, catalogId, description, source, period, servicedOn, baseCents, pricing, taxExempt = false, zoneId = 'zone_open', status = 'posted' }) {
  const fees = [];
  if (lineType !== 'lateFee') {
    for (const rule of feeRules) {
      if (!rule.appliesTo.includes(lineType)) continue;
      const cents = rule.kind === 'percent' ? round((baseCents * rule.value) / 100) : rule.value * monthsInPeriod(period);
      fees.push({ feeRuleId: rule.id, cents });
    }
  }
  let taxCents = 0;
  const taxRule = taxRules.find((t) => t.zoneId === zoneId);
  if (lineType !== 'lateFee' && !taxExempt && taxRule && taxRule.appliesTo.includes(lineType)) {
    const taxableFees = fees.reduce((sum, f) => sum + (feeRules.find((r) => r.id === f.feeRuleId).taxable ? f.cents : 0), 0);
    taxCents = round(((baseCents + taxableFees) * taxRule.ratePct) / 100);
  }
  const totalCents = baseCents + fees.reduce((s, f) => s + f.cents, 0) + taxCents;
  return {
    id, accountId, siteId, lineType, ...(catalogId ? { catalogId } : {}), description, source,
    ...(period ? { period } : {}), ...(servicedOn ? { servicedOn } : {}),
    baseCents, fees, taxCents, totalCents, pricing, status, evidenceIds: [],
  };
}

function buildInvoice({ id, accountId, number, charges, issuedAt, dueAt, deliveredVia }) {
  const subtotalCents = charges.reduce((s, c) => s + c.baseCents, 0);
  const feeCents = charges.reduce((s, c) => s + c.fees.reduce((a, f) => a + f.cents, 0), 0);
  const taxCents = charges.reduce((s, c) => s + c.taxCents, 0);
  const totalCents = charges.reduce((s, c) => s + c.totalCents, 0);
  return { id, accountId, number, chargeIds: charges.map((c) => c.id), subtotalCents, feeCents, taxCents, totalCents, issuedAt, dueAt, postedAt: `${issuedAt}T06:00:00`, locked: true, deliveredVia };
}

// ---------- Tables ----------

const parties = [];
const accounts = [];
const sites = [];
const containers = [];
const serviceItems = [];
const contracts = [];
const charges = [];
const invoices = [];
const payments = [];
const allocations = [];
const batches = [];
const workOrders = [];
const requests = [];
const scaleTickets = [];
const serviceEvents = [];
const routeStops = { route_mon_res: [], route_tue_res: [], route_wed_fl: [], route_thu_ro: [] };

let containerSeq = 1000;
function addContainer(catalogId, siteId, assignedFrom, prefix) {
  containerSeq += 1;
  const c = { id: `cont_${containerSeq}`, serial: `${prefix}-${containerSeq}`, catalogId, siteId, assignedFrom };
  containers.push(c);
  return c;
}
const serialPrefix = { cat_res_96: 'PD96', cat_res_64: 'PD64', cat_res_extra_cart: 'PD96', cat_res_recycling: 'PDRC', cat_fl_2yd: 'FL2', cat_fl_3yd: 'FL3', cat_fl_3yd_wood: 'FL3W', cat_ro_20yd: 'RO20' };

function addServiceItem({ id, siteId, catalogId, frequency, effectiveFrom, status = 'active', qty = 1, effectiveTo, containerCount = qty }) {
  const items = [];
  for (let i = 0; i < containerCount; i += 1) items.push(addContainer(catalogId, siteId, effectiveFrom, serialPrefix[catalogId]).id);
  const si = { id, siteId, catalogId, qty, frequency, containerIds: items, effectiveFrom, ...(effectiveTo ? { effectiveTo } : {}), status };
  serviceItems.push(si);
  return si;
}

// ---------- Named accounts ----------

// acct_res_maple
parties.push({ id: 'party_maple', name: 'Dana Maple', kind: 'homeowner' });
accounts.push({ id: 'acct_res_maple', payerPartyId: 'party_maple', cycle: 'quarterly', billedInAdvance: true, autopay: false, paymentMethodOnFile: 'card', status: 'pastDue', deliveryMethod: 'portal', taxExempt: false });
sites.push({ id: 'site_maple', accountId: 'acct_res_maple', occupantPartyId: 'party_maple', address: '412 Maple Hollow Ln', zoneId: 'zone_open', routeId: 'route_mon_res', accessNotes: 'Cart at end of driveway, left of mailbox' });
routeStops.route_mon_res.push('site_maple');
const mapleTrash = addServiceItem({ id: 'si_maple_96', siteId: 'site_maple', catalogId: 'cat_res_96', frequency: 'weekly', effectiveFrom: '2024-03-04' });
const mapleExtra = addServiceItem({ id: 'si_maple_extra', siteId: 'site_maple', catalogId: 'cat_res_extra_cart', frequency: 'weekly', effectiveFrom: '2025-06-02' });
const mapleRecycling = addServiceItem({ id: 'si_maple_recycling', siteId: 'site_maple', catalogId: 'cat_res_recycling', frequency: 'eow', effectiveFrom: '2024-03-04' });

function quarterlyCharge(id, accountId, siteId, si, period, label) {
  const monthly = rateFor(si.catalogId);
  return computeCharge({
    id, accountId, siteId, lineType: 'recurring', catalogId: si.catalogId,
    description: `${label}, ${si.frequency === 'eow' ? 'every other week' : 'weekly'}, ${period.start} to ${period.end}`,
    source: { type: 'serviceItem', id: si.id }, period, baseCents: monthly * 3,
    pricing: { rateVersionId: rateVersionIdFor(si.catalogId), ruleWon: 'zoneRate' },
  });
}
const catName = Object.fromEntries(catalog.map((c) => [c.id, c.name]));

const q2 = { start: '2026-04-01', end: '2026-06-30' };
const q3 = { start: '2026-07-01', end: '2026-09-30' };
const mapleQ2Charges = [
  quarterlyCharge('chg_maple_q2_96', 'acct_res_maple', 'site_maple', mapleTrash, q2, catName.cat_res_96),
  quarterlyCharge('chg_maple_q2_extra', 'acct_res_maple', 'site_maple', mapleExtra, q2, catName.cat_res_extra_cart),
  quarterlyCharge('chg_maple_q2_recycling', 'acct_res_maple', 'site_maple', mapleRecycling, q2, catName.cat_res_recycling),
];
const mapleQ3Charges = [
  quarterlyCharge('chg_maple_q3_96', 'acct_res_maple', 'site_maple', mapleTrash, q3, catName.cat_res_96),
  quarterlyCharge('chg_maple_q3_extra', 'acct_res_maple', 'site_maple', mapleExtra, q3, catName.cat_res_extra_cart),
  quarterlyCharge('chg_maple_q3_recycling', 'acct_res_maple', 'site_maple', mapleRecycling, q3, catName.cat_res_recycling),
  computeCharge({
    id: 'chg_maple_q3_latefee', accountId: 'acct_res_maple', siteId: 'site_maple', lineType: 'lateFee',
    description: 'Late fee, balance unpaid 5 days after the due date (hauler policy)',
    source: { type: 'manual', id: 'hauler_piedmont' }, servicedOn: '2026-07-20', baseCents: hauler.policy.lateFeeCents,
    pricing: { ruleWon: 'standardRate' },
  }),
];
charges.push(...mapleQ2Charges, ...mapleQ3Charges);
const invMapleQ2 = buildInvoice({ id: 'inv_maple_2026q2', accountId: 'acct_res_maple', number: 'INV-2026-0412', charges: mapleQ2Charges, issuedAt: '2026-04-01', dueAt: '2026-04-15', deliveredVia: 'portal' });
const invMapleQ3 = buildInvoice({ id: 'inv_maple_2026q3', accountId: 'acct_res_maple', number: 'INV-2026-0711', charges: mapleQ3Charges, issuedAt: '2026-07-01', dueAt: '2026-07-15', deliveredVia: 'portal' });
invoices.push(invMapleQ2, invMapleQ3);
payments.push({ id: 'pay_card_maple_q2', accountId: 'acct_res_maple', method: 'card', cents: invMapleQ2.totalCents, receivedAt: '2026-04-09T14:22:00', status: 'settled' });
allocations.push({ sourceType: 'payment', sourceId: 'pay_card_maple_q2', invoiceId: 'inv_maple_2026q2', cents: invMapleQ2.totalCents });
const MAPLE_OPEN = 8745;
const maplePartial = invMapleQ3.totalCents - MAPLE_OPEN;
payments.push({ id: 'pay_card_maple_partial', accountId: 'acct_res_maple', method: 'card', cents: maplePartial, receivedAt: '2026-07-28T09:05:00', status: 'settled' });
allocations.push({ sourceType: 'payment', sourceId: 'pay_card_maple_partial', invoiceId: 'inv_maple_2026q3', cents: maplePartial });

// acct_res_holt
parties.push({ id: 'party_holt', name: 'Marcus Holt', kind: 'homeowner' });
accounts.push({ id: 'acct_res_holt', payerPartyId: 'party_holt', cycle: 'monthly', billedInAdvance: true, autopay: true, paymentMethodOnFile: 'card', status: 'hold', deliveryMethod: 'email', taxExempt: false });
sites.push({ id: 'site_holt', accountId: 'acct_res_holt', occupantPartyId: 'party_holt', address: '77 Brookside Ct', zoneId: 'zone_open', routeId: 'route_mon_res' });
routeStops.route_mon_res.push('site_holt');
addServiceItem({ id: 'si_holt_96', siteId: 'site_holt', catalogId: 'cat_res_96', frequency: 'weekly', effectiveFrom: '2023-09-04', status: 'held' });
requests.push({ id: 'req_holt_hold', accountId: 'acct_res_holt', siteId: 'site_holt', kind: 'vacationHold', status: 'open', createdVia: 'portal', note: 'Vacation hold requested 2026-09-14 to 2026-09-28, pickups resume 2026-10-05' });

// acct_res_kerr
parties.push({ id: 'party_kerr', name: 'Linda Kerr', kind: 'homeowner' });
accounts.push({ id: 'acct_res_kerr', payerPartyId: 'party_kerr', cycle: 'monthly', billedInAdvance: true, autopay: false, status: 'suspended', deliveryMethod: 'mail', taxExempt: false });
sites.push({ id: 'site_kerr', accountId: 'acct_res_kerr', occupantPartyId: 'party_kerr', address: '1509 Old Mill Rd', zoneId: 'zone_open', routeId: 'route_tue_res' });
routeStops.route_tue_res.push('site_kerr');
addServiceItem({ id: 'si_kerr_96', siteId: 'site_kerr', catalogId: 'cat_res_96', frequency: 'weekly', effectiveFrom: '2022-05-03' });

// acct_bakery
parties.push({ id: 'party_bakery', name: 'Sunrise Bakery', kind: 'business' });
accounts.push({ id: 'acct_bakery', payerPartyId: 'party_bakery', cycle: 'monthly', billedInAdvance: false, autopay: false, paymentMethodOnFile: 'ach', status: 'active', deliveryMethod: 'email', taxExempt: false, contractId: 'contract_bakery' });
sites.push({ id: 'site_bakery', accountId: 'acct_bakery', occupantPartyId: 'party_bakery', address: '220 Commerce St', zoneId: 'zone_open', routeId: 'route_wed_fl', accessNotes: 'Enclosure behind the loading dock, gate code 4411' });
routeStops.route_wed_fl.push('site_bakery');
addServiceItem({ id: 'si_bakery_3yd', siteId: 'site_bakery', catalogId: 'cat_fl_3yd', frequency: '2x', effectiveFrom: '2025-02-01' });
const bakeryWood = addServiceItem({ id: 'si_bakery_3yd_wood', siteId: 'site_bakery', catalogId: 'cat_fl_3yd_wood', frequency: '2x', effectiveFrom: '2025-02-01' });
contracts.push({
  id: 'contract_bakery', accountId: 'acct_bakery', termStart: '2025-02-01', termEnd: '2027-01-31', renewalNoticeDays: 60,
  overrides: [
    { catalogId: 'cat_fl_3yd', frequency: '2x', priceCents: round(22000 * 0.9), reason: 'competitive match', pctBelowRateCard: 10 },
    { catalogId: 'cat_fl_3yd_wood', frequency: '2x', priceCents: round(19000 * 0.9), reason: 'competitive match', pctBelowRateCard: 10 },
  ],
  escalator: { kind: 'fixedPct', pct: 4, anniversary: '2027-01-01' },
});

// acct_pm_oakridge
parties.push({ id: 'party_oakridge', name: 'Oakridge Property Management', kind: 'propertyManager' });
accounts.push({ id: 'acct_pm_oakridge', payerPartyId: 'party_oakridge', cycle: 'net30', billedInAdvance: false, autopay: false, paymentMethodOnFile: 'ach', status: 'active', deliveryMethod: 'portal', taxExempt: false });
const oakSites = [
  { n: 1, address: '100 Oakridge Commons, Bldg A', po: 'PO-OAK-1041', cat: 'cat_fl_3yd' },
  { n: 2, address: '100 Oakridge Commons, Bldg B', po: 'PO-OAK-1042', cat: 'cat_fl_2yd' },
  { n: 3, address: '35 Ridgeview Plaza', po: 'PO-OAK-1107', cat: 'cat_fl_3yd' },
  { n: 4, address: '8 Elmwood Terrace Apartments', po: 'PO-OAK-1210', cat: 'cat_fl_2yd' },
];
const oakItems = [];
for (const s of oakSites) {
  const siteId = `site_oak_${s.n}`;
  sites.push({ id: siteId, accountId: 'acct_pm_oakridge', occupantPartyId: 'party_oakridge', address: s.address, zoneId: 'zone_open', routeId: 'route_wed_fl', poNumber: s.po, accessNotes: 'Enclosure keyed, driver has key 12' });
  routeStops.route_wed_fl.push(siteId);
  oakItems.push({ site: s, siteId, si: addServiceItem({ id: `si_oak_${s.n}`, siteId, catalogId: s.cat, frequency: '2x', effectiveFrom: '2024-01-01' }) });
}
const oakMonths = [
  { id: 'inv_oak_2026_06', number: 'INV-2026-0603', issuedAt: '2026-06-01', dueAt: '2026-07-01', period: { start: '2026-05-01', end: '2026-05-31' }, tag: '2026_06' },
  { id: 'inv_oak_2026_07', number: 'INV-2026-0704', issuedAt: '2026-07-01', dueAt: '2026-07-31', period: { start: '2026-06-01', end: '2026-06-30' }, tag: '2026_07' },
  { id: 'inv_oak_2026_08', number: 'INV-2026-0802', issuedAt: '2026-08-01', dueAt: '2026-08-31', period: { start: '2026-07-01', end: '2026-07-31' }, tag: '2026_08' },
  { id: 'inv_oak_2026_09', number: 'INV-2026-0905', issuedAt: '2026-09-01', dueAt: '2026-10-01', period: { start: '2026-08-01', end: '2026-08-31' }, tag: '2026_09' },
];
const oakInvoices = [];
for (const m of oakMonths) {
  const monthCharges = oakItems.map(({ site, siteId, si }) =>
    computeCharge({
      id: `chg_oak_${m.tag}_s${site.n}`, accountId: 'acct_pm_oakridge', siteId, lineType: 'recurring', catalogId: si.catalogId,
      description: `${catName[si.catalogId]}, 2x weekly, ${site.address}, ${site.po}, ${m.period.start} to ${m.period.end}`,
      source: { type: 'serviceItem', id: si.id }, period: m.period, baseCents: rateFor(si.catalogId),
      pricing: { rateVersionId: rateVersionIdFor(si.catalogId), ruleWon: 'zoneRate' },
    }));
  charges.push(...monthCharges);
  const inv = buildInvoice({ id: m.id, accountId: 'acct_pm_oakridge', number: m.number, charges: monthCharges, issuedAt: m.issuedAt, dueAt: m.dueAt, deliveredVia: 'portal' });
  invoices.push(inv);
  oakInvoices.push(inv);
}
const paidOak = oakInvoices.slice(0, 3);
const checkTotal = paidOak.reduce((s, i) => s + i.totalCents, 0);
payments.push({ id: 'pay_chk_oakridge', accountId: 'acct_pm_oakridge', method: 'check', cents: checkTotal, receivedAt: '2026-08-28T11:00:00', status: 'settled' });
for (const inv of paidOak) allocations.push({ sourceType: 'payment', sourceId: 'pay_chk_oakridge', invoiceId: inv.id, cents: inv.totalCents });

// acct_contractor_hale
parties.push({ id: 'party_hale', name: 'Hale Construction LLC', kind: 'contractor' });
accounts.push({ id: 'acct_contractor_hale', payerPartyId: 'party_hale', cycle: 'net30', billedInAdvance: false, autopay: false, paymentMethodOnFile: 'ach', status: 'active', deliveryMethod: 'email', taxExempt: false });
sites.push({ id: 'site_hale_job1', accountId: 'acct_contractor_hale', occupantPartyId: 'party_hale', address: '900 Riverbend Pkwy, lot 14', zoneId: 'zone_open', routeId: 'route_thu_ro', poNumber: 'HALE-JOB-2231', accessNotes: 'Site trailer on the left, boxes staged by the fence' });
sites.push({ id: 'site_hale_job2', accountId: 'acct_contractor_hale', occupantPartyId: 'party_hale', address: '61 Quarry Rd', zoneId: 'zone_open', routeId: 'route_thu_ro', poNumber: 'HALE-JOB-2240' });
routeStops.route_thu_ro.push('site_hale_job1', 'site_hale_job2');
const haleJob1 = addServiceItem({ id: 'si_hale_job1_ro', siteId: 'site_hale_job1', catalogId: 'cat_ro_20yd', frequency: 'onCall', effectiveFrom: '2026-08-03', qty: 2, containerCount: 2 });
const haleJob2 = addServiceItem({ id: 'si_hale_job2_ro', siteId: 'site_hale_job2', catalogId: 'cat_ro_20yd', frequency: 'onCall', effectiveFrom: '2026-08-20', qty: 1, containerCount: 1 });
workOrders.push(
  { id: 'wo_hale_job1_haul1', siteId: 'site_hale_job1', kind: 'dumpAndReturn', status: 'done', scheduledFor: '2026-08-27', serviceItemId: haleJob1.id, containerId: haleJob1.containerIds[0], completedAt: '2026-08-27T13:40:00' },
  { id: 'wo_hale_job2_haul1', siteId: 'site_hale_job2', kind: 'dumpAndReturn', status: 'done', scheduledFor: '2026-09-03', serviceItemId: haleJob2.id, containerId: haleJob2.containerIds[0], completedAt: '2026-09-03T15:05:00' },
);
scaleTickets.push(
  { id: 'st_hale_0827', workOrderId: 'wo_hale_job1_haul1', containerId: haleJob1.containerIds[0], facility: 'Piedmont Transfer Station', material: 'C&D', grossLbs: 26400, tareLbs: 18000, netLbs: 8400, ticketedAt: '2026-08-27T14:12:00' },
  { id: 'st_hale_0903', workOrderId: 'wo_hale_job2_haul1', containerId: haleJob2.containerIds[0], facility: 'Piedmont Transfer Station', material: 'C&D', grossLbs: 25100, tareLbs: 18000, netLbs: 7100, ticketedAt: '2026-09-03T15:48:00' },
);

// acct_ro_homeowner
parties.push({ id: 'party_raman', name: 'Priya Raman', kind: 'homeowner' });
accounts.push({ id: 'acct_ro_homeowner', payerPartyId: 'party_raman', cycle: 'perJob', billedInAdvance: true, autopay: false, paymentMethodOnFile: 'card', status: 'active', deliveryMethod: 'email', taxExempt: false });
sites.push({ id: 'site_raman', accountId: 'acct_ro_homeowner', occupantPartyId: 'party_raman', address: '34 Larkspur Dr', zoneId: 'zone_open', routeId: 'route_thu_ro', accessNotes: 'Box on the driveway apron, keep clear of the garage door' });
routeStops.route_thu_ro.push('site_raman');
const ramanBox = addServiceItem({ id: 'si_raman_ro', siteId: 'site_raman', catalogId: 'cat_ro_20yd', frequency: 'onCall', effectiveFrom: '2026-08-07' });
workOrders.push({ id: 'wo_raman_deliver', siteId: 'site_raman', kind: 'deliver', status: 'done', scheduledFor: '2026-08-07', serviceItemId: ramanBox.id, containerId: ramanBox.containerIds[0], completedAt: '2026-08-07T10:20:00' });

// ---------- Generic residential accounts ----------

const firstNames = ['Avery', 'Jordan', 'Riley', 'Casey', 'Morgan', 'Taylor', 'Quinn', 'Reese', 'Parker', 'Emerson', 'Hayden', 'Rowan', 'Sawyer', 'Finley', 'Blake'];
const lastNames = ['Nguyen', 'Patel', 'Okafor', 'Garcia', 'Lindqvist', 'Brennan', 'Castillo', 'Whitfield', 'Tanaka', 'Duval', 'Mbeki', 'Sorensen', 'Ibarra', 'Kowalski', 'Adeyemi'];
const streets = ['Pine Ridge Rd', 'Cedar Loop', 'Willow Bend', 'Hickory Ct', 'Laurel Ave', 'Sycamore Way', 'Birch Hollow', 'Chestnut St', 'Poplar Trl', 'Magnolia Pl'];

// Deterministic config per generic account. Alternate size, cycle, and add-ons so invoice totals vary.
const genericRes = [];
for (let i = 1; i <= 30; i += 1) {
  const n = String(i).padStart(3, '0');
  const cat = i % 3 === 0 ? 'cat_res_64' : 'cat_res_96';
  const cycle = i % 2 === 0 ? 'quarterly' : 'monthly';
  const recycling = i % 4 === 0 || i % 5 === 0;
  const extraCart = i % 7 === 0;
  const routeId = i <= 15 ? 'route_mon_res' : 'route_tue_res';
  genericRes.push({ i, n, cat, cycle, recycling, extraCart, routeId });
}

const genericInvoiceByAccount = {};
for (const g of genericRes) {
  const accountId = `acct_res_${g.n}`;
  const partyId = `party_res_${g.n}`;
  const siteId = `site_res_${g.n}`;
  parties.push({ id: partyId, name: `${firstNames[g.i % 15]} ${lastNames[(g.i * 7) % 15]}`, kind: 'homeowner' });
  accounts.push({ id: accountId, payerPartyId: partyId, cycle: g.cycle, billedInAdvance: true, autopay: g.i % 3 === 1, paymentMethodOnFile: g.i % 6 === 5 ? 'ach' : 'card', status: 'active', deliveryMethod: g.i % 4 === 0 ? 'email' : 'portal', taxExempt: false });
  sites.push({ id: siteId, accountId, occupantPartyId: partyId, address: `${100 + g.i * 13} ${streets[g.i % 10]}`, zoneId: 'zone_open', routeId: g.routeId });
  routeStops[g.routeId].push(siteId);
  const items = [addServiceItem({ id: `si_res_${g.n}_trash`, siteId, catalogId: g.cat, frequency: 'weekly', effectiveFrom: '2025-03-03' })];
  if (g.recycling) items.push(addServiceItem({ id: `si_res_${g.n}_recycling`, siteId, catalogId: 'cat_res_recycling', frequency: 'eow', effectiveFrom: '2025-03-03' }));
  if (g.extraCart) items.push(addServiceItem({ id: `si_res_${g.n}_extra`, siteId, catalogId: 'cat_res_extra_cart', frequency: 'weekly', effectiveFrom: '2025-09-01' }));

  const months = g.cycle === 'quarterly' ? 3 : 1;
  const period = g.cycle === 'quarterly' ? q3 : { start: '2026-09-01', end: '2026-09-30' };
  const issuedAt = g.cycle === 'quarterly' ? '2026-07-01' : '2026-09-01';
  const dueAt = g.cycle === 'quarterly' ? '2026-07-15' : '2026-09-15';
  const invCharges = items.map((si, k) =>
    computeCharge({
      id: `chg_res_${g.n}_${k}`, accountId, siteId, lineType: 'recurring', catalogId: si.catalogId,
      description: `${catName[si.catalogId]}, ${si.frequency === 'eow' ? 'every other week' : 'weekly'}, ${period.start} to ${period.end}`,
      source: { type: 'serviceItem', id: si.id }, period, baseCents: rateFor(si.catalogId) * months,
      pricing: { rateVersionId: rateVersionIdFor(si.catalogId), ruleWon: 'zoneRate' },
    }));
  charges.push(...invCharges);
  const inv = buildInvoice({ id: `inv_res_${g.n}_current`, accountId, number: `INV-2026-1${g.n}`, charges: invCharges, issuedAt, dueAt, deliveredVia: 'portal' });
  invoices.push(inv);
  genericInvoiceByAccount[accountId] = inv;
}

// batch_0908: 14 card payments summing exactly to 131842. No 14-subset of the generic invoice totals
// hits that number, so the batch is 13 full invoice payments plus one partial payment on a larger
// invoice (a customer paying part of a quarterly bill). Logged in DECISIONS.md.
const BATCH_GROSS = 131842;
const BATCH_FEES = 4120;
const candidates = Object.values(genericInvoiceByAccount);
function pickSubset(items, count, target) {
  const layers = Array.from({ length: count + 1 }, () => new Map());
  layers[0].set(0, []);
  for (let idx = 0; idx < items.length; idx += 1) {
    const v = items[idx].totalCents;
    for (let c = count - 1; c >= 0; c -= 1) {
      for (const [sum, list] of layers[c]) {
        const ns = sum + v;
        if (ns >= target) continue;
        if (!layers[c + 1].has(ns)) layers[c + 1].set(ns, [...list, idx]);
      }
    }
  }
  // Prefer the largest remainder that still fits inside some unused invoice (a believable partial payment).
  let best = null;
  for (const [sum, list] of layers[count]) {
    const remainder = target - sum;
    const used = new Set(list);
    const partial = items.map((it, idx) => ({ it, idx })).find(({ it, idx }) => !used.has(idx) && it.totalCents >= remainder && remainder >= 100);
    if (partial && (!best || remainder > best.remainder)) best = { full: list.map((i) => items[i]), partial: partial.it, remainder };
  }
  return best;
}
const picked = pickSubset(candidates, 13, BATCH_GROSS);
if (!picked) throw new Error('No 13-invoice subset plus partial reaches the batch gross; adjust generic configs');
const batchPaymentIds = [];
const batchPlan = [...picked.full.map((inv) => ({ inv, cents: inv.totalCents })), { inv: picked.partial, cents: picked.remainder }];
batchPlan.forEach(({ inv, cents }, k) => {
  const payId = `pay_card_batch_${String(k + 1).padStart(2, '0')}`;
  const day = k < 7 ? '07' : '08';
  payments.push({ id: payId, accountId: inv.accountId, method: k % 5 === 4 ? 'autopay' : 'card', cents, receivedAt: `2026-09-${day}T${String(8 + (k % 9)).padStart(2, '0')}:${String((k * 11) % 60).padStart(2, '0')}:00`, processorBatchId: 'batch_0908', status: 'settled' });
  allocations.push({ sourceType: 'payment', sourceId: payId, invoiceId: inv.id, cents });
  batchPaymentIds.push(payId);
});
batches.push({ id: 'batch_0908', depositedAt: '2026-09-08T18:30:00', grossCents: BATCH_GROSS, feeCents: BATCH_FEES, netCents: BATCH_GROSS - BATCH_FEES, paymentIds: batchPaymentIds });

// ---------- Generic frontload accounts ----------

const bizNames = ['Riverbend Auto Care', 'Copper Kettle Diner', 'Northgate Pharmacy', 'Elm Street Hardware', 'Blue Heron Veterinary', 'Summit Fitness', 'Harbor Print Shop', 'Lakeside Dental'];
const bizStreets = ['1400 Industrial Blvd', '52 Main St', '780 Northgate Dr', '215 Elm St', '99 Heron Way', '3300 Summit Ave', '17 Harbor Ln', '640 Lakeside Rd'];
for (let i = 1; i <= 8; i += 1) {
  const n = String(i).padStart(3, '0');
  const accountId = `acct_fl_${n}`;
  const partyId = `party_fl_${n}`;
  const siteId = `site_fl_${n}`;
  const cat = i % 2 === 0 ? 'cat_fl_3yd' : 'cat_fl_2yd';
  const hasContract = i % 2 === 1;
  parties.push({ id: partyId, name: bizNames[i - 1], kind: 'business' });
  accounts.push({ id: accountId, payerPartyId: partyId, cycle: 'monthly', billedInAdvance: false, autopay: i % 3 === 0, paymentMethodOnFile: i % 3 === 0 ? 'ach' : undefined, status: 'active', deliveryMethod: 'email', taxExempt: false, ...(hasContract ? { contractId: `contract_fl_${n}` } : {}) });
  sites.push({ id: siteId, accountId, occupantPartyId: partyId, address: bizStreets[i - 1], zoneId: 'zone_open', routeId: 'route_wed_fl' });
  routeStops.route_wed_fl.push(siteId);
  addServiceItem({ id: `si_fl_${n}`, siteId, catalogId: cat, frequency: '2x', effectiveFrom: '2025-01-01' });
  if (hasContract) {
    const pct = 5 + i;
    contracts.push({
      id: `contract_fl_${n}`, accountId, termStart: '2025-01-01', termEnd: '2026-12-31', renewalNoticeDays: 60,
      overrides: [{ catalogId: cat, frequency: '2x', priceCents: round(rateFor(cat) * (1 - pct / 100)), reason: 'multi-year term', pctBelowRateCard: pct }],
      escalator: { kind: 'fixedPct', pct: 4, anniversary: '2027-01-01' },
    });
  }
}

// ---------- Routes ----------

const routes = [
  { id: 'route_mon_res', day: 'Mon', lob: 'residential', stopSiteIds: routeStops.route_mon_res, capacityStops: routeStops.route_mon_res.length + 8 },
  { id: 'route_tue_res', day: 'Tue', lob: 'residential', stopSiteIds: routeStops.route_tue_res, capacityStops: routeStops.route_tue_res.length + 4 },
  { id: 'route_wed_fl', day: 'Wed', lob: 'frontload', stopSiteIds: routeStops.route_wed_fl, capacityStops: routeStops.route_wed_fl.length + 6 },
  { id: 'route_thu_ro', day: 'Thu', lob: 'rolloff', stopSiteIds: routeStops.route_thu_ro, capacityStops: routeStops.route_thu_ro.length + 5 },
];

// ---------- Service events, window 2026-08-17 to 2026-09-10 ----------

const PHOTOS = {
  extraBags: 'photos/extra-bags.svg',
  blocked: 'photos/blocked-driveway.svg',
  completed: 'photos/completed-cart-at-curb.svg',
  contamination: 'photos/contamination.svg',
};
let evSeq = 0;
function ev(fields) {
  evSeq += 1;
  serviceEvents.push({ id: `ev_${String(evSeq).padStart(4, '0')}`, ...fields });
}

// Maple, route_mon_res
ev({ siteId: 'site_maple', routeId: 'route_mon_res', date: '2026-08-17T07:38:00', outcome: 'completed', exception: 'extraBags', photoUrl: PHOTOS.extraBags, note: 'Three bags beside the cart, all taken', driver: 'R. Alvarez' });
ev({ siteId: 'site_maple', routeId: 'route_mon_res', date: '2026-08-24T00:00:00', outcome: 'missed', note: 'Stop skipped, truck full, no photo', driver: 'R. Alvarez' });
ev({ siteId: 'site_maple', routeId: 'route_mon_res', date: '2026-08-31T07:42:00', outcome: 'completed', photoUrl: PHOTOS.completed, note: 'Cart emptied and returned to the curb', driver: 'R. Alvarez' });
ev({ siteId: 'site_maple', routeId: 'route_mon_res', date: '2026-09-07T07:51:00', outcome: 'blocked', photoUrl: PHOTOS.blocked, note: 'Cart blocked by a parked vehicle in the driveway, could not reach it', driver: 'R. Alvarez' });

// Holt, route_mon_res: served until the hold
ev({ siteId: 'site_holt', routeId: 'route_mon_res', date: '2026-08-17T07:44:00', outcome: 'completed', driver: 'R. Alvarez' });
ev({ siteId: 'site_holt', routeId: 'route_mon_res', date: '2026-08-24T07:41:00', outcome: 'completed', driver: 'R. Alvarez' });
ev({ siteId: 'site_holt', routeId: 'route_mon_res', date: '2026-08-31T07:49:00', outcome: 'completed', driver: 'R. Alvarez' });
ev({ siteId: 'site_holt', routeId: 'route_mon_res', date: '2026-09-07T07:57:00', outcome: 'completed', driver: 'R. Alvarez' });

// Kerr, route_tue_res: suspended, every Tuesday in the window
for (const d of ['2026-08-18', '2026-08-25', '2026-09-01', '2026-09-08']) {
  ev({ siteId: 'site_kerr', routeId: 'route_tue_res', date: `${d}T08:30:00`, outcome: 'skippedSuspended', note: 'Account suspended, stop skipped per policy', driver: 'T. Boyd' });
}

// Overload at acct_res_014 (route_mon_res)
ev({ siteId: 'site_res_014', routeId: 'route_mon_res', date: '2026-08-31T08:20:00', outcome: 'completed', exception: 'overload', photoUrl: PHOTOS.extraBags, note: 'Lid open more than a foot, cart over the weight limit', driver: 'R. Alvarez' });

// Dry runs: acct_fl_003 (Wed) and acct_contractor_hale (Thu)
ev({ siteId: 'site_fl_003', routeId: 'route_wed_fl', date: '2026-09-02T06:15:00', outcome: 'blocked', exception: 'dryRun', note: 'Delivery truck parked in front of the enclosure, could not service', driver: 'M. Okoro' });
ev({ siteId: 'site_hale_job1', routeId: 'route_thu_ro', date: '2026-09-03T09:40:00', outcome: 'blocked', exception: 'dryRun', note: 'Box not accessible, crane truck staged in the pull lane', driver: 'D. Pruitt' });

// Contamination at the bakery wood container (Wed)
ev({ siteId: 'site_bakery', routeId: 'route_wed_fl', date: '2026-09-09T05:52:00', outcome: 'completed', exception: 'contamination', photoUrl: PHOTOS.contamination, note: `Plastic film and food waste in the wood container ${containers.find((c) => c.id === bakeryWood.containerIds[0]).serial}`, driver: 'M. Okoro' });
ev({ siteId: 'site_bakery', routeId: 'route_wed_fl', date: '2026-09-02T05:50:00', outcome: 'completed', driver: 'M. Okoro' });

// Oakridge sites, completed on both Wednesdays
for (const { siteId } of oakItems) {
  ev({ siteId, routeId: 'route_wed_fl', date: '2026-09-02T06:30:00', outcome: 'completed', driver: 'M. Okoro' });
  ev({ siteId, routeId: 'route_wed_fl', date: '2026-09-09T06:28:00', outcome: 'completed', driver: 'M. Okoro' });
}

// ---------- Quotes ----------

const quotes = [
  {
    id: 'quote_held_ridge', kind: 'residentialSignup', address: '18 Ridge Hollow Rd', zoneId: 'zone_boundary',
    lines: [{ catalogId: 'cat_res_96', qty: 1, frequency: 'weekly', priceCents: 2900 }],
    dueTodayCents: 2900 * 3 + 2500, recurringCents: 2900, status: 'held',
    holdReason: 'confirm private road access', holdDeadline: '2026-09-11T10:00:00', expiresAt: '2026-09-24T23:59:59',
    paymentTokenId: 'tok_ridge_7f31', createdVia: 'storefront',
  },
  {
    id: 'quote_bakery_request', kind: 'commercialRequest', address: '220 Commerce St', zoneId: 'zone_open',
    lines: [{ catalogId: 'cat_fl_2yd', qty: 1, frequency: '3x', priceCents: 0 }],
    dueTodayCents: 0, recurringCents: 0, status: 'draft', expiresAt: '2026-10-10T23:59:59', createdVia: 'storefront',
  },
];

// ---------- Write ----------

write('hauler', hauler);
write('zones', zones);
write('routes', routes);
write('catalog', catalog);
write('rateVersions', rateVersions);
write('feeRules', feeRules);
write('taxRules', taxRules);
write('eventRates', eventRates);
write('parties', parties);
write('accounts', accounts);
write('sites', sites);
write('serviceItems', serviceItems);
write('containers', containers);
write('contracts', contracts);
write('serviceEvents', serviceEvents);
write('charges', charges);
write('invoices', invoices);
write('payments', payments);
write('allocations', allocations);
write('batches', batches);
write('workOrders', workOrders);
write('requests', requests);
write('quotes', quotes);
write('waived', []);
write('creditMemos', []);
write('scaleTickets', scaleTickets);

console.log(`seed written: ${accounts.length} accounts, ${sites.length} sites, ${serviceItems.length} service items, ${charges.length} charges, ${invoices.length} invoices, ${payments.length} payments`);
console.log(`inv_maple_2026q3 total ${invMapleQ3.totalCents}, partial payment ${maplePartial}, open ${invMapleQ3.totalCents - maplePartial}`);
console.log(`oakridge monthly invoice total ${oakInvoices[0].totalCents}, check ${checkTotal}`);
console.log(`batch_0908: 13 full payments plus partial ${picked.remainder} on ${picked.partial.id} (total ${picked.partial.totalCents})`);
