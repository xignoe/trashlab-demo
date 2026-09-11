#!/usr/bin/env node
// Loads every seed JSON file and asserts referential integrity plus the money identities the
// contract promises. Exit 0 means the seed is coherent. Run: node scripts/check_seed.mjs

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const seedDir = join(here, '..', 'src', 'seed');
const load = (name) => JSON.parse(readFileSync(join(seedDir, `${name}.json`), 'utf8'));

const tables = ['hauler', 'parties', 'accounts', 'sites', 'zones', 'routes', 'catalog', 'containers', 'serviceItems', 'rateVersions', 'feeRules', 'taxRules', 'contracts', 'quotes', 'workOrders', 'serviceEvents', 'scaleTickets', 'charges', 'waived', 'invoices', 'creditMemos', 'payments', 'allocations', 'batches', 'requests'];
const S = {};
for (const t of tables) S[t] = load(t);

const failures = [];
const fail = (msg) => failures.push(msg);
const ids = (rows) => new Set(rows.map((r) => r.id));
const idSets = {
  account: ids(S.accounts), site: ids(S.sites), zone: ids(S.zones), route: ids(S.routes), catalog: ids(S.catalog),
  party: ids(S.parties), container: ids(S.containers), serviceItem: ids(S.serviceItems), rateVersion: ids(S.rateVersions),
  feeRule: ids(S.feeRules), contract: ids(S.contracts), charge: ids(S.charges), invoice: ids(S.invoices),
  payment: ids(S.payments), workOrder: ids(S.workOrders), request: ids(S.requests), batch: ids(S.batches), creditMemo: ids(S.creditMemos),
};
const ref = (kind, id, where) => {
  if (id === undefined || id === null) return;
  if (!idSets[kind].has(id)) fail(`${where}: ${kind} "${id}" does not exist`);
};
const oneOf = (value, allowed, where) => {
  if (!allowed.includes(value)) fail(`${where}: "${value}" is not one of ${allowed.join(', ')}`);
};

// Duplicate ids inside any table
for (const t of tables) {
  if (!Array.isArray(S[t])) continue;
  const seen = new Set();
  for (const row of S[t]) {
    if (row.id === undefined) continue;
    if (seen.has(row.id)) fail(`${t}: duplicate id ${row.id}`);
    seen.add(row.id);
  }
}

// Hauler
if (S.hauler.id !== 'hauler_piedmont') fail('hauler id');
oneOf(S.hauler.policy.proration, ['none', 'nextCycle', 'daily'], 'hauler.policy.proration');

// Accounts
for (const a of S.accounts) {
  ref('party', a.payerPartyId, `account ${a.id}`);
  ref('contract', a.contractId, `account ${a.id}`);
  oneOf(a.cycle, ['monthly', 'quarterly', 'perJob', 'net30'], `account ${a.id} cycle`);
  oneOf(a.status, ['active', 'pastDue', 'suspended', 'hold'], `account ${a.id} status`);
  oneOf(a.deliveryMethod, ['email', 'mail', 'portal'], `account ${a.id} deliveryMethod`);
  if (a.paymentMethodOnFile !== undefined) oneOf(a.paymentMethodOnFile, ['card', 'ach'], `account ${a.id} paymentMethodOnFile`);
}

// Sites
for (const s of S.sites) {
  ref('account', s.accountId, `site ${s.id}`);
  ref('zone', s.zoneId, `site ${s.id}`);
  ref('route', s.routeId, `site ${s.id}`);
  ref('party', s.occupantPartyId, `site ${s.id}`);
}

