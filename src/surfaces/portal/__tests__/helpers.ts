/**
 * Shared set-up for the portal tests. The prototype built a fresh store per test (createPortalStore); the merged app
 * has one store, so each test resets it (seed, clock, every slice) and reads through the portal view, which carries
 * the prototype's names (session, placeHold, recordPayment, ...).
 */
import { useStore } from '../../../store/useStore'
import type { Db } from '../../../store/db'
import { portalState } from '../store'
import { invoicesForAccount } from '../lib/selectors'

export const MAPLE = 'acct_res_maple'
export const OAKRIDGE = 'acct_pm_oakridge'

/** Reset the one store to the seed and today. Call in beforeEach. */
export function resetStore(): void {
  useStore.getState().reset()
}

/** The portal view of the store right now. Call again after any action; views are immutable snapshots. */
export const s = () => portalState()

/** Replace db tables directly, the way a test fixture would (the app itself only writes through the slice). */
export function patchDb(fn: (db: Db) => Db): void {
  useStore.getState().mutateDb(fn)
}

/**
 * Maple's past due invoice, found by account and balance rather than by id: invoice ids are not shared across the
 * prototypes' seeds (addendum D2), so no test names one.
 */
export function maplePastDueInvoice() {
  const view = s()
  const inv = invoicesForAccount(view, MAPLE).find(i => i.totalCents > view.allocations.filter(a => a.invoiceId === i.id).reduce((t, a) => t + a.cents, 0))
  if (!inv) throw new Error('Maple has no open invoice in the seed')
  return inv
}

/** Open balance derived straight from the rows, independent of the selector under test. */
export function openFromRows(invoiceId: string): number {
  const view = s()
  const inv = view.invoices.find(i => i.id === invoiceId)!
  return inv.totalCents - view.allocations.filter(a => a.invoiceId === invoiceId).reduce((t, a) => t + a.cents, 0)
}
