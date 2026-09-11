import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { seed } from './index';
import { TODAY } from '../store/clock';

const ids = <T extends { id: string }>(rows: T[]) => new Set(rows.map((r) => r.id));
const accounts = ids(seed.billingAccounts);
const parties = ids(seed.parties);
const sites = ids(seed.sites);
const zones = ids(seed.zones);
const routes = ids(seed.routes);
const catalog = ids(seed.serviceCatalog);
const containers = ids(seed.containers);
const serviceItems = ids(seed.serviceItems);
const rateVersions = ids(seed.rateVersions);
const feeRules = ids(seed.feeRules);
const contracts = ids(seed.contracts);
const workOrders = ids(seed.workOrders);
const charges = ids(seed.charges);
const invoices = ids(seed.invoices);
const payments = ids(seed.payments);
const creditMemos = ids(seed.creditMemos);
const requests = ids(seed.requests);
const batches = ids(seed.processorBatches);

const byId = <T extends { id: string }>(rows: T[]) => Object.fromEntries(rows.map((r) => [r.id, r])) as Record<string, T>;
const invoice = byId(seed.invoices);
const charge = byId(seed.charges);
const site = byId(seed.sites);

function openBalance(invoiceId: string): number {
  const applied = seed.paymentAllocations.filter((a) => a.invoiceId === invoiceId).reduce((s, a) => s + a.cents, 0);
  return invoice[invoiceId].totalCents - applied;
}

describe('seed: every id is unique within its collection', () => {
  const collections: [string, { id: string }[]][] = [
    ['billingAccounts', seed.billingAccounts], ['parties', seed.parties], ['sites', seed.sites], ['routes', seed.routes],
    ['serviceCatalog', seed.serviceCatalog], ['containers', seed.containers], ['serviceItems', seed.serviceItems],
    ['rateVersions', seed.rateVersions], ['contracts', seed.contracts], ['workOrders', seed.workOrders],
    ['serviceEvents', seed.serviceEvents], ['scaleTickets', seed.scaleTickets], ['charges', seed.charges],
    ['invoices', seed.invoices], ['payments', seed.payments], ['requests', seed.requests], ['quotes', seed.quotes],
  ];
  for (const [name, rows] of collections) {
    it(name, () => expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length));
  }
});

