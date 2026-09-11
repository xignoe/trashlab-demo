/**
 * The roll-off rate card (DECISIONS.md entry 64): the material by size matrix and a haul quote priced by the canonical
 * engine. Pure functions over a Db; nothing here writes.
 */
import type { Charge, RolloffMaterial, RolloffRate, ServiceCatalog } from '../../../types'
import type { Db } from '../../../store/db'
import { computeCharge, rolloffOverage, rolloffPolicyOf, rolloffRateFor, rolloffTermsFor, type RolloffTerms } from '../../../store/engine'
import { resolveRate } from './engine'
import { formatCents } from './money'
import { SCRATCH_ACCOUNT_ID, SCRATCH_SITE_ID, withScratchSite } from './rules'

const yards = (c: ServiceCatalog) => parseInt(c.sizeLabel, 10) || 0

export function rolloffSizes(db: Db): ServiceCatalog[] {
  return db.catalog.filter(c => c.lob === 'rolloff' && c.rolloff).sort((a, b) => yards(a) - yards(b) || a.id.localeCompare(b.id))
}

const HANDLING_ORDER: Record<RolloffMaterial['handling'], number> = { standard: 0, accepted: 1, restricted: 2, prohibited: 3 }

export function rolloffMaterials(db: Db): RolloffMaterial[] {
  return [...(db.rolloffMaterials ?? [])].sort((a, b) => HANDLING_ORDER[a.handling] - HANDLING_ORDER[b.handling])
}

/** The published haul price for a size in a zone on a day, if there is one. */
export function haulPrice(db: Db, catalogId: string, zoneId: string, onDate: string): { cents: number; rateVersionId?: string } | undefined {
  try {
    const r = resolveRate({ catalogId, frequency: 'onCall', zoneId, onDate }, db)
    return { cents: r.priceCents, ...(r.rateVersionId ? { rateVersionId: r.rateVersionId } : {}) }
  } catch {
    return undefined
  }
}

export type CellStatus = 'priced' | 'notAccepted' | 'prohibited' | 'noHaulRate'

export interface MatrixCell {
  catalogId: string
  material: RolloffMaterial
  terms: RolloffTerms
  status: CellStatus
  /** Haul rate for the size plus the material's delta. */
  haulCents?: number
  cell?: RolloffRate
}

export interface MatrixRow {
  material: RolloffMaterial
  cells: MatrixCell[]
}

export function rolloffMatrix(db: Db, zoneId: string, onDate: string): { sizes: ServiceCatalog[]; rows: MatrixRow[] } {
  const sizes = rolloffSizes(db)
  const rows = rolloffMaterials(db).map(material => ({
    material,
    cells: sizes.map((size): MatrixCell => {
      const terms = rolloffTermsFor({ catalogId: size.id, materialId: material.id, onDate }, db)!
      const cell = rolloffRateFor(size.id, material.id, onDate, db)
      const haul = haulPrice(db, size.id, zoneId, onDate)
      const status: CellStatus = material.handling === 'prohibited' ? 'prohibited' : !terms.available ? 'notAccepted' : !haul ? 'noHaulRate' : 'priced'
      return { catalogId: size.id, material, terms, status, ...(haul ? { haulCents: haul.cents + terms.haulDeltaCents } : {}), ...(cell ? { cell } : {}) }
    }),
  }))
  return { sizes, rows }
}

export interface HaulQuoteInput {
  catalogId: string
  materialId: string
  zoneId: string
  onDate: string
  /** Net tons per haul, from the scale. */
  tons: number
  /** Days the box stays on site. */
  days: number
  /** Road miles from the yard. */
  miles: number
  /** Dump and returns after the first haul. */
  swaps: number
  /** Prohibited item id to count found in the box. */
  items: Record<string, number>
  /** Input dimension values, such as service speed, passed to the engine. */
  context?: Record<string, string>
}

export interface HaulQuoteLine {
  key: string
  label: string
  detail: string
  charge: Charge
}

export interface HaulQuote {
  lines: HaulQuoteLine[]
  baseCents: number
  feeCents: number
  taxCents: number
  totalCents: number
  warnings: string[]
  terms?: RolloffTerms
  error?: string
}

const tonsText = (t: number) => (Number.isInteger(t) ? String(t) : t.toFixed(2))

/**
 * A roll-off job priced line by line: the haul (size rate plus the material's delta), dump and returns, tonnage over
 * the allowance (tiers and minimums), extra days past the included days and grace, a trip charge past the free radius,
 * delivery, and prohibited items. Each line is a canonical computeCharge on a synthetic site in the zone, so fees,
 * adjustments, and tax are exactly what billing would add.
 */
