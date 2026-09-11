// Missed pickup. The customer picks a route day in the last 21 days (MISSED_PICKUP_WINDOW_DAYS) and the portal answers from the driver's
// ServiceEvent before anything is filed: a completed stop shows the time and photo, a blocked (or cart not out)
// stop shows the driver note and photo, a real miss books a recovery the next business day, and anything the
// record cannot answer (suspended, no record) goes to a person through the HandoffCard.

import { useState } from 'react';
import { portalState, usePortal } from '../../store';
import { defaultMissedPickupDate, missedPickupLookup, routeForSite, type MissedPickupLookup } from '../../lib/selectors';
import { MISSED_PICKUP_WINDOW_DAYS, missedPickupWindow } from '../../lib/engine';
import { today, formatDate, formatDayLong } from '../../lib/clock';
import { resolvePhoto } from '../../../../seed';
import { HandoffCard } from '../../components/HandoffCard';
import { OutcomePill, RequestStatusPill } from '../../components/StatusPill';
import type { Request, ServiceEvent, WorkOrder } from '../../../../types';

const DAY_NAMES: Record<string, string> = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday' };

/** "7:51 am" from an event timestamp, or null when the record carries no service time (T00:00:00). */
function eventTime(ev: ServiceEvent): string | null {
  const t = ev.date.slice(11, 16);
  if (!t || t === '00:00') return null;
  const [hh, mm] = t.split(':').map(Number);
  return `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'pm' : 'am'}`;
}

