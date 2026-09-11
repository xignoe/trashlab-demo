// Roll-off boxes for accounts with cat_ro_20yd items: serial, site, delivered on, days out, extra days and what they
// bill, and scale tickets with overage.
import { useMemo } from 'react';
import type { Charge } from '../../../types';
import { buildRolloffBoxes, type RolloffBoxView } from '../selectors';
import { useStore } from '../../../store/useStore';
import { fmtDate, fmtTime, money, plural } from './format';

const BILLED_STATUS: Partial<Record<Charge['status'], string>> = {
  proposed: 'proposed in the billing run',
  approved: 'approved for the billing run',
  posted: 'invoiced',
  waived: 'waived',
};

/**
 * What a box's extra days bill. The billing engine proposes extraDayCents a day past includedDays (DECISIONS.md entry
 * 38), so the card shows the charge the next run would propose, or how far the days are already billed.
 */
function extraDaysNote(b: RolloffBoxView): string {
  const rate = `${money(b.extraDayCents)} a day`;
  const next = b.extraDayCharge;
  if (next?.period) {
    const days = b.extraDayCents > 0 ? Math.round(next.baseCents / b.extraDayCents) : b.extraDays;
    return `${plural(days, 'extra day')} ${fmtDate(next.period.start)} to ${fmtDate(next.period.end)} at ${rate}: ${money(next.baseCents)}, ${money(next.totalCents)} with fees and tax, proposed on the next billing run`;
  }
  const billed = b.extraDaysBilled;
  if (billed?.period) return `extra days through ${fmtDate(billed.period.end)} ${BILLED_STATUS[billed.status] ?? billed.status}`;
  return `${money(b.extraDaysCents)} in extra days at ${rate}`;
}

export function RolloffDetail({ accountId }: { accountId: string }) {
  const db = useStore((s) => s.db);
  const boxes = useMemo(() => buildRolloffBoxes(accountId, db), [accountId, db]);
  if (boxes.length === 0) return null;
  const overCap = boxes.flatMap((b) => b.tickets).filter((t) => t.overTons > 0).length;
  return (
    <section className="panel" aria-label="Roll-off boxes">
      <div className="card-head">
        <h2 className="card-title">Roll-off boxes</h2>
        <span className="card-note">{plural(boxes.length, 'box', 'boxes')} out{overCap ? `, ${plural(overCap, 'ticket')} over cap` : ''}</span>
      </div>
      <div className="row-list">
        {boxes.map((b) => (
          <div className="row" key={b.container.id} style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
            <div className="row-body">
              <div className="row-title">
                <code className="code">{b.container.serial}</code>
                <span>{b.catalog.name}</span>
                {b.extraDays > 0 ? (
                  <span className="pill pill-warn">{plural(b.extraDays, 'extra day')}</span>
                ) : (
                  <span className="pill pill-ok">Within {b.includedDays} days</span>
                )}
              </div>
              <div className="meta">
                {[
                  b.site?.address,
                  b.deliveredOn ? `Delivered ${fmtDate(b.deliveredOn)}` : 'Delivery date unknown',
                  b.daysOut !== undefined ? `${plural(b.daysOut, 'day')} out against ${b.includedDays} included` : undefined,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                {b.extraDays > 0 && ` · ${extraDaysNote(b)}`}
              </div>
              {b.tickets.length > 0 && (
                <div className="table-wrap">
                  <table className="table table-dense">
                    <thead>
                      <tr>
                        <th>Ticket</th>
                        <th>Facility</th>
                        <th>Material</th>
                        <th className="money">Net lbs</th>
                        <th className="money">Tons</th>
                        <th>Over cap</th>
                        <th className="money">Proposed overage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.tickets.map((t) => (
                        <tr key={t.ticket.id}>
                          <td>
                            <code className="code">{t.ticket.id}</code>
                            <div className="meta">{fmtDate(t.ticket.ticketedAt)} {fmtTime(t.ticket.ticketedAt)}</div>
                          </td>
                          <td>{t.ticket.facility}</td>
                          <td>{t.ticket.material}</td>
                          <td className="money">{t.ticket.netLbs.toLocaleString('en-US')}</td>
                          <td className="money">{t.tons.toFixed(2)}</td>
                          <td>
                            {t.overTons > 0 ? (
                              <span className="pill pill-warn">{t.overTons.toFixed(2)} tons over {b.catalog.rolloff?.includedTons}</span>
                            ) : (
                              <span className="pill pill-ok">Under cap</span>
                            )}
                          </td>
                          <td className="money">
                            {t.overage ? (
                              <>
                                {money(t.overage.baseCents)}
                                <div className="meta">{money(t.overage.totalCents)} with fees and tax</div>
                              </>
                            ) : t.overTons > 0 ? (
                              <span className="meta">already charged</span>
                            ) : (
                              <span className="meta">none</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
