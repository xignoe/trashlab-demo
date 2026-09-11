/**
 * Billing's two hand-offs to the surfaces that own them (box 3.6, addendum L). Billing's slice calls these and commits
 * nothing itself, so each row is written exactly once, by its owner (DECISIONS.md, R3F-1 and entry 49).
 * - publishRateVersionThroughPricing: pricing owns publishing rates. It drafts the version with pricing's
 *   createDraftRateVersion and publishes it with pricing's publishRateVersions, stamped with clock.ts stamp(), so the
 *   Ratebook's history and publish record see billing's publish too. The row carries pricing's id
 *   (`rv_pr_<catalog>_<zone>_<frequency>_<yyyymmdd>`).
 * - applyUnappliedThroughAccount: account owns applying a payment to an invoice (shared/OWNERSHIP.md). It calls
 *   account's allocatePayment, which validates through the canonical allocate() and records the ledger write the
 *   account view's QuickBooks chip reads.
 */
import type { Frequency, PaymentAllocation, RateVersion } from '../types'
import type { RootState } from './slices/types'
import type { Db } from './db'
import { stamp } from './clock'
import { dayOf } from './engine'

/**
 * Publish one rate line through pricing: draft it (superseding the latest published version of the same line on or
 * before effectiveFrom), then publish that draft stamped now. Returns the published row. Throws pricing's validation
 * errors, and throws when the price equals the version it supersedes (pricing publishes no no-change draft), leaving no
 * draft behind. Pass the live state (the store's get()).
 */
export function publishRateVersionThroughPricing(state: RootState, input: RateVersionStubInput): RateVersion {
  const superseded = supersededVersion(state.db, input)
  const draft = state.createDraftRateVersion({
    catalogId: input.catalogId,
    zoneId: input.zoneId,
    frequency: input.frequency ?? superseded?.frequency,
    priceCents: input.priceCents,
    effectiveFrom: input.effectiveFrom,
    supersedesId: superseded?.id,
  })
  const [row] = state.publishRateVersions({ draftIds: [draft.id], publishedAt: stamp() })
  if (!row) {
    state.discardDraftRateVersion({ id: draft.id })
    throw new Error(`${input.catalogId} is already ${input.priceCents} cents in ${superseded?.id}; nothing to publish`)
  }
  return row
}

/** Apply a payment's unapplied cash through account's allocatePayment. Returns the rows; throws and writes nothing on a bad allocation. */
export function applyUnappliedThroughAccount(state: RootState, input: ApplyUnappliedInput): PaymentAllocation[] {
  return state.allocatePayment({ sourceType: 'payment', sourceId: input.paymentId, invoiceIds: input.invoiceIds, cents: input.cents })
}

/**
 * The latest published version of the same line (catalog, zone, and frequency when given) effective on or before
 * input.effectiveFrom; a tie on the date goes to the later publishedAt.
 */
function supersededVersion(db: Db, input: RateVersionStubInput): RateVersion | undefined {
  const effectiveFrom = dayOf(input.effectiveFrom)
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
  return superseded
}

export interface RateVersionStubInput {
  catalogId: string
  priceCents: number
  effectiveFrom: string
  zoneId?: string
  /** Defaults to the frequency of the version this one supersedes. */
  frequency?: Frequency
}

export interface ApplyUnappliedInput {
  paymentId: string
  /** Invoices on the payment's own account, each with the cents to apply to it (same order). */
  invoiceIds: string[]
  cents: number[]
}
