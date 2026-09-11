import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadSeed } from '../seed'
import type { Charge, RateVersion } from '../types'
import { clearEngineDb, setEngineDb, type Db } from './db'
import {
  appendCharges, applyPosting, feeTotal, generateEventCharges, generateRecurringCharges, nextInvoiceNumber, postInvoices,
  resetChargeIds, setToday, today,
} from './engine'

let db: Db

beforeEach(() => {
  db = loadSeed()
  setEngineDb(() => db)
  resetChargeIds()
  setToday()
})

afterEach(() => {
  clearEngineDb()
  resetChargeIds()
  setToday()
})

function approved(charges: Charge[]): Charge[] {
  return charges.map(c => ({ ...c, status: 'approved' as const }))
}

/** Generate the October cycle plus events, approve everything, commit to the db, and return the charges. */
function stageOctober(): Charge[] {
  const charges = [...generateRecurringCharges({ cycleDate: '2026-10-01' }), ...generateEventCharges()]
  db = appendCharges(db, approved(charges))
  return charges
}

describe('postInvoices', () => {
  it('continues invoice numbers from the highest seeded number: the first posted invoice is INV-2026-0223', () => {
    expect(nextInvoiceNumber(db)).toBe('INV-2026-0223')
    const charges = stageOctober()
    const invoices = postInvoices({ chargeIds: charges.map(c => c.id) })
    const numbers = invoices.map(i => i.number)
    expect(numbers[0]).toBe('INV-2026-0223')
    expect(new Set(numbers).size).toBe(numbers.length)
    // Sequential with no gaps.
    numbers.forEach((n, i) => expect(n).toBe(`INV-2026-${String(223 + i).padStart(4, '0')}`))
    // Addendum C12: runtime invoice ids carry the billing infix; the number keeps the hauler sequence.
    invoices.forEach((inv, i) => expect(inv.id).toBe(`inv_bl_${String(1 + i).padStart(4, '0')}`))
    for (const inv of invoices) expect(db.invoices.some(seeded => seeded.id === inv.id || seeded.number === inv.number)).toBe(false)
  })

  it('Oakridge four charges make one invoice, delivered by email, due 30 days after issue (net30)', () => {
    const charges = stageOctober().filter(c => c.accountId === 'acct_pm_oakridge')
    expect(charges).toHaveLength(4)
    const invoices = postInvoices({ chargeIds: charges.map(c => c.id) })
    expect(invoices).toHaveLength(1)
    const inv = invoices[0]
    expect(inv.accountId).toBe('acct_pm_oakridge')
    expect(inv.chargeIds).toEqual(charges.map(c => c.id))
    expect(inv.subtotalCents).toBe(60000)
    expect(inv.feeCents).toBe(4600)
    expect(inv.taxCents).toBe(0)
    expect(inv.totalCents).toBe(64600)
    expect(inv.issuedAt).toBe('2026-09-10')
    expect(inv.postedAt).toBe('2026-09-10T12:00:00-04:00')
    expect(inv.dueAt).toBe('2026-10-10')
    expect(inv.locked).toBe(true)
    expect(inv.deliveredVia).toBe('email')
  })

  it('monthly and quarterly invoices are due 15 days after issue and use the account delivery method', () => {
    const charges = stageOctober()
    const invoices = postInvoices({ chargeIds: charges.map(c => c.id) })
    const maple = invoices.find(i => i.accountId === 'acct_res_maple')!
    expect(maple.dueAt).toBe('2026-09-25')
    expect(maple.deliveredVia).toBe('mail')
    const bakery = invoices.find(i => i.accountId === 'acct_bakery')!
    expect(bakery.dueAt).toBe('2026-09-25')
    expect(bakery.deliveredVia).toBe('email')
  })

  it('groups by account: one invoice per account with a charge, charges from several runs land together', () => {
    const charges = stageOctober()
    const invoices = postInvoices({ chargeIds: charges.map(c => c.id) })
    const accounts = new Set(charges.map(c => c.accountId))
    expect(invoices).toHaveLength(accounts.size)
    // Maple gets three recurring lines and the extra bags event on one invoice.
    const maple = invoices.find(i => i.accountId === 'acct_res_maple')!
    expect(maple.chargeIds).toHaveLength(4)
    // Hale has no recurring lines but gets a dry run and two overages.
    const hale = invoices.find(i => i.accountId === 'acct_contractor_hale')!
    expect(hale.chargeIds).toHaveLength(3)
    expect(hale.dueAt).toBe('2026-10-10')
  })

  it('totals equal the sum of charge parts on every invoice', () => {
    const charges = stageOctober()
    const invoices = postInvoices({ chargeIds: charges.map(c => c.id) })
    for (const inv of invoices) {
      const lines = inv.chargeIds.map(id => charges.find(c => c.id === id)!)
      const subtotal = lines.reduce((s, c) => s + c.baseCents, 0)
      const fees = lines.reduce((s, c) => s + feeTotal(c), 0)
      const tax = lines.reduce((s, c) => s + c.taxCents, 0)
      expect(inv.subtotalCents).toBe(subtotal)
      expect(inv.feeCents).toBe(fees)
      expect(inv.taxCents).toBe(tax)
      expect(inv.totalCents).toBe(subtotal + fees + tax)
      expect(inv.totalCents).toBe(lines.reduce((s, c) => s + c.totalCents, 0))
    }
  })

  it('a waived charge cannot be posted', () => {
    const charges = stageOctober()
    const maple = charges.find(c => c.source.id === 'evt_maple_extrabags')!
    db = appendCharges(db, [{ ...maple, status: 'waived' }])
    expect(() => postInvoices({ chargeIds: [maple.id] })).toThrow(/waived/)
    // And it poisons the whole batch: nothing posts when one id is bad.
    expect(() => postInvoices({ chargeIds: charges.map(c => c.id) })).toThrow(/waived/)
  })

  it('a proposed charge cannot be posted; a person approves first', () => {
    const charges = generateRecurringCharges({ cycleDate: '2026-10-01' })
    db = appendCharges(db, charges)
    expect(() => postInvoices({ chargeIds: [charges[0].id] })).toThrow(/proposed/)
  })

  it('a charge already on a locked invoice cannot be posted again, and an unknown id throws', () => {
    const seeded = db.charges.find(c => c.id === 'chg_oak_2026_08_1')!
    seeded.status = 'approved'
    expect(() => postInvoices({ chargeIds: ['chg_oak_2026_08_1'] })).toThrow(/INV-2026-0210/)
    expect(() => postInvoices({ chargeIds: ['chg_nope'] })).toThrow(/unknown charge/)
  })

  it('an empty list posts nothing and duplicate ids are collapsed', () => {
    expect(postInvoices({ chargeIds: [] })).toEqual([])
    const charges = stageOctober().filter(c => c.accountId === 'acct_res_holt')
    const invoices = postInvoices({ chargeIds: [charges[0].id, charges[0].id] })
    expect(invoices).toHaveLength(1)
    expect(invoices[0].chargeIds).toEqual([charges[0].id])
  })

  it('postInvoices does not mutate the db; applyPosting returns a new db with invoices appended and charges posted', () => {
    const charges = stageOctober()
    const before = JSON.stringify(db)
    const invoices = postInvoices({ chargeIds: charges.map(c => c.id) })
    expect(JSON.stringify(db)).toBe(before)

    const next = applyPosting(db, invoices)
    expect(next).not.toBe(db)
    expect(next.invoices).toHaveLength(db.invoices.length + invoices.length)
    const posted = new Set(charges.map(c => c.id))
    for (const c of next.charges) {
      if (posted.has(c.id)) expect(c.status).toBe('posted')
    }
    // Untouched rows are shared, the original db still shows approved.
    expect(db.charges.find(c => c.id === charges[0].id)!.status).toBe('approved')
    expect(next.charges.find(c => c.id === 'chg_oak_2026_08_1')).toBe(db.charges.find(c => c.id === 'chg_oak_2026_08_1'))
  })

  it('posting twice is refused: after applyPosting the same ids are on a locked invoice', () => {
    const charges = stageOctober()
    db = applyPosting(db, postInvoices({ chargeIds: charges.map(c => c.id) }))
    expect(() => postInvoices({ chargeIds: [charges[0].id] })).toThrow(/posted/)
  })

  it('issuedAt follows the engine clock', () => {
    setToday('2026-10-01')
    expect(today()).toBe('2026-10-01')
    const charges = stageOctober().filter(c => c.accountId === 'acct_pm_oakridge')
    const [inv] = postInvoices({ chargeIds: charges.map(c => c.id) })
    expect(inv.issuedAt).toBe('2026-10-01')
    expect(inv.dueAt).toBe('2026-10-31')
  })
})

