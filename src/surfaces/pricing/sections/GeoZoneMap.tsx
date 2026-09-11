import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react'
import type { GeoZone } from '../../../types'
import type { Db } from '../../../store/db'
import { geoZoneFor } from '../../../store/engine'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, Field, NumberInput, TextInput } from '../components/form'
import {
  areaSqMi, areaText, boundsOf, centroid, circleOutline, countInside, formatPoints, insideText, milesPerUnit, parsePoint, parsePoints, projectionFor,
  round6, tileZoomFor, tilesCovering, type LatLng, type Projection, type Tile,
} from '../lib/geo'

/** Eight distinct zone colors, named for their swatches. The first five are the seeded zones' colors. */
export const ZONE_COLORS: { name: string; value: string }[] = [
  { name: 'Sky', value: '#0EA5E9' },
  { name: 'Pink', value: '#DB2777' },
  { name: 'Indigo', value: '#6366F1' },
  { name: 'Green', value: '#16A34A' },
  { name: 'Amber', value: '#D97706' },
  { name: 'Red', value: '#DC2626' },
  { name: 'Teal', value: '#0D9488' },
  { name: 'Purple', value: '#9333EA' },
]

/** A zone's color, or a palette color by its place in the list when it has none. */
export function zoneColor(zone: Pick<GeoZone, 'color'>, index: number): string {
  return zone.color ?? ZONE_COLORS[index % ZONE_COLORS.length].value
}

/**
 * A base map under the zones: free, open source tiles, or the grid alone. OpenStreetMap's standard tiles are open data
 * (ODbL) from open source server software run by the OpenStreetMap Foundation, need no key, and their usage policy
 * requires the attribution shown whenever they are on screen.
 */
export interface BaseMap {
  id: string
  label: string
  /** Tile URL with {z}, {x}, {y}; none for the grid. */
  url?: string
  attribution: { text: string; href: string }[]
}

