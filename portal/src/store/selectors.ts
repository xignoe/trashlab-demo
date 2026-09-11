// Pure read helpers over the table set. Every screen reads through these so the math lives in one place.

import type {
  Charge, Invoice, Payment, PaymentAllocation, ProcessorBatch, Request, Route, ServiceCatalog, ServiceEvent, ServiceItem, Site,
} from '../types';
import type { Tables } from './engine';
import { missedPickupWindow } from './engine';
import type { Hold, PendingChange } from './useStore';
import {
  firstRouteDayOnOrAfter, formatDayLong, isRouteDay, lastRouteDayOnOrBefore, nextBusinessDay10am, nextRouteDay, parseISO,
} from './clock';

export function invoiceOpenBalance(state: Tables, invoiceId: string): number {
  const invoice = state.invoices.find((i) => i.id === invoiceId);
  if (!invoice) throw new Error(`Unknown invoice ${invoiceId}`);
  const applied = state.allocations.filter((a) => a.invoiceId === invoiceId).reduce((s, a) => s + a.cents, 0);
  return invoice.totalCents - applied;
}

/** Sum of open balances across every invoice on the account. */
export function accountBalance(state: Tables, accountId: string): number {
  return state.invoices
    .filter((i) => i.accountId === accountId)
    .reduce((sum, i) => sum + invoiceOpenBalance(state, i.id), 0);
}

export function sitesForAccount(state: Tables, accountId: string): Site[] {
  return state.sites.filter((s) => s.accountId === accountId);
}

export function serviceItemsForSite(state: Tables, siteId: string): ServiceItem[] {
  return state.serviceItems.filter((s) => s.siteId === siteId);
}

export function chargesForInvoice(state: Tables, invoiceId: string): Charge[] {
  const invoice = state.invoices.find((i) => i.id === invoiceId);
  if (!invoice) return [];
  return invoice.chargeIds
    .map((id) => state.charges.find((c) => c.id === id))
    .filter((c): c is Charge => Boolean(c));
}

export function allocationsForInvoice(state: Tables, invoiceId: string): PaymentAllocation[] {
  return state.allocations.filter((a) => a.invoiceId === invoiceId);
}

export function allocationsForPayment(state: Tables, paymentId: string): PaymentAllocation[] {
  return state.allocations.filter((a) => a.sourceType === 'payment' && a.sourceId === paymentId);
}

export function routeForSite(state: Tables, siteId: string): Route | undefined {
  const site = state.sites.find((s) => s.id === siteId);
  if (!site) return undefined;
  if (site.routeId) return state.routes.find((r) => r.id === site.routeId);
  return state.routes.find((r) => r.stopSiteIds.includes(siteId));
}

/**
 * Stops the route can still take on a date: capacityStops minus its regular stops minus every extraPickup
 * work order already scheduled for that date at a site on this route.
 */
export function routeCapacityOn(state: Tables, routeId: string, date: string): number {
  const route = state.routes.find((r) => r.id === routeId);
  if (!route) throw new Error(`Unknown route ${routeId}`);
  const day = date.slice(0, 10);
  const extras = state.workOrders.filter((w) => {
    if (w.kind !== 'extraPickup' || w.status !== 'scheduled') return false;
    if (w.scheduledFor.slice(0, 10) !== day) return false;
    return routeForSite(state, w.siteId)?.id === routeId;
  }).length;
  return route.capacityStops - route.stopSiteIds.length - extras;
}

/** The field event at a site on a calendar day. ServiceEvent.date is a timestamp, so match on the date part. */
export function eventForSiteOn(state: Tables, siteId: string, date: string): ServiceEvent | undefined {
  const day = date.slice(0, 10);
  return state.serviceEvents.find((e) => e.siteId === siteId && e.date.slice(0, 10) === day);
}

export function eventsForSite(state: Tables, siteId: string): ServiceEvent[] {
  return state.serviceEvents
    .filter((e) => e.siteId === siteId)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function requestsForAccount(state: Tables, accountId: string): Request[] {
  return state.requests.filter((r) => r.accountId === accountId);
}

/** Requests the customer is still waiting on: open or scheduled. Done and declined are history. */
export function openItemsForAccount(state: Tables, accountId: string): Request[] {
  return requestsForAccount(state, accountId).filter((r) => r.status === 'open' || r.status === 'scheduled');
}

// ---------------------------------------------------------------------------
// Billing (Phase 3)
// ---------------------------------------------------------------------------

export type InvoiceStatus = 'paid' | 'open' | 'pastDue';

/** Newest first by issuedAt, then by number so two invoices issued the same day keep a stable order. */
export function invoicesForAccount(state: Tables, accountId: string): Invoice[] {
  return state.invoices
    .filter((i) => i.accountId === accountId)
    .sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : a.issuedAt > b.issuedAt ? -1 : b.number.localeCompare(a.number)));
}

