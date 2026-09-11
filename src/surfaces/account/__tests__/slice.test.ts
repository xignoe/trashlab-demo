/**
 * The account slice's actions on the one merged store (box 2A.2 and 2A.5). Moved from the "store actions", "Phase 4",
 * "Phase 5", and "Phase 6" blocks of account/src/store/engine.test.ts, rewritten for mutateDb and billing's seed.
 * Each RUNBOOK scenario (A to E) has its merged figures asserted here; PORT_DECISIONS.md lists them next to the
 * prototype's.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setToday } from '../../../store/clock'
import { generateEventCharges, generateRecurringCharges } from '../../../store/engine'
import { useStore } from '../../../store/useStore'
import { sliceRegistry } from '../../../store/slices'
import { initialAccountData } from '../../../store/slices/account'
import { previewNextRun } from '../lib/engine'
import {
  autoAllocateOldestFirst, buildAccountView, buildHoldPreview, buildRouteStub, buildServiceChangePreview, openInvoicesOldestFirst,
  type AccountSidecars,
} from '../selectors'

const st = () => useStore.getState()
const sidecars = (): AccountSidecars => ({
  ledgerWrites: st().accountEdits.ledgerWrites,
  statusChanges: st().accountEdits.statusChanges,
})
const view = (id: string) => buildAccountView(id, st().db, sidecars())!
const byIdIn = <T extends { id: string }>(rows: T[], id: string) => rows.find(r => r.id === id)

beforeEach(() => st().reset())
afterEach(() => setToday())

const maple96to64 = { siteId: 'site_maple', replaceItemId: 'si_maple_96', catalogId: 'cat_res_64', qty: 1, frequency: 'weekly' as const, effectiveFrom: '2026-09-14', createdVia: 'phone' as const }

describe('slice shape', () => {
  it('holds accountEdits and the office actions; the retired sidecars are gone (box 3.6); never billing\'s `edits` key, never a core key', () => {
    const keys = Object.keys(sliceRegistry.account(useStore.setState, useStore.getState, useStore))
    expect(keys).toEqual(expect.arrayContaining(['accountEdits', 'changeServiceItem', 'takePayment', 'allocatePayment', 'changeAccountStatus', 'reinstateAccount', 'linkAccountToContract']))
    expect(keys).not.toContain('officeNotes')
    expect(keys).not.toContain('proposedCharges')
    expect(keys).not.toContain('edits')
    for (const k of ['db', 'mutateDb', 'reset']) expect(keys).not.toContain(k)
    expect(st().edits).toEqual([])
    expect(st().accountEdits).toEqual({ ledgerWrites: [], statusChanges: [] })
  })

  it('no action anywhere in the account slice deletes, removes, drops, or clears (invariant 5)', () => {
    const actions = Object.entries(sliceRegistry.account(useStore.setState, useStore.getState, useStore)).filter(([, v]) => typeof v === 'function').map(([k]) => k)
    expect(actions.length).toBeGreaterThan(5)
    // Two exceptions, both asked for by Kevin. deleteBillingGroup (addendum Q) removes a grouping row after moving its
    // members. deleteAccount removes an account that carries no charge, invoice, payment, credit memo, service event,
    // scale ticket, or contract (a typo or duplicate); any account with history is closed instead, never deleted.
    // Neither removes a financial record, so invariant 5 is untouched.
    const allowed = ['deleteBillingGroup', 'deleteAccount']
    for (const name of actions.filter(n => !allowed.includes(n))) expect(name).not.toMatch(/delete|remove|drop|clear/i)
  })

  it('reset empties every sidecar and restores the seed', () => {
    st().changeServiceItem(maple96to64)
    st().issueCreditMemo({ accountId: 'acct_res_maple', cents: 500, reason: 'goodwill' })
    st().reset()
    expect({ accountEdits: st().accountEdits }).toEqual(initialAccountData())
    expect(st().db.serviceItems.find(s => s.id === 'si_maple_96')?.status).toBe('active')
  })
})

describe('Scenario A: Maple changes the 96 gal cart to a 64 gal cart (invariant 3)', () => {
  it('the preview plans the ids confirm writes, and confirm commits the plan and its scheduled Request in one update', () => {
    const preview = buildServiceChangePreview(maple96to64, st().db)!
    expect(preview.plan?.workOrder.id).toBe('wo_ac_0004')
    let updates = 0
    const unsub = useStore.subscribe(() => { updates++ })
    const requestsBefore = st().db.requests
    const plan = st().changeServiceItem(maple96to64)
    unsub()
    expect(updates).toBe(1)
    expect(plan.workOrder.id).toBe(preview.plan?.workOrder.id)
    const db = st().db
    expect(db.serviceItems.find(s => s.id === 'si_maple_96')).toMatchObject({ status: 'ended', effectiveTo: '2026-09-14' })
    expect(db.serviceItems.find(s => s.id === 'si_ac_0097')).toMatchObject({ catalogId: 'cat_res_64', status: 'active' })
    expect(db.workOrders.find(w => w.id === 'wo_ac_0004')).toMatchObject({ kind: 'swap', status: 'open', siteId: 'site_maple', containerId: 'cont_ac_0001' })
    expect(db.containers.find(c => c.id === 'cont_ac_0001')?.serial).toBe('C64-9001')
    // Box 3.6: the phone request is a scheduled Request row the portal shows, and the work order answers it.
    expect(db.requests).toHaveLength(requestsBefore.length + 1)
    const req = db.requests.at(-1)!
    expect(req).toMatchObject({ kind: 'cartChange', status: 'scheduled', createdVia: 'phone', accountId: 'acct_res_maple', siteId: 'site_maple', workOrderId: 'wo_ac_0004', note: 'Change 96 gal cart to 64 gal cart, effective 2026-09-14' })
    expect(req.id).toMatch(/^req_ac_\d{4}$/)
    expect(db.workOrders.find(w => w.id === 'wo_ac_0004')?.requestId).toBe(req.id)
    expect(plan.request).toEqual(req)
  })

  it('merged figures: next run 18361 to 17674 (-687); the 64 gal line prices at rv_res_64_2026q4 on Oct 1; the Q3 invoice is untouched', () => {
    const preview = buildServiceChangePreview(maple96to64, st().db)!
    expect(preview.oldLine?.lineCents).toBe(2900)
    expect(preview.newLine?.lineCents).toBe(2600)
    expect(preview.newLine?.price?.rateVersionId).toBe('rv_res_64_2026')
    expect(preview.currentCycle).toMatchObject({ period: { start: '2026-07-01', end: '2026-09-30' }, midCycle: true })
    expect(preview.currentCycle?.invoice?.number).toBe('INV-2026-0203')
    expect(preview.firstBilledOn).toBe('2026-10-01')
    expect([preview.before.totalCents, preview.after?.totalCents, preview.deltaCents, preview.baseDeltaCents]).toEqual([18361, 17674, -687, -600])

    st().changeServiceItem(maple96to64)
    const v = view('acct_res_maple')
    expect(v.nextInvoice.estimateCents).toBe(17674)
    const line64 = v.nextInvoice.preview.recurring.find(c => c.catalogId === 'cat_res_64')!
    expect([line64.baseCents, line64.taxCents, line64.totalCents, line64.pricing.rateVersionId]).toEqual([8100, 607, 9574, 'rv_res_64_2026q4'])
    expect(v.nextInvoice.preview.recurring.some(c => c.catalogId === 'cat_res_96')).toBe(false)
    const q3 = st().db.invoices.find(i => i.id === 'inv_maple_2026q3')!
    expect(q3.totalCents).toBe(18074)
    expect(v.pastDue).toBe(8745)
    expect(v.sync.dispatch).toMatchObject({ state: 'stale', reason: 'Work order wo_ac_0004 for 2026-09-14 is open and not yet scheduled on a route' })
  })

  it('marking the work order scheduled flips the dispatch chip back and never removes the work order', () => {
    st().changeServiceItem(maple96to64)
    const count = st().db.workOrders.length
    st().setWorkOrderStatus('wo_ac_0004', 'scheduled')
    expect(st().db.workOrders).toHaveLength(count)
    expect(view('acct_res_maple').sync.dispatch.state).toBe('inSync')
    st().setWorkOrderStatus('wo_ac_0004', 'done')
    expect(st().db.workOrders.find(w => w.id === 'wo_ac_0004')).toMatchObject({ status: 'done', completedAt: '2026-09-10' })
  })
})

describe('Scenario B: one payment across several invoices (invariant 6)', () => {
  it('Oakridge: the seed already split pay_chk_oakridge across its three invoices; the view shows it and nothing is open', () => {
    const v = view('acct_pm_oakridge')
    expect(v.balance).toBe(0)
    expect(v.pastDue).toBe(0)
    expect(v.openInvoices).toEqual([])
    const check = v.payments.find(p => p.payment.id === 'pay_chk_oakridge')!
    expect(check.allocations.map(a => [a.invoice?.number, a.cents])).toEqual([['INV-2026-0201', 64600], ['INV-2026-0202', 64600], ['INV-2026-0210', 64600]])
    expect(check.unappliedCents).toBe(0)
  })

  it('a new check on Oakridge cannot be applied to a paid invoice: the engine refuses and nothing is written', () => {
    const db = st().db
    expect(() => st().takePayment({ accountId: 'acct_pm_oakridge', method: 'cash', cents: 1000, allocations: { invoiceIds: ['inv_oak_2026_06'], cents: [1000] } }))
      .toThrow(/open balance is 0 cents/)
    expect(st().db).toBe(db)
    expect(st().accountEdits.ledgerWrites).toEqual([])
  })

  it('take a $68.40 check on acct_res_003 and auto-allocate it oldest first across two invoices', () => {
    const open = openInvoicesOldestFirst('acct_res_003', st().db)
    expect(open.map(v => [v.invoice.number, v.openCents])).toEqual([['INV-2026-0211', 3420], ['INV-2026-0213', 3420]])
    const fill = autoAllocateOldestFirst(open, 6840)
    const pay = st().takePayment({ accountId: 'acct_res_003', method: 'check', cents: 6840, allocations: { invoiceIds: Object.keys(fill), cents: Object.values(fill) } })
    expect(pay).toMatchObject({ id: 'pay_ac_0808', status: 'settled', receivedAt: '2026-09-10' })
    const v = view('acct_res_003')
    expect([v.balance, v.pastDue]).toEqual([0, 0])
    expect(st().db.allocations.filter(a => a.sourceId === 'pay_ac_0808').map(a => a.cents)).toEqual([3420, 3420])
    expect(v.sync.quickbooks.state).toBe('stale')
    expect(st().accountEdits.ledgerWrites.map(w => [w.id, w.kind])).toEqual([['lw_ac_0001', 'payment'], ['lw_ac_0002', 'allocation']])
  })

  it('allocatePayment applies the unapplied pay_chk_unknown and refuses an over-allocation without writing', () => {
    const db = st().db
    expect(() => st().allocatePayment({ sourceType: 'payment', sourceId: 'pay_chk_unknown', invoiceIds: ['inv_res_017'], cents: [80000] })).toThrow()
    expect(st().db).toBe(db)
    st().allocatePayment({ sourceType: 'payment', sourceId: 'pay_chk_unknown', invoiceIds: ['inv_res_017'], cents: [6500] })
    const v = view('acct_res_017')
    expect([v.balance, v.pastDue, v.unappliedPaymentCents]).toEqual([3761, 3761, 0])
    expect(v.sync.quickbooks.reason).toMatch(/^Payment not yet synced: allocation of pay_chk_unknown recorded 2026-09-10/)
  })

  it('issue credit: unapplied on the account by default, or applied to an invoice in the same write', () => {
    const memo = st().issueCreditMemo({ accountId: 'acct_res_maple', cents: 500, reason: 'goodwill', note: 'Missed Aug 24' })
    expect(memo).toMatchObject({ id: 'cm_ac_0001', reason: 'goodwill: Missed Aug 24', by: 'office', at: '2026-09-10' })
    expect(view('acct_res_maple').unappliedCreditCents).toBe(500)
    st().issueCreditMemo({ accountId: 'acct_res_maple', cents: 745, reason: 'billingError', invoiceId: 'inv_maple_2026q3' })
    const v = view('acct_res_maple')
    expect([v.balance, v.pastDue]).toEqual([8000, 8000])
    expect(v.sync.quickbooks.reason).toMatch(/^Credit not yet synced/)
  })
})

describe('Scenario C: Kerr is suspended, the route skips him (invariant 4)', () => {
  it('Kerr before: suspended, nothing generated, route stub shows the recorded Tuesday skips', () => {
    const v = view('acct_res_kerr')
    expect(v.account.status).toBe('suspended')
    expect(v.nextInvoice.estimateCents).toBe(0)
    const stub = buildRouteStub('acct_res_kerr', undefined, st().db)[0]
    expect(stub.route?.id).toBe('route_tue_res')
    expect(stub.otherStops).toBe(15)
    expect(stub.stops.map(s => `${s.date} ${s.kind} ${s.now}`)).toEqual([
      '2026-09-01 recorded skippedSuspended', '2026-09-08 recorded skippedSuspended',
      '2026-09-15 projected skippedSuspended', '2026-09-22 projected skippedSuspended',
      '2026-09-29 projected skippedSuspended', '2026-10-06 projected skippedSuspended',
    ])
  })

  it('reinstating proposes the $25 fee through computeCharge into db.charges as intake (box 3.6), and flips the stub', () => {
    const preview = buildHoldPreview({ accountId: 'acct_res_kerr', mode: 'reinstate', effectiveFrom: '2026-09-10' }, st().db, sidecars())
    expect(preview.statusAfter).toBe('active')
    expect([preview.nextRunBeforeCents, preview.nextRunAfterCents, preview.nextRunAfterLines]).toEqual([0, 12936, 2])
    expect(preview.fee).toMatchObject({ id: 'chg_ac_0827', totalCents: 2675, source: { type: 'manual', id: 'sc_ac_0001' } })
    expect(preview.routeStub[0].stops.filter(s => s.kind === 'projected').every(s => s.now === 'skippedSuspended' && s.after === 'completed')).toBe(true)
    expect([preview.billingBefore.state, preview.billingAfter.state]).toEqual(['inSync', 'stale'])

    const charges = st().db.charges
    const r = st().reinstateAccount('acct_res_kerr')
    expect(r.account.status).toBe('active')
    expect(r.fee).toEqual(preview.fee)
    expect(st().db.charges).toEqual([...charges, preview.fee])
    const v = view('acct_res_kerr')
    expect(v.nextInvoice.estimateCents).toBe(12936)
    expect(v.nextInvoice.officeProposed.map(c => c.id)).toEqual(['chg_ac_0827'])
    expect(v.sync.billing.reason).toBe('Reinstatement fee, Piedmont Disposal policy chg_ac_0827 proposed by the office, waiting for a billing decision')
  })

  it('the fee is intake: proposed, on no invoice, in no billing run, and the view counts it exactly once', () => {
    st().reinstateAccount('acct_res_kerr')
    const rows = st().db.charges.filter(c => c.id === 'chg_ac_0827')
    expect(rows.map(c => c.status)).toEqual(['proposed'])
    expect(st().db.invoices.some(i => i.chargeIds.includes('chg_ac_0827'))).toBe(false)
    expect(Object.values(st().runs).some(r => r.chargeIds.includes('chg_ac_0827'))).toBe(false)
    const v = view('acct_res_kerr')
    expect(v.nextInvoice.preview.proposed.map(c => c.id)).toEqual(['chg_ac_0827'])
    expect(v.nextInvoice.lines.filter(c => c.id === 'chg_ac_0827')).toHaveLength(1)
    expect(v.nextInvoice.estimateCents).toBe(12936)
    // A second proposal takes the next id; nothing is overwritten or doubled.
    const again = st().proposeReinstatementFee('acct_res_kerr', 'sc_manual')
    expect(again.id).toBe('chg_ac_0828')
    expect(st().db.charges.filter(c => c.id.startsWith('chg_ac_')).map(c => c.id)).toEqual(['chg_ac_0827', 'chg_ac_0828'])
  })

  it('suspending again: nothing generated, the fee still waits for a billing decision, and the route stub flips back to skipped', () => {
    st().reinstateAccount('acct_res_kerr')
    const preview = buildHoldPreview({ accountId: 'acct_res_kerr', mode: 'suspend', effectiveFrom: '2026-09-10', reason: 'nonPayment' }, st().db, sidecars())
    // The recurring line goes (invariant 4); the fee proposed before the suspension is already in db.charges.
    expect([preview.nextRunBeforeCents, preview.nextRunAfterCents]).toEqual([12936, 2675])
    st().changeAccountStatus('acct_res_kerr', 'suspended', { reason: 'nonPayment' })
    const v = view('acct_res_kerr')
    expect(v.account.status).toBe('suspended')
    expect(v.nextInvoice.preview.recurring).toEqual([])
    expect(v.nextInvoice.estimateCents).toBe(2675)
    expect(v.nextInvoice.officeProposed.map(c => c.totalCents)).toEqual([2675])
    expect(st().db.serviceItems.find(s => s.id === 'si_kerr_96')?.status).toBe('held')
    expect(st().accountEdits.statusChanges.map(c => [c.id, c.kind, c.to])).toEqual([['sc_ac_0001', 'reinstate', 'active'], ['sc_ac_0002', 'suspend', 'suspended']])
  })

  it('Maple suspended: every line held and no charges; reinstated: back to pastDue with the fee (invariant 4)', () => {
    st().changeAccountStatus('acct_res_maple', 'suspended', { reason: 'nonPayment' })
    const db = st().db
    expect(generateRecurringCharges({ cycleDate: '2026-10-01' }, db).filter(c => c.accountId === 'acct_res_maple')).toEqual([])
    expect(generateEventCharges(db).filter(c => c.accountId === 'acct_res_maple')).toEqual([])
    expect(db.serviceItems.filter(s => s.siteId === 'site_maple').map(s => s.status)).toEqual(['held', 'held', 'held'])
    const r = st().reinstateAccount('acct_res_maple')
    expect(r.account.status).toBe('pastDue')
    expect(st().db.serviceItems.filter(s => s.siteId === 'site_maple').map(s => s.status)).toEqual(['active', 'active', 'active'])
    expect(view('acct_res_maple').nextInvoice.estimateCents).toBe(18361 + 2675)
  })

  it('a vacation hold files a scheduled vacationHold Request (box 3.6), keeps items active, and keeps billing; resuming adds no fee', () => {
    const preview = buildHoldPreview({ accountId: 'acct_res_maple', mode: 'hold', effectiveFrom: '2026-09-10', resumeOn: '2026-09-24' }, st().db, sidecars())
    expect([preview.nextRunBeforeCents, preview.nextRunAfterCents]).toEqual([18361, 18361])
    expect(preview.routeStub[0].otherStops).toBe(16)
    expect(preview.routeStub[0].stops.filter(s => s.kind === 'projected').map(s => `${s.date} ${s.after}`)).toEqual([
      '2026-09-14 skippedHold', '2026-09-21 skippedHold', '2026-09-28 completed', '2026-10-05 completed',
    ])
    const requests = st().db.requests
    st().changeAccountStatus('acct_res_maple', 'hold', { resumeOn: '2026-09-24' })
    expect(st().db.requests.slice(requests.length)).toEqual([expect.objectContaining({
      kind: 'vacationHold', status: 'scheduled', createdVia: 'phone', accountId: 'acct_res_maple', siteId: 'site_maple',
      note: 'Vacation hold from 2026-09-10, resume 2026-09-24',
    })])
    expect(st().db.serviceItems.filter(s => s.siteId === 'site_maple').every(s => s.status === 'active')).toBe(true)
    expect(previewNextRun('acct_res_maple', st().db).totalCents).toBe(18361)
    const r = st().reinstateAccount('acct_res_maple')
    expect(r.fee).toBeUndefined()
    expect(r.statusChange.kind).toBe('resume')
  })

  it('refuses to reinstate an account that is neither held nor suspended, and a hold that resumes before it starts', () => {
    expect(() => st().reinstateAccount('acct_bakery')).toThrow(/not on hold or suspended/)
    expect(() => st().changeAccountStatus('acct_bakery', 'hold', { effectiveFrom: '2026-09-20', resumeOn: '2026-09-15' })).toThrow(/must resume after it starts/)
  })
})

describe('Scenario D: Bakery, why the 3 yd price is $198.00 and not $220.00', () => {
  it('the service line shows the contract price and source; nothing is written by reading it', () => {
    const db = st().db
    const v = view('acct_bakery')
    const line = v.sites[0].lines.find(l => l.item.id === 'si_bakery_3yd')!
    expect(line.resolved).toMatchObject({ priceCents: 19800, ruleWon: 'contractOverride', contractId: 'contract_bakery' })
    expect(v.nextInvoice.estimateCents).toBe(44737)
    expect(st().db).toBe(db)
  })
})

describe('Scenario E: the next billing run preview recomputes on every store change (invariant 3)', () => {
  it('Maple before 18361, after the swap 17674, with the 96 gal line gone and the posted Q3 invoice unchanged (invariant 1)', () => {
    expect(view('acct_res_maple').nextInvoice.estimateCents).toBe(18361)
    st().changeServiceItem(maple96to64)
    const v = view('acct_res_maple')
    expect(v.nextInvoice.estimateCents).toBe(17674)
    expect(v.openWorkOrders.map(w => w.workOrder.id)).toEqual(['wo_ac_0004'])
    const q3 = v.invoices.find(i => i.invoice.number === 'INV-2026-0203')!
    expect([q3.invoice.totalCents, q3.openCents]).toEqual([18074, 8745])
  })
})

describe('add and remove an account (the office\'s own intake)', () => {
  const draft = {
    payerName: 'Fern Hollow HOA',
    kind: 'hoa' as const,
    address: '88 Fern Hollow Rd',
    zoneId: 'zone_open',
    routeId: 'route_mon_res',
    cycle: 'quarterly' as const,
    billedInAdvance: true,
    deliveryMethod: 'mail' as const,
    autopay: false,
    taxExempt: false,
    service: { catalogId: 'cat_res_96', qty: 1, frequency: 'weekly' as const, startOn: '2026-09-14' },
  }

  it('writes the party, account, site, first service, its container and an open delivery work order', () => {
    const before = st().db.accounts.length
    const plan = st().addAccount(draft)
    const db = st().db
    expect(db.accounts).toHaveLength(before + 1)
    expect(byIdIn(db.accounts, plan.account.id)).toMatchObject({ status: 'active', cycle: 'quarterly', deliveryMethod: 'mail' })
    expect(byIdIn(db.parties, plan.party.id)?.name).toBe('Fern Hollow HOA')
    expect(byIdIn(db.sites, plan.site.id)).toMatchObject({ accountId: plan.account.id, address: '88 Fern Hollow Rd', routeId: 'route_mon_res' })
    expect(plan.item && byIdIn(db.serviceItems, plan.item.id)).toMatchObject({ status: 'active', effectiveFrom: '2026-09-14' })
    expect(plan.container && byIdIn(db.containers, plan.container.id)?.assignedFrom).toBe('2026-09-13')
    expect(plan.workOrder && byIdIn(db.workOrders, plan.workOrder.id)).toMatchObject({ kind: 'deliver', status: 'open', scheduledFor: '2026-09-13' })
    // $29.00 a month at the open-zone weekly rate, the figure the table then shows as revenue.
    expect(plan.priceCents).toBe(2900)
    expect(st().db.charges.filter(c => c.accountId === plan.account.id)).toEqual([])
  })

  it('refuses a draft with no name, and the same payer twice at one address, writing nothing', () => {
    const before = st().db
    expect(() => st().addAccount({ ...draft, payerName: '  ' })).toThrow(/payer name/i)
    st().addAccount(draft)
    expect(() => st().addAccount(draft)).toThrow(/already has an account/i)
    expect(st().db.accounts.filter(a => a.payerPartyId.includes('_ac_'))).toHaveLength(1)
    expect(before.invoices).toBe(st().db.invoices)
  })

  it('deletes an account it just added, with its party, site, service, container and work order', () => {
    const plan = st().addAccount(draft)
    const removal = st().deleteAccount(plan.account.id)
    expect(removal.canDelete).toBe(true)
    const db = st().db
    expect(byIdIn(db.accounts, plan.account.id)).toBeUndefined()
    expect(byIdIn(db.parties, plan.party.id)).toBeUndefined()
    expect(byIdIn(db.sites, plan.site.id)).toBeUndefined()
    expect(byIdIn(db.serviceItems, plan.item!.id)).toBeUndefined()
    expect(byIdIn(db.containers, plan.container!.id)).toBeUndefined()
    expect(byIdIn(db.workOrders, plan.workOrder!.id)).toBeUndefined()
  })

  it('refuses to delete an account with history and changes nothing', () => {
    const before = st().db
    expect(() => st().deleteAccount('acct_res_maple')).toThrow(/cannot be deleted/i)
    expect(st().db).toBe(before)
  })

  it('closing Maple ends her lines, raises one recovery work order, and keeps every invoice and payment', () => {
    const invoicesBefore = st().db.invoices.length
    const paymentsBefore = st().db.payments.length
    const plan = st().closeAccount('acct_res_maple', { effectiveFrom: '2026-10-01' })
    const db = st().db
    const v = view('acct_res_maple')
    expect(plan.canDelete).toBe(false)
    expect(v.account.status).toBe('suspended')
    expect(v.account.autopay).toBe(false)
    expect(v.sites.flatMap(s => s.activeLines)).toEqual([])
    expect(db.serviceItems.filter(i => i.siteId === 'site_maple').every(i => i.status === 'ended' && i.effectiveTo === '2026-10-01')).toBe(true)
    const recovery = db.workOrders.filter(w => w.siteId === 'site_maple' && w.kind === 'recovery')
    expect(recovery).toHaveLength(1)
    expect(recovery[0].status).toBe('open')
    // The money is untouched: nothing is written off by closing.
    expect(db.invoices).toHaveLength(invoicesBefore)
    expect(db.payments).toHaveLength(paymentsBefore)
    expect([v.balance, v.pastDue]).toEqual([8745, 8745])
    expect(st().accountEdits.statusChanges.at(-1)).toMatchObject({ kind: 'suspend', reason: 'customerRequest', note: 'Account closed' })
  })
})
