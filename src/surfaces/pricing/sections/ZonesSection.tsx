import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { FeeRule, Zone } from '../../../types'
import { useStore } from '../../../store/useStore'
import {
  BUTTON_LINK, BUTTON_PRIMARY, BUTTON_SECONDARY, Card, Drawer, Field, MoneyInput, NumberInput, Problems, SectionHeader, TextInput, Toggle, attempt,
} from '../components/form'
import Pill, { type PillTone } from '../components/Pill'
import { formatCents, formatPct } from '../lib/money'
import { dateOnly } from '../lib/dates'
import { densityText, distanceText, feeAmountText, isLocationRule, locationRows, ruleState, type LocationRow } from '../lib/rules'

const SERVICEABILITY: Record<Zone['serviceability'], { label: string; tone: PillTone; sentence: string }> = {
  open: { label: 'open', tone: 'success', sentence: 'Anyone in the zone can sign up at the published price.' },
  boundary: { label: 'boundary', tone: 'warning', sentence: 'On the edge of the service area; the office confirms each address before it is booked.' },
  franchise: { label: 'franchise', tone: 'accent', sentence: 'Served under a city franchise that sets the rules and adds its franchise fee.' },
  notServed: { label: 'not served', tone: 'danger', sentence: 'Not served: quotes are declined and prices are never public.' },
}
const SERVICEABILITY_ORDER: Zone['serviceability'][] = ['open', 'boundary', 'franchise', 'notServed']

const TH = 'px-3 py-2 text-left text-eyebrow font-bold uppercase tracking-[0.08em] text-muted whitespace-nowrap'
const TD = 'px-3 py-2.5 align-middle'
const PAGE_SIZE = 20

/** Switches the Ratebook to another section through ?section=. */
function useOpenSection() {
  const [params, setParams] = useSearchParams()
  return (id: string) => {
    const next = new URLSearchParams(params)
    next.set('section', id)
    setParams(next, { replace: true })
  }
}

/** Active, scheduled (with its start date), paused, or ended, as a pill. */
function RuleStatePill({ rule, today }: { rule: FeeRule; today: string }) {
  const state = ruleState(rule, today)
  if (state === 'scheduled') return <Pill tone="accent">scheduled from {dateOnly(rule.effectiveFrom ?? '')}</Pill>
  if (state === 'active') return <Pill tone="success">active</Pill>
  return <Pill tone="muted">{state}</Pill>
}

/**
 * The Zone types section: every zone type with its serviceability, sites, lines, tax in force today, franchise and
 * delivery fees, and public pricing (a zone that is not served cannot be public). Add and edit open a drawer that
 * writes through saveZone. Below it, the distance and density panel shows where the sites sit relative to the
 * location rules and what those rules add a month.
 */
