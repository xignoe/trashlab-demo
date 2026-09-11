// Every request flow that cannot finish on its own ends here, never at a dead end. The reason is what the
// office reads on the Request note, and followUpBy is the promise the customer sees.

import { formatDateTime, nextBusinessDay10am, today } from './clock'

export interface Handoff {
  reason: string
  /** ISO timestamp, the next business day at 10:00. */
  followUpBy: string
}

export function handoff(reason: string, on: string = today()): Handoff {
  return { reason, followUpBy: nextBusinessDay10am(on) }
}

/** "We could not finish this automatically. Reason: <reason>. A person will follow up by <weekday, date, 10:00 am>." */
export function handoffSentence(h: Handoff): string {
  return `We could not finish this automatically. Reason: ${h.reason}. A person will follow up by ${formatDateTime(h.followUpBy)}.`
}
