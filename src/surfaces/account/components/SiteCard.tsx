// One panel per Site: address and meta, the service table, and the "why this price" inset that opens
// from a price or its source pill. Ended items hide behind a "show ended" toggle. Each open row has a
// "Change" button and the site header an "Add service" button; both open the Change service drawer.
import { useEffect, useMemo, useRef, useState } from 'react';
import { today } from '../lib/clock';
import { FREQUENCY_LABEL } from '../lib/engine';
import { ROUTE_DAY_LONG, explainServiceLine, type ServiceLineView, type SiteView } from '../selectors';
import { useStore } from '../../../store/useStore';
import { RULE_LABEL, RULE_PILL, capitalize, fmtDate, money } from './format';

function PriceInset({ line, site, onClose }: { line: ServiceLineView; site: SiteView; onClose: () => void }) {
  const db = useStore((s) => s.db);
  const view = useMemo(() => explainServiceLine(line, site.site, db), [line, site.site, db]);
  // Behaves like a popover: Escape or a click anywhere outside it closes it. The price and source pill
  // buttons are left out of the outside test because they already toggle it (and switch it to another row).
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.drawer')) onCloseRef.current();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target || ref.current?.contains(target) || target.closest('.price-btn, .pill-btn')) return;
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, []);
  const price = line.resolved ? money(line.resolved.priceCents) : 'no price';
  return (
    <div className="inset" ref={ref} role="region" aria-label={`Why ${price} for ${line.catalog.name}`}>
      <div className="card-head">
        <div className="eyebrow">Why {price} for the {line.catalog.name}</div>
        <button type="button" className="toggle" onClick={onClose}>Close</button>
      </div>
      <p style={{ margin: 0 }}>{view.summary}</p>
      {view.details.map((d) => (
        <p key={d} className="meta" style={{ margin: 0, lineHeight: '18px' }}>{d}</p>
      ))}
      {view.explanation && (
        <div className="cluster meta">
          <span>Matched zone <code className="code">{view.explanation.zoneId}</code></span>
          <span>frequency <code className="code">{FREQUENCY_LABEL[view.explanation.frequency]}</code></span>
          <span>on <code className="code">{view.explanation.onDate}</code></span>
          {view.explanation.contractOverride && <span>contract <code className="code">{view.explanation.contractOverride.contractId}</code></span>}
          {view.explanation.rateVersion && <span>rate card <code className="code">{view.explanation.rateVersion.id}</code></span>}
        </div>
      )}
    </div>
  );
}

function ItemStatus({ line }: { line: ServiceLineView }) {
  const { item } = line;
  // The dates sit in the Since column, so the pill says only Starts or Ends (full date on hover). That keeps the
  // Status column narrow enough for the table to fit its card at 1440 (DESIGN.md, Paper drift 1 and 2).
  if (item.status === 'active' && item.effectiveFrom > today())
    return <span className="pill pill-info" title={`Starts ${fmtDate(item.effectiveFrom)}`}>Starts</span>;
  if (item.status === 'ended' && item.effectiveTo && item.effectiveTo > today())
    return <span className="pill" title={`Ends ${fmtDate(item.effectiveTo)}`}>Ends</span>;
  return (
    <span className={`pill ${item.status === 'active' ? 'pill-active' : item.status === 'held' ? 'pill-hold' : ''}`}>
      {item.status === 'held' ? 'Held' : capitalize(item.status)}
    </span>
  );
}

