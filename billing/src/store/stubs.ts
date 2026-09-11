/**
 * Local stand-ins for actions another surface owns after merge.
 *
 * publishRateVersionStub: Pricing owns publishing rates. Billing needs a published RateVersion to show
 * that a posted invoice keeps its price while the next run picks up the new one, so this stub appends one
 * locally. It is pure like the engine: it returns the row and the store commits it.
 *
 * applyUnappliedStub: Account owns applying a payment to an invoice (shared/OWNERSHIP.md). Billing's Payments
 * tab needs to show unapplied cash leaving the unapplied list, so this stub runs the engine's allocate() against
 * the local store and returns the allocation rows for the store to commit. DECISIONS.md entry 40.
 */
import type { Frequency, PaymentAllocation, RateVersion } from '../types'
import { withEngineDb, type Db } from './db'
import { stamp } from './clock'
import { allocate, dayOf, formatId, maxIdSuffix, RATE_VERSION_ID_PREFIX } from './engine'

export interface RateVersionStubInput {
  catalogId: string
  priceCents: number
  effectiveFrom: string
  zoneId?: string
  /** Defaults to the frequency of the version this one supersedes. */
  frequency?: Frequency
}

/**
 * Build a published RateVersion with an `rv_bl_####` id (addendum C12). supersedesId names the latest
 * published version for the same catalog, zone, and frequency that is effective on or before the new
 * effectiveFrom. Throws for an unknown catalog, a non-positive or non-integer price, or a malformed date.
 */
export function publishRateVersionStub(db: Db, input: RateVersionStubInput): RateVersion {
  if (!db.catalog.some(c => c.id === input.catalogId)) throw new Error(`Unknown catalog ${input.catalogId}`)
  if (!Number.isInteger(input.priceCents) || input.priceCents <= 0) {
    throw new Error(`priceCents must be positive integer cents, got ${input.priceCents}`)
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(input.effectiveFrom)) throw new Error(`effectiveFrom must be an ISO date, got ${input.effectiveFrom}`)
  const effectiveFrom = dayOf(input.effectiveFrom)
  if (input.zoneId !== undefined && !db.zones.some(z => z.id === input.zoneId)) throw new Error(`Unknown zone ${input.zoneId}`)

  let superseded: RateVersion | undefined
  for (const rv of db.rateVersions) {
    if (rv.catalogId !== input.catalogId || rv.status !== 'published') continue
    if ((rv.zoneId ?? undefined) !== input.zoneId) continue
    if (input.frequency !== undefined && rv.frequency !== undefined && rv.frequency !== input.frequency) continue
    if (dayOf(rv.effectiveFrom) > effectiveFrom) continue
    if (!superseded
      || dayOf(rv.effectiveFrom) > dayOf(superseded.effectiveFrom)
      || (dayOf(rv.effectiveFrom) === dayOf(superseded.effectiveFrom) && (rv.publishedAt ?? '') >= (superseded.publishedAt ?? ''))) {
      superseded = rv
    }
  }

  const row: RateVersion = {
    id: formatId(RATE_VERSION_ID_PREFIX, maxIdSuffix(db.rateVersions.map(r => r.id), RATE_VERSION_ID_PREFIX) + 1),
    catalogId: input.catalogId,
    priceCents: input.priceCents,
    effectiveFrom,
    status: 'published',
    publishedAt: stamp(),
  }
  if (input.zoneId !== undefined) row.zoneId = input.zoneId
  const frequency = input.frequency ?? superseded?.frequency
  if (frequency !== undefined) row.frequency = frequency
  if (superseded) row.supersedesId = superseded.id
  return row
}

export interface ApplyUnappliedInput {
  paymentId: string
  /** Invoices on the payment's own account, each with the cents to apply to it (same order). */
  invoiceIds: string[]
  cents: number[]
}

/**
 * Apply a payment's unapplied cash to invoices on the same account through the engine's allocate(), bound to the
 * given db. Returns the PaymentAllocation rows; nothing is written (the store commits them). The engine refuses
 * over-allocation (more than the payment's unapplied amount, or more than an invoice's open balance) and its
 * error message is passed through unchanged so the form can show it. The stub adds two checks of its own that
 * Account's real action would make: the invoice must be posted, and it must belong to the payer's account.
 */
export function applyUnappliedStub(db: Db, input: ApplyUnappliedInput): PaymentAllocation[] {
  const payment = db.payments.find(p => p.id === input.paymentId)
  if (!payment) throw new Error(`Unknown payment ${input.paymentId}`)
  if (input.invoiceIds.length === 0) throw new Error('Choose at least one invoice to apply the payment to')
  for (const invoiceId of input.invoiceIds) {
    const inv = db.invoices.find(i => i.id === invoiceId)
    if (!inv) throw new Error(`Unknown invoice ${invoiceId}`)
    if (inv.accountId !== payment.accountId) {
      throw new Error(`Cannot apply ${payment.id} to ${inv.number}: it belongs to another account`)
    }
    if (!inv.locked && !inv.postedAt) throw new Error(`Cannot apply ${payment.id} to ${inv.number}: it is not posted`)
  }
  return withEngineDb(db, () => allocate({
    sourceType: 'payment',
    sourceId: payment.id,
    invoiceIds: input.invoiceIds,
    cents: input.cents,
  }))
}
