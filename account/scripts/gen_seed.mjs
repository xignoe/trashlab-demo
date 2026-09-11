#!/usr/bin/env node
// Generates every src/seed/*.json file for the account view prototype.
// Run once: node scripts/gen_seed.mjs. The JSON output is committed; this script is the audit trail.
// The fixed demo clock is TODAY = 2026-09-10 (a Thursday). Money is integer cents.
//
// Charge arithmetic mirrors the engine rules in CHECKLIST.md so the seed ties out:
//   fee_fuel_7pct: 7% of baseCents on recurring and event lines, taxable
//   fee_env_1: flat 100 per month in the period, recurring lines only, not taxable
//   tax_open: 7% on baseCents plus taxable fees, rounded half up with Math.round

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'seed');
mkdirSync(OUT, { recursive: true });

const TODAY = '2026-09-10';
const pad = (n, w = 3) => String(n).padStart(w, '0');

// ---------- rules ----------
const RATES = {
  'cat_res_96|weekly': { cents: 2900, rv: 'rv_res_96_v1' },
  'cat_res_64|weekly': { cents: 2600, rv: 'rv_res_64_v1' },
  'cat_res_extra_cart|weekly': { cents: 900, rv: 'rv_res_extra_v1' },
  'cat_res_recycling|eow': { cents: 1200, rv: 'rv_res_recycling_v1' },
  'cat_fl_2yd|weekly': { cents: 16500, rv: 'rv_fl_2yd_v1' },
  'cat_fl_3yd|2x': { cents: 22000, rv: 'rv_fl_3yd_v1' },
  'cat_fl_3yd_wood|2x': { cents: 19000, rv: 'rv_fl_3yd_wood_v1' },
  'cat_ro_20yd|onCall': { cents: 57500, rv: 'rv_ro_20yd_v1' },
};
const CATALOG_NAMES = {
  cat_res_96: '96 gal trash cart',
  cat_res_64: '64 gal trash cart',
  cat_res_extra_cart: 'Extra trash cart',
  cat_res_recycling: 'Recycling cart',
  cat_fl_2yd: '2 yd front load container',
  cat_fl_3yd: '3 yd front load container',
  cat_fl_3yd_wood: '3 yd front load, wood waste',
  cat_ro_20yd: '20 yd roll-off box',
};
const FREQ_LABEL = { weekly: 'weekly', eow: 'every other week', '2x': '2x per week', '3x': '3x per week', onCall: 'on call' };

function monthsInPeriod(period) {
  const [sy, sm] = period.start.split('-').map(Number);
  const [ey, em] = period.end.split('-').map(Number);
  return (ey - sy) * 12 + (em - sm) + 1;
}

/** Recurring line: base = unit price * qty * months. */
function recurringCharge({ id, accountId, siteId, catalogId, frequency, qty, period, serviceItemId, contract }) {
  const key = `${catalogId}|${frequency}`;
  const months = monthsInPeriod(period);
  let unit, pricing;
  if (contract) {
    const ov = contract.overrides.find((o) => o.catalogId === catalogId && (!o.frequency || o.frequency === frequency));
    if (!ov) throw new Error(`no override for ${catalogId} in ${contract.id}`);
    unit = ov.priceCents;
    pricing = { contractId: contract.id, ruleWon: 'contractOverride' };
  } else {
    const r = RATES[key];
    if (!r) throw new Error(`no rate for ${key}`);
    unit = r.cents;
    pricing = { rateVersionId: r.rv, ruleWon: 'zoneRate' };
  }
  const baseCents = unit * qty * months;
  const fuel = Math.round(baseCents * 0.07);
  const env = 100 * months;
  const taxCents = Math.round((baseCents + fuel) * 0.07);
  const totalCents = baseCents + fuel + env + taxCents;
  return {
    id,
    accountId,
    siteId,
    lineType: 'recurring',
    catalogId,
    description: `${CATALOG_NAMES[catalogId]}, ${FREQ_LABEL[frequency]}${qty > 1 ? ` x${qty}` : ''}, ${period.start} to ${period.end}`,
    source: { type: 'serviceItem', id: serviceItemId },
    period,
    baseCents,
    fees: [
      { feeRuleId: 'fee_fuel_7pct', cents: fuel },
      { feeRuleId: 'fee_env_1', cents: env },
    ],
    taxCents,
    totalCents,
    pricing,
    status: 'posted',
    evidenceIds: [],
  };
}

/** Event line (a roll-off haul): fuel applies, env does not, tax on base plus fuel. */
function haulCharge({ id, accountId, siteId, servicedOn, serviceItemId, description }) {
  const r = RATES['cat_ro_20yd|onCall'];
  const baseCents = r.cents;
  const fuel = Math.round(baseCents * 0.07);
  const taxCents = Math.round((baseCents + fuel) * 0.07);
  return {
    id,
    accountId,
    siteId,
    lineType: 'event',
    catalogId: 'cat_ro_20yd',
    description,
    source: { type: 'serviceItem', id: serviceItemId },
    servicedOn,
    baseCents,
    fees: [{ feeRuleId: 'fee_fuel_7pct', cents: fuel }],
    taxCents,
    totalCents: baseCents + fuel + taxCents,
    pricing: { rateVersionId: r.rv, ruleWon: 'zoneRate' },
    status: 'posted',
    evidenceIds: [],
  };
}

// ---------- collections ----------
const haulers = [
  {
    id: 'hauler_piedmont',
    name: 'Piedmont Disposal',
    policy: { proration: 'none', lateFeeCents: 1000, lateFeeDay: 5, graceMissedPickups: 2, suspendAfterDays: 30, reinstatementFeeCents: 2500 },
  },
];

const zones = [
  { id: 'zone_open', name: 'Piedmont city (open market)', serviceability: 'open', taxRatePct: 7, franchiseFeePct: 0, deliveryFeeCents: 2500, publicPricing: true },
  { id: 'zone_boundary', name: 'County boundary', serviceability: 'boundary', taxRatePct: 7, franchiseFeePct: 0, deliveryFeeCents: 2500, publicPricing: true },
  { id: 'zone_franchise', name: 'Westside franchise district', serviceability: 'franchise', taxRatePct: 7, franchiseFeePct: 17, deliveryFeeCents: 2500, publicPricing: false },
  { id: 'zone_notserved', name: 'Outside service area', serviceability: 'notServed', taxRatePct: 0, franchiseFeePct: 0, deliveryFeeCents: 0, publicPricing: false },
];