/** paid when nothing is open, pastDue when something is open after the due date, open otherwise. */
export function invoiceStatus(state: Tables, invoiceId: string, today: string): InvoiceStatus {
  const invoice = state.invoices.find((i) => i.id === invoiceId);
  if (!invoice) throw new Error(`Unknown invoice ${invoiceId}`);
  const open = invoiceOpenBalance(state, invoiceId);
  if (open <= 0) return 'paid';
  return invoice.dueAt.slice(0, 10) < today.slice(0, 10) ? 'pastDue' : 'open';
}

export function invoicePaid(state: Tables, invoiceId: string): number {
  return state.allocations.filter((a) => a.invoiceId === invoiceId).reduce((s, a) => s + a.cents, 0);
}

/** Newest first by receivedAt. */
export function paymentsForAccount(state: Tables, accountId: string): Payment[] {
  return state.payments
    .filter((p) => p.accountId === accountId)
    .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0));
}

export function batchForPayment(state: Tables, paymentId: string): ProcessorBatch | undefined {
  return state.batches.find((b) => b.paymentIds.includes(paymentId));
}

/** The soonest due date the customer still has to pay by hand: the earliest open invoice, unpaid or not yet due. */
export function nextDueOpenInvoice(state: Tables, accountId: string): Invoice | undefined {
  return invoicesForAccount(state, accountId)
    .filter((i) => invoiceOpenBalance(state, i.id) > 0)
    .sort((a, b) => (a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0))[0];
}

// ---------------------------------------------------------------------------
// Requests (Phase 4)
// ---------------------------------------------------------------------------

export interface EligibilityCheck {
  id: 'accountStatus' | 'routeCapacity' | 'activeService';
  label: string;
  ok: boolean;
  /** What the customer sees next to the row: the passing detail or the failure reason. */
  detail: string;
}

export interface ExtraPickupEligibility {
  checks: EligibilityCheck[];
  ok: boolean;
  /** The first failing reason, which is what the handoff request carries. */
  reason?: string;
  route?: Route;
  /** Next route day for the site, the day an extra pickup would run. */
  nextRouteDay?: string;
  /** The active ServiceItem the pickup is for (the first active cart at the site). */
  serviceItem?: ServiceItem;
}

/**
 * The three extra pickup checks, in order, each reported as a row so the screen can show pass or fail:
 * 1. account status active or pastDue is fine; suspended or hold fails
 * 2. the site's route has capacity on its next route day (routeCapacityOn above zero)
 * 3. the site has an active ServiceItem
 * Every check runs even after one fails so the customer sees the whole picture.
 */
export function extraPickupEligibility(state: Tables, accountId: string, siteId: string, today: string): ExtraPickupEligibility {
  const account = state.accounts.find((a) => a.id === accountId);
  if (!account) throw new Error(`Unknown account ${accountId}`);
  const route = routeForSite(state, siteId);
  const nextDay = route ? nextRouteDay(route.day, today) : undefined;

  const checks: EligibilityCheck[] = [];

  const statusOk = account.status === 'active' || account.status === 'pastDue';
  checks.push({
    id: 'accountStatus',
    label: 'Account in good standing',
    ok: statusOk,
    detail: statusOk
      ? account.status === 'pastDue' ? 'Past due balances do not block an extra pickup' : 'Account is active'
      : account.status === 'suspended' ? 'Account is suspended' : 'Account is on hold',
  });

  let capacity = 0;
  if (route && nextDay) capacity = routeCapacityOn(state, route.id, nextDay);
  const capacityOk = Boolean(route && nextDay) && capacity > 0;
  checks.push({
    id: 'routeCapacity',
    label: 'Room on the truck',
    ok: capacityOk,
    detail: !route || !nextDay
      ? 'No route serves this site'
      : capacityOk
        ? `${capacity} open stop${capacity === 1 ? '' : 's'} on ${formatDayLong(nextDay)}`
        : `Route is full on ${formatDayLong(nextDay)}`,
  });

  const active = serviceItemsForSite(state, siteId).filter((i) => i.status === 'active');
  const serviceItem = active[0];
  checks.push({
    id: 'activeService',
    label: 'Active service at this site',
    ok: Boolean(serviceItem),
    detail: serviceItem
      ? `${active.length} active service${active.length === 1 ? '' : 's'} at this site`
      : 'No active service at this site',
  });

  const firstFail = checks.find((c) => !c.ok);
  const out: ExtraPickupEligibility = { checks, ok: !firstFail };
  if (firstFail) out.reason = firstFail.detail;
  if (route) out.route = route;
  if (nextDay) out.nextRouteDay = nextDay;
  if (serviceItem) out.serviceItem = serviceItem;
  return out;
}

