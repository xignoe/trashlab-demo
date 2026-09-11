// The pricing slice's contract (box 2B.2): drafts and agent state stay in the slice; publishRateVersions,
// saveContractOverride, setContractEscalator, priceCommercialRequest, and setZonePublicPricing write db through
// mutateDb and never rewrite a row they do not own.
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../../../store/useStore'
import { CORE_KEYS } from '../../../store/slices/types'
import { createPricingSlice } from '../../../store/slices/pricing'

const s = () => useStore.getState()
beforeEach(() => s().reset())

const published = () => s().db.rateVersions.filter(rv => rv.status === 'published')
const find = (catalogId: string, zoneId: string, effectiveFrom?: string) =>
  s().db.rateVersions.find(rv => rv.catalogId === catalogId && rv.zoneId === zoneId && rv.status === 'published' && (effectiveFrom === undefined || rv.effectiveFrom === effectiveFrom))!

describe('slice shape', () => {
  it('state keys carry the pricing prefix and no key collides with the core', () => {
    const part = createPricingSlice(useStore.setState, useStore.getState, useStore) as unknown as Record<string, unknown>
    const fields = Object.keys(part).filter(k => typeof part[k] !== 'function')
    // pricingAccountLinks is gone: account's linkAccountToContract writes the link (box 3.6).
    expect(fields.sort()).toEqual(['pricingAgentDraftIds', 'pricingDrafts', 'pricingLastPublish', 'pricingPublishCount'])
    for (const k of Object.keys(part)) expect(CORE_KEYS as readonly string[]).not.toContain(k)
    expect(typeof s().publishRateVersions).toBe('function')
    expect(typeof s().saveContractOverride).toBe('function')
  })
})

describe('drafts', () => {
  it('createDraftRateVersion queues a draft in the slice with a readable, unique, infixed id', () => {
    const db = s().db
    const old = find('cat_res_96', 'zone_open')
    const a = s().createDraftRateVersion({ catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 3016.4, effectiveFrom: '2026-10-01', supersedesId: old.id })
    expect(a).toEqual({ id: 'rv_pr_res_96_open_weekly_20261001', catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 3016, effectiveFrom: '2026-10-01', status: 'draft', supersedesId: old.id })
    const b = s().createDraftRateVersion({ catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 3100, effectiveFrom: '2026-10-01' })
    expect(b.id).toBe('rv_pr_res_96_open_weekly_20261001_2')
    expect(b).not.toHaveProperty('supersedesId')
    expect(s().pricingDrafts).toEqual([a, b])
    expect(s().db).toBe(db)
    expect(() => s().createDraftRateVersion({ catalogId: 'cat_nope', priceCents: 100, effectiveFrom: '2026-10-01' })).toThrow('Unknown catalog')
    expect(() => s().createDraftRateVersion({ catalogId: 'cat_res_96', priceCents: 0, effectiveFrom: '2026-10-01' })).toThrow(RangeError)
  })

  it('createBulkIncreaseDrafts supersedes the latest published version per line, including one scheduled for later', () => {
    const drafts = s().createBulkIncreaseDrafts({ lob: 'residential', pct: 4, effectiveFrom: '2026-10-01' })
    expect(drafts).toHaveLength(8)
    // 64 gal open already has a version published for 2026-10-01; the bulk draft supersedes that one.
    const q4 = find('cat_res_64', 'zone_open', '2026-10-01')
    expect(q4.priceCents).toBe(2700)
    expect(drafts.find(d => d.supersedesId === q4.id)!.priceCents).toBe(2808)
    expect(drafts.some(d => d.supersedesId === find('cat_res_64', 'zone_open', '2026-01-01').id)).toBe(false)
    expect(drafts.find(d => d.supersedesId === find('cat_res_extra_cart', 'zone_open').id)!.priceCents).toBe(936)
    const ro = s().createBulkIncreaseDrafts({ lob: 'rolloff', pct: 2.5, effectiveFrom: '2026-10-01' })
    expect(ro).toHaveLength(4) // 10, 20, 30, and 40 yd; the compactor has no published rate
    expect(ro.find(d => d.catalogId === 'cat_ro_20yd')).toMatchObject({ priceCents: 58938 }) // 57500 * 1.025 = 58937.5, half up
  })

  it('replacePending swaps the lob drafts instead of stacking, and leaves other lobs alone', () => {
    const fl = s().createBulkIncreaseDrafts({ lob: 'frontload', pct: 4, effectiveFrom: '2026-10-01' })
    s().createBulkIncreaseDrafts({ lob: 'residential', pct: 4, effectiveFrom: '2026-10-01' })
    const second = s().createBulkIncreaseDrafts({ lob: 'residential', pct: 6, effectiveFrom: '2026-11-01', replacePending: true })
    expect(s().pricingDrafts.filter(d => d.catalogId.startsWith('cat_res'))).toEqual(second)
    expect(s().pricingDrafts.filter(d => d.catalogId.startsWith('cat_fl'))).toEqual(fl)
  })

  it('discardDraftRateVersion removes only drafts', () => {
    const d = s().createDraftRateVersion({ catalogId: 'cat_fl_2yd', zoneId: 'zone_open', frequency: 'weekly', priceCents: 16500, effectiveFrom: '2026-10-01' })
    const before = s().db.rateVersions
    s().discardDraftRateVersion({ id: d.id })
    s().discardDraftRateVersion({ id: before[0].id })
    expect(s().pricingDrafts).toEqual([])
    expect(s().db.rateVersions).toBe(before)
  })
})