function ServiceRow({ line, onExplain, open, onChange }: { line: ServiceLineView; onExplain: () => void; open: boolean; onChange?: () => void }) {
  const { item, catalog, containers, resolved } = line;
  const ended = item.status === 'ended';
  return (
    <tr style={ended ? { opacity: 0.6 } : undefined}>
      <td className="svc-name">
        <span className="status-text">{catalog.name}</span>
        {catalog.sizeLabel && !catalog.name.includes(catalog.sizeLabel) && <span className="meta"> {catalog.sizeLabel}</span>}
      </td>
      <td className="mono">{item.qty}</td>
      <td className="nowrap">{capitalize(FREQUENCY_LABEL[item.frequency])}</td>
      <td>
        {containers.length ? (
          <div className="stack" style={{ gap: 2 }}>
            {containers.map((c) => (
              <span key={c.id} className="serial">{c.serial}</span>
            ))}
          </div>
        ) : (
          <span className="meta">none assigned</span>
        )}
      </td>
      <td className="nowrap">
        {fmtDate(item.effectiveFrom)}
        {item.effectiveTo && <div className="meta">to {fmtDate(item.effectiveTo)}</div>}
      </td>
      <td className="money">
        {resolved ? (
          <button type="button" className="price-btn" onClick={onExplain} aria-expanded={open} title="Why this price">
            {money(resolved.priceCents)}
          </button>
        ) : (
          <span className="danger-text" title={line.priceError}>no price</span>
        )}
        <div className="meta">per {line.per}</div>
      </td>
      <td>
        {resolved ? (
          <button type="button" className="pill-btn" onClick={onExplain} aria-expanded={open} title="Why this price">
            <span className={`pill ${RULE_PILL[resolved.ruleWon]}`}>{RULE_LABEL[resolved.ruleWon]}</span>
          </button>
        ) : (
          <span className="pill pill-danger">Unpriced</span>
        )}
      </td>
      <td>
        <div className="status-cell">
          <ItemStatus line={line} />
          {!ended && onChange && (
            <button type="button" className="row-action" onClick={onChange} aria-haspopup="dialog" aria-label={`Change ${catalog.name}`}>
              Change
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export function SiteCard({ site, onChangeItem, onAddService }: { site: SiteView; onChangeItem?: (itemId: string) => void; onAddService?: () => void }) {
  const [showEnded, setShowEnded] = useState(false);
  const [explainId, setExplainId] = useState<string | undefined>();
  const rows = showEnded ? site.lines : site.activeLines;
  const explaining = explainId ? site.lines.find((l) => l.item.id === explainId) : undefined;
  const s = site.site;
  const meta = [
    site.zone ? `Zone ${site.zone.serviceability}` : undefined,
    site.route ? `${ROUTE_DAY_LONG[site.route.day]} route` : 'No route',
    site.occupant ? `Occupant ${site.occupant.name}` : undefined,
    s.poNumber ? `PO ${s.poNumber}` : undefined,
    s.accessNotes,
  ].filter(Boolean);

  return (
    <section className="panel" aria-label={s.address}>
      <div className="card-head">
        <div className="stack" style={{ gap: 4 }}>
          <h2 className="card-title">{s.address}</h2>
          <div className="meta">{meta.join(' · ')}</div>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onAddService} disabled={!onAddService} aria-haspopup="dialog">Add service</button>
      </div>
      <div className="table-wrap">
        <table className="table table-dense service-table">
          <thead>
            <tr>
              <th>Service</th>
              <th>Qty</th>
              <th>Frequency</th>
              <th>Container</th>
              <th>Since</th>
              <th className="money">Price</th>
              <th>Source</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">No service lines at this site</td>
              </tr>
            )}
            {rows.map((line) => (
              <ServiceRow
                key={line.item.id}
                line={line}
                open={explainId === line.item.id}
                onExplain={() => setExplainId((cur) => (cur === line.item.id ? undefined : line.item.id))}
                onChange={onChangeItem ? () => onChangeItem(line.item.id) : undefined}
              />
            ))}
          </tbody>
        </table>
      </div>
      {site.endedLines.length > 0 && (
        <button type="button" className="toggle" onClick={() => setShowEnded((v) => !v)} aria-expanded={showEnded}>
          {showEnded ? 'Hide ended' : `Show ended (${site.endedLines.length})`}
        </button>
      )}
      {explaining && <PriceInset line={explaining} site={site} onClose={() => setExplainId(undefined)} />}
    </section>
  );
}