export const BASE_MAPS: BaseMap[] = [
  {
    id: 'osm',
    label: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: [{ text: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' }],
  },
  { id: 'grid', label: 'Grid only', attribution: [] },
]
/** localStorage key for the base map the viewer picked. A stored value that is not one of BASE_MAPS is ignored. */
export const BASE_MAP_KEY = 'pricing.geoZones.baseMap'

function readBaseMap(): string {
  try {
    const v = window.localStorage.getItem(BASE_MAP_KEY)
    return v && BASE_MAPS.some(m => m.id === v) ? v : BASE_MAPS[0].id
  } catch {
    return BASE_MAPS[0].id
  }
}

function saveBaseMap(id: string) {
  try {
    window.localStorage.setItem(BASE_MAP_KEY, id)
  } catch {
    // Storage blocked (private window, previews): the choice lasts for this visit only.
  }
}

function tileUrl(map: BaseMap, t: Tile): string {
  return (map.url ?? '').replace('{z}', String(t.z)).replace('{x}', String(t.wrappedX)).replace('{y}', String(t.y))
}

export type MapMode =
  | { kind: 'view' }
  | { kind: 'draw' }
  | { kind: 'circle' }
  | { kind: 'edit'; zoneId: string }
  /** An outline is closed and waits for its name in the section's form. */
  | { kind: 'review'; polygon: LatLng[] }

interface View {
  x: number
  y: number
  w: number
  h: number
}

const GRID_MILES = 5
/** Width assumed for the map before (or without) a ResizeObserver, as in jsdom. */
const FALLBACK_WIDTH_PX = 800
const TEXTAREA = 'w-full rounded-sm border border-line bg-surface px-2.5 py-2 font-mono text-small text-ink outline-none focus:border-accent'
const MAP_BUTTON = 'flex h-8 min-w-8 items-center justify-center rounded-md border border-line bg-surface px-2 text-body font-semibold text-ink shadow-card hover:bg-surface-muted'

/** Client pixels to world units, through the SVG's own transform (viewBox and letterboxing included). */
function toWorld(svg: SVGSVGElement | null, clientX: number, clientY: number): [number, number] | null {
  const ctm = svg?.getScreenCTM?.()
  if (!ctm || typeof DOMPoint === 'undefined') return null
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
  return [p.x, p.y]
}

function pathOf(proj: Projection, polygon: readonly (readonly [number, number])[], close = true): string {
  if (polygon.length === 0) return ''
  const d = polygon.map(([lat, lng], i) => {
    const [x, y] = proj.toXY(lat, lng)
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(7)} ${y.toFixed(7)}`
  }).join(' ')
  return close ? `${d} Z` : d
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

/**
 * The map of drawn zones (DECISIONS.md entry 69). Web Mercator in world units, so OpenStreetMap's free, open source
 * tiles sit under the zones as SVG images, at the tile zoom that shows a tile at about 256 screen pixels (3 to 19);
 * "Grid only" draws a 5 mile grid instead, and so does a failed tile load. On top: each zone's polygon and
 * name, every site as a dot in its zone's color (gray outside every zone), and a 5 mile scale bar measured at the
 * view's latitude. View mode pans by dragging and zooms with the wheel or the buttons; clicking a zone selects it.
 * Draw mode adds a point per click, circle mode builds a 24 point outline around a clicked center, and edit mode
 * drags, inserts, and removes the selected zone's points. The Points box mirrors the outline both ways, so the map
 * works without a pointer.
 */
export default function GeoZoneMap({
  db, mode, selectedId, onSelect, onOutline, onSaveShape, onCancel,
}: {
  db: Db
  mode: MapMode
  selectedId: string | null
  onSelect: (id: string | null) => void
  onOutline: (polygon: LatLng[]) => void
  onSaveShape: (zoneId: string, polygon: LatLng[]) => void
  onCancel: () => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const zones = db.geoZones ?? []

  const proj = useMemo(() => {
    const pts: [number, number][] = []
    for (const s of db.sites) if (s.lat !== undefined && s.lng !== undefined) pts.push([s.lat, s.lng])
    for (const z of db.geoZones ?? []) pts.push(...z.polygon)
    return projectionFor(boundsOf(pts))
  }, [db.sites, db.geoZones])
  const fitLat = proj.toLatLng(proj.x + proj.width / 2, proj.y + proj.height / 2)[0]

  const [zoom, setZoom] = useState<View | null>(null)
  const view: View = zoom ?? { x: proj.x, y: proj.y, w: proj.width, h: proj.height }

  // The SVG's rendered size, for the tile zoom.
  const [box, setBox] = useState<{ w: number; h: number }>({ w: FALLBACK_WIDTH_PX, h: 0 })
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect
      if (r && r.width > 0) setBox({ w: r.width, h: r.height })
    })
    ro.observe(svg)
    return () => ro.disconnect()
  }, [])

  // Base map, remembered per viewer. A provider whose first tiles mostly fail falls back to the grid.
  const [baseMapId, setBaseMapId] = useState(readBaseMap)
  const baseMap = BASE_MAPS.find(m => m.id === baseMapId) ?? BASE_MAPS[0]
  const [failedMap, setFailedMap] = useState<string | null>(null)
  const tileStats = useRef({ id: '', batch: 0, loaded: 0, failed: 0, settled: false })
  const chooseBaseMap = (id: string) => {
    setBaseMapId(id)
    saveBaseMap(id)
    tileStats.current.id = ''
    if (failedMap === id) setFailedMap(null)
  }
  const showTiles = !!baseMap.url && failedMap !== baseMap.id

  // Drawing state, reset whenever the mode (or the zone being edited) changes.
  const modeKey = mode.kind === 'edit' ? `edit:${mode.zoneId}` : mode.kind
  const initialPoints = (): LatLng[] =>
    mode.kind === 'edit' ? (zones.find(z => z.id === mode.zoneId)?.polygon ?? []).map(([lat, lng]) => [lat, lng] as LatLng) : []
  const [session, setSession] = useState(modeKey)
  const [points, setPoints] = useState<LatLng[]>(initialPoints)
  const [text, setText] = useState(() => formatPoints(initialPoints()))
  const [textProblems, setTextProblems] = useState<string[]>([])
  const [center, setCenter] = useState<LatLng | null>(null)
  const [centerText, setCenterText] = useState('')
  const [radius, setRadius] = useState<number | undefined>(3)
  if (session !== modeKey) {
    const init = initialPoints()
    setSession(modeKey)
    setPoints(init)
    setText(formatPoints(init))
    setTextProblems([])
    setCenter(null)
    setCenterText('')
    setRadius(3)
  }

  /** A change made on the map: the Points box follows. */
  const fromMap = useCallback((next: LatLng[]) => {
    setPoints(next)
    setText(formatPoints(next))
    setTextProblems([])
  }, [])
  /** A change typed in the Points box: the map follows once every line reads as a point. */
  const fromText = (t: string) => {
    setText(t)
    const r = parsePoints(t)
    setTextProblems(r.problems)
    if (r.problems.length === 0) setPoints(r.points)
  }
  const placeCenter = (c: LatLng) => {
    setCenter(c)
    setCenterText(formatPoints([c]))
  }
  const fromCenterText = (t: string) => {
    setCenterText(t)
    setCenter(parsePoint(t) ?? null)
  }

  const circle = mode.kind === 'circle' && center && radius !== undefined && radius > 0 ? circleOutline(center, radius, 24) : null
  const liveShape: LatLng[] = mode.kind === 'draw' || mode.kind === 'edit' ? points : mode.kind === 'circle' ? circle ?? [] : mode.kind === 'review' ? mode.polygon : []
  const live = countInside(liveShape, db.sites, db.serviceItems)
  const canClose = points.length >= 3 && textProblems.length === 0
  const finish = () => {
    if (canClose) onOutline(points)
  }

  // Keyboard: Escape cancels drawing, circling, or editing; Backspace removes the last point while drawing.
  const pointsRef = useRef(points)
  pointsRef.current = points
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel
  const drawing = mode.kind === 'draw' || mode.kind === 'circle' || mode.kind === 'edit'
  useEffect(() => {
    if (!drawing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelRef.current()
      else if (e.key === 'Backspace' && mode.kind === 'draw' && !isTyping(e.target) && pointsRef.current.length > 0) {
        e.preventDefault()
        fromMap(pointsRef.current.slice(0, -1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawing, mode.kind, fromMap])

  // Zoom no closer than 12 miles across, no farther than three times the fitted view.
  const minW = Math.min(12 / milesPerUnit(fitLat), proj.width)
  const zoomBy = useCallback((factor: number, at?: [number, number] | null) => {
    setZoom(z => {
      const v = z ?? { x: proj.x, y: proj.y, w: proj.width, h: proj.height }
      const w = Math.min(proj.width * 3, Math.max(minW, v.w * factor))
      const f = w / v.w
      const [px, py] = at ?? [v.x + v.w / 2, v.y + v.h / 2]
      return { x: px - (px - v.x) * f, y: py - (py - v.y) * f, w, h: v.h * f }
    })
  }, [proj.x, proj.y, proj.width, proj.height, minW])

  // Wheel zoom around the pointer. A native listener, since React's wheel listener is passive and cannot stop the page scrolling.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomBy(e.deltaY > 0 ? 1.2 : 1 / 1.2, toWorld(svg, e.clientX, e.clientY))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  // View mode: drag anywhere to pan; a press that does not move is a click that selects the zone under it.
  const pan = useRef<{ id: number; sx: number; sy: number; v: View; moved: boolean; zoneId: string | null } | null>(null)
  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (mode.kind !== 'view' || e.button !== 0) return
    const zoneEl = (e.target as Element).closest?.('[data-zone]')
    pan.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, v: view, moved: false, zoneId: zoneEl?.getAttribute('data-zone') ?? null }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const p = pan.current
    if (!p || p.id !== e.pointerId) return
    const dx = e.clientX - p.sx
    const dy = e.clientY - p.sy
    if (!p.moved && Math.hypot(dx, dy) < 4) return
    p.moved = true
    const rect = e.currentTarget.getBoundingClientRect()
    const scale = rect.width > 0 && rect.height > 0 ? Math.max(p.v.w / rect.width, p.v.h / rect.height) : 0
    setZoom({ ...p.v, x: p.v.x - dx * scale, y: p.v.y - dy * scale })
  }
  const onPointerUp = (e: RPointerEvent<SVGSVGElement>) => {
    const p = pan.current
    if (!p || p.id !== e.pointerId) return
    pan.current = null
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (!p.moved) onSelect(p.zoneId)
  }
  // Draw and circle modes: a click on the map adds a point or places the center.
  const onClick = (e: RMouseEvent<SVGSVGElement>) => {
    if (mode.kind !== 'draw' && mode.kind !== 'circle') return
    const w = toWorld(svgRef.current, e.clientX, e.clientY)
    if (!w) return
    const [lat, lng] = proj.toLatLng(w[0], w[1])
    const pt: LatLng = [round6(lat), round6(lng)]
    if (mode.kind === 'draw') fromMap([...points, pt])
    else placeCenter(pt)
  }

  // Edit mode: drag a vertex with the pointer captured; alt-click removes it.
  const drag = useRef<{ id: number; index: number } | null>(null)
  const onVertexDown = (e: RPointerEvent<SVGCircleElement>, index: number) => {
    if (mode.kind !== 'edit') return
    e.stopPropagation()
    if (e.altKey) {
      if (points.length > 3) fromMap(points.filter((_, i) => i !== index))
      return
    }
    drag.current = { id: e.pointerId, index }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onVertexMove = (e: RPointerEvent<SVGCircleElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const w = toWorld(svgRef.current, e.clientX, e.clientY)
    if (!w) return
    const [lat, lng] = proj.toLatLng(w[0], w[1])
    fromMap(pointsRef.current.map((p, i) => (i === d.index ? [round6(lat), round6(lng)] : p)))
  }
  const onVertexUp = (e: RPointerEvent<SVGCircleElement>) => {
    if (!drag.current || drag.current.id !== e.pointerId) return
    drag.current = null
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }
  const insertAfter = (index: number) => {
    const a = points[index]
    const b = points[(index + 1) % points.length]
    const mid: LatLng = [round6((a[0] + b[0]) / 2), round6((a[1] + b[1]) / 2)]
    fromMap([...points.slice(0, index + 1), mid, ...points.slice(index + 1)])
  }

  // Sizes in world units that read as roughly constant pixels at the map's usual width.
  const k = view.w / 760
  const dotR = 3.6 * k
  const handleR = 5.5 * k
  const font = 12 * k

  // Tiles: the visible world rectangle (letterboxing included once the size is known) at the zoom where a tile shows
  // at about 256 screen pixels, at most 64 of them.
  const pxPerUnit = box.h > 0 ? Math.min(box.w / view.w, box.h / view.h) : box.w / view.w
  const visW = box.w / pxPerUnit
  const visH = box.h > 0 ? box.h / pxPerUnit : view.h
  const visible = { x: view.x + view.w / 2 - visW / 2, y: view.y + view.h / 2 - visH / 2, w: visW, h: visH }
  const { z: tileZoom, tiles } = showTiles ? tilesCovering(visible, tileZoomFor(pxPerUnit), { cap: 64 }) : { z: 0, tiles: [] as Tile[] }
  const noteTile = (ok: boolean) => {
    const s = tileStats.current
    if (s.id !== baseMap.id) Object.assign(s, { id: baseMap.id, batch: tiles.length, loaded: 0, failed: 0, settled: false })
    if (s.settled) return
    if (ok) s.loaded += 1
    else s.failed += 1
    if (s.failed > s.batch / 2) {
      s.settled = true
      setFailedMap(baseMap.id)
    } else if (s.loaded + s.failed >= s.batch) {
      s.settled = true
    }
  }

  // Grid every 5 miles (at the fitted view's latitude), only when no tiles show.
  const gridStep = GRID_MILES / milesPerUnit(fitLat)
  const gx0 = Math.floor(Math.min(proj.x, view.x) / gridStep) * gridStep
  const gx1 = Math.max(proj.x + proj.width, view.x + view.w)
  const gy0 = Math.floor(Math.min(proj.y, view.y) / gridStep) * gridStep
  const gy1 = Math.max(proj.y + proj.height, view.y + view.h)
  const vLines: number[] = []
  const hLines: number[] = []
  if (!showTiles) {
    for (let x = gx0; x <= gx1 && vLines.length < 300; x += gridStep) vLines.push(x)
    for (let y = gy0; y <= gy1 && hLines.length < 300; y += gridStep) hLines.push(y)
  }

  const editingId = mode.kind === 'edit' ? mode.zoneId : null
  const editingIndex = editingId ? zones.findIndex(z => z.id === editingId) : -1
  const editColor = editingIndex >= 0 ? zoneColor(zones[editingIndex], editingIndex) : undefined
  const zoneTypeName = (id: string) => db.zones.find(z => z.id === id)?.name ?? id
  const siteDots = db.sites.filter(s => s.lat !== undefined && s.lng !== undefined).map(s => {
    const gz = geoZoneFor(s, db)
    const index = gz ? zones.findIndex(z => z.id === gz) : -1
    return { site: s, zone: index >= 0 ? zones[index] : undefined, color: index >= 0 ? zoneColor(zones[index], index) : undefined }
  })
  // The scale bar is 5 miles at the latitude in the middle of the view.
  const viewLat = proj.toLatLng(view.x + view.w / 2, view.y + view.h / 2)[0]
  const barW = GRID_MILES / milesPerUnit(viewLat)
  const scaleX = view.x + view.w * 0.03
  const scaleY = view.y + view.h * 0.95
  const barPath = `M${scaleX} ${scaleY - k * 5} L${scaleX} ${scaleY} L${scaleX + barW} ${scaleY} L${scaleX + barW} ${scaleY - k * 5}`

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-card border border-line bg-surface-muted">
        <svg
          ref={svgRef}
          role="img"
          aria-label="Map of zones and sites"
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          preserveAspectRatio="xMidYMid meet"
          className="block h-auto w-full select-none"
          style={{ aspectRatio: `${proj.width} / ${proj.height}`, maxHeight: '70vh', touchAction: 'none', cursor: mode.kind === 'draw' || mode.kind === 'circle' ? 'crosshair' : mode.kind === 'view' ? 'grab' : 'default' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={onClick}
        >
          {showTiles && (
            <g data-testid="map-tiles" data-tile-zoom={tileZoom} pointerEvents="none" aria-hidden="true">
              {tiles.map(t => (
                <image
                  key={`${baseMap.id}/${t.z}/${t.x}/${t.y}`}
                  href={tileUrl(baseMap, t)}
                  x={t.x * t.size}
                  y={t.y * t.size}
                  // A hair of overlap hides the seams some browsers leave between scaled images.
                  width={t.size * 1.004}
                  height={t.size * 1.004}
                  preserveAspectRatio="none"
                  pointerEvents="none"
                  onLoad={() => noteTile(true)}
                  onError={() => noteTile(false)}
                />
              ))}
            </g>
          )}

          {!showTiles && (
            <g className="text-line" aria-hidden="true" data-testid="map-grid">
              {vLines.map(x => <line key={`v${x}`} x1={x} x2={x} y1={gy0} y2={gy1} stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
              {hLines.map(y => <line key={`h${y}`} x1={gx0} x2={gx1} y1={y} y2={y} stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
            </g>
          )}

          {zones.map((z, i) => {
            if (z.id === editingId || z.polygon.length < 3) return null
            const color = zoneColor(z, i)
            const selected = z.id === selectedId
            return (
              <path
                key={z.id}
                data-zone={z.id}
                d={pathOf(proj, z.polygon)}
                fill={color}
                fillOpacity={selected ? 0.32 : 0.18}
                stroke={color}
                strokeWidth={selected ? (showTiles ? 3.5 : 3) : showTiles ? 2 : 1.5}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              >
                <title>{z.name}</title>
              </path>
            )
          })}

          {siteDots.map(({ site, zone, color }) => {
            const [x, y] = proj.toXY(site.lat!, site.lng!)
            return (
              <circle
                key={site.id}
                data-site={site.id}
                {...(zone ? { 'data-zone': zone.id } : {})}
                cx={x}
                cy={y}
                r={dotR}
                className={[color ? '' : 'fill-muted', showTiles ? '' : 'stroke-surface'].join(' ').trim() || undefined}
                {...(color ? { fill: color } : {})}
                {...(showTiles ? { stroke: '#ffffff' } : {})}
                strokeWidth={showTiles ? 1.5 : 1}
                vectorEffect="non-scaling-stroke"
              >
                <title>{`${site.address}\nZone type: ${zoneTypeName(site.zoneId)}\nZone: ${zone ? zone.name : 'outside every zone'}`}</title>
              </circle>
            )
          })}

          {zones.map((z, i) => {
            if (z.id === editingId || z.polygon.length < 3) return null
            const [x, y] = proj.toXY(...centroid(z.polygon))
            return (
              <text
                key={`label-${z.id}`}
                x={x}
                y={y}
                fontSize={font}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-ink stroke-surface"
                strokeWidth={3}
                paintOrder="stroke"
                vectorEffect="non-scaling-stroke"
                fontWeight={z.id === selectedId ? 700 : 600}
                pointerEvents="none"
                data-color={zoneColor(z, i)}
              >
                {z.name}
              </text>
            )
          })}

          {mode.kind === 'draw' && points.length > 0 && (
            <g className="text-accent">
              {points.length >= 3 && <path d={pathOf(proj, points)} fill="currentColor" fillOpacity={0.12} stroke="none" />}
              <path d={pathOf(proj, points, false)} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              {points.length >= 3 && (
                <path d={pathOf(proj, [points[points.length - 1], points[0]], false)} fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
              )}
              {points.map(([lat, lng], i) => {
                const [x, y] = proj.toXY(lat, lng)
                const closes = i === 0 && points.length >= 3
                return (
                  <circle
                    key={i}
                    cx={x}
                    cy={y}
                    r={closes ? handleR * 1.4 : handleR}
                    className="fill-surface"
                    stroke="currentColor"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    style={{ cursor: closes ? 'pointer' : 'crosshair' }}
                    onClick={e => {
                      if (!closes) return
                      e.stopPropagation()
                      finish()
                    }}
                  >
                    {closes && <title>Click to close the outline</title>}
                  </circle>
                )
              })}
            </g>
          )}

          {mode.kind === 'circle' && center && (
            <g className="text-accent">
              {circle && <path d={pathOf(proj, circle)} fill="currentColor" fillOpacity={0.12} stroke="currentColor" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />}
              <circle cx={proj.toXY(...center)[0]} cy={proj.toXY(...center)[1]} r={handleR} fill="currentColor" />
            </g>
          )}

          {mode.kind === 'review' && (
            <g className="text-accent">
              <path d={pathOf(proj, mode.polygon)} fill="currentColor" fillOpacity={0.16} stroke="currentColor" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
            </g>
          )}

          {mode.kind === 'edit' && points.length > 0 && (
            <g>
              <path d={pathOf(proj, points)} fill={editColor} fillOpacity={0.22} stroke={editColor} strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              {points.map((a, i) => {
                const b = points[(i + 1) % points.length]
                const [ax, ay] = proj.toXY(a[0], a[1])
                const [bx, by] = proj.toXY(b[0], b[1])
                return (
                  <circle
                    key={`mid${i}`}
                    cx={(ax + bx) / 2}
                    cy={(ay + by) / 2}
                    r={handleR * 0.65}
                    className="fill-surface"
                    stroke={editColor}
                    strokeOpacity={0.7}
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                    style={{ cursor: 'copy' }}
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => {
                      e.stopPropagation()
                      insertAfter(i)
                    }}
                  >
                    <title>Click to add a point here</title>
                  </circle>
                )
              })}
              {points.map(([lat, lng], i) => {
                const [x, y] = proj.toXY(lat, lng)
                return (
                  <circle
                    key={`v${i}`}
                    cx={x}
                    cy={y}
                    r={handleR}
                    className="fill-surface"
                    stroke={editColor}
                    strokeWidth={2.5}
                    vectorEffect="non-scaling-stroke"
                    style={{ cursor: 'move' }}
                    onPointerDown={e => onVertexDown(e, i)}
                    onPointerMove={onVertexMove}
                    onPointerUp={onVertexUp}
                    onPointerCancel={onVertexUp}
                  >
                    <title>Drag to move; alt-click to remove</title>
                  </circle>
                )
              })}
            </g>
          )}

          <g className="text-ink" aria-hidden="true" pointerEvents="none" data-testid="map-scale">
            <path d={barPath} fill="none" className="stroke-surface" strokeWidth={5} vectorEffect="non-scaling-stroke" />
            <path d={barPath} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            <text x={scaleX + barW / 2} y={scaleY - k * 8} fontSize={font * 0.9} textAnchor="middle" fill="currentColor" className="stroke-surface" strokeWidth={3} paintOrder="stroke" vectorEffect="non-scaling-stroke">5 mi</text>
          </g>
        </svg>

        <label className="absolute left-2 top-2 flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-small font-semibold text-ink shadow-card">
          Map
          <select aria-label="Base map" value={baseMap.id} onChange={e => chooseBaseMap(e.target.value)} className="bg-transparent text-small font-normal text-ink outline-none">
            {BASE_MAPS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>

        <div className="absolute right-2 top-2 flex flex-col gap-1">
          <button type="button" className={MAP_BUTTON} aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(1 / 1.5)}>+</button>
          <button type="button" className={MAP_BUTTON} aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(1.5)}>&minus;</button>
          <button type="button" className={`${MAP_BUTTON} text-small`} aria-label="Fit the map to every zone and site" title="Fit" onClick={() => setZoom(null)}>Fit</button>
        </div>

        {showTiles && baseMap.attribution.length > 0 && (
          <div data-testid="map-attribution" className="absolute bottom-0 right-0 rounded-tl-md bg-surface/85 px-1.5 py-0.5 text-small text-muted">
            {baseMap.attribution.map((a, i) => (
              <span key={a.href}>
                {i > 0 && ' '}
                <a href={a.href} target="_blank" rel="noopener noreferrer" className="text-ink hover:underline">{a.text}</a>
              </span>
            ))}
          </div>
        )}
      </div>

      {failedMap === baseMap.id && (
        <p className="text-small text-muted" role="status">Map tiles did not load, so the grid is shown. Check the connection.</p>
      )}

      <p className="text-small text-muted">
        Each dot is a site, colored by the zone it is in; gray dots are outside every zone. {showTiles ? 'The scale bar shows 5 miles.' : 'Grid lines are 5 miles apart.'} Drag to move the map, scroll or use the buttons to zoom, and click a zone to select it.
      </p>

      {mode.kind === 'draw' && (
        <div className="space-y-3 rounded-card border border-accent/40 bg-accent-soft/40 p-4" data-testid="map-draw">
          <p className="text-body text-ink">
            <span className="font-semibold">Drawing a new zone.</span> Click the map to add points. Click the first point, or Finish, to close the outline. Backspace removes the last point; Escape cancels.
          </p>
          <PointsBox text={text} onChange={fromText} problems={textProblems} />
          <LiveCounts shape={points} counts={live} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BUTTON_PRIMARY} disabled={!canClose} onClick={finish}>Finish</button>
            <button type="button" className={BUTTON_SECONDARY} disabled={points.length === 0} onClick={() => fromMap(points.slice(0, -1))}>Remove last point</button>
            <button type="button" className={BUTTON_SECONDARY} onClick={onCancel}>Cancel</button>
          </div>
          {points.length > 0 && points.length < 3 && <p className="text-small text-muted">A zone needs at least three points.</p>}
        </div>
      )}

      {mode.kind === 'circle' && (
        <div className="space-y-3 rounded-card border border-accent/40 bg-accent-soft/40 p-4" data-testid="map-circle">
          <p className="text-body text-ink">
            <span className="font-semibold">Circle around a point.</span> Click the map to place the center, or type it. The outline has 24 points; you can edit its shape after saving.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Center (lat, lng)">
              <TextInput value={centerText} onChange={fromCenterText} ariaLabel="Center (lat, lng)" placeholder="34.8762, -83.9581" />
            </Field>
            <Field label="Radius (miles)">
              <NumberInput value={radius} onChange={setRadius} ariaLabel="Radius (miles)" min={0} suffix="mi" />
            </Field>
          </div>
          {centerText.trim() !== '' && !center && <p className="text-small font-semibold text-danger">Write the center as a latitude and a longitude, like 34.8762, -83.9581.</p>}
          <LiveCounts shape={circle ?? []} counts={live} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BUTTON_PRIMARY} disabled={!circle} onClick={() => circle && onOutline(circle)}>Use this outline</button>
            <button type="button" className={BUTTON_SECONDARY} onClick={onCancel}>Cancel</button>
          </div>
        </div>
      )}

      {mode.kind === 'edit' && editingIndex >= 0 && (
        <div className="space-y-3 rounded-card border border-accent/40 bg-accent-soft/40 p-4" data-testid="map-edit">
          <p className="text-body text-ink">
            <span className="font-semibold">Editing the shape of {zones[editingIndex].name}.</span> Drag a point to move it. Click a small point on an edge to add one there. Alt-click a point to remove it; a zone keeps at least three.
          </p>
          <PointsBox text={text} onChange={fromText} problems={textProblems} />
          <LiveCounts shape={points} counts={live} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BUTTON_PRIMARY} disabled={!canClose} onClick={() => onSaveShape(zones[editingIndex].id, points)}>Save shape</button>
            <button type="button" className={BUTTON_SECONDARY} onClick={onCancel}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

/** The typed alternative to clicking the map: one "lat, lng" per line, mirrored both ways. */
function PointsBox({ text, onChange, problems }: { text: string; onChange: (t: string) => void; problems: string[] }) {
  return (
    <div>
      <Field label="Points (lat, lng per line)">
        <textarea value={text} rows={6} aria-label="Points (lat, lng per line)" spellCheck={false} placeholder={'34.8762, -83.9581\n34.8500, -83.9000\n34.8200, -83.9600'} onChange={e => onChange(e.target.value)} className={TEXTAREA} />
      </Field>
      {problems.length > 0 && (
        <ul role="alert" className="mt-1 space-y-0.5 text-small font-semibold text-danger">
          {problems.map(p => <li key={p}>{p}</li>)}
        </ul>
      )}
    </div>
  )
}

function LiveCounts({ shape, counts }: { shape: LatLng[]; counts: { sites: number; lines: number } }) {
  if (shape.length < 3) return <p className="text-small text-muted" data-testid="live-counts">Add at least three points to see what the outline holds.</p>
  return (
    <p className="text-small text-ink" data-testid="live-counts">
      <span className="font-semibold">{insideText(counts)}</span>
      <span className="text-muted">, about {areaText(areaSqMi(shape))}. Counted by this outline alone; where it overlaps a zone higher in the list, that zone keeps the site.</span>
    </p>
  )
}