/** Portal-local hold rows for a site, via its service items. */
export function holdsForSite(state: Tables & { holds: Hold[] }, siteId: string): Hold[] {
  const itemIds = new Set(serviceItemsForSite(state, siteId).map((i) => i.id));
  return state.holds.filter((h) => itemIds.has(h.serviceItemId));
}

/** Portal-local pending cart changes for a site (proposeCartChange rows), oldest first. */
export function pendingChangesForSite(state: Tables & { pendingChanges: PendingChange[] }, siteId: string): PendingChange[] {
  const itemIds = new Set(serviceItemsForSite(state, siteId).map((i) => i.id));
  return state.pendingChanges.filter((p) => itemIds.has(p.serviceItemId));
}

/**
 * Active service items at a site that a new vacation hold can cover: status active and no portal hold row whose
 * range is still running or ahead. The portal never writes ServiceItem.status, so a hold it placed lives only in holds.
 */
export function holdableServiceItems(state: Tables & { holds: Hold[] }, siteId: string, today: string): ServiceItem[] {
  const heldIds = new Set(holdsForSite(state, siteId).filter((h) => h.end >= today).map((h) => h.serviceItemId));
  return serviceItemsForSite(state, siteId).filter((i) => i.status === 'active' && !heldIds.has(i.id));
}

/** Active service items that cover the given period (effectiveFrom on or before its end, effectiveTo on or after its start). */
export function serviceItemsInPeriod(state: Tables, siteId: string, period: { start: string; end: string }): ServiceItem[] {
  return serviceItemsForSite(state, siteId).filter(
    (i) => i.status !== 'ended' && i.effectiveFrom <= period.end && (!i.effectiveTo || i.effectiveTo >= period.start),
  );
}

// ---------------------------------------------------------------------------
// Missed pickup (Phase 5)
// ---------------------------------------------------------------------------

/**
 * A missedPickup Request already filed for this site and date. Every note the portal writes for a missed pickup
 * carries the ISO date, so the note is how a second report of the same day is caught.
 */
export function missedPickupReportFor(state: Tables, siteId: string, date: string): Request | undefined {
  const day = date.slice(0, 10);
  return state.requests.find((r) => r.kind === 'missedPickup' && r.siteId === siteId && (r.note ?? '').includes(day));
}

/** The date the missed pickup form opens on: the site's most recent route day, TODAY included. */
export function defaultMissedPickupDate(state: Tables, siteId: string, today: string): string | undefined {
  const route = routeForSite(state, siteId);
  return route ? lastRouteDayOnOrBefore(route.day, today) : undefined;
}

/** The route day inside the report window closest to date; a tie goes to the earlier day. */
export function nearestRouteDayInWindow(route: Route, date: string, today: string): string | undefined {
  const { min, max } = missedPickupWindow(today);
  const candidates = [lastRouteDayOnOrBefore(route.day, date), firstRouteDayOnOrAfter(route.day, date)]
    .filter((d) => d >= min && d <= max);
  if (candidates.length === 0) return undefined;
  const dist = (d: string) => Math.abs(parseISO(d).getTime() - parseISO(date).getTime());
  return candidates.sort((a, b) => dist(a) - dist(b) || (a < b ? -1 : 1))[0];
}

interface LookupBase {
  date: string;
  /** A missedPickup Request already on file for this site and date; the screen shows it instead of filing another. */
  existing?: Request;
}

