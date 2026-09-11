#!/usr/bin/env node
// Loads every seed file in src/seed, checks every referenced ID exists, exits 1 on any dangling reference.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Optional first argument: a seed directory to check instead of src/seed (used to prove the checks fail).
const DIR = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'seed');
const EXPECTED = ['hauler', 'zones', 'routes', 'catalog', 'rateVersions', 'feeRules', 'taxRules', 'parties', 'accounts', 'sites', 'serviceItems', 'containers', 'contracts', 'workOrders', 'serviceEvents', 'scaleTickets', 'charges', 'invoices', 'payments', 'allocations', 'batches', 'creditMemos', 'waivedCharges', 'requests', 'quotes', 'addresses'];

const errors = [];
const seed = {};
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
  try {
    seed[file.replace('.json', '')] = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  } catch (e) {
    errors.push(`${file}: invalid JSON (${e.message})`);
  }
}
for (const name of EXPECTED) if (!(name in seed)) errors.push(`missing seed file ${name}.json`);

const ids = (table) => new Set((seed[table] ?? []).map((r) => r.id));
const index = {
  accounts: ids('accounts'), sites: ids('sites'), zones: ids('zones'), routes: ids('routes'), catalog: ids('catalog'),
  parties: ids('parties'), containers: ids('containers'), serviceItems: ids('serviceItems'), workOrders: ids('workOrders'),
  invoices: ids('invoices'), charges: ids('charges'), payments: ids('payments'), feeRules: ids('feeRules'),
  rateVersions: ids('rateVersions'), contracts: ids('contracts'), requests: ids('requests'), creditMemos: ids('creditMemos'),
};
for (const [table, set] of Object.entries(index)) {
  if (set.size !== (seed[table] ?? []).length) errors.push(`${table}: duplicate ids`);
}

const check = (table, row, field, value, target) => {
  if (value === undefined || value === null) return;
  if (!index[target].has(value)) errors.push(`${table} ${row.id ?? JSON.stringify(row)}: ${field} "${value}" not found in ${target}`);
};
const checkAll = (table, row, field, values, target) => (values ?? []).forEach((v) => check(table, row, field, v, target));

