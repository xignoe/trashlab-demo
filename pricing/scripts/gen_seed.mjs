#!/usr/bin/env node
// Deterministic generator for the large seed tables. Run: node scripts/gen_seed.mjs
// Small hand-authored files (hauler, zones, catalog, rateVersions, feeRules, taxRules, contracts, quotes)
// live in src/seed and are not touched here. Today is fixed at 2026-09-10 so "last 14 days" is stable.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'src', 'seed');
mkdirSync(out, { recursive: true });
const TODAY = '2026-09-10';
const pad = (n, w = 3) => String(n).padStart(w, '0');
const isoDaysAgo = (n) => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

const parties = [], accounts = [], sites = [], serviceItems = [], containers = [];
let serial = 41000;
const addContainer = (id, catalogId, siteId, assignedFrom) => {
  containers.push({ id, serial: `PD-${serial++}`, catalogId, siteId, assignedFrom });
  return id;
};
const addItem = (id, siteId, catalogId, frequency, effectiveFrom, status = 'active', qty = 1) => {
  const ids = [];
  for (let i = 0; i < qty; i++) ids.push(addContainer(`cont_${id.replace(/^si_/, '')}${qty > 1 ? `_${i + 1}` : ''}`, catalogId, siteId, effectiveFrom));
  serviceItems.push({ id, siteId, catalogId, qty, frequency, containerIds: ids, effectiveFrom, status });
};

// Named accounts
parties.push({ id: 'party_res_maple', name: 'Maple Street Homeowner', kind: 'homeowner' });
accounts.push({ id: 'acct_res_maple', payerPartyId: 'party_res_maple', cycle: 'quarterly', billedInAdvance: true, autopay: false, status: 'pastDue', deliveryMethod: 'email', taxExempt: false });
sites.push({ id: 'site_res_maple', accountId: 'acct_res_maple', occupantPartyId: 'party_res_maple', address: '412 Maple St', zoneId: 'zone_open', routeId: 'route_mon_res' });
addItem('si_res_maple_96', 'site_res_maple', 'cat_res_96', 'weekly', '2024-03-04');
addItem('si_res_maple_extra', 'site_res_maple', 'cat_res_extra_cart', 'weekly', '2025-05-12');
addItem('si_res_maple_recycling', 'site_res_maple', 'cat_res_recycling', 'eow', '2024-03-04');

parties.push({ id: 'party_res_holt', name: 'Holt', kind: 'homeowner' });
accounts.push({ id: 'acct_res_holt', payerPartyId: 'party_res_holt', cycle: 'quarterly', billedInAdvance: true, autopay: true, paymentMethodOnFile: 'card', status: 'active', deliveryMethod: 'email', taxExempt: false });
sites.push({ id: 'site_res_holt', accountId: 'acct_res_holt', occupantPartyId: 'party_res_holt', address: '27 Birch Ct', zoneId: 'zone_open', routeId: 'route_tue_res', accessNotes: 'Cart at end of driveway' });
addItem('si_res_holt_96', 'site_res_holt', 'cat_res_96', 'weekly', '2023-08-15', 'held');

parties.push({ id: 'party_res_kerr', name: 'Kerr', kind: 'homeowner' });
accounts.push({ id: 'acct_res_kerr', payerPartyId: 'party_res_kerr', cycle: 'quarterly', billedInAdvance: true, autopay: false, status: 'suspended', deliveryMethod: 'mail', taxExempt: false });
sites.push({ id: 'site_res_kerr', accountId: 'acct_res_kerr', occupantPartyId: 'party_res_kerr', address: '305 Elm Ave', zoneId: 'zone_open', routeId: 'route_mon_res' });
addItem('si_res_kerr_96', 'site_res_kerr', 'cat_res_96', 'weekly', '2022-11-07');