describe('publishRateVersions', () => {
  it('appends pending drafts as published, ignores other ids, and never edits an existing version', () => {
    const old = find('cat_fl_2yd', 'zone_open')
    const before = s().db.rateVersions
    const d = s().createDraftRateVersion({ catalogId: 'cat_fl_2yd', zoneId: 'zone_open', frequency: 'weekly', priceCents: 15600, effectiveFrom: '2026-10-01', supersedesId: old.id })
    const out = s().publishRateVersions({ draftIds: [d.id, old.id, 'rv_nope'] })
    expect(out).toEqual([{ ...d, status: 'published', publishedAt: '2026-09-10T09:00:00-04:00' }])
    expect(s().db.rateVersions).toEqual([...before, out[0]])
    before.forEach((rv, i) => expect(s().db.rateVersions[i]).toBe(rv))
    expect(s().pricingDrafts).toEqual([])
    expect(s().pricingPublishCount).toBe(1)
    expect(s().pricingLastPublish).toMatchObject({ ids: [d.id], publishedAt: '2026-09-10T09:00:00-04:00' })

    // A second publish in the session is stamped a minute later.
    const d2 = s().createDraftRateVersion({ catalogId: 'cat_fl_2yd', zoneId: 'zone_open', frequency: 'weekly', priceCents: 16000, effectiveFrom: '2026-11-01', supersedesId: d.id })
    expect(s().publishRateVersions({ draftIds: [d2.id] })[0].publishedAt).toBe('2026-09-10T09:01:00-04:00')
  })

  it('an explicit publishedAt is used as given (the Phase 3 billing delegate passes its stamp)', () => {
    const d = s().createDraftRateVersion({ catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 3100, effectiveFrom: '2026-11-01', supersedesId: find('cat_res_96', 'zone_open').id })
    expect(s().publishRateVersions({ draftIds: [d.id], publishedAt: '2026-09-10T12:00:00-04:00' })[0].publishedAt).toBe('2026-09-10T12:00:00-04:00')
  })

  it('publishing nothing writes nothing', () => {
    const db = s().db
    expect(s().publishRateVersions({ draftIds: [] })).toEqual([])
    expect(s().db).toBe(db)
    expect(s().pricingPublishCount).toBe(0)
  })
})

