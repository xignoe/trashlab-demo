// Cost to serve, a pure function of editable assumptions (moved unchanged from pricing/src/store/costToServe.ts;
// pricing checklist 5.5). No store access, no clock.
//
// Method (from the pricing brief): truck day cost divided by effective lifts per day gives truck and labor per lift;
// access flags add minutes to every lift, which lowers lifts per day. Disposal is container yards times lb per yard for
// the material, times lifts per month, in tons, times the tip fee. Indirect is a percentage of direct cost. Full cost
// is the minimum defensible price; the target price adds the margin.
//
// Rounding (addendum C6 in spirit): rates such as truck cost per lift and tons per month stay unrounded so nothing
// compounds; every monthly money line is Math.round to whole cents, so the lines on the waterfall always sum to the
// total shown. With the defaults, a 3 yd msw container at 2x is full cost 16910 and target 19894 ($169.10 and
// $198.94), matching the Paper artboard 17F-0.
import type { Frequency, ServiceCatalog } from '../../../types'

export type Material = 'msw' | 'office' | 'restaurant' | 'cardboard' | 'wood' | 'cAndD'

export const MATERIALS: Material[] = ['msw', 'office', 'restaurant', 'cardboard', 'wood', 'cAndD']

export const MATERIAL_LABEL: Record<Material, string> = {
  msw: 'Mixed trash (MSW)',
  office: 'Office paper and trash',
  restaurant: 'Restaurant food waste',
  cardboard: 'Cardboard (OCC)',
  wood: 'Wood waste',
  cAndD: 'Construction and demolition',
}

/** Material the container is for when the catalog says so; mixed trash otherwise. */
export function defaultMaterial(item: ServiceCatalog | undefined): Material {
  if (!item) return 'msw'
  if (/wood/i.test(`${item.id} ${item.name}`)) return 'wood'
  if (item.lob === 'rolloff') return 'cAndD'
  return 'msw'
}

export type AccessFlag = 'gate' | 'lock' | 'enclosure'
export type AccessFlags = Record<AccessFlag, boolean>
export const ACCESS_FLAGS: AccessFlag[] = ['gate', 'lock', 'enclosure']
export const NO_ACCESS_FLAGS: AccessFlags = { gate: false, lock: false, enclosure: false }

export interface CostAssumptions {
  /** Fully loaded cost of one truck and driver for one day, in cents. */
  truckDayCostCents: number
  /** Commercial frontload lifts a truck makes in a day with no access delays. */
  baseLiftsPerDay: number
  /** Residential cart stops a truck makes in a day; used in place of baseLiftsPerDay for cart items. */
  residentialStopsPerDay: number
  /** Rolloff hauls a truck makes in a day (deliver, pull, dump, return); used for rolloff boxes (pricing decision 82). */
  rolloffHaulsPerDay: number
  truckHoursPerDay: number
  /** Minutes added to every lift by each access flag. */
  extraMinutes: Record<AccessFlag, number>
  lbPerYard: Record<Material, number>
  tipFeeCentsPerTon: number
  indirectPct: number
  targetMarginPct: number
  liftsPerMonth: Record<Frequency, number>
}

export const DEFAULT_ASSUMPTIONS: CostAssumptions = {
  truckDayCostCents: 65000,
  baseLiftsPerDay: 80,
  residentialStopsPerDay: 600,
  rolloffHaulsPerDay: 6,
  truckHoursPerDay: 8,
  extraMinutes: { gate: 2, lock: 1, enclosure: 3 },
  lbPerYard: { msw: 95, office: 70, restaurant: 130, cardboard: 45, wood: 100, cAndD: 300 },
  tipFeeCentsPerTon: 6200,
  indirectPct: 15,
  targetMarginPct: 15,
  liftsPerMonth: { weekly: 4.33, eow: 2.17, '2x': 8.67, '3x': 13, '4x': 17.33, '5x': 21.67, '6x': 26, onCall: 1 },
}

