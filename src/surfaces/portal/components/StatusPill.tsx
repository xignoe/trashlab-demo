// One pill component for every status the portal shows, so the color mapping lives in one place.
// DESIGN.md: active is ok, pastDue is danger, hold is warn, suspended is neutral, informational is info.

import type { BillingAccount, Request, ServiceEvent, ServiceItem } from '../../../types';

type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const cls = tone === 'neutral' ? 'tl-pill' : `tl-pill tl-pill--${tone}`;
  return <span className={cls}>{children}</span>;
}

const ACCOUNT: Record<BillingAccount['status'], [Tone, string]> = {
  active: ['ok', 'Active'],
  pastDue: ['danger', 'Past due'],
  suspended: ['neutral', 'Suspended'],
  hold: ['warn', 'On hold'],
};

export function AccountStatusPill({ status }: { status: BillingAccount['status'] }) {
  const [tone, label] = ACCOUNT[status];
  return <Pill tone={tone}>{label}</Pill>;
}

const OUTCOME: Record<ServiceEvent['outcome'], [Tone, string]> = {
  completed: ['ok', 'Completed'],
  missed: ['danger', 'Missed'],
  blocked: ['warn', 'Blocked'],
  skippedSuspended: ['neutral', 'Skipped, suspended'],
};

export function OutcomePill({ outcome }: { outcome: ServiceEvent['outcome'] }) {
  const [tone, label] = OUTCOME[outcome];
  return <Pill tone={tone}>{label}</Pill>;
}

const REQUEST: Record<Request['status'], [Tone, string]> = {
  open: ['info', 'open'],
  scheduled: ['ok', 'scheduled'],
  done: ['neutral', 'done'],
  declined: ['danger', 'declined'],
};

/** Uses the exact Request.status values the office sees. */
export function RequestStatusPill({ status }: { status: Request['status'] }) {
  const [tone, label] = REQUEST[status];
  return <Pill tone={tone}>{label}</Pill>;
}

const ITEM: Record<ServiceItem['status'], [Tone, string]> = {
  active: ['ok', 'Active'],
  held: ['warn', 'Held'],
  ended: ['neutral', 'Ended'],
};

export function ServiceItemStatusPill({ status }: { status: ServiceItem['status'] }) {
  const [tone, label] = ITEM[status];
  return <Pill tone={tone}>{label}</Pill>;
}

export function InfoPill({ children }: { children: React.ReactNode }) {
  return <Pill tone="info">{children}</Pill>;
}