describe('seed: every referenced id resolves', () => {
  it('billing accounts reference parties and contracts', () => {
    for (const a of seed.billingAccounts) {
      expect(parties.has(a.payerPartyId), `${a.id} payer`).toBe(true);
      if (a.contractId) expect(contracts.has(a.contractId), `${a.id} contract`).toBe(true);
    }
  });
  it('sites reference accounts, zones, routes, occupants', () => {
    for (const s of seed.sites) {
      expect(accounts.has(s.accountId), `${s.id} account`).toBe(true);
      expect(zones.has(s.zoneId), `${s.id} zone`).toBe(true);
      if (s.routeId) expect(routes.has(s.routeId), `${s.id} route`).toBe(true);
      if (s.occupantPartyId) expect(parties.has(s.occupantPartyId), `${s.id} occupant`).toBe(true);
    }
  });
  it('service items reference sites, catalog, containers', () => {
    for (const si of seed.serviceItems) {
      expect(sites.has(si.siteId), `${si.id} site`).toBe(true);
      expect(catalog.has(si.catalogId), `${si.id} catalog`).toBe(true);
      for (const c of si.containerIds) expect(containers.has(c), `${si.id} container ${c}`).toBe(true);
    }
  });
  it('containers reference catalog and sites', () => {
    for (const c of seed.containers) {
      expect(catalog.has(c.catalogId), `${c.id} catalog`).toBe(true);
      if (c.siteId) expect(sites.has(c.siteId), `${c.id} site`).toBe(true);
    }
  });
  it('rate versions reference catalog, zones, superseded versions', () => {
    for (const rv of seed.rateVersions) {
      expect(catalog.has(rv.catalogId), `${rv.id} catalog`).toBe(true);
      if (rv.zoneId) expect(zones.has(rv.zoneId), `${rv.id} zone`).toBe(true);
      if (rv.supersedesId) expect(rateVersions.has(rv.supersedesId), `${rv.id} supersedes`).toBe(true);
    }
  });
  it('contracts reference accounts and catalog', () => {
    for (const c of seed.contracts) {
      expect(accounts.has(c.accountId), `${c.id} account`).toBe(true);
      for (const o of c.overrides) expect(catalog.has(o.catalogId), `${c.id} override`).toBe(true);
    }
  });
  it('work orders reference sites, items, containers, requests', () => {
    for (const w of seed.workOrders) {
      expect(sites.has(w.siteId), `${w.id} site`).toBe(true);
      if (w.serviceItemId) expect(serviceItems.has(w.serviceItemId), `${w.id} item`).toBe(true);
      if (w.containerId) expect(containers.has(w.containerId), `${w.id} container`).toBe(true);
      if (w.requestId) expect(requests.has(w.requestId), `${w.id} request`).toBe(true);
    }
  });
  it('service events reference sites and routes', () => {
    for (const e of seed.serviceEvents) {
      expect(sites.has(e.siteId), `${e.id} site`).toBe(true);
      expect(routes.has(e.routeId), `${e.id} route`).toBe(true);
    }
  });
  it('scale tickets reference work orders and containers, and weights subtract', () => {
    for (const t of seed.scaleTickets) {
      expect(workOrders.has(t.workOrderId), `${t.id} wo`).toBe(true);
      expect(containers.has(t.containerId), `${t.id} container`).toBe(true);
      expect(t.grossLbs - t.tareLbs, `${t.id} net`).toBe(t.netLbs);
    }
  });
  it('charges reference accounts, sites, catalog, fee rules, rate versions, contracts, sources', () => {
    for (const c of seed.charges) {
      expect(accounts.has(c.accountId), `${c.id} account`).toBe(true);
      expect(sites.has(c.siteId), `${c.id} site`).toBe(true);
      expect(site[c.siteId].accountId, `${c.id} site belongs to account`).toBe(c.accountId);
      if (c.catalogId) expect(catalog.has(c.catalogId), `${c.id} catalog`).toBe(true);
      for (const f of c.fees) expect(feeRules.has(f.feeRuleId), `${c.id} fee ${f.feeRuleId}`).toBe(true);
      if (c.pricing.rateVersionId) expect(rateVersions.has(c.pricing.rateVersionId), `${c.id} rv`).toBe(true);
      if (c.pricing.contractId) expect(contracts.has(c.pricing.contractId), `${c.id} contract`).toBe(true);
      if (c.source.type === 'serviceItem') expect(serviceItems.has(c.source.id), `${c.id} source item`).toBe(true);
    }
  });
  it('invoices reference accounts and posted charges of the same account', () => {
    for (const inv of seed.invoices) {
      expect(accounts.has(inv.accountId), `${inv.id} account`).toBe(true);
      for (const cid of inv.chargeIds) {
        expect(charges.has(cid), `${inv.id} charge ${cid}`).toBe(true);
        expect(charge[cid].accountId, `${inv.id} charge account`).toBe(inv.accountId);
        expect(charge[cid].status, `${inv.id} charge status`).toBe('posted');
      }
    }
  });
  it('payments, allocations, credit memos, batches, requests resolve', () => {
    for (const p of seed.payments) {
      expect(accounts.has(p.accountId), `${p.id} account`).toBe(true);
      if (p.processorBatchId) expect(batches.has(p.processorBatchId), `${p.id} batch`).toBe(true);
    }
    for (const a of seed.paymentAllocations) {
      expect(invoices.has(a.invoiceId), `allocation invoice ${a.invoiceId}`).toBe(true);
      if (a.sourceType === 'payment') expect(payments.has(a.sourceId), `allocation payment ${a.sourceId}`).toBe(true);
      else expect(creditMemos.has(a.sourceId), `allocation credit ${a.sourceId}`).toBe(true);
    }
    for (const m of seed.creditMemos) {
      expect(accounts.has(m.accountId)).toBe(true);
      if (m.invoiceId) expect(invoices.has(m.invoiceId)).toBe(true);
    }
    for (const b of seed.processorBatches) for (const pid of b.paymentIds) expect(payments.has(pid), `${b.id} ${pid}`).toBe(true);
    for (const r of seed.requests) {
      expect(accounts.has(r.accountId)).toBe(true);
      expect(sites.has(r.siteId)).toBe(true);
      if (r.workOrderId) expect(workOrders.has(r.workOrderId)).toBe(true);
    }
    for (const q of seed.quotes) {
      if (q.zoneId) expect(zones.has(q.zoneId)).toBe(true);
      for (const l of q.lines) expect(catalog.has(l.catalogId)).toBe(true);
    }
  });
});

