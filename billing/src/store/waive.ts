/**
 * Waiving a charge (invariant 5: WaivedCharge rows are never deleted).
 *
 * waiveCharge() is pure like the engine: it reads the bound db, validates, and returns the new rows.
 * applyWaive() commits them to a Db copy. Nothing in src/store removes a WaivedCharge; waive.test.ts
 * scans the store sources to keep it that way.
 */
import type { Charge, WaivedCharge } from '../types'
import { getEngineDb, type Db } from './db'
import { stamp } from './clock'

export interface WaiveInput {
  chargeId: string
  reason: WaivedCharge['reason']
  note?: string
  by: string
  /** ISO timestamp. Defaults to stamp(): the engine's day at noon Eastern, so cycle boundary math is stable. */
  at?: string
}

export interface WaiveResult {
  /** The charge with status waived (a new object, the db row is untouched). */
  charge: Charge
  /** The audit row to append to db.waivedCharges. */
  waivedCharge: WaivedCharge
}

export const WAIVE_REASONS: WaivedCharge['reason'][] = ['goodwill', 'salesPromise', 'insufficientEvidence', 'operationalFault', 'immaterial']

/**
 * Sets the charge status to waived and creates the WaivedCharge audit row. Throws for an unknown charge,
 * a posted charge (corrections after posting are CreditMemos), or a charge that is already waived.
 */
export function waiveCharge(input: WaiveInput): WaiveResult {
  const db = getEngineDb()
  const charge = db.charges.find(c => c.id === input.chargeId)
  if (!charge) throw new Error(`Cannot waive: unknown charge ${input.chargeId}`)
  if (charge.status === 'posted') throw new Error(`Cannot waive ${charge.id}: it is posted, issue a credit memo instead`)
  if (charge.status === 'waived') throw new Error(`Cannot waive ${charge.id}: it is already waived`)
  if (!WAIVE_REASONS.includes(input.reason)) throw new Error(`Unknown waive reason ${String(input.reason)}`)
  if (!input.by.trim()) throw new Error('A waive needs the name of the person who approved it')

  const waivedCharge: WaivedCharge = {
    chargeId: charge.id,
    reason: input.reason,
    by: input.by,
    at: input.at ?? stamp(),
  }
  if (input.note !== undefined && input.note.trim() !== '') waivedCharge.note = input.note.trim()

  return { charge: { ...charge, status: 'waived' }, waivedCharge }
}

/** Commit a waive: returns a new Db with the charge replaced and the WaivedCharge appended. Never removes a row. */
export function applyWaive(db: Db, result: WaiveResult): Db {
  return {
    ...db,
    charges: db.charges.map(c => (c.id === result.charge.id ? result.charge : c)),
    waivedCharges: [...db.waivedCharges, result.waivedCharge],
  }
}

/** Every WaivedCharge on an account, joined through its charge. */
export function waivesForAccount(db: Db, accountId: string): { waived: WaivedCharge; charge: Charge }[] {
  const out: { waived: WaivedCharge; charge: Charge }[] = []
  for (const waived of db.waivedCharges) {
    const charge = db.charges.find(c => c.id === waived.chargeId)
    if (charge && charge.accountId === accountId) out.push({ waived, charge })
  }
  return out
}