// Routes: every stop exists, every site with a routeId is listed on it, stops within capacity
for (const r of S.routes) {
  oneOf(r.day, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], `route ${r.id} day`);
  for (const siteId of r.stopSiteIds) ref('site', siteId, `route ${r.id} stop`);
  if (r.stopSiteIds.length > r.capacityStops) fail(`route ${r.id}: ${r.stopSiteIds.length} stops exceed capacity ${r.capacityStops}`);
}
for (const s of S.sites) {
  if (!s.routeId) continue;
  const route = S.routes.find((r) => r.id === s.routeId);
  if (route && !route.stopSiteIds.includes(s.id)) fail(`site ${s.id} has routeId ${s.routeId} but is not in its stopSiteIds`);
}
const mon = S.routes.find((r) => r.id === 'route_mon_res');
if (mon && mon.capacityStops - mon.stopSiteIds.length <= 0) fail('route_mon_res has no spare capacity');

// Catalog, containers, service items
for (const c of S.catalog) oneOf(c.lob, ['residential', 'frontload', 'rolloff'], `catalog ${c.id} lob`);
for (const c of S.containers) {
  ref('catalog', c.catalogId, `container ${c.id}`);
  ref('site', c.siteId, `container ${c.id}`);
}
for (const si of S.serviceItems) {
  ref('site', si.siteId, `serviceItem ${si.id}`);
  ref('catalog', si.catalogId, `serviceItem ${si.id}`);
  oneOf(si.frequency, ['weekly', 'eow', '2x', '3x', 'onCall'], `serviceItem ${si.id} frequency`);
  oneOf(si.status, ['active', 'held', 'ended'], `serviceItem ${si.id} status`);
  for (const cid of si.containerIds) {
    ref('container', cid, `serviceItem ${si.id} container`);
    const cont = S.containers.find((c) => c.id === cid);
    if (cont && cont.siteId !== si.siteId) fail(`serviceItem ${si.id}: container ${cid} sits at ${cont.siteId}, not ${si.siteId}`);
  }
}

// Rates, fees, tax, contracts
for (const rv of S.rateVersions) {
  ref('catalog', rv.catalogId, `rateVersion ${rv.id}`);
  ref('zone', rv.zoneId, `rateVersion ${rv.id}`);
  ref('rateVersion', rv.supersedesId, `rateVersion ${rv.id} supersedes`);
  oneOf(rv.status, ['draft', 'published'], `rateVersion ${rv.id} status`);
}
for (const f of S.feeRules) for (const lt of f.appliesTo) oneOf(lt, ['recurring', 'event', 'fee', 'lateFee'], `feeRule ${f.id} appliesTo`);
for (const t of S.taxRules) ref('zone', t.zoneId, `taxRule ${t.id}`);
for (const c of S.contracts) {
  ref('account', c.accountId, `contract ${c.id}`);
  for (const o of c.overrides) ref('catalog', o.catalogId, `contract ${c.id} override`);
}

// Events, work orders, tickets, requests, quotes
for (const e of S.serviceEvents) {
  ref('site', e.siteId, `event ${e.id}`);
  ref('route', e.routeId, `event ${e.id}`);
  oneOf(e.outcome, ['completed', 'missed', 'blocked', 'skippedSuspended'], `event ${e.id} outcome`);
  if (e.exception !== undefined) oneOf(e.exception, ['extraBags', 'overload', 'contamination', 'dryRun', 'notOut'], `event ${e.id} exception`);
  if (e.photoUrl && !existsSync(join(seedDir, e.photoUrl))) fail(`event ${e.id}: photo ${e.photoUrl} is missing from src/seed`);
}
for (const w of S.workOrders) {
  ref('site', w.siteId, `workOrder ${w.id}`);
  ref('serviceItem', w.serviceItemId, `workOrder ${w.id}`);
  ref('container', w.containerId, `workOrder ${w.id}`);
  ref('request', w.requestId, `workOrder ${w.id}`);
}
for (const t of S.scaleTickets) {
  ref('workOrder', t.workOrderId, `scaleTicket ${t.id}`);
  ref('container', t.containerId, `scaleTicket ${t.id}`);
  if (t.grossLbs - t.tareLbs !== t.netLbs) fail(`scaleTicket ${t.id}: gross minus tare is not net`);
}
for (const r of S.requests) {
  ref('account', r.accountId, `request ${r.id}`);
  ref('site', r.siteId, `request ${r.id}`);
  ref('workOrder', r.workOrderId, `request ${r.id}`);
  oneOf(r.kind, ['extraPickup', 'vacationHold', 'cartChange', 'missedPickup', 'quote'], `request ${r.id} kind`);
  oneOf(r.status, ['open', 'scheduled', 'done', 'declined'], `request ${r.id} status`);
}
for (const q of S.quotes) {
  ref('zone', q.zoneId, `quote ${q.id}`);
  for (const l of q.lines) ref('catalog', l.catalogId, `quote ${q.id} line`);
  oneOf(q.createdVia, ['storefront', 'agent', 'phone'], `quote ${q.id} createdVia`);
}
for (const w of S.waived) ref('charge', w.chargeId, 'waived');
for (const m of S.creditMemos) {
  ref('account', m.accountId, `creditMemo ${m.id}`);
  ref('invoice', m.invoiceId, `creditMemo ${m.id}`);
}

