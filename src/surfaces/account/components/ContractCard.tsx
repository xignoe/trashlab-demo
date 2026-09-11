// Contract card, only when the account has a Contract: term, notice window, overrides, escalator, next anniversary prices.
import { useMemo } from 'react';
import { FREQUENCY_LABEL } from '../lib/engine';
import { buildContractView } from '../selectors';
import { useStore } from '../../../store/useStore';
import type { Contract } from '../../../types';
import { fmtDate, money, plural } from './format';

export function ContractCard({ contract }: { contract: Contract }) {
  const db = useStore((s) => s.db);
  const view = useMemo(() => buildContractView(contract, db), [contract, db]);
  const esc = contract.escalator;
  return (
    <section className="panel" aria-label="Contract">
      <div className="card-head">
        <h2 className="card-title">Contract</h2>
        <span className="card-note"><code className="code">{contract.id}</code></span>
      </div>
      <div className="kv">
        <div className="kv-item">
          <div className="eyebrow">Term</div>
          <div className="kv-value">{fmtDate(contract.termStart)} to {fmtDate(contract.termEnd)}</div>
          <div className="meta">{view.daysUntilTermEnd >= 0 ? `${plural(view.daysUntilTermEnd, 'day')} until term end` : `Signed term ended ${plural(-view.daysUntilTermEnd, 'day')} ago`}</div>
          {view.renewedOn && <div className="meta" data-testid="contract-renewed">Auto-renewed on {fmtDate(view.renewedOn)}</div>}
        </div>
        <div className="kv-item">
          <div className="eyebrow">Renewal notice</div>
          <div className="kv-value">{plural(contract.renewalNoticeDays, 'day')} before term end</div>
          <div className="meta">Notice by {fmtDate(view.noticeBy)}{view.noticeDaysLeft >= 0 ? `, ${plural(view.noticeDaysLeft, 'day')} from today` : ', window has passed'}</div>
        </div>
        <div className="kv-item">
          <div className="eyebrow">Escalator</div>
          <div className="kv-value">{esc ? `${esc.kind === 'fixedPct' ? 'Fixed' : 'CPI'} ${esc.pct}%` : 'None'}</div>
          <div className="meta">{esc && view.nextAnniversary ? `Next anniversary ${fmtDate(view.nextAnniversary)}` : 'Prices hold for the term'}</div>
        </div>
      </div>
      <div className="table-wrap">
        <table className="table table-dense">
          <thead>
            <tr>
              <th>Override</th>
              <th>Frequency</th>
              <th className="money">Contract price</th>
              <th className="money">Rate card</th>
              <th>Below rate card</th>
              <th>Reason</th>
              {esc && view.nextAnniversary && <th className="money">After {fmtDate(view.nextAnniversary)}</th>}
            </tr>
          </thead>
          <tbody>
            {view.overrides.map((o, i) => {
              // The canonical resolvePrice bills the first override for an item and frequency. Pricing writes a new one
              // first and keeps the older rows after it as history, so a later row for the same item is superseded.
              const superseded = view.overrides.slice(0, i).some((p) => p.catalogId === o.catalogId && (p.frequency ?? 'any') === (o.frequency ?? 'any'));
              return (
                <tr key={`${i}-${o.catalogId}-${o.frequency ?? 'any'}`} className={superseded ? 'muted' : undefined}>
                  <td className="status-text">{o.catalog?.name ?? o.catalogId}</td>
                  <td>{o.frequency ? FREQUENCY_LABEL[o.frequency] : 'any'}</td>
                  <td className="money">{superseded ? <s>{money(o.priceCents)}</s> : money(o.priceCents)}</td>
                  <td className="money muted">{o.rateCardCents !== undefined ? money(o.rateCardCents) : 'none'}</td>
                  <td>{o.pctBelowRateCard !== undefined ? `${o.pctBelowRateCard}%` : ''}</td>
                  <td className="muted">{superseded ? `Replaced, kept as history${o.reason ? ` (${o.reason})` : ''}` : o.reason ?? ''}</td>
                  {esc && view.nextAnniversary && <td className="money">{!superseded && o.escalatedCents !== undefined ? money(o.escalatedCents) : ''}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {esc && view.nextAnniversary && (
        <div className="meta">Escalated prices are override price times (1 + {esc.pct}/100), rounded to the cent. They apply from {fmtDate(view.nextAnniversary)}.</div>
      )}
    </section>
  );
}