/** Every numeric assumption as a flat path, for counting and highlighting edits. */
export function changedAssumptions(a: CostAssumptions, b: CostAssumptions = DEFAULT_ASSUMPTIONS): string[] {
  const out: string[] = []
  const walk = (x: unknown, y: unknown, path: string) => {
    if (typeof x === 'number' || typeof y === 'number') {
      if (x !== y) out.push(path)
      return
    }
    const xo = x as Record<string, unknown>
    const yo = y as Record<string, unknown>
    for (const k of Object.keys(yo)) walk(xo[k], yo[k], path ? `${path}.${k}` : k)
  }
  walk(a, b, '')
  return out
}

/** Throws a RangeError naming the first assumption that would divide by zero or make no sense. */
export function validateAssumptions(a: CostAssumptions): void {
  const positive: [string, number][] = [
    ['truckDayCostCents', a.truckDayCostCents],
    ['baseLiftsPerDay', a.baseLiftsPerDay],
    ['residentialStopsPerDay', a.residentialStopsPerDay],
    ['rolloffHaulsPerDay', a.rolloffHaulsPerDay],
    ['truckHoursPerDay', a.truckHoursPerDay],
  ]
  for (const [k, v] of positive) if (!(Number.isFinite(v) && v > 0)) throw new RangeError(`${k} must be greater than 0`)
  const nonNegative: [string, number][] = [
    ...Object.entries(a.extraMinutes).map(([k, v]): [string, number] => [`extraMinutes.${k}`, v]),
    ...Object.entries(a.lbPerYard).map(([k, v]): [string, number] => [`lbPerYard.${k}`, v]),
    ...Object.entries(a.liftsPerMonth).map(([k, v]): [string, number] => [`liftsPerMonth.${k}`, v]),
    ['tipFeeCentsPerTon', a.tipFeeCentsPerTon],
    ['indirectPct', a.indirectPct],
    ['targetMarginPct', a.targetMarginPct],
  ]
  for (const [k, v] of nonNegative) if (!(Number.isFinite(v) && v >= 0)) throw new RangeError(`${k} must be 0 or more`)
  if (a.targetMarginPct >= 100) throw new RangeError('targetMarginPct must be below 100')
}

/** Container volume in cubic yards from the catalog sizeLabel. "3 yd" is 3, "20 yd" is 20. Carts count as 0.5 yd for
 *  96 gal and 0.33 yd for 64 gal (pricing checklist 5.5); any other gallon size scales from 96 gal = 0.5. */
export function yardsFor(item: Pick<ServiceCatalog, 'sizeLabel'>): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(yd|gal)/i.exec(item.sizeLabel)
  if (!m) throw new RangeError(`Cannot read a size from "${item.sizeLabel}"`)
  const n = Number(m[1])
  if (m[2].toLowerCase() === 'yd') return n
  if (n === 96) return 0.5
  if (n === 64) return 0.33
  return Math.round((n / 192) * 100) / 100
}

/** Residential carts are costed at residentialStopsPerDay: 80 lifts a day is a commercial frontload figure. */
export function usesResidentialStops(item: Pick<ServiceCatalog, 'lob' | 'unit'>): boolean {
  return item.lob === 'residential' || item.unit === 'cart'
}

/** Rolloff boxes are costed at rolloffHaulsPerDay (pricing decision 82). */
export function usesRolloffHauls(item: Pick<ServiceCatalog, 'lob' | 'unit'>): boolean {
  return !usesResidentialStops(item) && (item.lob === 'rolloff' || item.unit === 'box')
}

export type LiftsPerDaySource = 'baseLiftsPerDay' | 'residentialStopsPerDay' | 'rolloffHaulsPerDay'

