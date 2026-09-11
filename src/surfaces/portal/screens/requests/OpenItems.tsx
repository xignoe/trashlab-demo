// Every Request on the account, all sites, newest first. The status pill shows the exact Request.status value
// the office sees, and the note column carries the handoff reason when a flow was handed to a person.

import { usePortal } from '../../store';
import { requestsForAccount } from '../../lib/selectors';
import { formatDate, formatDateTime, formatDayLong } from '../../lib/clock';
import { RequestStatusPill } from '../../components/StatusPill';
import type { Request } from '../../../../types';

export const KIND_LABEL: Record<Request['kind'], string> = {
  extraPickup: 'Extra pickup',
  vacationHold: 'Vacation hold',
  cartChange: 'Cart size change',
  missedPickup: 'Missed pickup',
  quote: 'Quote request',
  damagedCart: 'Damaged or missing container',
  bulkyItem: 'Bulky item pickup',
  addCart: 'Add a cart',
  stopService: 'Stop or move service',
  billingQuestion: 'Billing question',
  other: 'Other request',
};

export function OpenItems({ accountId }: { accountId: string }) {
  const state = usePortal();
  const requests = requestsForAccount(state, accountId);
  // Portal-minted ids are sequential, so newest last in the table order; show newest first.
  const rows = [...requests].reverse();
  const quoteFor = (r: Request) => (r.kind === 'quote' ? state.quoteRequests.find((q) => q.requestId === r.id) : undefined);
  const createdFor = (r: Request): string => {
    const entry = state.log.find((l) => l.action === 'addRequest' && l.ids.includes(r.id));
    return entry ? formatDate(entry.at) : 'before today';
  };

  return (
    <section className="tl-panel" data-testid="open-items">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-medium">Open items</h2>
        <span className="text-xs text-ink-3">
          {requests.filter((r) => r.status === 'open' || r.status === 'scheduled').length} waiting on us, {requests.length} total across every site
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-3">No requests yet. Pick a request above to get started.</p>
      ) : (
        <table className="tl-table">
          <thead>
            <tr>
              <th>Request</th>
              <th>Site</th>
              <th>Created</th>
              <th>Status</th>
              <th>Work order</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const site = state.sites.find((s) => s.id === r.siteId);
              const wo = r.workOrderId ? state.workOrders.find((w) => w.id === r.workOrderId) : undefined;
              return (
                <tr key={r.id} data-request={r.id}>
                  <td>
                    <div className="font-medium">{KIND_LABEL[r.kind]}</div>
                    <div className="font-mono text-xs text-ink-3">{r.id}</div>
                  </td>
                  <td className="text-sm">{site?.address ?? r.siteId}{site?.poNumber ? <div className="text-xs text-ink-3">{site.poNumber}</div> : null}</td>
                  <td className="whitespace-nowrap">{createdFor(r)}</td>
                  <td><RequestStatusPill status={r.status} /></td>
                  <td>
                    {wo ? (
                      <>
                        <div className="font-mono text-xs">{wo.id}</div>
                        <div className="text-xs text-ink-3">{wo.kind}, {formatDayLong(wo.scheduledFor)}</div>
                      </>
                    ) : r.workOrderId ? (
                      <span className="font-mono text-xs">{r.workOrderId}</span>
                    ) : (
                      <span className="text-xs text-ink-3">none</span>
                    )}
                  </td>
                  <td className="text-sm text-ink-2" style={{ maxWidth: 360 }}>
                    {quoteFor(r) ? (
                      <div data-quote={quoteFor(r)!.id}>
                        <div>Quote <span className="font-mono text-xs">{quoteFor(r)!.id}</span></div>
                        <div>Priced by a person, we will send the quote by {formatDateTime(quoteFor(r)!.followUpBy)}</div>
                      </div>
                    ) : (r.note ?? '')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