export function MissedPickupFlow({ onDone, onExtraPickup }: { onDone: () => void; onExtraPickup: () => void }) {
  const state = usePortal();
  const { accountId, siteId } = state.session;
  const route = routeForSite(state, siteId);
  const win = missedPickupWindow(today());
  const [date, setDate] = useState<string>(() => defaultMissedPickupDate(state, siteId, today()) ?? today());
  // The date the customer submitted. Changing the picker clears the answer so nothing is filed for a date by accident.
  const [checked, setChecked] = useState<string | null>(null);
  const [filed, setFiled] = useState<{ request: Request; workOrder?: WorkOrder } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Snapshot of the lookup at submit time; the Request this check files must not flip the branch to "already reported".
  const [lookup, setLookup] = useState<MissedPickupLookup | null>(null);

  const check = (d: string) => {
    setError(null);
    setFiled(null);
    setDate(d);
    setChecked(d);
    const l = missedPickupLookup(portalState(), siteId, d, today());
    setLookup(l);
    if (l.kind === 'missed' && !l.existing) {
      try {
        setFiled(portalState().reportMissedPickup({ accountId, siteId, date: d }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  };

  const fileOpen = (note: string) => {
    const request = state.addRequest({ accountId, siteId, kind: 'missedPickup', status: 'open', createdVia: 'portal', note });
    setFiled({ request });
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-2">
        Pick the day we should have come. We look at what the driver recorded for this stop first, so you get an answer now instead of a ticket.
      </p>

      <form
        className="flex items-end gap-3 flex-wrap"
        onSubmit={(e) => { e.preventDefault(); check(date); }}
      >
        <div>
          <label className="tl-label" htmlFor="missed-date">Pickup day</label>
          <input
            id="missed-date"
            type="date"
            className="tl-field"
            value={date}
            min={win.min}
            max={win.max}
            onChange={(e) => { setDate(e.target.value); setChecked(null); setLookup(null); setFiled(null); }}
          />
        </div>
        <button type="submit" className="tl-button" disabled={!date}>Check this day</button>
        <p className="text-xs text-ink-3 basis-full">
          {route ? `Your pickup day here is ${DAY_NAMES[route.day]}. ` : ''}
          You can report a pickup from the last {MISSED_PICKUP_WINDOW_DAYS} days, {formatDate(win.min)} to {formatDate(win.max)}.
        </p>
      </form>

      {lookup && checked && (
        <LookupResult
          lookup={lookup}
          filed={filed}
          accountId={accountId}
          siteId={siteId}
          onPick={check}
          onExtraPickup={onExtraPickup}
          onFileOpen={fileOpen}
          onDone={onDone}
        />
      )}
      {error && <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>}
    </div>
  );
}

function LookupResult({
  lookup, filed, accountId, siteId, onPick, onExtraPickup, onFileOpen, onDone,
}: {
  lookup: MissedPickupLookup;
  filed: { request: Request; workOrder?: WorkOrder } | null;
  accountId: string;
  siteId: string;
  onPick: (d: string) => void;
  onExtraPickup: () => void;
  onFileOpen: (note: string) => void;
  onDone: () => void;
}) {
  const back = <div><button type="button" className="tl-button tl-button--secondary" onClick={onDone}>Back to requests</button></div>;
  // A report filed before this check (not the one this check just filed) is shown instead of filing another.
  const prior = lookup.existing;

  if (lookup.kind === 'outOfWindow') {
    return (
      <Note tone="warn" title="Outside the reporting window">
        {formatDate(lookup.date)} is outside the last {MISSED_PICKUP_WINDOW_DAYS} days. Pick a day from {formatDate(lookup.min)} to {formatDate(lookup.max)}, or call the office about an older pickup.
      </Note>
    );
  }

  if (lookup.kind === 'noRoute') {
    return <HandoffCard title="Missed pickup" reason="No route serves this site" createRequest={{ kind: 'missedPickup', accountId, siteId }}>{back}</HandoffCard>;
  }

  if (lookup.kind === 'notRouteDay') {
    return (
      <Note tone="warn" title="Not a pickup day">
        <p>{formatDayLong(lookup.date)} is not a pickup day at this site. We come on {DAY_NAMES[lookup.route.day]}s.</p>
        {lookup.nearest ? (
          <div className="mt-2">
            <button type="button" className="tl-button" onClick={() => onPick(lookup.nearest!)}>Check {formatDayLong(lookup.nearest)} instead</button>
          </div>
        ) : (
          <p className="mt-1">There is no {DAY_NAMES[lookup.route.day]} in the reporting window yet.</p>
        )}
      </Note>
    );
  }

  const existingRow = prior && (
    <div className="tl-card flex items-center gap-3 text-sm" data-testid="already-reported">
      <RequestStatusPill status={prior.status} />
      <span>You already reported this day as <span className="font-mono">{prior.id}</span>. It is in your open items; we will not file it twice.</span>
    </div>
  );

  if (lookup.kind === 'handoff') {
    return (
      <div className="flex flex-col gap-3">
        {lookup.event && <EventCard event={lookup.event} />}
        {prior ? <>{existingRow}{back}</> : (
          <HandoffCard title="Missed pickup" reason={lookup.reason} createRequest={{ kind: 'missedPickup', accountId, siteId }}>{back}</HandoffCard>
        )}
      </div>
    );
  }

  if (lookup.kind === 'missed') {
    return (
      <div className="flex flex-col gap-3">
        <EventCard event={lookup.event} />
        {prior ? <>{existingRow}{back}</> : filed?.workOrder ? (
          <>
            <div className="tl-card flex flex-col gap-2" style={{ background: 'var(--color-ok-soft)', borderColor: 'transparent' }} data-testid="recovery-booked">
              <div className="flex items-center gap-2">
                <span className="tl-pill tl-pill--ok">scheduled</span>
                <span className="font-medium">We missed you. A recovery pickup is booked for {formatDayLong(filed.workOrder.scheduledFor)}.</span>
              </div>
              <p className="text-sm text-ink-2">Leave the cart where it is. A truck comes back for it on {formatDayLong(filed.workOrder.scheduledFor)} at no charge.</p>
            </div>
            <dl className="text-sm grid gap-x-3 gap-y-1" style={{ gridTemplateColumns: 'auto 1fr' }}>
              <dt className="text-ink-3">Work order</dt><dd className="font-mono">{filed.workOrder.id} (recovery, {formatDayLong(filed.workOrder.scheduledFor)})</dd>
              <dt className="text-ink-3">Request</dt><dd className="font-mono">{filed.request.id}</dd>
            </dl>
            {back}
          </>
        ) : null}
      </div>
    );
  }

  if (lookup.kind === 'notReachable') {
    const ev = lookup.event;
    const why = ev.outcome === 'blocked' ? 'the driver could not reach the cart' : 'the cart was not out at the curb';
    const disputeNote = `Customer disputes ${ev.outcome === 'blocked' ? 'blocked' : 'cart not out'} outcome on ${lookup.date}`;
    return (
      <div className="flex flex-col gap-3">
        <EventCard event={ev} />
        <Note tone="warn" title="No recovery pickup is scheduled">
          The driver came on {formatDayLong(lookup.date)}, but {why}, so this does not count as a missed pickup and no return trip is booked. If the cart is out now, an extra pickup gets it on your next route day.
        </Note>
        {prior ? existingRow : filed ? <Filed request={filed.request} /> : null}
        {/* The extra pickup stays on offer after a dispute; only a second dispute of the same day is withheld. */}
        <div className="flex gap-2 flex-wrap">
          <button type="button" className="tl-button" onClick={onExtraPickup}>Set it out and request an extra pickup</button>
          {!prior && !filed && (
            <button type="button" className="tl-button tl-button--secondary" onClick={() => onFileOpen(disputeNote)}>Dispute this</button>
          )}
        </div>
      </div>
    );
  }

  // completed
  return <CompletedResult lookup={lookup} prior={existingRow} filed={filed} onFileOpen={onFileOpen} back={back} />;
}

function CompletedResult({
  lookup, prior, filed, onFileOpen, back,
}: {
  lookup: Extract<MissedPickupLookup, { kind: 'completed' }>;
  prior: React.ReactNode;
  filed: { request: Request } | null;
  onFileOpen: (note: string) => void;
  back: React.ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState('');
  const ev = lookup.event;
  const time = eventTime(ev);
  return (
    <div className="flex flex-col gap-3">
      <div className="tl-card flex flex-col gap-1" style={{ background: 'var(--color-ok-soft)', borderColor: 'transparent' }} data-testid="completed-stop">
        <span className="font-medium">
          Our driver completed this stop{time ? ` at ${time}` : ''} on {formatDayLong(lookup.date)}.
        </span>
        <span className="text-sm text-ink-2">Driver {ev.driver}. There is nothing to recover, so we have not opened a request.</span>
      </div>
      <EventCard event={ev} />
      {prior ? <>{prior}{back}</> : filed ? (
        <><Filed request={filed.request} />{back}</>
      ) : !asking ? (
        <div>
          <button type="button" className="tl-button tl-button--ghost" style={{ padding: 0, height: 'auto', textDecoration: 'underline' }} onClick={() => setAsking(true)}>
            Something still wrong? Ask the office
          </button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2"
          style={{ maxWidth: 520 }}
          onSubmit={(e) => {
            e.preventDefault();
            const t = text.trim();
            if (t) onFileOpen(`Customer note on completed stop ${lookup.date}: ${t}`);
          }}
        >
          <label className="tl-label" htmlFor="missed-note">What is still wrong?</label>
          <textarea id="missed-note" className="tl-field" rows={3} style={{ height: 'auto', padding: 8 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="For example: the recycling cart was not emptied" />
          <div className="flex gap-2">
            <button type="submit" className="tl-button" disabled={!text.trim()}>Send to the office</button>
            <button type="button" className="tl-button tl-button--secondary" onClick={() => setAsking(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

function Filed({ request }: { request: Request }) {
  return (
    <div className="tl-card flex items-center gap-3 text-sm" data-testid="missed-filed">
      <RequestStatusPill status={request.status} />
      <span>Sent to the office as <span className="font-mono">{request.id}</span>. A person reads it and follows up; it is in your open items.</span>
    </div>
  );
}

/** What the driver recorded: outcome, time, driver, note, and the photo when there is one. */
function EventCard({ event }: { event: ServiceEvent }) {
  const photo = resolvePhoto(event.photoUrl);
  const time = eventTime(event);
  return (
    <div className="tl-card flex gap-4" data-testid="event-card" data-event={event.id}>
      {photo ? (
        <img src={photo} alt={event.note ?? `Photo from ${event.date.slice(0, 10)}`} style={{ width: 200, height: 150, objectFit: 'cover', borderRadius: 'var(--radius-md, 8px)', flexShrink: 0 }} />
      ) : (
        <div className="text-xs text-ink-3 flex items-center justify-center" style={{ width: 200, height: 150, flexShrink: 0, background: 'var(--color-surface-2, #f3f3f1)', borderRadius: 8 }}>
          No photo on file for this stop
        </div>
      )}
      <div className="flex flex-col gap-1 text-sm">
        <div className="flex items-center gap-2">
          <OutcomePill outcome={event.outcome} />
          {event.exception && <span className="tl-pill">{event.exception}</span>}
        </div>
        <div className="font-medium">{formatDayLong(event.date)}{time ? `, ${time}` : ''}</div>
        <div className="text-ink-2">Driver {event.driver}</div>
        {event.note && <div className="text-ink-2">Driver note: "{event.note}"</div>}
        <div className="font-mono text-xs text-ink-3">{event.id}</div>
      </div>
    </div>
  );
}

function Note({ tone, title, children }: { tone: 'warn' | 'info'; title: string; children: React.ReactNode }) {
  return (
    <div className="tl-card text-sm flex flex-col gap-1" style={{ background: `var(--color-${tone}-soft)`, borderColor: 'transparent' }} role="status">
      <span className="font-medium">{title}</span>
      <div className="text-ink-2">{children}</div>
    </div>
  );
}
