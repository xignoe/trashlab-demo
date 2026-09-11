/**
 * Small pure helpers over the merged Db (billing's table shape, addendum C1). The prototype kept keyed collections
 * (`state.billingAccounts.byId[id]`); the merged store keeps plain arrays, so lookups are finds and writes are upserts
 * that build new arrays and never mutate the db they were given (the mutateDb contract, DECISIONS.md entry 7).
 */
import type { Db } from '../../../store/db'
import type {
  BillingAccount, Charge, Container, CreditMemo, Invoice, Payment, PaymentAllocation, Request, ServiceItem, WorkOrder,
} from '../../../types'

/** The row with this id, or undefined. */
export function byId<T extends { id: string }>(rows: readonly T[], id: string | undefined): T | undefined {
  if (id === undefined) return undefined
  return rows.find(r => r.id === id)
}

/** rows with each of add upserted by id: existing ids keep their position, new ids append. Returns rows when add is empty. */
export function upsert<T extends { id: string }>(rows: T[], add: T[] | undefined): T[] {
  if (!add || add.length === 0) return rows
  const incoming = new Map(add.map(r => [r.id, r]))
  const out = rows.map(r => incoming.get(r.id) ?? r)
  const present = new Set(rows.map(r => r.id))
  for (const r of add) if (!present.has(r.id)) out.push(r)
  return out
}

export interface RowsToWrite {
  accounts?: BillingAccount[]
  serviceItems?: ServiceItem[]
  containers?: Container[]
  workOrders?: WorkOrder[]
  charges?: Charge[]
  invoices?: Invoice[]
  payments?: Payment[]
  creditMemos?: CreditMemo[]
  /** The office's phone requests (box 3.6: Request rows the portal shows). */
  requests?: Request[]
  /** Appended, never upserted: PaymentAllocation has no id and one source may hit one invoice twice. */
  allocations?: PaymentAllocation[]
}

/** A new Db with the given rows upserted (allocations appended). The input db is untouched; untouched tables are shared. */
export function withRows(db: Db, rows: RowsToWrite): Db {
  return {
    ...db,
    accounts: upsert(db.accounts, rows.accounts),
    serviceItems: upsert(db.serviceItems, rows.serviceItems),
    containers: upsert(db.containers, rows.containers),
    workOrders: upsert(db.workOrders, rows.workOrders),
    charges: upsert(db.charges, rows.charges),
    invoices: upsert(db.invoices, rows.invoices),
    payments: upsert(db.payments, rows.payments),
    creditMemos: upsert(db.creditMemos, rows.creditMemos),
    requests: upsert(db.requests, rows.requests),
    allocations: rows.allocations?.length ? [...db.allocations, ...rows.allocations] : db.allocations,
  }
}
