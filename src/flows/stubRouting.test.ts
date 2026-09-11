/**
 * Box 3.6: account's and pricing's sidecar stubs routed to their owners' tables.
 * - account's reinstatement fee is a proposed Charge in db.charges; billing's next run takes it as a queue decision
 *   (the intake rule), and approving and posting puts it on the account's invoice, once.
 * - account's phone requests (officeNotes) are Request rows with status scheduled the portal lists.
 * - pricing's new contract points the account at it through account's linkAccountToContract.
 * Billing's two stubs are in src/flows/stubs.test.ts.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { queueItems } from '../store/selectors'
import { useStore } from '../store/useStore'
import { buildAccountView } from '../surfaces/account/selectors'
import { requestsForAccount } from '../surfaces/portal/lib/selectors'
import { viewOf as portalViewOf } from '../surfaces/portal/store'
import { runAndPost } from './helpers'

const st = () => useStore.getState()
beforeEach(() => st().reset())

describe('box 3.6: the reinstatement fee reaches the billing run', () => {
  it('reinstating Kerr proposes the fee into db.charges; the run queues it as a decision; posting bills it once', () => {
    const { fee } = st().reinstateAccount('acct_res_kerr')
    expect(fee).toBeDefined()
    expect(st().db.charges.filter(c => c.id === fee!.id)).toEqual([fee])

    const run = st().runCycle()
    expect(run.chargeIds).toContain(fee!.id)
    const item = queueItems(st()).find(i => i.chargeId === fee!.id)!
    expect(item).toMatchObject({ kind: 'proposedCharge', decided: false, accountId: 'acct_res_kerr' })

    runAndPost()
    const invoices = st().db.invoices.filter(i => i.chargeIds.includes(fee!.id))
    expect(invoices).toHaveLength(1)
    expect(invoices[0].accountId).toBe('acct_res_kerr')
    expect(st().db.charges.filter(c => c.id === fee!.id).map(c => c.status)).toEqual(['posted'])
    // The account view no longer lists it as waiting.
    expect(buildAccountView('acct_res_kerr', st().db)!.nextInvoice.preview.proposed.some(c => c.id === fee!.id)).toBe(false)
  })
})

describe('box 3.6: the office\'s phone requests are portal Requests', () => {
  it('a phone cart change and a phone vacation hold are scheduled Requests the portal lists for the account', () => {
    const plan = st().changeServiceItem({ siteId: 'site_maple', replaceItemId: 'si_maple_96', catalogId: 'cat_res_64', qty: 1, frequency: 'weekly', effectiveFrom: '2026-10-01' })
    st().changeAccountStatus('acct_bakery', 'hold', { effectiveFrom: '2026-09-14', resumeOn: '2026-09-28' })
    const hold = st().db.requests.at(-1)!

    const maple = requestsForAccount(portalViewOf(st()), 'acct_res_maple')
    expect(maple.map(r => r.id)).toContain(plan.request!.id)
    expect(plan.request).toMatchObject({ kind: 'cartChange', status: 'scheduled', createdVia: 'phone', workOrderId: plan.workOrder.id })
    expect(requestsForAccount(portalViewOf(st()), 'acct_bakery').map(r => r.id)).toContain(hold.id)
    expect(hold).toMatchObject({ kind: 'vacationHold', status: 'scheduled', createdVia: 'phone', accountId: 'acct_bakery' })
  })
})

describe('box 3.6: pricing\'s contract link goes through account', () => {
  it('a save that opens a new contract sets BillingAccount.contractId, and the account view shows that contract', () => {
    const account = st().db.accounts.find(a => a.id === 'acct_fl_005')!
    expect(account.contractId).toBeUndefined()
    const contract = st().saveContractOverride({ accountId: 'acct_fl_005', catalogId: 'cat_fl_3yd', frequency: 'weekly', priceCents: 15000, reason: 'route density', pctBelowRateCard: 8 })
    expect(st().db.accounts.find(a => a.id === 'acct_fl_005')?.contractId).toBe(contract.id)
    expect(buildAccountView('acct_fl_005', st().db)!.contract?.id).toBe(contract.id)
  })

  it('account\'s linkAccountToContract refuses a contract on another account and writes nothing', () => {
    const db = st().db
    expect(() => st().linkAccountToContract({ accountId: 'acct_fl_005', contractId: 'contract_bakery' })).toThrow(/belongs to acct_bakery/)
    expect(st().db).toBe(db)
  })
})