parties.push({ id: 'party_bakery', name: 'Sunrise Bakery', kind: 'business' });
accounts.push({ id: 'acct_bakery', payerPartyId: 'party_bakery', cycle: 'monthly', billedInAdvance: true, autopay: false, paymentMethodOnFile: 'ach', status: 'active', deliveryMethod: 'email', taxExempt: false, contractId: 'contract_bakery' });
sites.push({ id: 'site_bakery', accountId: 'acct_bakery', occupantPartyId: 'party_bakery', address: '88 Commerce Way', zoneId: 'zone_open', routeId: 'route_wed_fl', accessNotes: 'Enclosure behind loading dock, keypad 4410' });
addItem('si_bakery_3yd', 'site_bakery', 'cat_fl_3yd', '2x', '2026-01-01');
addItem('si_bakery_3yd_wood', 'site_bakery', 'cat_fl_3yd_wood', '2x', '2026-01-01');

parties.push({ id: 'party_pm_oakridge', name: 'Oakridge Property Management', kind: 'propertyManager' });
accounts.push({ id: 'acct_pm_oakridge', payerPartyId: 'party_pm_oakridge', cycle: 'net30', billedInAdvance: false, autopay: false, status: 'active', deliveryMethod: 'email', taxExempt: false });
const oakBuildings = ['Building A', 'Building B', 'Building C', 'Clubhouse'];
for (let i = 1; i <= 4; i++) {
  sites.push({ id: `site_oakridge_${i}`, accountId: 'acct_pm_oakridge', address: `1200 Oakridge Blvd, ${oakBuildings[i - 1]}`, zoneId: 'zone_open', routeId: 'route_wed_fl', poNumber: `PO-OAK-2026-0${i}` });
  addItem(`si_oakridge_${i}_2yd`, `site_oakridge_${i}`, 'cat_fl_2yd', 'weekly', '2025-02-01');
}

parties.push({ id: 'party_contractor_hale', name: 'Hale Construction', kind: 'contractor' });
accounts.push({ id: 'acct_contractor_hale', payerPartyId: 'party_contractor_hale', cycle: 'net30', billedInAdvance: false, autopay: false, status: 'active', deliveryMethod: 'email', taxExempt: false });
sites.push({ id: 'site_hale_1', accountId: 'acct_contractor_hale', address: '1400 Industrial Pkwy, job site', zoneId: 'zone_open', routeId: 'route_thu_ro', poNumber: 'HALE-JOB-2231' });
sites.push({ id: 'site_hale_2', accountId: 'acct_contractor_hale', address: '62 Quarry Rd, job site', zoneId: 'zone_open', routeId: 'route_thu_ro', poNumber: 'HALE-JOB-2240' });
addItem('si_hale_1_ro_a', 'site_hale_1', 'cat_ro_20yd', 'onCall', '2026-08-03');
addItem('si_hale_1_ro_b', 'site_hale_1', 'cat_ro_20yd', 'onCall', '2026-08-03');
addItem('si_hale_2_ro_a', 'site_hale_2', 'cat_ro_20yd', 'onCall', '2026-08-20');

parties.push({ id: 'party_ro_homeowner', name: 'Delgado', kind: 'homeowner' });
accounts.push({ id: 'acct_ro_homeowner', payerPartyId: 'party_ro_homeowner', cycle: 'perJob', billedInAdvance: true, autopay: false, paymentMethodOnFile: 'card', status: 'active', deliveryMethod: 'email', taxExempt: false });
sites.push({ id: 'site_ro_homeowner', accountId: 'acct_ro_homeowner', occupantPartyId: 'party_ro_homeowner', address: '58 Linden Dr', zoneId: 'zone_open', routeId: 'route_thu_ro', accessNotes: 'Box on driveway, no plywood needed' });
const RO_HOME_DELIVERED = isoDaysAgo(34);
addItem('si_ro_homeowner', 'site_ro_homeowner', 'cat_ro_20yd', 'onCall', RO_HOME_DELIVERED);