// Charges: references and the money identity
const feeById = Object.fromEntries(S.feeRules.map((f) => [f.id, f]));
for (const c of S.charges) {
  ref('account', c.accountId, `charge ${c.id}`);
  ref('site', c.siteId, `charge ${c.id}`);
  ref('catalog', c.catalogId, `charge ${c.id}`);
  ref('rateVersion', c.pricing?.rateVersionId, `charge ${c.id} pricing`);
  ref('contract', c.pricing?.contractId, `charge ${c.id} pricing`);
  oneOf(c.lineType, ['recurring', 'event', 'fee', 'lateFee'], `charge ${c.id} lineType`);
  oneOf(c.pricing?.ruleWon, ['contractOverride', 'zoneRate', 'standardRate', 'manualException'], `charge ${c.id} ruleWon`);
  oneOf(c.status, ['proposed', 'approved', 'waived', 'posted'], `charge ${c.id} status`);
  if (!c.source || !c.source.type || !c.source.id) fail(`charge ${c.id}: missing source`);
  if (c.source?.type === 'serviceItem') ref('serviceItem', c.source.id, `charge ${c.id} source`);
  for (const f of c.fees) if (!feeById[f.feeRuleId]) fail(`charge ${c.id}: fee rule ${f.feeRuleId} does not exist`);
  const feeSum = c.fees.reduce((s, f) => s + f.cents, 0);
  if (c.baseCents + feeSum + c.taxCents !== c.totalCents) fail(`charge ${c.id}: base ${c.baseCents} + fees ${feeSum} + tax ${c.taxCents} != total ${c.totalCents}`);
  if (c.lineType === 'lateFee' && (feeSum !== 0 || c.taxCents !== 0)) fail(`charge ${c.id}: late fee carries fees or tax`);
  for (const k of ['baseCents', 'taxCents', 'totalCents']) if (!Number.isInteger(c[k])) fail(`charge ${c.id}: ${k} is not integer cents`);
}

// Invoices: references, totals equal the sum of charges, and every charge belongs to at most one invoice
const chargeById = Object.fromEntries(S.charges.map((c) => [c.id, c]));
const chargeOwner = {};
for (const inv of S.invoices) {
  ref('account', inv.accountId, `invoice ${inv.id}`);
  let sub = 0, fee = 0, tax = 0, total = 0;
  for (const cid of inv.chargeIds) {
    ref('charge', cid, `invoice ${inv.id}`);
    const c = chargeById[cid];
    if (!c) continue;
    if (c.accountId !== inv.accountId) fail(`invoice ${inv.id}: charge ${cid} belongs to ${c.accountId}`);
    if (chargeOwner[cid]) fail(`charge ${cid} is on two invoices (${chargeOwner[cid]}, ${inv.id})`);
    chargeOwner[cid] = inv.id;
    sub += c.baseCents; fee += c.fees.reduce((s, f) => s + f.cents, 0); tax += c.taxCents; total += c.totalCents;
  }
  if (sub !== inv.subtotalCents) fail(`invoice ${inv.id}: subtotal ${inv.subtotalCents} != ${sub}`);
  if (fee !== inv.feeCents) fail(`invoice ${inv.id}: fees ${inv.feeCents} != ${fee}`);
  if (tax !== inv.taxCents) fail(`invoice ${inv.id}: tax ${inv.taxCents} != ${tax}`);
  if (total !== inv.totalCents) fail(`invoice ${inv.id}: total ${inv.totalCents} != ${total}`);
  if (inv.subtotalCents + inv.feeCents + inv.taxCents !== inv.totalCents) fail(`invoice ${inv.id}: header parts do not add up`);
}