describe('seed: invariant 2, every charge carries base, fees, tax, source, ruleWon', () => {
  it('holds for every seeded charge and the columns tie', () => {
    for (const c of seed.charges) {
      expect(typeof c.baseCents).toBe('number');
      expect(Array.isArray(c.fees)).toBe(true);
      expect(typeof c.taxCents).toBe('number');
      expect(c.source.type).toBeTruthy();
      expect(c.source.id).toBeTruthy();
      expect(['contractOverride', 'zoneRate', 'standardRate', 'manualException']).toContain(c.pricing.ruleWon);
      const feeSum = c.fees.reduce((s, f) => s + f.cents, 0);
      expect(c.baseCents + feeSum + c.taxCents, `${c.id} total`).toBe(c.totalCents);
      expect(Number.isInteger(c.totalCents)).toBe(true);
      if (c.lineType === 'lateFee') expect(c.taxCents).toBe(0);
    }
  });
  it('fee and tax arithmetic follows the rules (7% fuel taxable, $1 env per month untaxed, 7% tax)', () => {
    for (const c of seed.charges) {
      const fuel = c.fees.find((f) => f.feeRuleId === 'fee_fuel_7pct')?.cents ?? 0;
      const env = c.fees.find((f) => f.feeRuleId === 'fee_env_1')?.cents ?? 0;
      expect(fuel, `${c.id} fuel`).toBe(Math.round(c.baseCents * 0.07));
      if (c.lineType === 'recurring' && c.period) {
        const months = (Number(c.period.end.slice(0, 4)) - Number(c.period.start.slice(0, 4))) * 12 + Number(c.period.end.slice(5, 7)) - Number(c.period.start.slice(5, 7)) + 1;
        expect(env, `${c.id} env`).toBe(100 * months);
      } else {
        expect(env, `${c.id} env only on recurring`).toBe(0);
      }
      expect(c.taxCents, `${c.id} tax`).toBe(Math.round((c.baseCents + fuel) * 0.07));
    }
  });
});

describe('seed: invoices', () => {
  it('every posted invoice is locked, has postedAt, a PD number, and totals tie to its charges', () => {
    expect(seed.invoices.length).toBeGreaterThan(0);
    const numbers = new Set<string>();
    for (const inv of seed.invoices) {
      expect(inv.locked, `${inv.id} locked`).toBe(true);
      expect(inv.postedAt, `${inv.id} postedAt`).toBeTruthy();
      expect(inv.number, `${inv.id} number`).toMatch(/^PD-2026-\d{4}$/);
      expect(numbers.has(inv.number), `${inv.id} number unique`).toBe(false);
      numbers.add(inv.number);
      const lines = inv.chargeIds.map((id) => charge[id]);
      const subtotal = lines.reduce((s, c) => s + c.baseCents, 0);
      const fee = lines.reduce((s, c) => s + c.fees.reduce((f, x) => f + x.cents, 0), 0);
      const tax = lines.reduce((s, c) => s + c.taxCents, 0);
      const total = lines.reduce((s, c) => s + c.totalCents, 0);
      expect(inv.subtotalCents, `${inv.id} subtotal`).toBe(subtotal);
      expect(inv.feeCents, `${inv.id} fees`).toBe(fee);
      expect(inv.taxCents, `${inv.id} tax`).toBe(tax);
      expect(inv.totalCents, `${inv.id} total`).toBe(total);
      expect(inv.subtotalCents + inv.feeCents + inv.taxCents, `${inv.id} columns`).toBe(inv.totalCents);
      expect(inv.dueAt >= inv.issuedAt, `${inv.id} due after issue`).toBe(true);
    }
  });
  it('no charge is on two invoices, and every posted charge is on an invoice', () => {
    const seen = new Map<string, string>();
    for (const inv of seed.invoices) for (const cid of inv.chargeIds) {
      expect(seen.has(cid), `${cid} already on ${seen.get(cid)}`).toBe(false);
      seen.set(cid, inv.id);
    }
    for (const c of seed.charges) if (c.status === 'posted') expect(seen.has(c.id), `${c.id} posted but not invoiced`).toBe(true);
  });
  it('no allocation exceeds its invoice total', () => {
    for (const inv of seed.invoices) expect(openBalance(inv.id), `${inv.id} over-allocated`).toBeGreaterThanOrEqual(0);
  });
});