// 30 generic residential accounts
const resNames = ['Alvarez', 'Bennett', 'Chen', 'Dawson', 'Ellis', 'Foster', 'Gupta', 'Harmon', 'Ibarra', 'Jensen', 'Kowalski', 'Lambert', 'Mendez', 'Nakamura', 'Okafor', 'Patel', 'Quinn', 'Reyes', 'Sullivan', 'Tran', 'Underwood', 'Vasquez', 'Whitaker', 'Xiong', 'Young', 'Zimmerman', 'Abernathy', 'Brooks', 'Castillo', 'Dunn'];
const resStreets = ['Maple St', 'Elm Ave', 'Birch Ct', 'Cedar Ln', 'Willow Way', 'Poplar Dr', 'Sycamore Rd', 'Hickory Pl', 'Dogwood Ter', 'Magnolia Ave'];
for (let i = 1; i <= 30; i++) {
  const n = pad(i);
  parties.push({ id: `party_res_${n}`, name: resNames[i - 1], kind: 'homeowner' });
  const autopay = i % 3 === 0;
  accounts.push({ id: `acct_res_${n}`, payerPartyId: `party_res_${n}`, cycle: 'quarterly', billedInAdvance: true, autopay, ...(autopay ? { paymentMethodOnFile: 'card' } : {}), status: 'active', deliveryMethod: autopay ? 'portal' : 'email', taxExempt: false });
  sites.push({ id: `site_res_${n}`, accountId: `acct_res_${n}`, occupantPartyId: `party_res_${n}`, address: `${100 + i * 7} ${resStreets[i % resStreets.length]}`, zoneId: 'zone_open', routeId: i <= 15 ? 'route_mon_res' : 'route_tue_res' });
  const cart = i === 5 || i === 17 ? 'cat_res_64' : 'cat_res_96';
  addItem(`si_res_${n}_cart`, `site_res_${n}`, cart, 'weekly', `202${3 + (i % 3)}-0${1 + (i % 9)}-01`);
  if (i % 2 === 0) addItem(`si_res_${n}_recycling`, `site_res_${n}`, 'cat_res_recycling', 'eow', `202${3 + (i % 3)}-0${1 + (i % 9)}-01`);
}

// 8 generic frontload accounts
const flNames = ['Riverside Dental Group', 'Copper Kettle Diner', 'Northgate Auto Body', 'Pinecrest Veterinary Clinic', 'Harbor Print and Copy', 'Blue Door Coffee Roasters', 'Summit Fitness Club', 'Maple Grove Pharmacy'];
const flStreets = ['Commerce Way', 'Market St', 'Industrial Pkwy', 'Depot Rd', 'Main St', 'Mill St', 'Center Ave', 'Broad St'];
for (let i = 1; i <= 8; i++) {
  const n = pad(i);
  parties.push({ id: `party_fl_${n}`, name: flNames[i - 1], kind: 'business' });
  const contract = i <= 4;
  accounts.push({ id: `acct_fl_${n}`, payerPartyId: `party_fl_${n}`, cycle: 'monthly', billedInAdvance: true, autopay: i % 2 === 0, ...(i % 2 === 0 ? { paymentMethodOnFile: 'ach' } : {}), status: 'active', deliveryMethod: 'email', taxExempt: false, ...(contract ? { contractId: `contract_fl_${n}` } : {}) });
  sites.push({ id: `site_fl_${n}`, accountId: `acct_fl_${n}`, occupantPartyId: `party_fl_${n}`, address: `${200 + i * 15} ${flStreets[i - 1]}`, zoneId: 'zone_open', routeId: 'route_wed_fl' });
  if (contract) addItem(`si_fl_${n}_3yd`, `site_fl_${n}`, 'cat_fl_3yd', '2x', '2025-03-01');
  else addItem(`si_fl_${n}_2yd`, `site_fl_${n}`, 'cat_fl_2yd', 'weekly', '2025-06-01');
}

