// Moved from pricing/src/store/agentProposals.test.ts: agent proposals for an annual increase on billing's merged
// seed. Agent drafts. Rules authorize. You approve. Nothing here publishes.
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../../../store/useStore'
import { TODAY } from '../../../store/clock'
import { resolvePrice } from '../../../store/engine'
import { monthsBetween, planApproval, proposalEffectiveFrom, proposeIncreases, rowStatus, unproposedAccounts, type ProposalRow } from '../lib/agentProposals'
import { lobDrafts, versionHistory } from '../lib/ratebook'
import { withDrafts } from '../lib/rateVersions'

const s = () => useStore.getState()
const rows = () => proposeIncreases({ onDate: TODAY }, s().db)
const row = (id: string): ProposalRow => {
  const r = rows().find(x => x.accountId === id)
  if (!r) throw new Error(`no proposal for ${id}`)
  return r
}
const view = () => withDrafts(s().db, s().pricingDrafts)
const old96 = () => s().db.rateVersions.find(rv => rv.catalogId === 'cat_res_96' && rv.zoneId === 'zone_open' && rv.status === 'published')!

beforeEach(() => s().reset())

describe('proposeIncreases', () => {
  it('acct_bakery proposes its scheduled 4 percent escalator with action none', () => {
    const r = row('acct_bakery')
    expect(r).toMatchObject({ proposedPct: 4, contractEligibility: 'contract escalator 4% due 2027-01-01', eligibilityKind: 'escalatorScheduled', action: { kind: 'none', label: 'none' } })
    expect(r.currentMonthlyCents).toBe(36900) // 19800 + 17100 contract prices
    expect(r.proposedMonthlyCents).toBe(20592 + 17784)
    expect(r.proposedEffective).toBe('2027-01-01')
    expect(r.lastIncrease).toEqual({ date: '2026-01-01', source: 'contract', id: 'contract_bakery' })
    expect(r.monthsSinceLastIncrease).toBe(8)
    expect(r.marginPct).toBeLessThan(20)
  })

  it('a contract with no escalator is locked: 0 percent now and a 6 percent escalator at renewal', () => {
    const r = row('acct_fl_002')
    expect(r).toMatchObject({ contractEligibility: 'contract, no escalator, locked until 2026-12-31', proposedPct: 0, marginPct: 19.1, escalatorPct: 6 })
    expect(r.proposedMonthlyCents).toBe(r.currentMonthlyCents)
    expect(r.action).toEqual({ kind: 'escalator', contractId: 'contract_fl_002', escalator: { kind: 'fixedPct', pct: 6, anniversary: '2027-01-01' }, label: 'escalator entry on contract_fl_002' })
  })

  it('acct_res_001 proposes a draft for the rate line it resolves to', () => {
    const r = row('acct_res_001')
    expect(r).toMatchObject({ contractEligibility: 'no contract, eligible', proposedPct: 4, currentMonthlyCents: 2900, proposedMonthlyCents: 3016, monthsSinceLastIncrease: 8, churnRisk: 'medium' })
    expect(r.action.kind).toBe('draftRateVersion')
    expect(r.action.label).toBe('draft RateVersion for cat_res_96, zone_open, weekly')
    expect(r.rationale).toMatch(new RegExp(`^8 months since the last increase \\(${old96().id}, 2026-01-01\\), 56\\.1% margin`))
  })

  it('churn risk placeholder: pastDue high, autopay low, else medium', () => {
    expect(row('acct_res_maple').churnRisk).toBe('high')
    expect(row('acct_res_maple').rationale).toContain('(placeholder: past due)')
    const autopay = s().db.accounts.find(a => a.autopay && a.status === 'active' && rows().some(r => r.accountId === a.id))!
    expect(row(autopay.id).churnRisk).toBe('low')
  })

  it('rows are billable accounts only, ranked with work to approve first', () => {
    const all = rows()
    expect(all).toHaveLength(43)
    expect(all.map(r => r.accountId)).not.toContain('acct_res_kerr')
    expect(all.map(r => r.accountId)).not.toContain('acct_res_holt')
    expect(unproposedAccounts({ onDate: TODAY }, s().db).map(u => [u.accountId, u.status]).sort()).toEqual([['acct_res_holt', 'hold'], ['acct_res_kerr', 'suspended']])
    const firstNone = all.findIndex(r => r.action.kind === 'none')
    expect(all.slice(firstNone).map(r => r.accountId)).toEqual(['acct_bakery'])
  })

  it('dates: months between and the notice-respecting effective date', () => {
    expect(monthsBetween('2025-01-01', '2026-09-10')).toBe(20)
    expect(monthsBetween('2026-01-01', '2026-09-10')).toBe(8)
    expect(monthsBetween('2026-09-11', '2026-09-10')).toBe(0)
    expect(proposalEffectiveFrom('2026-09-10')).toBe('2026-11-01')
    expect(proposalEffectiveFrom('2026-09-01')).toBe('2026-10-01')
  })
})

