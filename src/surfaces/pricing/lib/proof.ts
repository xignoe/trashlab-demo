/**
 * The history proof shown after a publish (pricing's HistoryProof, owner fear "rate edits rewriting history"). The
 * prototype watched a fixed invoice, inv_res_maple_0001, which billing's seed does not have. Here the invoice is
 * chosen from what the publish superseded, so no invoice or rate version id is hard-coded: the latest posted,
 * locked invoice with a line priced by a version this publish superseded, preferring the representative accounts
 * in the publish preview's order. Its totals are snapshotted at publish time and compared with the live row after.
 */
import type { Invoice } from '../../../types'
import type { Db } from '../../../store/db'
import { REPRESENTATIVE_ACCOUNT_IDS } from './preview'

export interface PublishProof {
  invoiceId: string
  /** The invoice's totalCents the moment before the publish was written. */
  totalCents: number
  /** Each charge's totalCents and rate version the moment before the publish was written. */
  charges: { id: string; totalCents: number; rateVersionId?: string }[]
  /** Why this invoice was chosen, for the card's caption. */
  basis: 'superseded' | 'representative'
}

const rank = (accountId: string): number => {
  const i = (REPRESENTATIVE_ACCOUNT_IDS as readonly string[]).indexOf(accountId)
  return i < 0 ? REPRESENTATIVE_ACCOUNT_IDS.length : i
}

function newestFirst(a: Invoice, b: Invoice): number {
  return rank(a.accountId) - rank(b.accountId) || (b.postedAt ?? '').localeCompare(a.postedAt ?? '') || b.number.localeCompare(a.number)
}

/** The posted invoice the proof watches for a publish that superseded these versions, or undefined when no posted
 *  invoice exists at all. */
export function proofInvoiceFor(db: Db, supersededIds: string[]): { invoice: Invoice; basis: PublishProof['basis'] } | undefined {
  const posted = db.invoices.filter(i => i.locked && i.postedAt)
  const superseded = new Set(supersededIds)
  const chargeById = new Map(db.charges.map(c => [c.id, c]))
  const hit = posted
    .filter(i => i.chargeIds.some(id => {
      const rv = chargeById.get(id)?.pricing.rateVersionId
      return rv !== undefined && superseded.has(rv)
    }))
    .sort(newestFirst)[0]
  if (hit) return { invoice: hit, basis: 'superseded' }
  const fallback = posted.filter(i => rank(i.accountId) < REPRESENTATIVE_ACCOUNT_IDS.length).sort(newestFirst)[0]
  return fallback ? { invoice: fallback, basis: 'representative' } : undefined
}

export function snapshotProof(db: Db, invoice: Invoice, basis: PublishProof['basis']): PublishProof {
  const charges = invoice.chargeIds
    .map(id => db.charges.find(c => c.id === id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map(c => ({ id: c.id, totalCents: c.totalCents, ...(c.pricing.rateVersionId !== undefined ? { rateVersionId: c.pricing.rateVersionId } : {}) }))
  return { invoiceId: invoice.id, totalCents: invoice.totalCents, charges, basis }
}
