/**
 * Surface-local shapes for the account view. None of these is a contract type (src/types.ts stays frozen, addendum
 * B3): they describe the office's own session log (the account slice's accountEdits, src/store/slices/account.ts)
 * and the plans the lib builds before a slice action commits them to the one Db.
 */
import type { BillingAccount, Charge, Container, Frequency, Request, ServiceItem, WorkOrder } from '../../../types'
import type { Db } from '../../../store/db'
import type { ResolvedPrice } from '../../../store/engine'

/**
 * The customer request behind an office change, as the office recorded it. Since box 3.6 the slice writes it as a
 * Request row with status scheduled (officeRequestRow in src/store/slices/account.ts), so the portal shows the office's
 * phone requests next to the customer's own.
 */
export interface OfficeRequestDraft {
  kind: Request['kind']
  accountId: string
  siteId: string
  workOrderId?: string
  createdVia: Request['createdVia']
  note: string
}

/**
 * A money write the office made in this session that the stub QuickBooks sync has not picked up yet: a new Payment, a
 * new CreditMemo, or a new set of PaymentAllocations. The QuickBooks chip reads it, so allocating an older payment
 * (whose receivedAt predates the last sync) still goes stale.
 */
export interface LedgerWrite {
  id: string
  accountId: string
  kind: 'payment' | 'creditMemo' | 'allocation'
  /** The Payment or CreditMemo written or allocated. */
  sourceId: string
  cents: number
  at: string
}

/** Why the office suspended an account. BillingAccount has no reason field. */
export type SuspensionReason = 'nonPayment' | 'customerRequest'

/**
 * One account status change the office made in this session: hold, suspend, resume, or reinstate. BillingAccount has
 * no field for the reason, the effective date, or the resume date, so they live here. A reinstatement fee names its
 * status change as the Charge's manual source id.
 */
export interface StatusChange {
  id: string
  accountId: string
  kind: 'hold' | 'suspend' | 'resume' | 'reinstate'
  from: BillingAccount['status']
  to: BillingAccount['status']
  effectiveFrom: string
  /** Holds only: the date service resumes. */
  resumeOn?: string
  /** Suspensions only. */
  reason?: SuspensionReason
  note?: string
  /** ServiceItems flipped between active and held by this change. */
  itemIds: string[]
  at: string
}

/**
 * The office's edit logs, kept together under one store key (accountEdits). Billing already owns the store key
 * `edits` (its charge edit sidecar), so account's logs never use that name.
 */
export interface AccountEdits {
  ledgerWrites: LedgerWrite[]
  statusChanges: StatusChange[]
}

export interface ServiceChangeArgs {
  siteId: string
  /** The item being replaced (omit when adding a line). */
  replaceItemId?: string
  catalogId: string
  qty: number
  frequency: Frequency
  effectiveFrom: string
  /** How the customer asked; recorded on the Request, default phone. */
  createdVia?: Request['createdVia']
  note?: string
  /**
   * A Request that already records this change (the portal's cartChange, box 3.3). The WorkOrder names it and the
   * slice writes no second Request. Absent for a change the office takes by phone, which files its own.
   */
  requestId?: string
  /** The day the WorkOrder is scheduled and the new container arrives, when before the effective date (default effectiveFrom). */
  scheduleOn?: string
}

export interface ServiceChangePlan {
  oldItem?: ServiceItem
  newItem: ServiceItem
  container: Container
  workOrder: WorkOrder
  /** The request behind the change, as the slice files it when no requestId was given. */
  officeRequest: OfficeRequestDraft
  /** Set by the slice on confirm: the scheduled Request it wrote (absent when args.requestId named one). */
  request?: Request
  /** resolvePrice for the new item on its effective date; the plan refuses an item with no published price. */
  price: ResolvedPrice
  /** The db after the change, for before-and-after previews. */
  nextDb: Db
}

/** Charges this surface proposes into db.charges for billing to decide (box 3.6): today only the reinstatement fee. */
export type ProposedCharge = Charge
