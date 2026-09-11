// Display formatting for the account view. Money is integer cents in, "$1,234.56" out.
// Dates are ISO strings in, "Sep 7, 2026" out. Nothing here touches the store.
import type { BillingAccount, Charge, Party, Payment, Request, ServiceEvent, WorkOrder } from '../types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  const rem = String(abs % 100).padStart(2, '0');
  return `${sign}$${dollars}.${rem}`;
}

/** "Sep 7, 2026" from an ISO date or datetime string. Empty input renders empty. */
export function fmtDate(iso?: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "Sep 7" for dense rows where the year is obvious. */
export function fmtDay(iso?: string): string {
  if (!iso) return '';
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** "10:42 AM" from an ISO datetime; empty when the string carries no time. */
export function fmtTime(iso?: string): string {
  if (!iso || iso.length < 16) return '';
  const h = Number(iso.slice(11, 13));
  const min = iso.slice(14, 16);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${min} ${suffix}`;
}

export function fmtPeriod(p?: { start: string; end: string }): string {
  if (!p) return '';
  return `${fmtDay(p.start)} to ${fmtDate(p.end)}`;
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

export const CYCLE_LABEL: Record<BillingAccount['cycle'], string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  perJob: 'Per job',
  net30: 'Net 30',
};

export const DELIVERY_LABEL: Record<BillingAccount['deliveryMethod'], string> = {
  email: 'Invoices by email',
  mail: 'Invoices by mail',
  portal: 'Invoices in the portal',
};

export const STATUS_LABEL: Record<BillingAccount['status'], string> = {
  active: 'Active',
  pastDue: 'Past due',
  suspended: 'Suspended',
  hold: 'On hold',
};

export const PARTY_KIND_LABEL: Record<Party['kind'], string> = {
  homeowner: 'Homeowner',
  business: 'Business',
  contractor: 'Contractor',
  propertyManager: 'Property manager',
  hoa: 'HOA',
};

export const METHOD_LABEL: Record<Payment['method'], string> = {
  check: 'check',
  card: 'card',
  ach: 'ACH',
  autopay: 'autopay',
  cash: 'cash',
};

export const PAYMENT_METHOD_ON_FILE: Record<NonNullable<BillingAccount['paymentMethodOnFile']>, string> = {
  card: 'Card on file',
  ach: 'ACH on file',
};

export const RULE_LABEL: Record<Charge['pricing']['ruleWon'], string> = {
  contractOverride: 'Contract',
  zoneRate: 'Rate card',
  standardRate: 'Rate card',
  manualException: 'Exception',
};

/** DESIGN.md: rate card = info, contract = accent, exception = warn. */
export const RULE_PILL: Record<Charge['pricing']['ruleWon'], string> = {
  contractOverride: 'pill-accent',
  zoneRate: 'pill-info',
  standardRate: 'pill-info',
  manualException: 'pill-warn',
};

export const LINE_TYPE_LABEL: Record<Charge['lineType'], string> = {
  recurring: 'Recurring',
  event: 'Event',
  fee: 'Fee',
  lateFee: 'Late fee',
};

export const OUTCOME_LABEL: Record<ServiceEvent['outcome'], string> = {
  completed: 'Completed',
  missed: 'Missed',
  blocked: 'Blocked',
  skippedSuspended: 'Skipped, suspended',
};

export const OUTCOME_PILL: Record<ServiceEvent['outcome'], string> = {
  completed: 'pill-ok',
  missed: 'pill-danger',
  blocked: 'pill-danger',
  skippedSuspended: 'pill-warn',
};

export const EXCEPTION_LABEL: Record<NonNullable<ServiceEvent['exception']>, string> = {
  extraBags: 'Extra bags',
  overload: 'Overload',
  contamination: 'Contamination',
  dryRun: 'Dry run',
  notOut: 'Not out',
};

export const WO_KIND_LABEL: Record<WorkOrder['kind'], string> = {
  deliver: 'Deliver',
  swap: 'Swap',
  remove: 'Remove',
  extraPickup: 'Extra pickup',
  recovery: 'Recovery',
  dumpAndReturn: 'Dump and return',
};

export const WO_STATUS_PILL: Record<WorkOrder['status'], string> = {
  open: 'pill-info',
  scheduled: 'pill-accent',
  done: 'pill-ok',
  cancelled: 'pill',
};

export const REQUEST_KIND_LABEL: Record<Request['kind'], string> = {
  extraPickup: 'Extra pickup',
  vacationHold: 'Vacation hold',
  cartChange: 'Cart change',
  missedPickup: 'Missed pickup',
  quote: 'Quote',
};

export const REQUEST_STATUS_PILL: Record<Request['status'], string> = {
  open: 'pill-info',
  scheduled: 'pill-accent',
  done: 'pill-ok',
  declined: 'pill',
};

export const CREATED_VIA_LABEL: Record<Request['createdVia'], string> = {
  portal: 'portal',
  phone: 'phone',
  agent: 'Haul-E agent',
  storefront: 'storefront',
};

/** Title case for an id-like token: "wo_maple_swap" stays as is; used only for labels we do not own. */
export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Issue credit reasons (Phase 5). The CreditMemo stores the key, with the office note folded in after a colon. */
export const CREDIT_REASON_LABEL: Record<string, string> = {
  goodwill: 'Goodwill',
  missedPickup: 'Missed pickup',
  billingError: 'Billing error',
  salesPromise: 'Sales promise',
  operationalFault: 'Operational fault',
  other: 'Other',
};

/** "missedPickup: Missed 2026-08-24" reads as "Missed pickup: Missed 2026-08-24"; unknown keys pass through. */
export function creditReasonText(reason: string): string {
  const i = reason.indexOf(': ');
  const key = i >= 0 ? reason.slice(0, i) : reason;
  const label = CREDIT_REASON_LABEL[key] ?? key;
  return i >= 0 ? `${label}: ${reason.slice(i + 2)}` : label;
}

export const PAYMENT_STATUS_PILL: Record<Payment['status'], string> = {
  pending: 'pill-info',
  settled: 'pill-ok',
  returned: 'pill-danger',
};

/** Route stub outcomes (Phase 6): the contract's ServiceEvent outcomes plus the display-only hold skip. */
export const STUB_OUTCOME_LABEL: Record<ServiceEvent['outcome'] | 'skippedHold', string> = {
  ...OUTCOME_LABEL,
  skippedHold: 'Skipped, hold',
};

export const STUB_OUTCOME_PILL: Record<ServiceEvent['outcome'] | 'skippedHold', string> = {
  ...OUTCOME_PILL,
  skippedHold: 'pill-hold',
};

export const SUSPENSION_REASON_LABEL: Record<'nonPayment' | 'customerRequest', string> = {
  nonPayment: 'Non-payment',
  customerRequest: 'Customer request',
};
