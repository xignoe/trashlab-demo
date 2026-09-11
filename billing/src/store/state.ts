/**
 * Shapes shared by the zustand store (useStore.ts) and the selectors (selectors.ts).
 * Kept in their own module so selectors never import the store and the store can import the selectors.
 */
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
}