const serviceCatalog = [
  { id: 'cat_res_96', lob: 'residential', name: '96 gal trash cart', sizeLabel: '96 gal', unit: 'cart', public: true },
  { id: 'cat_res_64', lob: 'residential', name: '64 gal trash cart', sizeLabel: '64 gal', unit: 'cart', public: true },
  { id: 'cat_res_extra_cart', lob: 'residential', name: 'Extra trash cart', sizeLabel: '96 gal', unit: 'cart', public: true },
  { id: 'cat_res_recycling', lob: 'residential', name: 'Recycling cart', sizeLabel: '96 gal', unit: 'cart', public: true },
  { id: 'cat_fl_2yd', lob: 'frontload', name: '2 yd front load container', sizeLabel: '2 yd', unit: 'container', public: false },
  { id: 'cat_fl_3yd', lob: 'frontload', name: '3 yd front load container', sizeLabel: '3 yd', unit: 'container', public: false },
  { id: 'cat_fl_3yd_wood', lob: 'frontload', name: '3 yd front load, wood waste', sizeLabel: '3 yd', unit: 'container', public: false },
  {
    id: 'cat_ro_20yd',
    lob: 'rolloff',
    name: '20 yd roll-off box',
    sizeLabel: '20 yd',
    unit: 'box',
    rolloff: { includedTons: 3, includedDays: 30, extraDayCents: 700, overageCentsPerTon: 7000 },
    public: true,
  },
];

const rateVersions = [
  { id: 'rv_res_96_v0', catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 2700, effectiveFrom: '2025-01-01', status: 'published', publishedAt: '2024-12-15' },
  { id: 'rv_res_96_v1', catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 2900, effectiveFrom: '2026-01-01', status: 'published', publishedAt: '2025-12-15', supersedesId: 'rv_res_96_v0' },
  { id: 'rv_res_64_v1', catalogId: 'cat_res_64', zoneId: 'zone_open', frequency: 'weekly', priceCents: 2600, effectiveFrom: '2026-01-01', status: 'published', publishedAt: '2025-12-15' },
  { id: 'rv_res_extra_v1', catalogId: 'cat_res_extra_cart', zoneId: 'zone_open', frequency: 'weekly', priceCents: 900, effectiveFrom: '2026-01-01', status: 'published', publishedAt: '2025-12-15' },
  { id: 'rv_res_recycling_v1', catalogId: 'cat_res_recycling', zoneId: 'zone_open', frequency: 'eow', priceCents: 1200, effectiveFrom: '2026-01-01', status: 'published', publishedAt: '2025-12-15' },
  { id: 'rv_fl_2yd_v1', catalogId: 'cat_fl_2yd', zoneId: 'zone_open', frequency: 'weekly', priceCents: 16500, effectiveFrom: '2026-01-01', status: 'published', publishedAt: '2025-12-15' },
  { id: 'rv_fl_3yd_v1', catalogId: 'cat_fl_3yd', zoneId: 'zone_open', frequency: '2x', priceCents: 22000, effectiveFrom: '2026-01-01', status: 'published', publishedAt: '2025-12-15' },
  { id: 'rv_fl_3yd_wood_v1', catalogId: 'cat_fl_3yd_wood', zoneId: 'zone_open', frequency: '2x', priceCents: 19000, effectiveFrom: '2026-01-01', status: 'published', publishedAt: '2025-12-15' },
  { id: 'rv_ro_20yd_v1', catalogId: 'cat_ro_20yd', zoneId: 'zone_open', frequency: 'onCall', priceCents: 57500, effectiveFrom: '2026-01-01', status: 'published', publishedAt: '2025-12-15' },
];

const feeRules = [
  { id: 'fee_fuel_7pct', name: 'Fuel and environmental surcharge', kind: 'percent', value: 7, base: 'serviceLines', appliesTo: ['recurring', 'event'], taxable: true },
  { id: 'fee_env_1', name: 'Environmental fee', kind: 'flat', value: 100, base: 'serviceLines', appliesTo: ['recurring'], taxable: false },
];

// Addendum C8: one 7% rule per taxed zone, none for zone_notserved. Late fees are never in a tax rule.
const taxRules = [
  { id: 'tax_open', zoneId: 'zone_open', ratePct: 7, appliesTo: ['recurring', 'event', 'fee'] },
  { id: 'tax_boundary', zoneId: 'zone_boundary', ratePct: 7, appliesTo: ['recurring', 'event', 'fee'] },
  { id: 'tax_franchise', zoneId: 'zone_franchise', ratePct: 7, appliesTo: ['recurring', 'event', 'fee'] },
];

const parties = [];
const billingAccounts = [];
const sites = [];
const containers = [];
const serviceItems = [];
const contracts = [];
const quotes = [];
const workOrders = [];
const serviceEvents = [];
const scaleTickets = [];
const charges = [];
const waivedCharges = [];
const invoices = [];
const creditMemos = [];
const payments = [];
const paymentAllocations = [];
const processorBatches = [];
const requests = [];

const routeStops = { route_mon_res: [], route_tue_res: [], route_wed_fl: [], route_thu_ro: [] };

let serialCounter = 100;
function addContainer(id, catalogId, siteId, assignedFrom) {
  const prefix = { cart: 'CART', container: 'FL', box: 'RO' }[serviceCatalog.find((c) => c.id === catalogId).unit];
  containers.push({ id, serial: `PD-${prefix}-${pad(serialCounter++, 4)}`, catalogId, siteId, assignedFrom });
}

const serialOf = (id) => containers.find((c) => c.id === id).serial;

function addSite(site) {
  sites.push(site);
  if (site.routeId) routeStops[site.routeId].push(site.id);
}

function addItem({ id, siteId, catalogId, qty = 1, frequency, containerIds, effectiveFrom, status = 'active', effectiveTo }) {
  const item = { id, siteId, catalogId, qty, frequency, containerIds, effectiveFrom, status };
  if (effectiveTo) item.effectiveTo = effectiveTo;
  serviceItems.push(item);
  return item;
}

