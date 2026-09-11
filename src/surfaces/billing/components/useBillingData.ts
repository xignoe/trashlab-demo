import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../../../store/useStore'
import {
  batchSummary, chargeDetail, cleanApprovalPreview, dueCadenceLabel, eventsThrough, leakage as leakageOf,
  postedCycleDates, postPreview, queueItems, rateChangePreview,
} from '../../../store/selectors'

/**
 * Subscribes to the data half of the store and derives every figure the billing run screen shows through
 * the selectors. useShallow keeps the picked object stable, so each selector reruns only when its inputs change.
 */
export function useBillingData() {
  const data = useStore(useShallow(s => ({
    db: s.db,
    runs: s.runs,
    cycleDate: s.cycleDate,
    edits: s.edits,
    selectedChargeId: s.selectedChargeId,
    activeTab: s.activeTab,
    actor: s.actor,
  })))
  const queue = useMemo(() => queueItems(data), [data])
  const summary = useMemo(() => batchSummary(data), [data])
  const detail = useMemo(() => chargeDetail(data, data.selectedChargeId), [data])
  const leakage = useMemo(() => leakageOf(data), [data])
  const bulk = useMemo(() => cleanApprovalPreview(data), [data])
  const posting = useMemo(() => postPreview(data), [data])
  const rateChanges = useMemo(() => rateChangePreview(data), [data])
  const postedCycles = useMemo(() => postedCycleDates(data), [data])
  const cadence = useMemo(() => dueCadenceLabel(data.db, data.cycleDate), [data.db, data.cycleDate])
  const through = useMemo(() => eventsThrough(data.db), [data.db])
  return { data, queue, summary, detail, leakage, bulk, posting, rateChanges, postedCycles, cadence, through }
}

/** Undecided queue items per account in the current cycle: the charges on that account waiting on a person. */
export function useReviewCounts(): Map<string, number> {
  const { queue } = useBillingData()
  return useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of queue) if (!item.decided) counts.set(item.accountId, (counts.get(item.accountId) ?? 0) + 1)
    return counts
  }, [queue])
}
