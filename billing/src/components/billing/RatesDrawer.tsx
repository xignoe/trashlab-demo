import { useEffect, useRef, useState } from 'react'
import type { RateVersion } from '../../types'
import type { Db } from '../../store/db'
import type { RateVersionStubInput } from '../../store/stubs'
import { nextCycleDate } from '../../store/cycles'
import { dayOf, frequencyLabel } from '../../store/engine'
import { fmt, parseDollars } from '../../store/money'
import { dayLabel, longDate } from './format'

/** The drawer lists and publishes one catalog item: the 96 gal cart the surface scenarios reprice. */
const CATALOG_ID = 'cat_res_96'

interface Props {
  open: boolean
  onClose: () => void
  db: Db
  cycleDate: string
  /** store.publishRateVersionStub. Throws with the stub's message on bad input. */
  onPublish: (input: RateVersionStubInput) => RateVersion
}

/**
 * Compact "Rates" drawer. Pricing owns publishing (shared/OWNERSHIP.md); this form calls publishRateVersionStub()
 * so the $31 scenario runs locally until the surfaces merge.
 */
export function RatesDrawer({ open, onClose, db, cycleDate, onPublish }: Props) {
  const [price, setPrice] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState(() => nextCycleDate({ cycle: 'monthly' }, cycleDate))
  const [zoneId, setZoneId] = useState('zone_open')
  const [error, setError] = useState<string | null>(null)
  const [published, setPublished] = useState<RateVersion | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // On open: focus the close button, default the date to the next cycle, clear old messages.
  useEffect(() => {
    if (!open) return
    setEffectiveFrom(nextCycleDate({ cycle: 'monthly' }, cycleDate))
    setError(null)
    setPublished(null)
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, cycleDate])

  if (!open) return null

  const catalog = db.catalog.find(c => c.id === CATALOG_ID)
  const versions = db.rateVersions
    .filter(r => r.catalogId === CATALOG_ID && r.status === 'published')
    .sort((a, b) => dayOf(b.effectiveFrom).localeCompare(dayOf(a.effectiveFrom))
      || (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')
      || b.id.localeCompare(a.id))
  // The version each zone resolves to on the cycle date: the latest effective on or before it.
  const inEffect = new Set<string>()
  for (const zone of new Set(versions.map(v => v.zoneId ?? ''))) {
    const v = versions.find(x => (x.zoneId ?? '') === zone && dayOf(x.effectiveFrom) <= cycleDate)
    if (v) inEffect.add(v.id)
  }
  const zoneName = (id?: string) => (id ? db.zones.find(z => z.id === id)?.name ?? id : 'All zones')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const cents = parseDollars(price)
    if (cents === null || cents <= 0) {
      setError('Enter a monthly price in dollars, like 31.00.')
      return
    }
    try {
      const rv = onPublish({ catalogId: CATALOG_ID, priceCents: cents, effectiveFrom, zoneId: zoneId || undefined })
      setPublished(rv)
      setPrice('')
      setError(null)
    } catch (err) {
      setPublished(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <div className="tl-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="tl-drawer" role="dialog" aria-modal="true" aria-labelledby="rates-title">
        <header className="tl-drawer-head">
          <div className="tl-card-titles">
            <span className="tl-eyebrow">Rates</span>
            <h2 id="rates-title" className="tl-card-title">{catalog?.name ?? CATALOG_ID}</h2>
            <span className="tl-card-meta tl-mono">{CATALOG_ID}</span>
          </div>
          <button ref={closeRef} type="button" className="tl-btn tl-btn-secondary tl-btn-compact" onClick={onClose}>Close</button>
        </header>

        <section className="tl-drawer-section">
          <div className="tl-callout">
            <span className="tl-eyebrow">Pricing publishes rates</span>
            <p className="tl-callout-body">
              Rates belong to the Pricing surface. This control stands in until the surfaces merge: it adds a published rate
              version to this local store and nothing else. Posted invoices never change; the next run on or after the
              effective date uses the new price.
            </p>
          </div>
        </section>

        <section className="tl-drawer-section" aria-labelledby="rates-list-title">
          <h3 id="rates-list-title" className="tl-field-label">Published versions</h3>
          <ul className="tl-rate-list">
            {versions.map(v => (
              <li key={v.id}>
                <span className="tl-cell-text">{zoneName(v.zoneId)}, {v.frequency ? frequencyLabel(v.frequency) : 'any frequency'}</span>
                <span className="tl-rate-price">{fmt(v.priceCents)}/mo</span>
                <span className="tl-cell-sub tl-mono">
                  {v.id} · from {dayLabel(v.effectiveFrom)} {dayOf(v.effectiveFrom).slice(0, 4)}{v.supersedesId ? ` · supersedes ${v.supersedesId}` : ''}
                </span>
                <span />
                {(inEffect.has(v.id) || v.id.startsWith('rv_bl_')) && (
                  <span className="tl-rate-pills">
                    {inEffect.has(v.id) && <span className="tl-pill" data-tone="ok">In effect {dayLabel(cycleDate)}</span>}
                    {v.id.startsWith('rv_bl_') && <span className="tl-pill" data-tone="warn">Local stand-in</span>}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="tl-drawer-section" aria-labelledby="rates-form-title">
          <h3 id="rates-form-title" className="tl-field-label">Publish a new version</h3>
          <form className="tl-form" onSubmit={submit}>
            <div className="tl-form-grid">
              <div className="tl-field">
                <label className="tl-field-label" htmlFor="rate-price">Monthly price</label>
                <div className="tl-input-money">
                  <span aria-hidden="true">$</span>
                  <input id="rate-price" className="tl-input" inputMode="decimal" autoComplete="off" placeholder="31.00"
                    value={price} onChange={e => setPrice(e.target.value)} />
                </div>
                <span className="tl-field-hint">
                  {parseDollars(price) !== null ? `priceCents ${parseDollars(price)}` : 'Stored as integer cents.'}
                </span>
              </div>
              <div className="tl-field">
                <label className="tl-field-label" htmlFor="rate-effective">Effective from</label>
                <input id="rate-effective" className="tl-input" type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} />
              </div>
              <div className="tl-field">
                <label className="tl-field-label" htmlFor="rate-zone">Zone</label>
                <select id="rate-zone" className="tl-input" value={zoneId} onChange={e => setZoneId(e.target.value)}>
                  {db.zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
              </div>
            </div>
            {error && <span className="tl-field-error" role="alert">{error}</span>}
            {published && (
              <div className="tl-notice" role="status">
                Published {published.id} at {fmt(published.priceCents)} a month from {longDate(published.effectiveFrom)}
                {published.supersedesId ? `, superseding ${published.supersedesId}` : ''}. Posted invoices keep their price.
              </div>
            )}
            <div className="tl-action-row">
              <button type="submit" className="tl-btn tl-btn-primary">Publish locally</button>
            </div>
          </form>
        </section>
      </aside>
    </>
  )
}