// Routes
const routes = [
  { id: 'route_mon_res', day: 'Mon', lob: 'residential', stopSiteIds: sites.filter((s) => s.routeId === 'route_mon_res').map((s) => s.id), capacityStops: 400 },
  { id: 'route_tue_res', day: 'Tue', lob: 'residential', stopSiteIds: sites.filter((s) => s.routeId === 'route_tue_res').map((s) => s.id), capacityStops: 400 },
  { id: 'route_wed_fl', day: 'Wed', lob: 'frontload', stopSiteIds: sites.filter((s) => s.routeId === 'route_wed_fl').map((s) => s.id), capacityStops: 120 },
  { id: 'route_thu_ro', day: 'Thu', lob: 'rolloff', stopSiteIds: sites.filter((s) => s.routeId === 'route_thu_ro').map((s) => s.id), capacityStops: 30 },
];

// Service events for the last 14 days (2026-08-27 through 2026-09-09).
// Route days in window: Mon 08-31 and 09-07, Tue 09-01 and 09-08, Wed 09-02 and 09-09, Thu 08-27 and 09-03.
const serviceEvents = [];
let ev = 1;
const drivers = { route_mon_res: 'Luis O.', route_tue_res: 'Dana P.', route_wed_fl: 'Marcus T.', route_thu_ro: 'Ray K.' };
const pushEvent = (siteId, routeId, date, extra = {}) => {
  serviceEvents.push({ id: `ev_${pad(ev++, 4)}`, siteId, routeId, date, outcome: 'completed', driver: drivers[routeId], ...extra });
};
const routeDays = { route_mon_res: ['2026-08-31', '2026-09-07'], route_tue_res: ['2026-09-01', '2026-09-08'], route_wed_fl: ['2026-09-02', '2026-09-09'] };
for (const r of routes.filter((x) => x.id in routeDays)) {
  for (const date of routeDays[r.id]) {
    for (const siteId of r.stopSiteIds) {
      if (siteId === 'site_res_holt') continue; // account on vacation hold, item held, no stop
      if (siteId === 'site_res_kerr') { pushEvent(siteId, r.id, date, { outcome: 'skippedSuspended', note: 'Account suspended, no service' }); continue; }
      if (siteId === 'site_res_maple' && date === '2026-09-07') { pushEvent(siteId, r.id, date, { exception: 'extraBags', photoUrl: '/evidence/ev_maple_extra_bags_2026-09-07.jpg', note: '3 bags beside cart' }); continue; }
      if (siteId === 'site_res_014' && date === '2026-09-07') { pushEvent(siteId, r.id, date, { exception: 'overload', photoUrl: '/evidence/ev_res_014_overload_2026-09-07.jpg', note: 'Lid open, cart over capacity' }); continue; }
      if (siteId === 'site_fl_003' && date === '2026-09-09') { pushEvent(siteId, r.id, date, { outcome: 'blocked', exception: 'dryRun', note: 'Vehicle parked in front of enclosure' }); continue; }
      if (siteId === 'site_bakery' && date === '2026-09-09') { pushEvent(siteId, r.id, date, { exception: 'contamination', photoUrl: '/evidence/ev_bakery_contamination_2026-09-09.jpg', note: 'wood container' }); continue; }
      pushEvent(siteId, r.id, date);
    }
  }
}
pushEvent('site_hale_1', 'route_thu_ro', '2026-09-03', { outcome: 'blocked', exception: 'dryRun', note: 'Gate locked, no contact on site' });

