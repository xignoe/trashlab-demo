/**
 * Selectors for the Payments tab. Pure reads of the Db; they never throw on a missing row and never call the
 * engine's bound db, so the screen and tests can pass any state. Money is integer cents throughout.
 *
 * Definitions (DECISIONS.md entries 10 and 40):
 * - An invoice's open balance is its total minus every allocation against it.
 * - A payment's unapplied cash is its cents minus the sum of its allocations. A short pay (a payment fully
 *   allocated to an invoice it did not cover) leaves an open balance on the invoice, not unapplied cash.
 */
import type { Invoice, Payment, ProcessorBatch } from '../types'
import type { Db } from './db'
import type { StoreData } from './state'
import { accountName } from './selectors'
import { addDays, periodLabel } from './cycles'
import { today } from './clock'

export const OAKRIDGE_CHECK_ID = 'pay_chk_oakridge'
export const BATCH_ID = 'batch_0908'

type DbState = Pick<StoreData, 'db'>

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export function allocatedToInvoice(db: Db, invoiceId: string): number {
  return db.allocations.filter(a => a.invoiceId === invoiceId).reduce((s, a) => s + a.cents, 0)
}

export function openBalance(db: Db, invoice: Invoice): number {
  return invoice.totalCents - allocatedToInvoice(db, invoice.id)
}

export function allocatedFromSource(db: Db, sourceId: string): number {
  return db.allocations.filter(a => a.sourceId === sourceId).reduce((s, a) => s + a.cents, 0)
}

/** "Jun 1 to Jun 30" from the earliest period start to the latest period end on the invoice's lines. */
export function invoicePeriodLabel(db: Db, invoice: Invoice): string {
  let start: string | undefined
  let end: string | undefined
  for (const id of invoice.chargeIds) {
    const c = db.charges.find(x => x.id === id)
    const s = c?.period?.start ?? c?.servicedOn
    const e = c?.period?.end ?? c?.servicedOn
    if (s && (!start || s < start)) start = s
    if (e && (!end || e > end)) end = e
  }
  return start && end ? periodLabel({ start: start.slice(0, 10), end: end.slice(0, 10) }) : 'No period'
}

export function invoiceSiteCount(db: Db, invoice: Invoice): number {
  return new Set(invoice.chargeIds.map(id => db.charges.find(c => c.id === id)?.siteId).filter(Boolean)).size
}

// ---------------------------------------------------------------------------
// One payment with its allocations
// ---------------------------------------------------------------------------

export interface AllocationLine {
  invoiceId: string
  invoiceNumber: string
  periodLabel: string
  /** Distinct sites billed on the invoice (Oakridge bills four sites on one invoice). */
  siteCount: number
  invoiceTotalCents: number
  /** Cents this payment applied to the invoice. */
  cents: number
  /** The invoice's open balance after every allocation from any source. */
  invoiceBalanceCents: number
}

export interface PaymentRow {
  payment: Payment
  accountName: string
  allocations: AllocationLine[]
  allocatedCents: number
  unappliedCents: number
  /**
   * Short pay: open balance left on invoices that were already issued when this fully allocated payment arrived.
   * Not unapplied cash. A credit applied later to a newer invoice (pay_card_014 to its October invoice) is not a
   * short pay, so invoices issued after receivedAt are excluded.
   */
  openOnInvoicesCents: number
}