const addDaysIso = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Addendum C9: net30 is issuedAt + 30 days; monthly, quarterly, and perJob are issuedAt + 15. Same rule as engine postInvoices. */
function dueDateFor(accountId, issuedAt) {
  const acct = billingAccounts.find((a) => a.id === accountId);
  if (!acct) throw new Error(`addInvoice: account ${accountId} must be pushed before its invoices`);
  return addDaysIso(issuedAt, acct.cycle === 'net30' ? 30 : 15);
}

/** Build a posted invoice from charges; number is assigned later in issue order, dueAt from the cycle (C9). */
function addInvoice({ id, accountId, chargeList, issuedAt, deliveredVia }) {
  const dueAt = dueDateFor(accountId, issuedAt);
  for (const c of chargeList) charges.push(c);
  const subtotalCents = chargeList.reduce((s, c) => s + c.baseCents, 0);
  const feeCents = chargeList.reduce((s, c) => s + c.fees.reduce((f, x) => f + x.cents, 0), 0);
  const taxCents = chargeList.reduce((s, c) => s + c.taxCents, 0);
  const totalCents = chargeList.reduce((s, c) => s + c.totalCents, 0);
  const inv = { id, accountId, number: '', chargeIds: chargeList.map((c) => c.id), subtotalCents, feeCents, taxCents, totalCents, issuedAt, dueAt, postedAt: issuedAt, locked: true, deliveredVia };
  invoices.push(inv);
  return inv;
}

function addPayment({ id, accountId, method, cents, receivedAt, processorBatchId, status = 'settled', allocateTo }) {
  const p = { id, accountId, method, cents, receivedAt, status };
  if (processorBatchId) p.processorBatchId = processorBatchId;
  payments.push(p);
  if (allocateTo) paymentAllocations.push({ sourceType: 'payment', sourceId: id, invoiceId: allocateTo, cents });
  return p;
}

const Q3 = { start: '2026-07-01', end: '2026-09-30' };
const AUG = { start: '2026-08-01', end: '2026-08-31' };
const SEP = { start: '2026-09-01', end: '2026-09-30' };
const MAY = { start: '2026-05-01', end: '2026-05-31' };
const JUN = { start: '2026-06-01', end: '2026-06-30' };
const JUL = { start: '2026-07-01', end: '2026-07-31' };

// ---------- focus account: Maple ----------
parties.push({ id: 'party_maple', name: 'Dana Maple', kind: 'homeowner' });
billingAccounts.push({ id: 'acct_res_maple', payerPartyId: 'party_maple', cycle: 'quarterly', billedInAdvance: true, autopay: false, status: 'pastDue', deliveryMethod: 'mail', taxExempt: false });
addSite({ id: 'site_maple', accountId: 'acct_res_maple', occupantPartyId: 'party_maple', address: '412 Maple St', zoneId: 'zone_open', routeId: 'route_mon_res', accessNotes: 'Carts at the curb by 6am; dog in the back yard' });
addContainer('cont_maple_96', 'cat_res_96', 'site_maple', '2025-04-01');
addContainer('cont_maple_extra', 'cat_res_extra_cart', 'site_maple', '2025-04-01');
addContainer('cont_maple_recycling', 'cat_res_recycling', 'site_maple', '2025-04-01');
addItem({ id: 'si_maple_96', siteId: 'site_maple', catalogId: 'cat_res_96', frequency: 'weekly', containerIds: ['cont_maple_96'], effectiveFrom: '2025-04-01' });
addItem({ id: 'si_maple_extra', siteId: 'site_maple', catalogId: 'cat_res_extra_cart', frequency: 'weekly', containerIds: ['cont_maple_extra'], effectiveFrom: '2025-04-01' });
addItem({ id: 'si_maple_recycling', siteId: 'site_maple', catalogId: 'cat_res_recycling', frequency: 'eow', containerIds: ['cont_maple_recycling'], effectiveFrom: '2025-04-01' });
const mapleInv = addInvoice({
  id: 'inv_maple_q3',
  accountId: 'acct_res_maple',
  issuedAt: '2026-06-20',
  deliveredVia: 'mail',
  chargeList: [
    recurringCharge({ id: 'ch_maple_q3_96', accountId: 'acct_res_maple', siteId: 'site_maple', catalogId: 'cat_res_96', frequency: 'weekly', qty: 1, period: Q3, serviceItemId: 'si_maple_96' }),
    recurringCharge({ id: 'ch_maple_q3_extra', accountId: 'acct_res_maple', siteId: 'site_maple', catalogId: 'cat_res_extra_cart', frequency: 'weekly', qty: 1, period: Q3, serviceItemId: 'si_maple_extra' }),
    recurringCharge({ id: 'ch_maple_q3_recycling', accountId: 'acct_res_maple', siteId: 'site_maple', catalogId: 'cat_res_recycling', frequency: 'eow', qty: 1, period: Q3, serviceItemId: 'si_maple_recycling' }),
  ],
});
// Partial check so the open balance is exactly 8745 cents ($87.45).
addPayment({ id: 'pay_chk_maple', accountId: 'acct_res_maple', method: 'check', cents: mapleInv.totalCents - 8745, receivedAt: '2026-07-14', allocateTo: 'inv_maple_q3' });
serviceEvents.push(
  { id: 'ev_maple_0831', siteId: 'site_maple', routeId: 'route_mon_res', date: '2026-08-31', outcome: 'completed', driver: 'R. Ortiz' },
  { id: 'ev_maple_extrabags', siteId: 'site_maple', routeId: 'route_mon_res', date: '2026-09-07', outcome: 'completed', exception: 'extraBags', photoUrl: '/photos/ev_maple_extrabags.svg', note: '3 bags beside cart', driver: 'R. Ortiz' },
);

