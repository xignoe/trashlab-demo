/**
 * The Roll-off section of the Ratebook (DECISIONS.md entry 65): everything a roll-off haul price depends on, top to
 * bottom. A zone to price in; the material by size matrix (each cell opens a form that writes a new dated cell); the
 * materials and their ticket codes; each size's rental and weight terms; the hauler-wide policy; and a haul calculator
 * that prices a job with all of it. Billing reads these settings for every ticket and extra day it prices.
 */
import { useMemo, useState } from 'react'
import type { ServiceCatalog } from '../../../types'
import { useStore } from '../../../store/useStore'
import { rolloffPolicyOf } from '../../../store/engine'
import { haulPrice, rolloffMatrix, type MatrixCell } from '../lib/rolloff'
import { formatCents } from '../lib/money'
import Pill from '../components/Pill'
import { BUTTON_LINK, BUTTON_SECONDARY, Card, SectionHeader, Select } from '../components/form'
import { CellDrawer, HandlingPill, MaterialDrawer, PolicyCard, TermsDrawer, sizeName, tiersText, tonsText } from './RolloffForms'
import HaulCalculator from './HaulCalculator'

type Editing =
  | { kind: 'cell'; catalogId: string; materialId: string }
  | { kind: 'material'; id?: string }
  | { kind: 'terms'; catalogId: string }

type Notice = { where: 'matrix' | 'materials' | 'terms'; text: string }

const REASON: Record<MatrixCell['status'], string> = {
  priced: '',
  notAccepted: 'Not taken in this size',
  prohibited: 'Prohibited',
  noHaulRate: 'No haul rate in this zone',
}

