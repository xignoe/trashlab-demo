/**
 * Pure helpers for zones drawn on the map (DECISIONS.md entry 69): the Web Mercator projection map tiles use and the
 * tiles that cover a view, bounds, centroid, area, how many sites and active service lines an outline holds, a circle
 * as a polygon, and the "lat, lng" text the Points box reads and writes.
 */
import { pointInPolygon } from '../../../store/engine'
import type { ServiceItem, Site } from '../../../types'

export type LatLng = [number, number]

/** Miles per degree of latitude (and of longitude at the equator). Close enough for a schematic of one county. */
export const MILES_PER_DEGREE = 69.05

export interface Bounds {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

/** The box around every point, or undefined when there are none. */
export function boundsOf(points: readonly (readonly [number, number])[]): Bounds | undefined {
  if (points.length === 0) return undefined
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
  for (const [lat, lng] of points) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
    minLng = Math.min(minLng, lng)
    maxLng = Math.max(maxLng, lng)
  }
  return Number.isFinite(minLat) ? { minLat, maxLat, minLng, maxLng } : undefined
}

// ---------------------------------------------------------------------------
// Web Mercator, as map tiles use: the whole world is one 256 unit tile at zoom 0; x grows east, y grows south. At
// zoom z a tile is 256 / 2^z units wide. A unit is a different number of miles at each latitude (metersPerUnit).
// ---------------------------------------------------------------------------

export const TILE_SIZE = 256
const EARTH_CIRCUMFERENCE_M = 40075016.686
const METERS_PER_MILE = 1609.344
/** Web Mercator's latitude limit, where the world becomes square. */
const MAX_LAT = 85.0511287798

/** [lat, lng] to world units. */
export function toWorldXY(lat: number, lng: number): [number, number] {
  const s = Math.sin((Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180)
  return [((lng + 180) / 360) * TILE_SIZE, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE_SIZE]
}

/** World units to [lat, lng]; the exact inverse of toWorldXY. */
export function fromWorldXY(x: number, y: number): LatLng {
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / TILE_SIZE))) * 180) / Math.PI
  return [lat, (x / TILE_SIZE) * 360 - 180]
}

/** Meters on the ground per world unit at a latitude. */
export function metersPerUnit(lat: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / TILE_SIZE
}

export function milesPerUnit(lat: number): number {
  return metersPerUnit(lat) / METERS_PER_MILE
}

/**
 * The projection and the box that fits the bounds: the bounds plus padding, at least minMiles each way, so a single
 * site still gets a readable map. x, y, width, and height are in world units.
 */
export interface Projection {
  x: number
  y: number
  width: number
  height: number
  toXY(lat: number, lng: number): [number, number]
  toLatLng(x: number, y: number): LatLng
}

export function projectionFor(bounds: Bounds | undefined, { padFraction = 0.08, minPadMiles = 2, minMiles = 12 } = {}): Projection {
  const b = bounds ?? { minLat: 34.8, maxLat: 34.95, minLng: -84.05, maxLng: -83.85 }
  const [x0, y1] = toWorldXY(b.minLat, b.minLng)
  const [x1, y0] = toWorldXY(b.maxLat, b.maxLng)
  const unitsPerMile = 1 / milesPerUnit((b.minLat + b.maxLat) / 2)
  let w = x1 - x0
  let h = y1 - y0
  const padX = Math.max(minPadMiles * unitsPerMile, w * padFraction)
  const padY = Math.max(minPadMiles * unitsPerMile, h * padFraction)
  w += padX * 2
  h += padY * 2
  const extraX = Math.max(0, minMiles * unitsPerMile - w) / 2
  const extraY = Math.max(0, minMiles * unitsPerMile - h) / 2
  return {
    x: x0 - padX - extraX,
    y: y0 - padY - extraY,
    width: w + extraX * 2,
    height: h + extraY * 2,
    toXY: toWorldXY,
    toLatLng: fromWorldXY,
  }
}

/**
 * The tile zoom that shows a tile at about 256 screen pixels: round(log2(screen pixels per world unit)), clamped to
 * 3 to 19 (19 is the deepest zoom the OpenStreetMap tile server serves).
 */
export function tileZoomFor(pxPerUnit: number, minZoom = 3, maxZoom = 19): number {
  if (!(pxPerUnit > 0) || !Number.isFinite(pxPerUnit)) return minZoom
  return Math.min(maxZoom, Math.max(minZoom, Math.round(Math.log2(pxPerUnit))))
}

export interface Tile {
  z: number
  /** Tile column as placed on the map (may pass the date line); wrappedX is the column to fetch. */
  x: number
  y: number
  wrappedX: number
  /** Size in world units. */
  size: number
}

/**
 * The tiles covering a world rectangle at zoom z. When more than cap tiles would be needed the zoom steps down (a
 * coarser tile covers more), never below minZoom, and the list is cut at cap.
 */
export function tilesCovering(rect: { x: number; y: number; w: number; h: number }, z: number, { minZoom = 3, cap = 64 } = {}): { z: number; tiles: Tile[] } {
  for (let zz = Math.round(z); ; zz--) {
    const n = 2 ** zz
    const size = TILE_SIZE / n
    const tx0 = Math.floor(rect.x / size)
    const tx1 = Math.floor((rect.x + rect.w) / size)
    const ty0 = Math.max(0, Math.floor(rect.y / size))
    const ty1 = Math.min(n - 1, Math.floor((rect.y + rect.h) / size))
    const count = (tx1 - tx0 + 1) * Math.max(0, ty1 - ty0 + 1)
    if (count <= cap || zz <= minZoom) {
      const tiles: Tile[] = []
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1 && tiles.length < cap; tx++) tiles.push({ z: zz, x: tx, y: ty, wrappedX: ((tx % n) + n) % n, size })
      }
      return { z: zz, tiles }
    }
  }
}