export function quoteHaul(db: Db, input: HaulQuoteInput): HaulQuote {
  const empty = (error: string): HaulQuote => ({ lines: [], baseCents: 0, feeCents: 0, taxCents: 0, totalCents: 0, warnings: [], error })
  const size = db.catalog.find(c => c.id === input.catalogId)
  const material = (db.rolloffMaterials ?? []).find(m => m.id === input.materialId)
  if (!size?.rolloff || !material) return empty('Pick a box size and a material')
  if (material.handling === 'prohibited') return empty(`${material.name} is not accepted in any box.${material.note ? ` ${material.note}.` : ''}`)
  const terms = rolloffTermsFor({ catalogId: size.id, materialId: material.id, onDate: input.onDate }, db)!
  if (!terms.available) {
    const fits = rolloffSizes(db).filter(s => rolloffTermsFor({ catalogId: s.id, materialId: material.id, onDate: input.onDate }, db)?.available).map(s => s.sizeLabel)
    return empty(`${material.name} is not taken in the ${size.name}.${fits.length ? ` It fits a ${fits.join(' or ')} box.` : ''}`)
  }
  const haul = haulPrice(db, size.id, input.zoneId, input.onDate)
  if (!haul) return empty(`No published haul rate for the ${size.name} in this zone; a person prices it`)
  const policy = rolloffPolicyOf(db)
  const zone = db.zones.find(z => z.id === input.zoneId)
  const world = withScratchSite(db, { zoneId: input.zoneId, milesFromYard: input.miles })
  const swaps = Math.max(0, Math.floor(input.swaps))
  const hauls = 1 + swaps
  const lines: HaulQuoteLine[] = []
  const warnings: string[] = []

  const add = (key: string, label: string, detail: string, baseCents: number, lineType: 'event' | 'fee' = 'event') => {
    if (baseCents <= 0) return
    const charge = computeCharge({
      id: `chg_pr_haul_${key}`, accountId: SCRATCH_ACCOUNT_ID, siteId: SCRATCH_SITE_ID, lineType, catalogId: size.id, frequency: 'onCall',
      baseCents: Math.round(baseCents), servicedOn: input.onDate, source: { type: 'manual', id: 'haul_quote' }, description: label,
      pricing: { ruleWon: 'standardRate' }, ...(input.context ? { context: input.context } : {}),
    }, world)
    lines.push({ key, label, detail, charge })
  }

  const delta = terms.haulDeltaCents
  add(
    'haul',
    `${size.sizeLabel} haul, ${material.name}`,
    `${formatCents(haul.cents)} haul rate${delta ? `, ${delta > 0 ? '+' : '-'}${formatCents(Math.abs(delta))} for this material` : ''}; includes ${tonsText(terms.includedTons)} t and ${size.rolloff.includedDays} days`,
    haul.cents + delta,
  )
  if (swaps > 0 && policy) add('swaps', `Dump and return x ${swaps}`, `${formatCents(policy.swapCents)} each`, swaps * policy.swapCents)

  const over = rolloffOverage(Math.round(input.tons * 2000), terms, policy?.tonRounding)
  if (terms.minBilledTons && input.tons < terms.minBilledTons) warnings.push(`Bills at least ${tonsText(terms.minBilledTons)} t a haul`)
  if (over.overTons > 0) {
    const tiers = terms.overageTiers?.length ? `, then ${terms.overageTiers.map(t => `${formatCents(t.centsPerTon)}/t past ${tonsText(t.aboveTons)} t over`).join(', ')}` : ''
    add(
      'overage',
      `Overage, ${tonsText(over.overTons)} t over ${tonsText(terms.includedTons)} t${hauls > 1 ? ` x ${hauls} hauls` : ''}`,
      `${formatCents(terms.overageCentsPerTon)}/t${tiers}`,
      over.cents * hauls,
    )
  }

  const grace = size.rolloff.graceDays ?? 0
  const extraDays = Math.max(0, Math.floor(input.days) - size.rolloff.includedDays - grace)
  if (extraDays > 0) {
    add('days', `Extra days, ${extraDays}`, `${formatCents(size.rolloff.extraDayCents)} a day after ${size.rolloff.includedDays} days${grace ? ` and ${grace} grace days` : ''}`, extraDays * size.rolloff.extraDayCents)
  }
  if (size.rolloff.maxRentalDays && input.days > size.rolloff.maxRentalDays) warnings.push(`Past ${size.rolloff.maxRentalDays} days the box must be swapped or pulled`)

  if (policy) {
    const tripMiles = Math.max(0, input.miles - policy.freeRadiusMiles)
    if (tripMiles > 0) {
      add('trip', `Trip charge, ${tripMiles.toFixed(1)} mi past ${policy.freeRadiusMiles} mi${hauls > 1 ? ` x ${hauls} trips` : ''}`, `${formatCents(policy.tripCentsPerMile)} a mile past the free radius`, Math.round(tripMiles * policy.tripCentsPerMile) * hauls)
    }
    for (const item of policy.prohibitedItems) {
      const qty = Math.max(0, Math.floor(input.items[item.id] ?? 0))
      if (qty > 0) add(`item_${item.id}`, `${item.name} x ${qty}`, `${formatCents(item.cents)} each`, qty * item.cents)
    }
  }
  if (zone && zone.deliveryFeeCents > 0) add('delivery', 'Delivery', zone.name, zone.deliveryFeeCents, 'fee')
  if (material.heavy && material.maxFillPct) warnings.push(`Heavy material: fill to ${material.maxFillPct}% of the box`)

  const sum = (f: (c: Charge) => number) => lines.reduce((s, l) => s + f(l.charge), 0)
  return {
    lines, terms, warnings,
    baseCents: sum(c => c.baseCents),
    feeCents: sum(c => c.fees.reduce((a, f) => a + f.cents, 0)),
    taxCents: sum(c => c.taxCents),
    totalCents: sum(c => c.totalCents),
  }
}
