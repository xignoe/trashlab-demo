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

/**
 * Invariant 6: allocation is many-to-many, and a batch splits into gross, fees, and per-invoice allocations.
 *
 * The check is on the property, not on particular rows. It takes whichever payment on this hauler's books spreads
 * across the most invoices and asks whether it splits cleanly, then asks the same of every processor batch. A hauler
 * with neither yet (a new tenant, before its first bill run) has nothing to violate, so it passes and says so. Naming
 * specific seeded ids here would fail for every hauler but the seeded one.
 */
export function checkManyToMany(state: Db): InvariantResult {
  const byPayment = new Map<string, typeof state.allocations>()
  for (const a of state.allocations.filter(a => a.sourceType === 'payment')) {
    byPayment.set(a.sourceId, [...(byPayment.get(a.sourceId) ?? []), a])
  }
  // The clearest example of the property: the payment spread across the most invoices.
  const split = [...byPayment.entries()]
    .map(([id, allocs]) => ({ id, allocs, invoices: new Set(allocs.map(a => a.invoiceId)) }))
    .filter(p => p.allocs.length >= 2)
    .sort((a, b) => b.invoices.size - a.invoices.size)[0]
  const splitPayment = split ? state.payments.find(p => p.id === split.id) : undefined
  const splitsCleanly = Boolean(split)
    && split.invoices.size === split.allocs.length
    && splitPayment?.cents === split.allocs.reduce((s, a) => s + a.cents, 0)

  const batches = state.processorBatches.map(batch => {
    const pays = state.payments.filter(p => batch.paymentIds.includes(p.id))
    const allocated = pays.every(p => state.allocations.some(a => a.sourceType === 'payment' && a.sourceId === p.id))
    const ok = batch.grossCents === pays.reduce((s, p) => s + p.cents, 0)
      && batch.grossCents - batch.feeCents === batch.netCents
      && allocated
    return { batch, pays, allocated, ok }
  })

  const nothingToCheck = !split && batches.length === 0
  const pass = nothingToCheck || ((!split || splitsCleanly) && batches.every(b => b.ok))

  const parts: string[] = []
  if (split) {
    parts.push(`${split.id}: ${split.allocs.length} allocations across ${split.invoices.size} invoices${splitsCleanly ? ', summing to the payment' : ', does not split cleanly'}`)
  }
  for (const b of batches) {
    parts.push(`${b.batch.id}: ${b.pays.length} payments, gross ${b.batch.grossCents} = fees ${b.batch.feeCents} + net ${b.batch.netCents}${b.allocated ? ', each allocated' : ', some unallocated'}`)
  }
  if (nothingToCheck) parts.push('No split payment or processor batch on this hauler\'s books yet')

  return {
    id: 'manyToMany',
    number: 6,
    title: 'Allocation is many-to-many',
    pass,
    detail: parts.join('; '),
  }
}

export function runInvariants(store: StoreSurface, state: Db, seedWaived: readonly WaivedCharge[]): InvariantResult[] {
  return [checkChargeShape(state), checkSuspendedNoMoney(state), checkWaivedKept(store, state, seedWaived), checkManyToMany(state)]
}
