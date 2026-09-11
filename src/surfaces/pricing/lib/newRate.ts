/**
 * Pure helpers for the New rate section: which step asks for which field, the conditions that scope an adjustment or
 * tax layer to the new rate's lines, and the example line the Adjustments, Taxes, and Review steps price with the new
 * rate in place. Nothing here writes.
 */
import type { Frequency, PricingDimension, RateVersion, ServiceCatalog } from '../../../types'
import type { Db } from '../../../store/db'
import { dayOfWeekOf } from '../../../store/engine'
import { addDays } from './dates'
import { dimensionById, dimensions, fieldTypeOf, isPriceable, pricedByOf } from './config'
import type { PriceTestInput } from './rules'

export type KeyStep = 'fields' | 'zoneTypes' | 'zones' | 'cycles'

/**
 * The fields each step asks for, by where the value comes from. Service, category, and line of business follow from
 * the service; a roll-off material is priced by the size by material matrix, so no rate is keyed by it.
 */
const STEP_SOURCES: Record<KeyStep, PricingDimension['source'][]> = {
  fields: ['account', 'site', 'serviceLine', 'input'],
  zoneTypes: ['zone'],
  zones: ['geoZone'],
  cycles: ['frequency', 'cycle', 'dayOfWeek'],
}

export function keyFieldsFor(db: Db, step: KeyStep): PricingDimension[] {
  return dimensions(db).filter(d => isPriceable(d) && STEP_SOURCES[step].includes(d.source))
}

/** The service's rate columns with every field the new rate is keyed by added after them, or null when none is new. */
export function widenedPricedBy(item: ServiceCatalog, chosen: Record<string, string>): string[] | null {
  const current = pricedByOf(item)
  const added = Object.keys(chosen).filter(d => !current.includes(d))
  return added.length ? [...current, ...added] : null
}

/** Conditions that hold on exactly the new rate's lines: this service and each value the rate is keyed by. */
export function rateScope(catalogId: string, chosen: Record<string, string>): Record<string, string[]> {
  return { service: [catalogId], ...Object.fromEntries(Object.entries(chosen).map(([d, v]) => [d, [v]])) }
}

export interface ExampleExtras {
  /** The zone type to price in when the rate covers every zone type. */
  zoneId: string
  milesFromYard: number | undefined
  neighborStops: number | undefined
  /** The number the price is multiplied by, when the service has a quantity field. */
  quantity: number | undefined
  taxExempt: boolean
}

/**
 * One line the new rate prices: its zone type, frequency, cycle, and field values, on the first day on or after
 * onDate (the first matching weekday when the rate is keyed by day of week). A number field keyed by a band takes the
 * band's lower end.
 */
export function exampleInput(db: Db, item: ServiceCatalog, chosen: Record<string, string>, extras: ExampleExtras, onDate: string): PriceTestInput {
  const rolloff = item.lob === 'rolloff'
  const frequency = (chosen.frequency as Frequency | undefined) ?? (rolloff ? 'onCall' : 'weekly')
  const values: Record<string, string> = {}
  for (const [d, v] of Object.entries(chosen)) {
    if (d === 'zone' || d === 'frequency' || d === 'cycle' || d === 'dayOfWeek') continue
    const dim = dimensionById(db, d)
    if (dim && fieldTypeOf(dim) === 'number') {
      const band = dim.values.find(b => b.id === v)
      values[d] = String(band?.min ?? (band?.max !== undefined ? Math.max(0, band.max - 1) : 0))
    } else values[d] = v
  }
  if (item.quantityField && extras.quantity !== undefined) values[item.quantityField] = String(extras.quantity)
  let day = onDate
  for (let i = 1; chosen.dayOfWeek && dayOfWeekOf(day) !== chosen.dayOfWeek && i <= 7; i++) day = addDays(onDate, i)
  return {
    catalogId: item.id,
    frequency,
    zoneId: chosen.zone ?? extras.zoneId,
    lineType: rolloff || frequency === 'onCall' ? 'event' : 'recurring',
    onDate: day,
    months: 1,
    values,
    ...(chosen.cycle ? { cycle: chosen.cycle as NonNullable<PriceTestInput['cycle']> } : {}),
    ...(extras.milesFromYard !== undefined ? { milesFromYard: extras.milesFromYard } : {}),
    ...(extras.neighborStops !== undefined ? { neighborStops: extras.neighborStops } : {}),
    contractPriced: false,
    taxExempt: extras.taxExempt,
  }
}

export const PREVIEW_RATE_ID = 'rv_new_rate_preview'

/** A copy of the db with the new rate published for every line, so the engine prices the example line with it. */
export function previewWorld(db: Db, rate: Pick<RateVersion, 'catalogId' | 'zoneId' | 'frequency' | 'dims' | 'priceCents' | 'effectiveFrom'>): Db {
  const preview: RateVersion = { ...rate, id: PREVIEW_RATE_ID, status: 'published', publishedAt: rate.effectiveFrom, appliesTo: 'everyone' }
  return { ...db, rateVersions: [...db.rateVersions, preview] }
}
