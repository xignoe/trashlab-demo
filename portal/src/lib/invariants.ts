// Contract invariants the portal can check against live store state (SHARED_CONTRACT.md, "Non-negotiable
// invariants"). Each check is pure: it reads tables and returns pass or fail with the evidence, so the Overview
// footer can render them and a unit test can assert them. Invariants 1, 3, and 7 are office and billing runs the
// portal never performs, so they are not checked here.

import type { Tables } from '../store/engine';

export interface InvariantResult {
  id: string;
  /** Contract invariant number. */
  number: number;
  title: string;
  pass: boolean;
  detail: string;
}

/** The store surface the waived check inspects: any method name is enough to prove no delete exists. */
export type InvariantState = Tables & Record<string, unknown>;

const PAIRED_PAYMENT = 'pay_chk_oakridge';
const PAIRED_BATCH = 'batch_0908';

/** Invariant 2: every Charge carries base, fees, tax, source, and ruleWon. */
export function checkChargeShape(state: Tables): InvariantResult {
  const bad = state.charges.filter(
    (c) =>
      !Number.isInteger(c.baseCents) ||
      !Array.isArray(c.fees) ||
      c.fees.some((f) => !f.feeRuleId || !Number.isInteger(f.cents)) ||
      !Number.isInteger(c.taxCents) ||
      !c.source?.type ||
      !c.source?.id ||
      !c.pricing?.ruleWon ||
      c.baseCents + c.fees.reduce((s, f) => s + f.cents, 0) + c.taxCents !== c.totalCents,
  );
  return {
    id: 'chargeShape',
    number: 2,
    title: 'Every charge carries base, fees, tax, source, and ruleWon',
    pass: bad.length === 0,
    detail: bad.length === 0
      ? `${state.charges.length} charges checked, each with base + fees + tax = total`
      : `Missing or unbalanced: ${bad.slice(0, 5).map((c) => c.id).join(', ')}${bad.length > 5 ? ` and ${bad.length - 5} more` : ''}`,
  };
}

/** Invariant 4: a suspended account produces skippedSuspended events, never charges (and the portal takes no payment). */
export function checkSuspendedNoMoney(state: Tables): InvariantResult {
  const suspended = state.accounts.filter((a) => a.status === 'suspended').map((a) => a.id);
  const charges = state.charges.filter((c) => suspended.includes(c.accountId));
  const payments = state.payments.filter((p) => suspended.includes(p.accountId));
  const skipped = state.serviceEvents.filter((e) => e.outcome === 'skippedSuspended').length;
  const pass = charges.length === 0 && payments.length === 0;
  return {
    id: 'suspendedNoMoney',
    number: 4,
    title: 'No charge or payment for a suspended account',
    pass,
    detail: pass
      ? `${suspended.length} suspended (${suspended.join(', ') || 'none'}), ${skipped} skippedSuspended events, 0 charges, 0 payments`
      : `Found ${charges.length} charges and ${payments.length} payments on ${suspended.join(', ')}: ${[...charges, ...payments].slice(0, 5).map((r) => r.id).join(', ')}`,
  };
}

/**
 * Invariant 5: WaivedCharge rows are never deleted. The store exposes no delete or remove method on any table, and
 * every seeded waived row is still present. `seedWaived` is the seed's waived table (empty today).
 */
export function checkWaivedKept(state: InvariantState, seedWaived: Tables['waived']): InvariantResult {
  const deleters = Object.keys(state).filter((k) => typeof state[k] === 'function' && /^(delete|remove|drop|purge)/i.test(k));
  const missing = seedWaived.filter((w) => !state.waived.some((x) => x.chargeId === w.chargeId && x.at === w.at));
  const pass = deleters.length === 0 && missing.length === 0;
  return {
    id: 'waivedKept',
    number: 5,
    title: 'Waived charge rows are never removed',
    pass,
    detail: pass
      ? `Store has no delete method; ${state.waived.length} waived rows, all ${seedWaived.length} seeded rows present`
      : deleters.length
        ? `Store exposes ${deleters.join(', ')}`
        : `Missing waived rows for ${missing.map((w) => w.chargeId).join(', ')}`,
  };
}

/** Invariant 6: allocation is many-to-many, and a batch splits into gross, fees, and per-invoice allocations. */
export function checkManyToMany(state: Tables): InvariantResult {
  const check = state.allocations.filter((a) => a.sourceType === 'payment' && a.sourceId === PAIRED_PAYMENT);
  const invoices = new Set(check.map((a) => a.invoiceId));
  const payment = state.payments.find((p) => p.id === PAIRED_PAYMENT);
  const checkSplits = check.length >= 2 && invoices.size === check.length && payment?.cents === check.reduce((s, a) => s + a.cents, 0);

  const batch = state.batches.find((b) => b.id === PAIRED_BATCH);
  const batchPays = batch ? state.payments.filter((p) => batch.paymentIds.includes(p.id)) : [];
  const batchAllocated = batchPays.every((p) => state.allocations.some((a) => a.sourceType === 'payment' && a.sourceId === p.id));
  const batchSplits = Boolean(batch)
    && batch!.grossCents === batchPays.reduce((s, p) => s + p.cents, 0)
    && batch!.grossCents - batch!.feeCents === batch!.netCents
    && batchAllocated;

  const pass = checkSplits && batchSplits;
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
  };
}

export function runInvariants(state: InvariantState, seedWaived: Tables['waived']): InvariantResult[] {
  return [checkChargeShape(state), checkSuspendedNoMoney(state), checkWaivedKept(state, seedWaived), checkManyToMany(state)];
}
