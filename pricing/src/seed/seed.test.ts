import { describe, expect, it } from 'vitest';
import { seed } from './index';

const ids = <T extends { id: string }>(rows: T[]) => new Set(rows.map((r) => r.id));

describe('seed integrity', () => {
  const accountIds = ids(seed.accounts);
  const siteIds = ids(seed.sites);
  const catalogIds = ids(seed.catalog);
  const zoneIds = ids(seed.zones);
  const routeIds = ids(seed.routes);
  const partyIds = ids(seed.parties);
  const contractIds = ids(seed.contracts);
  const chargeIds = ids(seed.charges);
  const invoiceIds = ids(seed.invoices);
  const rateVersionIds = ids(seed.rateVersions);
  const containerIds = ids(seed.containers);

  it('has unique ids in every table', () => {
    for (const [name, rows] of Object.entries(seed)) {
      if (name === 'allocations') continue;
      const list = rows as { id: string }[];
      expect(new Set(list.map((r) => r.id)).size, name).toBe(list.length);
    }
  });

  it('references resolve', () => {
    for (const a of seed.accounts) {
      expect(partyIds.has(a.payerPartyId), a.id).toBe(true);
      if (a.contractId) expect(contractIds.has(a.contractId), a.id).toBe(true);
    }
    for (const s of seed.sites) {
      expect(accountIds.has(s.accountId), s.id).toBe(true);
      expect(zoneIds.has(s.zoneId), s.id).toBe(true);
      if (s.routeId) expect(routeIds.has(s.routeId), s.id).toBe(true);
    }
    for (const r of seed.routes) for (const sid of r.stopSiteIds) expect(siteIds.has(sid), r.id).toBe(true);
    for (const si of seed.serviceItems) {
      expect(siteIds.has(si.siteId), si.id).toBe(true);
      expect(catalogIds.has(si.catalogId), si.id).toBe(true);
      for (const c of si.containerIds) expect(containerIds.has(c), si.id).toBe(true);
    }
    for (const rv of seed.rateVersions) {
      expect(catalogIds.has(rv.catalogId), rv.id).toBe(true);
      if (rv.zoneId) expect(zoneIds.has(rv.zoneId), rv.id).toBe(true);
      if (rv.supersedesId) expect(rateVersionIds.has(rv.supersedesId), rv.id).toBe(true);
    }
    for (const c of seed.contracts) {
      expect(accountIds.has(c.accountId), c.id).toBe(true);
      for (const o of c.overrides) expect(catalogIds.has(o.catalogId), c.id).toBe(true);
    }
    for (const ch of seed.charges) {
      expect(accountIds.has(ch.accountId), ch.id).toBe(true);
      expect(siteIds.has(ch.siteId), ch.id).toBe(true);
      if (ch.pricing.rateVersionId) expect(rateVersionIds.has(ch.pricing.rateVersionId), ch.id).toBe(true);
      if (ch.pricing.contractId) expect(contractIds.has(ch.pricing.contractId), ch.id).toBe(true);
      const feeSum = ch.fees.reduce((a, f) => a + f.cents, 0);
      expect(ch.totalCents, ch.id).toBe(ch.baseCents + feeSum + ch.taxCents);
    }
    for (const inv of seed.invoices) {
      for (const cid of inv.chargeIds) expect(chargeIds.has(cid), inv.id).toBe(true);
      expect(inv.totalCents, inv.id).toBe(inv.subtotalCents + inv.feeCents + inv.taxCents);
      const cs = seed.charges.filter((c) => inv.chargeIds.includes(c.id));
      expect(cs.reduce((a, c) => a + c.totalCents, 0), inv.id).toBe(inv.totalCents);
    }
    for (const al of seed.allocations) expect(invoiceIds.has(al.invoiceId)).toBe(true);
    for (const ev of seed.serviceEvents) {
      expect(siteIds.has(ev.siteId), ev.id).toBe(true);
      expect(routeIds.has(ev.routeId), ev.id).toBe(true);
    }
    for (const st of seed.scaleTickets) expect(containerIds.has(st.containerId), st.id).toBe(true);
  });

  it('matches the contract headline values', () => {
    expect(seed.haulers[0].id).toBe('hauler_piedmont');
    expect(seed.catalog).toHaveLength(8);
    expect(seed.rateVersions).toHaveLength(15);
    expect(seed.accounts).toHaveLength(45);
    const maple = seed.invoices.find((i) => i.id === 'inv_res_maple_0001')!;
    expect(maple.totalCents).toBe(8745);
    expect(maple.locked).toBe(true);
    const batch = seed.processorBatches.find((b) => b.id === 'batch_0908')!;
    expect(batch.paymentIds).toHaveLength(14);
    const batchSum = seed.payments.filter((p) => p.processorBatchId === 'batch_0908').reduce((a, p) => a + p.cents, 0);
    expect(batchSum).toBe(131842);
    expect(batch.netCents).toBe(batch.grossCents - batch.feeCents);
    const oak = seed.allocations.filter((a) => a.sourceId === 'pay_chk_oakridge');
    expect(oak).toHaveLength(3);
    expect(seed.payments.find((p) => p.id === 'pay_chk_oakridge')!.cents).toBe(oak.reduce((a, x) => a + x.cents, 0));
    expect(seed.serviceEvents.some((e) => e.siteId === 'site_res_kerr' && e.outcome === 'skippedSuspended')).toBe(true);
    expect(seed.serviceEvents.filter((e) => e.exception === 'dryRun')).toHaveLength(2);
    expect(seed.serviceEvents.find((e) => e.exception === 'contamination')?.note).toBe('wood container');
    expect(seed.serviceItems.find((s) => s.id === 'si_ro_homeowner')?.effectiveFrom).toBe('2026-08-07');
    const kerr = seed.accounts.find((a) => a.id === 'acct_res_kerr')!;
    expect(kerr.status).toBe('suspended');
  });
});
