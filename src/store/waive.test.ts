import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadSeed } from '../seed'
import type { Charge } from '../types'
import { clearEngineDb, setEngineDb, type Db } from './db'
import { appendCharges, applyPosting, generateEventCharges, generateRecurringCharges, postInvoices, resetChargeIds } from './engine'
import { applyWaive, waiveCharge, waivesForAccount } from './waive'

let db: Db

beforeEach(() => {
  db = loadSeed()
  setEngineDb(() => db)
  resetChargeIds()
})

afterEach(() => {
  clearEngineDb()
  resetChargeIds()
})

function approved(charges: Charge[]): Charge[] {
  return charges.map(c => ({ ...c, status: 'approved' as const }))
}

describe('waiveCharge', () => {
  it('sets the charge status to waived and returns a WaivedCharge with reason, note, by, and at', () => {
    const events = generateEventCharges()
    db = appendCharges(db, events)
    const maple = events.find(c => c.source.id === 'evt_maple_extrabags')!
    const result = waiveCharge({ chargeId: maple.id, reason: 'goodwill', note: 'Long tenure, first extra bags', by: 'M. Alvarez', at: '2026-10-01T09:30:00-04:00' })
    expect(result.charge.status).toBe('waived')
    expect(result.charge.id).toBe(maple.id)
    expect(result.waivedCharge).toEqual({ chargeId: maple.id, reason: 'goodwill', note: 'Long tenure, first extra bags', by: 'M. Alvarez', at: '2026-10-01T09:30:00-04:00' })
    // Pure: the db row is untouched until applyWaive.
    expect(db.charges.find(c => c.id === maple.id)!.status).toBe('proposed')
    expect(db.waivedCharges).toHaveLength(6)

    db = applyWaive(db, result)
    expect(db.charges.find(c => c.id === maple.id)!.status).toBe('waived')
    expect(db.waivedCharges).toHaveLength(7)
    expect(db.waivedCharges.at(-1)).toEqual(result.waivedCharge)
  })

  it('defaults at to today and drops an empty note', () => {
    const events = generateEventCharges()
    db = appendCharges(db, events)
    const result = waiveCharge({ chargeId: events[0].id, reason: 'immaterial', note: '   ', by: 'M. Alvarez' })
    expect(result.waivedCharge.at.startsWith('2026-09-10')).toBe(true)
    expect(result.waivedCharge.note).toBeUndefined()
  })

  it('an approved charge can still be waived; a posted or already waived one cannot', () => {
    const events = generateEventCharges()
    db = appendCharges(db, approved(events))
    const first = waiveCharge({ chargeId: events[0].id, reason: 'operationalFault', by: 'M. Alvarez' })
    db = applyWaive(db, first)
    expect(() => waiveCharge({ chargeId: events[0].id, reason: 'goodwill', by: 'M. Alvarez' })).toThrow(/already waived/)
    expect(() => waiveCharge({ chargeId: 'chg_oak_2026_08_1', reason: 'goodwill', by: 'M. Alvarez' })).toThrow(/posted/)
    expect(() => waiveCharge({ chargeId: 'chg_nope', reason: 'goodwill', by: 'M. Alvarez' })).toThrow(/unknown charge/)
    expect(() => waiveCharge({ chargeId: events[1].id, reason: 'goodwill', by: '  ' })).toThrow(/name of the person/)
    expect(() => waiveCharge({ chargeId: events[1].id, reason: 'because' as never, by: 'M. Alvarez' })).toThrow(/Unknown waive reason/)
  })

  it('waivesForAccount joins the audit rows to the account through the charge', () => {
    expect(waivesForAccount(db, 'acct_res_008').map(w => w.waived.chargeId)).toEqual(['chg_waived_res008_0825'])
    expect(waivesForAccount(db, 'acct_res_maple')).toHaveLength(0)
  })
})

describe('invariant 5: WaivedCharge rows are never deleted', () => {
  it('after waiving, re-running generation, and posting, the WaivedCharge row is still present and the waived charge is on no invoice', () => {
    const october = [...generateRecurringCharges({ cycleDate: '2026-10-01' }), ...generateEventCharges()]
    db = appendCharges(db, october)
    const maple = october.find(c => c.source.id === 'evt_maple_extrabags')!

    const waived = waiveCharge({ chargeId: maple.id, reason: 'goodwill', note: 'Demo waive', by: 'M. Alvarez' })
    db = applyWaive(db, waived)
    const auditRowsBefore = db.waivedCharges.length

    // Re-run generation: the waived event is not re-proposed, recurring lines are unchanged in count.
    const rerunEvents = generateEventCharges()
    expect(rerunEvents.find(c => c.source.id === 'evt_maple_extrabags')).toBeUndefined()
    expect(rerunEvents).toHaveLength(0)

    // Approve everything that is still proposed and post it.
    const toPost = db.charges.filter(c => october.some(o => o.id === c.id) && c.status === 'proposed')
    db = appendCharges(db, approved(toPost))
    const invoices = postInvoices({ chargeIds: toPost.map(c => c.id) })
    db = applyPosting(db, invoices)

    expect(db.waivedCharges).toHaveLength(auditRowsBefore)
    expect(db.waivedCharges.some(w => w.chargeId === maple.id)).toBe(true)
    expect(db.charges.find(c => c.id === maple.id)!.status).toBe('waived')
    expect(db.invoices.some(inv => inv.chargeIds.includes(maple.id))).toBe(false)
    // Maple's invoice still went out with the three recurring lines.
    const mapleInvoice = db.invoices.find(inv => inv.accountId === 'acct_res_maple' && inv.number >= 'INV-2026-0223')!
    expect(mapleInvoice.chargeIds).toHaveLength(3)
    // The six historical audit rows are intact too.
    for (const id of ['chg_waived_res012_0324', 'chg_waived_bakery_0325', 'chg_waived_res021_0622', 'chg_waived_fl005_0617', 'chg_waived_res008_0825', 'chg_waived_fl003_0826']) {
      expect(db.waivedCharges.some(w => w.chargeId === id)).toBe(true)
    }
  })

  it('applyWaive only ever appends to waivedCharges', () => {
    const events = generateEventCharges()
    db = appendCharges(db, events)
    let count = db.waivedCharges.length
    for (const c of events) {
      db = applyWaive(db, waiveCharge({ chargeId: c.id, reason: 'immaterial', by: 'M. Alvarez' }))
      expect(db.waivedCharges).toHaveLength(++count)
    }
  })

  it('no function in src/store removes a WaivedCharge (static scan of the store sources)', () => {
    const dir = __dirname
    const sources = readdirSync(dir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    expect(sources.length).toBeGreaterThan(0)
    // emptyDb() in db.ts builds an empty table, which is construction, not removal, so `waivedCharges: []` is allowed.
    const removalPatterns = [
      /waivedCharges\s*\.\s*(splice|pop|shift|filter|length\s*=)/,
      /waivedCharges\s*:\s*[^,\n]*\.filter\(/,
      /delete\s+[a-zA-Z_.]*waivedCharges/,
    ]
    for (const file of sources) {
      const text = readFileSync(join(dir, file), 'utf8')
      for (const pattern of removalPatterns) {
        expect(pattern.test(text), `${file} matches ${pattern}`).toBe(false)
      }
    }
  })
})