describe('seed: focus account numbers', () => {
  it('Maple: Q3 invoice partially paid, open balance is exactly 8745 cents', () => {
    const inv = invoice['inv_maple_q3'];
    expect(inv.accountId).toBe('acct_res_maple');
    expect(inv.issuedAt).toBe('2026-06-20');
    expect(inv.dueAt).toBe('2026-07-05');
    expect(inv.chargeIds).toHaveLength(3);
    expect(charge['ch_maple_q3_96'].totalCents).toBe(10261);
    expect(seed.payments.find((p) => p.id === 'pay_chk_maple')?.method).toBe('check');
    expect(openBalance('inv_maple_q3')).toBe(8745);
    const mapleOpen = seed.invoices.filter((i) => i.accountId === 'acct_res_maple').reduce((s, i) => s + openBalance(i.id), 0);
    expect(mapleOpen).toBe(8745);
  });
  it('Oakridge: check equals the sum of the three invoices and is unallocated', () => {
    const three = ['inv_oak_0601', 'inv_oak_0701', 'inv_oak_0801'].map((id) => invoice[id]);
    const sum = three.reduce((s, i) => s + i.totalCents, 0);
    const chk = seed.payments.find((p) => p.id === 'pay_chk_oakridge')!;
    expect(chk.cents).toBe(sum);
    expect(chk.status).toBe('settled');
    expect(chk.receivedAt).toBe('2026-09-08');
    expect(seed.paymentAllocations.filter((a) => a.sourceId === 'pay_chk_oakridge')).toHaveLength(0);
    for (const inv of three) expect(inv.chargeIds).toHaveLength(4);
  });
  it('batch_0908: 14 settled card payments summing to 131842, gross minus fees equals net', () => {
    const batch = seed.processorBatches.find((b) => b.id === 'batch_0908')!;
    expect(batch.paymentIds).toHaveLength(14);
    const rows = batch.paymentIds.map((id) => seed.payments.find((p) => p.id === id)!);
    for (const p of rows) {
      expect(p.method).toBe('card');
      expect(p.status).toBe('settled');
      expect(p.processorBatchId).toBe('batch_0908');
      expect(p.accountId).toMatch(/^acct_res_\d{3}$/);
    }
    expect(rows.reduce((s, p) => s + p.cents, 0)).toBe(131842);
    expect(batch.grossCents).toBe(131842);
    expect(batch.feeCents).toBe(4120);
    expect(batch.netCents).toBe(127722);
    expect(batch.grossCents - batch.feeCents).toBe(batch.netCents);
    expect(seed.payments.filter((p) => p.processorBatchId === 'batch_0908')).toHaveLength(14);
  });
  it('Bakery: posted August and September invoices at contract prices', () => {
    for (const id of ['inv_bakery_0801', 'inv_bakery_0901']) {
      const inv = invoice[id];
      const lines = inv.chargeIds.map((c) => charge[c]);
      expect(lines.map((l) => l.baseCents).sort()).toEqual([17100, 19800]);
      for (const l of lines) {
        expect(l.pricing.ruleWon).toBe('contractOverride');
        expect(l.pricing.contractId).toBe('contract_bakery');
      }
    }
  });
  it('Hale: two over-cap tickets in the last 14 days on dumpAndReturn work orders', () => {
    for (const [id, net] of [['tk_hale_1', 8400], ['tk_hale_2', 7100]] as const) {
      const t = seed.scaleTickets.find((x) => x.id === id)!;
      expect(t.netLbs).toBe(net);
      expect(t.netLbs / 2000).toBeGreaterThan(3);
      const wo = seed.workOrders.find((w) => w.id === t.workOrderId)!;
      expect(wo.kind).toBe('dumpAndReturn');
      expect(wo.containerId).toBe(t.containerId);
      const days = (Date.parse(TODAY) - Date.parse(t.ticketedAt.slice(0, 10))) / 86_400_000;
      expect(days).toBeGreaterThanOrEqual(0);
      expect(days).toBeLessThanOrEqual(14);
    }
  });
  it('Kerr: suspended with skippedSuspended stops and a real past due invoice', () => {
    expect(seed.billingAccounts.find((a) => a.id === 'acct_res_kerr')?.status).toBe('suspended');
    const evs = seed.serviceEvents.filter((e) => e.siteId === 'site_kerr');
    expect(evs.map((e) => e.date).sort()).toEqual(['2026-09-01', '2026-09-08']);
    for (const e of evs) expect(e.outcome).toBe('skippedSuspended');
    const kerrInv = seed.invoices.filter((i) => i.accountId === 'acct_res_kerr');
    expect(kerrInv).toHaveLength(1);
    expect(kerrInv[0].issuedAt).toBe('2026-06-20');
    expect(kerrInv[0].dueAt < TODAY).toBe(true);
    expect(openBalance(kerrInv[0].id)).toBe(kerrInv[0].totalCents);
  });
  it('roll-off homeowner: deliver work order completed 34 days before TODAY', () => {
    const wo = seed.workOrders.find((w) => w.id === 'wo_ro_home_deliver')!;
    expect(wo.status).toBe('done');
    expect((Date.parse(TODAY) - Date.parse(wo.completedAt!)) / 86_400_000).toBe(34);
  });
  it('field exceptions from the contract are present with photos in the last 14 days', () => {
    for (const [id, exception] of [
      ['ev_maple_extrabags', 'extraBags'], ['ev_res_014_overload', 'overload'], ['ev_fl_003_dryrun', 'dryRun'],
      ['ev_hale_dryrun', 'dryRun'], ['ev_bakery_contamination', 'contamination'],
    ] as const) {
      const e = seed.serviceEvents.find((x) => x.id === id)!;
      expect(e.exception).toBe(exception);
      expect(e.photoUrl).toBeTruthy();
      expect(e.note).toBeTruthy();
      expect(e.driver).toBeTruthy();
      const days = (Date.parse(TODAY) - Date.parse(e.date)) / 86_400_000;
      expect(days).toBeGreaterThanOrEqual(0);
      expect(days).toBeLessThanOrEqual(14);
    }
  });
  it('generic volume: 30 residential and 8 frontload accounts as specified', () => {
    const res = seed.billingAccounts.filter((a) => /^acct_res_\d{3}$/.test(a.id));
    const fl = seed.billingAccounts.filter((a) => /^acct_fl_\d{3}$/.test(a.id));
    expect(res).toHaveLength(30);
    expect(fl).toHaveLength(8);
    expect(res.filter((a) => a.status === 'pastDue')).toHaveLength(2);
    expect(res.filter((a) => a.autopay).length).toBeGreaterThan(0);
    expect(fl.filter((a) => a.contractId)).toHaveLength(4);
    for (const a of res) {
      const s = seed.sites.find((x) => x.accountId === a.id)!;
      const n = Number(a.id.slice(-3));
      expect(s.routeId).toBe(n <= 15 ? 'route_mon_res' : 'route_tue_res');
    }
  });
});

