// Contract invariants the portal can check against live store state (SHARED_CONTRACT.md, "Non-negotiable
// invariants"). Each check is pure: it reads tables and returns pass or fail with the evidence, so the Overview
// footer can render them and a unit test can assert them. Invariants 1, 3, and 7 are office and billing runs the
// portal never performs, so they are not checked here.

import type { WaivedCharge } from '../../../types'
import type { Db } from '../../../store/db'

export interface InvariantResult {
  id: string
  /** Contract invariant number. */
  number: number
  title: string
  pass: boolean
  detail: string
}

/** Any object whose keys are store fields and actions: the root store in the app, a fake in a test. */
export type StoreSurface = Record<string, unknown>

const PAIRED_PAYMENT = 'pay_chk_oakridge'
const PAIRED_BATCH = 'batch_0908'

/** Invariant 2: every Charge carries base, fees, tax, source, and ruleWon, and base + fees + tax = total. */
export function checkChargeShape(state: Db): InvariantResult {
  const bad = state.charges.filter(
    c =>
      !Number.isInteger(c.baseCents) ||
      !Array.isArray(c.fees) ||
      c.fees.some(f => !f.feeRuleId || !Number.isInteger(f.cents)) ||
      !Number.isInteger(c.taxCents) ||
      !c.source?.type ||
      !c.source?.id ||
      !c.pricing?.ruleWon ||
      c.baseCents + c.fees.reduce((s, f) => s + f.cents, 0) + c.taxCents !== c.totalCents,
  )
  return {
    id: 'chargeShape',
    number: 2,
    title: 'Every charge carries base, fees, tax, source, and ruleWon',
    pass: bad.length === 0,
    detail: bad.length === 0
      ? `${state.charges.length} charges checked, each with base + fees + tax = total`
      : `Missing or unbalanced: ${bad.slice(0, 5).map(c => c.id).join(', ')}${bad.length > 5 ? ` and ${bad.length - 5} more` : ''}`,
  }
}

/** Invariant 4: a suspended account produces skippedSuspended events, never charges (and the portal takes no payment). */
export function checkSuspendedNoMoney(state: Db): InvariantResult {
  const suspended = state.accounts.filter(a => a.status === 'suspended').map(a => a.id)
  const charges = state.charges.filter(c => suspended.includes(c.accountId))
  const payments = state.payments.filter(p => suspended.includes(p.accountId))
  const skipped = state.serviceEvents.filter(e => e.outcome === 'skippedSuspended').length
  const pass = charges.length === 0 && payments.length === 0
  return {
    id: 'suspendedNoMoney',
    number: 4,
    title: 'No charge or payment for a suspended account',
    pass,
    detail: pass
      ? `${suspended.length} suspended (${suspended.join(', ') || 'none'}), ${skipped} skippedSuspended events, 0 charges, 0 payments`
      : `Found ${charges.length} charges and ${payments.length} payments on ${suspended.join(', ')}: ${[...charges, ...payments].slice(0, 5).map(r => r.id).join(', ')}`,
  }
}

/**
 * Invariant 5: WaivedCharge rows are never deleted. In the merged store billing owns waived charges, so the check is:
 * no store action deletes one (no key naming delete, remove, drop, or purge together with waive, and no portal action
 * that deletes anything), and every seeded waived row is still present.
 */
export function checkWaivedKept(store: StoreSurface, state: Db, seedWaived: readonly WaivedCharge[]): InvariantResult {
  const deleters = Object.keys(store).filter(
    k => typeof store[k] === 'function' && (/^(delete|remove|drop|purge).*waiv/i.test(k) || /^portal(Delete|Remove|Drop|Purge)/.test(k)),
  )
  const missing = seedWaived.filter(w => !state.waivedCharges.some(x => x.chargeId === w.chargeId && x.at === w.at))
  const pass = deleters.length === 0 && missing.length === 0
  return {
    id: 'waivedKept',
    number: 5,
    title: 'Waived charge rows are never removed',
    pass,
    detail: pass
      ? `No store action deletes a waived row; ${state.waivedCharges.length} waived rows, all ${seedWaived.length} seeded rows present`
      : deleters.length
        ? `Store exposes ${deleters.join(', ')}`
        : `Missing waived rows for ${missing.map(w => w.chargeId).join(', ')}`,
  }
}

/** Invariant 6: allocation is many-to-many, and a batch splits into gross, fees, and per-invoice allocations. */
export function checkManyToMany(state: Db): InvariantResult {
  const check = state.allocations.filter(a => a.sourceType === 'payment' && a.sourceId === PAIRED_PAYMENT)
  const invoices = new Set(check.map(a => a.invoiceId))
  const payment = state.payments.find(p => p.id === PAIRED_PAYMENT)
  const checkSplits = check.length >= 2 && invoices.size === check.length && payment?.cents === check.reduce((s, a) => s + a.cents, 0)

  const batch = state.processorBatches.find(b => b.id === PAIRED_BATCH)
  const batchPays = batch ? state.payments.filter(p => batch.paymentIds.includes(p.id)) : []
  const batchAllocated = batchPays.every(p => state.allocations.some(a => a.sourceType === 'payment' && a.sourceId === p.id))
  const batchSplits = Boolean(batch)
    && batch!.grossCents === batchPays.reduce((s, p) => s + p.cents, 0)
    && batch!.grossCents - batch!.feeCents === batch!.netCents
    && batchAllocated

  const pass = checkSplits && batchSplits
  return {
    id: 'manyToMany',
    number: 6,
    title: 'Allocation is many-to-many',
    pass,
    detail: [
      `${PAIRED_PAYMENT}: ${check.length} allocations across ${invoices.size} invoices${checkSplits ? ', summing to the check' : ', does not split cleanly'}`,
      batch
        ? `${PAIRED_BATCH}: ${batchPays.length} payments, gross ${batch.grossCents} = fees ${batch.feeCents} + net ${batch.netCents}${batchAllocated ? ', each allocated' : ', some unallocated'}`
        : `${PAIRED_BATCH} not found`,
    ].join('; '),
  }
}

export function runInvariants(store: StoreSurface, state: Db, seedWaived: readonly WaivedCharge[]): InvariantResult[] {
  return [checkChargeShape(state), checkSuspendedNoMoney(state), checkWaivedKept(store, state, seedWaived), checkManyToMany(state)]
}
