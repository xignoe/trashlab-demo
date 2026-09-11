// Scenario (a) and (c) of pricing/RUNBOOK.md on billing's merged seed, through the slice and the same selectors the
// Ratebook uses: bulk 4 percent residential increase, blast radius, publish, then the history chain and the posted
// invoice (invariant 1). No rate version or invoice id is hard-coded: each is found from the seed by what it is.
import { beforeEach, describe, expect, it } from 'vitest'
import type { Contract, RateVersion } from '../../../types'
import { useStore } from '../../../store/useStore'
import { TODAY } from '../../../store/clock'
import { generateRecurringCharges } from '../../../store/engine'
import { blastRadius } from '../lib/preview'
import { catalogGroups, lobDrafts, versionHistory } from '../lib/ratebook'
import { publishedAtFor, withDrafts } from '../lib/rateVersions'
import { withPreviewChargeIds } from '../lib/engine'
import { NOTE_STYLE, noteKind } from '../components/PublishPreviewModal'

const s = () => useStore.getState()
beforeEach(() => s().reset())

/** The published version a residential line resolves to today, found by what it prices, not by id. */
const current = (catalogId: string, zoneId: string, frequency: RateVersion['frequency']): RateVersion =>
  s().db.rateVersions.find(rv => rv.catalogId === catalogId && rv.zoneId === zoneId && rv.frequency === frequency && rv.status === 'published' && rv.effectiveFrom <= TODAY)!

describe('publishedAt', () => {
  it('is the clock day at 09:00 Eastern daylight time, one minute later per publish', () => {
    expect(publishedAtFor(TODAY, 0)).toBe('2026-09-10T09:00:00-04:00')
    expect(publishedAtFor(TODAY, 1)).toBe('2026-09-10T09:01:00-04:00')
  })
})