describe('invariant 1: publishing a RateVersion never changes a posted Invoice', () => {
  it('a new cat_res_96 rate leaves the posted October invoice and its charges byte for byte unchanged, while the November run uses the new price', () => {
    const charges = stageOctober()
    const invoices = postInvoices({ chargeIds: charges.map(c => c.id) })
    db = applyPosting(db, invoices)

    const invoice = db.invoices.find(i => i.accountId === 'acct_res_001' && i.number >= 'INV-2026-0223')!
    const invoiceBefore = JSON.stringify(invoice)
    const chargesBefore = JSON.stringify(invoice.chargeIds.map(id => db.charges.find(c => c.id === id)))
    expect(db.charges.find(c => c.id === invoice.chargeIds[0])!.baseCents).toBe(2900)
    expect(invoice.totalCents).toBe(3420)

    const published: RateVersion = {
      id: 'rv_res_96_2026q4', catalogId: 'cat_res_96', zoneId: 'zone_open', frequency: 'weekly', priceCents: 3100,
      effectiveFrom: '2026-11-01', status: 'published', publishedAt: '2026-09-10T15:00:00-04:00', supersedesId: 'rv_res_96_2026',
    }
    db = { ...db, rateVersions: [...db.rateVersions, published] }

    const invoiceAfter = db.invoices.find(i => i.id === invoice.id)!
    expect(JSON.stringify(invoiceAfter)).toBe(invoiceBefore)
    expect(JSON.stringify(invoiceAfter.chargeIds.map(id => db.charges.find(c => c.id === id)))).toBe(chargesBefore)
    expect(invoiceAfter.locked).toBe(true)

    const november = generateRecurringCharges({ cycleDate: '2026-11-01' })
    const res001 = november.find(c => c.source.id === 'si_res_001_main')!
    expect(res001.baseCents).toBe(3100)
    expect(res001.pricing).toEqual({ ruleWon: 'zoneRate', rateVersionId: 'rv_res_96_2026q4' })
    expect(res001.totalCents).toBe(3100 + 217 + 100 + Math.round((3100 + 217) * 0.07))

    // A re-run of October after the publish still yields nothing (posted) and the invoice is still 2900 based.
    expect(generateRecurringCharges({ cycleDate: '2026-10-01' })).toHaveLength(0)
    expect(db.charges.find(c => c.id === invoice.chargeIds[0])!.baseCents).toBe(2900)
  })
})
