/**
 * Charging by a zone drawn on the map (DECISIONS.md entries 69 and 73). The seeded East county surcharge is an
 * adjustment with the condition Zone is East county; it starts with the Jan 1, 2027 cycle, so no October figure moves.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../../../store/useStore'
import { feeRuleMiss, feeScopeFor, geoZoneFor, lineDims } from '../../../store/engine'

const db = () => useStore.getState().db

beforeEach(() => {
  useStore.getState().reset()
})

/** The scope billing matches a residential recurring line at a site against, on a day. */
function scopeAt(siteId: string, day: string, contractPriced = false) {
  const site = db().sites.find(s => s.id === siteId)!
  const dims = lineDims({ siteId, onDate: day, lineType: 'recurring' }, db())
  return feeScopeFor(site, 'recurring', day, 'residential', contractPriced, dims)
}

describe('East county surcharge', () => {
  it('is $3.00 a month on lines inside the drawn East county zone, from 2027-01-01', () => {
    const rule = db().feeRules.find(r => r.id === 'fee_zone_east_county')!
    expect(rule).toMatchObject({
      kind: 'flat', value: 300, appliesTo: ['recurring'], effectiveFrom: '2027-01-01', exemptContracts: true,
      when: { geoZone: ['gz_east_county'], lob: ['residential', 'frontload'] },
    })

    // The zone holds 9 seeded sites; the rest of the map holds the others.
    const inZone = db().sites.filter(s => geoZoneFor(s, db()) === 'gz_east_county')
    expect(inZone).toHaveLength(9)
    const inside = inZone[0]
    const outside = db().sites.find(s => s.lat !== undefined && s.lng !== undefined && geoZoneFor(s, db()) !== 'gz_east_county')!

    // In force for East county lines from the Jan 1, 2027 cycle; October is untouched.
    expect(feeRuleMiss(rule, scopeAt(inside.id, '2027-01-15'))).toBeNull()
    expect(feeRuleMiss(rule, scopeAt(inside.id, '2026-10-01'))).toBe('starts 2027-01-01')
    // Outside the drawn zone, or priced by a contract, it does not apply.
    expect(feeRuleMiss(rule, scopeAt(outside.id, '2027-01-15'))).toMatch(/^not this /)
    expect(feeRuleMiss(rule, scopeAt(inside.id, '2027-01-15', true))).toBe('contract price is all in')
  })

  it('is a use of the East county zone, so the zone cannot be deleted while the surcharge names it', () => {
    expect(() => useStore.getState().deleteGeoZone({ id: 'gz_east_county' })).toThrow()
    expect(db().geoZones?.some(z => z.id === 'gz_east_county')).toBe(true)
  })
})