describe('planApproval and approvePricingProposals', () => {
  it('deduplicates: approving every row creates 6 drafts covering 38 accounts and 4 escalator entries', () => {
    const all = rows()
    const plan = planApproval(all, all.map(r => r.accountId), view().rateVersions, TODAY)
    expect(plan.drafts).toHaveLength(6)
    expect(plan.coveredAccountIds).toHaveLength(38)
    expect(plan.escalators.map(e => e.contractId).sort()).toEqual(['contract_fl_002', 'contract_fl_004', 'contract_fl_006', 'contract_fl_008'])
    expect(plan.alreadyScheduled).toEqual(['acct_bakery'])
    expect(plan.summary).toBe('Creates 6 draft rate versions covering 38 accounts and writes 4 contract escalator entries. Nothing publishes.')
    expect(plan.drafts.find(d => d.key === 'cat_res_96|zone_open|weekly')!.args).toEqual({ catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 3016, effectiveFrom: '2026-11-01', supersedesId: old96().id })
  })

  it('approving one residential row still states everyone the rate line moves', () => {
    const plan = planApproval(rows(), ['acct_res_001'], view().rateVersions, TODAY)
    expect(plan.drafts).toHaveLength(1)
    // Every billable account on the 96 gal, Open market, weekly line with no contract: Maple plus 24 generic accounts.
    expect(plan.coveredAccountIds).toHaveLength(25)
    expect(plan.coveredAccountIds).toContain('acct_res_maple')
    expect(plan.summary).toBe('Creates 1 draft rate version covering 25 accounts. Nothing publishes.')
  })

  it('approving all never publishes anything', () => {
    const publishedBefore = s().db.rateVersions.filter(rv => rv.status === 'published')
    useStore.setState({ publishRateVersions: () => { throw new Error('the agent panel must never publish') } })
    const result = s().approvePricingProposals({ accountIds: rows().map(r => r.accountId), onDate: TODAY })
    const after = s().db.rateVersions
    expect(after.filter(rv => rv.status === 'published')).toHaveLength(publishedBefore.length)
    publishedBefore.forEach(rv => expect(after).toContain(rv))
    expect(result.drafts).toHaveLength(6)
    expect(result.contracts).toHaveLength(4)
    expect(result.drafts.every(d => d.status === 'draft' && d.publishedAt === undefined)).toBe(true)
    expect(s().pricingDrafts).toEqual(result.drafts)
    expect([...s().pricingAgentDraftIds].sort()).toEqual(result.drafts.map(d => d.id).sort())
    // Drafts are never considered by resolvePrice.
    expect(resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_001', onDate: '2026-11-01' }).priceCents).toBe(2900)
  })

  it('writes the escalators, leaves the bakery alone, and a second approve writes nothing new', () => {
    const bakery = s().db.contracts.find(c => c.id === 'contract_bakery')
    s().approvePricingProposals({ accountIds: rows().map(r => r.accountId), onDate: TODAY })
    expect(s().db.contracts.find(c => c.id === 'contract_fl_002')!.escalator).toEqual({ kind: 'fixedPct', pct: 6, anniversary: '2027-01-01' })
    expect(s().db.contracts.find(c => c.id === 'contract_bakery')).toBe(bakery)
    expect(s().db.contracts).toHaveLength(5)

    const again = rows()
    expect(again.find(r => r.accountId === 'acct_fl_002')!.action.kind).toBe('none')
    expect(rowStatus(again.find(r => r.accountId === 'acct_res_001')!, view().rateVersions).kind).toBe('draftPending')
    const second = s().approvePricingProposals({ accountIds: again.map(r => r.accountId), onDate: TODAY })
    expect(second.drafts).toHaveLength(0)
    expect(second.contracts).toHaveLength(0)
    expect(second.plan.alreadyPending).toHaveLength(6)
    expect(s().pricingDrafts).toHaveLength(6)
  })

  it('agent drafts land where the drafts tray and history drawer read them', () => {
    s().approvePricingProposals({ accountIds: ['acct_res_001'], onDate: TODAY })
    const tray = lobDrafts(view(), 'residential')
    expect(tray.map(d => d.draft.id)).toEqual(['rv_pr_res_96_open_weekly_20261101'])
    expect(tray[0].supersedes).toBe(old96())
    const history = versionHistory(view(), { catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly' }, TODAY)
    expect(history[0].version).toMatchObject({ id: 'rv_pr_res_96_open_weekly_20261101', status: 'draft', priceCents: 3016 })
    expect(history.find(h => h.version === old96())).toMatchObject({ isCurrent: true })
  })

  it('a rate line with a pending bulk draft is left alone', () => {
    const bulk = s().createBulkIncreaseDrafts({ lob: 'residential', pct: 4, effectiveFrom: '2026-10-01' })
    const plan = planApproval(rows(), ['acct_res_001'], view().rateVersions, TODAY)
    expect(plan.drafts).toHaveLength(0)
    expect(plan.alreadyPending[0]).toMatchObject({ key: 'cat_res_96|zone_open|weekly' })
    expect(plan.alreadyPending[0].draftIds).toContain(bulk.find(d => d.supersedesId === old96().id)!.id)
    expect(plan.summary).toBe('Nothing to write. Nothing publishes.')
  })
})
