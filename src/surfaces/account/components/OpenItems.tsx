// Open items: WorkOrders and Requests for the account, open first; done and cancelled collapsed under a toggle.
// Requests are every db.requests row on the account, whoever filed them: the customer in the portal, or the office by
// phone (box 3.6 made the office's phone requests Request rows). A Request that produced a WorkOrder names it. An open
// WorkOrder carries a "Mark scheduled" button, which is what flips the dispatch sync chip back to in sync.
import { useState } from 'react';
import { portalHoldDraft, type AccountView, type PortalHoldDraft } from '../selectors';
import { useStore } from '../../../store/useStore';
import { CREATED_VIA_LABEL, REQUEST_KIND_LABEL, REQUEST_STATUS_PILL, WO_KIND_LABEL, WO_STATUS_PILL, capitalize, fmtDay, plural } from './format';

/**
 * onApplyHold: a vacation hold the customer asked for in the portal offers "Apply hold", which opens the hold drawer
 * with the portal's dates (box 3.3). A status change is the office's call, so the portal never makes it itself.
 */
export function OpenItems({ view, onApplyHold }: { view: AccountView; onApplyHold?: (draft: PortalHoldDraft) => void }) {
  const [showClosed, setShowClosed] = useState(false);
  const setWorkOrderStatus = useStore((s) => s.setWorkOrderStatus);
  const db = useStore((s) => s.db);
  const holds = useStore((s) => s.holds);
  const canHold = view.account.status === 'active' || view.account.status === 'pastDue';
  const openWos = view.workOrders.filter((w) => w.isOpen);
  const closedWos = view.workOrders.filter((w) => !w.isOpen);
  const openReqs = view.requests.filter((r) => r.isOpen);
  const closedReqs = view.requests.filter((r) => !r.isOpen);
  const wos = showClosed ? view.workOrders : openWos;
  const reqs = showClosed ? view.requests : openReqs;
  const closedCount = closedWos.length + closedReqs.length;
  const noteParts = [openWos.length ? plural(openWos.length, 'work order') : undefined, openReqs.length ? plural(openReqs.length, 'request') : undefined].filter(Boolean);

  return (
    <section className="panel" aria-label="Open items">
      <div className="card-head">
        <h2 className="card-title">Open items</h2>
        <span className="card-note">{noteParts.length ? noteParts.join(', ') : 'nothing open'}</span>
      </div>
      {wos.length === 0 && reqs.length === 0 ? (
        <div className="card-empty">No open work orders or requests</div>
      ) : (
        <div className="row-list">
          {wos.map(({ workOrder: wo, site, container, catalog }) => (
            <div className="row" key={wo.id}>
              <div className="row-date">{fmtDay(wo.scheduledFor)}</div>
              <div className="row-body">
                <div className="row-title">
                  <span>{WO_KIND_LABEL[wo.kind]}{catalog ? ` ${catalog.name}` : ''}</span>
                  <span className={`pill ${WO_STATUS_PILL[wo.status]}`}>{capitalize(wo.status)}</span>
                </div>
                <div className="meta cluster">
                  <code className="code">{wo.id}</code>
                  {site && <span>{site.address}</span>}
                  {container && <code className="code">{container.serial}</code>}
                  {wo.serviceItemId && <span>item <code className="code">{wo.serviceItemId}</code></span>}
                  {wo.completedAt && <span>done {fmtDay(wo.completedAt)}</span>}
                  {wo.requestId && <span>for request <code className="code">{wo.requestId}</code></span>}
                </div>
                {wo.status === 'open' && (
                  <div className="row-actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setWorkOrderStatus(wo.id, 'scheduled')}>
                      Mark scheduled
                    </button>
                    <span className="meta">Dispatch has not put it on a route yet</span>
                  </div>
                )}
              </div>
            </div>
          ))}
          {reqs.map(({ request: r, site, workOrder }) => {
            const hold = onApplyHold && canHold ? portalHoldDraft(r, db, holds) : undefined;
            return (
            <div className="row" key={r.id}>
              <div className="row-date">Request</div>
              <div className="row-body">
                <div className="row-title">
                  <span>{REQUEST_KIND_LABEL[r.kind]}</span>
                  <span className={`pill ${REQUEST_STATUS_PILL[r.status]}`}>{capitalize(r.status)}</span>
                </div>
                <div className="meta cluster">
                  <code className="code">{r.id}</code>
                  <span>via {CREATED_VIA_LABEL[r.createdVia]}</span>
                  {site && <span>{site.address}</span>}
                  {workOrder && <span>work order <code className="code">{workOrder.id}</code></span>}
                </div>
                {r.note && <div style={{ fontSize: 'var(--text-sm)', lineHeight: '18px' }}>{r.note}</div>}
                {hold && onApplyHold && (
                  <div className="row-actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onApplyHold(hold)}>
                      Apply hold
                    </button>
                    <span className="meta">From {fmtDay(hold.effectiveFrom)}, resume {fmtDay(hold.resumeOn)}; opens the hold drawer</span>
                  </div>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}
      {closedCount > 0 && (
        <button type="button" className="toggle" onClick={() => setShowClosed((v) => !v)} aria-expanded={showClosed}>
          {showClosed ? 'Hide done and cancelled' : `Show done and cancelled (${closedCount})`}
        </button>
      )}
    </section>
  );
}