// Work orders and scale tickets
const workOrders = [
  { id: 'wo_ro_homeowner_deliver', siteId: 'site_ro_homeowner', kind: 'deliver', status: 'done', scheduledFor: RO_HOME_DELIVERED, serviceItemId: 'si_ro_homeowner', containerId: 'cont_ro_homeowner', completedAt: `${RO_HOME_DELIVERED}T09:30:00` },
  { id: 'wo_hale_001', siteId: 'site_hale_1', kind: 'dumpAndReturn', status: 'done', scheduledFor: '2026-09-03', serviceItemId: 'si_hale_1_ro_a', containerId: 'cont_hale_1_ro_a', completedAt: '2026-09-03T11:10:00' },
  { id: 'wo_hale_002', siteId: 'site_hale_2', kind: 'dumpAndReturn', status: 'done', scheduledFor: '2026-08-27', serviceItemId: 'si_hale_2_ro_a', containerId: 'cont_hale_2_ro_a', completedAt: '2026-08-27T14:40:00' },
  { id: 'wo_hale_003', siteId: 'site_hale_1', kind: 'recovery', status: 'scheduled', scheduledFor: '2026-09-10', serviceItemId: 'si_hale_1_ro_b', containerId: 'cont_hale_1_ro_b' },
];
const scaleTickets = [
  { id: 'st_hale_001', workOrderId: 'wo_hale_001', containerId: 'cont_hale_1_ro_a', facility: 'Piedmont Transfer Station', material: 'mixed C&D', grossLbs: 24400, tareLbs: 16000, netLbs: 8400, ticketedAt: '2026-09-03T10:42:00' },
  { id: 'st_hale_002', workOrderId: 'wo_hale_002', containerId: 'cont_hale_2_ro_a', facility: 'Piedmont Transfer Station', material: 'mixed C&D', grossLbs: 23100, tareLbs: 16000, netLbs: 7100, ticketedAt: '2026-08-27T14:15:00' },
];
const requests = [
  { id: 'req_holt_vacation', accountId: 'acct_res_holt', siteId: 'site_res_holt', kind: 'vacationHold', status: 'scheduled', createdVia: 'portal', note: 'Away Sep 1 through Sep 21, resume Sep 22' },
  { id: 'req_bakery_quote', accountId: 'acct_bakery', siteId: 'site_bakery', kind: 'quote', status: 'open', createdVia: 'storefront', note: 'Asked for a second 3 yd on the wood stream' },
  { id: 'req_hale_recovery', accountId: 'acct_contractor_hale', siteId: 'site_hale_1', kind: 'extraPickup', status: 'scheduled', createdVia: 'phone', workOrderId: 'wo_hale_003', note: 'Pull box B before Friday pour' },
];

// Charges and invoices. Fee and tax math follows the engine rules: fuel 7 percent of base (taxable), env $1 flat (not taxed), tax 7 percent of base plus taxable fees.
const charges = [];
const invoices = [];
const r = (x) => Math.round(x);
const recurringCharge = (id, accountId, siteId, catalogId, description, sourceId, period, baseCents, pricing, evidenceIds = []) => {
  const fuel = r(baseCents * 0.07);
  const env = 100;
  const tax = r((baseCents + fuel) * 0.07);
  const c = { id, accountId, siteId, lineType: 'recurring', catalogId, description, source: { type: 'serviceItem', id: sourceId }, period, baseCents, fees: [{ feeRuleId: 'fee_fuel_7pct', cents: fuel }, { feeRuleId: 'fee_env_1', cents: env }], taxCents: tax, totalCents: baseCents + fuel + env + tax, pricing, status: 'posted', evidenceIds };
  charges.push(c);
  return c;
};
const invoiceFor = (id, accountId, number, cs, issuedAt, dueAt, postedAt, deliveredVia, fixed) => {
  const inv = fixed ?? {
    subtotalCents: cs.reduce((a, c) => a + c.baseCents, 0),
    feeCents: cs.reduce((a, c) => a + c.fees.reduce((x, f) => x + f.cents, 0), 0),
    taxCents: cs.reduce((a, c) => a + c.taxCents, 0),
  };
  const totalCents = inv.subtotalCents + inv.feeCents + inv.taxCents;
  invoices.push({ id, accountId, number, chargeIds: cs.map((c) => c.id), ...inv, totalCents, issuedAt, dueAt, postedAt, locked: true, deliveredVia });
};

