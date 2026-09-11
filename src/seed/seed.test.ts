import { describe, expect, it } from 'vitest'
import { loadSeed, seed } from './index'

const db = loadSeed()
const ids = <T extends { id: string }>(rows: T[]) => new Set(rows.map(r => r.id))
const accountIds = ids(db.accounts)
const partyIds = ids(db.parties)
const siteIds = ids(db.sites)
const catalogIds = ids(db.catalog)
const paymentIds = ids(db.payments)
const invoiceIds = ids(db.invoices)
const containerIds = ids(db.containers)
const zoneIds = ids(db.zones)
const routeIds = ids(db.routes)
const serviceItemIds = ids(db.serviceItems)
const workOrderIds = ids(db.workOrders)
const serviceEventIds = ids(db.serviceEvents)
const scaleTicketIds = ids(db.scaleTickets)
const contractIds = ids(db.contracts)

describe('seed referential integrity', () => {
  it('loadSeed returns a deep clone', () => {
    const a = loadSeed()
    a.accounts[0].status = 'suspended'
    expect(seed.accounts[0].status).not.toBe('suspended')
    expect(loadSeed().accounts[0].status).toBe(seed.accounts[0].status)
  })

  it('every account resolves to a party, and contracts when set', () => {
    for (const a of db.accounts) {
      expect(partyIds.has(a.payerPartyId), `${a.id} payer`).toBe(true)
      if (a.contractId) expect(contractIds.has(a.contractId), `${a.id} contract`).toBe(true)
    }
    for (const c of db.contracts) expect(accountIds.has(c.accountId), `${c.id} account`).toBe(true)
  })

  it('every site resolves to an account, zone, and route', () => {
    for (const s of db.sites) {
      expect(accountIds.has(s.accountId), `${s.id} account`).toBe(true)
      expect(zoneIds.has(s.zoneId), `${s.id} zone`).toBe(true)
      if (s.routeId) expect(routeIds.has(s.routeId), `${s.id} route`).toBe(true)
      if (s.occupantPartyId) expect(partyIds.has(s.occupantPartyId), `${s.id} occupant`).toBe(true)
    }
    for (const r of db.routes) for (const sid of r.stopSiteIds) expect(siteIds.has(sid), `${r.id} stop ${sid}`).toBe(true)
  })

  it('every service item resolves to a site, catalog entry, and containers', () => {
    for (const si of db.serviceItems) {
      expect(siteIds.has(si.siteId), `${si.id} site`).toBe(true)
      expect(catalogIds.has(si.catalogId), `${si.id} catalog`).toBe(true)
      for (const cid of si.containerIds) expect(containerIds.has(cid), `${si.id} container ${cid}`).toBe(true)
    }
    for (const c of db.containers) {
      expect(catalogIds.has(c.catalogId), `${c.id} catalog`).toBe(true)
      if (c.siteId) expect(siteIds.has(c.siteId), `${c.id} site`).toBe(true)
    }
  })

  it('rate versions, tax rules, and contract overrides reference real catalog and zones', () => {
    for (const rv of db.rateVersions) {
      expect(catalogIds.has(rv.catalogId), rv.id).toBe(true)
      if (rv.zoneId) expect(zoneIds.has(rv.zoneId), rv.id).toBe(true)
      if (rv.supersedesId) expect(ids(db.rateVersions).has(rv.supersedesId), rv.id).toBe(true)
    }
    for (const t of db.taxRules) expect(zoneIds.has(t.zoneId), t.id).toBe(true)
    for (const c of db.contracts) for (const o of c.overrides) expect(catalogIds.has(o.catalogId), c.id).toBe(true)
  })

  it('every charge resolves to an account, site, catalog, and source', () => {
    for (const c of db.charges) {
      expect(accountIds.has(c.accountId), `${c.id} account`).toBe(true)
      expect(siteIds.has(c.siteId), `${c.id} site`).toBe(true)
      if (c.catalogId) expect(catalogIds.has(c.catalogId), `${c.id} catalog`).toBe(true)
      const pool = c.source.type === 'serviceItem' ? serviceItemIds : c.source.type === 'serviceEvent' ? serviceEventIds : c.source.type === 'scaleTicket' ? scaleTicketIds : new Set([...serviceItemIds, ...workOrderIds])
      expect(pool.has(c.source.id), `${c.id} source ${c.source.type} ${c.source.id}`).toBe(true)
    }
  })

  it('every historical charge carries base, fees, tax, total, source, and ruleWon (invariant 2)', () => {
    for (const c of db.charges) {
      expect(typeof c.baseCents).toBe('number')
      expect(Array.isArray(c.fees)).toBe(true)
      expect(typeof c.taxCents).toBe('number')
      expect(c.totalCents).toBe(c.baseCents + c.fees.reduce((s, f) => s + f.cents, 0) + c.taxCents)
      expect(c.source.id.length).toBeGreaterThan(0)
      expect(c.pricing.ruleWon).toBeTruthy()
    }
  })

  it('invoices reference posted charges on the same account, totals add up, numbers unique', () => {
    const numbers = new Set<string>()
    for (const inv of db.invoices) {
      expect(accountIds.has(inv.accountId), inv.id).toBe(true)
      expect(inv.locked).toBe(true)
      const lines = inv.chargeIds.map(id => db.charges.find(c => c.id === id)!)
      for (const l of lines) {
        expect(l, `${inv.id} charge`).toBeDefined()
        expect(l.status).toBe('posted')
        expect(l.accountId).toBe(inv.accountId)
      }
      expect(inv.subtotalCents).toBe(lines.reduce((s, c) => s + c.baseCents, 0))
      expect(inv.feeCents).toBe(lines.reduce((s, c) => s + c.fees.reduce((f, x) => f + x.cents, 0), 0))
      expect(inv.taxCents).toBe(lines.reduce((s, c) => s + c.taxCents, 0))
      expect(inv.totalCents).toBe(inv.subtotalCents + inv.feeCents + inv.taxCents)
      expect(numbers.has(inv.number), `duplicate ${inv.number}`).toBe(false)
      numbers.add(inv.number)
    }
    const posted = db.charges.filter(c => c.status === 'posted')
    for (const c of posted) expect(db.invoices.some(i => i.chargeIds.includes(c.id)), `${c.id} posted but on no invoice`).toBe(true)
  })

  it('waived charges point at charges with status waived and are on no invoice (invariant 5)', () => {
    expect(db.waivedCharges.length).toBe(6)
    for (const w of db.waivedCharges) {
      const c = db.charges.find(x => x.id === w.chargeId)
      expect(c, w.chargeId).toBeDefined()
      expect(c!.status).toBe('waived')
      expect(db.invoices.some(i => i.chargeIds.includes(w.chargeId))).toBe(false)
    }
    const reasons = new Set(db.waivedCharges.map(w => w.reason))
    for (const r of ['goodwill', 'insufficientEvidence', 'operationalFault', 'immaterial']) expect(reasons.has(r as never), r).toBe(true)
    const routes = new Set(db.waivedCharges.map(w => db.sites.find(s => s.id === db.charges.find(c => c.id === w.chargeId)!.siteId)!.routeId))
    expect(routes.size).toBeGreaterThanOrEqual(2)
    expect(new Set(db.waivedCharges.map(w => db.charges.find(c => c.id === w.chargeId)!.accountId)).size).toBeGreaterThanOrEqual(3)
  })

  it('allocations resolve to payments and invoices and never exceed either side', () => {
    for (const a of db.allocations) {
      expect(a.sourceType).toBe('payment')
      expect(paymentIds.has(a.sourceId), a.sourceId).toBe(true)
      expect(invoiceIds.has(a.invoiceId), a.invoiceId).toBe(true)
    }
    for (const p of db.payments) {
      expect(accountIds.has(p.accountId), p.id).toBe(true)
      const applied = db.allocations.filter(a => a.sourceId === p.id).reduce((s, a) => s + a.cents, 0)
      expect(applied, `${p.id} over-applied`).toBeLessThanOrEqual(p.cents)
    }
    for (const inv of db.invoices) {
      const applied = db.allocations.filter(a => a.invoiceId === inv.id).reduce((s, a) => s + a.cents, 0)
      expect(applied, `${inv.id} over-paid`).toBeLessThanOrEqual(inv.totalCents)
    }
  })

  it('batch_0908 payments sum to gross, net equals gross minus fees, 14 distinct invoices, 1530 unapplied (invariant 6)', () => {
    const batch = db.processorBatches.find(b => b.id === 'batch_0908')!
    expect(batch.paymentIds.length).toBe(14)
    const batchPayments = batch.paymentIds.map(id => db.payments.find(p => p.id === id)!)
    for (const p of batchPayments) {
      expect(p.processorBatchId).toBe('batch_0908')
      expect(p.method).toBe('card')
    }
    expect(batchPayments.reduce((s, p) => s + p.cents, 0)).toBe(batch.grossCents)
    expect(batch.grossCents).toBe(131842)
    expect(batch.feeCents).toBe(4120)
    expect(batch.netCents).toBe(batch.grossCents - batch.feeCents)
    const allocs = db.allocations.filter(a => batch.paymentIds.includes(a.sourceId))
    expect(allocs.length).toBe(14)
    expect(new Set(allocs.map(a => a.invoiceId)).size).toBe(14)
    const applied = allocs.reduce((s, a) => s + a.cents, 0)
    expect(batch.grossCents - applied).toBe(1530)
    const p14 = db.payments.find(p => p.id === 'pay_card_014')!
    expect(p14.cents - db.allocations.filter(a => a.sourceId === 'pay_card_014').reduce((s, a) => s + a.cents, 0)).toBe(1530)
  })

  it('Oakridge check covers three invoices in full and Maple owes exactly 8745', () => {
    const chk = db.payments.find(p => p.id === 'pay_chk_oakridge')!
    const allocs = db.allocations.filter(a => a.sourceId === 'pay_chk_oakridge')
    expect(allocs.map(a => a.invoiceId).sort()).toEqual(['inv_oak_2026_06', 'inv_oak_2026_07', 'inv_oak_2026_08'])
    expect(allocs.reduce((s, a) => s + a.cents, 0)).toBe(chk.cents)
    for (const a of allocs) expect(a.cents).toBe(db.invoices.find(i => i.id === a.invoiceId)!.totalCents)
    const maple = db.invoices.find(i => i.id === 'inv_maple_2026q3')!
    const paid = db.allocations.filter(a => a.invoiceId === maple.id).reduce((s, a) => s + a.cents, 0)
    expect(maple.totalCents - paid).toBe(8745)
    const unknown = db.payments.find(p => p.id === 'pay_chk_unknown')!
    expect(unknown.cents).toBe(6500)
    expect(db.allocations.some(a => a.sourceId === unknown.id)).toBe(false)
    expect(db.invoices.some(i => i.id === 'inv_res_017' && i.accountId === 'acct_res_017')).toBe(true)
  })

  it('work orders, events, and tickets resolve', () => {
    for (const wo of db.workOrders) {
      expect(siteIds.has(wo.siteId), wo.id).toBe(true)
      if (wo.serviceItemId) expect(serviceItemIds.has(wo.serviceItemId), wo.id).toBe(true)
      if (wo.containerId) expect(containerIds.has(wo.containerId), wo.id).toBe(true)
    }
    for (const e of db.serviceEvents) {
      expect(siteIds.has(e.siteId), e.id).toBe(true)
      expect(routeIds.has(e.routeId), e.id).toBe(true)
      expect(e.driver.length).toBeGreaterThan(0)
    }
    for (const t of db.scaleTickets) {
      expect(workOrderIds.has(t.workOrderId), t.id).toBe(true)
      expect(containerIds.has(t.containerId), t.id).toBe(true)
      expect(t.netLbs).toBe(t.grossLbs - t.tareLbs)
    }
    for (const r of db.requests) {
      expect(accountIds.has(r.accountId), r.id).toBe(true)
      expect(siteIds.has(r.siteId), r.id).toBe(true)
      if (r.workOrderId) expect(workOrderIds.has(r.workOrderId), r.id).toBe(true)
    }
  })

  it('named scenario rows are present with the contract ids', () => {
    for (const id of ['acct_res_maple', 'acct_res_holt', 'acct_res_kerr', 'acct_bakery', 'acct_pm_oakridge', 'acct_contractor_hale', 'acct_ro_homeowner', 'acct_res_001', 'acct_res_030', 'acct_fl_001', 'acct_fl_008']) expect(accountIds.has(id), id).toBe(true)
    for (const id of ['evt_maple_extrabags', 'evt_res014_overload', 'evt_fl003_dryrun', 'evt_hale_dryrun', 'evt_bakery_contam']) expect(serviceEventIds.has(id), id).toBe(true)
    for (const id of ['ticket_hale_1', 'ticket_hale_2', 'ticket_hale_3']) expect(scaleTicketIds.has(id), id).toBe(true)
    expect(workOrderIds.has('wo_res_007_deliver')).toBe(true)
    expect(db.serviceItems.find(s => s.id === 'si_res_007_extra')!.effectiveFrom).toBe('2026-09-15')
    expect(db.accounts.find(a => a.id === 'acct_res_kerr')!.status).toBe('suspended')
    expect(db.serviceItems.find(s => s.id === 'si_kerr_96')!.status).toBe('active')
    expect(db.serviceEvents.filter(e => e.siteId === 'site_kerr').every(e => e.outcome === 'skippedSuspended')).toBe(true)
    expect(db.quotes.find(q => q.id === 'quote_held_ridge')!.holdReason).toBe('confirm private road access')
  })

  it('no em dashes anywhere in seed strings', () => {
    expect(JSON.stringify(seed)).not.toMatch(/\u2014/)
  })
})
