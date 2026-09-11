// Surface-only view models for the account view. Nothing here writes to the store, and nothing
// here is a contract type: every shape below is assembled from the entities in EntityState.
//
// React reads these through useAccountView, which subscribes to the whole store and memoizes on
// the state reference. zustand v5 re-renders in a loop when a selector returns a fresh object on
// every call, so hooks in this file never pass a builder as the selector; they take the state
// reference and memoize. Later phases should follow the same pattern for drawer previews.

import { useMemo } from 'react';
import type {
  BillingAccount, Charge, Container, Contract, CreditMemo, Frequency, Hauler, Invoice, Party, Payment,
  PaymentAllocation, Request, Route, ScaleTicket, ServiceCatalog, ServiceEvent, ServiceItem, Site, WorkOrder, Zone,
} from '../types';
import { TODAY, addDays, daysBetween, nextWeekday, startOfMonth, weekdayOf } from './clock';
import {
  AllocationError,
  EngineError,
  accountBalance,
  accountInvoices,
  billingPeriod,
  buildReinstatementFee,
  explainPrice,
  generateEventCharges,
  isCycleBoundary,
  isNoOpChange,
  nextCycleDate,
  allocate,
  openBalance,
  pastDue,
  peekId,
  planServiceChange,
  previewNextRun,
  reinstatementFeeCents,
  resolvePrice,
  statusAfterReinstatement,
  unallocatedCents,
  type NextRunPreview,
  type PriceExplanation,
  type ResolvedPrice,
  type ServiceChangeArgs,
  type ServiceChangePlan,
  withRows,
} from './engine';
import {
  listOf, useStore, type EntityState, type LedgerWrite, type OfficeNote, type SidecarState, type StatusChange, type SuspensionReason,
} from './useStore';

/** The five accounts pinned in the rail, in the order the checklist names them. */
export const FOCUS_ACCOUNT_IDS = ['acct_res_maple', 'acct_bakery', 'acct_pm_oakridge', 'acct_contractor_hale', 'acct_res_kerr'] as const;

/** The stub QuickBooks sync: anything posted or settled after this date has not reached the ledger. */
export const LAST_QUICKBOOKS_SYNC = '2026-09-08';

export const FIELD_HISTORY_DAYS = 14;

// ---------------------------------------------------------------------------------------------
// View model shapes
// ---------------------------------------------------------------------------------------------

export interface ServiceLineView {
  item: ServiceItem;
  catalog: ServiceCatalog;
  containers: Container[];
  /** resolvePrice on TODAY; undefined when no published price exists (priceError says why). */
  resolved?: ResolvedPrice;
  priceError?: string;
  /** Monthly for recurring lines, per haul for on-call roll-off. */
  per: 'month' | 'haul';
}

export interface SiteView {
  site: Site;
  occupant?: Party;
  zone?: Zone;
  route?: Route;
  lines: ServiceLineView[];
  activeLines: ServiceLineView[];
  endedLines: ServiceLineView[];
}

export interface SyncStatus {
  state: 'inSync' | 'stale';
  reason: string;
}

export interface FieldEventView {
  event: ServiceEvent;
  site: Site;
  route?: Route;
}

export interface InvoiceView {
  invoice: Invoice;
  openCents: number;
  paidCents: number;
  isPastDue: boolean;
  daysLate: number;
}

export interface PaymentView {
  payment: Payment;
  allocations: (PaymentAllocation & { invoice?: Invoice })[];
  unappliedCents: number;
}

export interface CreditMemoView {
  memo: CreditMemo;
  allocations: (PaymentAllocation & { invoice?: Invoice })[];
  unappliedCents: number;
}

export interface WorkOrderView {
  workOrder: WorkOrder;
  site?: Site;
  container?: Container;
  item?: ServiceItem;
  catalog?: ServiceCatalog;
  isOpen: boolean;
  /** The office's record of the request behind this WorkOrder (surface-local sidecar, not a Request row). */
  officeNotes: OfficeNote[];
}

export interface RequestView {
  request: Request;
  site?: Site;
  workOrder?: WorkOrder;
  isOpen: boolean;
}

export interface NextInvoiceView {
  date?: string;
  /**
   * previewNextRun's total plus the office's proposed charges (proposedCharges sidecar). While the account is
   * suspended the office's proposed charges are left out: the run generates nothing (invariant 4), and the card lists
   * them as waiting for billing instead.
   */
  estimateCents: number;
  lines: Charge[];
  preview: NextRunPreview;
  /** Charges this surface proposed but billing has not taken yet (the reinstatement fee), from the proposedCharges sidecar. */
  officeProposed: Charge[];
}

export interface AccountView {
  account: BillingAccount;
  payer: Party;
  hauler?: Hauler;
  sites: SiteView[];
  balance: number;
  pastDue: number;
  lastPayment?: Payment;
  nextInvoice: NextInvoiceView;
  invoices: InvoiceView[];
  openInvoices: InvoiceView[];
  payments: PaymentView[];
  creditMemos: CreditMemoView[];
  unappliedCredits: CreditMemoView[];
  unappliedPayments: PaymentView[];
  /** Credit memo cents on the account not yet applied to an invoice (header money strip). */
  unappliedCreditCents: number;
  /** Payment cents received but not yet applied to an invoice. */
  unappliedPaymentCents: number;
  contract?: Contract;
  fieldEvents: FieldEventView[];
  workOrders: WorkOrderView[];
  openWorkOrders: WorkOrderView[];
  requests: RequestView[];
  openRequests: RequestView[];
  /** Every office note on the account, newest last; the ones with a workOrderId also hang off that WorkOrderView. */
  officeNotes: OfficeNote[];
  /** Hold, suspend, resume, and reinstate changes the office made this session, oldest first. */
  statusChanges: StatusChange[];
  sync: { dispatch: SyncStatus; billing: SyncStatus; quickbooks: SyncStatus };
}

// ---------------------------------------------------------------------------------------------
// Builders (pure over EntityState)
// ---------------------------------------------------------------------------------------------

function sitesOf(accountId: string, state: EntityState): Site[] {
  return listOf(state.sites).filter((s) => s.accountId === accountId);
}

function itemsOfSite(siteId: string, state: EntityState): ServiceItem[] {
  return listOf(state.serviceItems).filter((si) => si.siteId === siteId);
}

export function buildServiceLine(item: ServiceItem, site: Site, state: EntityState): ServiceLineView {
  const catalog = state.serviceCatalog.byId[item.catalogId];
  const containers = item.containerIds.map((id) => state.containers.byId[id]).filter((c): c is Container => Boolean(c));
  const line: ServiceLineView = {
    item,
    catalog: catalog ?? { id: item.catalogId, lob: 'residential', name: item.catalogId, sizeLabel: '', unit: 'cart', public: false },
    containers,
    per: item.frequency === 'onCall' ? 'haul' : 'month',
  };
  try {
    line.resolved = resolvePrice(
      { catalogId: item.catalogId, frequency: item.frequency, zoneId: site.zoneId, accountId: site.accountId, onDate: TODAY },
      state,
    );
  } catch (err) {
    line.priceError = err instanceof Error ? err.message : String(err);
  }
  return line;
}

export function buildSiteView(site: Site, state: EntityState): SiteView {
  const lines = itemsOfSite(site.id, state).map((item) => buildServiceLine(item, site, state));
  return {
    site,
    occupant: site.occupantPartyId ? state.parties.byId[site.occupantPartyId] : undefined,
    zone: state.zones.byId[site.zoneId],
    route: site.routeId ? state.routes.byId[site.routeId] : undefined,
    lines,
    activeLines: lines.filter((l) => l.item.status !== 'ended'),
    endedLines: lines.filter((l) => l.item.status === 'ended'),
  };
}

