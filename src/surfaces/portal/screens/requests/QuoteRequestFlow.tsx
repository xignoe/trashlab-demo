// Commercial quote request (commercial accounts only). The portal never prices this: material and frequency
// change what a front load container costs, so a person confirms them and sends the quote. The Quote write is
// pricing's (OWNERSHIP.md), so submitQuoteRequest() records a Quote-shaped draft in a portal-local table and the
// portal files an open quote Request naming the quote id.

import { useEffect, useMemo, useState } from 'react';
import { usePortal, type QuoteRequest } from '../../store';
import {
  QUOTE_FREQUENCIES, QUOTE_MATERIALS, frontloadSizes, quoteCatalogFor, sitesForAccount, serviceItemsForSite, type QuoteMaterial,
} from '../../lib/selectors';
import { frequencyLabel } from '../../lib/engine';
import { formatDate, formatDateTime } from '../../lib/clock';
import type { Quote, Request } from '../../../../types';

type Freq = (typeof QUOTE_FREQUENCIES)[number];

export function QuoteRequestFlow({ onDone }: { onDone: () => void }) {
  const state = usePortal();
  const { accountId, siteId: sessionSiteId } = state.session;
  const sites = sitesForAccount(state, accountId);
  const sizes = frontloadSizes(state.catalog);

  const [siteId, setSiteId] = useState(sessionSiteId);
  // The site switcher sets the default site for the form.
  useEffect(() => { setSiteId(sessionSiteId); }, [sessionSiteId]);
  const site = sites.find((s) => s.id === siteId) ?? sites[0];

  const [size, setSize] = useState(sizes[0] ?? '');
  const [material, setMaterial] = useState<QuoteMaterial>('trash');
  const [frequency, setFrequency] = useState<Freq>('weekly');
  const [qty, setQty] = useState(1);
  const [accessNotes, setAccessNotes] = useState('');
  const [result, setResult] = useState<{ quoteRequest: QuoteRequest; request: Request } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cat = useMemo(() => quoteCatalogFor(state.catalog, size, material), [state.catalog, size, material]);
  const current = site ? serviceItemsForSite(state, site.id).filter((i) => i.status === 'active') : [];
  const catName = (id: string) => state.catalog.find((c) => c.id === id)?.name ?? id;

  const submit = () => {
    if (!site || !cat) return;
    setError(null);
    try {
      setResult(state.requestQuote({ accountId, siteId: site.id, catalogId: cat.id, qty, frequency, material, accessNotes }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (result) {
    const q = result.quoteRequest;
    const line = q.quote.lines[0];
    const qSite = sites.find((s) => s.id === q.siteId);
    return (
      <div className="flex flex-col gap-3" data-testid="quote-submitted">
        <div className="tl-card flex flex-col gap-2" style={{ background: 'var(--color-info-soft)', borderColor: 'transparent' }}>
          <div className="flex items-center gap-2">
            <span className="tl-pill tl-pill--info">open</span>
            <span className="font-medium">Quote request {q.id} sent</span>
          </div>
          <p className="text-sm text-ink-2">Priced by a person, we will send the quote by {formatDateTime(q.followUpBy)}.</p>
        </div>
        <dl className="text-sm grid gap-x-3 gap-y-1" style={{ gridTemplateColumns: 'auto 1fr' }}>
          <dt className="text-ink-3">Quote</dt><dd className="font-mono">{q.id} (draft, expires {formatDate(q.quote.expiresAt)})</dd>
          <dt className="text-ink-3">Request</dt><dd className="font-mono">{result.request.id}</dd>
          <dt className="text-ink-3">Site</dt><dd>{qSite?.address}{qSite?.poNumber ? ` (${qSite.poNumber})` : ''}</dd>
          <dt className="text-ink-3">Container</dt><dd>{line.qty} x {catName(line.catalogId)}, {q.material}, {frequencyLabel(line.frequency)}</dd>
          {q.accessNotes && <><dt className="text-ink-3">Access</dt><dd>{q.accessNotes}</dd></>}
        </dl>
        <div><button type="button" className="tl-button" onClick={onDone}>Back to requests</button></div>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }} data-testid="quote-form">
      <p className="text-sm text-ink-2">
        Commercial pricing depends on the material and how often we empty the container, so a person confirms both and sends you a priced quote.
      </p>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', maxWidth: 640 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="tl-label" htmlFor="quote-site">Site</label>
          <select id="quote-site" className="tl-field" value={site?.id ?? ''} onChange={(e) => setSiteId(e.target.value)}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.address}{s.poNumber ? ` (${s.poNumber})` : ''}</option>
            ))}
          </select>
          {current.length > 0 && (
            <p className="text-xs text-ink-3 mt-1">
              Here now: {current.map((i) => `${i.qty} x ${catName(i.catalogId)}, ${frequencyLabel(i.frequency)}`).join('; ')}
            </p>
          )}
        </div>
        <div>
          <label className="tl-label" htmlFor="quote-size">Container size</label>
          <select id="quote-size" className="tl-field" value={size} onChange={(e) => setSize(e.target.value)}>
            {sizes.map((s) => <option key={s} value={s}>{s.replace('yd', 'yard')} front load</option>)}
          </select>
        </div>
        <div>
          <label className="tl-label" htmlFor="quote-qty">How many</label>
          <select id="quote-qty" className="tl-field" value={qty} onChange={(e) => setQty(Number(e.target.value))}>
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <label className="tl-label" htmlFor="quote-material">Material</label>
          <select id="quote-material" className="tl-field" value={material} onChange={(e) => setMaterial(e.target.value as QuoteMaterial)}>
            {QUOTE_MATERIALS.map((m) => <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)}</option>)}
          </select>
        </div>
        <div>
          <label className="tl-label" htmlFor="quote-frequency">Pickups</label>
          <select id="quote-frequency" className="tl-field" value={frequency} onChange={(e) => setFrequency(e.target.value as Freq)}>
            {QUOTE_FREQUENCIES.map((f) => <option key={f} value={f}>{frequencyLabel(f as Quote['lines'][number]['frequency'])}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="tl-label" htmlFor="quote-access">Access notes</label>
          <textarea
            id="quote-access" className="tl-field" rows={2} style={{ height: 'auto', padding: 8 }}
            value={accessNotes} onChange={(e) => setAccessNotes(e.target.value)}
            placeholder={site?.accessNotes ? `On file: ${site.accessNotes}` : 'Gate codes, enclosure, where the truck can reach'}
          />
        </div>
      </div>

      {cat && <p className="text-xs text-ink-3">We will price this as {qty} x {cat.name} ({cat.id}), {material}.</p>}
      {error && <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="tl-button" disabled={!cat || !site}>Send quote request</button>
        <button type="button" className="tl-button tl-button--secondary" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}