// inv_res_maple_0001: totals fixed by the contract ($87.45 past due) and the checklist. The three charges are split to
// reproduce those exact totals; see DECISIONS.md Phase 1 for why they do not re-derive from today's fee rules.
const mapleFixed = [
  { id: 'ch_res_maple_0001_96', catalogId: 'cat_res_96', description: '96 gal cart, weekly, Jul 1 to Sep 30 2026', source: 'si_res_maple_96', rv: 'rv_res_96_open_weekly', baseCents: 4500, fees: [{ feeRuleId: 'fee_fuel_7pct', cents: 265 }, { feeRuleId: 'fee_env_1', cents: 100 }], taxCents: 280 },
  { id: 'ch_res_maple_0001_extra', catalogId: 'cat_res_extra_cart', description: 'Extra 96 gal cart, weekly, Jul 1 to Sep 30 2026', source: 'si_res_maple_extra', rv: 'rv_res_extra_open_weekly', baseCents: 1400, fees: [{ feeRuleId: 'fee_fuel_7pct', cents: 45 }], taxCents: 90 },
  { id: 'ch_res_maple_0001_recycling', catalogId: 'cat_res_recycling', description: 'Recycling cart, every other week, Jul 1 to Sep 30 2026', source: 'si_res_maple_recycling', rv: 'rv_res_recycling_open_eow', baseCents: 1900, fees: [{ feeRuleId: 'fee_fuel_7pct', cents: 50 }], taxCents: 115 },
];
const mapleCharges = mapleFixed.map((m) => {
  const feeSum = m.fees.reduce((a, f) => a + f.cents, 0);
  const c = { id: m.id, accountId: 'acct_res_maple', siteId: 'site_res_maple', lineType: 'recurring', catalogId: m.catalogId, description: m.description, source: { type: 'serviceItem', id: m.source }, period: { start: '2026-07-01', end: '2026-09-30' }, baseCents: m.baseCents, fees: m.fees, taxCents: m.taxCents, totalCents: m.baseCents + feeSum + m.taxCents, pricing: { rateVersionId: m.rv, ruleWon: 'zoneRate' }, status: 'posted', evidenceIds: [] };
  charges.push(c);
  return c;
});
invoiceFor('inv_res_maple_0001', 'acct_res_maple', 'INV-1001', mapleCharges, '2026-07-01', '2026-07-15', '2026-07-01T06:00:00', 'email', { subtotalCents: 7800, feeCents: 460, taxCents: 485 });

// inv_bakery_0001: September, monthly in advance, contract override prices.
const bakeryCharges = [
  recurringCharge('ch_bakery_0001_3yd', 'acct_bakery', 'site_bakery', 'cat_fl_3yd', '3 yd frontload, 2x weekly, Sep 2026', 'si_bakery_3yd', { start: '2026-09-01', end: '2026-09-30' }, 19800, { contractId: 'contract_bakery', ruleWon: 'contractOverride' }),
  recurringCharge('ch_bakery_0001_3yd_wood', 'acct_bakery', 'site_bakery', 'cat_fl_3yd_wood', '3 yd frontload wood waste, 2x weekly, Sep 2026', 'si_bakery_3yd_wood', { start: '2026-09-01', end: '2026-09-30' }, 17100, { contractId: 'contract_bakery', ruleWon: 'contractOverride' }),
];
invoiceFor('inv_bakery_0001', 'acct_bakery', 'INV-1002', bakeryCharges, '2026-09-01', '2026-09-15', '2026-09-01T06:00:00', 'email');

