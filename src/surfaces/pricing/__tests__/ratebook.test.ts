// Moved from pricing/src/lib/ratebook.test.ts: the Ratebook's read-side selectors, money, and dates, on billing's
// merged seed.
import { describe, expect, it } from 'vitest'
import type { RateVersion } from '../../../types'
import { loadSeed } from '../../../seed'
import { TODAY } from '../../../store/clock'
import { catalogGroups, feeRuleSentence, lobDrafts, taxRuleSentence, versionHistory } from '../lib/ratebook'
import { withDrafts } from '../lib/rateVersions'
import { dollarsToCents, formatCents, formatCentsCompact } from '../lib/money'
import { addMonths, firstOfNextMonth, within } from '../lib/dates'

const db = () => loadSeed()
const rv = (d: ReturnType<typeof db>, catalogId: string, zoneId: string, effectiveFrom: string) =>
  d.rateVersions.find(r => r.catalogId === catalogId && r.zoneId === zoneId && r.effectiveFrom === effectiveFrom)!

describe('money', () => {
  it('formats integer cents', () => {
    expect(formatCents(2900)).toBe('$29.00')
    expect(formatCents(203)).toBe('$2.03')
    expect(formatCents(123456)).toBe('$1,234.56')
    expect(formatCents(-150)).toBe('-$1.50')
    expect(formatCentsCompact(26400)).toBe('$264')
    expect(formatCentsCompact(123450)).toBe('$1,234.50')
  })

  it('dollarsToCents stores integer cents and rejects anything that is not a dollar amount', () => {
    expect(dollarsToCents('29.99')).toBe(2999)
    expect(dollarsToCents('$1,234.5')).toBe(123450)
    expect(dollarsToCents('30')).toBe(3000)
    expect(dollarsToCents('abc')).toBeNull()
    expect(dollarsToCents('1.234')).toBeNull()
    expect(dollarsToCents('')).toBeNull()
  })
})

describe('dates', () => {
  it('firstOfNextMonth rolls over the year; addMonths clamps; within is inclusive', () => {
    expect(firstOfNextMonth('2026-09-10')).toBe('2026-10-01')
    expect(firstOfNextMonth('2026-12-31')).toBe('2027-01-01')
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(within('2026-12-31', '2026-01-01', '2026-12-31')).toBe(true)
    expect(within('2027-01-01', '2026-01-01', '2026-12-31')).toBe(false)
  })
})

describe('catalogGroups', () => {
  it('lists one line per (zone, frequency) with the version the canonical resolvePrice picks today', () => {
    const d = db()
    const groups = catalogGroups(d, 'residential', TODAY)
    expect(groups.map(g => g.item.id)).toEqual(['cat_res_96', 'cat_res_64', 'cat_res_extra_cart', 'cat_res_recycling'])
    const res96 = groups[0].lines
    expect(res96.map(l => `${l.zoneId}/${l.frequency}`)).toEqual(['zone_open/weekly', 'zone_boundary/weekly'])
    expect(res96[0]).toMatchObject({ effectiveToday: true, ruleWon: 'zoneRate', versionCount: 1, drafts: [], scheduled: [] })
    expect(res96[0].current).toBe(rv(d, 'cat_res_96', 'zone_open', '2026-01-01'))
    expect(res96[0].current?.priceCents).toBe(2900)
  })

  it('shows a version published for a future date as scheduled beside the price in force', () => {
    const d = db()
    const res64 = catalogGroups(d, 'residential', TODAY)[1].lines[0]
    expect(res64.current).toBe(rv(d, 'cat_res_64', 'zone_open', '2026-01-01'))
    expect(res64.scheduled).toEqual([rv(d, 'cat_res_64', 'zone_open', '2026-10-01')])
    expect(res64.versionCount).toBe(2)
  })

  it('shows drafts beside the published version when the view includes them', () => {
    const d = db()
    const published = rv(d, 'cat_fl_3yd', 'zone_open', '2026-01-01')
    const draft: RateVersion = { id: 'rv_pr_fl_3yd_open_2x_20261001', catalogId: 'cat_fl_3yd', zoneId: 'zone_open', frequency: '2x', priceCents: 22880, effectiveFrom: '2026-10-01', status: 'draft', supersedesId: published.id }
    const line = catalogGroups(withDrafts(d, [draft]), 'frontload', TODAY).find(g => g.item.id === 'cat_fl_3yd')!.lines[0]
    expect(line).toMatchObject({ zoneId: 'zone_open', frequency: '2x', ruleWon: 'zoneRate' })
    expect(line.current).toBe(published)
    expect(line.drafts).toEqual([draft])
    expect(lobDrafts(withDrafts(d, [draft]), 'frontload')).toEqual([{ draft, item: d.catalog.find(c => c.id === 'cat_fl_3yd'), supersedes: published }])
    expect(lobDrafts(withDrafts(d, [draft]), 'residential')).toEqual([])
  })
})

describe('versionHistory', () => {
  it('is newest first with a superseded-by back link and marks the version in force today', () => {
    const d = db()
    const rows = versionHistory(d, { catalogId: 'cat_res_64', zoneId: 'zone_open', frequency: 'weekly' }, TODAY)
    const q4 = rv(d, 'cat_res_64', 'zone_open', '2026-10-01')
    const now = rv(d, 'cat_res_64', 'zone_open', '2026-01-01')
    expect(rows.map(r => r.version)).toEqual([q4, now])
    expect(rows[0]).toMatchObject({ isCurrent: false })
    expect(rows[0].version.supersedesId).toBe(now.id)
    expect(rows[1]).toMatchObject({ isCurrent: true, supersededBy: q4.id })
  })
})

describe('rule sentences', () => {
  it('spell out base, appliesTo, and taxability', () => {
    const d = db()
    expect(feeRuleSentence(d.feeRules.find(r => r.id === 'fee_fuel_7pct')!)).toBe('Fuel surcharge: 7% of service lines, applies to recurring and event, taxable')
    expect(feeRuleSentence(d.feeRules.find(r => r.id === 'fee_env_1')!)).toBe('Environmental fee: $1.00 flat per line, applies to recurring, not taxable')
    expect(taxRuleSentence(d.taxRules.find(t => t.zoneId === 'zone_open')!)).toMatch(/^zone_open: 7% on .+\. Never on late fees$/)
  })
})