export type MissedPickupLookup = LookupBase & (
  | { kind: 'outOfWindow'; min: string; max: string }
  | { kind: 'noRoute' }
  | { kind: 'notRouteDay'; route: Route; nearest?: string }
  /** The driver serviced the stop. No Request unless the customer asks the office. */
  | { kind: 'completed'; event: ServiceEvent }
  /** Blocked, or the cart was not out. No recovery; the customer can set it out and book an extra pickup, or dispute. */
  | { kind: 'notReachable'; event: ServiceEvent }
  /** Our miss. A recovery WorkOrder runs the next business day. */
  | { kind: 'missed'; event: ServiceEvent; recoveryOn: string }
  /** Suspended or no record: a person has to look. reason is the Request note. */
  | { kind: 'handoff'; reason: string; event?: ServiceEvent }
);

/**
 * Classifies a missed pickup report for a site and date, in order: inside the 14 day window, the site has a
 * route, the date is a route day, then the ServiceEvent outcome. A blocked outcome or a notOut exception wins
 * over completed, since a notOut stop was never serviced.
 */
export function missedPickupLookup(state: Tables, siteId: string, date: string, today: string): MissedPickupLookup {
  const day = date.slice(0, 10);
  const existing = missedPickupReportFor(state, siteId, day);
  const base: LookupBase = existing ? { date: day, existing } : { date: day };
  const { min, max } = missedPickupWindow(today);
  if (day < min || day > max) return { ...base, kind: 'outOfWindow', min, max };
  const route = routeForSite(state, siteId);
  if (!route) return { ...base, kind: 'noRoute' };
  if (!isRouteDay(route.day, day)) {
    const nearest = nearestRouteDayInWindow(route, day, today);
    return nearest ? { ...base, kind: 'notRouteDay', route, nearest } : { ...base, kind: 'notRouteDay', route };
  }
  const event = eventForSiteOn(state, siteId, day);
  if (!event) return { ...base, kind: 'handoff', reason: `No route record for ${day}` };
  if (event.outcome === 'skippedSuspended') return { ...base, kind: 'handoff', reason: `Service was suspended on ${day}`, event };
  if (event.outcome === 'blocked' || event.exception === 'notOut') return { ...base, kind: 'notReachable', event };
  if (event.outcome === 'missed') return { ...base, kind: 'missed', event, recoveryOn: nextBusinessDay10am(today).slice(0, 10) };
  return { ...base, kind: 'completed', event };
}

// ---------------------------------------------------------------------------
// Request picker and commercial quote (Phase 5)
// ---------------------------------------------------------------------------

/** The residential trash carts a cart size change moves between. */
export const CART_CATALOG_IDS = ['cat_res_96', 'cat_res_64'] as const;

/** True when any site on the account has an active residential trash cart, which is what a cart size change needs. */
export function accountHasResidentialCart(state: Tables, accountId: string): boolean {
  const siteIds = new Set(sitesForAccount(state, accountId).map((s) => s.id));
  return state.serviceItems.some(
    (i) => siteIds.has(i.siteId) && i.status === 'active' && (CART_CATALOG_IDS as readonly string[]).includes(i.catalogId),
  );
}

export const QUOTE_MATERIALS = ['trash', 'cardboard', 'wood waste'] as const;
export type QuoteMaterial = (typeof QUOTE_MATERIALS)[number];
export const QUOTE_FREQUENCIES = ['weekly', '2x', '3x'] as const;

/** Container sizes the frontload catalog offers, smallest first ("2 yd", "3 yd"). */
export function frontloadSizes(catalog: ServiceCatalog[]): string[] {
  return [...new Set(catalog.filter((c) => c.lob === 'frontload').map((c) => c.sizeLabel))]
    .sort((a, b) => parseFloat(a) - parseFloat(b));
}

/**
 * The frontload catalog item a quote line points at. Wood waste uses the wood waste item of that size when the
 * catalog has one (cat_fl_3yd_wood); every other pairing uses the plain item of that size, and the material
 * travels on the quote request so the person pricing it sees it.
 */
export function quoteCatalogFor(catalog: ServiceCatalog[], sizeLabel: string, material: QuoteMaterial): ServiceCatalog | undefined {
  const sized = catalog.filter((c) => c.lob === 'frontload' && c.sizeLabel === sizeLabel);
  const wood = sized.find((c) => /wood/i.test(c.name));
  if (material === 'wood waste' && wood) return wood;
  return sized.find((c) => !/wood/i.test(c.name)) ?? sized[0];
}