for (const r of seed.accounts ?? []) { check('accounts', r, 'payerPartyId', r.payerPartyId, 'parties'); check('accounts', r, 'contractId', r.contractId, 'contracts'); }
for (const r of seed.sites ?? []) { check('sites', r, 'accountId', r.accountId, 'accounts'); check('sites', r, 'zoneId', r.zoneId, 'zones'); check('sites', r, 'routeId', r.routeId, 'routes'); check('sites', r, 'occupantPartyId', r.occupantPartyId, 'parties'); }
for (const r of seed.routes ?? []) checkAll('routes', r, 'stopSiteIds', r.stopSiteIds, 'sites');
for (const r of seed.containers ?? []) { check('containers', r, 'catalogId', r.catalogId, 'catalog'); check('containers', r, 'siteId', r.siteId, 'sites'); }
for (const r of seed.serviceItems ?? []) { check('serviceItems', r, 'siteId', r.siteId, 'sites'); check('serviceItems', r, 'catalogId', r.catalogId, 'catalog'); checkAll('serviceItems', r, 'containerIds', r.containerIds, 'containers'); }
for (const r of seed.rateVersions ?? []) { check('rateVersions', r, 'catalogId', r.catalogId, 'catalog'); check('rateVersions', r, 'zoneId', r.zoneId, 'zones'); check('rateVersions', r, 'supersedesId', r.supersedesId, 'rateVersions'); }
for (const r of seed.taxRules ?? []) check('taxRules', r, 'zoneId', r.zoneId, 'zones');
for (const r of seed.contracts ?? []) { check('contracts', r, 'accountId', r.accountId, 'accounts'); r.overrides.forEach((o) => check('contracts', r, 'overrides.catalogId', o.catalogId, 'catalog')); }
// Addendum B1: an escalator anniversary is a full ISO date (YYYY-MM-DD) that exists on the calendar, never "01-01".
const isIsoDate = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
for (const r of seed.contracts ?? []) {
  if (r.escalator && !isIsoDate(r.escalator.anniversary)) errors.push(`contracts ${r.id}: escalator.anniversary "${r.escalator.anniversary}" is not a full YYYY-MM-DD date`);
}
// Addendum C4: residential RateVersions always carry a zoneId.
const residential = new Set((seed.catalog ?? []).filter((c) => c.lob === 'residential').map((c) => c.id));
for (const r of seed.rateVersions ?? []) {
  if (residential.has(r.catalogId) && !r.zoneId) errors.push(`rateVersions ${r.id}: residential RateVersion has no zoneId`);
}
for (const r of seed.quotes ?? []) { check('quotes', r, 'zoneId', r.zoneId, 'zones'); r.lines.forEach((l) => check('quotes', r, 'lines.catalogId', l.catalogId, 'catalog')); }
for (const r of seed.workOrders ?? []) { check('workOrders', r, 'siteId', r.siteId, 'sites'); check('workOrders', r, 'serviceItemId', r.serviceItemId, 'serviceItems'); check('workOrders', r, 'containerId', r.containerId, 'containers'); check('workOrders', r, 'requestId', r.requestId, 'requests'); }
for (const r of seed.serviceEvents ?? []) { check('serviceEvents', r, 'siteId', r.siteId, 'sites'); check('serviceEvents', r, 'routeId', r.routeId, 'routes'); }
for (const r of seed.scaleTickets ?? []) { check('scaleTickets', r, 'workOrderId', r.workOrderId, 'workOrders'); check('scaleTickets', r, 'containerId', r.containerId, 'containers'); }
for (const r of seed.charges ?? []) {
  check('charges', r, 'accountId', r.accountId, 'accounts'); check('charges', r, 'siteId', r.siteId, 'sites'); check('charges', r, 'catalogId', r.catalogId, 'catalog');
  check('charges', r, 'pricing.rateVersionId', r.pricing?.rateVersionId, 'rateVersions'); check('charges', r, 'pricing.contractId', r.pricing?.contractId, 'contracts');
  r.fees.forEach((f) => check('charges', r, 'fees.feeRuleId', f.feeRuleId, 'feeRules'));
  const sourceTable = { serviceItem: 'serviceItems', serviceEvent: 'serviceEvents', scaleTicket: 'scaleTickets' }[r.source?.type];
  if (sourceTable && !(seed[sourceTable] ?? []).some((s) => s.id === r.source.id)) errors.push(`charges ${r.id}: source.id "${r.source.id}" not found in ${sourceTable}`);
  const feeSum = r.fees.reduce((s, f) => s + f.cents, 0);
  if (r.baseCents + feeSum + r.taxCents !== r.totalCents) errors.push(`charges ${r.id}: base + fees + tax != total`);
}
for (const r of seed.invoices ?? []) {
  check('invoices', r, 'accountId', r.accountId, 'accounts'); checkAll('invoices', r, 'chargeIds', r.chargeIds, 'charges');
  if (r.subtotalCents + r.feeCents + r.taxCents !== r.totalCents) errors.push(`invoices ${r.id}: subtotal + fee + tax != total`);
}
for (const r of seed.payments ?? []) { check('payments', r, 'accountId', r.accountId, 'accounts'); if (r.processorBatchId && !(seed.batches ?? []).some((b) => b.id === r.processorBatchId)) errors.push(`payments ${r.id}: processorBatchId "${r.processorBatchId}" not found in batches`); }
for (const r of seed.allocations ?? []) { check('allocations', r, 'sourceId', r.sourceId, r.sourceType === 'payment' ? 'payments' : 'creditMemos'); check('allocations', r, 'invoiceId', r.invoiceId, 'invoices'); }
for (const r of seed.batches ?? []) {
  checkAll('batches', r, 'paymentIds', r.paymentIds, 'payments');
  const gross = r.paymentIds.reduce((s, id) => s + ((seed.payments ?? []).find((p) => p.id === id)?.cents ?? 0), 0);
  if (gross !== r.grossCents) errors.push(`batches ${r.id}: payments sum ${gross} != grossCents ${r.grossCents}`);
  if (r.grossCents - r.feeCents !== r.netCents) errors.push(`batches ${r.id}: gross - fees != net`);
}
for (const r of seed.creditMemos ?? []) { check('creditMemos', r, 'accountId', r.accountId, 'accounts'); check('creditMemos', r, 'invoiceId', r.invoiceId, 'invoices'); }
for (const r of seed.waivedCharges ?? []) check('waivedCharges', r, 'chargeId', r.chargeId, 'charges');
for (const r of seed.requests ?? []) { check('requests', r, 'accountId', r.accountId, 'accounts'); check('requests', r, 'siteId', r.siteId, 'sites'); check('requests', r, 'workOrderId', r.workOrderId, 'workOrders'); }
for (const r of seed.addresses ?? []) { check('addresses', r, 'zoneId', r.zoneId, 'zones'); check('addresses', r, 'routeId', r.routeId, 'routes'); }

// every site must sit on exactly the route that lists it
for (const s of seed.sites ?? []) {
  if (s.routeId) {
    const route = (seed.routes ?? []).find((r) => r.id === s.routeId);
    if (route && !route.stopSiteIds.includes(s.id)) errors.push(`sites ${s.id}: not listed in ${s.routeId}.stopSiteIds`);
  }
}

if (errors.length) {
  console.error(`seed validation failed with ${errors.length} problem(s):`);
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}
const summary = EXPECTED.map((n) => `${n}=${Array.isArray(seed[n]) ? seed[n].length : 1}`).join(' ');
console.log(`seed ok: ${summary}`);