/** Roll-off configuration: matrix, materials, terms by size, hauler policy, and the haul calculator, in one zone. */
export default function RolloffSection({ today }: { today: string }) {
  const db = useStore(s => s.db)
  const [zoneId, setZoneId] = useState(() => (db.zones.some(z => z.id === 'zone_open') ? 'zone_open' : db.zones[0]?.id ?? ''))
  const [editing, setEditing] = useState<Editing | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const matrix = useMemo(() => rolloffMatrix(db, zoneId, today), [db, zoneId, today])
  const materials = matrix.rows.map(r => r.material)
  const policy = rolloffPolicyOf(db)

  // The earliest cell scheduled after today for each size and material, so a saved future price shows on the grid.
  const scheduled = useMemo(() => {
    const next = new Map<string, string>()
    for (const r of db.rolloffRates ?? []) {
      if (r.effectiveFrom.slice(0, 10) <= today) continue
      const key = `${r.catalogId}|${r.materialId}`
      const at = next.get(key)
      if (!at || r.effectiveFrom < at) next.set(key, r.effectiveFrom.slice(0, 10))
    }
    return next
  }, [db.rolloffRates, today])

  const sizeById = (id: string): ServiceCatalog | undefined => matrix.sizes.find(s => s.id === id)
  const close = () => setEditing(null)
  const editingCell = editing?.kind === 'cell' ? matrix.rows.find(r => r.material.id === editing.materialId)?.cells.find(c => c.catalogId === editing.catalogId) : undefined
  const editingSize = editing && editing.kind !== 'material' ? sizeById(editing.catalogId) : undefined

  const noticeFor = (where: Notice['where']) =>
    notice?.where === where ? <p role="status" className="mx-5 mt-3 rounded-md bg-success-soft px-3 py-2 text-small font-semibold text-success">{notice.text}</p> : null

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Roll-off"
        description="What a haul costs: the size's haul rate, the material in the box, tons on the scale ticket, days on site, and the trip. Billing reads these settings for every ticket and extra day it prices."
        actions={
          <div className="w-52">
            <Select value={zoneId} onChange={setZoneId} options={db.zones.map(z => ({ value: z.id, label: z.name }))} ariaLabel="Pricing zone" />
          </div>
        }
      />

      <Card label="Material by size" className="overflow-x-auto">
        <div className="px-5 pt-5">
          <h3 className="text-h2 font-bold tracking-tight">Material by size</h3>
          <p className="mt-0.5 text-body text-muted">
            Haul price, tons included, and the rate per ton over, in force {today}. Open a cell to change it from a date; the cell before it is kept.
          </p>
        </div>
        {noticeFor('matrix')}
        <div className="overflow-x-auto p-5">
          <table className="w-full min-w-[900px] border-collapse text-left" data-testid="rolloff-matrix">
            <thead>
              <tr className="border-b border-line">
                <th className="w-[240px] py-2 pr-3 text-small font-semibold text-muted">Material</th>
                {matrix.sizes.map(s => {
                  const haul = haulPrice(db, s.id, zoneId, today)
                  return (
                    <th key={s.id} className="px-1.5 py-2 text-small font-semibold text-ink">
                      <span className="block">{sizeName(s)}</span>
                      <span className="block font-mono text-mono font-normal text-muted">{haul ? `${formatCents(haul.cents)} haul` : 'No haul rate'}</span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map(row => {
                const m = row.material
                return (
                  <tr key={m.id} data-material={m.id} className="border-b border-line align-top">
                    <th scope="row" className="py-2 pr-3 text-left font-normal">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-body font-semibold text-ink">{m.name}</span>
                        <HandlingPill handling={m.handling} />
                      </span>
                      <span className="mt-0.5 block text-small text-muted">
                        {[
                          m.heavy ? `Heavy${m.maxFillPct ? `, fill to ${m.maxFillPct}%` : ''}` : m.maxFillPct ? `Fill to ${m.maxFillPct}%` : '',
                          m.disposalCentsPerTon !== undefined ? `Disposal ${formatCents(m.disposalCentsPerTon)}/t` : '',
                        ].filter(Boolean).join(' · ')}
                      </span>
                    </th>
                    {row.cells.map(c => {
                      const size = sizeById(c.catalogId)
                      return (
                        <td key={c.catalogId} className="px-1.5 py-2">
                          <CellView
                            cell={c}
                            label={`${m.name}, ${size ? sizeName(size) : c.catalogId}`}
                            scheduledFrom={scheduled.get(`${c.catalogId}|${m.id}`)}
                            onOpen={() => setEditing({ kind: 'cell', catalogId: c.catalogId, materialId: m.id })}
                          />
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card label="Materials">
        <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-5">
          <div>
            <h3 className="text-h2 font-bold tracking-tight">Materials</h3>
            <p className="mt-0.5 text-body text-muted">A scale ticket bills as the material its code maps to; an unknown code bills as the standard material.</p>
          </div>
          <button type="button" className={BUTTON_SECONDARY} onClick={() => setEditing({ kind: 'material' })}>Add material</button>
        </div>
        {noticeFor('materials')}
        <ul className="mt-3 divide-y divide-line border-t border-line">
          {materials.map(m => (
            <li key={m.id} data-material-row={m.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5">
                  <span className="text-body font-semibold text-ink">{m.name}</span>
                  <HandlingPill handling={m.handling} />
                  {m.heavy && <Pill tone="warning">Heavy{m.maxFillPct ? `, fill to ${m.maxFillPct}%` : ''}</Pill>}
                </p>
                {m.note && <p className="mt-0.5 text-small text-muted">{m.note}</p>}
                <p className="mt-1 flex flex-wrap items-center gap-1">
                  <span className="text-small text-muted">Ticket codes</span>
                  {m.ticketCodes.length === 0 && <span className="text-small text-muted">none</span>}
                  {m.ticketCodes.map(code => (
                    <span key={code} className="rounded-sm bg-surface-muted px-1.5 font-mono text-mono text-ink">{code}</span>
                  ))}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-mono text-ink">{m.disposalCentsPerTon !== undefined ? `${formatCents(m.disposalCentsPerTon)}/t` : 'n/a'}</p>
                <p className="text-small text-muted">disposal</p>
              </div>
              <button type="button" className={BUTTON_LINK} aria-label={`Edit ${m.name}`} onClick={() => setEditing({ kind: 'material', id: m.id })}>Edit</button>
            </li>
          ))}
        </ul>
      </Card>

      <Card label="Rental and weight terms" className="overflow-x-auto">
        <div className="px-5 pt-5">
          <h3 className="text-h2 font-bold tracking-tight">Rental and weight terms by size</h3>
          <p className="mt-0.5 text-body text-muted">
            Days and the standard material's tons. They price extra days and tickets billed from now on, never a posted invoice.
          </p>
        </div>
        {noticeFor('terms')}
        <div className="overflow-x-auto p-5">
          <table className="w-full min-w-[900px] border-collapse text-left" data-testid="rolloff-terms">
            <thead>
              <tr className="border-b border-line text-small text-muted">
                <th className="py-2 pr-3 font-semibold">Size</th>
                <th className="py-2 pr-3 text-right font-semibold">Included days</th>
                <th className="py-2 pr-3 text-right font-semibold">Extra day</th>
                <th className="py-2 pr-3 text-right font-semibold">Grace</th>
                <th className="py-2 pr-3 text-right font-semibold">Max rental</th>
                <th className="py-2 pr-3 text-right font-semibold">Included tons</th>
                <th className="py-2 pr-3 text-right font-semibold">Overage</th>
                <th className="py-2 pr-3 font-semibold">Tiers</th>
                <th className="py-2 pr-3 text-right font-semibold">Minimum</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {matrix.sizes.map(s => {
                const r = s.rolloff!
                return (
                  <tr key={s.id} data-size={s.id} className="border-b border-line font-mono text-mono">
                    <td className="py-2 pr-3 font-sans text-body font-semibold text-ink">{sizeName(s)}</td>
                    <td className="py-2 pr-3 text-right">{r.includedDays}</td>
                    <td className="py-2 pr-3 text-right">{formatCents(r.extraDayCents)}</td>
                    <td className="py-2 pr-3 text-right">{r.graceDays ?? 0}</td>
                    <td className="py-2 pr-3 text-right">{r.maxRentalDays ?? 'none'}</td>
                    <td className="py-2 pr-3 text-right">{tonsText(r.includedTons)} t</td>
                    <td className="py-2 pr-3 text-right">{formatCents(r.overageCentsPerTon)}/t</td>
                    <td className="py-2 pr-3 font-sans text-small text-muted">{tiersText(r.overageTiers) || 'none'}</td>
                    <td className="py-2 pr-3 text-right">{r.minBilledTons ? `${tonsText(r.minBilledTons)} t` : 'none'}</td>
                    <td className="py-2 text-right">
                      <button type="button" className={BUTTON_LINK} aria-label={`Edit terms for ${sizeName(s)}`} onClick={() => setEditing({ kind: 'terms', catalogId: s.id })}>Edit</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <PolicyCard policy={policy} />

      <HaulCalculator zoneId={zoneId} today={today} />

      {editing?.kind === 'cell' && editingCell && editingSize && (
        <CellDrawer
          cell={editingCell}
          size={editingSize}
          today={today}
          onClose={close}
          onSaved={row => {
            close()
            setNotice({ where: 'matrix', text: `Saved ${row.id}: ${editingCell.material.name} in the ${sizeName(editingSize)} from ${row.effectiveFrom}${row.supersedesId ? `, superseding ${row.supersedesId}` : ''}.` })
          }}
        />
      )}
      {editing?.kind === 'material' && (
        <MaterialDrawer
          material={editing.id ? materials.find(m => m.id === editing.id) : undefined}
          onClose={close}
          onSaved={m => {
            close()
            setNotice({ where: 'materials', text: `${editing.id ? 'Saved' : 'Added'} ${m.name}.${editing.id ? '' : ' Open its cells in the matrix to take it in a size.'}` })
          }}
        />
      )}
      {editing?.kind === 'terms' && editingSize && (
        <TermsDrawer
          size={editingSize}
          onClose={close}
          onSaved={() => {
            close()
            setNotice({ where: 'terms', text: `Saved the ${sizeName(editingSize)} terms. Extra days and tickets billed from now on use them.` })
          }}
        />
      )}
    </div>
  )
}

/** One matrix cell: haul price, tons included, rate over, badges; greyed with the reason when it does not price. */
function CellView({ cell, label, scheduledFrom, onOpen }: { cell: MatrixCell; label: string; scheduledFrom: string | undefined; onOpen: () => void }) {
  const t = cell.terms
  const badges = (
    <span className="mt-1 flex flex-wrap gap-1">
      {t.overageTiers?.length ? <Pill tone="accent" title={tiersText(t.overageTiers)}>{t.overageTiers.length} tier{t.overageTiers.length === 1 ? '' : 's'}</Pill> : null}
      {t.minBilledTons ? <Pill tone="warning">min {tonsText(t.minBilledTons)} t</Pill> : null}
      {scheduledFrom && <Pill tone="accent" dot>New from {scheduledFrom}</Pill>}
    </span>
  )
  if (cell.status === 'prohibited') {
    return (
      <span data-cell={`${cell.catalogId}|${cell.material.id}`} data-status={cell.status} aria-label={`${label}: prohibited`} className="block rounded-md border border-dashed border-line bg-surface-muted px-3 py-2 text-small font-semibold text-muted">
        {REASON.prohibited}
      </span>
    )
  }
  const priced = cell.status === 'priced'
  return (
    <button
      type="button"
      aria-label={label}
      title={priced ? undefined : REASON[cell.status]}
      data-cell={`${cell.catalogId}|${cell.material.id}`}
      data-status={cell.status}
      onClick={onOpen}
      className={[
        'block w-full rounded-md border px-3 py-2 text-left transition-colors hover:border-accent',
        priced ? 'border-line bg-surface hover:bg-accent-soft' : 'border-dashed border-line bg-surface-muted text-muted',
      ].join(' ')}
    >
      {priced && cell.haulCents !== undefined && <span className="block font-mono text-mono font-semibold text-ink">{formatCents(cell.haulCents)}</span>}
      {!priced && <span className="block text-small font-semibold text-muted">{REASON[cell.status]}</span>}
      {cell.status !== 'notAccepted' && (
        <>
          <span className="block text-small">{tonsText(t.includedTons)} t incl.</span>
          <span className="block font-mono text-small">{formatCents(t.overageCentsPerTon)}/t over</span>
          {badges}
        </>
      )}
      {cell.status === 'notAccepted' && scheduledFrom && badges}
    </button>
  )
}
