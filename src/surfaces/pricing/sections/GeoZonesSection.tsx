import { useMemo, useState } from 'react'
import type { GeoZone } from '../../../types'
import { useStore } from '../../../store/useStore'
import { geoZoneFor } from '../../../store/engine'
import { BUTTON_LINK, BUTTON_PRIMARY, BUTTON_SECONDARY, Card, Field, Problems, SectionHeader, TextInput, attempt } from '../components/form'
import { dimensionUsage } from '../lib/config'
import { areaSqMi, areaText, countInside, insideText, plural, type LatLng } from '../lib/geo'
import GeoZoneMap, { ZONE_COLORS, zoneColor, type MapMode } from './GeoZoneMap'

const DESCRIPTION =
  'Areas you draw on the map: a city, a neighborhood, a stretch of county. A site is in the zone that holds it; where zones overlap, the one higher in the list wins. Price by zone by adding Zone to a service\'s Priced by, or as a condition on an adjustment.'

/**
 * The Zones section (DECISIONS.md entry 69): zones the owner draws on the map. The map (GeoZoneMap) sits beside the
 * list in priority order; each row shows the sites the zone holds (by geoZoneFor, so overlap priority counts), its
 * active service lines, and how many rates and adjustments use it, with Move up and down, Edit shape, Rename, and
 * Delete (refused by the store while anything uses it). Draw a zone and Circle around a point open the map's drawing
 * modes; a closed outline opens the form that names it and saves it through saveGeoZone.
 */
export default function GeoZonesSection({ today }: { today: string }) {
  const db = useStore(s => s.db)
  const drafts = useStore(s => s.pricingDrafts)
  const saveGeoZone = useStore(s => s.saveGeoZone)
  const deleteGeoZone = useStore(s => s.deleteGeoZone)
  const moveGeoZone = useStore(s => s.moveGeoZone)
  const zones = db.geoZones ?? []

  const [mode, setMode] = useState<MapMode>({ kind: 'view' })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])

  const stats = useMemo(() => {
    const siteZone = new Map(db.sites.map(s => [s.id, geoZoneFor(s, db)] as const))
    const sites = new Map<string, number>()
    const lines = new Map<string, number>()
    for (const z of siteZone.values()) if (z) sites.set(z, (sites.get(z) ?? 0) + 1)
    for (const si of db.serviceItems) {
      const z = si.status === 'active' ? siteZone.get(si.siteId) : undefined
      if (z) lines.set(z, (lines.get(z) ?? 0) + 1)
    }
    const outside = db.sites.filter(s => !siteZone.get(s.id))
    return { sites, lines, outside }
  }, [db])
  const usage = useMemo(() => dimensionUsage(db, 'geoZone', drafts), [db, drafts])

  const start = (next: MapMode) => {
    setProblems([])
    setRenaming(null)
    setMode(next)
  }
  const cancel = () => setMode({ kind: 'view' })

  const saveShape = (zoneId: string, polygon: LatLng[]) => {
    const zone = zones.find(z => z.id === zoneId)
    if (!zone) return
    const r = attempt(() => saveGeoZone({ id: zone.id, name: zone.name, polygon, ...(zone.color ? { color: zone.color } : {}), ...(zone.description ? { description: zone.description } : {}) }))
    setProblems(r.ok ? [] : r.problems)
    if (r.ok) setMode({ kind: 'view' })
  }

  const move = (zone: GeoZone, direction: 'up' | 'down') => {
    const r = attempt(() => moveGeoZone({ id: zone.id, direction }))
    setProblems(r.ok ? [] : r.problems)
  }

  const remove = (zone: GeoZone) => {
    const r = attempt(() => deleteGeoZone({ id: zone.id }))
    setProblems(r.ok ? [] : r.problems)
    if (r.ok) {
      if (selectedId === zone.id) setSelectedId(null)
      if (mode.kind === 'edit' && mode.zoneId === zone.id) setMode({ kind: 'view' })
    }
  }

  const noCoords = stats.outside.filter(s => s.lat === undefined || s.lng === undefined).length

  return (
    <div className="space-y-6" data-today={today}>
      <SectionHeader
        title="Zones"
        description={DESCRIPTION}
        actions={(
          <>
            <button type="button" className={BUTTON_PRIMARY} onClick={() => start({ kind: 'draw' })}>Draw a zone</button>
            <button type="button" className={BUTTON_SECONDARY} onClick={() => start({ kind: 'circle' })}>Circle around a point</button>
          </>
        )}
      />
      <Problems problems={problems} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card label="Map" className="min-w-0 self-start p-3">
          <GeoZoneMap
            db={db}
            mode={mode}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onOutline={polygon => setMode({ kind: 'review', polygon })}
            onSaveShape={saveShape}
            onCancel={cancel}
          />
        </Card>

        <div className="min-w-0 space-y-4">
          {mode.kind === 'review' && (
            <NewZoneForm
              polygon={mode.polygon}
              usedColors={zones.map((z, i) => zoneColor(z, i))}
              onSaved={zone => {
                setMode({ kind: 'view' })
                setSelectedId(zone.id)
              }}
              onDiscard={cancel}
            />
          )}

          <Card label="Zones in priority order">
            <div className="border-b border-line px-4 py-3">
              <h3 className="text-h2 font-bold">Priority order</h3>
              <p className="text-small text-muted">Where zones overlap, the one higher in the list wins.</p>
            </div>
            {zones.length === 0 ? (
              <p className="px-4 py-4 text-body text-muted">No zones yet. Draw one on the map, or circle around a point.</p>
            ) : (
              <ol className="divide-y divide-line">
                {zones.map((z, i) => (
                  <ZoneRow
                    key={z.id}
                    zone={z}
                    index={i}
                    last={i === zones.length - 1}
                    selected={z.id === selectedId}
                    editingShape={mode.kind === 'edit' && mode.zoneId === z.id}
                    renaming={renaming === z.id}
                    sites={stats.sites.get(z.id) ?? 0}
                    lines={stats.lines.get(z.id) ?? 0}
                    used={usage.get(z.id) ?? 0}
                    onSelect={() => setSelectedId(z.id === selectedId ? null : z.id)}
                    onMove={dir => move(z, dir)}
                    onEditShape={() => {
                      start({ kind: 'edit', zoneId: z.id })
                      setSelectedId(z.id)
                    }}
                    onRename={() => {
                      setProblems([])
                      setRenaming(z.id)
                    }}
                    onRenameDone={() => setRenaming(null)}
                    onDelete={() => remove(z)}
                  />
                ))}
              </ol>
            )}
          </Card>

          <Card label="Sites outside every zone" className="p-4">
            <details data-testid="outside-sites">
              <summary className="cursor-pointer text-body font-semibold text-ink">Sites outside every zone: {stats.outside.length}</summary>
              {stats.outside.length === 0 ? (
                <p className="mt-2 text-small text-muted">Every site is in a zone.</p>
              ) : (
                <ul className="mt-2 max-h-64 space-y-0.5 overflow-y-auto text-small text-ink">
                  {stats.outside.map(s => (
                    <li key={s.id} className="flex flex-wrap justify-between gap-x-2">
                      <span>{s.address}</span>
                      {(s.lat === undefined || s.lng === undefined) && <span className="text-muted">no location yet</span>}
                    </li>
                  ))}
                </ul>
              )}
            </details>
            <p className="mt-2 text-small text-muted">
              A site with no coordinates yet (a new sign-up before its address is placed) is in no zone.
              {noCoords > 0 ? ` ${plural(noCoords, 'site has', 'sites have')} none yet.` : ''}
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}