// ---------- focus account: Holt (vacation hold) ----------
parties.push({ id: 'party_holt', name: 'Marcus Holt', kind: 'homeowner' });
billingAccounts.push({ id: 'acct_res_holt', payerPartyId: 'party_holt', cycle: 'quarterly', billedInAdvance: true, autopay: true, paymentMethodOnFile: 'card', status: 'hold', deliveryMethod: 'email', taxExempt: false });
addSite({ id: 'site_holt', accountId: 'acct_res_holt', occupantPartyId: 'party_holt', address: '77 Elm Ct', zoneId: 'zone_open', routeId: 'route_tue_res' });
addContainer('cont_holt_96', 'cat_res_96', 'site_holt', '2024-10-01');
addItem({ id: 'si_holt_96', siteId: 'site_holt', catalogId: 'cat_res_96', frequency: 'weekly', containerIds: ['cont_holt_96'], effectiveFrom: '2024-10-01', status: 'held' });
addInvoice({
  id: 'inv_holt_q3',
  accountId: 'acct_res_holt',
  issuedAt: '2026-06-20',
  deliveredVia: 'email',
  chargeList: [recurringCharge({ id: 'ch_holt_q3_96', accountId: 'acct_res_holt', siteId: 'site_holt', catalogId: 'cat_res_96', frequency: 'weekly', qty: 1, period: Q3, serviceItemId: 'si_holt_96' })],
});
addPayment({ id: 'pay_auto_holt', accountId: 'acct_res_holt', method: 'autopay', cents: invoices.find((i) => i.id === 'inv_holt_q3').totalCents, receivedAt: '2026-07-01', allocateTo: 'inv_holt_q3' });
requests.push({ id: 'req_holt_hold', accountId: 'acct_res_holt', siteId: 'site_holt', kind: 'vacationHold', status: 'scheduled', createdVia: 'portal', note: 'Away 2026-08-28 to 2026-09-13; resume service Tue 2026-09-15' });

// ---------- focus account: Kerr (suspended) ----------
parties.push({ id: 'party_kerr', name: 'Lewis Kerr', kind: 'homeowner' });
billingAccounts.push({ id: 'acct_res_kerr', payerPartyId: 'party_kerr', cycle: 'quarterly', billedInAdvance: true, autopay: false, status: 'suspended', deliveryMethod: 'mail', taxExempt: false });
addSite({ id: 'site_kerr', accountId: 'acct_res_kerr', occupantPartyId: 'party_kerr', address: '230 Birch Ln', zoneId: 'zone_open', routeId: 'route_tue_res' });
addContainer('cont_kerr_96', 'cat_res_96', 'site_kerr', '2025-01-15');
addItem({ id: 'si_kerr_96', siteId: 'site_kerr', catalogId: 'cat_res_96', frequency: 'weekly', containerIds: ['cont_kerr_96'], effectiveFrom: '2025-01-15', status: 'held' });
addInvoice({
  id: 'inv_kerr_q3',
  accountId: 'acct_res_kerr',
  issuedAt: '2026-06-20',
  deliveredVia: 'mail',
  chargeList: [recurringCharge({ id: 'ch_kerr_q3_96', accountId: 'acct_res_kerr', siteId: 'site_kerr', catalogId: 'cat_res_96', frequency: 'weekly', qty: 1, period: Q3, serviceItemId: 'si_kerr_96' })],
});
serviceEvents.push(
  { id: 'ev_kerr_0901', siteId: 'site_kerr', routeId: 'route_tue_res', date: '2026-09-01', outcome: 'skippedSuspended', note: 'Account suspended for non-payment', driver: 'T. Nguyen' },
  { id: 'ev_kerr_0908', siteId: 'site_kerr', routeId: 'route_tue_res', date: '2026-09-08', outcome: 'skippedSuspended', note: 'Account suspended for non-payment', driver: 'T. Nguyen' },
);

// ---------- focus account: Sunrise Bakery (contract) ----------
parties.push({ id: 'party_bakery', name: 'Sunrise Bakery', kind: 'business' });
const contractBakery = {
  id: 'contract_bakery',
  accountId: 'acct_bakery',
  termStart: '2026-01-01',
  termEnd: '2027-12-31',
  renewalNoticeDays: 60,
  overrides: [
    { catalogId: 'cat_fl_3yd', frequency: '2x', priceCents: 19800, reason: 'competitive match', pctBelowRateCard: 10 },
    { catalogId: 'cat_fl_3yd_wood', frequency: '2x', priceCents: 17100, reason: 'competitive match', pctBelowRateCard: 10 },
  ],
  escalator: { kind: 'fixedPct', pct: 4, anniversary: '2027-01-01' },
};
contracts.push(contractBakery);
billingAccounts.push({ id: 'acct_bakery', payerPartyId: 'party_bakery', cycle: 'monthly', billedInAdvance: true, autopay: false, paymentMethodOnFile: 'ach', status: 'active', deliveryMethod: 'email', taxExempt: false, contractId: 'contract_bakery' });
addSite({ id: 'site_bakery', accountId: 'acct_bakery', occupantPartyId: 'party_bakery', address: '88 Commerce Ave', zoneId: 'zone_open', routeId: 'route_wed_fl', accessNotes: 'Enclosure behind the loading dock; gate code 4410' });
addContainer('cont_bakery_3yd', 'cat_fl_3yd', 'site_bakery', '2026-01-01');
addContainer('cont_bakery_wood', 'cat_fl_3yd_wood', 'site_bakery', '2026-01-01');
addItem({ id: 'si_bakery_3yd', siteId: 'site_bakery', catalogId: 'cat_fl_3yd', frequency: '2x', containerIds: ['cont_bakery_3yd'], effectiveFrom: '2026-01-01' });
addItem({ id: 'si_bakery_wood', siteId: 'site_bakery', catalogId: 'cat_fl_3yd_wood', frequency: '2x', containerIds: ['cont_bakery_wood'], effectiveFrom: '2026-01-01' });
for (const [tag, period, issuedAt, paidAt] of [
  ['0801', AUG, '2026-07-20', '2026-07-30'],
  ['0901', SEP, '2026-08-20', '2026-08-31'],
]) {
  const inv = addInvoice({
    id: `inv_bakery_${tag}`,
    accountId: 'acct_bakery',
    issuedAt,
    deliveredVia: 'email',
    chargeList: [
      recurringCharge({ id: `ch_bakery_${tag}_3yd`, accountId: 'acct_bakery', siteId: 'site_bakery', catalogId: 'cat_fl_3yd', frequency: '2x', qty: 1, period, serviceItemId: 'si_bakery_3yd', contract: contractBakery }),
      recurringCharge({ id: `ch_bakery_${tag}_wood`, accountId: 'acct_bakery', siteId: 'site_bakery', catalogId: 'cat_fl_3yd_wood', frequency: '2x', qty: 1, period, serviceItemId: 'si_bakery_wood', contract: contractBakery }),
    ],
  });
  addPayment({ id: `pay_ach_bakery_${tag}`, accountId: 'acct_bakery', method: 'ach', cents: inv.totalCents, receivedAt: paidAt, allocateTo: inv.id });
}
serviceEvents.push(
  { id: 'ev_bakery_contamination', siteId: 'site_bakery', routeId: 'route_wed_fl', date: '2026-09-02', outcome: 'completed', exception: 'contamination', photoUrl: '/photos/ev_bakery_contamination.svg', note: `Wood container (${serialOf('cont_bakery_wood')}): plastic film and food waste mixed in with pallets`, driver: 'K. Bell' },
  { id: 'ev_bakery_0909', siteId: 'site_bakery', routeId: 'route_wed_fl', date: '2026-09-09', outcome: 'completed', driver: 'K. Bell' },
);

