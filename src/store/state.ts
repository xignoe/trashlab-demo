/**
 * Shapes shared by the zustand store (useStore.ts) and the selectors (selectors.ts).
 * Kept in their own module so selectors never import the store and the store can import the selectors.
 */
import type { PaymentAllocation } from '../types'
import type { Db } from './db'

export type Tab = 'run' | 'payments'

/** Audit sidecar for an edited proposed amount (DECISIONS.md entry 9). The Charge row itself is untouched by the edit metadata. */
export interface ChargeEdit {
  chargeId: string
  /** The base the engine first proposed. Repeated edits keep the first original. */
  originalBaseCents: number
  /** The total the engine first proposed, so the item keeps showing what it was before any edit. */
  originalTotalCents: number
  newBaseCents: number
  reason: string
  by: string
  at: string
}

/** Why a recurring charge in this run differs from the prior cycle (DECISIONS.md entry 5). */
export interface PriorChange {
  /** "first invoice after service change" or "rate version changed 2600 to 2700" or "amount changed 3420 to 3527". */
  reason: string
  kind: 'serviceChange' | 'rateChange' | 'amountChange'
  priorTotalCents?: number
  priorBaseCents?: number
  /** Price per month in the prior cycle (base divided by qty and months). */
  priorMonthlyCents?: number
  newMonthlyCents?: number
  priorRateVersionId?: string
  newRateVersionId?: string
}

/** One billing run for one cycle date. Re-running the same date adds new charges to the same record. */
export interface RunRecord {
  cycleDate: string
  /** ISO timestamp of the latest run for this cycle date. */
  ranAt: string
  /** Ids of every charge this run produced (recurring and event), in generation order. */
  chargeIds: string[]
  /** Charge id to the reason it changed from the prior cycle. Only recurring charges appear here. */
  changedFromPrior: Record<string, PriorChange>
  /** Invoice ids posted from this run (Phase 5). */
  postedInvoiceIds: string[]
  /**
   * Intake (Phase 3.2, DECISIONS.md intake rule): charges written outside the run (storefront signups, portal extra
   * pickups, account's reinstatement fees) that this run took in. They are also listed in chargeIds.
   */
  intakeChargeIds?: string[]
  /** The intake charges that arrived proposed: each is a queue item a person decides (kind proposedCharge). */
  intakeDecisionIds?: string[]
  /** Allocations written when this run posted: settled prepayments applied to the invoices carrying their intake charges. */
  postedAllocations?: PaymentAllocation[]
  /** Billing groups run on their own for this cycle date (addendum P), in the order they ran. */
  groupIds?: string[]
  /** True once a run covered every account due on the cycle date; false while only some groups have run. */
  ranAll?: boolean
}

/** The data half of the store state. Selectors take this and never the actions. */
export interface StoreData {
  db: Db
  cycleDate: string
  activeTab: Tab
  selectedChargeId: string | null
  runs: Record<string, RunRecord>
  edits: ChargeEdit[]
  /** Name recorded on waives and edits made from this screen. */
  actor: string
  /** Payment id to when a person chose "Leave on account" for its unapplied cash (Payments tab, UI state only). */
  leftOnAccount: Record<string, string>
  /**
   * Payment id to the "Charge card on file" click that created it (box 4.5a): the invoice it paid, who clicked, and
   * when. The Payment and its allocation are ordinary db rows; this sidecar only records the person, because types.ts
   * has no field for it (invariant 7: a human approves anything that moves money).
   */
  cardCharges: Record<string, CardCharge>
}

/** One "Charge card on file" click on a posted invoice (box 4.5a). */
export interface CardCharge {
  invoiceId: string
  by: string
  at: string
}
