// Moved from pricing/src/store/emptyStates.test.ts (pricing checklist 7.7 and 7.8) on billing's merged seed.
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../../../store/useStore'
import { TODAY } from '../../../store/clock'
import { blastRadius } from '../lib/preview'
import { approveButtonLabel, planApproval, proposeIncreases } from '../lib/agentProposals'
import { isNoChangeDraft, withDrafts } from '../lib/rateVersions'

const s = () => useStore.getState()
beforeEach(() => s().reset())
const pub = (catalogId: string, zoneId: string) => s().db.rateVersions.find(rv => rv.catalogId === catalogId && rv.zoneId === zoneId && rv.status === 'published' && rv.effectiveFrom <= TODAY)!

describe('a draft with no change cannot be published (7.7)', () => {
  it('isNoChangeDraft is true only when the draft repeats the superseded price', () => {
    const same = s().createDraftRateVersion({ catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 2900, effectiveFrom: '2026-10-01', supersedesId: pub('cat_res_96', 'zone_open').id })
    const changed = s().createDraftRateVersion({ catalogId: 'cat_res_extra_cart', zoneId: 'zone_open', frequency: 'weekly', priceCents: 950, effectiveFrom: '2026-10-01', supersedesId: pub('cat_res_extra_cart', 'zone_open').id })
    const newLine = s().createDraftRateVersion({ catalogId: 'cat_res_96', zoneId: 'zone_franchise', frequency: 'weekly', priceCents: 3300, effectiveFrom: '2026-10-01' })
    const rvs = withDrafts(s().db, s().pricingDrafts).rateVersions
    expect(isNoChangeDraft(same, rvs)).toBe(true)
    expect(isNoChangeDraft(changed, rvs)).toBe(false)
    expect(isNoChangeDraft(newLine, rvs)).toBe(false)
    expect(isNoChangeDraft(pub('cat_res_96', 'zone_open'), rvs)).toBe(false)
  })

  it('publishRateVersions leaves a no-change draft as a draft and publishes the rest', () => {
    const same = s().createDraftRateVersion({ catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 2900, effectiveFrom: '2026-10-01', supersedesId: pub('cat_res_96', 'zone_open').id })
    const changed = s().createDraftRateVersion({ catalogId: 'cat_res_extra_cart', zoneId: 'zone_open', frequency: 'weekly', priceCents: 950, effectiveFrom: '2026-10-01', supersedesId: pub('cat_res_extra_cart', 'zone_open').id })
    const out = s().publishRateVersions({ draftIds: [same.id, changed.id] })
    expect(out.map(rv => rv.id)).toEqual([changed.id])
    expect(s().pricingDrafts).toEqual([same])
  })
})

describe('publish preview with zero moved accounts (7.7)', () => {
  it('a zone_boundary draft moves nobody: no billable site is in zone_boundary', () => {
    expect(s().db.sites.some(site => site.zoneId === 'zone_boundary')).toBe(false)
    const d = s().createDraftRateVersion({ catalogId: 'cat_res_96', zoneId: 'zone_boundary', frequency: 'weekly', priceCents: 3200, effectiveFrom: '2026-10-01', supersedesId: pub('cat_res_96', 'zone_boundary').id })
    const r = blastRadius({ draftIds: [d.id], drafts: s().pricingDrafts, onDate: TODAY, db: s().db })
    expect(r.movedAccounts).toEqual([])
    expect(r.totalMonthlyDeltaCents).toBe(0)
    expect(r.draftIds).toEqual([d.id])
  })

  it('rejects ids that are not pending drafts', () => {
    expect(() => blastRadius({ draftIds: [pub('cat_res_96', 'zone_open').id], drafts: [], onDate: TODAY, db: s().db })).toThrow('already published')
    expect(() => blastRadius({ draftIds: ['rv_nope'], drafts: [], onDate: TODAY, db: s().db })).toThrow('Unknown rate version')
  })
})

describe('agent confirm label matches its plan (7.8)', () => {
  const plan = (ids: string[]) => planApproval(proposeIncreases({ onDate: TODAY }, s().db), ids, s().db.rateVersions, TODAY)

  it('escalator only, drafts only, both, and nothing; never the word publish', () => {
    const cases: [string[], string][] = [
      [['acct_fl_002'], 'Approve, write escalator only'],
      [['acct_res_001'], 'Approve, create drafts only'],
      [['acct_res_001', 'acct_fl_002'], 'Approve, create drafts and escalators'],
      [['acct_bakery'], 'Nothing to approve'],
    ]
    for (const [ids, label] of cases) {
      expect(approveButtonLabel(plan(ids))).toBe(label)
      expect(label.toLowerCase()).not.toContain('publish')
    }
  })

  it('approving the mixed plan publishes nothing', () => {
    const before = s().db.rateVersions.filter(rv => rv.status === 'published').map(rv => rv.id)
    const r = s().approvePricingProposals({ accountIds: ['acct_res_001', 'acct_fl_002'], onDate: TODAY })
    expect(r.drafts.length).toBeGreaterThan(0)
    expect(r.contracts).toHaveLength(1)
    expect(s().db.rateVersions.filter(rv => rv.status === 'published').map(rv => rv.id)).toEqual(before)
  })
})