// ---------- focus account: Oakridge Property Management ----------
parties.push({ id: 'party_oakridge', name: 'Oakridge Property Management', kind: 'propertyManager' });
billingAccounts.push({ id: 'acct_pm_oakridge', payerPartyId: 'party_oakridge', cycle: 'net30', billedInAdvance: false, autopay: false, status: 'active', deliveryMethod: 'email', taxExempt: false });
const oakSites = [
  ['site_oak_1', 'Oakridge Commons Bldg A, 100 Oakridge Dr', 'PO-4471-A'],
  ['site_oak_2', 'Oakridge Commons Bldg B, 120 Oakridge Dr', 'PO-4471-B'],
  ['site_oak_3', 'Oakridge Terrace, 15 Ridgeview Ct', 'PO-4502'],
  ['site_oak_4', 'Oakridge Village Center, 900 Parkway Blvd', 'PO-4519'],
];
oakSites.forEach(([id, address, poNumber], i) => {
  addSite({ id, accountId: 'acct_pm_oakridge', address, zoneId: 'zone_open', routeId: 'route_wed_fl', poNumber, accessNotes: i === 2 ? 'Key box on the enclosure, code with property manager' : undefined });
  addContainer(`cont_oak_${i + 1}`, 'cat_fl_2yd', id, '2025-03-01');
  addItem({ id: `si_oak_${i + 1}`, siteId: id, catalogId: 'cat_fl_2yd', frequency: 'weekly', containerIds: [`cont_oak_${i + 1}`], effectiveFrom: '2025-03-01' });
});
let oakTotal = 0;
for (const [tag, period, issuedAt] of [
  ['0601', MAY, '2026-06-01'],
  ['0701', JUN, '2026-07-01'],
  ['0801', JUL, '2026-08-01'],
]) {
  const inv = addInvoice({
    id: `inv_oak_${tag}`,
    accountId: 'acct_pm_oakridge',
    issuedAt,
    deliveredVia: 'email',
    chargeList: oakSites.map(([siteId], i) =>
      recurringCharge({ id: `ch_oak_${tag}_${i + 1}`, accountId: 'acct_pm_oakridge', siteId, catalogId: 'cat_fl_2yd', frequency: 'weekly', qty: 1, period, serviceItemId: `si_oak_${i + 1}` }),
    ),
  });
  oakTotal += inv.totalCents;
}
// Settled check, deliberately NOT allocated in seed (allocation is the demo action).
addPayment({ id: 'pay_chk_oakridge', accountId: 'acct_pm_oakridge', method: 'check', cents: oakTotal, receivedAt: '2026-09-08' });
for (const d of ['2026-09-02', '2026-09-09']) {
  oakSites.forEach(([siteId], i) => serviceEvents.push({ id: `ev_oak_${i + 1}_${d.slice(5).replace('-', '')}`, siteId, routeId: 'route_wed_fl', date: d, outcome: 'completed', driver: 'K. Bell' }));
}

// ---------- focus account: Hale Construction (roll-off) ----------
parties.push({ id: 'party_hale', name: 'Hale Construction', kind: 'contractor' });
billingAccounts.push({ id: 'acct_contractor_hale', payerPartyId: 'party_hale', cycle: 'net30', billedInAdvance: false, autopay: false, status: 'active', deliveryMethod: 'email', taxExempt: false });
addSite({ id: 'site_hale_job1', accountId: 'acct_contractor_hale', address: '2200 Industrial Pkwy (job 1, warehouse demo)', zoneId: 'zone_open', routeId: 'route_thu_ro', accessNotes: 'Gate opens 6:30am; call site super J. Hale before arrival' });
addSite({ id: 'site_hale_job2', accountId: 'acct_contractor_hale', address: '45 Quarry Rd (job 2, retail fit-out)', zoneId: 'zone_open', routeId: 'route_thu_ro' });
addContainer('cont_hale_1', 'cat_ro_20yd', 'site_hale_job1', '2026-08-18');
addContainer('cont_hale_2', 'cat_ro_20yd', 'site_hale_job1', '2026-08-25');
addContainer('cont_hale_3', 'cat_ro_20yd', 'site_hale_job2', '2026-08-28');
addItem({ id: 'si_hale_job1', siteId: 'site_hale_job1', catalogId: 'cat_ro_20yd', qty: 2, frequency: 'onCall', containerIds: ['cont_hale_1', 'cont_hale_2'], effectiveFrom: '2026-08-18' });
addItem({ id: 'si_hale_job2', siteId: 'site_hale_job2', catalogId: 'cat_ro_20yd', qty: 1, frequency: 'onCall', containerIds: ['cont_hale_3'], effectiveFrom: '2026-08-28' });
workOrders.push(
  { id: 'wo_hale_deliver_1', siteId: 'site_hale_job1', kind: 'deliver', status: 'done', scheduledFor: '2026-08-18', serviceItemId: 'si_hale_job1', containerId: 'cont_hale_1', completedAt: '2026-08-18' },
  { id: 'wo_hale_deliver_2', siteId: 'site_hale_job1', kind: 'deliver', status: 'done', scheduledFor: '2026-08-25', serviceItemId: 'si_hale_job1', containerId: 'cont_hale_2', completedAt: '2026-08-25' },
  { id: 'wo_hale_deliver_3', siteId: 'site_hale_job2', kind: 'deliver', status: 'done', scheduledFor: '2026-08-28', serviceItemId: 'si_hale_job2', containerId: 'cont_hale_3', completedAt: '2026-08-28' },
  { id: 'wo_hale_dr_1', siteId: 'site_hale_job1', kind: 'dumpAndReturn', status: 'done', scheduledFor: '2026-09-01', serviceItemId: 'si_hale_job1', containerId: 'cont_hale_1', completedAt: '2026-09-01' },
  { id: 'wo_hale_dr_2', siteId: 'site_hale_job2', kind: 'dumpAndReturn', status: 'done', scheduledFor: '2026-09-04', serviceItemId: 'si_hale_job2', containerId: 'cont_hale_3', completedAt: '2026-09-04' },
  { id: 'wo_hale_dr_3', siteId: 'site_hale_job1', kind: 'dumpAndReturn', status: 'scheduled', scheduledFor: '2026-09-11', serviceItemId: 'si_hale_job1', containerId: 'cont_hale_2' },
);
scaleTickets.push(
  { id: 'tk_hale_1', workOrderId: 'wo_hale_dr_1', containerId: 'cont_hale_1', facility: 'Piedmont Transfer Station', material: 'C&D mixed', grossLbs: 19400, tareLbs: 11000, netLbs: 8400, ticketedAt: '2026-09-01T10:42:00' },
  { id: 'tk_hale_2', workOrderId: 'wo_hale_dr_2', containerId: 'cont_hale_3', facility: 'Piedmont Transfer Station', material: 'C&D mixed', grossLbs: 18100, tareLbs: 11000, netLbs: 7100, ticketedAt: '2026-09-04T14:05:00' },
);
addInvoice({
  id: 'inv_hale_0901',
  accountId: 'acct_contractor_hale',
  issuedAt: '2026-09-01',
  deliveredVia: 'email',
  chargeList: [
    haulCharge({ id: 'ch_hale_haul_1', accountId: 'acct_contractor_hale', siteId: 'site_hale_job1', servicedOn: '2026-08-18', serviceItemId: 'si_hale_job1', description: `20 yd roll-off haul, delivery of ${serialOf('cont_hale_1')} (job 1)` }),
    haulCharge({ id: 'ch_hale_haul_2', accountId: 'acct_contractor_hale', siteId: 'site_hale_job1', servicedOn: '2026-08-25', serviceItemId: 'si_hale_job1', description: `20 yd roll-off haul, delivery of ${serialOf('cont_hale_2')} (job 1)` }),
    haulCharge({ id: 'ch_hale_haul_3', accountId: 'acct_contractor_hale', siteId: 'site_hale_job2', servicedOn: '2026-08-28', serviceItemId: 'si_hale_job2', description: `20 yd roll-off haul, delivery of ${serialOf('cont_hale_3')} (job 2)` }),
  ],
});
serviceEvents.push({ id: 'ev_hale_dryrun', siteId: 'site_hale_job1', routeId: 'route_thu_ro', date: '2026-09-03', outcome: 'blocked', exception: 'dryRun', photoUrl: '/photos/ev_hale_dryrun.svg', note: `Gate locked, no answer from site super; box ${serialOf('cont_hale_2')} not pulled`, driver: 'M. Diaz' });