describe('scenario (a): 4 percent residential increase, blast radius, publish', () => {
  it('previews 31 moved, 5 protected, +$40.04 a month; publishes 8 versions; keeps every old version and posted invoice', () => {
    const db0 = s().db
    const invoicesBefore = structuredClone(db0.invoices)
    const chargesBefore = structuredClone(db0.charges)
    const old96 = current('cat_res_96', 'zone_open', 'weekly')
    const old96Snapshot = structuredClone(old96)
    const publishedBefore = db0.rateVersions.filter(rv => rv.status === 'published')
    expect(publishedBefore).toHaveLength(25)

    const drafts = s().createBulkIncreaseDrafts({ lob: 'residential', pct: 4, effectiveFrom: '2026-10-01', replacePending: true })
    expect(drafts).toHaveLength(8)
    expect(s().db).toBe(db0) // drafts live in the slice; db is not touched
    expect(drafts.every(d => d.status === 'draft' && d.id.startsWith('rv_pr_res_') && d.supersedesId)).toBe(true)
    expect(drafts.find(d => d.supersedesId === old96.id)).toMatchObject({ id: 'rv_pr_res_96_open_weekly_20261001', priceCents: 3016, effectiveFrom: '2026-10-01' })

    const view = withDrafts(s().db, s().pricingDrafts)
    const pending = lobDrafts(view, 'residential')
    expect(pending.map(p => p.draft.id).sort()).toEqual(drafts.map(d => d.id).sort())

    const r = blastRadius({ draftIds: pending.map(p => p.draft.id), drafts: s().pricingDrafts, onDate: TODAY, db: s().db, publishedAt: publishedAtFor(TODAY, 0) })
    expect(r.evaluatedOn).toBe('2026-10-01')
    expect(r.movedAccounts).toHaveLength(31)
    const moved = r.movedAccounts.map(m => m.accountId)
    expect(moved).toContain('acct_res_maple')
    expect(moved).not.toContain('acct_res_holt') // account on hold
    expect(moved).not.toContain('acct_res_kerr') // suspended
    expect(moved).not.toContain('acct_bakery')
    expect(r.movedAccounts.find(m => m.accountId === 'acct_res_maple')).toEqual({ accountId: 'acct_res_maple', name: 'Ruth Maple', beforeMonthlyCents: 5000, afterMonthlyCents: 5200 })
    expect(r.totalMonthlyDeltaCents).toBe(4004)
    expect(r.totalMonthlyDeltaCents).toBe(r.movedAccounts.reduce((sum, m) => sum + m.afterMonthlyCents - m.beforeMonthlyCents, 0))

    // Every Contract row is listed; all five run to 2026-12-31, so all are protected and none moves.
    expect(r.excludedContractAccounts.map(e => e.contractId).sort()).toEqual(s().db.contracts.map(c => c.id).sort())
    for (const e of r.excludedContractAccounts) expect(e).toMatchObject({ protected: true, note: "no service in this draft's scope, contract still protects it" })
    expect(r.excludedContractAccounts.find(e => e.accountId === 'acct_bakery')).toMatchObject({ name: 'Sunrise Bakery', reason: 'competitive match', coveredCatalogIds: ['cat_fl_3yd', 'cat_fl_3yd_wood'] })

    const [maple, one, bakery] = r.representativeAccounts
    expect(maple).toMatchObject({ accountId: 'acct_res_maple', cycle: 'quarterly', unchanged: false })
    expect([maple.before.totalCents, maple.after.totalCents]).toEqual([18074, 18760]) // $180.74 to $187.60, +$6.86 a quarter
    expect(maple.before.lines.map(l => l.pricing.rateVersionId)).toContain(old96.id)
    expect(maple.after.lines.map(l => l.pricing.rateVersionId)).toContain('rv_pr_res_96_open_weekly_20261001')
    expect(one).toMatchObject({ accountId: 'acct_res_001', cycle: 'monthly' })
    expect([one.before.totalCents, one.after.totalCents]).toEqual([3420, 3553])
    expect(bakery.unchanged).toBe(true)
    expect(bakery.after.totalCents).toBe(42447)
    expect(bakery.after.lines.every(l => l.pricing.ruleWon === 'contractOverride')).toBe(true)

    // Preview is pure.
    expect(s().db).toBe(db0)
    expect(s().pricingDrafts).toHaveLength(8)

    const published = s().publishRateVersions({ draftIds: r.draftIds })
    expect(published).toHaveLength(8)
    expect(published.every(p => p.status === 'published' && p.publishedAt === '2026-09-10T09:00:00-04:00' && p.supersedesId)).toBe(true)
    expect(s().db.rateVersions.filter(rv => rv.status === 'published')).toHaveLength(33)
    expect(s().pricingDrafts).toEqual([])
    for (const rv of publishedBefore) expect(s().db.rateVersions).toContain(rv) // same objects, untouched

    // Scenario (c): the history drawer's chain for 96 gal, Open market, weekly.
    const history = versionHistory(s().db, { catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly' }, TODAY)
    expect(history.map(h => h.version.id)).toEqual(['rv_pr_res_96_open_weekly_20261001', old96.id])
    expect(history[0].version).toMatchObject({ status: 'published', priceCents: 3016, effectiveFrom: '2026-10-01', supersedesId: old96.id, publishedAt: '2026-09-10T09:00:00-04:00' })
    expect(history[0].supersededBy).toBeUndefined()
    expect(history[1].version).toBe(old96)
    expect(history[1].version).toEqual(old96Snapshot)
    expect(history[1]).toMatchObject({ isCurrent: true, supersededBy: 'rv_pr_res_96_open_weekly_20261001' })

    // The line keeps today's price and shows the new one as scheduled.
    const line = catalogGroups(s().db, 'residential', TODAY)[0].lines[0]
    expect(line.current).toBe(old96)
    expect(line.scheduled.map(v => [v.priceCents, v.effectiveFrom])).toEqual([[3016, '2026-10-01']])

    // Invariant 1: every posted invoice and every charge is exactly what it was.
    expect(s().db.invoices).toEqual(invoicesBefore)
    expect(s().db.charges).toEqual(chargesBefore)

    // The history proof watches Maple's latest posted invoice, whose lines were priced by superseded versions.
    const proof = s().pricingLastPublish!.proof!
    const invoice = s().db.invoices.find(i => i.id === proof.invoiceId)!
    expect(invoice).toMatchObject({ accountId: 'acct_res_maple', totalCents: 18074, locked: true })
    expect(proof).toMatchObject({ totalCents: 18074, basis: 'superseded' })
    expect(proof.charges.map(c => c.rateVersionId)).toContain(old96.id)
  })

  it('the next billing run prices residential at the new version from 2026-10-01', () => {
    const drafts = s().createBulkIncreaseDrafts({ lob: 'residential', pct: 4, effectiveFrom: '2026-10-01' })
    s().publishRateVersions({ draftIds: drafts.map(d => d.id) })
    const run = withPreviewChargeIds(() => generateRecurringCharges({ cycleDate: '2026-10-01' }, { ...s().db, charges: [] }))
    const maple96 = run.find(c => c.accountId === 'acct_res_maple' && c.catalogId === 'cat_res_96')!
    expect(maple96.pricing).toEqual({ rateVersionId: 'rv_pr_res_96_open_weekly_20261001', ruleWon: 'zoneRate' })
    expect(maple96.baseCents).toBe(3016 * 3)
    expect(run.filter(c => c.accountId === 'acct_bakery').every(c => c.pricing.ruleWon === 'contractOverride')).toBe(true)
  })
})

describe('Protected by contract: all four note kinds', () => {
  const term = { termStart: '2026-01-01', termEnd: '2027-12-31', renewalNoticeDays: 60 }
  const override = (catalogId: string, frequency: Contract['overrides'][number]['frequency']) => ({ catalogId, frequency, priceCents: 2500, reason: 'test hold', pctBelowRateCard: 10 })

  it('writes covers, does-not-cover, partly-covered, out-of-scope, and lapsed notes, and the modal gives each its own pill', () => {
    const drafts = s().createBulkIncreaseDrafts({ lob: 'residential', pct: 4, effectiveFrom: '2026-10-01' })
    const base = s().db
    const extra: Contract[] = [
      { id: 'contract_t_001', accountId: 'acct_res_001', ...term, overrides: [override('cat_res_96', 'weekly')] },
      { id: 'contract_t_002', accountId: 'acct_res_002', ...term, overrides: [override('cat_fl_3yd', '2x')] },
      { id: 'contract_t_maple', accountId: 'acct_res_maple', ...term, overrides: [override('cat_res_96', 'weekly')] },
      { id: 'contract_t_lapsed', accountId: 'acct_res_003', termStart: '2025-09-01', termEnd: '2026-08-31', renewalNoticeDays: 60, overrides: [override('cat_res_96', 'weekly')] },
      // K3: a lapsed contract the account has since replaced is history and does not renew.
      { id: 'contract_t_old', accountId: 'acct_res_004', termStart: '2025-01-01', termEnd: '2025-12-31', renewalNoticeDays: 60, overrides: [override('cat_res_96', 'weekly')] },
      { id: 'contract_t_new', accountId: 'acct_res_004', ...term, overrides: [override('cat_res_96', 'weekly')] },
      { id: 'contract_t_future', accountId: 'acct_res_005', termStart: '2027-01-01', termEnd: '2027-12-31', renewalNoticeDays: 60, overrides: [override('cat_res_96', 'weekly')] },
    ]
    const db = { ...base, contracts: [...base.contracts, ...extra] }
    const r = blastRadius({ draftIds: drafts.map(d => d.id), drafts, onDate: TODAY, db })
    const note = (id: string) => r.excludedContractAccounts.find(e => e.contractId === id)!

    expect(note('contract_t_001')).toMatchObject({ protected: true, note: 'override covers 96 gal cart' })
    expect(note('contract_t_002').note).toMatch(/^override does not cover .+, that item moves$/)
    expect(note('contract_t_maple').note).toMatch(/^override covers 96 gal cart; .+ is not covered and moves$/)
    expect(note('contract_bakery').note).toBe("no service in this draft's scope, contract still protects it")
    // Addendum I1 (box 3.7g): a contract past its signed term auto-renews and stays protected, as billing bills it.
    expect(note('contract_t_lapsed')).toMatchObject({
      protected: true,
      renewedOn: '2026-09-01',
      note: 'override covers 96 gal cart (signed term ended 2026-08-31, auto-renewed 2026-09-01, still protected)',
    })
    expect(note('contract_t_001').renewedOn).toBeUndefined()
    expect(note('contract_t_old')).toMatchObject({ protected: false, note: 'contract ended 2025-12-31, replaced by contract_t_new, no longer protected' })
    expect(note('contract_t_old').renewedOn).toBeUndefined()
    expect(note('contract_t_future')).toMatchObject({ protected: false, note: 'contract starts 2027-01-01, not yet in force' })

    const moved = new Set(r.movedAccounts.map(m => m.accountId))
    expect(moved.has('acct_res_001')).toBe(false)
    expect(moved.has('acct_res_002')).toBe(true)
    expect(moved.has('acct_res_maple')).toBe(true)
    // Addendum I1 (Phase 3.7f): the canonical resolvePrice auto-renews a lapsed contract, so acct_res_003 keeps its
    // override and does not move, and the note above now agrees (box 3.7g).
    expect(moved.has('acct_res_003')).toBe(false)

    const kinds = ['contract_t_001', 'contract_t_002', 'contract_bakery', 'contract_t_old'].map(id => noteKind(note(id)))
    expect(kinds).toEqual(['covers', 'moves', 'outOfScope', 'lapsed'])
    expect(noteKind(note('contract_t_maple'))).toBe('moves')
    expect(noteKind(note('contract_t_lapsed'))).toBe('covers')
    expect(noteKind(note('contract_t_future'))).toBe('lapsed')
    expect(new Set(kinds.map(k => NOTE_STYLE[k].pill)).size).toBe(4)
  })
})

describe('invariant 1 across every line of business', () => {
  it('a 4 percent increase published on all three lobs leaves every invoice and charge unchanged', () => {
    const invoices = structuredClone(s().db.invoices)
    const charges = structuredClone(s().db.charges)
    const ids: string[] = []
    for (const lob of ['residential', 'frontload', 'rolloff'] as const) ids.push(...s().createBulkIncreaseDrafts({ lob, pct: 4, effectiveFrom: '2026-10-01' }).map(d => d.id))
    expect(s().publishRateVersions({ draftIds: ids })).toHaveLength(ids.length)
    expect(s().db.invoices).toEqual(invoices)
    expect(s().db.charges).toEqual(charges)
    expect(s().db.invoices.every(i => i.locked)).toBe(true)
  })
})
