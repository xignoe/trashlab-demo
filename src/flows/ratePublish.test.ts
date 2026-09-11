/**
 * Box 3.4: a residential rate published in the Ratebook reaches the storefront and the next billing run, and never a
 * posted invoice (invariant 1). Pricing's createBulkIncreaseDrafts and publishRateVersions, then the storefront's
 * buildOffer and billing's runCycle and post, all through the one store. Relationships only, never seed cents.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { RateVersion } from '../types'
import { useStore } from '../store/useStore'
import { buildOffer } from '../surfaces/storefront/lib/offer'
import { viewOf } from '../surfaces/storefront/lib/view'
import { postedSnapshot, runAndPost } from './helpers'

const st = () => useStore.getState()
beforeEach(() => st().reset())

const offerStarting = (startDate: string) =>
  buildOffer({ zoneId: 'zone_open', routeId: 'route_tue_res', cartCatalogId: 'cat_res_96', extraCart: false, recycling: false, startDate }, viewOf(st()))

function publishFourPercent(): RateVersion[] {
  const drafts = st().createBulkIncreaseDrafts({ lob: 'residential', pct: 4, effectiveFrom: '2026-10-01' })
  const published = st().publishRateVersions({ draftIds: drafts.map(d => d.id) })
  expect(published).toHaveLength(drafts.length)
  return published
}

describe('box 3.4: a residential RateVersion effective 2026-10-01', () => {
  it('the storefront offer at a zone_open address shows the new price from the effective date on, and the old one before', () => {
    const october = offerStarting('2026-10-06').lines[0]
    const september = offerStarting('2026-09-15').lines[0]
    const published = publishFourPercent()
    const new96 = published.find(rv => rv.catalogId === 'cat_res_96' && rv.zoneId === 'zone_open')!

    const after = offerStarting('2026-10-06').lines[0]
    expect(after.priceCents).toBe(new96.priceCents)
    expect(after.priceCents).toBeGreaterThan(october.priceCents)
    expect(after.pricing).toMatchObject({ rateVersionId: new96.id, ruleWon: 'zoneRate' })
    // A start before the effective date keeps the price in force then.
    expect(offerStarting('2026-09-15').lines[0].priceCents).toBe(september.priceCents)
  })

  it('the billing run for cycle 2026-10-01 prices every residential recurring line at a newly published version', () => {
    const published = publishFourPercent()
    const byId = new Map(published.map(rv => [rv.id, rv]))
    const residential = new Set(st().db.catalog.filter(c => c.lob === 'residential').map(c => c.id))
    expect(st().cycleDate).toBe('2026-10-01')

    const run = st().runCycle()
    const { db } = st()
    const lines = run.chargeIds
      .map(id => db.charges.find(c => c.id === id)!)
      .filter(c => c.lineType === 'recurring' && residential.has(c.catalogId ?? '') && c.period?.start === '2026-10-01')
    expect(lines.length).toBeGreaterThan(0)
    for (const c of lines) {
      const rv = byId.get(c.pricing.rateVersionId ?? '')
      expect(rv, `${c.id} ${c.catalogId} priced at ${c.pricing.rateVersionId}`).toBeDefined()
      const item = db.serviceItems.find(i => i.id === c.source.id)!
      const account = db.accounts.find(a => a.id === c.accountId)!
      const months = account.cycle === 'quarterly' ? 3 : 1
      expect(c.baseCents).toBe(rv!.priceCents * item.qty * months)
    }
  })

  it('every posted invoice\'s total and lines are unchanged by the publish, the run, and the next posting (invariant 1)', () => {
    const snapshot = postedSnapshot()
    const totals = new Map(st().db.invoices.map(i => [i.id, i.totalCents]))
    publishFourPercent()
    expect(postedSnapshot()).toEqual(snapshot)
    const posted = runAndPost()
    expect(posted.length).toBeGreaterThan(0)
    const after = postedSnapshot()
    for (const [id, snap] of snapshot) expect(after.get(id), id).toBe(snap)
    for (const [id, total] of totals) expect(st().db.invoices.find(i => i.id === id)!.totalCents).toBe(total)
  })
})