describe('setContractEscalator', () => {
  it('writes the escalator on an in-force contract without one, replacing only that row', () => {
    const before = s().db.contracts.find(c => c.id === 'contract_fl_002')!
    const c = s().setContractEscalator({ accountId: 'acct_fl_002', escalator: { kind: 'fixedPct', pct: 6, anniversary: '2027-01-01' } })
    expect(c.id).toBe('contract_fl_002')
    expect(c.escalator).toEqual({ kind: 'fixedPct', pct: 6, anniversary: '2027-01-01' })
    expect(c.overrides).toBe(before.overrides)
    expect(before.escalator).toBeUndefined()
    expect(s().db.contracts.find(x => x.id === 'contract_fl_002')).toBe(c)
  })

  it('refuses to overwrite a scheduled escalator and rejects a zero pct', () => {
    expect(() => s().setContractEscalator({ accountId: 'acct_bakery', escalator: { kind: 'fixedPct', pct: 6, anniversary: '2027-01-01' } })).toThrow(/already has a 4% escalator/)
    expect(() => s().setContractEscalator({ accountId: 'acct_fl_002', escalator: { kind: 'fixedPct', pct: 0, anniversary: '2027-01-01' } })).toThrow(RangeError)
  })

  it('never writes a lapsed contract (K3): a new one year contract carries the escalator', () => {
    s().mutateDb(db => ({ ...db, contracts: db.contracts.map(c => (c.id === 'contract_fl_004' ? { ...c, termEnd: '2026-08-31' } : c)) }))
    const lapsed = s().db.contracts.find(c => c.id === 'contract_fl_004')!
    const c = s().setContractEscalator({ accountId: 'acct_fl_004', escalator: { kind: 'fixedPct', pct: 4, anniversary: '2027-09-11' } })
    expect(c).toEqual({ id: 'contract_acct_fl_004_20260910', accountId: 'acct_fl_004', termStart: '2026-09-10', termEnd: '2027-09-10', renewalNoticeDays: 60, overrides: [], escalator: { kind: 'fixedPct', pct: 4, anniversary: '2027-09-11' } })
    expect(s().db.contracts.find(x => x.id === 'contract_fl_004')).toBe(lapsed)
  })
})

describe('setZonePublicPricing (addendum K1)', () => {
  it('replaces only the zone row, refuses a zone that is not served, and ignores a no-op', () => {
    const zones = s().db.zones
    s().setZonePublicPricing({ zoneId: 'zone_franchise', publicPricing: true })
    expect(s().db.zones.find(z => z.id === 'zone_franchise')!.publicPricing).toBe(true)
    zones.filter(z => z.id !== 'zone_franchise').forEach(z => expect(s().db.zones).toContain(z))
    expect(zones.find(z => z.id === 'zone_franchise')!.publicPricing).toBe(false) // old row not mutated
    expect(() => s().setZonePublicPricing({ zoneId: 'zone_notserved', publicPricing: true })).toThrow(/not served/)
    expect(() => s().setZonePublicPricing({ zoneId: 'zone_nope', publicPricing: true })).toThrow('Unknown zone')
    const db = s().db
    s().setZonePublicPricing({ zoneId: 'zone_open', publicPricing: true })
    expect(s().db).toBe(db)
  })
})

describe('reset', () => {
  it('clears drafts and publishes through the slice creator', () => {
    const drafts = s().createBulkIncreaseDrafts({ lob: 'residential', pct: 4, effectiveFrom: '2026-10-01' })
    s().publishRateVersions({ draftIds: drafts.map(d => d.id) })
    s().createDraftRateVersion({ catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 3300, effectiveFrom: '2026-12-01' })
    s().reset()
    expect(published()).toHaveLength(25)
    expect(s().pricingDrafts).toEqual([])
    expect(s().pricingLastPublish).toBeNull()
    expect(s().pricingPublishCount).toBe(0)
  })
})
