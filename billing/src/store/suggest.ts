/**
 * Agent suggestions for the review queue. The agent drafts, rules authorize, a person approves
 * (invariant 7). suggestFor() never changes anything; it reads the charge and the db it is given
 * and returns a recommendation with the evidence it relied on.
 */
import type { Charge, WaivedCharge } from '../types'
import type { Db } from './db'
import { today } from './clock'
import { isBillableException } from './engine'
import { waivesForAccount } from './waive'

export type SuggestedAction = 'approve' | 'waive' | 'review'
export type Confidence = 'high' | 'medium' | 'low'

export interface Suggestion {
  action: SuggestedAction
  /** Set when action is waive (the reason to prefill) or review (the reason the agent would waive for, if any). */
  reason?: WaivedCharge['reason']
  confidence: Confidence
  rationale: string
  evidenceIds: string[]
}

/** Threshold under which an extra bags or overload line is immaterial for a long tenure customer. */
export const IMMATERIAL_CENTS = 1000
/** Tenure in years after which a small first exception is waived rather than billed. */
export const LONG_TENURE_YEARS = 2

function monthsBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.slice(0, 10).split('-').map(Number)
  const [ty, tm, td] = toIso.slice(0, 10).split('-').map(Number)
  let months = (ty - fy) * 12 + (tm - fm)
  if (td < fd) months -= 1
  return Math.max(0, months)
}

/** Months since the earliest ServiceItem on any of the account's sites, as of the engine's today. */
export function tenureMonths(db: Db, accountId: string, asOf: string = today()): number {
  const siteIds = new Set(db.sites.filter(s => s.accountId === accountId).map(s => s.id))
  let earliest: string | undefined
  for (const si of db.serviceItems) {
    if (!siteIds.has(si.siteId)) continue
    if (earliest === undefined || si.effectiveFrom < earliest) earliest = si.effectiveFrom
  }
  return earliest === undefined ? 0 : monthsBetween(earliest, asOf)
}

function fmtDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function suggestFor(charge: Charge, db: Db): Suggestion {
  const account = db.accounts.find(a => a.id === charge.accountId)

  // Recurring lines: the rate card or the service item is the evidence.
  if (charge.lineType === 'recurring') {
    const evidence = charge.pricing.rateVersionId
      ? [charge.pricing.rateVersionId]
      : charge.pricing.contractId
        ? [charge.pricing.contractId, charge.source.id]
        : [charge.source.id]
    const priced = charge.pricing.rateVersionId
      ? `priced by rate version ${charge.pricing.rateVersionId}`
      : charge.pricing.contractId
        ? `priced by contract ${charge.pricing.contractId}`
        : `priced from service item ${charge.source.id}`
    return {
      action: 'approve',
      confidence: 'high',
      rationale: `Recurring line from service item ${charge.source.id}, ${priced} (${charge.pricing.ruleWon}).`,
      evidenceIds: evidence,
    }
  }

  // Overage lines: the scale ticket is the evidence.
  if (charge.source.type === 'scaleTicket') {
    const ticket = db.scaleTickets.find(t => t.id === charge.source.id)
    if (ticket) {
      const workOrder = db.workOrders.find(w => w.id === ticket.workOrderId)
      return {
        action: 'approve',
        confidence: 'high',
        rationale: `Scale ticket ${ticket.id} from ${ticket.facility} shows ${ticket.netLbs.toLocaleString()} lb net (${(ticket.netLbs / 2000).toFixed(2)} t); the overage is arithmetic on the ticket.`,
        evidenceIds: workOrder ? [ticket.id, workOrder.id] : [ticket.id],
      }
    }
    return {
      action: 'review',
      reason: 'insufficientEvidence',
      confidence: 'low',
      rationale: `Overage charge with no scale ticket ${charge.source.id} in the record; cannot verify the weight.`,
      evidenceIds: [],
    }
  }

  // Exception events.
  if (charge.source.type === 'serviceEvent') {
    const event = db.serviceEvents.find(e => e.id === charge.source.id)
    if (!event || !isBillableException(event.exception)) {
      return {
        action: 'review',
        reason: 'insufficientEvidence',
        confidence: 'low',
        rationale: `No billable service event ${charge.source.id} found for this charge.`,
        evidenceIds: [],
      }
    }
    const hasPhoto = Boolean(event.photoUrl)
    const evidenceIds = [event.id]
    const where = `${event.date} by ${event.driver}`

    if (event.exception === 'dryRun') {
      return hasPhoto
        ? { action: 'approve', confidence: 'medium', rationale: `Dry run on ${where} with a photo of the blocked access; the trip cost is documented.`, evidenceIds }
        : { action: 'review', reason: 'insufficientEvidence', confidence: 'low', rationale: `Dry run on ${where} has no photo; insufficient evidence to bill a trip charge without a person checking the note.`, evidenceIds }
    }

    if (event.exception === 'contamination') {
      return hasPhoto
        ? { action: 'approve', confidence: 'medium', rationale: `Contamination on ${where} with a photo of the container contents.`, evidenceIds }
        : { action: 'review', reason: 'insufficientEvidence', confidence: 'low', rationale: `Contamination on ${where} has no photo; insufficient evidence for a contamination fee.`, evidenceIds }
    }

    // extraBags or overload.
    const label = event.exception === 'extraBags' ? 'Extra bags' : 'Overload'
    const tenure = tenureMonths(db, charge.accountId)
    const priorWaives = waivesForAccount(db, charge.accountId).filter(w => w.charge.id !== charge.id)
    const small = charge.baseCents < IMMATERIAL_CENTS
    const longTenure = tenure > LONG_TENURE_YEARS * 12
    if (small && longTenure && priorWaives.length === 0) {
      const years = Math.floor(tenure / 12)
      if (account?.status === 'pastDue') {
        return {
          action: 'approve',
          confidence: 'medium',
          rationale: `${label} on ${where}, ${fmtDollars(charge.baseCents)} base. ${years} year customer with no prior waives, but the account is past due, so bill it and let collections carry the conversation.`,
          evidenceIds,
        }
      }
      return {
        action: 'waive',
        reason: 'immaterial',
        confidence: 'medium',
        rationale: `${label} on ${where}, ${fmtDollars(charge.baseCents)} base. ${years} year customer with no prior waives; the line is immaterial next to the relationship.`,
        evidenceIds,
      }
    }
    if (hasPhoto) {
      const why = !small ? `${fmtDollars(charge.baseCents)} base is above the immaterial threshold` : priorWaives.length > 0 ? `${priorWaives.length} prior waive${priorWaives.length === 1 ? '' : 's'} on the account` : `tenure is ${tenure} months`
      return { action: 'approve', confidence: 'medium', rationale: `${label} on ${where} with a photo; ${why}.`, evidenceIds }
    }
    return {
      action: 'review',
      reason: 'insufficientEvidence',
      confidence: 'low',
      rationale: `${label} on ${where} has no photo; insufficient evidence to bill without a person reading the note.`,
      evidenceIds,
    }
  }

  // Manual and fee lines: a person entered them, a person confirms them.
  return {
    action: 'review',
    confidence: 'low',
    rationale: `${charge.lineType} line from a ${charge.source.type} source; no rule covers it, a person decides.`,
    evidenceIds: [...charge.evidenceIds],
  }
}