// Payments, allocations, batches
for (const p of S.payments) {
  ref('account', p.accountId, `payment ${p.id}`);
  ref('batch', p.processorBatchId, `payment ${p.id}`);
  oneOf(p.method, ['check', 'card', 'ach', 'autopay', 'cash'], `payment ${p.id} method`);
  oneOf(p.status, ['pending', 'settled', 'returned'], `payment ${p.id} status`);
}
const allocatedBySource = {};
const allocatedByInvoice = {};
for (const a of S.allocations) {
  ref('invoice', a.invoiceId, 'allocation');
  if (a.sourceType === 'payment') ref('payment', a.sourceId, 'allocation');
  else if (a.sourceType === 'creditMemo') ref('creditMemo', a.sourceId, 'allocation');
  else fail(`allocation: unknown sourceType ${a.sourceType}`);
  const inv = S.invoices.find((i) => i.id === a.invoiceId);
  const src = a.sourceType === 'payment' ? S.payments.find((p) => p.id === a.sourceId) : S.creditMemos.find((m) => m.id === a.sourceId);
  if (inv && src && inv.accountId !== src.accountId) fail(`allocation ${a.sourceId} -> ${a.invoiceId}: account mismatch`);
  allocatedBySource[a.sourceId] = (allocatedBySource[a.sourceId] || 0) + a.cents;
  allocatedByInvoice[a.invoiceId] = (allocatedByInvoice[a.invoiceId] || 0) + a.cents;
}
for (const p of S.payments) {
  if ((allocatedBySource[p.id] || 0) > p.cents) fail(`payment ${p.id}: allocated more than received`);
}
for (const inv of S.invoices) {
  if ((allocatedByInvoice[inv.id] || 0) > inv.totalCents) fail(`invoice ${inv.id}: over-allocated`);
}
for (const b of S.batches) {
  let gross = 0;
  for (const pid of b.paymentIds) {
    ref('payment', pid, `batch ${b.id}`);
    const p = S.payments.find((x) => x.id === pid);
    if (p) {
      gross += p.cents;
      if (p.processorBatchId !== b.id) fail(`batch ${b.id}: payment ${pid} does not point back to the batch`);
    }
  }
  if (gross !== b.grossCents) fail(`batch ${b.id}: gross ${b.grossCents} != sum of payments ${gross}`);
  if (b.grossCents - b.feeCents !== b.netCents) fail(`batch ${b.id}: gross minus fees is not net`);
}
const batch = S.batches.find((b) => b.id === 'batch_0908');
if (!batch) fail('batch_0908 missing');
else if (batch.paymentIds.length !== 14) fail(`batch_0908 has ${batch.paymentIds.length} payments, expected 14`);

// Named scenario facts the portal depends on
const mapleQ3 = S.invoices.find((i) => i.id === 'inv_maple_2026q3');
if (!mapleQ3) fail('inv_maple_2026q3 missing');
else {
  const open = mapleQ3.totalCents - (allocatedByInvoice[mapleQ3.id] || 0);
  if (open !== 8745) fail(`inv_maple_2026q3 open balance is ${open}, expected 8745`);
  if (!mapleQ3.locked) fail('inv_maple_2026q3 is not locked');
}
const oakCheck = S.allocations.filter((a) => a.sourceId === 'pay_chk_oakridge');
if (oakCheck.length !== 3) fail(`pay_chk_oakridge has ${oakCheck.length} allocations, expected 3`);
const overCap = S.scaleTickets.filter((t) => t.netLbs / 2000 > 3);
if (overCap.length < 2) fail('expected two scale tickets over the 3 ton cap');