// ---------- focus account: roll-off homeowner (prepaid, out 34 days) ----------
parties.push({ id: 'party_ro_home', name: 'Priya Raman', kind: 'homeowner' });
billingAccounts.push({ id: 'acct_ro_homeowner', payerPartyId: 'party_ro_home', cycle: 'perJob', billedInAdvance: true, autopay: false, paymentMethodOnFile: 'card', status: 'active', deliveryMethod: 'email', taxExempt: false });
addSite({ id: 'site_ro_home', accountId: 'acct_ro_homeowner', occupantPartyId: 'party_ro_home', address: '9 Fern Hollow Dr', zoneId: 'zone_open', routeId: 'route_thu_ro', accessNotes: 'Box on the driveway, left side' });
addContainer('cont_ro_home', 'cat_ro_20yd', 'site_ro_home', '2026-08-07');
addItem({ id: 'si_ro_home', siteId: 'site_ro_home', catalogId: 'cat_ro_20yd', frequency: 'onCall', containerIds: ['cont_ro_home'], effectiveFrom: '2026-08-07' });
workOrders.push({ id: 'wo_ro_home_deliver', siteId: 'site_ro_home', kind: 'deliver', status: 'done', scheduledFor: '2026-08-07', serviceItemId: 'si_ro_home', containerId: 'cont_ro_home', completedAt: '2026-08-07' });
const roInv = addInvoice({
  id: 'inv_ro_home_0805',
  accountId: 'acct_ro_homeowner',
  issuedAt: '2026-08-05',
  deliveredVia: 'email',
  chargeList: [haulCharge({ id: 'ch_ro_home_haul', accountId: 'acct_ro_homeowner', siteId: 'site_ro_home', servicedOn: '2026-08-07', serviceItemId: 'si_ro_home', description: '20 yd roll-off haul, prepaid delivery (3 tons, 30 days included)' })],
});
addPayment({ id: 'pay_card_ro_home', accountId: 'acct_ro_homeowner', method: 'card', cents: roInv.totalCents, receivedAt: '2026-08-05', allocateTo: roInv.id });

// ---------- generic residential accounts 001..030 ----------
const FIRST = ['Avery', 'Jordan', 'Riley', 'Casey', 'Morgan', 'Taylor', 'Quinn', 'Reese', 'Skyler', 'Devon', 'Harper', 'Rowan', 'Sage', 'Emerson', 'Finley', 'Blake', 'Cameron', 'Drew', 'Ellis', 'Hayden', 'Jamie', 'Kendall', 'Logan', 'Marlow', 'Noel', 'Parker', 'Remy', 'Shea', 'Tatum', 'Wren'];
const LAST = ['Alvarez', 'Bennett', 'Chen', 'Dawson', 'Espinoza', 'Foster', 'Garcia', 'Hughes', 'Ibarra', 'Jensen', 'Kim', 'Lopez', 'Moore', 'Nakamura', 'Owens', 'Patel', 'Quigley', 'Russo', 'Singh', 'Torres', 'Underwood', 'Vance', 'Walsh', 'Xu', 'Young', 'Zimmer', 'Abbott', 'Brooks', 'Cole', 'Delgado'];
const STREETS = ['Maple St', 'Oak Ave', 'Pine Rd', 'Cedar Ln', 'Willow Way', 'Ashford Dr', 'Chestnut St', 'Laurel Ct', 'Poplar Ave', 'Sycamore Rd'];
const RECYCLING = new Set([5, 10, 15, 20, 25, 30]);
const AUTOPAY = new Set([17, 18, 21, 25, 28]);
const PAST_DUE = { 7: 5000, 22: 3710 }; // partial card payments leave these past due
const CARD_FULL = [1, 2, 3, 4, 6, 8, 9, 11, 12, 13, 14, 16]; // full card payments in batch_0908
const cardBatchPayments = [];

