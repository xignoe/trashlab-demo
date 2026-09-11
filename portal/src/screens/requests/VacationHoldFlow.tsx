// Vacation hold: start and end dates, the policy check shown as rows, then a portal-local hold row per active service
// (the ServiceItem hold itself is stubbed for account), and the Overview shows the range. A range outside policy shows the reason inline and offers the
// office an exception through the HandoffCard.

import { useMemo, useState } from 'react';
import { useStore, type Hold } from '../../store/useStore';
import { holdableServiceItems, routeForSite, serviceItemsForSite } from '../../store/selectors';
import { HOLD_POLICY, HOLD_POLICY_TEXT, checkHoldPolicy } from '../../store/engine';
import { TODAY, addDays, formatDate, formatDayLong, nextRouteDay, tomorrow } from '../../store/clock';
import { HandoffCard } from '../../components/HandoffCard';
import { CheckRows, type CheckRow } from './CheckRows';
import type { Request } from '../../types';

export function VacationHoldFlow({ onDone }: { onDone: () => void }) {
  const state = useStore();
  const { accountId, siteId } = state.session;
  const account = state.accounts.find((a) => a.id === accountId)!;
  const route = routeForSite(state, siteId);
  const active = holdableServiceItems(state, siteId, TODAY);
  // Held means held by the office (status held) or already covered by a portal hold row.
  const held = serviceItemsForSite(state, siteId).filter((i) => i.status !== 'ended' && !active.includes(i));

  const minStart = tomorrow(TODAY);
  const [start, setStart] = useState(addDays(TODAY, 4));
  const [end, setEnd] = useState(addDays(TODAY, 18));
  const [askOffice, setAskOffice] = useState(false);
  const [placed, setPlaced] = useState<{ holds: Hold[]; request: Request } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const policy = useMemo(() => checkHoldPolicy(start, end, TODAY), [start, end]);
  const dateOk = start >= minStart && end > start;
  const checks: CheckRow[] = [
    {
      id: 'dates', label: 'Dates are in the future and in order', ok: dateOk,
      detail: !dateOk ? (policy.reason ?? 'Fix the dates') : `${formatDate(start)} to ${formatDate(end)}`,
    },
    {
      id: 'policy', label: HOLD_POLICY_TEXT, ok: dateOk && policy.ok,
      detail: !dateOk ? 'Waiting on valid dates' : policy.ok ? `${policy.days} days, inside policy` : (policy.reason ?? ''),
    },
    {
      id: 'activeService', label: 'Active service to hold', ok: active.length > 0,
      detail: active.length > 0 ? `${active.length} active service${active.length === 1 ? '' : 's'} at this site` : held.length > 0 ? 'Service at this site is already on hold' : 'No active service at this site',
    },
  ];
  const allOk = checks.every((c) => c.ok);
  const resumes = route ? nextRouteDay(route.day, end) : addDays(end, 1);
  const policyFail = dateOk && !policy.ok;

  const confirm = () => {
    try {
      setPlaced(state.placeHold({ accountId, siteId, start, end }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (placed) {
    return (
      <div className="flex flex-col gap-3">
        <div className="tl-card flex flex-col gap-2" style={{ background: 'var(--color-ok-soft)', borderColor: 'transparent' }}>
          <div className="flex items-center gap-2">
            <span className="tl-pill tl-pill--ok">scheduled</span>
            <span className="font-medium">On hold {formatDate(start)} to {formatDate(end)}</span>
          </div>
          <p className="text-sm text-ink-2">Pickups resume {formatDayLong(resumes)}. The office applies the hold to your services and billing for this range.</p>
        </div>
        <dl className="text-sm grid gap-x-3 gap-y-1" style={{ gridTemplateColumns: 'auto 1fr' }}>
          <dt className="text-ink-3">Request</dt><dd className="font-mono">{placed.request.id}</dd>
          <dt className="text-ink-3">Services held</dt>
          <dd>{placed.holds.map((h) => state.catalog.find((c) => c.id === state.serviceItems.find((i) => i.id === h.serviceItemId)?.catalogId)?.name ?? h.serviceItemId).join(', ')}</dd>
          <dt className="text-ink-3">Next step</dt><dd>The office pauses these services for the range; nothing else for you to do.</dd>
        </dl>
        <div><button type="button" className="tl-button" onClick={onDone}>Back to requests</button></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-2">
        Pause every service at this site while you are away. {HOLD_POLICY_TEXT}. Pickups resume on the first route day after the hold ends.
      </p>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', maxWidth: 440 }}>
        <div>
          <label className="tl-label" htmlFor="hold-start">Hold starts</label>
          <input id="hold-start" type="date" className="tl-field" min={minStart} value={start} onChange={(e) => { setStart(e.target.value); setAskOffice(false); }} />
        </div>
        <div>
          <label className="tl-label" htmlFor="hold-end">Hold ends</label>
          <input id="hold-end" type="date" className="tl-field" min={addDays(start, 1)} value={end} onChange={(e) => { setEnd(e.target.value); setAskOffice(false); }} />
        </div>
      </div>
      <CheckRows title="Checks" checks={checks} />

      {allOk && active.length > 0 && (
        <div className="tl-card text-sm flex flex-col gap-1" style={{ background: 'var(--color-surface-2)' }}>
          <div>Hold {formatDate(start)} to {formatDate(end)}, {policy.days} days.</div>
          <div>Pickups resume <strong>{formatDayLong(resumes)}</strong>{route ? `, the first ${route.day === 'Mon' ? 'Monday' : route.day === 'Tue' ? 'Tuesday' : route.day === 'Wed' ? 'Wednesday' : route.day === 'Thu' ? 'Thursday' : 'Friday'} after the hold` : ''}.</div>
          {account.status === 'pastDue' && <div className="text-xs text-ink-3">Your account stays past due until the open balance is paid; the hold still applies.</div>}
        </div>
      )}

      {policyFail && !askOffice && (
        <div className="tl-card flex flex-col gap-2" style={{ background: 'var(--color-danger-soft)', borderColor: 'transparent' }}>
          <div className="text-sm font-medium">{policy.reason}</div>
          <div className="text-xs text-ink-2">{HOLD_POLICY_TEXT} ({HOLD_POLICY.minDays} to {HOLD_POLICY.maxDays}). Change the dates, or ask the office to make an exception.</div>
          <div><button type="button" className="tl-button tl-button--secondary" onClick={() => setAskOffice(true)}>Ask the office for an exception</button></div>
        </div>
      )}

      {policyFail && askOffice && (
        <HandoffCard
          title="Vacation hold exception"
          reason={`Hold ${start} to ${end} is outside policy: ${policy.reason}`}
          createRequest={{ kind: 'vacationHold', accountId, siteId }}
        >
          <div><button type="button" className="tl-button tl-button--secondary" onClick={onDone}>Back to requests</button></div>
        </HandoffCard>
      )}

      {active.length === 0 && (
        <HandoffCard
          title="Vacation hold"
          reason={held.length > 0 ? 'Service at this site is already on hold' : 'No active service at this site'}
          createRequest={{ kind: 'vacationHold', accountId, siteId }}
        >
          <div><button type="button" className="tl-button tl-button--secondary" onClick={onDone}>Back to requests</button></div>
        </HandoffCard>
      )}

      {error && <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>}

      {!askOffice && active.length > 0 && (
        <div className="flex gap-2">
          <button type="button" className="tl-button" disabled={!allOk} onClick={confirm}>Place hold</button>
          <button type="button" className="tl-button tl-button--secondary" onClick={onDone}>Cancel</button>
        </div>
      )}
    </div>
  );
}