// Addendum B1: escalator anniversaries are full ISO dates
for (const c of S.contracts) {
  if (c.escalator && !/^\d{4}-\d{2}-\d{2}$/.test(c.escalator.anniversary)) fail(`contract ${c.id}: escalator.anniversary "${c.escalator.anniversary}" is not YYYY-MM-DD`);
}

// Addendum C8: exactly one 7% TaxRule each for zone_open, zone_boundary, zone_franchise; none for zone_notserved
{
  const want = ['zone_boundary', 'zone_franchise', 'zone_open'];
  const got = S.taxRules.map((t) => t.zoneId).sort();
  if (S.taxRules.length !== 3 || JSON.stringify(got) !== JSON.stringify(want)) fail(`taxRules must be exactly ${want.join(', ')}; found ${got.join(', ')}`);
  for (const t of S.taxRules) {
    if (t.ratePct !== 7) fail(`taxRule ${t.id}: ratePct ${t.ratePct}, expected 7`);
    if (JSON.stringify([...t.appliesTo].sort()) !== JSON.stringify(['event', 'fee', 'recurring'])) fail(`taxRule ${t.id}: appliesTo must be recurring, event, fee`);
  }
  if (S.taxRules.some((t) => t.zoneId === 'zone_notserved')) fail('zone_notserved must have no TaxRule');
}

// Addendum C5: flat fees apply once per whole month in the charge's period
const monthsIn = (p) => {
  if (!p) return 1;
  const [sy, sm] = p.start.split('-').map(Number);
  const [ey, em] = p.end.split('-').map(Number);
  return Math.max(1, (ey - sy) * 12 + (em - sm) + 1);
};
for (const c of S.charges) {
  for (const f of c.fees) {
    const rule = feeById[f.feeRuleId];
    if (rule?.kind === 'flat' && f.cents !== rule.value * monthsIn(c.period)) fail(`charge ${c.id}: flat fee ${f.feeRuleId} is ${f.cents}, expected ${rule.value} x ${monthsIn(c.period)} months`);
  }
}
const maple96 = S.charges.find((c) => c.id === 'chg_maple_q3_96');
const env = maple96?.fees.find((f) => f.feeRuleId === 'fee_env_1')?.cents;
const fuel = maple96?.fees.find((f) => f.feeRuleId === 'fee_fuel_7pct')?.cents;
if (!maple96 || maple96.baseCents !== 8700 || fuel !== 609 || env !== 300 || maple96.taxCents !== 652 || maple96.totalCents !== 10261) {
  fail(`chg_maple_q3_96 must be base 8700, fuel 609, env 300, tax 652, total 10261 (addendum C5)`);
}

// Addendum D5: extra pickup is an event rate, not a catalog SKU
if (S.catalog.some((c) => c.id === 'cat_res_extra_pickup')) fail('cat_res_extra_pickup is retired (addendum D5)');
if (S.rateVersions.some((r) => r.catalogId === 'cat_res_extra_pickup')) fail('cat_res_extra_pickup rate versions are retired (addendum D5)');
{
  const eventRates = load('eventRates');
  const want = { extraBags: 250, overload: 1000, contamination: 2000, dryRun: 2500 };
  for (const [k, v] of Object.entries(want)) if (eventRates[k] !== v) fail(`eventRates.${k} is ${eventRates[k]}, expected ${v}`);
  if (!Number.isInteger(eventRates.extraPickup) || eventRates.extraPickup <= 0) fail('eventRates.extraPickup must be positive integer cents');
}

if (failures.length) {
  console.error(`check_seed: ${failures.length} problem(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check_seed: ok (${S.accounts.length} accounts, ${S.sites.length} sites, ${S.charges.length} charges, ${S.invoices.length} invoices, ${S.payments.length} payments, ${S.serviceEvents.length} events)`);