for (let n = 1; n <= 30; n++) {
  const k = pad(n);
  const acctId = `acct_res_${k}`;
  const partyId = `party_res_${k}`;
  const siteId = `site_res_${k}`;
  const routeId = n <= 15 ? 'route_mon_res' : 'route_tue_res';
  const hasRecycling = RECYCLING.has(n);
  const autopay = AUTOPAY.has(n);
  const cardPayer = CARD_FULL.includes(n) || n in PAST_DUE;
  parties.push({ id: partyId, name: `${FIRST[n - 1]} ${LAST[n - 1]}`, kind: 'homeowner' });
  const acct = { id: acctId, payerPartyId: partyId, cycle: 'quarterly', billedInAdvance: true, autopay, status: n in PAST_DUE ? 'pastDue' : 'active', deliveryMethod: n % 3 === 0 ? 'mail' : 'email', taxExempt: false };
  if (autopay || cardPayer) acct.paymentMethodOnFile = 'card';
  billingAccounts.push(acct);
  addSite({ id: siteId, accountId: acctId, occupantPartyId: partyId, address: `${100 + n * 7} ${STREETS[n % STREETS.length]}`, zoneId: 'zone_open', routeId });
  const start = `2025-0${1 + (n % 6)}-01`;
  addContainer(`cont_res_${k}_96`, 'cat_res_96', siteId, start);
  addItem({ id: `si_res_${k}_96`, siteId, catalogId: 'cat_res_96', frequency: 'weekly', containerIds: [`cont_res_${k}_96`], effectiveFrom: start });
  const chargeList = [recurringCharge({ id: `ch_res_${k}_q3_96`, accountId: acctId, siteId, catalogId: 'cat_res_96', frequency: 'weekly', qty: 1, period: Q3, serviceItemId: `si_res_${k}_96` })];
  if (hasRecycling) {
    addContainer(`cont_res_${k}_rec`, 'cat_res_recycling', siteId, start);
    addItem({ id: `si_res_${k}_rec`, siteId, catalogId: 'cat_res_recycling', frequency: 'eow', containerIds: [`cont_res_${k}_rec`], effectiveFrom: start });
    chargeList.push(recurringCharge({ id: `ch_res_${k}_q3_rec`, accountId: acctId, siteId, catalogId: 'cat_res_recycling', frequency: 'eow', qty: 1, period: Q3, serviceItemId: `si_res_${k}_rec` }));
  }
  const inv = addInvoice({ id: `inv_res_${k}_q3`, accountId: acctId, issuedAt: '2026-06-20', deliveredVia: acct.deliveryMethod, chargeList });
  if (cardPayer) {
    cardBatchPayments.push({ acctId, invoiceId: inv.id, cents: n in PAST_DUE ? PAST_DUE[n] : inv.totalCents, receivedAt: `2026-09-0${4 + (cardBatchPayments.length % 4)}` });
  } else if (autopay) {
    addPayment({ id: `pay_auto_res_${k}`, accountId: acctId, method: 'autopay', cents: inv.totalCents, receivedAt: '2026-07-01', allocateTo: inv.id });
  } else {
    addPayment({ id: `pay_chk_res_${k}`, accountId: acctId, method: 'check', cents: inv.totalCents, receivedAt: `2026-07-${pad(2 + (n % 20), 2)}`, allocateTo: inv.id });
  }
  // Last 14 days of stops on the site's route.
  const days = routeId === 'route_mon_res' ? ['2026-08-31', '2026-09-07'] : ['2026-09-01', '2026-09-08'];
  const driver = routeId === 'route_mon_res' ? 'R. Ortiz' : 'T. Nguyen';
  for (const d of days) {
    const ev = { id: `ev_res_${k}_${d.slice(5).replace('-', '')}`, siteId, routeId, date: d, outcome: 'completed', driver };
    if (n === 14 && d === '2026-09-07') {
      ev.id = 'ev_res_014_overload';
      ev.exception = 'overload';
      ev.photoUrl = '/photos/ev_res_014_overload.svg';
      ev.note = 'Lid open more than a foot, cart overfilled with yard debris';
    }
    serviceEvents.push(ev);
  }
}

// batch_0908: 14 settled card payments summing to exactly 131842.
const BATCH_GROSS = 131842;
cardBatchPayments.forEach((p, i) => {
  addPayment({ id: `pay_card_${pad(i + 1)}`, accountId: p.acctId, method: 'card', cents: p.cents, receivedAt: p.receivedAt, processorBatchId: 'batch_0908', allocateTo: p.invoiceId });
});
const batchSum = cardBatchPayments.reduce((s, p) => s + p.cents, 0);
if (cardBatchPayments.length !== 14 || batchSum !== BATCH_GROSS) throw new Error(`batch_0908 mismatch: ${cardBatchPayments.length} payments, ${batchSum} cents`);
processorBatches.push({ id: 'batch_0908', depositedAt: '2026-09-08', grossCents: BATCH_GROSS, feeCents: 4120, netCents: BATCH_GROSS - 4120, paymentIds: cardBatchPayments.map((_, i) => `pay_card_${pad(i + 1)}`) });