/** Which assumption sets lifts per day for this catalog item. */
export function liftsBasisFor(item: Pick<ServiceCatalog, 'lob' | 'unit'>): LiftsPerDaySource {
  if (usesResidentialStops(item)) return 'residentialStopsPerDay'
  if (usesRolloffHauls(item)) return 'rolloffHaulsPerDay'
  return 'baseLiftsPerDay'
}

export interface CostToServeArgs {
  item: Pick<ServiceCatalog, 'lob' | 'unit' | 'sizeLabel'>
  material: Material
  frequency: Frequency
  access?: Partial<AccessFlags>
  assumptions?: CostAssumptions
}

/** Per container per month. Rates are unrounded; every *Cents money line is whole cents. */
export interface CostToServe {
  yards: number
  liftsPerDayBase: number
  liftsPerDaySource: LiftsPerDaySource
  truckMinutesPerDay: number
  baseMinutesPerLift: number
  extraMinutesPerLift: number
  effectiveLiftsPerDay: number
  /** Truck and labor per lift, unrounded cents (812.5 at the defaults). */
  truckPerLiftCents: number
  liftsPerMonth: number
  monthlyTruckCents: number
  lbPerYard: number
  lbPerLift: number
  tonsPerMonth: number
  tipFeeCentsPerTon: number
  disposalCents: number
  directCents: number
  indirectPct: number
  indirectCents: number
  fullCostCents: number
  targetMarginPct: number
  /** targetPriceCents minus fullCostCents. */
  marginCents: number
  targetPriceCents: number
  /** The floor: full cost to serve with no margin. */
  minimumDefensibleCents: number
}

export function costToServe(args: CostToServeArgs): CostToServe {
  const a = args.assumptions ?? DEFAULT_ASSUMPTIONS
  validateAssumptions(a)
  const access = { ...NO_ACCESS_FLAGS, ...args.access }

  const yards = yardsFor(args.item)
  const liftsPerDaySource = liftsBasisFor(args.item)
  const liftsPerDayBase = a[liftsPerDaySource]
  const truckMinutesPerDay = a.truckHoursPerDay * 60
  const baseMinutesPerLift = truckMinutesPerDay / liftsPerDayBase
  const extraMinutesPerLift = ACCESS_FLAGS.reduce((sum, f) => sum + (access[f] ? a.extraMinutes[f] : 0), 0)
  const effectiveLiftsPerDay = truckMinutesPerDay / (baseMinutesPerLift + extraMinutesPerLift)

  const truckPerLiftCents = a.truckDayCostCents / effectiveLiftsPerDay
  const liftsPerMonth = a.liftsPerMonth[args.frequency]
  const monthlyTruckCents = Math.round(truckPerLiftCents * liftsPerMonth)

  const lbPerYard = a.lbPerYard[args.material]
  const lbPerLift = yards * lbPerYard
  const tonsPerMonth = (lbPerLift * liftsPerMonth) / 2000
  const disposalCents = Math.round(tonsPerMonth * a.tipFeeCentsPerTon)

  const directCents = monthlyTruckCents + disposalCents
  const indirectCents = Math.round((directCents * a.indirectPct) / 100)
  const fullCostCents = directCents + indirectCents
  const targetPriceCents = Math.round(fullCostCents / (1 - a.targetMarginPct / 100))

  return {
    yards,
    liftsPerDayBase,
    liftsPerDaySource,
    truckMinutesPerDay,
    baseMinutesPerLift,
    extraMinutesPerLift,
    effectiveLiftsPerDay,
    truckPerLiftCents,
    liftsPerMonth,
    monthlyTruckCents,
    lbPerYard,
    lbPerLift,
    tonsPerMonth,
    tipFeeCentsPerTon: a.tipFeeCentsPerTon,
    disposalCents,
    directCents,
    indirectPct: a.indirectPct,
    indirectCents,
    fullCostCents,
    targetMarginPct: a.targetMarginPct,
    marginCents: targetPriceCents - fullCostCents,
    targetPriceCents,
    minimumDefensibleCents: fullCostCents,
  }
}