function allocationsFor(sourceType: PaymentAllocation['sourceType'], sourceId: string, state: EntityState) {
  return state.paymentAllocations
    .filter((a) => a.sourceType === sourceType && a.sourceId === sourceId)
    .map((a) => ({ ...a, invoice: state.invoices.byId[a.invoiceId] }));
}

export function buildInvoiceView(invoice: Invoice, state: EntityState): InvoiceView {
  const openCents = openBalance(invoice.id, state);
  const isPastDue = openCents > 0 && invoice.dueAt < TODAY;
  return {
    invoice,
    openCents,
    paidCents: invoice.totalCents - openCents,
    isPastDue,
    daysLate: isPastDue ? daysBetween(invoice.dueAt, TODAY) : 0,
  };
}

/**
 * Sync chips are deterministic stubs (rules recorded in DECISIONS.md, Phases 3 and 4):
 * dispatch is stale while a WorkOrder is still `open` (dispatch has not put it on a route yet), or when a
 * `scheduled` one has no date or a date in the past without being marked done;
 * billing is stale when any Charge on the account is still proposed, in the Charge table or in the account's
 * proposedCharges sidecar (the reinstatement fee, Phase 6);
 * QuickBooks is stale when a posted Invoice or settled Payment is dated after the last stub sync, or when the office
 * wrote a payment, credit, or allocation this session (buildQuickbooksSync).
 */
export function buildSync(
  accountId: string,
  siteIds: string[],
  state: EntityState,
  ledgerWrites: LedgerWrite[] = [],
  proposedCharges: Charge[] = [],
): AccountView['sync'] {
  const mine = listOf(state.workOrders).filter((wo) => siteIds.includes(wo.siteId));
  const unscheduled = mine.filter((wo) => wo.status === 'open');
  const overdue = mine.find((wo) => wo.status === 'scheduled' && (!wo.scheduledFor || wo.scheduledFor < TODAY));
  const dispatch: SyncStatus = unscheduled.length
    ? {
        state: 'stale',
        reason:
          unscheduled.length === 1
            ? `Work order ${unscheduled[0].id} for ${unscheduled[0].scheduledFor} is open and not yet scheduled on a route`
            : `${unscheduled.length} work orders are open and not yet scheduled on a route (${unscheduled.map((w) => w.id).join(', ')})`,
      }
    : overdue
      ? {
          state: 'stale',
          reason: overdue.scheduledFor
            ? `Work order ${overdue.id} was scheduled for ${overdue.scheduledFor} and is not marked done`
            : `Work order ${overdue.id} is scheduled with no date`,
        }
      : { state: 'inSync', reason: 'Every work order is scheduled on a route or done' };

  const proposed = listOf(state.charges).filter((c) => c.accountId === accountId && c.status === 'proposed');
  const office = proposedCharges.filter((c) => c.accountId === accountId && c.status === 'proposed');
  const billing: SyncStatus = office.length
    ? {
        state: 'stale',
        reason: `${office.map((c) => `${c.description} ${c.id}`).join(', ')} proposed by the office and not yet taken by billing${
          proposed.length ? `; ${proposed.length} more proposed ${proposed.length === 1 ? 'charge' : 'charges'} not yet on an invoice` : ''
        }`,
      }
    : proposed.length
      ? { state: 'stale', reason: `${proposed.length} proposed ${proposed.length === 1 ? 'charge' : 'charges'} not yet on an invoice` }
      : { state: 'inSync', reason: 'No proposed charges waiting for a billing run' };

  return { dispatch, billing, quickbooks: buildQuickbooksSync(accountId, state, ledgerWrites) };
}

const LEDGER_KIND_WORDS: Record<LedgerWrite['kind'], string> = {
  payment: 'payment',
  creditMemo: 'credit memo',
  allocation: 'allocation',
};

/**
 * QuickBooks chip (Phase 3 rule plus Phase 5): stale when a posted Invoice or settled Payment is dated after the
 * last stub sync, or when the office wrote a payment, credit memo, or allocation this session (ledgerWrites
 * sidecar), which covers applying an older check whose receivedAt predates the sync. The sidecar wins the reason
 * because it is the office's own unsynced work: "payment not yet synced".
 */
export function buildQuickbooksSync(accountId: string, state: EntityState, ledgerWrites: LedgerWrite[] = []): SyncStatus {
  const mine = ledgerWrites.filter((w) => w.accountId === accountId);
  if (mine.length) {
    const last = mine[mine.length - 1];
    const what = last.kind === 'allocation' ? `allocation of ${last.sourceId}` : `${LEDGER_KIND_WORDS[last.kind]} ${last.sourceId}`;
    const lead = mine.some((w) => w.kind === 'payment' || (w.kind === 'allocation' && w.sourceId.startsWith('pay')))
      ? 'Payment not yet synced'
      : 'Credit not yet synced';
    return {
      state: 'stale',
      reason: `${lead}: ${mine.length === 1 ? what : `${mine.length} ledger changes, latest the ${what}`} recorded ${last.at}, after the last sync on ${LAST_QUICKBOOKS_SYNC}`,
    };
  }
  const lateInvoice = listOf(state.invoices).find((i) => i.accountId === accountId && i.postedAt && i.postedAt > LAST_QUICKBOOKS_SYNC);
  const latePayment = listOf(state.payments).find(
    (p) => p.accountId === accountId && p.status === 'settled' && p.receivedAt > LAST_QUICKBOOKS_SYNC,
  );
  return lateInvoice
    ? { state: 'stale', reason: `Invoice ${lateInvoice.number} posted ${lateInvoice.postedAt} after the last sync on ${LAST_QUICKBOOKS_SYNC}` }
    : latePayment
      ? { state: 'stale', reason: `Payment ${latePayment.id} settled ${latePayment.receivedAt} after the last sync on ${LAST_QUICKBOOKS_SYNC}` }
      : { state: 'inSync', reason: `Ledger matches QuickBooks as of the last sync on ${LAST_QUICKBOOKS_SYNC}` };
}

export function buildFieldEvents(siteIds: string[], state: EntityState): FieldEventView[] {
  const from = addDays(TODAY, -FIELD_HISTORY_DAYS);
  return listOf(state.serviceEvents)
    .filter((ev) => siteIds.includes(ev.siteId) && ev.date >= from && ev.date <= TODAY)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1))
    .map((event) => ({ event, site: state.sites.byId[event.siteId], route: state.routes.byId[event.routeId] }));
}

const WO_OPEN: WorkOrder['status'][] = ['open', 'scheduled'];
const REQ_OPEN: Request['status'][] = ['open', 'scheduled'];

function byDateDesc<T>(pick: (t: T) => string) {
  return (a: T, b: T) => (pick(a) < pick(b) ? 1 : pick(a) > pick(b) ? -1 : 0);
}

export function buildWorkOrders(siteIds: string[], state: EntityState, officeNotes: OfficeNote[] = []): WorkOrderView[] {
  return listOf(state.workOrders)
    .filter((wo) => siteIds.includes(wo.siteId))
    .map((workOrder): WorkOrderView => {
      const item = workOrder.serviceItemId ? state.serviceItems.byId[workOrder.serviceItemId] : undefined;
      return {
        workOrder,
        site: state.sites.byId[workOrder.siteId],
        container: workOrder.containerId ? state.containers.byId[workOrder.containerId] : undefined,
        item,
        catalog: item ? state.serviceCatalog.byId[item.catalogId] : undefined,
        isOpen: WO_OPEN.includes(workOrder.status),
        officeNotes: officeNotes.filter((n) => n.workOrderId === workOrder.id),
      };
    })
    .sort((a, b) => Number(b.isOpen) - Number(a.isOpen) || byDateDesc<WorkOrderView>((w) => w.workOrder.scheduledFor)(a, b));
}

