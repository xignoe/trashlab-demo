/**
 * Portal-only engine helpers (box 2C.1). The prototype's portal/src/store/engine.ts is gone: resolvePrice,
 * computeCharge, allocate, and frequencyLabel are the canonical ones from src/store/engine.ts (addendum C1), re-exported
 * here so a screen imports every engine name from one place. What stays is what only the portal needs: cycle math for
 * the next invoice estimate and the cart change, the vacation hold policy, the missed pickup window, and the extra
 * pickup rate.
 */
import type { BillingAccount, BillingGroup } from '../../../types'
import { billingFactor, cadenceOf, nextCycleDate, periodFor } from '../../../store/cycles'
import { EVENT_RATES } from '../../../seed'
import { addDays, parseISO, toISODate, today } from './clock'

export { allocate, computeCharge, frequencyLabel, invoiceBalance, resolvePrice } from '../../../store/engine'

/**
 * Id for a charge the portal only shows (the extra pickup quote, the next invoice estimate, the cart change totals).
 * Passing an id keeps computeCharge from calling nextChargeId(), which advances billing's `chg_bl_` counter: a portal
 * render must never move the ids billing's next run hands out.
 */
export const PREVIEW_CHARGE_ID = 'chg_p_preview'

// ---------------------------------------------------------------------------
// Extra pickup (addendum D5, K6): an event exception priced from eventRates.json, not a catalog SKU.
// ---------------------------------------------------------------------------

/** 2500 in src/seed/eventRates.json. The retired cat_res_extra_pickup SKU is gone. */
export const EXTRA_PICKUP_RATE_CENTS: number = EVENT_RATES.extraPickup

/** Charge.source for an extra pickup: manual, pointing at the event rate that set the base. */
export const EXTRA_PICKUP_SOURCE = { type: 'manual', id: 'eventRates.extraPickup' } as const

// ---------------------------------------------------------------------------
// Cycle math shared by the Overview estimate and the cart change flow
// ---------------------------------------------------------------------------

/**
 * Months of the monthly rate one invoice covers for this account's cycle: 3 for quarterly, 12/52 for a weekly billing
 * group, and so on (the canonical billingFactor, addendum Q). perJob accounts are billed per work order, not on a cycle.
 */
export function monthsInCycle(account: BillingAccount, groups: readonly BillingGroup[] = []): number {
  if (account.cycle === 'perJob') return 0
  return billingFactor(cadenceOf(account, groups))
}

/** First day of the next cycle after fromDate: next month's 1st, or the next calendar quarter for quarterly. */
export function nextCycleStart(account: BillingAccount, fromDate: string = today(), groups: readonly BillingGroup[] = []): string {
  // The canonical calendar, with the account's billing group schedule when it has one (addendum Q).
  return nextCycleDate(cadenceOf(account, groups), fromDate.slice(0, 10))
}

/** Last day of the cycle that starts on cycleStart. */
export function cycleEnd(account: BillingAccount, cycleStart: string): string {
  const d = parseISO(cycleStart)
  const months = Math.max(1, monthsInCycle(account))
  return addDays(toISODate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1))), -1)
}

/**
 * The service period the next invoice covers: the cycle that starts next for accounts billed in advance, the cycle
 * running now for accounts billed in arrears.
 */
export function nextInvoicePeriod(account: BillingAccount, fromDate: string = today(), groups: readonly BillingGroup[] = []): { start: string; end: string } {
  const upcoming = nextCycleStart(account, fromDate, groups)
  const cadence = cadenceOf(account, groups)
  if (cadence.schedule && account.billedInAdvance) return periodFor(cadence, upcoming)
  if (account.billedInAdvance) return { start: upcoming, end: cycleEnd(account, upcoming) }
  const d = parseISO(fromDate)
  const months = Math.max(1, monthsInCycle(account))
  const start = toISODate(new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / months) * months, 1)))
  return { start, end: cycleEnd(account, start) }
}

// ---------------------------------------------------------------------------
// Vacation hold policy. Hauler.policy has no hold fields (portal DECISIONS.md entry 5), so the constants live here.
// ---------------------------------------------------------------------------

export const HOLD_POLICY = { minDays: 7, maxDays: 90 } as const

export const HOLD_POLICY_TEXT = `Holds must be at least ${HOLD_POLICY.minDays} days and at most ${HOLD_POLICY.maxDays} days`

export interface HoldCheck {
  ok: boolean
  /** Whole days from start to end (end minus start). */
  days: number
  /** Plain-words reason when the range is not allowed. */
  reason?: string
}

/** Whole days between two ISO dates, end minus start. Negative when end is before start. */
export function daysBetween(start: string, end: string): number {
  return Math.round((parseISO(end).getTime() - parseISO(start).getTime()) / 86_400_000)
}

/**
 * Checks a hold range against HOLD_POLICY: both dates on or after tomorrow, end after start, length inside
 * [minDays, maxDays]. Returns the first failing reason.
 */
export function checkHoldPolicy(start: string, end: string, on: string = today()): HoldCheck {
  const tomorrow = addDays(on, 1)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return { ok: false, days: 0, reason: 'Pick both a start and an end date' }
  }
  const days = daysBetween(start, end)
  if (start < tomorrow) return { ok: false, days, reason: `The hold must start on or after ${tomorrow}` }
  if (end <= start) return { ok: false, days, reason: 'The hold must end after it starts' }
  if (days < HOLD_POLICY.minDays) {
    return { ok: false, days, reason: `This hold is ${days} day${days === 1 ? '' : 's'}, shorter than the ${HOLD_POLICY.minDays} day minimum` }
  }
  if (days > HOLD_POLICY.maxDays) {
    return { ok: false, days, reason: `This hold is ${days} days, longer than the ${HOLD_POLICY.maxDays} day maximum` }
  }
  return { ok: true, days }
}

// ---------------------------------------------------------------------------
// Missed pickup window. Hauler.policy has no reporting window, so the constant lives here like HOLD_POLICY.
// ---------------------------------------------------------------------------

/**
 * A missed pickup can be reported for a route day in the last 28 days, today included (PORT_DECISIONS.md entry 6).
 * The prototype used 21; four weeks puts both of Maple's pending-seed events (2026-08-17 missed, 2026-08-24 blocked)
 * in reach, since the merged seed already uses both of the later Mondays.
 */
export const MISSED_PICKUP_WINDOW_DAYS = 28

/** The earliest and latest dates the missed pickup date picker allows. */
export function missedPickupWindow(on: string = today()): { min: string; max: string } {
  return { min: addDays(on, -MISSED_PICKUP_WINDOW_DAYS), max: on }
}
