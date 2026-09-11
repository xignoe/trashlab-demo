// Pricing's own engine.ts is gone (box 2B.1). These tests pin what the pricing surface relies on from the canonical
// engine (src/store/engine.ts), through its thin layer in lib/engine.ts and lib/preview.ts.
import { beforeEach, describe, expect, it } from 'vitest'
import type { RateVersion } from '../../../types'
import { loadSeed } from '../../../seed'
import { useStore } from '../../../store/useStore'
import { TODAY } from '../../../store/clock'
import { nextChargeId } from '../../../store/engine'
import { FREQUENCY_LABEL, pricingOf, resolveRate } from '../lib/engine'
import { invoiceDateFor, previewInvoice } from '../lib/preview'
import { withDrafts } from '../lib/rateVersions'

const s = () => useStore.getState()
beforeEach(() => s().reset())

describe('resolveRate over the canonical resolvePrice', () => {
  it('a missing zone or account matches no zone row and no contract', () => {
    const db = loadSeed()
    const std: RateVersion = { id: 'rv_t_std_96', catalogId: 'cat_res_96', frequency: 'weekly', priceCents: 2500, effectiveFrom: '2026-01-01', status: 'published', publishedAt: '2025-12-15T09:00:00-05:00' }
    const withStd = { ...db, rateVersions: [...db.rateVersions, std] }
    expect(resolveRate({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', onDate: TODAY }, withStd)).toMatchObject({ priceCents: 2900, ruleWon: 'zoneRate' })
    expect(resolveRate({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_franchise', onDate: TODAY }, withStd)).toEqual({ priceCents: 2500, rateVersionId: 'rv_t_std_96', ruleWon: 'standardRate' })
    expect(resolveRate({ catalogId: 'cat_res_96', frequency: 'weekly', onDate: TODAY }, withStd)).toEqual({ priceCents: 2500, rateVersionId: 'rv_t_std_96', ruleWon: 'standardRate' })
    expect(resolveRate({ catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', onDate: TODAY }, db)).toMatchObject({ priceCents: 22000, ruleWon: 'zoneRate' })
    expect(resolveRate({ catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', accountId: 'acct_bakery', onDate: TODAY }, db)).toEqual({ priceCents: 19800, contractId: 'contract_bakery', ruleWon: 'contractOverride' })
  })

  it('never bills a draft, even one in the db view with an earlier effective date', () => {
    const db = loadSeed()
    const draft: RateVersion = { id: 'rv_pr_t', catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 9999, effectiveFrom: '2026-02-01', status: 'draft' }
    expect(resolveRate({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', onDate: TODAY }, withDrafts(db, [draft])).priceCents).toBe(2900)
  })

  it('pricingOf drops undefined keys and FREQUENCY_LABEL is the canonical wording', () => {
    expect(pricingOf({ priceCents: 1, ruleWon: 'zoneRate', rateVersionId: 'rv_x' })).toEqual({ rateVersionId: 'rv_x', ruleWon: 'zoneRate' })
    expect(FREQUENCY_LABEL).toEqual({ weekly: 'weekly', eow: 'every other week', '2x': '2x weekly', '3x': '3x weekly', '4x': '4x weekly', '5x': '5x weekly', '6x': '6x weekly', onCall: 'on call' })
  })
})

describe('previewInvoice', () => {
  it("prices Maple's next quarterly invoice with the canonical engine: $180.74, fee_env_1 once per month", () => {
    const db = s().db
    const p = previewInvoice({ accountId: 'acct_res_maple', onDate: '2026-10-01', db })
    const mapleSites = new Set(db.sites.filter(x => x.accountId === 'acct_res_maple').map(x => x.id))
    expect(p.lines.map(l => l.source.id).sort()).toEqual(db.serviceItems.filter(si => mapleSites.has(si.siteId)).map(si => si.id).sort())
    expect(p).toMatchObject({ onDate: '2026-10-01', subtotalCents: 15000, feeCents: 1950, taxCents: 1124, totalCents: 18074 })
    expect(p.lines.find(l => l.catalogId === 'cat_res_96')).toMatchObject({ baseCents: 8700, totalCents: 10261, fees: [{ feeRuleId: 'fee_fuel_7pct', cents: 609 }, { feeRuleId: 'fee_env_1', cents: 300 }] })
    expect(s().db).toBe(db)
  })

  it('does not consume the charge ids the next billing run hands out', () => {
    const db = s().db
    const a = nextChargeId(db)
    for (let i = 0; i < 3; i += 1) previewInvoice({ accountId: 'acct_res_maple', onDate: '2026-10-01', db })
    const b = nextChargeId(db)
    const suffix = (id: string) => Number(id.replace(/\D/g, ''))
    expect(suffix(b)).toBe(suffix(a) + 1)
  })

  it("snaps to the account's next billing date: a quarterly account previews its January invoice for a November draft", () => {
    expect(invoiceDateFor({ cycle: 'quarterly' }, '2026-11-01')).toBe('2027-01-01')
    expect(invoiceDateFor({ cycle: 'monthly' }, '2026-09-15')).toBe('2026-10-01')
    expect(invoiceDateFor({ cycle: 'monthly' }, '2026-10-01')).toBe('2026-10-01')
    expect(previewInvoice({ accountId: 'acct_res_maple', onDate: '2026-11-01', db: s().db }).onDate).toBe('2027-01-01')
  })

  it('a suspended account previews to nothing', () => {
    const p = previewInvoice({ accountId: 'acct_res_kerr', onDate: '2026-10-01', db: s().db })
    expect(p.lines).toEqual([])
    expect(p.totalCents).toBe(0)
  })
})
