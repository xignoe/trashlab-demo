// @vitest-environment jsdom
/**
 * Zones drawn on the map (DECISIONS.md entry 69) through the real Ratebook at /owner/pricing?section=geozones: the
 * seeded zones and their site counts, drawing a zone through the Points box (jsdom has no SVG layout for clicks),
 * list order as priority where zones overlap, Move up and down, and a delete the store refuses while a rate uses the
 * zone. No console error or warning.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes, ROUTER_FUTURE } from '../../../App'
import { useStore } from '../../../store/useStore'
import { geoZoneFor, lineDims, pointInPolygon } from '../../../store/engine'
import { dimensionUsage } from '../lib/config'
import { fromWorldXY, milesPerUnit, toWorldXY } from '../lib/geo'
import { BASE_MAP_KEY } from '../sections/GeoZoneMap'

let errors: ReturnType<typeof vi.spyOn>
let warnings: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  useStore.getState().reset()
  try {
    window.localStorage.removeItem(BASE_MAP_KEY)
  } catch {
    // no storage: the default base map is used anyway
  }
  errors = vi.spyOn(console, 'error')
  warnings = vi.spyOn(console, 'warn')
})

afterEach(() => {
  cleanup()
  expect(errors).not.toHaveBeenCalled()
  expect(warnings).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <AppRoutes />
    </MemoryRouter>,
  )

const db = () => useStore.getState().db
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const row = (id: string) => document.querySelector(`[data-geozone="${id}"]`)
const order = () => db().geoZones.map(z => z.id)

describe('Zones section', () => {
  it('lists the five seeded zones in order, with Piedmont city holding 24 sites', () => {
    renderAt('/owner/pricing?section=geozones')
    expect(screen.getByRole('heading', { name: 'Zones' })).toBeTruthy()
    expect(order()).toEqual(['gz_ashford', 'gz_downtown', 'gz_piedmont', 'gz_north_valley', 'gz_east_county'])
    const rows = [...document.querySelectorAll('[data-geozone]')].map(el => el.getAttribute('data-geozone'))
    expect(rows).toEqual(order())
    for (const z of db().geoZones) expect(text(row(z.id))).toContain(z.name)
    expect(text(row('gz_piedmont'))).toContain('24 sites inside')
    expect(text(row('gz_downtown'))).toContain('1 site inside')
    expect(text(row('gz_east_county'))).toContain('9 sites inside')
    expect(text(screen.getByTestId('outside-sites'))).toContain('Sites outside every zone: 15')
    expect(screen.getByText(/A site with no coordinates yet/)).toBeTruthy()
    // One dot per site on the map, each with a title naming its zone.
    const dots = document.querySelectorAll('circle[data-site]')
    expect(dots.length).toBe(49)
    const inCity = db().sites.find(s => geoZoneFor(s, db()) === 'gz_piedmont')!
    expect(text(document.querySelector(`circle[data-site="${inCity.id}"] title`))).toContain('Zone: Piedmont city')
  })

  it('draws a triangle around one site through the Points box; list order decides the site zone', () => {
    const site = db().sites.find(s => geoZoneFor(s, db()) === 'gz_piedmont')!
    const { lat, lng } = site as { lat: number; lng: number }
    const triangle: [number, number][] = [[lat + 0.01, lng], [lat - 0.008, lng - 0.012], [lat - 0.008, lng + 0.012]]
    const siteZone = () => lineDims({ siteId: site.id, onDate: '2026-10-01', lineType: 'recurring' }, db()).geoZone
    expect(siteZone()).toBe('gz_piedmont')

    renderAt('/owner/pricing?section=geozones')
    fireEvent.click(screen.getByRole('button', { name: 'Draw a zone' }))
    const points = screen.getByLabelText('Points (lat, lng per line)')
    expect(screen.getByRole('button', { name: 'Finish' }).hasAttribute('disabled')).toBe(true)

    // A line that is not a point is refused in plain English.
    fireEvent.change(points, { target: { value: 'north of the lake' } })
    expect(text(screen.getByTestId('map-draw'))).toContain('Line 1: write a latitude and a longitude')

    fireEvent.change(points, { target: { value: triangle.map(([a, b]) => `${a}, ${b}`).join('\n') } })
    const inside = db().sites.filter(s => s.lat !== undefined && s.lng !== undefined && pointInPolygon(s.lat, s.lng, triangle)).length
    expect(inside).toBeGreaterThanOrEqual(1)
    expect(text(screen.getByTestId('live-counts'))).toContain(`${inside} site${inside === 1 ? '' : 's'} inside`)
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))

    const form = screen.getByRole('region', { name: 'New zone' })
    fireEvent.click(within(form).getByRole('button', { name: 'Save zone' }))
    expect(within(form).getByRole('alert').textContent).toContain('Give the zone a name')
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Lake shore' } })
    fireEvent.click(within(form).getByRole('radio', { name: 'Teal' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Save zone' }))
    expect(screen.queryByRole('region', { name: 'New zone' })).toBeNull()

    const lake = db().geoZones.find(z => z.name === 'Lake shore')!
    expect(lake).toMatchObject({ color: '#0D9488' })
    expect(lake.polygon).toHaveLength(3)
    expect(order()).toEqual(['gz_ashford', 'gz_downtown', 'gz_piedmont', 'gz_north_valley', 'gz_east_county', lake.id])
    // At the bottom of the list, Piedmont city still wins the site.
    expect(siteZone()).toBe('gz_piedmont')
    expect(text(row(lake.id))).toContain('0 sites inside')

    const up = () => fireEvent.click(screen.getByRole('button', { name: 'Move Lake shore up' }))
    up()
    up()
    expect(order().indexOf(lake.id)).toBe(3)
    expect(siteZone()).toBe('gz_piedmont')
    up()
    expect(order()).toEqual(['gz_ashford', 'gz_downtown', lake.id, 'gz_piedmont', 'gz_north_valley', 'gz_east_county'])
    expect(siteZone()).toBe(lake.id)
    expect(text(row(lake.id))).toContain(`${inside} site${inside === 1 ? '' : 's'} inside`)
    expect(text(row('gz_piedmont'))).toContain(`${24 - inside} sites inside`)

    fireEvent.click(screen.getByRole('button', { name: 'Move Lake shore down' }))
    expect(order().indexOf(lake.id)).toBe(3)
    expect(siteZone()).toBe('gz_piedmont')
  })

  it('moves a zone up and down the list', () => {
    renderAt('/owner/pricing?section=geozones')
    fireEvent.click(screen.getByRole('button', { name: 'Move North valley up' }))
    expect(order()).toEqual(['gz_ashford', 'gz_downtown', 'gz_north_valley', 'gz_piedmont', 'gz_east_county'])
    fireEvent.click(screen.getByRole('button', { name: 'Move North valley down' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move North valley down' }))
    expect(order()).toEqual(['gz_ashford', 'gz_downtown', 'gz_piedmont', 'gz_east_county', 'gz_north_valley'])
    expect(screen.getByRole('button', { name: 'Move North valley down' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Move Ashford up' }).hasAttribute('disabled')).toBe(true)
  })

  it('renames a zone and keeps its shape', () => {
    renderAt('/owner/pricing?section=geozones')
    const before = db().geoZones.find(z => z.id === 'gz_ashford')!
    fireEvent.click(screen.getByRole('button', { name: 'Rename Ashford' }))
    fireEvent.change(screen.getByLabelText('New name for Ashford'), { target: { value: 'Ashford town' } })
    fireEvent.click(within(row('gz_ashford') as HTMLElement).getByRole('button', { name: 'Save' }))
    const after = db().geoZones.find(z => z.id === 'gz_ashford')!
    expect(after.name).toBe('Ashford town')
    expect(after.polygon).toEqual(before.polygon)
    expect(text(row('gz_ashford'))).toContain('Ashford town')
  })

  it('refuses to delete a zone a rate uses, and deletes one nothing uses', () => {
    const catalogId = db().catalog.find(c => c.lob !== 'rolloff')!.id
    useStore.getState().createDraftRateVersion({ catalogId, priceCents: 4500, effectiveFrom: '2026-10-01', dims: { geoZone: 'gz_east_county' } })
    renderAt('/owner/pricing?section=geozones')
    expect(text(row('gz_east_county'))).toMatch(/Used by \d+ rates? (or|and) adjustments?/)

    fireEvent.click(screen.getByRole('button', { name: 'Delete East county' }))
    expect(screen.getByRole('alert').textContent).toContain('Rates or adjustments still use East county')
    expect(order()).toContain('gz_east_county')

    const unused = db().geoZones.find(z => (dimensionUsage(db(), 'geoZone', useStore.getState().pricingDrafts).get(z.id) ?? 0) === 0)
    if (unused) {
      fireEvent.click(screen.getByRole('button', { name: `Delete ${unused.name}` }))
      expect(order()).not.toContain(unused.id)
      expect(screen.queryByRole('alert')).toBeNull()
    }
  })
})

describe('Zones map: base map tiles', () => {
  it('projects with Web Mercator and inverts it exactly', () => {
    for (const [lat, lng] of [[34.8762, -83.9581], [35.224026, -83.799109], [-33.86, 151.2]] as [number, number][]) {
      const [x, y] = toWorldXY(lat, lng)
      const [lat2, lng2] = fromWorldXY(x, y)
      expect(lat2).toBeCloseTo(lat, 9)
      expect(lng2).toBeCloseTo(lng, 9)
    }
    expect(toWorldXY(0, 0)).toEqual([128, 128])
    // About 79.7 miles per world unit at the yard's latitude.
    expect(milesPerUnit(34.8762)).toBeGreaterThan(79)
    expect(milesPerUnit(34.8762)).toBeLessThan(80.5)
  })

  it('draws OpenStreetMap tiles with attribution by default; a failed load falls back to the grid; Grid only removes the tiles', () => {
    // Where storage works, a base map saved before the switch to OpenStreetMap only ("light") is ignored. Some test
    // runs expose a broken localStorage, which the map tolerates.
    const storage = typeof window.localStorage?.getItem === 'function' ? window.localStorage : null
    storage?.setItem(BASE_MAP_KEY, 'light')
    renderAt('/owner/pricing?section=geozones')
    const base = screen.getByRole('combobox', { name: 'Base map' }) as HTMLSelectElement
    expect(base.value).toBe('osm')
    expect([...base.options].map(o => o.textContent)).toEqual(['OpenStreetMap', 'Grid only'])

    const images = () => [...document.querySelectorAll('svg image')]
    expect(images().length).toBeGreaterThan(0)
    expect(images().length).toBeLessThanOrEqual(64)
    const zooms = new Set<number>()
    for (const img of images()) {
      const m = /^https:\/\/tile\.openstreetmap\.org\/(\d+)\/\d+\/\d+\.png$/.exec(img.getAttribute('href') ?? '')
      expect(m).not.toBeNull()
      zooms.add(Number(m![1]))
      expect(img.getAttribute('pointer-events')).toBe('none')
    }
    expect(zooms.size).toBe(1)
    const z = [...zooms][0]
    expect(z).toBeGreaterThanOrEqual(3)
    expect(z).toBeLessThanOrEqual(19)
    expect(screen.getByTestId('map-tiles').getAttribute('data-tile-zoom')).toBe(String(z))
    expect(screen.queryByTestId('map-grid')).toBeNull()
    expect(text(screen.getByTestId('map-scale'))).toBe('5 mi')

    const attribution = screen.getByTestId('map-attribution')
    const links = within(attribution).getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0].textContent).toBe('© OpenStreetMap contributors')
    expect(links[0].getAttribute('href')).toBe('https://www.openstreetmap.org/copyright')
    expect(links[0].getAttribute('target')).toBe('_blank')
    expect(links[0].getAttribute('rel')).toContain('noopener')

    // When most of the first tiles fail, the grid and a note take their place.
    for (const img of images()) fireEvent.error(img)
    expect(images()).toHaveLength(0)
    expect(screen.queryByTestId('map-attribution')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Map tiles did not load, so the grid is shown. Check the connection.')
    expect(document.querySelectorAll('[data-testid="map-grid"] line').length).toBeGreaterThan(0)

    fireEvent.change(base, { target: { value: 'grid' } })
    if (storage) expect(storage.getItem(BASE_MAP_KEY)).toBe('grid')
    expect(images()).toHaveLength(0)
    expect(screen.queryByTestId('map-attribution')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(document.querySelectorAll('[data-testid="map-grid"] line').length).toBeGreaterThan(0)
    expect(text(screen.getByTestId('map-scale'))).toBe('5 mi')

    // Picking OpenStreetMap again tries the tiles again.
    fireEvent.change(base, { target: { value: 'osm' } })
    expect(images().length).toBeGreaterThan(0)
    expect(screen.getByTestId('map-attribution')).toBeTruthy()
  })

  it('names no CARTO tile server anywhere in the source', () => {
    const banned = ['basemaps', 'cartocdn', 'com'].join('.')
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
    const files = walk(resolve(process.cwd(), 'src')).filter(f => /\.(tsx?|css|json|html|md)$/.test(f))
    expect(files.length).toBeGreaterThan(0)
    expect(files.filter(f => readFileSync(f, 'utf8').includes(banned))).toEqual([])
  })
})