export function buildRequests(accountId: string, state: EntityState): RequestView[] {
  return listOf(state.requests)
    .filter((r) => r.accountId === accountId)
    .map((request): RequestView => ({
      request,
      site: state.sites.byId[request.siteId],
      workOrder: request.workOrderId ? state.workOrders.byId[request.workOrderId] : undefined,
      isOpen: REQ_OPEN.includes(request.status),
    }))
    .sort((a, b) => Number(b.isOpen) - Number(a.isOpen));
}

export function buildAccountView(accountId: string, state: EntityState & Partial<SidecarState>): AccountView | undefined {
  const account = state.billingAccounts.byId[accountId];
  if (!account) return undefined;
  const payer = state.parties.byId[account.payerPartyId] ?? { id: account.payerPartyId, name: account.payerPartyId, kind: 'homeowner' as const };
  const sites = sitesOf(accountId, state).map((s) => buildSiteView(s, state));
  const siteIds = sites.map((s) => s.site.id);

  const invoices = accountInvoices(accountId, state)
    .map((inv) => buildInvoiceView(inv, state))
    .sort(byDateDesc<InvoiceView>((v) => v.invoice.issuedAt));
  const payments = listOf(state.payments)
    .filter((p) => p.accountId === accountId)
    .map((payment): PaymentView => ({
      payment,
      allocations: allocationsFor('payment', payment.id, state),
      unappliedCents: unallocatedCents('payment', payment.id, state),
    }))
    .sort(byDateDesc<PaymentView>((v) => v.payment.receivedAt));
  const creditMemos = listOf(state.creditMemos)
    .filter((m) => m.accountId === accountId)
    .map((memo): CreditMemoView => ({
      memo,
      allocations: allocationsFor('creditMemo', memo.id, state),
      unappliedCents: unallocatedCents('creditMemo', memo.id, state),
    }))
    .sort(byDateDesc<CreditMemoView>((v) => v.memo.at));

  const preview = previewNextRun(accountId, state);
  const officeProposed = (state.proposedCharges ?? []).filter((c) => c.accountId === accountId && c.status === 'proposed');
  const officeNotes = (state.officeNotes ?? []).filter((n) => n.accountId === accountId);
  const workOrders = buildWorkOrders(siteIds, state, officeNotes);
  const contract = account.contractId
    ? state.contracts.byId[account.contractId]
    : listOf(state.contracts).find((c) => c.accountId === accountId);

  return {
    account,
    payer,
    hauler: listOf(state.haulers)[0],
    sites,
    balance: accountBalance(accountId, state),
    pastDue: pastDue(accountId, state),
    lastPayment: payments.find((p) => p.payment.status !== 'returned')?.payment,
    nextInvoice: {
      date: preview.cycleDate,
      estimateCents: nextRunEstimate(account.status, preview, officeProposed),
      lines: [...preview.recurring, ...preview.events, ...preview.proposed, ...officeProposed],
      preview,
      officeProposed,
    },
    invoices,
    openInvoices: invoices.filter((v) => v.openCents > 0),
    payments,
    creditMemos,
    unappliedCredits: creditMemos.filter((m) => m.unappliedCents > 0),
    unappliedPayments: payments.filter((p) => p.unappliedCents > 0),
    contract,
    fieldEvents: buildFieldEvents(siteIds, state),
    workOrders,
    openWorkOrders: workOrders.filter((w) => w.isOpen),
    requests: buildRequests(accountId, state),
    openRequests: buildRequests(accountId, state).filter((r) => r.isOpen),
    officeNotes,
    statusChanges: (state.statusChanges ?? []).filter((c) => c.accountId === accountId),
    unappliedCreditCents: creditMemos.reduce((sum, m) => sum + Math.max(0, m.unappliedCents), 0),
    unappliedPaymentCents: payments.reduce((sum, p) => sum + (p.payment.status === 'returned' ? 0 : Math.max(0, p.unappliedCents)), 0),
    sync: buildSync(accountId, siteIds, state, state.ledgerWrites ?? [], state.proposedCharges ?? []),
  };
}

/** The whole account view for one account. Re-computes whenever the store changes (invariant 3 in the UI). */
export function useAccountView(accountId: string): AccountView | undefined {
  const state = useStore();
  return useMemo(() => buildAccountView(accountId, state), [accountId, state]);
}

// ---------------------------------------------------------------------------------------------
// Price explanation
// ---------------------------------------------------------------------------------------------

export interface PriceExplanationView {
  explanation?: PriceExplanation;
  error?: string;
  /** Plain-words sentence for the inset headline. */
  summary: string;
  /** Supporting sentences, in order. */
  details: string[];
}

function dollars(cents: number): string {
  const abs = Math.abs(cents);
  return `$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

function longDate(iso?: string): string {
  if (!iso) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${months[m - 1]} ${d}, ${y}`;
}

const FREQ_WORDS: Record<Frequency, string> = {
  weekly: 'weekly',
  eow: 'every other week',
  '2x': '2x per week',
  '3x': '3x per week',
  onCall: 'on call',
};

/** Runs explainPrice for a service line and turns the precedence chain into office prose. */
export function explainServiceLine(line: ServiceLineView, site: Site, state: EntityState): PriceExplanationView {
  const args = { catalogId: line.item.catalogId, frequency: line.item.frequency, zoneId: site.zoneId, accountId: site.accountId, onDate: TODAY };
  let explanation: PriceExplanation;
  try {
    explanation = explainPrice(args, state);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { error, summary: 'No published price for this line.', details: [error] };
  }
  const zone = state.zones.byId[site.zoneId];
  const zoneName = zone?.name ?? site.zoneId;
  const freq = FREQ_WORDS[line.item.frequency];
  const per = line.per === 'haul' ? 'per haul' : 'per month';
  const details: string[] = [];
  let summary: string;

  const rv = explanation.rateVersion;
  const rateSentence = rv
    ? `${rv.ruleWon === 'zoneRate' ? 'Zone rate' : 'Standard rate'} ${rv.id} for ${rv.zoneId ? zoneName : 'all zones'}, ${rv.frequency ? FREQ_WORDS[rv.frequency] : 'any frequency'}: ${dollars(rv.priceCents)} effective ${longDate(rv.effectiveFrom)}${rv.publishedAt ? `, published ${longDate(rv.publishedAt)}` : ''}.`
    : 'No published rate card version matches this catalog item, zone, and frequency.';

  if (explanation.contractOverride) {
    const o = explanation.contractOverride;
    const pct = o.pctBelowRateCard !== undefined ? `, ${o.pctBelowRateCard}% below rate card` : '';
    const why = o.reason ? ` for "${o.reason}"` : '';
    summary = rv
      ? `Contract ${o.contractId} override of ${dollars(o.priceCents)} ${per} won over the ${dollars(rv.priceCents)} ${rv.ruleWon === 'zoneRate' ? 'zone' : 'standard'} rate${pct}${why}.`
      : `Contract ${o.contractId} override of ${dollars(o.priceCents)} ${per} won${pct}${why}; no rate card version exists to compare against.`;
    details.push(`Override applies to ${line.catalog.name}${o.frequency ? `, ${FREQ_WORDS[o.frequency]}` : ', any frequency'} inside the term ${longDate(o.termStart)} to ${longDate(o.termEnd)}. After the term the rate card wins again.`);
    details.push(`Rate card it beat: ${rateSentence}`);
  } else if (rv) {
    summary = `No contract override on this account. ${rv.ruleWon === 'zoneRate' ? 'Zone rate' : 'Standard rate'} ${rv.id} won: ${dollars(rv.priceCents)} ${per}, effective ${longDate(rv.effectiveFrom)}${rv.publishedAt ? `, published ${longDate(rv.publishedAt)}` : ''}.`;
    details.push(`Matched ${zoneName} (${site.zoneId}) and ${freq}${rv.frequency ? '' : ' (version has no frequency, so it matches any)'}${rv.zoneId ? '' : '; no zone-specific version exists, so the standard version applies'}.`);
  } else {
    summary = `Price ${dollars(explanation.priceCents)} ${per}, rule ${explanation.ruleWon}.`;
  }

  if (explanation.priorVersion) {
    const p = explanation.priorVersion;
    details.push(`It replaced ${p.id} at ${dollars(p.priceCents)} (effective ${longDate(p.effectiveFrom)}${p.publishedAt ? `, published ${longDate(p.publishedAt)}` : ''}), which is why the price changed on the ${longDate(rv?.effectiveFrom)} invoice.`);
  }

  return { explanation, summary, details };
}

