// Navy "Next billing run preview" card. The total and cycle date are always visible; the proposed lines are
// collapsed by default. Everything comes from previewNextRun on the live state, so a service change shows
// on the next render (invariant 3). A suspended account reads the invariant 4 sentence instead of lines.
import { useState } from 'react';
import { billingPeriod } from '../store/engine';
import type { AccountView } from '../store/selectors';
import type { Charge } from '../types';
import { CYCLE_LABEL, LINE_TYPE_LABEL, RULE_LABEL, fmtDate, fmtPeriod, money, plural } from './format';

function LineRow({ charge, kind }: { charge: Charge; kind: string }) {
  const fees = charge.fees.reduce((s, f) => s + f.cents, 0);
  return (
    <tr>
      <td>
        <div>{charge.description}</div>
        <div className="navy-line-sub">
          {[
            kind,
            LINE_TYPE_LABEL[charge.lineType],
            charge.period ? fmtPeriod(charge.period) : charge.servicedOn ? `serviced ${fmtDate(charge.servicedOn)}` : undefined,
            `${charge.source.type} ${charge.source.id}`,
            RULE_LABEL[charge.pricing.ruleWon],
            charge.pricing.contractId,
            charge.pricing.rateVersionId,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </td>
      <td className="money">{money(charge.baseCents)}</td>
      <td className="money">{money(fees)}</td>
      <td className="money">{money(charge.taxCents)}</td>
      <td className="money">{money(charge.totalCents)}</td>
    </tr>
  );
}

export function NextRunCard({ view }: { view: AccountView }) {
  const [open, setOpen] = useState(false);
  const { account, nextInvoice } = view;
  const { preview, officeProposed } = nextInvoice;
  const suspended = account.status === 'suspended';
  const lineCount = nextInvoice.lines.length;
  // Addendum C14: a run on cycleDate bills cycleDate to cycleDate plus the cycle length for every account.
  const cycleNote = preview.cycleDate
    ? `${fmtDate(preview.cycleDate)} · ${CYCLE_LABEL[account.cycle]}, bills ${fmtPeriod(billingPeriod(account, preview.cycleDate))}`
    : 'Per job, no cycle date';

  return (
    <section className="panel panel-navy" aria-label="Next billing run preview">
      {/* Title on its own line, cycle meta below it: at 1440 the side column is 400px and the meta beside the
          title squeezed it onto four lines (DESIGN.md, Paper drift 3). */}
      <div className="stack" style={{ gap: 4 }}>
        <h2 className="card-title nowrap" style={{ color: 'var(--on-accent)' }}>Next billing run preview</h2>
        <span className="meta">{cycleNote}</span>
      </div>
      <div className="navy-stat">
        <span className="stat">{money(nextInvoice.estimateCents)}</span>
        <span className="meta">
          {suspended
            ? 'nothing will be generated'
            : lineCount
              ? `${plural(preview.recurring.length, 'recurring line')}, ${plural(preview.events.length, 'event')}, ${plural(preview.proposed.length + officeProposed.length, 'proposed charge')}`
              : 'no lines proposed'}
        </span>
      </div>
      {suspended && (
        <div className="inset" style={{ background: 'var(--on-accent-active)', borderLeftColor: 'var(--warn)' }}>
          <div className="eyebrow">Suspended: no charges will be generated</div>
          <div className="meta">Invariant 4. A suspended account produces no recurring or event charges until it is reinstated; the reinstatement fee is {money(view.hauler?.policy.reinstatementFeeCents ?? 0)}.</div>
          {preview.proposed.length + officeProposed.length > 0 && (
            <div className="meta">
              Already proposed before the suspension and still waiting for billing:{' '}
              {[...preview.proposed, ...officeProposed].map((c) => `${c.description} ${money(c.totalCents)}`).join(', ')}.
            </div>
          )}
        </div>
      )}
      {!suspended && lineCount > 0 && (
        <button type="button" className="toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? 'Hide lines' : `Show ${plural(lineCount, 'line')}`}
        </button>
      )}
      {!suspended && open && (
        <div className="table-wrap">
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Line</th>
                <th className="money">Base</th>
                <th className="money">Fees</th>
                <th className="money">Tax</th>
                <th className="money">Total</th>
              </tr>
            </thead>
            <tbody>
              {preview.recurring.map((c) => <LineRow key={c.id} charge={c} kind="Recurring run" />)}
              {preview.events.map((c) => <LineRow key={c.id} charge={c} kind="Event run" />)}
              {preview.proposed.map((c) => <LineRow key={c.id} charge={c} kind="Already proposed" />)}
              {officeProposed.map((c) => <LineRow key={c.id} charge={c} kind="Proposed by office, waiting for billing" />)}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="money">{money(nextInvoice.lines.reduce((s, c) => s + c.baseCents, 0))}</td>
                <td className="money">{money(nextInvoice.lines.reduce((s, c) => s + c.fees.reduce((f, x) => f + x.cents, 0), 0))}</td>
                <td className="money">{money(nextInvoice.lines.reduce((s, c) => s + c.taxCents, 0))}</td>
                <td className="money">{money(nextInvoice.estimateCents)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {!suspended && (
        <div className="meta">
          {view.hauler ? `${view.hauler.name} does not prorate: lines bill the full period they are in force at the period start.` : ''}
          {' '}Recomputed from the store on every render.
        </div>
      )}
    </section>
  );
}