// Three Oakridge invoices, one per month in arrears (net30), each covering all four sites.
const oakMonths = [['2026-06-01', '2026-06-30', '2026-07-30', 'Jun 2026'], ['2026-07-01', '2026-07-31', '2026-08-30', 'Jul 2026'], ['2026-08-01', '2026-08-31', '2026-09-30', 'Aug 2026']];
oakMonths.forEach(([start, end, due, label], idx) => {
  const n = pad(idx + 1, 4);
  const cs = [1, 2, 3, 4].map((i) => recurringCharge(`ch_oakridge_${n}_site${i}`, 'acct_pm_oakridge', `site_oakridge_${i}`, 'cat_fl_2yd', `2 yd frontload, weekly, ${oakBuildings[i - 1]}, ${label} (PO-OAK-2026-0${i})`, `si_oakridge_${i}_2yd`, { start, end }, 16000, { rateVersionId: 'rv_fl_2yd_weekly', ruleWon: 'standardRate' }));
  invoiceFor(`inv_oakridge_${n}`, 'acct_pm_oakridge', `INV-10${10 + idx}`, cs, end, due, `${end}T18:00:00`, 'email');
});

// Payments, allocations, processor batch
const oakInvoices = invoices.filter((i) => i.accountId === 'acct_pm_oakridge');
const oakTotal = oakInvoices.reduce((a, i) => a + i.totalCents, 0);
const payments = [
  { id: 'pay_chk_oakridge', accountId: 'acct_pm_oakridge', method: 'check', cents: oakTotal, receivedAt: '2026-09-04', status: 'settled' },
];
const allocations = oakInvoices.map((i) => ({ sourceType: 'payment', sourceId: 'pay_chk_oakridge', invoiceId: i.id, cents: i.totalCents }));

// batch_0908: 14 card payments summing to exactly 131842 (gross), fees 4120, net 127722.
const cardAmounts = [10261, 10261, 10261, 10261, 10261, 10261, 10261, 10261, 10261, 10261, 4590, 4590, 9316];
const last = 131842 - cardAmounts.reduce((a, b) => a + b, 0);
cardAmounts.push(last);
const cardPayers = ['acct_res_003', 'acct_res_006', 'acct_res_009', 'acct_res_012', 'acct_res_015', 'acct_res_018', 'acct_res_021', 'acct_res_024', 'acct_res_027', 'acct_res_030', 'acct_res_002', 'acct_res_008', 'acct_res_holt', 'acct_ro_homeowner'];
cardAmounts.forEach((cents, i) => {
  payments.push({ id: `pay_card_${pad(i + 1)}`, accountId: cardPayers[i], method: i === 12 ? 'autopay' : 'card', cents, receivedAt: `2026-09-0${5 + (i % 3)}`, processorBatchId: 'batch_0908', status: 'settled' });
});
const processorBatches = [
  { id: 'batch_0908', depositedAt: '2026-09-08', grossCents: 131842, feeCents: 4120, netCents: 127722, paymentIds: payments.filter((p) => p.processorBatchId === 'batch_0908').map((p) => p.id) },
];
if (processorBatches[0].paymentIds.length !== 14) throw new Error('batch must hold 14 payments');
if (payments.filter((p) => p.processorBatchId === 'batch_0908').reduce((a, p) => a + p.cents, 0) !== 131842) throw new Error('batch gross mismatch');

const write = (name, data) => writeFileSync(join(out, name), JSON.stringify(data, null, 2) + '\n');
write('parties.json', parties);
write('accounts.json', accounts);
write('sites.json', sites);
write('serviceItems.json', serviceItems);
write('containers.json', containers);
write('routes.json', routes);
write('serviceEvents.json', serviceEvents);
write('scaleTickets.json', scaleTickets);
write('workOrders.json', workOrders);
write('requests.json', requests);
write('charges.json', charges);
write('invoices.json', invoices);
write('payments.json', payments);
write('allocations.json', allocations);
write('processorBatches.json', processorBatches);
write('waivedCharges.json', []);
write('creditMemos.json', []);
console.log(`parties ${parties.length}, accounts ${accounts.length}, sites ${sites.length}, items ${serviceItems.length}, containers ${containers.length}, events ${serviceEvents.length}, charges ${charges.length}, invoices ${invoices.length}, payments ${payments.length}, oakridge check ${oakTotal}`);
