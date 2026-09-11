import type { BillingAccount } from '../../types'
import type { Decision, QueueKind } from '../../store/selectors'
import type { SuggestedAction } from '../../store/suggest'

export type PillTone = 'ok' | 'warn' | 'danger' | 'info' | 'accent' | undefined

/** Artboard: warning tone for field events, danger tone for overage, neutral for service and rate change. */
export function kindTone(kind: QueueKind): PillTone {
  if (kind === 'overage') return 'danger'
  if (kind === 'serviceChange' || kind === 'rateChange') return undefined
  return 'warn'
}

export function suggestionTone(action: SuggestedAction): PillTone {
  if (action === 'approve') return 'ok'
  if (action === 'waive') return 'info'
  return 'danger'
}

export function decisionTone(decision: Decision): PillTone {
  switch (decision) {
    case 'undecided': return 'info'
    case 'approved':
    case 'edited': return 'ok'
    case 'posted': return 'accent'
    default: return undefined
  }
}

export const STATUS_LABEL: Record<BillingAccount['status'], string> = {
  active: 'Active',
  pastDue: 'Past due',
  suspended: 'Suspended',
  hold: 'On hold',
}

export function statusTone(status: BillingAccount['status']): PillTone {
  if (status === 'pastDue' || status === 'suspended') return 'danger'
  if (status === 'hold') return 'warn'
  return 'ok'
}
