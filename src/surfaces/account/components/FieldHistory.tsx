// "Did you miss me?" Last 14 days of ServiceEvents across the account's sites, newest first.
import { FIELD_HISTORY_DAYS, ROUTE_DAY_LONG, type AccountView } from '../selectors';
import { EXCEPTION_LABEL, OUTCOME_LABEL, OUTCOME_PILL, fmtDay, plural } from './format';
import { PhotoThumb } from './PhotoThumb';

export function FieldHistory({ view }: { view: AccountView }) {
  const events = view.fieldEvents;
  const multiSite = view.sites.length > 1;
  const routes = Array.from(new Set(view.sites.map((s) => s.route?.day).filter((d): d is NonNullable<typeof d> => Boolean(d))));
  return (
    <section className="panel" aria-label="Field history">
      <div className="card-head">
        <h2 className="card-title">Did you miss me? Last {FIELD_HISTORY_DAYS} days</h2>
        <span className="card-note">{routes.length ? routes.map((d) => `${ROUTE_DAY_LONG[d]} route`).join(', ') : 'No route'}</span>
      </div>
      {events.length === 0 ? (
        <div className="card-empty">No stops in the last {FIELD_HISTORY_DAYS} days</div>
      ) : (
        <div className="row-list">
          {events.map(({ event, site, route }) => {
            const body = (
              <div className="row-body">
                <div className="row-title">
                  <span className={`pill ${OUTCOME_PILL[event.outcome]}`}>{OUTCOME_LABEL[event.outcome]}</span>
                  {event.exception && <span className="pill pill-warn">{EXCEPTION_LABEL[event.exception]}</span>}
                </div>
                <div className="meta">
                  {[multiSite ? site?.address : undefined, route ? `${ROUTE_DAY_LONG[route.day]} route` : undefined, event.driver]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                {event.note && <div style={{ fontSize: 'var(--text-sm)', lineHeight: '18px' }}>{event.note}</div>}
              </div>
            );
            return (
              <div className="row" key={event.id}>
                <div className="row-date">{fmtDay(event.date)}</div>
                {event.photoUrl ? (
                  <div className="row-with-thumb">
                    <PhotoThumb url={event.photoUrl} alt={`Driver photo, ${event.exception ? EXCEPTION_LABEL[event.exception] : OUTCOME_LABEL[event.outcome]}, ${event.date}`} />
                    {body}
                  </div>
                ) : (
                  body
                )}
              </div>
            );
          })}
        </div>
      )}
      {events.length > 0 && <div className="meta">{plural(events.length, 'stop')} recorded</div>}
    </section>
  );
}