/** A polygon in local miles around its own middle latitude, for area and centroid. */
function localMiles(polygon: readonly (readonly [number, number])[]): { pts: [number, number][]; lat0: number; cos: number } {
  const lat0 = polygon.reduce((s, [lat]) => s + lat, 0) / Math.max(1, polygon.length)
  const cos = Math.cos((lat0 * Math.PI) / 180)
  return { pts: polygon.map(([lat, lng]) => [lng * MILES_PER_DEGREE * cos, lat * MILES_PER_DEGREE]), lat0, cos }
}

/** Area in square miles (shoelace on local miles). Zero for fewer than three points. */
export function areaSqMi(polygon: readonly (readonly [number, number])[]): number {
  if (polygon.length < 3) return 0
  const { pts } = localMiles(polygon)
  let twice = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) twice += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]
  return Math.abs(twice) / 2
}

/** The polygon's center of area, for its label; the average of its points when it has no area. */
export function centroid(polygon: readonly (readonly [number, number])[]): LatLng {
  if (polygon.length === 0) return [0, 0]
  const { pts, cos } = localMiles(polygon)
  let a = 0, cx = 0, cy = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const cross = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]
    a += cross
    cx += (pts[j][0] + pts[i][0]) * cross
    cy += (pts[j][1] + pts[i][1]) * cross
  }
  if (Math.abs(a) < 1e-9) {
    const n = polygon.length
    return [polygon.reduce((s, p) => s + p[0], 0) / n, polygon.reduce((s, p) => s + p[1], 0) / n]
  }
  cx /= 3 * a
  cy /= 3 * a
  return [cy / MILES_PER_DEGREE, cx / (MILES_PER_DEGREE * cos)]
}

/** n points on a circle of radiusMiles around center, starting due north and going clockwise. */
export function circleOutline(center: LatLng, radiusMiles: number, n = 24): LatLng[] {
  const [lat, lng] = center
  const dLat = radiusMiles / MILES_PER_DEGREE
  const dLng = radiusMiles / (MILES_PER_DEGREE * Math.cos((lat * Math.PI) / 180))
  return Array.from({ length: n }, (_, k) => {
    const t = (2 * Math.PI * k) / n
    return [round6(lat + dLat * Math.cos(t)), round6(lng + dLng * Math.sin(t))] as LatLng
  })
}

/** How many sites an outline holds (by its own shape, ignoring list order) and their active service lines. */
export function countInside(
  polygon: readonly (readonly [number, number])[],
  sites: readonly Pick<Site, 'id' | 'lat' | 'lng'>[],
  serviceItems: readonly Pick<ServiceItem, 'siteId' | 'status'>[],
): { sites: number; lines: number } {
  if (polygon.length < 3) return { sites: 0, lines: 0 }
  const inside = new Set(
    sites.filter(s => s.lat !== undefined && s.lng !== undefined && pointInPolygon(s.lat, s.lng, polygon)).map(s => s.id),
  )
  return { sites: inside.size, lines: serviceItems.filter(si => si.status === 'active' && inside.has(si.siteId)).length }
}

export const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/** One "lat, lng" per line. */
export function formatPoints(points: readonly (readonly [number, number])[]): string {
  return points.map(([lat, lng]) => `${round6(lat)}, ${round6(lng)}`).join('\n')
}

const POINT_LINE = /^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/

/** Reads one "lat, lng" per line; blank lines are skipped. Each line that is not a point gets a plain-English problem. */
export function parsePoints(text: string): { points: LatLng[]; problems: string[] } {
  const points: LatLng[] = []
  const problems: string[] = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (!line) return
    const m = POINT_LINE.exec(line)
    if (!m) {
      problems.push(`Line ${i + 1}: write a latitude and a longitude, like 34.8762, -83.9581`)
      return
    }
    const lat = Number(m[1])
    const lng = Number(m[2])
    if (Math.abs(lat) > 90) problems.push(`Line ${i + 1}: ${m[1]} is not a latitude; it must be between -90 and 90`)
    else if (Math.abs(lng) > 180) problems.push(`Line ${i + 1}: ${m[2]} is not a longitude; it must be between -180 and 180`)
    else points.push([lat, lng])
  })
  return { points, problems }
}

/** "34.8762, -83.9581" as one point, or undefined. */
export function parsePoint(text: string): LatLng | undefined {
  const { points, problems } = parsePoints(text)
  return problems.length === 0 && points.length === 1 ? points[0] : undefined
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "24 sites inside, 30 active service lines". */
export function insideText(c: { sites: number; lines: number }): string {
  return `${plural(c.sites, 'site')} inside, ${plural(c.lines, 'active service line')}`
}

/** "3.2 sq mi", with one decimal under 10 and none above. */
export function areaText(sqMi: number): string {
  return `${sqMi < 10 ? sqMi.toFixed(1) : Math.round(sqMi).toLocaleString('en-US')} sq mi`
}