/** The eight zone colors as a radio group of swatches. */
function Swatches({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {ZONE_COLORS.map(c => {
        const on = c.value.toLowerCase() === value.toLowerCase()
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={c.name}
            title={c.name}
            onClick={() => onChange(c.value)}
            style={{ backgroundColor: c.value }}
            className={['h-7 w-7 rounded-pill border-2 transition-transform', on ? 'scale-110 border-ink' : 'border-surface hover:scale-105'].join(' ')}
          />
        )
      })}
    </div>
  )
}

/** Names a closed outline and saves it as a zone at the bottom of the list. */
function NewZoneForm({ polygon, usedColors, onSaved, onDiscard }: { polygon: LatLng[]; usedColors: string[]; onSaved: (z: GeoZone) => void; onDiscard: () => void }) {
  const db = useStore(s => s.db)
  const saveGeoZone = useStore(s => s.saveGeoZone)
  const used = new Set(usedColors.map(c => c.toLowerCase()))
  const [name, setName] = useState('')
  const [color, setColor] = useState(() => (ZONE_COLORS.find(c => !used.has(c.value.toLowerCase())) ?? ZONE_COLORS[0]).value)
  const [description, setDescription] = useState('')
  const [problems, setProblems] = useState<string[]>([])
  const counts = countInside(polygon, db.sites, db.serviceItems)

  const save = () => {
    const r = attempt(() => saveGeoZone({ name, polygon, color, ...(description.trim() ? { description } : {}) }))
    if (r.ok) onSaved(r.value)
    else setProblems(r.problems)
  }

  return (
    <Card label="New zone" className="space-y-3 p-4">
      <div>
        <h3 className="text-h2 font-bold">New zone</h3>
        <p className="text-small text-muted">
          {plural(polygon.length, 'point')}, about {areaText(areaSqMi(polygon))}; {insideText(counts)}. It goes to the bottom of the list; move it up if it should win where it overlaps another zone.
        </p>
      </div>
      <Field label="Name">
        <TextInput value={name} onChange={setName} placeholder="Lake shore" />
      </Field>
      <div>
        <span className="block text-small font-semibold text-ink">Color</span>
        <div className="mt-1"><Swatches value={color} onChange={setColor} label="Color" /></div>
      </div>
      <Field label="Description">
        <TextInput value={description} onChange={setDescription} placeholder="Optional. What the area is, in a few words" />
      </Field>
      <Problems problems={problems} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BUTTON_PRIMARY} onClick={save}>Save zone</button>
        <button type="button" className={BUTTON_SECONDARY} onClick={onDiscard}>Discard</button>
      </div>
    </Card>
  )
}