export function paymentRow(db: Db, payment: Payment): PaymentRow {
  const lines: AllocationLine[] = []
  for (const a of db.allocations) {
    if (a.sourceType !== 'payment' || a.sourceId !== payment.id) continue
    const inv = db.invoices.find(i => i.id === a.invoiceId)
    const existing = lines.find(l => l.invoiceId === a.invoiceId)
    if (existing) {
      existing.cents += a.cents
      continue
    }
    lines.push({
      invoiceId: a.invoiceId,
      invoiceNumber: inv?.number ?? a.invoiceId,
      periodLabel: inv ? invoicePeriodLabel(db, inv) : 'Unknown invoice',
      siteCount: inv ? invoiceSiteCount(db, inv) : 0,
      invoiceTotalCents: inv?.totalCents ?? 0,
      cents: a.cents,
      invoiceBalanceCents: inv ? openBalance(db, inv) : 0,
    })
  }
  const allocatedCents = lines.reduce((s, l) => s + l.cents, 0)
  const unappliedCents = payment.cents - allocatedCents
  return {
    payment,
    accountName: accountName(db, payment.accountId),
    allocations: lines,
    allocatedCents,
    unappliedCents,
    openOnInvoicesCents: unappliedCents === 0
      ? lines
        .filter(l => (db.invoices.find(i => i.id === l.invoiceId)?.issuedAt ?? '').slice(0, 10) <= payment.receivedAt.slice(0, 10))
        .reduce((s, l) => s + Math.max(0, l.invoiceBalanceCents), 0)
      : 0,
  }
}

// ---------------------------------------------------------------------------
// Check card
// ---------------------------------------------------------------------------

export interface CheckView extends PaymentRow {
  /** Check cents equal the sum of its allocations. */
  fullyApplied: boolean
  /** Sum of the open balances left on the invoices the check went to. */
  remainingCents: number
}

export function checkView(state: DbState, paymentId = OAKRIDGE_CHECK_ID): CheckView | undefined {
  const payment = state.db.payments.find(p => p.id === paymentId)
  if (!payment) return undefined
  const row = paymentRow(state.db, payment)
  return {
    ...row,
    fullyApplied: row.allocatedCents === payment.cents,
    remainingCents: row.allocations.reduce((s, l) => s + l.invoiceBalanceCents, 0),
  }
}

// ---------------------------------------------------------------------------
// Processor batch card
// ---------------------------------------------------------------------------

export interface BatchView {
  batch: ProcessorBatch
  rows: PaymentRow[]
  /** Sum of the payments in the batch. Equals batch.grossCents when the processor file balances. */
  paidCents: number
  allocatedCents: number
  unappliedCents: number
  /** paidCents equals the batch gross. */
  grossMatches: boolean
  /** gross minus fees equals net. */
  netMatches: boolean
  /** Rows whose payment went in full to an invoice it did not cover (open balances, not unapplied cash). */
  shortPays: PaymentRow[]
}

export function batchView(state: DbState, batchId = BATCH_ID): BatchView | undefined {
  const { db } = state
  const batch = db.processorBatches.find(b => b.id === batchId)
  if (!batch) return undefined
  const rows = batch.paymentIds
    .map(id => db.payments.find(p => p.id === id))
    .filter((p): p is Payment => p !== undefined)
    .map(p => paymentRow(db, p))
  const paidCents = rows.reduce((s, r) => s + r.payment.cents, 0)
  const allocatedCents = rows.reduce((s, r) => s + r.allocatedCents, 0)
  const unappliedCents = rows.reduce((s, r) => s + r.unappliedCents, 0)
  return {
    batch,
    rows,
    paidCents,
    allocatedCents,
    unappliedCents,
    grossMatches: paidCents === batch.grossCents,
    netMatches: batch.grossCents - batch.feeCents === batch.netCents,
    shortPays: rows.filter(r => r.openOnInvoicesCents > 0),
  }
}

// ---------------------------------------------------------------------------
// Card on file charges (box 4.5a)
// ---------------------------------------------------------------------------

export interface CardChargeRow extends PaymentRow {
  /** The posted invoice the person charged from. */
  invoiceId: string
  invoiceNumber: string
  by: string
  at: string
}

/** Every payment a person created with "Charge card on file", oldest first, with the allocation it wrote. */
export function cardChargeRows(state: Pick<StoreData, 'db' | 'cardCharges'>): CardChargeRow[] {
  const { db } = state
  return Object.entries(state.cardCharges ?? {})
    .map(([paymentId, click]) => {
      const payment = db.payments.find(p => p.id === paymentId)
      if (!payment) return undefined
      return {
        ...paymentRow(db, payment),
        invoiceId: click.invoiceId,
        invoiceNumber: db.invoices.find(i => i.id === click.invoiceId)?.number ?? click.invoiceId,
        by: click.by,
        at: click.at,
      }
    })
    .filter((r): r is CardChargeRow => r !== undefined)
    .sort((a, b) => a.at.localeCompare(b.at) || a.payment.id.localeCompare(b.payment.id))
}