describe('seed: routes', () => {
  it("every route's stopSiteIds contains every site assigned to it, and nothing else", () => {
    for (const r of seed.routes) {
      const assigned = seed.sites.filter((s) => s.routeId === r.id).map((s) => s.id);
      const stops = new Set(r.stopSiteIds);
      for (const s of assigned) expect(stops.has(s), `${r.id} missing ${s}`).toBe(true);
      for (const s of r.stopSiteIds) expect(site[s]?.routeId, `${r.id} stop ${s} not assigned`).toBe(r.id);
      expect(r.stopSiteIds.length).toBeLessThanOrEqual(r.capacityStops);
    }
  });
  it('service events sit on the route their site is assigned to, on that route day', () => {
    const dayOf = (iso: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(iso + 'T00:00:00Z').getUTCDay()];
    for (const e of seed.serviceEvents) {
      expect(site[e.siteId].routeId, `${e.id} route`).toBe(e.routeId);
      const route = seed.routes.find((r) => r.id === e.routeId)!;
      expect(dayOf(e.date), `${e.id} day`).toBe(route.day);
    }
  });
});

describe('seed: shared contract addendum', () => {
  const addDaysIso = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

  it('B1: every contract escalator anniversary is a full ISO date (YYYY-MM-DD), 2027-01-01 for the seeded contracts', () => {
    const withEscalator = seed.contracts.filter((c) => c.escalator);
    expect(withEscalator.map((c) => c.id).sort()).toEqual(['contract_bakery', 'contract_fl_001', 'contract_fl_002', 'contract_fl_003', 'contract_fl_004']);
    for (const c of withEscalator) {
      expect(c.escalator!.anniversary, c.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.escalator!.anniversary, c.id).toBe('2027-01-01');
    }
  });

  it('B4: eventRates.json carries the billing rates', () => {
    expect(seed.eventRates).toEqual({ extraBags: 250, overload: 1000, contamination: 2000, dryRun: 2500 });
  });

  it('C8: exactly three 7% tax rules, one per taxed zone, applying to recurring, event, and fee; none for zone_notserved', () => {
    expect(seed.taxRules).toHaveLength(3);
    const byZone = Object.fromEntries(seed.taxRules.map((t) => [t.zoneId, t]));
    expect(Object.keys(byZone).sort()).toEqual(['zone_boundary', 'zone_franchise', 'zone_open']);
    expect(byZone.zone_open.id).toBe('tax_open');
    expect(byZone.zone_boundary.id).toBe('tax_boundary');
    expect(byZone.zone_franchise.id).toBe('tax_franchise');
    for (const t of seed.taxRules) {
      expect(t.ratePct).toBe(7);
      expect([...t.appliesTo].sort()).toEqual(['event', 'fee', 'recurring']);
      expect(t.appliesTo).not.toContain('lateFee');
    }
  });

  it('C9: invoice dueAt is issuedAt + 30 days for net30 and + 15 for every other cycle; Maple and all three Oakridge invoices stay past due', () => {
    const account = byId(seed.billingAccounts);
    for (const inv of seed.invoices) {
      const cycle = account[inv.accountId].cycle;
      expect(inv.dueAt, `${inv.id} (${cycle})`).toBe(addDaysIso(inv.issuedAt, cycle === 'net30' ? 30 : 15));
    }
    expect(openBalance('inv_maple_q3')).toBe(8745);
    expect(invoice['inv_maple_q3'].dueAt < TODAY).toBe(true);
    for (const id of ['inv_oak_0601', 'inv_oak_0701', 'inv_oak_0801']) {
      expect(invoice[id].dueAt < TODAY, `${id} past due`).toBe(true);
      expect(openBalance(id)).toBe(invoice[id].totalCents);
    }
  });

  it('D4: zone_franchise.franchiseFeePct is 17', () => {
    expect(seed.zones.find((z) => z.id === 'zone_franchise')?.franchiseFeePct).toBe(17);
  });
});

describe('seed: file names (addendum D3)', () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const jsonFiles = readdirSync(dir).filter((f) => f.endsWith('.json'));

  it('every seed file is camelCase, with no kebab-case name left', () => {
    expect(jsonFiles.length).toBe(26);
    for (const f of jsonFiles) expect(f, f).toMatch(/^[a-z][a-zA-Z]*\.json$/);
  });

  it('index.ts imports exactly the JSON files on disk', () => {
    const imported = [...readFileSync(join(dir, 'index.ts'), 'utf8').matchAll(/from '\.\/([^']+\.json)'/g)].map((m) => m[1]);
    expect([...imported].sort()).toEqual([...jsonFiles].sort());
  });
});
