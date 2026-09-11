// Roll-off boxes for accounts with cat_ro_20yd items: serial, site, delivered on, days out, and scale tickets with overage.
import { useMemo } from 'react';
import { buildRolloffBoxes } from '../store/selectors';
import { useStore } from '../store/useStore';
import { fmtDate, fmtTime, money, plural } from './format';

export function RolloffDetail({ accountId }: { accountId: string }) {
  const state = useStore();
  const boxes = useMemo(() => buildRolloffBoxes(accountId, state), [accountId, state]);
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
                {b.extraDaysCharge && ` · proposed ${money(b.extraDaysCharge.baseCents)} extra days`}
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