function ZoneRow({
  zone, index, last, selected, editingShape, renaming, sites, lines, used, onSelect, onMove, onEditShape, onRename, onRenameDone, onDelete,
}: {
  zone: GeoZone
  index: number
  last: boolean
  selected: boolean
  editingShape: boolean
  renaming: boolean
  sites: number
  lines: number
  used: number
  onSelect: () => void
  onMove: (d: 'up' | 'down') => void
  onEditShape: () => void
  onRename: () => void
  onRenameDone: () => void
  onDelete: () => void
}) {
  const color = zoneColor(zone, index)
  return (
    <li data-geozone={zone.id} className={['flex items-start gap-3 px-4 py-3', selected ? 'bg-accent-soft/50' : ''].join(' ')}>
      <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-small text-muted" title="Priority">{index + 1}</span>
      <span aria-hidden="true" className="mt-1 h-3.5 w-3.5 shrink-0 rounded-sm border" style={{ backgroundColor: color, borderColor: color }} />
      <div className="min-w-0 flex-1">
        {renaming ? (
          <RenameEditor zone={zone} color={color} onDone={onRenameDone} />
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <button type="button" aria-pressed={selected} onClick={onSelect} className="text-left text-body font-semibold text-ink hover:text-accent">
                {zone.name}
              </button>
              <span className="font-mono text-small text-muted">{zone.id}</span>
            </div>
            {zone.description && <p className="text-small text-muted">{zone.description}</p>}
            <p className="text-small text-ink">{insideText({ sites, lines })}</p>
            <p className="text-small text-muted">
              {used > 0 ? `Used by ${plural(used, 'rate or adjustment', 'rates and adjustments')}` : 'No rate or adjustment uses it yet'}; about {areaText(areaSqMi(zone.polygon))}
            </p>
            {editingShape && <p className="text-small font-semibold text-accent">Editing the shape on the map</p>}
            <div className="mt-1.5 flex flex-wrap gap-1">
              <button type="button" className={BUTTON_LINK} aria-label={`Move ${zone.name} up`} disabled={index === 0} onClick={() => onMove('up')}>Up</button>
              <button type="button" className={BUTTON_LINK} aria-label={`Move ${zone.name} down`} disabled={last} onClick={() => onMove('down')}>Down</button>
              <button type="button" className={BUTTON_LINK} aria-label={`Edit shape of ${zone.name}`} onClick={onEditShape}>Edit shape</button>
              <button type="button" className={BUTTON_LINK} aria-label={`Rename ${zone.name}`} onClick={onRename}>Rename</button>
              <button type="button" className={`${BUTTON_LINK} text-danger`} aria-label={`Delete ${zone.name}`} onClick={onDelete}>Delete</button>
            </div>
          </>
        )}
      </div>
    </li>
  )
}

/** Inline name, color, and description edit; the shape stays as it is. */
function RenameEditor({ zone, color: initialColor, onDone }: { zone: GeoZone; color: string; onDone: () => void }) {
  const saveGeoZone = useStore(s => s.saveGeoZone)
  const [name, setName] = useState(zone.name)
  const [description, setDescription] = useState(zone.description ?? '')
  const [color, setColor] = useState(initialColor)
  const [problems, setProblems] = useState<string[]>([])
  const save = () => {
    const r = attempt(() => saveGeoZone({ id: zone.id, name, polygon: zone.polygon, color, description }))
    if (r.ok) onDone()
    else setProblems(r.problems)
  }
  return (
    <div className="space-y-2">
      <Field label="Name">
        <TextInput value={name} onChange={setName} ariaLabel={`New name for ${zone.name}`} />
      </Field>
      <Field label="Description">
        <TextInput value={description} onChange={setDescription} ariaLabel={`Description of ${zone.name}`} />
      </Field>
      <Swatches value={color} onChange={setColor} label={`Color of ${zone.name}`} />
      <Problems problems={problems} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BUTTON_PRIMARY} onClick={save}>Save</button>
        <button type="button" className={BUTTON_SECONDARY} onClick={onDone}>Cancel</button>
      </div>
    </div>
  )
}