export default function ZonesSection({ today }: { today: string }) {
  const db = useStore(s => s.db)
  const setZonePublicPricing = useStore(s => s.setZonePublicPricing)
  const [editing, setEditing] = useState<Zone | 'new' | null>(null)
  const [problems, setProblems] = useState<string[]>([])

  const stats = useMemo(() => {
    const siteZone = new Map(db.sites.map(s => [s.id, s.zoneId] as [string, string]))
    return new Map(db.zones.map(z => {
      const sites = db.sites.filter(s => s.zoneId === z.id).length
      const lines = db.serviceItems.filter(si => si.status === 'active' && siteZone.get(si.siteId) === z.id).length
      const taxPct = db.taxRules.filter(t => t.zoneId === z.id && ruleState(t, today) === 'active').reduce((sum, t) => sum + t.ratePct, 0)
      return [z.id, { sites, lines, taxPct }] as [string, { sites: number; lines: number; taxPct: number }]
    }))
  }, [db, today])

  const togglePublic = (zone: Zone, next: boolean) => {
    const r = attempt(() => setZonePublicPricing({ zoneId: zone.id, publicPricing: next }))
    setProblems(r.ok ? [] : r.problems)
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Zone types"
        description="What kind of area a site is in. Serviceability decides who can sign up; tax, franchise, and delivery fees follow the zone type of the site. Areas drawn on the map are under Zones."
        actions={<button type="button" className={BUTTON_PRIMARY} onClick={() => setEditing('new')}>Add zone</button>}
      />
      <Problems problems={problems} />

      <Card label="Zone types" className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-body">
          <thead className="border-b border-line bg-surface-muted">
            <tr>
              <th className={TH}>Zone type</th>
              <th className={TH}>Serviceability</th>
              <th className={`${TH} text-right`}>Sites</th>
              <th className={`${TH} text-right`}>Active lines</th>
              <th className={`${TH} text-right`}>Tax today</th>
              <th className={`${TH} text-right`}>Franchise fee</th>
              <th className={`${TH} text-right`}>Delivery fee</th>
              <th className={TH}>Public</th>
              <th className={TH}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {db.zones.map(z => {
              const s = SERVICEABILITY[z.serviceability]
              const st = stats.get(z.id) ?? { sites: 0, lines: 0, taxPct: 0 }
              const notServed = z.serviceability === 'notServed'
              return (
                <tr key={z.id} data-zone={z.id} className="border-b border-line last:border-b-0">
                  <td className={TD}>
                    <span className={['block font-semibold', notServed ? 'text-muted' : 'text-ink'].join(' ')}>{z.name}</span>
                    <span className="block font-mono text-small text-muted">{z.id}</span>
                  </td>
                  <td className={TD}><Pill tone={s.tone}>{s.label}</Pill></td>
                  <td className={`${TD} text-right font-mono`}>{st.sites}</td>
                  <td className={`${TD} text-right font-mono`}>{st.lines}</td>
                  <td className={`${TD} text-right font-mono`}>{formatPct(st.taxPct)}</td>
                  <td className={`${TD} text-right font-mono`}>{formatPct(z.franchiseFeePct)}</td>
                  <td className={`${TD} text-right font-mono`}>{formatCents(z.deliveryFeeCents)}</td>
                  <td className={TD}>
                    <span title={notServed ? 'A zone that is not served cannot be priced publicly' : 'Show these prices on the public storefront'}>
                      <Toggle on={z.publicPricing} disabled={notServed} label={`Public pricing for ${z.name}`} onChange={next => togglePublic(z, next)} />
                    </span>
                  </td>
                  <td className={`${TD} text-right`}>
                    <button type="button" className={BUTTON_LINK} aria-label={`Edit ${z.name}`} onClick={() => setEditing(z)}>Edit</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>

      <DistanceDensityPanel today={today} />

      {editing && (
        <ZoneDrawer
          key={editing === 'new' ? 'new' : editing.id}
          zone={editing === 'new' ? undefined : editing}
          taxPctToday={editing === 'new' ? 0 : stats.get(editing.id)?.taxPct ?? 0}
          today={today}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

/**
 * Add or edit a zone. A new zone takes its first tax rate here; later tax changes are layers made under Taxes. Choosing
 * not served turns public pricing off, since such a zone cannot be public.
 */
export function ZoneDrawer({ zone, taxPctToday, today, onClose, onSaved }: { zone?: Zone; taxPctToday: number; today: string; onClose: () => void; onSaved?: (zone: Zone) => void }) {
  const saveZone = useStore(s => s.saveZone)
  const openSection = useOpenSection()
  const [name, setName] = useState(zone?.name ?? '')
  const [serviceability, setServiceability] = useState<Zone['serviceability']>(zone?.serviceability ?? 'open')
  const [franchiseFeePct, setFranchiseFeePct] = useState<number | undefined>(zone?.franchiseFeePct ?? 0)
  const [deliveryFeeCents, setDeliveryFeeCents] = useState<number | undefined>(zone?.deliveryFeeCents ?? 0)
  const [publicPricing, setPublicPricing] = useState(zone?.publicPricing ?? false)
  const [taxRatePct, setTaxRatePct] = useState<number | undefined>(0)
  const [problems, setProblems] = useState<string[]>([])
  const notServed = serviceability === 'notServed'

  const pickServiceability = (next: Zone['serviceability']) => {
    setServiceability(next)
    if (next === 'notServed') setPublicPricing(false)
  }

  const save = () => {
    const missing: string[] = []
    if (franchiseFeePct === undefined) missing.push('Enter a franchise fee (0 for none)')
    if (deliveryFeeCents === undefined) missing.push('Enter a delivery fee as a dollar amount (0 for none)')
    if (!zone && taxRatePct === undefined) missing.push('Enter a first tax rate (0 for none)')
    if (missing.length) {
      setProblems(missing)
      return
    }
    const r = attempt(() => saveZone({
      ...(zone ? { id: zone.id } : { taxRatePct: taxRatePct ?? 0 }),
      name, serviceability, franchiseFeePct: franchiseFeePct ?? 0, deliveryFeeCents: deliveryFeeCents ?? 0, publicPricing, today,
    }))
    if (r.ok) {
      onSaved?.(r.value)
      onClose()
    } else setProblems(r.problems)
  }

  return (
    <Drawer
      title={zone ? zone.name : 'Add zone'}
      eyebrow={zone ? `Zone ${zone.id}` : 'New zone'}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className={BUTTON_SECONDARY} onClick={onClose}>Cancel</button>
          <button type="button" className={BUTTON_PRIMARY} onClick={save}>Save zone</button>
        </>
      )}
    >
      <Problems problems={problems} />
      <Field label="Name">
        <TextInput value={name} onChange={setName} ariaLabel="Zone name" placeholder="Lake district" />
      </Field>
      <fieldset>
        <legend className="text-small font-semibold text-ink">Serviceability</legend>
        <div role="radiogroup" aria-label="Serviceability" className="mt-1 space-y-1.5">
          {SERVICEABILITY_ORDER.map(s => (
            <label key={s} className={['flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2', serviceability === s ? 'border-accent bg-accent-soft' : 'border-line'].join(' ')}>
              <input type="radio" name="serviceability" value={s} checked={serviceability === s} onChange={() => pickServiceability(s)} className="mt-1 accent-[var(--rt-color-accent)]" />
              <span>
                <span className="block text-body font-semibold text-ink">{SERVICEABILITY[s].label}</span>
                <span className="block text-small text-muted">{SERVICEABILITY[s].sentence}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Franchise fee" hint="Percent of the line, paid to the city">
          <NumberInput value={franchiseFeePct} onChange={setFranchiseFeePct} ariaLabel="Franchise fee percent" min={0} suffix="%" />
        </Field>
        <Field label="Delivery fee" hint="Charged when a container is delivered">
          <MoneyInput cents={deliveryFeeCents} onChange={setDeliveryFeeCents} ariaLabel="Delivery fee" />
        </Field>
      </div>
      {zone ? (
        <div className="rounded-card border border-line bg-surface-muted px-4 py-3 text-small text-muted">
          Tax in force today: <span className="font-mono font-semibold text-ink">{formatPct(taxPctToday)}</span>. Tax changes are layers with an effective date,
          made under Taxes.{' '}
          <button type="button" className={BUTTON_LINK} onClick={() => openSection('taxes')}>Open Taxes</button>
        </div>
      ) : (
        <Field label="First tax rate" hint="Starts today as the zone's sales tax. Later tax changes are made under Taxes, as layers with an effective date.">
          <NumberInput value={taxRatePct} onChange={setTaxRatePct} ariaLabel="First tax rate" min={0} suffix="%" />
        </Field>
      )}
      <div className="flex items-start justify-between gap-4">
        <span>
          <span className="block text-small font-semibold text-ink">Public pricing</span>
          <span className="block text-small text-muted">{notServed ? 'A zone that is not served cannot be public.' : 'Show this zone’s prices on the public storefront.'}</span>
        </span>
        <Toggle on={publicPricing} onChange={setPublicPricing} label="Public pricing" disabled={notServed} />
      </div>
    </Drawer>
  )
}

// ---------------------------------------------------------------------------
// Distance and density
// ---------------------------------------------------------------------------

/**
 * Where the sites with recurring service sit against the location rules (distance bands and density thresholds),
 * including rules scheduled to start later, and what each rule adds a month. Each rule is evaluated on the date it is
 * in force by locationRows.
 */
function DistanceDensityPanel({ today }: { today: string }) {
  const db = useStore(s => s.db)
  const openSection = useOpenSection()
  const [page, setPage] = useState(0)

  const rules = useMemo(() => db.feeRules.filter(r => isLocationRule(r) && ruleState(r, today) !== 'ended'), [db.feeRules, today])
  const rows = useMemo(() => locationRows(db, rules, today), [db, rules, today])
  const distanceRules = rules.filter(r => r.minMiles !== undefined || r.maxMiles !== undefined)
  const densityRules = rules.filter(r => r.minNeighborStops !== undefined)
  const noDistance = rows.filter(r => r.site.milesFromYard === undefined).length

  const affected = useMemo(
    () => rows
      .filter(r => Object.keys(r.hits).length > 0)
      .map(r => ({ row: r, net: Object.values(r.hits).reduce((s, c) => s + c, 0) }))
      .sort((a, b) => (b.row.site.milesFromYard ?? -1) - (a.row.site.milesFromYard ?? -1)),
    [rows],
  )
  const pages = Math.max(1, Math.ceil(affected.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const shown = affected.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)

  return (
    <Card label="Distance and density" className="space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-h2 font-bold">Distance and density</h3>
          <p className="mt-0.5 max-w-[720px] text-small text-muted">
            Remote sites cost more to serve and dense streets cost less. Every active site with recurring service, by road miles from the yard, against
            the location rules (scheduled ones included, on the date they start).
          </p>
        </div>
        <button type="button" className={BUTTON_SECONDARY} onClick={() => openSection('adjustments')}>Edit location rules</button>
      </div>

      {rows.length === 0 ? (
        <p className="text-body text-muted">No active site has recurring service yet.</p>
      ) : (
        <DistanceStrip rows={rows} distanceRules={distanceRules} densityRules={densityRules} />
      )}
      <p className="text-small text-muted" data-testid="no-distance">
        {noDistance === 0
          ? `All ${rows.length} sites with recurring service have a distance on file.`
          : `${noDistance} of ${rows.length} sites with recurring service have no distance on file; distance rules skip them.`}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-body" aria-label="Location rules">
          <thead className="border-b border-line">
            <tr>
              <th className={TH}>Location rule</th>
              <th className={TH}>Amount</th>
              <th className={TH}>Where</th>
              <th className={TH}>State</th>
              <th className={`${TH} text-right`}>Sites hit</th>
              <th className={`${TH} text-right`}>Monthly effect</th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 && (
              <tr><td colSpan={6} className={`${TD} text-muted`}>No location rules. Add a distance band or a density threshold under Adjustments.</td></tr>
            )}
            {rules.map(rule => {
              const hit = rows.filter(r => r.hits[rule.id] !== undefined)
              const total = hit.reduce((s, r) => s + (r.hits[rule.id] ?? 0), 0)
              return (
                <tr key={rule.id} data-rule={rule.id} className="border-b border-line last:border-b-0">
                  <td className={TD}>
                    <span className="block font-semibold text-ink">{rule.name}</span>
                    <span className="block font-mono text-small text-muted">{rule.id}</span>
                  </td>
                  <td className={`${TD} font-mono`}>{feeAmountText(rule)}</td>
                  <td className={TD}>{[distanceText(rule), densityText(rule)].filter(Boolean).join(', ')}</td>
                  <td className={TD}><RuleStatePill rule={rule} today={today} /></td>
                  <td className={`${TD} text-right font-mono`}>{hit.length}</td>
                  <td className={`${TD} text-right font-mono`}>{total > 0 ? '+' : ''}{formatCents(total)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div>
        <h4 className="text-body font-bold text-ink">Affected sites ({affected.length})</h4>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[760px] text-body" aria-label="Affected sites">
            <thead className="border-b border-line">
              <tr>
                <th className={TH}>Address</th>
                <th className={TH}>Account</th>
                <th className={`${TH} text-right`}>Miles</th>
                <th className={`${TH} text-right`}>Stops nearby</th>
                <th className={`${TH} text-right`}>Monthly base</th>
                <th className={`${TH} text-right`}>Net monthly effect</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr><td colSpan={6} className={`${TD} text-muted`}>No site is hit by a location rule.</td></tr>
              )}
              {shown.map(({ row, net }) => (
                <tr key={row.site.id} className="border-b border-line last:border-b-0">
                  <td className={TD}>{row.site.address}</td>
                  <td className={TD}>{row.name}</td>
                  <td className={`${TD} text-right font-mono`}>{row.site.milesFromYard ?? 'none'}</td>
                  <td className={`${TD} text-right font-mono`}>{row.site.neighborStops ?? 'none'}</td>
                  <td className={`${TD} text-right font-mono`}>{formatCents(row.monthlyBaseCents)}</td>
                  <td className={`${TD} text-right font-mono ${net < 0 ? 'text-success' : 'text-ink'}`}>{net > 0 ? '+' : ''}{formatCents(net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="mt-2 flex items-center justify-end gap-2 text-small text-muted">
            <span>
              {current * PAGE_SIZE + 1} to {Math.min((current + 1) * PAGE_SIZE, affected.length)} of {affected.length}
            </span>
            <button type="button" className={BUTTON_LINK} disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button>
            <button type="button" className={BUTTON_LINK} disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</button>
          </div>
        )}
      </div>
    </Card>
  )
}

/**
 * A miles axis from the yard to the furthest site or band edge, rounded up to a tick. One lane per distance rule shows
 * its band (open-ended bands run to the axis end) and shades the dots under it. Dots stack where sites crowd; a filled
 * accent dot is hit by a location rule, a ring marks a site dense enough for a density rule.
 */
function DistanceStrip({ rows, distanceRules, densityRules }: { rows: LocationRow[]; distanceRules: FeeRule[]; densityRules: FeeRule[] }) {
  const W = 1000
  const PAD = 28
  const LANE = 24
  const DOT = 5
  const LEVEL = 13
  const placed = rows.filter(r => r.site.milesFromYard !== undefined).sort((a, b) => a.site.milesFromYard! - b.site.milesFromYard!)
  const edges = distanceRules.flatMap(r => [r.minMiles, r.maxMiles]).filter((m): m is number => m !== undefined)
  const furthest = Math.max(0, ...placed.map(r => r.site.milesFromYard!), ...edges)
  const step = furthest > 40 ? 10 : 5
  const end = Math.max(step, Math.ceil((furthest + 0.001) / step) * step)
  const x = (m: number) => PAD + (Math.min(m, end) / end) * (W - 2 * PAD)

  const stacks = new Map<number, number>()
  const dots = placed.map(r => {
    const cx = x(r.site.milesFromYard!)
    const bucket = Math.round(cx / (DOT * 2.4))
    const level = stacks.get(bucket) ?? 0
    stacks.set(bucket, level + 1)
    const dense = r.site.neighborStops !== undefined && densityRules.some(d => r.site.neighborStops! >= (d.minNeighborStops ?? Infinity))
    return { row: r, cx, level, dense, hit: Object.keys(r.hits).length > 0 }
  })
  const maxLevel = Math.max(1, ...stacks.values())
  const bandsTop = 6
  const dotsTop = bandsTop + distanceRules.length * LANE + 8
  const dotsBottom = dotsTop + maxLevel * LEVEL + 4
  const axisY = dotsBottom + 4
  const H = axisY + 26
  const ticks: number[] = []
  for (let m = 0; m <= end; m += step) ticks.push(m)
  const hitCount = dots.filter(d => d.hit).length

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        role="img"
        aria-label={`${placed.length} sites from 0 to ${end} miles from the yard; ${hitCount} hit by a location rule`}
      >
        {distanceRules.map((rule, i) => {
          const x0 = x(rule.minMiles ?? 0)
          const x1 = x(rule.maxMiles ?? end)
          const y = bandsTop + i * LANE
          const tone = rule.value < 0 ? 'text-success' : 'text-warning'
          return (
            <g key={rule.id} className={tone}>
              <rect x={x0} y={y + LANE - 4} width={Math.max(1, x1 - x0)} height={axisY - (y + LANE - 4)} fill="currentColor" fillOpacity={0.07} />
              <rect x={x0} y={y} width={Math.max(1, x1 - x0)} height={LANE - 4} rx={4} fill="currentColor" fillOpacity={0.16} stroke="currentColor" strokeOpacity={0.5} />
              <text x={x0 + 6} y={y + LANE / 2 + 2} fontSize={12} fontWeight={600} fill="currentColor" className="text-ink">
                {rule.name} {feeAmountText(rule).replace(' of the line', '')}{rule.maxMiles === undefined ? ', and beyond' : ''}
              </text>
            </g>
          )
        })}
        {dots.map(({ row, cx, level, dense, hit }) => {
          const cy = dotsBottom - DOT - level * LEVEL
          return (
            <g key={row.site.id}>
              <title>{`${row.site.address}: ${row.site.milesFromYard} mi, ${row.site.neighborStops ?? 'no'} stops nearby${hit ? ', hit by a location rule' : ''}`}</title>
              {dense && <circle cx={cx} cy={cy} r={DOT + 2.5} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-success" />}
              <circle cx={cx} cy={cy} r={DOT} fill="currentColor" fillOpacity={hit ? 1 : 0.45} className={hit ? 'text-accent' : 'text-muted'} />
            </g>
          )
        })}
        <line x1={PAD} x2={W - PAD} y1={axisY} y2={axisY} stroke="currentColor" className="text-line" strokeWidth={1.5} />
        {ticks.map(m => (
          <g key={m} className="text-muted">
            <line x1={x(m)} x2={x(m)} y1={axisY} y2={axisY + 5} stroke="currentColor" />
            <text x={x(m)} y={axisY + 19} fontSize={12} textAnchor="middle" fill="currentColor">{m === end ? `${m} mi` : m}</text>
          </g>
        ))}
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-small text-muted" aria-label="Legend">
        <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-pill bg-accent" aria-hidden="true" />Hit by a location rule</li>
        <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-pill bg-muted opacity-50" aria-hidden="true" />No location rule</li>
        <li className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-pill border-2 border-success" aria-hidden="true" />Dense: meets a density rule</li>
        <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-sm bg-warning-soft ring-1 ring-warning/50" aria-hidden="true" />Surcharge band</li>
        <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-sm bg-success-soft ring-1 ring-success/50" aria-hidden="true" />Credit band</li>
      </ul>
    </div>
  )
}