// ---------- generic frontload accounts 001..008 ----------
const BIZ = ['Copper Kettle Diner', 'Northgate Auto Care', 'Blue Heron Vet Clinic', 'Parkway Fitness', 'Marigold Florist', 'Ridgeline Hardware', 'Tidewater Print Shop', 'Juniper Day School'];
const BIZ_ADDR = ['210 Commerce Ave', '1450 Northgate Blvd', '32 Heron Way', '600 Parkway Blvd', '75 Market St', '2100 Ridgeline Rd', '18 Tidewater Ln', '410 Juniper Dr'];
for (let n = 1; n <= 8; n++) {
  const k = pad(n);
  const acctId = `acct_fl_${k}`;
  const partyId = `party_fl_${k}`;
  const siteId = `site_fl_${k}`;
  const is2yd = n % 2 === 1;
  const catalogId = is2yd ? 'cat_fl_2yd' : 'cat_fl_3yd';
  const frequency = is2yd ? 'weekly' : '2x';
  parties.push({ id: partyId, name: BIZ[n - 1], kind: 'business' });
  let contract;
  if (n <= 4) {
    const rate = RATES[`${catalogId}|${frequency}`].cents;
    contract = {
      id: `contract_fl_${k}`,
      accountId: acctId,
      termStart: '2026-01-01',
      termEnd: n % 2 === 1 ? '2027-12-31' : '2028-12-31',
      renewalNoticeDays: 60,
      overrides: [{ catalogId, frequency, priceCents: Math.round(rate * 0.95), reason: 'multi-year term', pctBelowRateCard: 5 }],
      escalator: { kind: 'fixedPct', pct: 4, anniversary: '2027-01-01' },
    };
    contracts.push(contract);
  }
  const acct = { id: acctId, payerPartyId: partyId, cycle: 'monthly', billedInAdvance: true, autopay: n % 3 === 0, paymentMethodOnFile: 'ach', status: 'active', deliveryMethod: 'email', taxExempt: false };
  if (contract) acct.contractId = contract.id;
  billingAccounts.push(acct);
  addSite({ id: siteId, accountId: acctId, occupantPartyId: partyId, address: BIZ_ADDR[n - 1], zoneId: 'zone_open', routeId: 'route_wed_fl' });
  addContainer(`cont_fl_${k}`, catalogId, siteId, '2026-01-01');
  addItem({ id: `si_fl_${k}`, siteId, catalogId, frequency, containerIds: [`cont_fl_${k}`], effectiveFrom: '2026-01-01' });
  const inv = addInvoice({
    id: `inv_fl_${k}_0901`,
    accountId: acctId,
    issuedAt: '2026-08-20',
    deliveredVia: 'email',
    chargeList: [recurringCharge({ id: `ch_fl_${k}_0901`, accountId: acctId, siteId, catalogId, frequency, qty: 1, period: SEP, serviceItemId: `si_fl_${k}`, contract })],
  });
  addPayment({ id: `pay_ach_fl_${k}`, accountId: acctId, method: 'ach', cents: inv.totalCents, receivedAt: `2026-08-${24 + (n % 5)}`, allocateTo: inv.id });
  for (const d of ['2026-09-02', '2026-09-09']) {
    const ev = { id: `ev_fl_${k}_${d.slice(5).replace('-', '')}`, siteId, routeId: 'route_wed_fl', date: d, outcome: 'completed', driver: 'K. Bell' };
    if (n === 3 && d === '2026-09-09') {
      ev.id = 'ev_fl_003_dryrun';
      ev.outcome = 'blocked';
      ev.exception = 'dryRun';
      ev.photoUrl = '/photos/ev_fl_003_dryrun.svg';
      ev.note = 'Delivery van parked in front of the enclosure, could not reach the container';
    }
    serviceEvents.push(ev);
  }
}

// ---------- routes ----------
const routes = [
  { id: 'route_mon_res', day: 'Mon', lob: 'residential', stopSiteIds: routeStops.route_mon_res, capacityStops: 220 },
  { id: 'route_tue_res', day: 'Tue', lob: 'residential', stopSiteIds: routeStops.route_tue_res, capacityStops: 220 },
  { id: 'route_wed_fl', day: 'Wed', lob: 'frontload', stopSiteIds: routeStops.route_wed_fl, capacityStops: 60 },
  { id: 'route_thu_ro', day: 'Thu', lob: 'rolloff', stopSiteIds: routeStops.route_thu_ro, capacityStops: 12 },
];

// ---------- quotes ----------
quotes.push(
  {
    id: 'quote_held_ridge',
    kind: 'residentialSignup',
    address: '17 Ridge Rd',
    zoneId: 'zone_boundary',
    lines: [{ catalogId: 'cat_res_96', qty: 1, frequency: 'weekly', priceCents: 2900 }],
    dueTodayCents: 5400,
    recurringCents: 2900,
    status: 'held',
    holdReason: 'confirm private road access',
    holdDeadline: '2026-09-11T10:00:00',
    expiresAt: '2026-09-24T00:00:00',
    createdVia: 'storefront',
  },
  {
    id: 'quote_bakery_request',
    kind: 'commercialRequest',
    address: '88 Commerce Ave',
    zoneId: 'zone_open',
    lines: [{ catalogId: 'cat_fl_2yd', qty: 1, frequency: 'weekly', priceCents: 16500 }],
    dueTodayCents: 0,
    recurringCents: 16500,
    status: 'draft',
    expiresAt: '2026-10-10T00:00:00',
    createdVia: 'agent',
  },
);

// ---------- invoice numbers in issue order ----------
[...invoices]
  .sort((a, b) => (a.issuedAt < b.issuedAt ? -1 : a.issuedAt > b.issuedAt ? 1 : a.id < b.id ? -1 : 1))
  .forEach((inv, i) => {
    inv.number = `PD-2026-${pad(401 + i, 4)}`;
  });

// ---------- event exception rates (addendum B4: seed data, not engine constants; billing's values) ----------
const eventRates = { extraBags: 250, overload: 1000, contamination: 2000, dryRun: 2500 };

// ---------- write ----------
const files = {
  'eventRates.json': eventRates,
  'haulers.json': haulers,
  'parties.json': parties,
  'accounts.json': billingAccounts,
  'sites.json': sites,
  'zones.json': zones,
  'routes.json': routes,
  'serviceCatalog.json': serviceCatalog,
  'containers.json': containers,
  'serviceItems.json': serviceItems,
  'rateVersions.json': rateVersions,
  'feeRules.json': feeRules,
  'taxRules.json': taxRules,
  'contracts.json': contracts,
  'quotes.json': quotes,
  'workOrders.json': workOrders,
  'serviceEvents.json': serviceEvents,
  'scaleTickets.json': scaleTickets,
  'charges.json': charges,
  'waivedCharges.json': waivedCharges,
  'invoices.json': invoices,
  'creditMemos.json': creditMemos,
  'payments.json': payments,
  'paymentAllocations.json': paymentAllocations,
  'processorBatches.json': processorBatches,
  'requests.json': requests,
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 2) + '\n');
  console.log(`${name.padEnd(26)} ${Array.isArray(data) ? `${String(data.length).padStart(4)} rows` : `${String(Object.keys(data).length).padStart(4)} keys`}`);
}
console.log(`TODAY ${TODAY}; Maple open balance ${mapleInv.totalCents - (mapleInv.totalCents - 8745)}; Oakridge check ${oakTotal}`);
