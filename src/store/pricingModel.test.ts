import { describe, expect, it } from 'vitest'
import { loadSeed } from '../seed'
import type { FeeRule, RateVersion } from '../types'
import {
  computeCharge, dayOfWeekOf, generateEventCharges, lineDims, resolvePrice, roundTons, rolloffOverage, rolloffTermsFor, taxRulesFor, whenMiss,
} from './engine'

// The configurable pricing model (DECISIONS.md entries 64 and 65): dimension rates, input context, conditional
// adjustments, stack groups, tax conditions, and roll-off material terms. Every call uses the trailing db form.

const published = (rv: Omit<RateVersion, 'status' | 'publishedAt'>): RateVersion => ({ ...rv, status: 'published', publishedAt: '2026-01-01T09:00:00-05:00' })

describe('rates keyed by dimensions', () => {
  it('a rate keyed by customer tier wins for an account with that tier and for nobody else', () => {
    const db = loadSeed()
    db.rateVersions.push(published({ id: 'rv_t_vip', catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 2500, effectiveFrom: '2026-01-01', dims: { customerTier: 'vip' } }))
    const vip = resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_021', onDate: '2026-09-10' }, db)
    expect(vip).toEqual({ priceCents: 2500, rateVersionId: 'rv_t_vip', ruleWon: 'zoneRate', dims: { customerTier: 'vip' } })
    const standard = resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_001', onDate: '2026-09-10' }, db)
    expect(standard).toEqual({ priceCents: 2900, rateVersionId: 'rv_res_96_2026', ruleWon: 'zoneRate' })
  })

  it('a dimension rate not yet in force falls back to the less specific rate, and a draft never bills', () => {
    const db = loadSeed()
    db.rateVersions.push(published({ id: 'rv_t_later', catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 2400, effectiveFrom: '2026-12-01', dims: { customerTier: 'vip' } }))
    db.rateVersions.push({ id: 'rv_t_draft', catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 1, effectiveFrom: '2026-01-01', status: 'draft', dims: { customerTier: 'vip' } })
    expect(resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_021', onDate: '2026-09-10' }, db).rateVersionId).toBe('rv_res_96_2026')
    expect(resolvePrice({ catalogId: 'cat_res_96', frequency: 'weekly', zoneId: 'zone_open', accountId: 'acct_res_021', onDate: '2026-12-01' }, db).rateVersionId).toBe('rv_t_later')
  })

  it('an input dimension is read from the context and billing sees its default', () => {
    const db = loadSeed()
    db.rateVersions.push(published({ id: 'rv_t_sameday', catalogId: 'cat_ro_20yd', zoneId: 'zone_open', frequency: 'onCall', priceCents: 69500, effectiveFrom: '2026-01-01', dims: { serviceSpeed: 'sameDay' } }))
    const input = { catalogId: 'cat_ro_20yd', frequency: 'onCall' as const, zoneId: 'zone_open', accountId: 'acct_contractor_hale', onDate: '2026-09-10' }
    expect(resolvePrice(input, db).priceCents).toBe(57500)
    expect(resolvePrice({ ...input, context: { serviceSpeed: 'sameDay' } }, db).priceCents).toBe(69500)
  })

  it('lineDims reads the line, the account and site assignments, defaults, and the route day for recurring lines', () => {
    const db = loadSeed()
    const dims = lineDims({ accountId: 'acct_res_012', siteId: 'site_res_012', catalogId: 'cat_res_96', frequency: 'weekly', onDate: '2026-09-12', lineType: 'recurring' }, db)
    expect(dims).toMatchObject({ zone: 'zone_open', frequency: 'weekly', service: 'cat_res_96', category: 'sc_res_carts', lob: 'residential', customerTier: 'standard', access: 'walkOut', serviceSpeed: 'standard', dayOfWeek: 'tue' })
    expect(lineDims({ siteId: 'site_res_012', onDate: '2026-09-12', lineType: 'event' }, db).dayOfWeek).toBe('sat')
    expect(dayOfWeekOf('2026-09-10')).toBe('thu')
  })
})

describe('conditional adjustments', () => {
  const quarter = { start: '2027-01-01', end: '2027-03-31' }
  const line = (accountId: string, siteId: string, period = quarter) => ({
    id: 'chg_t_1', accountId, siteId, lineType: 'recurring' as const, catalogId: 'cat_res_96', frequency: 'weekly' as const, baseCents: 8700,
    period, source: { type: 'manual' as const, id: 't' }, pricing: { ruleWon: 'zoneRate' as const },
  })
  const feesOf = (fees: { feeRuleId: string; cents: number }[]) => Object.fromEntries(fees.map(f => [f.feeRuleId, f.cents]))

  it('a VIP at a remote site gets the tier discount and the remote surcharge from Jan 1, 2027, and neither before', () => {
    const db = loadSeed()
    expect(feesOf(computeCharge(line('acct_res_021', 'site_res_021'), db).fees)).toEqual({ fee_fuel_7pct: 609, fee_env_1: 300, fee_loc_remote: 870, fee_tier_vip: -870 })
    const october = computeCharge(line('acct_res_021', 'site_res_021', { start: '2026-10-01', end: '2026-12-31' }), db)
    expect(feesOf(october.fees)).toEqual({ fee_fuel_7pct: 609, fee_env_1: 300 })
  })

  it('a stack group keeps only the largest rule, and a paused rule never applies', () => {
    const db = loadSeed()
    const loyalty: FeeRule = {
      id: 'fee_t_loyal', name: 'Loyalty', kind: 'percent', value: -5, base: 'serviceLines', appliesTo: ['recurring'], taxable: true,
      when: { customerTier: ['vip'] }, stackGroup: 'customerDiscount',
    }
    db.feeRules.push(loyalty)
    const fees = feesOf(computeCharge(line('acct_res_021', 'site_res_021'), db).fees)
    expect(fees.fee_tier_vip).toBe(-870)
    expect(fees.fee_t_loyal).toBeUndefined()
    db.feeRules = db.feeRules.map(r => (r.id === 'fee_tier_vip' ? { ...r, status: 'paused' as const } : r))
    expect(feesOf(computeCharge(line('acct_res_021', 'site_res_021'), db).fees).fee_t_loyal).toBe(-435)
  })

  it('the quarterly prepay discount is paused, and a contract-priced line skips rules marked exemptContracts', () => {
    const db = loadSeed()
    const fees = feesOf(computeCharge({ ...line('acct_res_021', 'site_res_021'), pricing: { ruleWon: 'contractOverride', contractId: 'c' } }, db).fees)
    expect(fees).toEqual({ fee_fuel_7pct: 609, fee_env_1: 300 })
  })

  it('a rush rule applies only when the quote says so', () => {
    const db = loadSeed()
    const haul = {
      id: 'chg_t_haul', accountId: 'acct_contractor_hale', siteId: 'site_hale_a', lineType: 'event' as const, catalogId: 'cat_ro_20yd', frequency: 'onCall' as const,
      baseCents: 57500, servicedOn: '2026-09-10', source: { type: 'manual' as const, id: 't' }, pricing: { ruleWon: 'zoneRate' as const },
    }
    expect(feesOf(computeCharge(haul, db).fees)).toEqual({ fee_fuel_7pct: 4025 })
    expect(feesOf(computeCharge({ ...haul, context: { serviceSpeed: 'sameDay' } }, db).fees)).toEqual({ fee_fuel_7pct: 4025, fee_speed_sameday: 28750 })
  })

  it('tax layers honor when conditions', () => {
    const db = loadSeed()
    db.taxRules.push({ id: 'tax_t_ro', zoneId: 'zone_open', ratePct: 1, appliesTo: ['event'], when: { lob: ['rolloff'] } })
    expect(taxRulesFor('zone_open', 'event', '2026-09-10', { lob: 'rolloff' }, db).map(t => t.id)).toEqual(['tax_zone_open', 'tax_t_ro'])
    expect(taxRulesFor('zone_open', 'event', '2026-09-10', { lob: 'frontload' }, db).map(t => t.id)).toEqual(['tax_zone_open'])
    expect(whenMiss({ lob: ['rolloff'], zone: [] }, { lob: 'frontload' })).toBe('lob')
  })
})

describe('roll-off terms', () => {
  it('rounds tons up to the policy increment', () => {
    expect(roundTons(4.23, 'exact')).toBe(4.23)
    expect(roundTons(4.23, 'tenth')).toBe(4.3)
    expect(roundTons(4.23, 'quarter')).toBe(4.25)
    expect(roundTons(4.23, 'half')).toBe(4.5)
    expect(roundTons(4.23, 'whole')).toBe(5)
  })

  it('a roofing ticket bills on its matrix cell with the heavy tier, and a C&D ticket on the catalog as before', () => {
    const db = loadSeed()
    const roofing = rolloffTermsFor({ catalogId: 'cat_ro_20yd', ticketMaterial: 'Roofing', onDate: '2026-09-09' }, db)!
    expect(roofing).toMatchObject({ source: 'matrix', materialId: 'mat_roofing', includedTons: 5, overageCentsPerTon: 6500 })
    // 9 t is 4 t over 5 t: 2 t at $65 and 2 t past the tier at $85.
    expect(rolloffOverage(18000, roofing).cents).toBe(30000)
    db.scaleTickets.push({ id: 'ticket_t_roof', workOrderId: 'wo_hale_haul_1', containerId: 'box_2001', facility: 'Piedmont Transfer Station', material: 'Roofing', grossLbs: 40000, tareLbs: 22000, netLbs: 18000, ticketedAt: '2026-09-09T10:00:00-04:00' })
    const charges = generateEventCharges(db)
    const roof = charges.find(c => c.source.id === 'ticket_t_roof')!
    expect(roof.baseCents).toBe(30000)
    expect(roof.description).toBe('Overage 4.00 t over 5 t cap, Roofing shingles')
    expect(charges.find(c => c.source.id === 'ticket_hale_1')?.description).toBe('Overage 1.20 t over 3 t cap')
  })

  it('grace days push extra days back', () => {
    const db = loadSeed()
    const extra = (d: typeof db) => generateEventCharges(d).find(c => c.accountId === 'acct_ro_homeowner' && c.description.startsWith('Extra days'))
    const before = extra(db)!
    db.catalog = db.catalog.map(c => (c.id === 'cat_ro_20yd' ? { ...c, rolloff: { ...c.rolloff!, graceDays: 2 } } : c))
    const after = extra(db)!
    expect(after.baseCents).toBe(before.baseCents - 2 * 700)
  })
})
