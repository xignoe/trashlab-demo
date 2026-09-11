// DECISIONS.md entry 67: a rate for new service only (RateVersion.appliesTo). Current lines keep the price they had; a
// line that starts on or after the rate's date, and a quote with no line, pay it. Lines are found from the seed by what
// they price, not by id.
import { beforeEach, describe, expect, it } from 'vitest'
import type { RateVersion, ServiceItem } from '../../../types'
import type { Db } from '../../../store/db'
import { useStore } from '../../../store/useStore'
import { TODAY } from '../../../store/clock'
import { resolvePrice } from '../../../store/engine'
import { blastRadius } from '../lib/preview'

const s = () => useStore.getState()
beforeEach(() => s().reset())

const CYCLE = '2026-10-01'

const current96 = (): RateVersion =>
  s().db.rateVersions.find(rv => rv.catalogId === 'cat_res_96' && rv.zoneId === 'zone_open' && rv.frequency === 'weekly' && rv.status === 'published' && rv.effectiveFrom <= TODAY)!

/** Active 96 gal weekly lines in the open market that started before TODAY. */
function currentLines(): { si: ServiceItem; accountId: string; siteId: string }[] {
  const { db } = s()
  return db.serviceItems.flatMap(si => {
    const site = db.sites.find(x => x.id === si.siteId)
    if (!site || site.zoneId !== 'zone_open' || si.catalogId !== 'cat_res_96' || si.frequency !== 'weekly') return []
    if (si.status !== 'active' || si.effectiveFrom.slice(0, 10) >= TODAY) return []
    return [{ si, accountId: site.accountId, siteId: site.id }]
  })
}

const priceOf = (line: { si: ServiceItem; accountId: string; siteId: string }, db: Db = s().db) =>
  resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: line.accountId, onDate: CYCLE, siteId: line.siteId, serviceItemId: line.si.id }, db)

const draft96 = (appliesTo: RateVersion['appliesTo'], effectiveFrom = TODAY) => {
  const old = current96()
  return s().createDraftRateVersion({
    catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: old.priceCents + 200, effectiveFrom, supersedesId: old.id, appliesTo,
  })
}

describe('a rate for new service only', () => {
  it('leaves every current line on the price it had', () => {
    const lines = currentLines()
    expect(lines.length).toBeGreaterThan(0)
    const before = lines.map(l => priceOf(l))

    const d = draft96('newService')
    expect(d.appliesTo).toBe('newService')
    const [published] = s().publishRateVersions({ draftIds: [d.id] })
    expect(published).toMatchObject({ id: d.id, status: 'published', appliesTo: 'newService' })

    expect(lines.map(l => priceOf(l))).toEqual(before)
  })

  it('bills a line that starts on or after its date, and a quote with no line', () => {
    const old = current96()
    const d = draft96('newService')
    s().publishRateVersions({ draftIds: [d.id] })

    const line = currentLines().find(l => priceOf(l).ruleWon !== 'contractOverride')!
    const fresh: ServiceItem = { ...line.si, id: 'si_test_new_96', effectiveFrom: TODAY }
    const db: Db = { ...s().db, serviceItems: [...s().db.serviceItems, fresh] }
    expect(priceOf({ ...line, si: fresh }, db)).toMatchObject({ priceCents: old.priceCents + 200, rateVersionId: d.id })
    expect(priceOf(line, db)).toMatchObject({ priceCents: old.priceCents, rateVersionId: old.id })

    const quote = resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: '', onDate: CYCLE }, s().db)
    expect(quote).toMatchObject({ priceCents: old.priceCents + 200, rateVersionId: d.id })
  })

  it('a rate without appliesTo still bills everyone', () => {
    const d = draft96(undefined)
    expect(d.appliesTo).toBeUndefined()
    s().publishRateVersions({ draftIds: [d.id] })
    const line = currentLines().find(l => priceOf(l).ruleWon !== 'contractOverride')!
    expect(priceOf(line).rateVersionId).toBe(d.id)
  })
})

describe('publish preview for a new-service-only rate', () => {
  it('moves nobody and counts, as kept, exactly the accounts the same rate for everyone would move', () => {
    const kept = draft96('newService', CYCLE)
    const r = blastRadius({ draftIds: [kept.id], drafts: s().pricingDrafts, onDate: TODAY, db: s().db })
    expect(r.movedAccounts).toEqual([])
    expect(r.totalMonthlyDeltaCents).toBe(0)
    expect(r.keptOnCurrentPrice.lines).toBeGreaterThan(0)
    expect(r.representativeAccounts.find(a => a.accountId === 'acct_res_maple')?.unchanged).toBe(true)

    s().discardDraftRateVersion({ id: kept.id })
    const everyone = draft96('everyone', CYCLE)
    const all = blastRadius({ draftIds: [everyone.id], drafts: s().pricingDrafts, onDate: TODAY, db: s().db })
    expect(all.movedAccounts.length).toBe(r.keptOnCurrentPrice.accounts)
    expect(all.keptOnCurrentPrice).toEqual({ lines: 0, accounts: 0 })
  })
})
