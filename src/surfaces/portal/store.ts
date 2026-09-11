/**
 * The portal's view of the one store (PORT_DECISIONS.md entry 3).
 *
 * The prototype's screens read a flat PortalState: every table, the session, and actions named placeHold,
 * recordPayment, and so on. In the merged store the tables live under db, the portal's own fields sit in its slice
 * with `portal`-prefixed names, and the field events are db's (Maple's missed and blocked Mondays are seed rows). viewOf()
 * rebuilds that flat shape from the root state, once per root state (a WeakMap), so zustand selectors over the view
 * return stable references and a screen re-renders only when the store changes.
 */
import { useStore } from '../../store/useStore'
import type { RootState } from '../../store/slices/types'
import type { Db } from '../../store/db'
import type { PortalActions, PortalData } from '../../store/slices/portal'

export type {
  BookExtraPickupInput, ChangeCartInput, Hold, PaymentMethod, PendingChange, PlaceHoldInput, PortalLogEntry, PortalSession,
  QuoteRequest, RecordPaymentInput, ReportMissedPickupInput, RequestQuoteInput, ServiceItemHoldRequest,
} from '../../store/slices/portal'

type Strip<K extends string> = K extends `portal${infer R}` ? Uncapitalize<R> : K

/** The prototype's action names, bound to the slice's prefixed actions. */
export type PortalViewActions = { [K in keyof PortalActions as Strip<K>]: PortalActions[K] }

export type PortalView = Db & PortalViewActions & Omit<PortalData, 'portalSession' | 'portalLog'> & {
  session: PortalData['portalSession']
  log: PortalData['portalLog']
}

const cache = new WeakMap<RootState, PortalView>()

export function viewOf(root: RootState): PortalView {
  const hit = cache.get(root)
  if (hit) return hit
  const view: PortalView = {
    ...root.db,
    session: root.portalSession,
    log: root.portalLog,
    paymentMethods: root.paymentMethods,
    holds: root.holds,
    pendingChanges: root.pendingChanges,
    quoteRequests: root.quoteRequests,
    switchAccount: root.portalSwitchAccount,
    setSite: root.portalSetSite,
    addRequest: root.portalAddRequest,
    addWorkOrder: root.portalAddWorkOrder,
    setAutopay: root.portalSetAutopay,
    setDeliveryMethod: root.portalSetDeliveryMethod,
    savePaymentMethod: root.portalSavePaymentMethod,
    recordPayment: root.portalRecordPayment,
    refreshAccountStatus: root.portalRefreshAccountStatus,
    bookExtraPickup: root.portalBookExtraPickup,
    requestServiceItemHold: root.portalRequestServiceItemHold,
    proposeCartChange: root.portalProposeCartChange,
    placeHold: root.portalPlaceHold,
    changeCart: root.portalChangeCart,
    reportMissedPickup: root.portalReportMissedPickup,
    submitQuoteRequest: root.portalSubmitQuoteRequest,
    requestQuote: root.portalRequestQuote,
  }
  cache.set(root, view)
  return view
}

/** Subscribe to the portal view, or to one value selected from it. */
export function usePortal(): PortalView
export function usePortal<T>(selector: (view: PortalView) => T): T
export function usePortal<T>(selector?: (view: PortalView) => T): PortalView | T {
  return useStore(s => (selector ? selector(viewOf(s)) : viewOf(s)))
}

/** The current view outside React (an event handler that must read the store after an earlier write). */
export function portalState(): PortalView {
  return viewOf(useStore.getState())
}
