// Open items: WorkOrders and Requests for the account, open first; done and cancelled collapsed under a toggle.
// Office notes (the phone requests the office recorded through recordOfficeRequest, a surface-local sidecar
// because Portal owns Request rows) sit under the WorkOrder they produced. An open WorkOrder carries a
// "Mark scheduled" button, which is what flips the dispatch sync chip back to in sync.
import { useState } from 'react';
import type { AccountView } from '../store/selectors';
import { useStore, type OfficeNote } from '../store/useStore';
import { CREATED_VIA_LABEL, REQUEST_KIND_LABEL, REQUEST_STATUS_PILL, WO_KIND_LABEL, WO_STATUS_PILL, capitalize, fmtDay, plural } from './format';

function NoteLine({ note }: { note: OfficeNote }) {
  return (
    <div className="office-note">
      <span className="status-text">{REQUEST_KIND_LABEL[note.kind]} by {CREATED_VIA_LABEL[note.createdVia]}</span>
      {' '}<code className="code">{note.id}</code>, {fmtDay(note.at)}: {note.note}
    </div>
  );
}

export function OpenItems({ view }: { view: AccountView }) {
  const [showClosed, setShowClosed] = useState(false);
  const setWorkOrderStatus = useStore((s) => s.setWorkOrderStatus);
  const looseNotes = view.officeNotes.filter((n) => !n.workOrderId || !view.workOrders.some((w) => w.workOrder.id === n.workOrderId));
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
      {wos.length === 0 && reqs.length === 0 && looseNotes.length === 0 ? (
        <div className="card-empty">No open work orders or requests</div>
      ) : (
        <div className="row-list">
          {wos.map(({ workOrder: wo, site, container, catalog, officeNotes }) => (
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
                </div>
                {officeNotes.map((n) => <NoteLine key={n.id} note={n} />)}
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
          {looseNotes.map((n) => (
            <div className="row" key={n.id}>
              <div className="row-date">Note</div>
              <div className="row-body"><NoteLine note={n} /></div>
            </div>
          ))}
          {reqs.map(({ request: r, site, workOrder }) => (
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
              </div>
            </div>
          ))}
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