// ---------------------------------------------------------------------------
// Unapplied cash and the Apply form
// ---------------------------------------------------------------------------

/** Every payment whose cents exceed its allocations, oldest first. */
export function unappliedPayments(state: DbState): PaymentRow[] {
  return state.db.payments
    .map(p => paymentRow(state.db, p))
    .filter(r => r.unappliedCents > 0)
    .sort((a, b) => a.payment.receivedAt.localeCompare(b.payment.receivedAt) || a.payment.id.localeCompare(b.payment.id))
}

export interface OpenInvoice {
  invoice: Invoice
  periodLabel: string
  balanceCents: number
}

/** Posted invoices on the account with an open balance, oldest issued first (the order the Apply form fills). */
export function openInvoicesFor(state: DbState, accountId: string): OpenInvoice[] {
  const { db } = state
  return db.invoices
    .filter(i => i.accountId === accountId && (i.locked || i.postedAt))
    .map(invoice => ({ invoice, periodLabel: invoicePeriodLabel(db, invoice), balanceCents: openBalance(db, invoice) }))
    .filter(o => o.balanceCents > 0)
    .sort((a, b) => a.invoice.issuedAt.localeCompare(b.invoice.issuedAt) || a.invoice.number.localeCompare(b.invoice.number))
}

/** Posted invoices on the account that are paid in full, newest first (the Apply form names them when nothing is open). */
export function paidInvoicesFor(state: DbState, accountId: string): Invoice[] {
  const { db } = state
  return db.invoices
    .filter(i => i.accountId === accountId && (i.locked || i.postedAt) && openBalance(db, i) <= 0)
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt) || b.number.localeCompare(a.number))
}

/**
 * Default split for the Apply form: fill the oldest open invoice first, up to its balance, until the unapplied
 * cash runs out. Returns cents per invoice in the same order as `open`.
 */
export function suggestedSplit(unappliedCents: number, open: OpenInvoice[]): number[] {
  let left = unappliedCents
  return open.map(o => {
    const take = Math.max(0, Math.min(left, o.balanceCents))
    left -= take
    return take
  })
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

export interface PaymentTiles {
  /** Inclusive window: the seven days ending on the engine's today. */
  from: string
  to: string
  receivedCents: number
  receivedCount: number
  /** Cents from the window's payments that sit on invoices. */
  appliedCents: number
  appliedCount: number
  /** Unapplied cash across every payment on record, not only this week. */
  unappliedCents: number
  unappliedCount: number
  feeCents: number
  batchCount: number
}

export function paymentTiles(state: DbState): PaymentTiles {
  const { db } = state
  const to = today()
  const from = addDays(to, -6)
  const inWindow = (iso: string) => iso.slice(0, 10) >= from && iso.slice(0, 10) <= to
  const received = db.payments.filter(p => inWindow(p.receivedAt))
  const rows = received.map(p => paymentRow(db, p))
  const unapplied = unappliedPayments(state)
  const batches = db.processorBatches.filter(b => inWindow(b.depositedAt))
  return {
    from,
    to,
    receivedCents: received.reduce((s, p) => s + p.cents, 0),
    receivedCount: received.length,
    appliedCents: rows.reduce((s, r) => s + r.allocatedCents, 0),
    appliedCount: rows.reduce((s, r) => s + r.allocations.length, 0),
    unappliedCents: unapplied.reduce((s, r) => s + r.unappliedCents, 0),
    unappliedCount: unapplied.length,
    feeCents: batches.reduce((s, b) => s + b.feeCents, 0),
    batchCount: batches.length,
  }
}