// ---------------------------------------------------------------------------------------------
// Contract card
// ---------------------------------------------------------------------------------------------

export interface ContractOverrideView {
  catalog?: ServiceCatalog;
  catalogId: string;
  frequency?: Frequency;
  priceCents: number;
  pctBelowRateCard?: number;
  reason?: string;
  /** The rate card price the override sits below, when one is published. */
  rateCardCents?: number;
  escalatedCents?: number;
}

export interface ContractView {
  contract: Contract;
  daysUntilTermEnd: number;
  noticeBy: string;
  noticeDaysLeft: number;
  nextAnniversary?: string;
  overrides: ContractOverrideView[];
}

/**
 * The first anniversary strictly after today. Addendum B1: the anniversary is a full ISO date (the first
 * escalation, e.g. 2027-01-01); a date already past rolls forward a year at a time until it is after today.
 */
export function nextAnniversary(anniversary: string, today: string = TODAY): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anniversary)) throw new EngineError(`Escalator anniversary must be YYYY-MM-DD, got ${anniversary}`);
  let year = Number(anniversary.slice(0, 4));
  const monthDay = anniversary.slice(4);
  while (`${year}${monthDay}` <= today) year += 1;
  return `${year}${monthDay}`;
}

export function buildContractView(contract: Contract, state: EntityState): ContractView {
  const account = state.billingAccounts.byId[contract.accountId];
  const site = account ? sitesOf(account.id, state)[0] : undefined;
  const pct = contract.escalator?.pct;
  const overrides = contract.overrides.map((o): ContractOverrideView => {
    let rateCardCents: number | undefined;
    if (site) {
      const published = listOf(state.rateVersions)
        .filter((rv) => rv.catalogId === o.catalogId && rv.status === 'published' && rv.effectiveFrom <= TODAY)
        .filter((rv) => rv.frequency === undefined || o.frequency === undefined || rv.frequency === o.frequency)
        .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
      const zoneHit = published.find((rv) => rv.zoneId === site.zoneId) ?? published.find((rv) => rv.zoneId === undefined);
      rateCardCents = zoneHit?.priceCents;
    }
    return {
      catalog: state.serviceCatalog.byId[o.catalogId],
      catalogId: o.catalogId,
      frequency: o.frequency,
      priceCents: o.priceCents,
      pctBelowRateCard: o.pctBelowRateCard,
      reason: o.reason,
      rateCardCents,
      escalatedCents: pct !== undefined ? Math.round(o.priceCents * (1 + pct / 100)) : undefined,
    };
  });
  const noticeBy = addDays(contract.termEnd, -contract.renewalNoticeDays);
  return {
    contract,
    daysUntilTermEnd: daysBetween(TODAY, contract.termEnd),
    noticeBy,
    noticeDaysLeft: daysBetween(TODAY, noticeBy),
    nextAnniversary: contract.escalator ? nextAnniversary(contract.escalator.anniversary) : undefined,
    overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// Roll-off detail
// ---------------------------------------------------------------------------------------------

export interface ScaleTicketView {
  ticket: ScaleTicket;
  tons: number;
  overTons: number;
  /** The proposed overage Charge from generateEventCharges, when the ticket is over cap and not yet charged. */
  overage?: Charge;
}

export interface RolloffBoxView {
  container: Container;
  site?: Site;
  item?: ServiceItem;
  catalog: ServiceCatalog;
  deliveredOn?: string;
  daysOut?: number;
  includedDays: number;
  extraDays: number;
  /** The proposed extra-day Charge, when the box is out past the allowance and not yet charged. */
  extraDaysCharge?: Charge;
  tickets: ScaleTicketView[];
}

export function buildRolloffBoxes(accountId: string, state: EntityState): RolloffBoxView[] {
  const siteIds = sitesOf(accountId, state).map((s) => s.id);
  const items = listOf(state.serviceItems).filter((si) => siteIds.includes(si.siteId));
  const boxes: RolloffBoxView[] = [];
  const proposed = generateEventCharges(state).filter((c) => c.accountId === accountId);
  const workOrders = listOf(state.workOrders);
  for (const item of items) {
    const catalog = state.serviceCatalog.byId[item.catalogId];
    if (!catalog?.rolloff) continue;
    for (const containerId of item.containerIds) {
      const container = state.containers.byId[containerId];
      if (!container) continue;
      const deliver = workOrders
        .filter((wo) => wo.kind === 'deliver' && wo.status === 'done' && wo.containerId === containerId)
        .sort(byDateDesc<WorkOrder>((w) => w.completedAt ?? w.scheduledFor))[0];
      const deliveredOn = (deliver?.completedAt ?? deliver?.scheduledFor ?? container.assignedFrom)?.slice(0, 10);
      const daysOut = deliveredOn ? daysBetween(deliveredOn, TODAY) : undefined;
      const extraDays = daysOut !== undefined ? Math.max(0, daysOut - catalog.rolloff.includedDays) : 0;
      const tickets = listOf(state.scaleTickets)
        .filter((t) => t.containerId === containerId)
        .map((ticket): ScaleTicketView => {
          const tons = ticket.netLbs / 2000;
          return {
            ticket,
            tons,
            overTons: Math.max(0, tons - catalog.rolloff!.includedTons),
            overage: proposed.find((c) => c.source.type === 'scaleTicket' && c.source.id === ticket.id),
          };
        });
      boxes.push({
        container,
        site: state.sites.byId[item.siteId],
        item,
        catalog,
        deliveredOn,
        daysOut,
        includedDays: catalog.rolloff.includedDays,
        extraDays,
        extraDaysCharge: deliver ? proposed.find((c) => c.description.startsWith('Extra days') && c.evidenceIds.includes(deliver.id)) : undefined,
        tickets,
      });
    }
  }
  return boxes;
}

export function hasRolloff(view: AccountView): boolean {
  return view.sites.some((s) => s.lines.some((l) => Boolean(l.catalog.rolloff)));
}

// ---------------------------------------------------------------------------------------------
// Rail: pinned accounts and search
// ---------------------------------------------------------------------------------------------

export interface AccountSummary {
  account: BillingAccount;
  payer?: Party;
  sites: Site[];
  /** First site address, for the rail line under the name. */
  address?: string;
}

export function accountSummary(accountId: string, state: EntityState): AccountSummary | undefined {
  const account = state.billingAccounts.byId[accountId];
  if (!account) return undefined;
  const sites = sitesOf(accountId, state);
  return { account, payer: state.parties.byId[account.payerPartyId], sites, address: sites[0]?.address };
}

/** Case-insensitive match on payer name, account id, any site address, or any PO number. Empty query returns nothing. */
export function searchAccounts(query: string, state: EntityState, limit = 12): AccountSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: AccountSummary[] = [];
  for (const id of state.billingAccounts.ids) {
    const summary = accountSummary(id, state);
    if (!summary) continue;
    const haystack = [
      summary.payer?.name ?? '',
      summary.account.id,
      ...summary.sites.map((s) => s.address),
      ...summary.sites.map((s) => s.poNumber ?? ''),
    ]
      .join(' ')
      .toLowerCase();
    if (haystack.includes(q)) out.push(summary);
    if (out.length >= limit) break;
  }
  return out;
}

export function useAccountSearch(query: string): AccountSummary[] {
  const state = useStore();
  return useMemo(() => searchAccounts(query, state), [query, state]);
}

export function usePinnedAccounts(): AccountSummary[] {
  const state = useStore();
  return useMemo(
    () => FOCUS_ACCOUNT_IDS.map((id) => accountSummary(id, state)).filter((s): s is AccountSummary => Boolean(s)),
    [state],
  );
}

/** Weekday of the route serving a site, for meta lines ("Monday route"). */
export const ROUTE_DAY_LONG: Record<Route['day'], string> = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday' };

export function todayWeekday(): string {
  return weekdayOf(TODAY);
}

// ---------------------------------------------------------------------------------------------
// Change service drawer: options and the pure before-and-after preview (invariant 3)
// ---------------------------------------------------------------------------------------------

const ALL_FREQUENCIES: Frequency[] = ['weekly', 'eow', '2x', '3x', 'onCall'];

/** Default effective date for a service change: the next Monday after TODAY (2026-09-14 on the demo clock). */
export const DEFAULT_CHANGE_DATE = nextWeekday(TODAY, 'Mon');

/** The site's line of business: its route's, else the first item's catalog, else residential. */
export function siteLob(site: Site, state: EntityState): ServiceCatalog['lob'] {
  const route = site.routeId ? state.routes.byId[site.routeId] : undefined;
  if (route) return route.lob;
  const item = itemsOfSite(site.id, state)[0];
  return (item && state.serviceCatalog.byId[item.catalogId]?.lob) || 'residential';
}

/** Catalog entries a site can take, filtered to its line of business. */
export function catalogForSite(site: Site, state: EntityState): ServiceCatalog[] {
  const lob = siteLob(site, state);
  return listOf(state.serviceCatalog).filter((c) => c.lob === lob);
}

/** Frequencies with a published price (or contract override) for this catalog at this site on the date. */
export function priceableFrequencies(catalogId: string, site: Site, onDate: string, state: EntityState): Frequency[] {
  return ALL_FREQUENCIES.filter((frequency) => {
    try {
      resolvePrice({ catalogId, frequency, zoneId: site.zoneId, accountId: site.accountId, onDate }, state);
      return true;
    } catch {
      return false;
    }
  });
}

export interface ChangeLineView {
  item?: ServiceItem;
  catalog: ServiceCatalog;
  qty: number;
  frequency: Frequency;
  containers: Container[];
  price?: ResolvedPrice;
  priceError?: string;
  /** price times qty: per month for recurring lines, per haul for on-call. */
  lineCents?: number;
  per: 'month' | 'haul';
}

export interface ServiceChangePreview {
  args: ServiceChangeArgs;
  site: Site;
  account: BillingAccount;
  hauler?: Hauler;
  /** The form matches the replaced item exactly; nothing to preview yet. */
  noop: boolean;
  error?: string;
  plan?: ServiceChangePlan;
  oldLine?: ChangeLineView;
  newLine?: ChangeLineView;
  /** Containers the WorkOrder pulls (the replaced item's) and the one it drops. */
  pull: Container[];
  drop?: Container;
  /** The billing cycle the effective date falls in, and whether the change lands mid-cycle. */
  currentCycle?: { period: { start: string; end: string }; midCycle: boolean; invoice?: Invoice };
  /** The first cycle date that bills the new line (proration none: the next boundary on or after effectiveFrom). */
  firstBilledOn?: string;
  before: NextRunPreview;
  after?: NextRunPreview;
  deltaCents: number;
  baseDeltaCents: number;
}

function lineView(item: ServiceItem | undefined, catalogId: string, qty: number, frequency: Frequency, site: Site, onDate: string, state: EntityState): ChangeLineView | undefined {
  const catalog = state.serviceCatalog.byId[catalogId];
  if (!catalog) return undefined;
  const view: ChangeLineView = {
    item,
    catalog,
    qty,
    frequency,
    containers: item ? item.containerIds.map((id) => state.containers.byId[id]).filter((c): c is Container => Boolean(c)) : [],
    per: frequency === 'onCall' ? 'haul' : 'month',
  };
  try {
    view.price = resolvePrice({ catalogId, frequency, zoneId: site.zoneId, accountId: site.accountId, onDate }, state);
    view.lineCents = view.price.priceCents * qty;
  } catch (err) {
    view.priceError = err instanceof Error ? err.message : String(err);
  }
  return view;
}

/** The cycle boundary on or before a date: the 1st of the month, or of the quarter for quarterly accounts. */
function cycleStartOnOrBefore(account: BillingAccount, date: string): string | undefined {
  if (account.cycle === 'perJob') return undefined;
  if (account.cycle === 'quarterly') {
    const m = Number(date.slice(5, 7));
    return `${date.slice(0, 4)}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
  }
  return startOfMonth(date);
}

const sumBase = (charges: Charge[]) => charges.reduce((s, c) => s + c.baseCents, 0);

/**
 * Everything the Change service drawer shows before confirm, computed purely: the plan on a shadow
 * state (planServiceChange with peeked ids, so the WorkOrder id matches what confirm writes), the
 * dispatch effect, the old and new price with sources, the mid-cycle note under proration none, and
 * previewNextRun before and after. Nothing here writes to the store.
 */
export function buildServiceChangePreview(args: ServiceChangeArgs, state: EntityState): ServiceChangePreview | undefined {
  const site = state.sites.byId[args.siteId];
  const account = site ? state.billingAccounts.byId[site.accountId] : undefined;
  if (!site || !account) return undefined;
  const before = previewNextRun(account.id, state);
  const oldItem = args.replaceItemId ? state.serviceItems.byId[args.replaceItemId] : undefined;
  const onDate = /^\d{4}-\d{2}-\d{2}$/.test(args.effectiveFrom) ? args.effectiveFrom : TODAY;
  const out: ServiceChangePreview = {
    args,
    site,
    account,
    hauler: listOf(state.haulers)[0],
    noop: isNoOpChange(args, state),
    oldLine: oldItem ? lineView(oldItem, oldItem.catalogId, oldItem.qty, oldItem.frequency, site, onDate, state) : undefined,
    newLine: lineView(undefined, args.catalogId, args.qty, args.frequency, site, onDate, state),
    pull: oldItem ? oldItem.containerIds.map((id) => state.containers.byId[id]).filter((c): c is Container => Boolean(c)) : [],
    before,
    deltaCents: 0,
    baseDeltaCents: 0,
  };
  if (out.noop) return out;

  let plan: ServiceChangePlan;
  try {
    plan = planServiceChange(args, state, { preview: true });
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
    return out;
  }
  out.plan = plan;
  out.drop = plan.container;

  const cycleStart = cycleStartOnOrBefore(account, plan.newItem.effectiveFrom);
  if (cycleStart) {
    const period = billingPeriod(account, cycleStart);
    const eff = plan.newItem.effectiveFrom;
    const covering = oldItem
      ? listOf(state.charges).find(
          (c) => c.source.type === 'serviceItem' && c.source.id === oldItem.id && c.period && c.period.start <= eff && eff <= c.period.end,
        )
      : undefined;
    out.currentCycle = {
      period,
      midCycle: eff !== cycleStart,
      invoice: covering ? listOf(state.invoices).find((i) => i.chargeIds.includes(covering.id)) : undefined,
    };
    out.firstBilledOn = isCycleBoundary(account, eff) ? eff : nextCycleDate(account, eff);
  }

  const after = previewNextRun(account.id, plan.nextState);
  out.after = after;
  out.deltaCents = after.totalCents - before.totalCents;
  out.baseDeltaCents = sumBase([...after.recurring, ...after.events, ...after.proposed]) - sumBase([...before.recurring, ...before.events, ...before.proposed]);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Take a payment, allocate, issue credit (invariant 6): pure previews over a shadow state
// ---------------------------------------------------------------------------------------------

/**
 * Dollars typed by the office ("1,234.5", "$20", ".75") to integer cents, parsed from the string so no float
 * multiplication ever touches money. Returns undefined for anything that is not a non-negative amount with at
 * most two decimals. An empty string is undefined too; callers decide whether blank means zero.
 */
export function parseDollars(text: string): number | undefined {
  const t = text.trim().replace(/^\$/, '').replace(/,/g, '');
  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(t);
  if (!m || (m[1] === '' && (m[2] === undefined || m[2] === ''))) return undefined;
  return Number(m[1] || '0') * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** Integer cents to the plain dollar string an input shows ("759.64"), no symbol or separators. */
export function centsToInput(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** The account's invoices with an open balance, oldest due first (then issued, then number). */
export function openInvoicesOldestFirst(accountId: string, state: EntityState): InvoiceView[] {
  return accountInvoices(accountId, state)
    .map((inv) => buildInvoiceView(inv, state))
    .filter((v) => v.openCents > 0)
    .sort(
      (a, b) =>
        a.invoice.dueAt.localeCompare(b.invoice.dueAt) ||
        a.invoice.issuedAt.localeCompare(b.invoice.issuedAt) ||
        a.invoice.number.localeCompare(b.invoice.number),
    );
}

/** Fills invoices oldest first until the amount runs out. Returns cents per invoice id (zero rows included). */
export function autoAllocateOldestFirst(invoices: { invoice: Invoice; openCents: number }[], amountCents: number): Record<string, number> {
  let left = Math.max(0, amountCents);
  const out: Record<string, number> = {};
  for (const v of invoices) {
    const take = Math.min(left, v.openCents);
    out[v.invoice.id] = take;
    left -= take;
  }
  return out;
}

export interface AllocationRowView {
  invoice: Invoice;
  isPastDue: boolean;
  daysLate: number;
  openBefore: number;
  cents: number;
  openAfter: number;
  /** This row asks for more than the invoice has open. */
  over: boolean;
}

export interface AllocationPreview {
  accountId: string;
  sourceType: PaymentAllocation['sourceType'];
  /** The Payment or CreditMemo being applied: a peeked id for a draft, the real id for an existing source. */
  sourceId: string;
  /** Cents available to apply before this action (the draft amount, or an existing source's unallocated remainder). */
  availableCents: number;
  allocatedCents: number;
  /** availableCents minus allocatedCents; negative when over-allocated. */
  remainderCents: number;
  rows: AllocationRowView[];
  /** The rows with cents above zero, exactly as confirm hands them to allocate(). */
  invoiceIds: string[];
  cents: number[];
  /** First problem in plain words (row over its balance, total over the amount), else the engine's AllocationError. */
  error?: string;
  balanceBefore: number;
  balanceAfter: number;
  pastDueBefore: number;
  pastDueAfter: number;
  quickbooksBefore: SyncStatus;
  quickbooksAfter: SyncStatus;
}

function money$(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}${dollars(cents)}`;
}

/**
 * The allocation table and its before-and-after. `base` is the state the source already exists in (for a draft
 * payment, a shadow with the draft appended). Runs the engine's allocate() on that state exactly as confirm will,
 * so a preview that shows no error is one confirm accepts. Nothing here writes.
 */
function previewAllocation(
  accountId: string,
  sourceType: PaymentAllocation['sourceType'],
  sourceId: string,
  availableCents: number,
  requested: Record<string, number>,
  before: EntityState,
  base: EntityState,
  ledgerWrites: LedgerWrite[],
  pendingWrites: LedgerWrite[],
): AllocationPreview {
  const open = openInvoicesOldestFirst(accountId, base);
  const rows: AllocationRowView[] = open.map((v) => {
    const cents = Math.max(0, Math.round(requested[v.invoice.id] ?? 0));
    return {
      invoice: v.invoice,
      isPastDue: v.isPastDue,
      daysLate: v.daysLate,
      openBefore: v.openCents,
      cents,
      openAfter: v.openCents - cents,
      over: cents > v.openCents,
    };
  });
  const picked = rows.filter((r) => r.cents > 0);
  const invoiceIds = picked.map((r) => r.invoice.id);
  const cents = picked.map((r) => r.cents);
  const allocatedCents = cents.reduce((s, c) => s + c, 0);

  let error: string | undefined;
  const overRow = rows.find((r) => r.over);
  if (overRow) error = `${overRow.invoice.number}: ${money$(overRow.cents)} is more than its open balance of ${money$(overRow.openBefore)}`;
  else if (allocatedCents > availableCents) error = `Allocations total ${money$(allocatedCents)} but only ${money$(availableCents)} is available to apply`;

  let after = base;
  if (!error && picked.length) {
    try {
      after = withRows(base, { paymentAllocations: allocate({ sourceType, sourceId, invoiceIds, cents }, base) });
    } catch (err) {
      error = err instanceof AllocationError || err instanceof EngineError ? err.message : String(err);
    }
  }
  const allocationWrite: LedgerWrite[] = picked.length && !error
    ? [{ id: peekId('lw'), accountId, kind: 'allocation', sourceId, cents: allocatedCents, at: TODAY }]
    : [];

  return {
    accountId,
    sourceType,
    sourceId,
    availableCents,
    allocatedCents,
    remainderCents: availableCents - allocatedCents,
    rows,
    invoiceIds,
    cents,
    error,
    balanceBefore: accountBalance(accountId, before),
    balanceAfter: accountBalance(accountId, after),
    pastDueBefore: pastDue(accountId, before),
    pastDueAfter: pastDue(accountId, after),
    quickbooksBefore: buildQuickbooksSync(accountId, before, ledgerWrites),
    quickbooksAfter: buildQuickbooksSync(accountId, after, [...ledgerWrites, ...pendingWrites, ...allocationWrite]),
  };
}

export interface PaymentDraft {
  accountId: string;
  method: Payment['method'];
  cents: number;
  receivedAt: string;
  /** Card processor reference; kept only when method is card (processorBatchId), dropped otherwise. */
  reference?: string;
}

/** The Payment row confirm will write, with the id newId('pay') will return next. */
export function draftPayment(draft: PaymentDraft): Payment {
  const payment: Payment = {
    id: peekId('pay'),
    accountId: draft.accountId,
    method: draft.method,
    cents: draft.cents,
    receivedAt: draft.receivedAt,
    status: draft.method === 'card' || draft.method === 'ach' ? 'pending' : 'settled',
  };
  const ref = draft.reference?.trim();
  if (draft.method === 'card' && ref) payment.processorBatchId = ref;
  return payment;
}

export interface PaymentPreview extends AllocationPreview {
  payment: Payment;
}

/** Take a payment: the draft Payment on a shadow state, then the allocation table against it. */
export function buildPaymentPreview(
  draft: PaymentDraft,
  requested: Record<string, number>,
  state: EntityState,
  ledgerWrites: LedgerWrite[] = [],
): PaymentPreview {
  const payment = draftPayment(draft);
  const shadow = withRows(state, { payments: [payment] });
  const paymentWrite: LedgerWrite = { id: peekId('lw'), accountId: draft.accountId, kind: 'payment', sourceId: payment.id, cents: payment.cents, at: TODAY };
  const preview = previewAllocation(draft.accountId, 'payment', payment.id, payment.cents, requested, state, shadow, ledgerWrites, [paymentWrite]);
  return { ...preview, payment };
}

/** Allocate an existing unapplied Payment or CreditMemo: the same table, with the source's unallocated remainder. */
export function buildExistingAllocationPreview(
  sourceType: PaymentAllocation['sourceType'],
  sourceId: string,
  requested: Record<string, number>,
  state: EntityState,
  ledgerWrites: LedgerWrite[] = [],
): AllocationPreview | undefined {
  const source = sourceType === 'payment' ? state.payments.byId[sourceId] : state.creditMemos.byId[sourceId];
  if (!source) return undefined;
  const available = unallocatedCents(sourceType, sourceId, state);
  return previewAllocation(source.accountId, sourceType, sourceId, available, requested, state, state, ledgerWrites, []);
}

export const CREDIT_REASONS = ['goodwill', 'missedPickup', 'billingError', 'salesPromise', 'operationalFault', 'other'] as const;
export type CreditReason = (typeof CREDIT_REASONS)[number];

export interface CreditDraft {
  accountId: string;
  cents: number;
  reason: CreditReason;
  note?: string;
  /** Apply against this invoice; undefined leaves the credit unapplied on the account. */
  invoiceId?: string;
}

export interface CreditPreview {
  memo: CreditMemo;
  invoice?: InvoiceView;
  openBefore?: number;
  openAfter?: number;
  error?: string;
  balanceBefore: number;
  balanceAfter: number;
  pastDueBefore: number;
  pastDueAfter: number;
  unappliedCreditBefore: number;
  unappliedCreditAfter: number;
  quickbooksBefore: SyncStatus;
  quickbooksAfter: SyncStatus;
}

function unappliedCreditTotal(accountId: string, state: EntityState): number {
  return listOf(state.creditMemos)
    .filter((m) => m.accountId === accountId)
    .reduce((s, m) => s + Math.max(0, unallocatedCents('creditMemo', m.id, state)), 0);
}

/** Issue credit: the CreditMemo confirm will write (peeked id, by office, at TODAY) and, with an invoice, its allocation. */
export function buildCreditPreview(draft: CreditDraft, state: EntityState, ledgerWrites: LedgerWrite[] = []): CreditPreview {
  const note = draft.note?.trim();
  const memo: CreditMemo = {
    id: peekId('cm'),
    accountId: draft.accountId,
    invoiceId: draft.invoiceId,
    cents: draft.cents,
    reason: note ? `${draft.reason}: ${note}` : draft.reason,
    by: 'office',
    at: TODAY,
  };
  const shadow = withRows(state, { creditMemos: [memo] });
  const writes: LedgerWrite[] = [{ id: peekId('lw'), accountId: draft.accountId, kind: 'creditMemo', sourceId: memo.id, cents: memo.cents, at: TODAY }];
  let after = shadow;
  let error: string | undefined;
  const invoiceRow = draft.invoiceId ? state.invoices.byId[draft.invoiceId] : undefined;
  const invoice = invoiceRow ? buildInvoiceView(invoiceRow, state) : undefined;
  if (draft.invoiceId) {
    if (invoice && draft.cents > invoice.openCents) {
      error = `${invoice.invoice.number} has ${money$(invoice.openCents)} open; a ${money$(draft.cents)} credit is more than that. Lower the amount or leave it unapplied on the account.`;
    } else {
      try {
        after = withRows(shadow, {
          paymentAllocations: allocate({ sourceType: 'creditMemo', sourceId: memo.id, invoiceIds: [draft.invoiceId], cents: [draft.cents] }, shadow),
        });
        writes.push({ id: peekId('lw'), accountId: draft.accountId, kind: 'allocation', sourceId: memo.id, cents: memo.cents, at: TODAY });
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }
  }
  return {
    memo,
    invoice,
    openBefore: invoice?.openCents,
    openAfter: invoice && !error ? openBalance(invoice.invoice.id, after) : undefined,
    error,
    balanceBefore: accountBalance(draft.accountId, state),
    balanceAfter: accountBalance(draft.accountId, after),
    pastDueBefore: pastDue(draft.accountId, state),
    pastDueAfter: pastDue(draft.accountId, after),
    unappliedCreditBefore: unappliedCreditTotal(draft.accountId, state),
    unappliedCreditAfter: unappliedCreditTotal(draft.accountId, after),
    quickbooksBefore: buildQuickbooksSync(draft.accountId, state, ledgerWrites),
    quickbooksAfter: buildQuickbooksSync(draft.accountId, after, [...ledgerWrites, ...writes]),
  };
}

// ---------------------------------------------------------------------------------------------
// Hold or suspend, with the route stub (Phase 6, invariant 4)
// ---------------------------------------------------------------------------------------------

/** A route stop's outcome in the stub: the contract's ServiceEvent outcomes plus a display-only hold skip. */
export type StubOutcome = ServiceEvent['outcome'] | 'skippedHold';

export type HoldMode = 'hold' | 'suspend' | 'reinstate';

export interface HoldDraft {
  accountId: string;
  mode: HoldMode;
  /** First date the change applies to route stops. Default TODAY; never before TODAY. */
  effectiveFrom: string;
  /** Holds: the date service resumes (required, after effectiveFrom). */
  resumeOn?: string;
  /** Suspensions: non-payment or customer request. */
  reason?: SuspensionReason;
}

export interface RouteStubStop {
  date: string;
  /** recorded: a ServiceEvent from the field; projected: a future service day on the route. */
  kind: 'recorded' | 'projected';
  event?: ServiceEvent;
  /** The outcome as things stand (for a recorded stop, what happened). */
  now: StubOutcome;
  /** The outcome once the drafted change is confirmed. */
  after: StubOutcome;
}

export interface RouteStubSite {
  site: Site;
  route?: Route;
  /** Stops on the same route that are not this site: the truck still runs for them. */
  otherStops: number;
  stops: RouteStubStop[];
}

/** Projected service days per site in the stub, and recorded field stops shown before them. */
export const ROUTE_STUB_PROJECTED = 4;
export const ROUTE_STUB_RECORDED = 2;

/** The first date on or after `from` that falls on the route's day, then one a week. */
export function routeServiceDays(route: Route, from: string, count: number): string[] {
  const first = weekdayOf(from) === route.day ? from : nextWeekday(from, route.day);
  return Array.from({ length: count }, (_, i) => addDays(first, i * 7));
}

/** The open hold's resume date, when the office set one this session (seeded holds carry none the engine can read). */
function openHoldResumeOn(accountId: string, statusChanges: StatusChange[]): string | undefined {
  const last = [...statusChanges].reverse().find((c) => c.accountId === accountId);
  return last?.kind === 'hold' ? last.resumeOn : undefined;
}

/** What a future stop does under an account status (and, for a hold, its resume date). */
export function outcomeForStatus(status: BillingAccount['status'], date: string, resumeOn?: string): StubOutcome {
  if (status === 'suspended') return 'skippedSuspended';
  if (status === 'hold') return resumeOn && date >= resumeOn ? 'completed' : 'skippedHold';
  return 'completed';
}

function outcomeAfter(draft: HoldDraft, date: string, now: StubOutcome): StubOutcome {
  if (date < draft.effectiveFrom) return now;
  if (draft.mode === 'suspend') return 'skippedSuspended';
  if (draft.mode === 'hold') return draft.resumeOn && date >= draft.resumeOn ? 'completed' : 'skippedHold';
  return 'completed';
}

/**
 * The route stub for each of the account's sites: the last two recorded field stops (what happened), then the next
 * four service days on the site's route from the effective date, each with its outcome now and after the drafted
 * change. Without a draft, `after` equals `now`. Pure over state.
 */
export function buildRouteStub(
  accountId: string,
  draft: HoldDraft | undefined,
  state: EntityState,
  statusChanges: StatusChange[] = [],
): RouteStubSite[] {
  const account = state.billingAccounts.byId[accountId];
  if (!account) return [];
  const resumeOn = openHoldResumeOn(accountId, statusChanges);
  const from = draft?.effectiveFrom ?? TODAY;
  return sitesOf(accountId, state).map((site): RouteStubSite => {
    const route = site.routeId ? state.routes.byId[site.routeId] : undefined;
    const recorded = listOf(state.serviceEvents)
      .filter((e) => e.siteId === site.id && e.date <= TODAY)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .slice(-ROUTE_STUB_RECORDED)
      .map((event): RouteStubStop => ({ date: event.date, kind: 'recorded', event, now: event.outcome, after: event.outcome }));
    const projected = route
      ? routeServiceDays(route, from < TODAY ? TODAY : from, ROUTE_STUB_PROJECTED).map((date): RouteStubStop => {
          const now = outcomeForStatus(account.status, date, resumeOn);
          return { date, kind: 'projected', now, after: draft ? outcomeAfter(draft, date, now) : now };
        })
      : [];
    return {
      site,
      route,
      otherStops: route ? route.stopSiteIds.filter((id) => id !== site.id).length : 0,
      stops: [...recorded, ...projected],
    };
  });
}

export interface HoldItemEffect {
  item: ServiceItem;
  catalog?: ServiceCatalog;
  site: Site;
  before: ServiceItem['status'];
  after: ServiceItem['status'];
}

export interface HoldPreview {
  draft: HoldDraft;
  statusBefore: BillingAccount['status'];
  statusAfter: BillingAccount['status'];
  /** Every non-ended ServiceItem on the account, with its status before and after (effective dates never move). */
  items: HoldItemEffect[];
  routeStub: RouteStubSite[];
  /** Next run totals including the office's proposed charges, before and after (after includes a new reinstatement fee). */
  nextRunBeforeCents: number;
  nextRunAfterCents: number;
  nextRunAfterLines: number;
  cycleDate?: string;
  /** Hauler policy fee (2500), noted as due on reinstatement for a suspension. */
  reinstatementFeeCents: number;
  /** Reinstating a suspension: the fee Charge proposeReinstatementFee() will add to the sidecar. */
  fee?: Charge;
  billingBefore: SyncStatus;
  billingAfter: SyncStatus;
  /** The state after confirm, for anything else a drawer wants to compare. */
  nextState: EntityState;
  error?: string;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The next invoice estimate: the run's total plus the office's proposed charges, which a suspended account leaves out. */
export function nextRunEstimate(status: BillingAccount['status'], preview: NextRunPreview, officeProposed: Charge[]): number {
  return preview.totalCents + (status === 'suspended' ? 0 : officeProposed.reduce((sum, c) => sum + c.totalCents, 0));
}

/** Validation for a hold draft; undefined when it can be confirmed. */
export function holdDraftError(draft: HoldDraft, state: EntityState): string | undefined {
  const account = state.billingAccounts.byId[draft.accountId];
  if (!account) return `No account ${draft.accountId}`;
  const inForce = account.status === 'suspended' || account.status === 'hold';
  if (draft.mode === 'reinstate' && !inForce) return 'The account is not on hold or suspended';
  if (draft.mode !== 'reinstate' && inForce) return `The account is already ${account.status === 'hold' ? 'on hold' : 'suspended'}; resume or reinstate it first`;
  if (!ISO_DAY.test(draft.effectiveFrom)) return 'Effective date must be a date';
  if (draft.effectiveFrom < TODAY) return `Effective date cannot be before today (${TODAY})`;
  if (draft.mode === 'hold') {
    if (!draft.resumeOn || !ISO_DAY.test(draft.resumeOn)) return 'A vacation hold needs a resume date';
    if (draft.resumeOn <= draft.effectiveFrom) return 'The resume date must be after the hold starts';
  }
  if (draft.mode === 'suspend' && !draft.reason) return 'Choose why the account is being suspended';
  return undefined;
}

/**
 * Everything the Hold or suspend drawer shows before confirm, computed on a shadow state: the status and item flips
 * setAccountStatus will make, the route stub with each stop's outcome now and after, the next billing run before and
 * after (a suspension empties it, invariant 4; a hold leaves it unchanged, no proration), and for a reinstated
 * suspension the proposed fee through computeCharge. Pure: nothing is written.
 */
export function buildHoldPreview(draft: HoldDraft, state: EntityState, sidecars: Partial<SidecarState> = {}): HoldPreview {
  const account = state.billingAccounts.byId[draft.accountId];
  if (!account) throw new EngineError(`BillingAccount ${draft.accountId} not found`);
  const error = holdDraftError(draft, state);
  const statusBefore = account.status;
  const statusAfter: BillingAccount['status'] =
    draft.mode === 'hold' ? 'hold' : draft.mode === 'suspend' ? 'suspended' : statusAfterReinstatement(draft.accountId, state);
  const itemAfter = statusAfter === 'hold' || statusAfter === 'suspended' ? 'held' : 'active';

  const sites = sitesOf(draft.accountId, state);
  const items: HoldItemEffect[] = sites.flatMap((site) =>
    itemsOfSite(site.id, state)
      .filter((item) => item.status !== 'ended')
      .map((item) => ({ item, catalog: state.serviceCatalog.byId[item.catalogId], site, before: item.status, after: itemAfter })),
  );
  const nextState = withRows(state, {
    billingAccounts: [{ ...account, status: statusAfter }],
    serviceItems: items.filter((e) => e.before !== e.after).map((e) => ({ ...e.item, status: e.after })),
  });

  const fee =
    draft.mode === 'reinstate' && statusBefore === 'suspended'
      ? buildReinstatementFee({ accountId: draft.accountId, sourceId: peekId('sc') }, state)
      : undefined;
  const office = (sidecars.proposedCharges ?? []).filter((c) => c.accountId === draft.accountId && c.status === 'proposed');
  const before = previewNextRun(draft.accountId, state);
  const after = previewNextRun(draft.accountId, nextState);
  const siteIds = sites.map((s) => s.id);
  const officeAfter = fee ? [...office, fee] : office;

  return {
    draft,
    statusBefore,
    statusAfter,
    items,
    routeStub: buildRouteStub(draft.accountId, draft, state, sidecars.statusChanges ?? []),
    nextRunBeforeCents: nextRunEstimate(statusBefore, before, office),
    nextRunAfterCents: nextRunEstimate(statusAfter, after, officeAfter),
    nextRunAfterLines: after.recurring.length + after.events.length + after.proposed.length + (statusAfter === 'suspended' ? 0 : officeAfter.length),
    cycleDate: before.cycleDate,
    reinstatementFeeCents: reinstatementFeeCents(state),
    fee,
    billingBefore: buildSync(draft.accountId, siteIds, state, [], sidecars.proposedCharges ?? []).billing,
    billingAfter: buildSync(draft.accountId, siteIds, nextState, [], officeAfter).billing,
    nextState,
    error,
  };
}
