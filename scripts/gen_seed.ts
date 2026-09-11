/*
  Seed generator for the merged app (copied from billing/scripts/gen_seed.ts). Run with: npm run seed
  Writes every src/seed/*.json table deterministically. This file is the single source for the
  seed; edit it and re-run rather than hand editing the JSON.
  Money is integer cents. Dates are ISO strings. Today is 2026-09-10.
*/
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  BillingAccount, BillingGroup, Charge, Container, Contract, CreditMemo, FeeRule, Hauler, Invoice, Party, Payment,
  PaymentAllocation, ProcessorBatch, Quote, RateVersion, Request, Route, ScaleTicket, ServiceCatalog,
  ServiceEvent, ServiceItem, Site, TaxRule, WaivedCharge, WorkOrder, Zone, Frequency, RolloffMaterial, RolloffPolicy, RolloffRate,
} from '../src/types.ts'
import type { PricingDimension, ServiceCategory } from '../src/types.ts'
// The canonical engine prices quote_held_ridge (addendum D6). It reads only the scratch Db passed to it.
import { computeCharge, resolvePrice } from '../src/store/engine.ts'
import { addMonths } from '../src/store/cycles.ts'
import type { Db } from '../src/store/db.ts'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'src', 'seed')

// ---------- helpers ----------
const pad3 = (n: number) => String(n).padStart(3, '0')
const round = (n: number) => Math.round(n)
const FUEL_PCT = 7
const ENV_FLAT = 100
const TAX_PCT = 7

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function short(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}`
}
function lastDay(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0))
  return d.toISOString().slice(0, 10)
}
const monthPeriod = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return { start: `${ym}-01`, end: lastDay(y, m) }
}
const Q3 = { start: '2026-07-01', end: '2026-09-30' }

// ---------- hauler ----------
const hauler: Hauler[] = [{
  id: 'hauler_piedmont',
  name: 'Piedmont Disposal',
  policy: { proration: 'none', lateFeeCents: 1000, lateFeeDay: 5, graceMissedPickups: 2, suspendAfterDays: 30, reinstatementFeeCents: 2500 },
}]

// ---------- zones ----------
const zones: Zone[] = [
  { id: 'zone_open', name: 'Open market', serviceability: 'open', taxRatePct: 7, franchiseFeePct: 0, deliveryFeeCents: 2500, publicPricing: true },
  { id: 'zone_boundary', name: 'Boundary', serviceability: 'boundary', taxRatePct: 7, franchiseFeePct: 0, deliveryFeeCents: 2500, publicPricing: true },
  { id: 'zone_franchise', name: 'City franchise', serviceability: 'franchise', taxRatePct: 7, franchiseFeePct: 17, deliveryFeeCents: 2500, publicPricing: false },
  { id: 'zone_notserved', name: 'Not served', serviceability: 'notServed', taxRatePct: 0, franchiseFeePct: 0, deliveryFeeCents: 0, publicPricing: false },
]

// ---------- catalog ----------
const catalog: ServiceCatalog[] = [
  { id: 'cat_res_96', lob: 'residential', name: '96 gal cart', sizeLabel: '96 gal', unit: 'cart', public: true },
  { id: 'cat_res_64', lob: 'residential', name: '64 gal cart', sizeLabel: '64 gal', unit: 'cart', public: true },
  { id: 'cat_res_extra_cart', lob: 'residential', name: 'Extra 96 gal cart', sizeLabel: '96 gal', unit: 'cart', public: true },
  { id: 'cat_res_recycling', lob: 'residential', name: 'Recycling cart', sizeLabel: '96 gal', unit: 'cart', public: true },
  { id: 'cat_fl_2yd', lob: 'frontload', name: '2 yd frontload container', sizeLabel: '2 yd', unit: 'container', public: false },
  { id: 'cat_fl_3yd', lob: 'frontload', name: '3 yd frontload container', sizeLabel: '3 yd', unit: 'container', public: false },
  { id: 'cat_fl_3yd_wood', lob: 'frontload', name: '3 yd wood waste container', sizeLabel: '3 yd', unit: 'container', public: false },
  { id: 'cat_ro_20yd', lob: 'rolloff', name: '20 yd rolloff box', sizeLabel: '20 yd', unit: 'box', rolloff: { includedTons: 3, includedDays: 30, extraDayCents: 700, overageCentsPerTon: 7000 }, public: false },
  // Storefront commercial request (Sep 2026): the wider range of containers a business can ask for. Appended so every
  // existing id, row order, and derived table stays where it was.
  { id: 'cat_fl_4yd', lob: 'frontload', name: '4 yd frontload container', sizeLabel: '4 yd', unit: 'container', public: false },
  { id: 'cat_fl_6yd', lob: 'frontload', name: '6 yd frontload container', sizeLabel: '6 yd', unit: 'container', public: false },
  { id: 'cat_fl_8yd', lob: 'frontload', name: '8 yd frontload container', sizeLabel: '8 yd', unit: 'container', public: false },
  { id: 'cat_ro_10yd', lob: 'rolloff', name: '10 yd rolloff box', sizeLabel: '10 yd', unit: 'box', rolloff: { includedTons: 2, includedDays: 30, extraDayCents: 700, overageCentsPerTon: 7000 }, public: false },
  { id: 'cat_ro_30yd', lob: 'rolloff', name: '30 yd rolloff box', sizeLabel: '30 yd', unit: 'box', rolloff: { includedTons: 4, includedDays: 30, extraDayCents: 700, overageCentsPerTon: 7000 }, public: false },
  { id: 'cat_ro_40yd', lob: 'rolloff', name: '40 yd rolloff box', sizeLabel: '40 yd', unit: 'box', rolloff: { includedTons: 5, includedDays: 30, extraDayCents: 700, overageCentsPerTon: 7000 }, public: false },
  // Serviced by a rolloff truck. No rate row: a compactor is always priced by a person.
  { id: 'cat_ro_compactor_30yd', lob: 'rolloff', name: '30 yd compactor', sizeLabel: '30 yd', unit: 'box', rolloff: { includedTons: 6, includedDays: 30, extraDayCents: 700, overageCentsPerTon: 7000 }, public: false },
]
// Roll-off rental and weight terms (pricing model, DECISIONS.md entry 64). No grace days and no minimum tons, so every
// seeded extra-day and overage figure is unchanged; heavy overages past 3 t over the allowance bill at $90/t.
for (const c of catalog) {
  if (!c.rolloff) continue
  c.rolloff.maxRentalDays = 90
  c.rolloff.overageTiers = [{ aboveTons: 3, centsPerTon: 9000 }]
}
// Pricing configuration (DECISIONS.md entry 65): every service sits in an owner-defined category, says what one unit
// of its price buys, and names the dimensions its rates are keyed by.
const serviceCategories: ServiceCategory[] = [
  { id: 'sc_res_carts', name: 'Residential carts', lob: 'residential', description: 'Curbside trash service, billed monthly or quarterly' },
  { id: 'sc_res_addons', name: 'Residential add-ons', lob: 'residential', description: 'Extra carts and recycling on a trash account' },
  { id: 'sc_fl_trash', name: 'Commercial trash', lob: 'frontload', description: 'Frontload containers on a set schedule' },
  { id: 'sc_fl_specialty', name: 'Commercial specialty', lob: 'frontload', description: 'Single-material containers' },
  { id: 'sc_ro_boxes', name: 'Roll-off boxes', lob: 'rolloff', description: 'Open-top boxes billed per haul, tons and days included' },
  { id: 'sc_ro_compactors', name: 'Compactors', lob: 'rolloff', description: 'Priced per haul by a person' },
]
const CATEGORY_OF: Record<string, string> = {
  cat_res_extra_cart: 'sc_res_addons', cat_res_recycling: 'sc_res_addons', cat_fl_3yd_wood: 'sc_fl_specialty', cat_ro_compactor_30yd: 'sc_ro_compactors',
}
for (const c of catalog) {
  c.categoryId = CATEGORY_OF[c.id] ?? (c.lob === 'frontload' ? 'sc_fl_trash' : c.lob === 'rolloff' ? 'sc_ro_boxes' : 'sc_res_carts')
  c.priceUnit = c.lob === 'rolloff' ? 'haul' : 'month'
  c.pricedBy = c.lob === 'rolloff' ? ['zone', 'serviceSpeed'] : c.lob === 'residential' ? ['zone', 'frequency', 'customerTier'] : ['zone', 'frequency']
}
const catName = (id: string) => catalog.find(c => c.id === id)!.name

// ---------- rate versions ----------
const PUB_2026 = '2025-12-15T09:00:00-05:00'
const rv = (id: string, catalogId: string, frequency: Frequency, priceCents: number, zoneId = 'zone_open', effectiveFrom = '2026-01-01', extra: Partial<RateVersion> = {}): RateVersion => ({
  id, catalogId, zoneId, frequency, priceCents, effectiveFrom, status: 'published', publishedAt: PUB_2026, ...extra,
})
const rateVersions: RateVersion[] = [
  rv('rv_res_96_2026', 'cat_res_96', 'weekly', 2900),
  rv('rv_res_64_2026', 'cat_res_64', 'weekly', 2600),
  rv('rv_res_extra_2026', 'cat_res_extra_cart', 'weekly', 900),
  rv('rv_res_recycling_2026', 'cat_res_recycling', 'eow', 1200),
  rv('rv_fl_2yd_2026', 'cat_fl_2yd', 'weekly', 15000),
  rv('rv_fl_3yd_2026', 'cat_fl_3yd', '2x', 22000),
  rv('rv_fl_3yd_wood_2026', 'cat_fl_3yd_wood', '2x', 19000),
  rv('rv_ro_20yd_2026', 'cat_ro_20yd', 'onCall', 57500),
  rv('rv_res_64_2026q4', 'cat_res_64', 'weekly', 2700, 'zone_open', '2026-10-01', { publishedAt: '2026-09-01T10:00:00-04:00', supersedesId: 'rv_res_64_2026' }),
  // Addendum C4 (Phase 3.7c, storefront request R5): zone_boundary has its own rows at its own higher price, the
  // prototype pricing surface's figures (pricing/src/seed/rateVersions.json: 3100, 2800, 1000, 1300). No seeded site
  // is in zone_boundary, so no seeded charge or invoice moves; the storefront's boundary branch reads these.
  rv('rv_res_96_2026_boundary', 'cat_res_96', 'weekly', 3100, 'zone_boundary'),
  rv('rv_res_64_2026_boundary', 'cat_res_64', 'weekly', 2800, 'zone_boundary'),
  rv('rv_res_extra_2026_boundary', 'cat_res_extra_cart', 'weekly', 1000, 'zone_boundary'),
  rv('rv_res_recycling_2026_boundary', 'cat_res_recycling', 'eow', 1300, 'zone_boundary'),
  // Commercial rate card for the new sizes, read by the storefront's instant estimate (Sep 2026): monthly per container,
  // open market only, so every other zone still goes to a person. The 2 yd and 3 yd rows above are left as they were:
  // scenario 3 (the bakery's 3x request with no published 3x rate) depends on it.
  ...([
    ['cat_fl_4yd', 'fl_4yd', { weekly: 18500, '2x': 26000, '3x': 34500 }],
    ['cat_fl_6yd', 'fl_6yd', { weekly: 23500, '2x': 34500, '3x': 46000 }],
    ['cat_fl_8yd', 'fl_8yd', { weekly: 28500, '2x': 43000, '3x': 57500 }],
  ] as const).flatMap(([catalogId, key, prices]) =>
    Object.entries(prices).map(([f, cents]) => rv(`rv_${key}_${f}_2026`, catalogId, f as Frequency, cents)),
  ),
  rv('rv_ro_10yd_2026', 'cat_ro_10yd', 'onCall', 42500),
  rv('rv_ro_30yd_2026', 'cat_ro_30yd', 'onCall', 67500),
  rv('rv_ro_40yd_2026', 'cat_ro_40yd', 'onCall', 77500),
]
const rvFor = (catalogId: string) => rateVersions.find(r => r.catalogId === catalogId && r.zoneId === 'zone_open' && r.effectiveFrom === '2026-01-01')!
const price = (catalogId: string) => rvFor(catalogId).priceCents

// ---------- fee and tax rules ----------
// The fuel and environmental rules carry no scope, so they price every line exactly as before. The three location rules
// (DECISIONS.md entry 64) are published and scheduled for the Jan 1, 2027 cycle, so the October demo figures the
// scenario and runbook tests pin do not move; the Ratebook shows them as scheduled with their next-run impact. They
// only match sites that carry milesFromYard or neighborStops, and none of the named demo sites falls in a band.
const LOCATION_FROM = '2027-01-01'
const feeRules: FeeRule[] = [
  { id: 'fee_fuel_7pct', name: 'Fuel surcharge', kind: 'percent', value: 7, base: 'serviceLines', appliesTo: ['recurring', 'event'], taxable: true, category: 'surcharge', description: 'Tracks diesel cost; reviewed quarterly' },
  { id: 'fee_env_1', name: 'Environmental fee', kind: 'flat', value: 100, base: 'serviceLines', appliesTo: ['recurring'], taxable: false, category: 'regulatory', description: 'Landfill host and state solid waste fees, passed through per month' },
  {
    id: 'fee_loc_remote', name: 'Remote area surcharge', kind: 'percent', value: 10, base: 'serviceLines', appliesTo: ['recurring'], taxable: true,
    category: 'location', description: 'Longer drive and deadhead miles for stops 25 to 40 miles from the yard', when: { lob: ['residential', 'frontload'] },
    minMiles: 25, maxMiles: 40, exemptContracts: true, effectiveFrom: LOCATION_FROM,
  },
  {
    id: 'fee_loc_extended', name: 'Extended area surcharge', kind: 'percent', value: 18, base: 'serviceLines', appliesTo: ['recurring'], taxable: true,
    category: 'location', description: 'Stops 40 miles or more from the yard, at least $6.00 a month', when: { lob: ['residential', 'frontload'] },
    minMiles: 40, minCents: 600, exemptContracts: true, effectiveFrom: LOCATION_FROM,
  },
  {
    id: 'fee_loc_dense', name: 'Dense route credit', kind: 'percent', value: -5, base: 'serviceLines', appliesTo: ['recurring'], taxable: true,
    category: 'credit', description: 'Eight or more of our stops within a quarter mile: the truck barely moves between them', when: { lob: ['residential'] },
    minNeighborStops: 8, exemptContracts: true, effectiveFrom: LOCATION_FROM,
  },
  // Conditional adjustments on configurable dimensions (entry 65). Service speed is asked when quoting and billing
  // always sees Standard, so the two rush rules are live without moving a billed figure; the rest start with the
  // Jan 1, 2027 cycle like the location rules, and the prepay discount is a paused proposal.
  {
    id: 'fee_speed_nextday', name: 'Next-day service', kind: 'percent', value: 25, base: 'serviceLines', appliesTo: ['event'], taxable: true,
    category: 'surcharge', description: 'On-demand job run the next business day', when: { serviceSpeed: ['nextDay'] }, stackGroup: 'rush',
  },
  {
    id: 'fee_speed_sameday', name: 'Same-day service', kind: 'percent', value: 50, base: 'serviceLines', appliesTo: ['event'], taxable: true,
    category: 'surcharge', description: 'On-demand job run the day it is booked', when: { serviceSpeed: ['sameDay'] }, stackGroup: 'rush',
  },
  {
    id: 'fee_weekend', name: 'Weekend service', kind: 'flat', value: 3500, base: 'serviceLines', appliesTo: ['event'], taxable: true,
    category: 'surcharge', description: 'Special pickups on a Saturday or Sunday', when: { dayOfWeek: ['sat', 'sun'], lob: ['residential', 'frontload'] },
    effectiveFrom: LOCATION_FROM,
  },
  {
    id: 'fee_tier_vip', name: 'VIP discount', kind: 'percent', value: -10, base: 'serviceLines', appliesTo: ['recurring'], taxable: true,
    category: 'credit', description: 'Long-standing and referral customers', when: { customerTier: ['vip'] }, stackGroup: 'customerDiscount',
    exemptContracts: true, effectiveFrom: LOCATION_FROM,
  },
  {
    id: 'fee_tier_ff', name: 'Friends and family', kind: 'percent', value: -15, base: 'serviceLines', appliesTo: ['recurring'], taxable: true,
    category: 'credit', description: 'Staff and their households', when: { customerTier: ['friendsFamily'] }, stackGroup: 'customerDiscount',
    exemptContracts: true, effectiveFrom: LOCATION_FROM,
  },
  {
    id: 'fee_access_walkout', name: 'Walk-out service', kind: 'flat', value: 500, base: 'serviceLines', appliesTo: ['recurring'], taxable: true,
    category: 'surcharge', description: 'Driver walks the cart from the side or back yard', when: { access: ['walkOut'], lob: ['residential'] },
    effectiveFrom: LOCATION_FROM,
  },
  {
    id: 'fee_cycle_quarterly', name: 'Quarterly prepay discount', kind: 'percent', value: -2, base: 'serviceLines', appliesTo: ['recurring'], taxable: true,
    category: 'credit', description: 'Proposed: a small thank-you for paying a quarter ahead', when: { cycle: ['quarterly'], lob: ['residential'] },
    status: 'paused', effectiveFrom: LOCATION_FROM,
  },
  // Priced by a zone drawn on the map (entry 69): the example of charging by drawn zone. Like the location rules it
  // starts with the Jan 1, 2027 cycle, so no October figure moves.
  {
    id: 'fee_zone_east_county', name: 'East county surcharge', kind: 'flat', value: 300, base: 'serviceLines', appliesTo: ['recurring'], taxable: true,
    category: 'location', description: 'Rural stops past the county line road, inside the East county zone drawn on the map',
    when: { geoZone: ['gz_east_county'], lob: ['residential', 'frontload'] }, exemptContracts: true, effectiveFrom: LOCATION_FROM,
  },
]
const taxRules: TaxRule[] = [
  { id: 'tax_zone_open', zoneId: 'zone_open', ratePct: 7, appliesTo: ['recurring', 'event', 'fee'], name: 'Sales tax, state and county', jurisdiction: 'state' },
  { id: 'tax_zone_boundary', zoneId: 'zone_boundary', ratePct: 7, appliesTo: ['recurring', 'event', 'fee'], name: 'Sales tax, state and county', jurisdiction: 'state' },
  { id: 'tax_zone_franchise', zoneId: 'zone_franchise', ratePct: 7, appliesTo: ['recurring', 'event', 'fee'], name: 'Sales tax, state and county', jurisdiction: 'state' },
]

// ---------- roll-off pricing model ----------
// Mixed debris is the standard material: priced by the size's haul RateVersion and the catalog's rolloff terms, so the
// Hale C&D tickets bill exactly as before. Every other material is a cell in the size by material matrix.
const rolloffMaterials: RolloffMaterial[] = [
  { id: 'mat_mixed', name: 'Mixed debris (C&D)', ticketCodes: ['C&D', 'Mixed', 'Debris'], handling: 'standard', disposalCentsPerTon: 4800, note: 'Remodel and construction debris, furniture, general junk' },
  { id: 'mat_household', name: 'Household cleanout', ticketCodes: ['MSW', 'Household'], handling: 'accepted', disposalCentsPerTon: 5200, note: 'Bagged trash and cleanouts; landfill charges more than the C&D cell' },
  { id: 'mat_roofing', name: 'Roofing shingles', ticketCodes: ['Roofing', 'Shingles'], handling: 'accepted', heavy: true, disposalCentsPerTon: 5500, note: 'About 1 t per 10 squares of one layer; 10 and 20 yd only' },
  { id: 'mat_yard', name: 'Yard waste and brush', ticketCodes: ['Yard', 'Brush'], handling: 'accepted', disposalCentsPerTon: 2800, note: 'Goes to the compost site, which is cheaper than the landfill' },
  { id: 'mat_clean_fill', name: 'Clean concrete, brick, dirt', ticketCodes: ['Concrete', 'Dirt', 'Clean fill'], handling: 'restricted', heavy: true, maxFillPct: 50, disposalCentsPerTon: 1500, note: 'Fill to the halfway line; nothing mixed in, or it bills as mixed debris' },
  { id: 'mat_hazard', name: 'Hazardous and liquids', ticketCodes: ['Hazardous'], handling: 'prohibited', note: 'Paint, oil, chemicals, batteries, asbestos. Refused at the gate' },
]
const RO_SIZES = ['cat_ro_10yd', 'cat_ro_20yd', 'cat_ro_30yd', 'cat_ro_40yd', 'cat_ro_compactor_30yd']
const roTons = (catalogId: string) => catalog.find(c => c.id === catalogId)!.rolloff!.includedTons
type Cell = Pick<RolloffRate, 'haulDeltaCents' | 'includedTons' | 'overageCentsPerTon'> & Partial<Pick<RolloffRate, 'overageTiers' | 'minBilledTons'>>
const cells: Record<string, Record<string, Cell | null>> = {
  mat_household: Object.fromEntries(RO_SIZES.map(id => [id, id === 'cat_ro_compactor_30yd' ? null : { haulDeltaCents: 2500, includedTons: roTons(id), overageCentsPerTon: 8000 }])),
  mat_roofing: {
    cat_ro_10yd: { haulDeltaCents: 5000, includedTons: 3, overageCentsPerTon: 6500, overageTiers: [{ aboveTons: 2, centsPerTon: 8500 }] },
    cat_ro_20yd: { haulDeltaCents: 7500, includedTons: 5, overageCentsPerTon: 6500, overageTiers: [{ aboveTons: 2, centsPerTon: 8500 }] },
    cat_ro_30yd: null, cat_ro_40yd: null, cat_ro_compactor_30yd: null,
  },
  mat_yard: Object.fromEntries(RO_SIZES.map(id => [id, id === 'cat_ro_compactor_30yd' ? null : { haulDeltaCents: -2500, includedTons: roTons(id), overageCentsPerTon: 5500 }])),
  mat_clean_fill: {
    cat_ro_10yd: { haulDeltaCents: 0, includedTons: 8, overageCentsPerTon: 4000, minBilledTons: 4 },
    cat_ro_20yd: { haulDeltaCents: 5000, includedTons: 10, overageCentsPerTon: 4000, minBilledTons: 5 },
    cat_ro_30yd: null, cat_ro_40yd: null, cat_ro_compactor_30yd: null,
  },
}
const rolloffRates: RolloffRate[] = []
for (const [materialId, row] of Object.entries(cells)) {
  for (const catalogId of RO_SIZES) {
    const cell = row[catalogId]
    rolloffRates.push({
      id: `rr_${catalogId.replace('cat_ro_', '')}_${materialId.replace('mat_', '')}_2026`, catalogId, materialId, available: cell !== null,
      haulDeltaCents: cell?.haulDeltaCents ?? 0, includedTons: cell?.includedTons ?? 0, overageCentsPerTon: cell?.overageCentsPerTon ?? 0,
      ...(cell?.overageTiers ? { overageTiers: cell.overageTiers } : {}), ...(cell?.minBilledTons ? { minBilledTons: cell.minBilledTons } : {}),
      effectiveFrom: '2026-01-01', publishedAt: '2025-12-15T09:00:00-05:00',
    })
  }
}
const rolloffPolicy: RolloffPolicy[] = [{
  id: 'rolloff_policy', tonRounding: 'exact', freeRadiusMiles: 15, tripCentsPerMile: 350, swapCents: 29500, relocationCents: 7500, dryRunCents: 15000,
  prohibitedItems: [
    { id: 'item_mattress', name: 'Mattress or box spring', cents: 2500 },
    { id: 'item_tire', name: 'Tire, car or light truck', cents: 1500 },
    { id: 'item_appliance', name: 'Appliance with refrigerant', cents: 7500 },
    { id: 'item_electronics', name: 'TV or monitor', cents: 2000 },
  ],
}]

// ---------- pricing dimensions (DECISIONS.md entry 65) ----------
// Built-in dimensions read their values from the line; the rest carry values the owner manages. Tier and access
// assignments only feed rules that start Jan 1, 2027, so no seeded figure moves.
const pricingDimensions: PricingDimension[] = [
  { id: 'zone', name: 'Zone type', source: 'zone', values: [], builtIn: true, description: 'Open market, boundary, city franchise, or not served: decides serviceability and tax' },
  { id: 'geoZone', name: 'Zone', source: 'geoZone', values: [], builtIn: true, description: 'The zone drawn on the map that holds the site' },
  { id: 'frequency', name: 'Frequency', source: 'frequency', values: [], builtIn: true, description: 'How often the service runs' },
  { id: 'service', name: 'Service', source: 'service', values: [], builtIn: true, description: 'The catalog item on the line' },
  { id: 'category', name: 'Category', source: 'category', values: [], builtIn: true, description: 'The service category' },
  { id: 'lob', name: 'Line of business', source: 'lob', values: [], builtIn: true, description: 'Residential, frontload, or roll-off' },
  { id: 'cycle', name: 'Billing cycle', source: 'cycle', values: [], builtIn: true, description: 'The billing cycle of the account' },
  {
    id: 'dayOfWeek', name: 'Day of week', source: 'dayOfWeek', builtIn: true, description: 'Route day for recurring service, service date for events and hauls',
    values: [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']].map(([id, label]) => ({ id, label })),
  },
  { id: 'material', name: 'Material', source: 'material', values: [], builtIn: true, description: 'Roll-off material, from the scale ticket' },
  {
    id: 'customerTier', name: 'Customer tier', source: 'account', defaultValueId: 'standard', description: 'Set on the account; keys discounts and broker rate cards',
    values: [{ id: 'standard', label: 'Standard' }, { id: 'vip', label: 'VIP' }, { id: 'friendsFamily', label: 'Friends and family' }, { id: 'nationalBroker', label: 'National broker' }],
    assignments: { acct_res_021: 'vip', acct_res_025: 'vip', acct_res_029: 'friendsFamily', acct_pm_oakridge: 'nationalBroker' },
  },
  {
    id: 'serviceSpeed', name: 'Service speed', source: 'input', defaultValueId: 'standard', description: 'Asked when quoting an on-demand job; billing uses Standard',
    values: [{ id: 'standard', label: 'Standard' }, { id: 'nextDay', label: 'Next day' }, { id: 'sameDay', label: 'Same day' }],
  },
  {
    id: 'access', name: 'Site access', source: 'site', defaultValueId: 'curbside', description: 'Set on the site by the office',
    values: [{ id: 'curbside', label: 'Curbside' }, { id: 'gated', label: 'Gated or coded' }, { id: 'walkOut', label: 'Walk-out service' }],
    assignments: { site_bakery: 'gated', site_res_012: 'walkOut', site_res_018: 'walkOut' },
  },
  // Custom fields (DECISIONS.md entry 68): examples of each kind. No seeded rate, rule, or service reads them yet, so
  // no figure moves until the owner prices with them.
  {
    id: 'collectionsPerMonth', name: 'Collections per month', source: 'serviceLine', type: 'number', unit: 'collections per month',
    description: 'Set on a commercial service line. A service priced per collection multiplies its price by it; rates can be banded by it',
    values: [{ id: 'c1_4', label: '1 to 4', min: 1, max: 5 }, { id: 'c5_12', label: '5 to 12', min: 5, max: 13 }, { id: 'c13_plus', label: '13 or more', min: 13 }],
  },
  {
    id: 'equipmentRental', name: 'Equipment rental', source: 'serviceLine', type: 'yesNo', defaultValueId: 'no',
    description: 'The customer rents the container from the hauler instead of owning it',
    values: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
  },
  { id: 'gateCode', name: 'Gate code', source: 'site', type: 'text', description: 'Kept for the driver; never changes a price', values: [] },
]

// ---------- parties, accounts, sites, service items, containers ----------
const parties: Party[] = []
const accounts: BillingAccount[] = []
const sites: Site[] = []
const serviceItems: ServiceItem[] = []
const containers: Container[] = []
const contracts: Contract[] = []
const workOrders: WorkOrder[] = []
const requests: Request[] = []

let cartSerial = 10230
let flSerial = 450
function cart(id: string, catalogId: string, siteId: string, assignedFrom: string): string {
  cartSerial += 1
  containers.push({ id, serial: `C96-${cartSerial}`, catalogId, siteId, assignedFrom })
  return id
}
function flBox(id: string, catalogId: string, siteId: string, assignedFrom: string): string {
  flSerial += 1
  containers.push({ id, serial: `FL-${flSerial}`, catalogId, siteId, assignedFrom })
  return id
}

// Named accounts
parties.push({ id: 'party_maple', name: 'Ruth Maple', kind: 'homeowner' })
// Phase 3.7a (portal request 2): Maple's card on file (portal's saved Visa 4242), Oakridge's ACH below (ACH 6710).
accounts.push({ id: 'acct_res_maple', payerPartyId: 'party_maple', cycle: 'quarterly', billedInAdvance: true, autopay: false, paymentMethodOnFile: 'card', status: 'pastDue', deliveryMethod: 'mail', taxExempt: false })
sites.push({ id: 'site_maple', accountId: 'acct_res_maple', occupantPartyId: 'party_maple', address: '412 Maple Ave', zoneId: 'zone_open', routeId: 'route_mon_res', accessNotes: 'Carts at end of gravel drive' })
serviceItems.push({ id: 'si_maple_96', siteId: 'site_maple', catalogId: 'cat_res_96', qty: 1, frequency: 'weekly', containerIds: [cart('cart_maple_1', 'cat_res_96', 'site_maple', '2021-04-01')], effectiveFrom: '2021-04-01', status: 'active' })
serviceItems.push({ id: 'si_maple_extra', siteId: 'site_maple', catalogId: 'cat_res_extra_cart', qty: 1, frequency: 'weekly', containerIds: [cart('cart_maple_2', 'cat_res_extra_cart', 'site_maple', '2023-06-01')], effectiveFrom: '2023-06-01', status: 'active' })
serviceItems.push({ id: 'si_maple_recycling', siteId: 'site_maple', catalogId: 'cat_res_recycling', qty: 1, frequency: 'eow', containerIds: [cart('cart_maple_3', 'cat_res_recycling', 'site_maple', '2021-04-01')], effectiveFrom: '2021-04-01', status: 'active' })

parties.push({ id: 'party_holt', name: 'Gerald Holt', kind: 'homeowner' })
accounts.push({ id: 'acct_res_holt', payerPartyId: 'party_holt', cycle: 'quarterly', billedInAdvance: true, autopay: true, paymentMethodOnFile: 'card', status: 'hold', deliveryMethod: 'email', taxExempt: false })
sites.push({ id: 'site_holt', accountId: 'acct_res_holt', occupantPartyId: 'party_holt', address: '18 Holt Ridge Dr', zoneId: 'zone_open', routeId: 'route_mon_res' })
serviceItems.push({ id: 'si_holt_96', siteId: 'site_holt', catalogId: 'cat_res_96', qty: 1, frequency: 'weekly', containerIds: [cart('cart_holt_1', 'cat_res_96', 'site_holt', '2022-09-01')], effectiveFrom: '2022-09-01', status: 'active' })
requests.push({ id: 'req_holt_vacation', accountId: 'acct_res_holt', siteId: 'site_holt', kind: 'vacationHold', status: 'scheduled', createdVia: 'portal', note: 'Away Sep 1 to Sep 21, resume service Sep 28' })

parties.push({ id: 'party_kerr', name: 'Lena Kerr', kind: 'homeowner' })
accounts.push({ id: 'acct_res_kerr', payerPartyId: 'party_kerr', cycle: 'quarterly', billedInAdvance: true, autopay: false, status: 'suspended', deliveryMethod: 'mail', taxExempt: false })
sites.push({ id: 'site_kerr', accountId: 'acct_res_kerr', occupantPartyId: 'party_kerr', address: '77 Kerr Ln', zoneId: 'zone_open', routeId: 'route_tue_res' })
serviceItems.push({ id: 'si_kerr_96', siteId: 'site_kerr', catalogId: 'cat_res_96', qty: 1, frequency: 'weekly', containerIds: [cart('cart_kerr_1', 'cat_res_96', 'site_kerr', '2020-02-01')], effectiveFrom: '2020-02-01', status: 'active' })

parties.push({ id: 'party_bakery', name: 'Sunrise Bakery', kind: 'business' })
accounts.push({ id: 'acct_bakery', payerPartyId: 'party_bakery', cycle: 'monthly', billedInAdvance: true, autopay: false, status: 'active', deliveryMethod: 'email', taxExempt: false, contractId: 'contract_bakery' })
sites.push({ id: 'site_bakery', accountId: 'acct_bakery', occupantPartyId: 'party_bakery', address: '880 Commerce St', zoneId: 'zone_open', routeId: 'route_wed_fl', accessNotes: 'Enclosure behind loading dock, code 4410' })
serviceItems.push({ id: 'si_bakery_3yd', siteId: 'site_bakery', catalogId: 'cat_fl_3yd', qty: 1, frequency: '2x', containerIds: [flBox('fl_bakery_1', 'cat_fl_3yd', 'site_bakery', '2026-01-01')], effectiveFrom: '2026-01-01', status: 'active' })
serviceItems.push({ id: 'si_bakery_wood', siteId: 'site_bakery', catalogId: 'cat_fl_3yd_wood', qty: 1, frequency: '2x', containerIds: [flBox('fl_bakery_wood', 'cat_fl_3yd_wood', 'site_bakery', '2026-01-01')], effectiveFrom: '2026-01-01', status: 'active' })
contracts.push({
  id: 'contract_bakery', accountId: 'acct_bakery', termStart: '2026-01-01', termEnd: '2026-12-31', renewalNoticeDays: 60,
  overrides: [
    { catalogId: 'cat_fl_3yd', frequency: '2x', priceCents: 19800, reason: 'competitive match', pctBelowRateCard: 10 },
    { catalogId: 'cat_fl_3yd_wood', frequency: '2x', priceCents: 17100, reason: 'competitive match', pctBelowRateCard: 10 },
  ],
  escalator: { kind: 'fixedPct', pct: 4, anniversary: '2027-01-01' },
})

parties.push({ id: 'party_oakridge', name: 'Oakridge Property Group', kind: 'propertyManager' })
accounts.push({ id: 'acct_pm_oakridge', payerPartyId: 'party_oakridge', cycle: 'net30', billedInAdvance: true, autopay: false, paymentMethodOnFile: 'ach', status: 'active', deliveryMethod: 'email', taxExempt: true })
const oakBuildings = ['A', 'B', 'C', 'D']
oakBuildings.forEach((b, i) => {
  const n = i + 1
  const siteId = `site_oak_${n}`
  sites.push({ id: siteId, accountId: 'acct_pm_oakridge', address: `Oakridge Commons Bldg ${b}, 1500 Oakridge Pkwy`, zoneId: 'zone_open', routeId: 'route_wed_fl', poNumber: `PO-OAK-${b}${2026}` })
  serviceItems.push({ id: `si_oak_${n}`, siteId, catalogId: 'cat_fl_2yd', qty: 1, frequency: 'weekly', containerIds: [flBox(`fl_oak_${n}`, 'cat_fl_2yd', siteId, '2024-03-01')], effectiveFrom: '2024-03-01', status: 'active' })
})

parties.push({ id: 'party_hale', name: 'Hale Construction', kind: 'contractor' })
// Card on file, autopay off (box 4.5a): the office charges a posted invoice to it by hand, never automatically (invariant 7).
accounts.push({ id: 'acct_contractor_hale', payerPartyId: 'party_hale', cycle: 'net30', billedInAdvance: false, autopay: false, paymentMethodOnFile: 'card', status: 'active', deliveryMethod: 'email', taxExempt: false })
sites.push({ id: 'site_hale_a', accountId: 'acct_contractor_hale', address: '2200 Industrial Pkwy, lot 4', zoneId: 'zone_open', routeId: 'route_thu_ro', poNumber: 'HALE-2200-L4' })
sites.push({ id: 'site_hale_b', accountId: 'acct_contractor_hale', address: '310 Elm St, teardown', zoneId: 'zone_open', routeId: 'route_thu_ro', poNumber: 'HALE-310-ELM', accessNotes: 'Box placed curbside, lumber deliveries Mon and Thu' })
const roBox = (id: string, siteId: string, assignedFrom: string) => { containers.push({ id, serial: `RO20-${id.slice(-4)}`, catalogId: 'cat_ro_20yd', siteId, assignedFrom }); return id }
serviceItems.push({ id: 'si_hale_1', siteId: 'site_hale_a', catalogId: 'cat_ro_20yd', qty: 1, frequency: 'onCall', containerIds: [roBox('box_2001', 'site_hale_a', '2026-08-18')], effectiveFrom: '2026-08-18', status: 'active' })
serviceItems.push({ id: 'si_hale_2', siteId: 'site_hale_b', catalogId: 'cat_ro_20yd', qty: 1, frequency: 'onCall', containerIds: [roBox('box_2002', 'site_hale_b', '2026-08-24')], effectiveFrom: '2026-08-24', status: 'active' })
serviceItems.push({ id: 'si_hale_3', siteId: 'site_hale_a', catalogId: 'cat_ro_20yd', qty: 1, frequency: 'onCall', containerIds: [roBox('box_2003', 'site_hale_a', '2026-08-18')], effectiveFrom: '2026-08-18', status: 'active' })

parties.push({ id: 'party_ro_home', name: 'Priya Natarajan', kind: 'homeowner' })
accounts.push({ id: 'acct_ro_homeowner', payerPartyId: 'party_ro_home', cycle: 'perJob', billedInAdvance: true, autopay: false, paymentMethodOnFile: 'card', status: 'active', deliveryMethod: 'email', taxExempt: false })
sites.push({ id: 'site_ro_home', accountId: 'acct_ro_homeowner', occupantPartyId: 'party_ro_home', address: '59 Larkspur Ct', zoneId: 'zone_open', routeId: 'route_thu_ro', accessNotes: 'Box on driveway, plywood under rails' })
serviceItems.push({ id: 'si_ro_home', siteId: 'site_ro_home', catalogId: 'cat_ro_20yd', qty: 1, frequency: 'onCall', containerIds: [roBox('box_2004', 'site_ro_home', '2026-08-07')], effectiveFrom: '2026-08-07', status: 'active' })

// Generic residential accounts acct_res_001..030
const resNames = [
  'Alicia Brandt', 'Tomas Reyes', 'Marcy Whitlock', 'Devin Okafor', 'Helen Marsh', 'Curtis Lane', 'Priscilla Nguyen', 'Omar Haddad', 'Jeanette Cole', 'Walter Finch',
  'Sonia Petrov', 'Brian Talley', 'Yolanda Diaz', 'Grant Ellison', 'Kimberly Osei', 'Raymond Fitch', 'Nadia Karim', 'Elliot Barrow', 'Marisol Vega', 'Howard Pruitt',
  'Tessa Lindqvist', 'Frank Duval', 'Renee Castillo', 'Isaac Mbeki', 'Colleen Harper', 'Victor Salazar', 'Ingrid Sorensen', 'Miles Thornton', 'Bethany Roux', 'Leon Adeyemi',
]
const resStreets = ['Birch St', 'Cedar Ct', 'Dogwood Ln', 'Elm Way', 'Fern Dr', 'Hickory Rd', 'Juniper Ave', 'Laurel Pl', 'Magnolia Blvd', 'Poplar St']
const tenureFor = (i: number) => {
  const year = 2018 + ((i * 7) % 8)
  const month = ((i * 5) % 12) + 1
  return `${year}-${String(month).padStart(2, '0')}-01`
}
for (let i = 1; i <= 30; i++) {
  const n = pad3(i)
  const partyId = `party_res_${n}`
  const acctId = `acct_res_${n}`
  const siteId = `site_res_${n}`
  parties.push({ id: partyId, name: resNames[i - 1], kind: 'homeowner' })
  const autopay = i % 3 === 0
  const delivery: BillingAccount['deliveryMethod'] = i % 4 === 0 ? 'mail' : i % 4 === 2 ? 'portal' : 'email'
  accounts.push({
    id: acctId, payerPartyId: partyId, cycle: i <= 10 ? 'monthly' : 'quarterly', billedInAdvance: true, autopay,
    ...(autopay ? { paymentMethodOnFile: 'card' as const } : {}),
    status: i === 3 || i === 17 ? 'pastDue' : 'active', deliveryMethod: delivery, taxExempt: false,
  })
  sites.push({ id: siteId, accountId: acctId, occupantPartyId: partyId, address: `${100 + i * 7} ${resStreets[i % resStreets.length]}`, zoneId: 'zone_open', routeId: i % 2 === 1 ? 'route_mon_res' : 'route_tue_res' })
  // acct_res_002 started 2026-08-20 so its first invoice (Sep) carries the delivery fee
  const effectiveFrom = i === 2 ? '2026-08-20' : tenureFor(i)
  const mainCat = i % 5 === 0 ? 'cat_res_64' : 'cat_res_96'
  serviceItems.push({ id: `si_res_${n}_main`, siteId, catalogId: mainCat, qty: 1, frequency: 'weekly', containerIds: [cart(`cart_res_${n}_1`, mainCat, siteId, effectiveFrom)], effectiveFrom, status: 'active' })
  if (i % 4 === 0) {
    serviceItems.push({ id: `si_res_${n}_recycling`, siteId, catalogId: 'cat_res_recycling', qty: 1, frequency: 'eow', containerIds: [cart(`cart_res_${n}_2`, 'cat_res_recycling', siteId, effectiveFrom)], effectiveFrom, status: 'active' })
  }
  if (i === 7) {
    serviceItems.push({ id: 'si_res_007_extra', siteId, catalogId: 'cat_res_extra_cart', qty: 1, frequency: 'weekly', containerIds: [cart('cart_res_007_2', 'cat_res_extra_cart', siteId, '2026-09-15')], effectiveFrom: '2026-09-15', status: 'active' })
    workOrders.push({ id: 'wo_res_007_deliver', siteId, kind: 'deliver', status: 'done', scheduledFor: '2026-09-15', serviceItemId: 'si_res_007_extra', containerId: 'cart_res_007_2', requestId: 'req_res_007_cart', completedAt: '2026-09-15' })
    requests.push({ id: 'req_res_007_cart', accountId: acctId, siteId, kind: 'cartChange', status: 'done', createdVia: 'phone', workOrderId: 'wo_res_007_deliver', note: 'Add a second 96 gal cart' })
  }
}

// Generic frontload accounts acct_fl_001..008
const flNames = ['Harbor Dental Group', 'Pine Street Laundromat', 'Copperline Auto Body', 'Two Rivers Brewing', 'Meadowbrook Veterinary', 'Lantern Hill Bistro', 'Ridgeway Print Shop', 'Northgate Fitness']
const flStreets = ['Market St', 'Depot Rd', 'Foundry Ave', 'Mill Race Way']
for (let i = 1; i <= 8; i++) {
  const n = pad3(i)
  const partyId = `party_fl_${n}`
  const acctId = `acct_fl_${n}`
  const siteId = `site_fl_${n}`
  const even = i % 2 === 0
  parties.push({ id: partyId, name: flNames[i - 1], kind: 'business' })
  accounts.push({ id: acctId, payerPartyId: partyId, cycle: 'monthly', billedInAdvance: true, autopay: i % 4 === 0, ...(i % 4 === 0 ? { paymentMethodOnFile: 'ach' as const } : {}), status: 'active', deliveryMethod: 'email', taxExempt: false, ...(even ? { contractId: `contract_fl_${n}` } : {}) })
  sites.push({ id: siteId, accountId: acctId, occupantPartyId: partyId, address: `${200 + i * 15} ${flStreets[i % flStreets.length]}`, zoneId: 'zone_open', routeId: 'route_wed_fl' })
  const catalogId = even ? 'cat_fl_3yd' : 'cat_fl_2yd'
  const frequency: Frequency = even ? '2x' : 'weekly'
  const effectiveFrom = `${2023 + (i % 3)}-0${1 + (i % 6)}-01`
  serviceItems.push({ id: `si_fl_${n}`, siteId, catalogId, qty: 1, frequency, containerIds: [flBox(`fl_${n}`, catalogId, siteId, effectiveFrom)], effectiveFrom, status: 'active' })
  if (even) {
    contracts.push({
      id: `contract_fl_${n}`, accountId: acctId, termStart: '2026-01-01', termEnd: '2026-12-31', renewalNoticeDays: 60,
      overrides: [{ catalogId: 'cat_fl_3yd', frequency: '2x', priceCents: round(price('cat_fl_3yd') * 0.95), reason: 'renewal incentive', pctBelowRateCard: 5 }],
    })
  }
}

// ---------- routes ----------
const stopsFor = (routeId: string) => sites.filter(s => s.routeId === routeId).map(s => s.id)
const routes: Route[] = [
  { id: 'route_mon_res', day: 'Mon', lob: 'residential', stopSiteIds: stopsFor('route_mon_res'), capacityStops: 120 },
  { id: 'route_tue_res', day: 'Tue', lob: 'residential', stopSiteIds: stopsFor('route_tue_res'), capacityStops: 120 },
  { id: 'route_wed_fl', day: 'Wed', lob: 'frontload', stopSiteIds: stopsFor('route_wed_fl'), capacityStops: 60 },
  { id: 'route_thu_ro', day: 'Thu', lob: 'rolloff', stopSiteIds: stopsFor('route_thu_ro'), capacityStops: 24 },
]
const siteById = (id: string) => sites.find(s => s.id === id)!
const acctOfSite = (siteId: string) => siteById(siteId).accountId

// ---------- work orders and scale tickets ----------
workOrders.push({ id: 'wo_ro_home_deliver', siteId: 'site_ro_home', kind: 'deliver', status: 'done', scheduledFor: '2026-08-07', serviceItemId: 'si_ro_home', containerId: 'box_2004', completedAt: '2026-08-07' })
workOrders.push({ id: 'wo_hale_haul_1', siteId: 'site_hale_a', kind: 'dumpAndReturn', status: 'done', scheduledFor: '2026-09-03', serviceItemId: 'si_hale_1', containerId: 'box_2001', completedAt: '2026-09-03' })
workOrders.push({ id: 'wo_hale_haul_2', siteId: 'site_hale_b', kind: 'dumpAndReturn', status: 'done', scheduledFor: '2026-09-08', serviceItemId: 'si_hale_2', containerId: 'box_2002', completedAt: '2026-09-08' })
workOrders.push({ id: 'wo_hale_haul_3', siteId: 'site_hale_a', kind: 'dumpAndReturn', status: 'done', scheduledFor: '2026-09-01', serviceItemId: 'si_hale_3', containerId: 'box_2003', completedAt: '2026-09-01' })
const scaleTickets: ScaleTicket[] = [
  { id: 'ticket_hale_1', workOrderId: 'wo_hale_haul_1', containerId: 'box_2001', facility: 'Piedmont Transfer Station', material: 'C&D', grossLbs: 30400, tareLbs: 22000, netLbs: 8400, ticketedAt: '2026-09-03T14:22:00-04:00' },
  { id: 'ticket_hale_2', workOrderId: 'wo_hale_haul_2', containerId: 'box_2002', facility: 'Piedmont Transfer Station', material: 'C&D', grossLbs: 29100, tareLbs: 22000, netLbs: 7100, ticketedAt: '2026-09-08T11:05:00-04:00' },
  { id: 'ticket_hale_3', workOrderId: 'wo_hale_haul_3', containerId: 'box_2003', facility: 'Piedmont Transfer Station', material: 'C&D', grossLbs: 26900, tareLbs: 22000, netLbs: 4900, ticketedAt: '2026-09-01T15:40:00-04:00' },
]

// ---------- service events ----------
const drivers: Record<string, string> = { route_mon_res: 'Marcus Bell', route_tue_res: 'Tasha Green', route_wed_fl: 'Ray Ortiz', route_thu_ro: 'Dale Whitfield' }
const routeDays: Record<string, string[]> = {
  route_mon_res: ['2026-08-31', '2026-09-07'],
  route_tue_res: ['2026-09-01', '2026-09-08'],
  route_wed_fl: ['2026-09-02', '2026-09-09'],
  route_thu_ro: ['2026-08-27', '2026-09-03'],
}
type Exc = { id: string; siteId: string; date: string; exception: NonNullable<ServiceEvent['exception']>; outcome: ServiceEvent['outcome']; photoUrl?: string; note: string }
const exceptions: Exc[] = [
  { id: 'evt_maple_extrabags', siteId: 'site_maple', date: '2026-09-07', exception: 'extraBags', outcome: 'completed', photoUrl: '/evidence/maple-extra-bags.jpg', note: '3 bags beside cart, lid closed' },
  { id: 'evt_res014_overload', siteId: 'site_res_014', date: '2026-09-08', exception: 'overload', outcome: 'completed', photoUrl: '/evidence/res014-overload.jpg', note: 'Lid open 12 inches, construction debris' },
  { id: 'evt_fl003_dryrun', siteId: 'site_fl_003', date: '2026-09-02', exception: 'dryRun', outcome: 'blocked', note: 'Gate locked, no answer at door' },
  { id: 'evt_hale_dryrun', siteId: 'site_hale_b', date: '2026-09-03', exception: 'dryRun', outcome: 'blocked', photoUrl: '/evidence/hale-b-blocked.jpg', note: 'Box blocked by lumber delivery' },
  { id: 'evt_bakery_contam', siteId: 'site_bakery', date: '2026-09-09', exception: 'contamination', outcome: 'completed', photoUrl: '/evidence/bakery-wood-contamination.jpg', note: 'Plastic wrap and food waste in wood container' },
]
const serviceEvents: ServiceEvent[] = []
for (const route of routes) {
  for (const date of routeDays[route.id]) {
    for (const siteId of route.stopSiteIds) {
      const exc = exceptions.find(e => e.siteId === siteId && e.date === date)
      if (exc) {
        serviceEvents.push({ id: exc.id, siteId, routeId: route.id, date, outcome: exc.outcome, exception: exc.exception, ...(exc.photoUrl ? { photoUrl: exc.photoUrl } : {}), note: exc.note, driver: drivers[route.id] })
        continue
      }
      const suspended = acctOfSite(siteId) === 'acct_res_kerr'
      serviceEvents.push({ id: `evt_${date.replace(/-/g, '')}_${siteId}`, siteId, routeId: route.id, date, outcome: suspended ? 'skippedSuspended' : 'completed', ...(suspended ? { note: 'Account suspended, stop skipped' } : {}), driver: drivers[route.id] })
    }
  }
}
const missingExc = exceptions.filter(e => !serviceEvents.some(s => s.id === e.id))
if (missingExc.length) throw new Error('Exception events not placed on a route day: ' + missingExc.map(e => e.id).join(', '))

// Historical exception events that already have a charge (waived or posted). Outside the 14 day window.
type Hist = { id: string; siteId: string; date: string; exception: NonNullable<ServiceEvent['exception']>; outcome: ServiceEvent['outcome']; photoUrl?: string; note: string }
const historicalEvents: Hist[] = [
  { id: 'evt_hist_res012_extrabags', siteId: 'site_res_012', date: '2026-03-24', exception: 'extraBags', outcome: 'completed', photoUrl: '/evidence/res012-extra-bags-0324.jpg', note: '1 bag beside cart' },
  { id: 'evt_hist_bakery_dryrun', siteId: 'site_bakery', date: '2026-03-25', exception: 'dryRun', outcome: 'blocked', note: 'Arrived 5:40, enclosure not yet unlocked' },
  { id: 'evt_hist_res021_overload', siteId: 'site_res_021', date: '2026-06-22', exception: 'overload', outcome: 'completed', note: 'Lid open, no photo taken' },
  { id: 'evt_hist_fl005_dryrun', siteId: 'site_fl_005', date: '2026-06-17', exception: 'dryRun', outcome: 'blocked', photoUrl: '/evidence/fl005-blocked-0617.jpg', note: 'Delivery van parked in front of enclosure' },
  { id: 'evt_hist_res008_extrabags', siteId: 'site_res_008', date: '2026-08-25', exception: 'extraBags', outcome: 'completed', photoUrl: '/evidence/res008-extra-bags-0825.jpg', note: '2 bags beside cart after party' },
  { id: 'evt_hist_fl003_contam', siteId: 'site_fl_003', date: '2026-08-26', exception: 'contamination', outcome: 'completed', photoUrl: '/evidence/fl003-contamination-0826.jpg', note: 'Cardboard bales in trash container' },
  { id: 'evt_hist_fl004_contam', siteId: 'site_fl_004', date: '2026-08-19', exception: 'contamination', outcome: 'completed', photoUrl: '/evidence/fl004-contamination-0819.jpg', note: 'Grease drums in container' },
]
for (const h of historicalEvents) {
  const routeId = siteById(h.siteId).routeId!
  serviceEvents.push({ id: h.id, siteId: h.siteId, routeId, date: h.date, outcome: h.outcome, exception: h.exception, ...(h.photoUrl ? { photoUrl: h.photoUrl } : {}), note: h.note, driver: drivers[routeId] })
}

// Phase 3.7a (portal request 1): Maple's two non-billable field events, for portal/RUNBOOK.md scenario 2 (a blocked
// stop with the driver's photo, then a real miss that books a recovery). They carry no exception, so
// generateEventCharges ignores them and no billing figure moves. The driver and wording are the portal prototype's.
serviceEvents.push(
  { id: 'evt_maple_missed_0817', siteId: 'site_maple', routeId: 'route_mon_res', date: '2026-08-17', outcome: 'missed', note: 'Stop skipped, truck full, no photo', driver: 'R. Alvarez' },
  { id: 'evt_maple_blocked_0824', siteId: 'site_maple', routeId: 'route_mon_res', date: '2026-08-24', outcome: 'blocked', photoUrl: '/photos/blocked-driveway.svg', note: 'Cart blocked by a parked vehicle in the driveway', driver: 'R. Alvarez' },
)

// ---------- historical charges, invoices, waives ----------
const charges: Charge[] = []
const invoices: Invoice[] = []
const waivedCharges: WaivedCharge[] = []
const eventRates: Record<string, number> = { extraBags: 250, overload: 1000, contamination: 2000, dryRun: 2500, extraPickup: 2500 }
const exceptionLabel: Record<string, string> = { extraBags: 'Extra bags', overload: 'Overloaded cart', contamination: 'Contamination', dryRun: 'Dry run' }

function recurringCharge(id: string, siteId: string, catalogId: string, frequency: Frequency, months: number, period: { start: string; end: string }, serviceItemId: string, status: Charge['status']): Charge {
  const accountId = acctOfSite(siteId)
  const account = accounts.find(a => a.id === accountId)!
  const contract = account.contractId ? contracts.find(c => c.id === account.contractId) : undefined
  const override = contract?.overrides.find(o => o.catalogId === catalogId && (!o.frequency || o.frequency === frequency))
  const version = rvFor(catalogId)
  const unit = override ? override.priceCents : version.priceCents
  const baseCents = unit * months
  const fuel = round(baseCents * FUEL_PCT / 100)
  // Addendum C5: the flat environmental fee applies once per whole month in the period (a quarter takes it three times).
  const env = ENV_FLAT * months
  const fees = [{ feeRuleId: 'fee_fuel_7pct', cents: fuel }, { feeRuleId: 'fee_env_1', cents: env }]
  const taxCents = account.taxExempt ? 0 : round((baseCents + fuel) * TAX_PCT / 100)
  const freqLabel = frequency === '2x' ? '2x weekly' : frequency === 'eow' ? 'every other week' : frequency
  return {
    id, accountId, siteId, lineType: 'recurring', catalogId,
    description: `${catName(catalogId)}, ${freqLabel}, ${short(period.start)} to ${short(period.end)}`,
    source: { type: 'serviceItem', id: serviceItemId }, period, baseCents, fees, taxCents,
    totalCents: baseCents + fuel + env + taxCents,
    pricing: override ? { contractId: contract!.id, ruleWon: 'contractOverride' } : { rateVersionId: version.id, ruleWon: 'zoneRate' },
    status, evidenceIds: [serviceItemId],
  }
}
function eventCharge(id: string, ev: Hist, status: Charge['status']): Charge {
  const accountId = acctOfSite(ev.siteId)
  const account = accounts.find(a => a.id === accountId)!
  const baseCents = eventRates[ev.exception]
  const fuel = round(baseCents * FUEL_PCT / 100)
  const taxCents = account.taxExempt ? 0 : round((baseCents + fuel) * TAX_PCT / 100)
  return {
    id, accountId, siteId: ev.siteId, lineType: 'event', description: `${exceptionLabel[ev.exception]}, ${short(ev.date)}`,
    source: { type: 'serviceEvent', id: ev.id }, servicedOn: ev.date, baseCents, fees: [{ feeRuleId: 'fee_fuel_7pct', cents: fuel }], taxCents,
    totalCents: baseCents + fuel + taxCents, pricing: { ruleWon: 'standardRate' }, status, evidenceIds: [ev.id],
  }
}
function feeCharge(id: string, siteId: string, description: string, baseCents: number, servicedOn: string, sourceId: string, status: Charge['status']): Charge {
  const accountId = acctOfSite(siteId)
  const account = accounts.find(a => a.id === accountId)!
  const taxCents = account.taxExempt ? 0 : round(baseCents * TAX_PCT / 100)
  return {
    id, accountId, siteId, lineType: 'fee', description, source: { type: 'manual', id: sourceId }, servicedOn, baseCents, fees: [], taxCents,
    totalCents: baseCents + taxCents, pricing: { ruleWon: 'standardRate' }, status, evidenceIds: [sourceId],
  }
}
function rolloffHaulCharge(id: string, siteId: string, serviceItemId: string, servicedOn: string, status: Charge['status']): Charge {
  const accountId = acctOfSite(siteId)
  const baseCents = price('cat_ro_20yd')
  const fuel = round(baseCents * FUEL_PCT / 100)
  const taxCents = round((baseCents + fuel) * TAX_PCT / 100)
  return {
    id, accountId, siteId, lineType: 'event', catalogId: 'cat_ro_20yd', description: `20 yd rolloff haul, 3 t and 30 days included, ${short(servicedOn)}`,
    source: { type: 'serviceItem', id: serviceItemId }, servicedOn, baseCents, fees: [{ feeRuleId: 'fee_fuel_7pct', cents: fuel }], taxCents,
    totalCents: baseCents + fuel + taxCents, pricing: { rateVersionId: rvFor('cat_ro_20yd').id, ruleWon: 'zoneRate' }, status, evidenceIds: [serviceItemId],
  }
}

type PendingInvoice = { id: string; accountId: string; chargeIds: string[]; issuedAt: string }
const pending: PendingInvoice[] = []
function invoiceFor(id: string, accountId: string, issuedAt: string, lines: Charge[]) {
  for (const c of lines) {
    if (c.accountId !== accountId) throw new Error(`Charge ${c.id} is not on account ${accountId}`)
    if (c.status !== 'posted') throw new Error(`Charge ${c.id} on invoice ${id} must be posted`)
    charges.push(c)
  }
  pending.push({ id, accountId, chargeIds: lines.map(c => c.id), issuedAt })
}
const mainItem = (siteId: string) => serviceItems.find(s => s.siteId === siteId && s.id.endsWith('_main'))!
const recyclingItem = (siteId: string) => serviceItems.find(s => s.siteId === siteId && s.catalogId === 'cat_res_recycling')

// Residential monthly invoice for a generic account and month (ym like 2026-09)
function resMonthlyInvoice(n: string, ym: string, extras: Charge[] = []) {
  const acct = `acct_res_${n}`
  const siteId = `site_res_${n}`
  const period = monthPeriod(ym)
  const tag = `res_${n}_${ym.replace('-', '_')}`
  const item = mainItem(siteId)
  const lines = [recurringCharge(`chg_${tag}_1`, siteId, item.catalogId, 'weekly', 1, period, item.id, 'posted')]
  const rec = recyclingItem(siteId)
  if (rec) lines.push(recurringCharge(`chg_${tag}_2`, siteId, 'cat_res_recycling', 'eow', 1, period, rec.id, 'posted'))
  lines.push(...extras)
  invoiceFor(`inv_${tag}`, acct, period.start, lines)
  return `inv_${tag}`
}
function resQuarterInvoice(n: string, invoiceId?: string) {
  const acct = `acct_res_${n}`
  const siteId = `site_res_${n}`
  const tag = `res_${n}_2026q3`
  const item = mainItem(siteId)
  const lines = [recurringCharge(`chg_${tag}_1`, siteId, item.catalogId, 'weekly', 3, Q3, item.id, 'posted')]
  const rec = recyclingItem(siteId)
  if (rec) lines.push(recurringCharge(`chg_${tag}_2`, siteId, 'cat_res_recycling', 'eow', 3, Q3, rec.id, 'posted'))
  const id = invoiceId ?? `inv_${tag}`
  invoiceFor(id, acct, Q3.start, lines)
  return id
}
function flMonthlyInvoice(n: string, ym: string, extras: Charge[] = []) {
  const acct = `acct_fl_${n}`
  const siteId = `site_fl_${n}`
  const period = monthPeriod(ym)
  const tag = `fl_${n}_${ym.replace('-', '_')}`
  const item = serviceItems.find(s => s.siteId === siteId)!
  const lines = [recurringCharge(`chg_${tag}_1`, siteId, item.catalogId, item.frequency, 1, period, item.id, 'posted'), ...extras]
  invoiceFor(`inv_${tag}`, acct, period.start, lines)
  return `inv_${tag}`
}

// Oakridge: three monthly net30 invoices, one per month, four site lines each
for (const ym of ['2026-06', '2026-07', '2026-08']) {
  const period = monthPeriod(ym)
  const tag = `oak_${ym.replace('-', '_')}`
  const lines = [1, 2, 3, 4].map(k => recurringCharge(`chg_${tag}_${k}`, `site_oak_${k}`, 'cat_fl_2yd', 'weekly', 1, period, `si_oak_${k}`, 'posted'))
  invoiceFor(`inv_${tag}`, 'acct_pm_oakridge', period.start, lines)
}

// Maple Q3, partially paid so 8745 remains open
invoiceFor('inv_maple_2026q3', 'acct_res_maple', Q3.start, [
  recurringCharge('chg_maple_2026q3_1', 'site_maple', 'cat_res_96', 'weekly', 3, Q3, 'si_maple_96', 'posted'),
  recurringCharge('chg_maple_2026q3_2', 'site_maple', 'cat_res_extra_cart', 'weekly', 3, Q3, 'si_maple_extra', 'posted'),
  recurringCharge('chg_maple_2026q3_3', 'site_maple', 'cat_res_recycling', 'eow', 3, Q3, 'si_maple_recycling', 'posted'),
])

// Past due accounts with open invoices
resQuarterInvoice('017', 'inv_res_017')
resMonthlyInvoice('003', '2026-08')
resMonthlyInvoice('003', '2026-09')

// Rolloff homeowner prepaid haul plus delivery, paid by card on delivery day
invoiceFor('inv_ro_home_2026_08', 'acct_ro_homeowner', '2026-08-07', [
  rolloffHaulCharge('chg_ro_home_2026_08_1', 'site_ro_home', 'si_ro_home', '2026-08-07', 'posted'),
  feeCharge('chg_ro_home_2026_08_2', 'site_ro_home', 'Delivery fee, 20 yd box', zones[0].deliveryFeeCents, '2026-08-07', 'wo_ro_home_deliver', 'posted'),
])

// The 14 invoices paid in batch_0908
const histById = (id: string) => historicalEvents.find(h => h.id === id)!
const batchInvoiceIds: string[] = [
  resMonthlyInvoice('001', '2026-09'),
  resMonthlyInvoice('002', '2026-09', [feeCharge('chg_res_002_2026_09_fee', 'site_res_002', 'Delivery fee, 96 gal cart', zones[0].deliveryFeeCents, '2026-08-20', 'si_res_002_main', 'posted')]),
  resMonthlyInvoice('006', '2026-09'),
  resMonthlyInvoice('007', '2026-09'),
  resMonthlyInvoice('009', '2026-09'),
  resMonthlyInvoice('004', '2026-09'),
  resMonthlyInvoice('008', '2026-09'),
  resQuarterInvoice('015'),
  resQuarterInvoice('025'),
  resQuarterInvoice('030'),
  resQuarterInvoice('020'),
  flMonthlyInvoice('002', '2026-09'),
  flMonthlyInvoice('004', '2026-09', [eventCharge('chg_fl_004_2026_09_evt', histById('evt_hist_fl004_contam'), 'posted')]),
  resQuarterInvoice('011'),
]

// Waived historical charges (never on an invoice). Six rows over three cycles.
const waives: { chargeId: string; eventId: string; reason: WaivedCharge['reason']; note: string; at: string }[] = [
  { chargeId: 'chg_waived_res012_0324', eventId: 'evt_hist_res012_extrabags', reason: 'immaterial', note: 'One bag, long tenure customer', at: '2026-04-02T09:15:00-04:00' },
  { chargeId: 'chg_waived_bakery_0325', eventId: 'evt_hist_bakery_dryrun', reason: 'operationalFault', note: 'Driver arrived before the agreed 6am window', at: '2026-04-03T10:40:00-04:00' },
  { chargeId: 'chg_waived_res021_0622', eventId: 'evt_hist_res021_overload', reason: 'insufficientEvidence', note: 'No photo on the event', at: '2026-07-02T08:50:00-04:00' },
  { chargeId: 'chg_waived_fl005_0617', eventId: 'evt_hist_fl005_dryrun', reason: 'goodwill', note: 'First dry run on the account, called and coached', at: '2026-07-02T11:20:00-04:00' },
  { chargeId: 'chg_waived_res008_0825', eventId: 'evt_hist_res008_extrabags', reason: 'immaterial', note: 'Under one dollar of margin, no dispute worth having', at: '2026-09-02T09:05:00-04:00' },
  { chargeId: 'chg_waived_fl003_0826', eventId: 'evt_hist_fl003_contam', reason: 'operationalFault', note: 'Shared enclosure, cardboard came from the neighbor', at: '2026-09-03T14:10:00-04:00' },
]
for (const w of waives) {
  charges.push(eventCharge(w.chargeId, histById(w.eventId), 'waived'))
  waivedCharges.push({ chargeId: w.chargeId, reason: w.reason, note: w.note, by: 'M. Alvarez', at: w.at })
}

// Number and total the invoices in chronological order
pending.sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))
let seq = 200
for (const p of pending) {
  seq += 1
  const account = accounts.find(a => a.id === p.accountId)!
  const lines = p.chargeIds.map(id => charges.find(c => c.id === id)!)
  const subtotalCents = lines.reduce((s, c) => s + c.baseCents, 0)
  const feeCents = lines.reduce((s, c) => s + c.fees.reduce((f, x) => f + x.cents, 0), 0)
  const taxCents = lines.reduce((s, c) => s + c.taxCents, 0)
  const totalCents = subtotalCents + feeCents + taxCents
  if (totalCents !== lines.reduce((s, c) => s + c.totalCents, 0)) throw new Error(`Invoice ${p.id} parts do not add up`)
  invoices.push({
    id: p.id, accountId: p.accountId, number: `INV-2026-${String(seq).padStart(4, '0')}`, chargeIds: p.chargeIds,
    subtotalCents, feeCents, taxCents, totalCents, issuedAt: p.issuedAt,
    dueAt: addDays(p.issuedAt, account.cycle === 'net30' ? 30 : 15), postedAt: p.issuedAt, locked: true, deliveredVia: account.deliveryMethod,
  })
}
const invById = (id: string) => invoices.find(i => i.id === id)!

// ---------- payments, batches, allocations ----------
const payments: Payment[] = []
const allocations: PaymentAllocation[] = []

// Oakridge check covering three invoices in full
const oakInvoices = ['inv_oak_2026_06', 'inv_oak_2026_07', 'inv_oak_2026_08']
const oakTotal = oakInvoices.reduce((s, id) => s + invById(id).totalCents, 0)
payments.push({ id: 'pay_chk_oakridge', accountId: 'acct_pm_oakridge', method: 'check', cents: oakTotal, receivedAt: '2026-09-04', status: 'settled' })
for (const id of oakInvoices) allocations.push({ sourceType: 'payment', sourceId: 'pay_chk_oakridge', invoiceId: id, cents: invById(id).totalCents })

// Maple partial payment leaving exactly 8745 open
const mapleOpen = 8745
const mapleInv = invById('inv_maple_2026q3')
payments.push({ id: 'pay_card_maple_0720', accountId: 'acct_res_maple', method: 'card', cents: mapleInv.totalCents - mapleOpen, receivedAt: '2026-07-20', status: 'settled' })
allocations.push({ sourceType: 'payment', sourceId: 'pay_card_maple_0720', invoiceId: 'inv_maple_2026q3', cents: mapleInv.totalCents - mapleOpen })

// Rolloff homeowner prepaid on the card on file
const roInv = invById('inv_ro_home_2026_08')
payments.push({ id: 'pay_card_ro_home_0807', accountId: 'acct_ro_homeowner', method: 'card', cents: roInv.totalCents, receivedAt: '2026-08-07', status: 'settled' })
allocations.push({ sourceType: 'payment', sourceId: 'pay_card_ro_home_0807', invoiceId: 'inv_ro_home_2026_08', cents: roInv.totalCents })

// Processor batch of 14 card payments; pay_card_014 overpays by 1530.
// Addendum C5 raised every quarterly invoice (env 300 per quarterly line instead of 100), so the invoices in
// the batch now total more than 131842 - 1530. The gross is a contract target, so one payment bends instead:
// SHORT_PAY_INVOICE is short paid by exactly the difference and keeps that amount open (DECISIONS.md entry 29).
const OVERPAY = 1530
const BATCH_GROSS = 131842
const SHORT_PAY_INVOICE = 'inv_res_020_2026q3'
const batchInvoiceTotal = batchInvoiceIds.reduce((s, id) => s + invById(id).totalCents, 0)
const shortfall = batchInvoiceTotal + OVERPAY - BATCH_GROSS
if (shortfall < 0) throw new Error(`batch invoices total ${batchInvoiceTotal}, too little to reach gross ${BATCH_GROSS}`)
if (!batchInvoiceIds.includes(SHORT_PAY_INVOICE)) throw new Error(`${SHORT_PAY_INVOICE} is not in the batch`)
if (shortfall >= invById(SHORT_PAY_INVOICE).totalCents) throw new Error(`shortfall ${shortfall} would wipe out ${SHORT_PAY_INVOICE}`)
const batchPaymentIds: string[] = []
batchInvoiceIds.forEach((invoiceId, i) => {
  const inv = invById(invoiceId)
  const n = i + 1
  const payId = `pay_card_${pad3(n)}`
  const short = invoiceId === SHORT_PAY_INVOICE ? shortfall : 0
  const cents = inv.totalCents - short + (n === 14 ? OVERPAY : 0)
  payments.push({ id: payId, accountId: inv.accountId, method: 'card', cents, receivedAt: '2026-09-08', processorBatchId: 'batch_0908', status: 'settled' })
  allocations.push({ sourceType: 'payment', sourceId: payId, invoiceId, cents: inv.totalCents - short })
  batchPaymentIds.push(payId)
})
const grossCents = batchPaymentIds.reduce((s, id) => s + payments.find(p => p.id === id)!.cents, 0)
if (grossCents !== BATCH_GROSS) throw new Error(`batch_0908 gross is ${grossCents}, expected ${BATCH_GROSS}`)
const processorBatches: ProcessorBatch[] = [{ id: 'batch_0908', depositedAt: '2026-09-08', grossCents, feeCents: 4120, netCents: grossCents - 4120, paymentIds: batchPaymentIds }]

// Unmatched check on a past due account, not yet applied
payments.push({ id: 'pay_chk_unknown', accountId: 'acct_res_017', method: 'check', cents: 6500, receivedAt: '2026-09-09', status: 'settled' })

const creditMemos: CreditMemo[] = []

// ---------- quotes ----------
// quote_held_ridge (Phase 3.7c, storefront request R4, addendum D6): the storefront's boundary-branch address
// (addresses.json addr_boundary), its saved card token (the storefront's tok_ridge_4242 sidecar), and totals the
// canonical engine computes for the preserved line, exactly as the storefront's checkout does: a quarterly first
// period from the intake's Sep 15 start, ending Dec 14 inclusive (Phase 3.2b), plus the zone's delivery fee the day
// before. The quote has no account yet, so the engine prices it against a scratch Db with a provisional account and
// site in the quote's zone, as the storefront's withProvisionalSite does.
const RIDGE = { address: '1180 Ridge Hollow Rd, Piedmont, GA 30512', zoneId: 'zone_boundary', routeId: 'route_tue_res', startDate: '2026-09-15', catalogId: 'cat_res_96', frequency: 'weekly' as Frequency }
const ridgeDb: Db = {
  hauler, zones, routes, catalog, containers, parties, serviceItems, rateVersions, feeRules, taxRules, contracts, workOrders, serviceEvents, scaleTickets, requests,
  billingGroups: [],
  rolloffMaterials, rolloffRates, rolloffPolicy, serviceCategories, pricingDimensions,
  accounts: [...accounts, { id: 'acct_quote_ridge', payerPartyId: 'party_quote_ridge', cycle: 'quarterly', billedInAdvance: true, autopay: false, status: 'active', deliveryMethod: 'email', taxExempt: false }],
  sites: [...sites, { id: 'site_quote_ridge', accountId: 'acct_quote_ridge', address: RIDGE.address, zoneId: RIDGE.zoneId, routeId: RIDGE.routeId }],
  quotes: [], charges: [], waivedCharges: [], invoices: [], creditMemos: [], payments: [], allocations: [], processorBatches: [],
}
const ridgePrice = resolvePrice({ catalogId: RIDGE.catalogId, frequency: RIDGE.frequency, zoneId: RIDGE.zoneId, accountId: 'acct_quote_ridge', onDate: RIDGE.startDate }, ridgeDb)
const ridgePeriod = { start: RIDGE.startDate, end: addDays(addMonths(RIDGE.startDate, 3), -1) }
const ridgeRecurring = computeCharge({
  id: 'chg_quote_ridge_recurring', accountId: 'acct_quote_ridge', siteId: 'site_quote_ridge', lineType: 'recurring', catalogId: RIDGE.catalogId, frequency: RIDGE.frequency,
  baseCents: ridgePrice.priceCents * 3, period: ridgePeriod, source: { type: 'serviceItem', id: 'quote_held_ridge' },
  pricing: { ruleWon: ridgePrice.ruleWon, ...(ridgePrice.rateVersionId ? { rateVersionId: ridgePrice.rateVersionId } : {}) },
}, ridgeDb)
const ridgeDelivery = computeCharge({
  id: 'chg_quote_ridge_delivery', accountId: 'acct_quote_ridge', siteId: 'site_quote_ridge', lineType: 'fee', catalogId: RIDGE.catalogId,
  baseCents: zones.find(z => z.id === RIDGE.zoneId)!.deliveryFeeCents, servicedOn: addDays(RIDGE.startDate, -1), source: { type: 'serviceItem', id: 'quote_held_ridge' },
  pricing: { ruleWon: 'zoneRate' },
}, ridgeDb)
const quotes: Quote[] = [
  {
    id: 'quote_held_ridge', kind: 'residentialSignup', address: RIDGE.address, zoneId: RIDGE.zoneId,
    lines: [{ catalogId: RIDGE.catalogId, qty: 1, frequency: RIDGE.frequency, priceCents: ridgePrice.priceCents }],
    dueTodayCents: ridgeRecurring.totalCents + ridgeDelivery.totalCents, recurringCents: ridgeRecurring.totalCents, status: 'held',
    holdReason: 'confirm private road access', holdDeadline: '2026-09-11T10:00:00-04:00', expiresAt: '2026-09-17T23:59:59-04:00',
    paymentTokenId: 'tok_ridge_4242', createdVia: 'storefront',
  },
  {
    id: 'quote_bakery_request', kind: 'commercialRequest', address: '880 Commerce St', zoneId: 'zone_open',
    lines: [{ catalogId: 'cat_fl_3yd', qty: 1, frequency: '3x', priceCents: 0 }],
    dueTodayCents: 0, recurringCents: 0, status: 'draft', expiresAt: '2026-10-10T23:59:59-04:00', createdVia: 'storefront',
  },
]
requests.push({ id: 'req_bakery_quote', accountId: 'acct_bakery', siteId: 'site_bakery', kind: 'quote', status: 'open', createdVia: 'storefront', note: 'Asked about moving the 3 yd to 3x weekly for the holiday season' })

// ---------- site distance and density (location pricing, DECISIONS.md entry 64) ----------
// Road miles from the yard at 2200 Industrial Pkwy and the hauler's own stops within a quarter mile. Every named demo
// site sits inside the standard band with fewer than eight neighbors, so no seeded figure or scenario moves. A few
// generic sites land in a remote band or a dense street, so the Location tab has real sites to show.
const NAMED_GEO: Record<string, [number, number]> = {
  site_maple: [6.2, 3], site_holt: [7.8, 2], site_kerr: [4.1, 5], site_bakery: [3.2, 1],
  site_oak_1: [5.5, 3], site_oak_2: [5.5, 3], site_oak_3: [5.6, 3], site_oak_4: [5.6, 3],
  site_hale_a: [1.4, 0], site_hale_b: [9.6, 2], site_ro_home: [12.3, 1],
}
const REMOTE: Record<string, number> = { site_res_016: 34.2, site_res_021: 31.5, site_res_023: 28.7, site_res_026: 43.8, site_fl_007: 27.4 }
const DENSE: Record<string, number> = { site_res_003: 9, site_res_007: 10, site_res_009: 8, site_res_013: 12, site_res_015: 8 }
for (const site of sites) {
  const named = NAMED_GEO[site.id]
  const n = Number(site.id.slice(-3)) || 0
  site.milesFromYard = named?.[0] ?? REMOTE[site.id] ?? Number((3 + ((n * 37) % 190) / 10).toFixed(1))
  site.neighborStops = named?.[1] ?? DENSE[site.id] ?? (REMOTE[site.id] ? 0 : (n * 3) % 7)
}

// Coordinates and zones drawn on the map (DECISIONS.md entry 69). The yard at 2200 Industrial Pkwy is in Piedmont, GA.
// Each site sits on a bearing spread by its id at about 80% of its road miles (the straight line), and city franchise
// sites sit in Ashford, north east of town. Only drawn zones read coordinates, and no seeded rate or rule is keyed by
// one, so no figure moves.
const YARD: [number, number] = [34.8762, -83.9581]
const MI_LAT = 69
const MI_LNG = 69 * Math.cos((YARD[0] * Math.PI) / 180)
const round6 = (x: number) => Math.round(x * 1e6) / 1e6
/** The point x miles east and y miles north of a center. */
const at = (center: [number, number], x: number, y: number): [number, number] => [round6(center[0] + y / MI_LAT), round6(center[1] + x / MI_LNG)]
const ASHFORD = at(YARD, 7.6, 5.4)
const DOWNTOWN = at(YARD, -1.6, 0.9)
const hashOf = (id: string) => [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7)
/** A rounded outline around a center, a little irregular so it reads as a drawn boundary. */
const outline = (center: [number, number], radiusMi: number, sides: number, wobble: number): [number, number][] =>
  Array.from({ length: sides }, (_, i) => {
    const a = (2 * Math.PI * i) / sides
    const r = radiusMi * (1 + wobble * Math.sin(3 * a + 0.7))
    return at(center, r * Math.sin(a), r * Math.cos(a))
  })
for (const site of sites) {
  const h = hashOf(site.id)
  const bearing = ((h % 360) * Math.PI) / 180
  const miles = site.zoneId === 'zone_franchise' ? 0.4 + (h % 22) / 10 : (site.milesFromYard ?? 5) * 0.8
  const [lat, lng] = at(site.zoneId === 'zone_franchise' ? ASHFORD : YARD, miles * Math.sin(bearing), miles * Math.cos(bearing))
  site.lat = lat
  site.lng = lng
}
// List order is priority: where zones overlap, the first wins (downtown before the city around it).
const geoZones: import('../src/types').GeoZone[] = [
  { id: 'gz_ashford', name: 'Ashford', color: '#0EA5E9', description: 'Ashford town limits, served under the city franchise', polygon: outline(ASHFORD, 3.1, 12, 0.08) },
  { id: 'gz_downtown', name: 'Piedmont downtown', color: '#DB2777', description: 'The blocks around the square: tight streets, dense stops', polygon: outline(DOWNTOWN, 2.2, 10, 0.1) },
  { id: 'gz_piedmont', name: 'Piedmont city', color: '#6366F1', description: 'Piedmont city limits', polygon: outline(YARD, 9.5, 16, 0.12) },
  { id: 'gz_north_valley', name: 'North valley', color: '#16A34A', description: 'Farms and lake houses up the valley road', polygon: [at(YARD, -9, 8), at(YARD, 5, 9), at(YARD, 9, 24), at(YARD, -12, 22)] },
  { id: 'gz_east_county', name: 'East county', color: '#D97706', description: 'Rural stops past the county line road', polygon: [at(YARD, 9, -9), at(YARD, 30, -14), at(YARD, 33, 12), at(YARD, 12, 8)] },
]

// ---------- sanity checks ----------
const ids = new Set<string>()
for (const table of [parties, accounts, sites, serviceItems, containers, charges, invoices, payments, workOrders, serviceEvents, scaleTickets, quotes, requests, contracts, rateVersions]) {
  for (const row of table as { id: string }[]) {
    if (ids.has(row.id)) throw new Error(`Duplicate id ${row.id}`)
    ids.add(row.id)
  }
}
const invoiceNumbers = new Set(invoices.map(i => i.number))
if (invoiceNumbers.size !== invoices.length) throw new Error('Invoice numbers are not unique')
const balance = (invoiceId: string) => invById(invoiceId).totalCents - allocations.filter(a => a.invoiceId === invoiceId).reduce((s, a) => s + a.cents, 0)
if (balance('inv_maple_2026q3') !== 8745) throw new Error('Maple open balance is not 8745')
const unapplied014 = payments.find(p => p.id === 'pay_card_014')!.cents - allocations.filter(a => a.sourceId === 'pay_card_014').reduce((s, a) => s + a.cents, 0)
if (unapplied014 !== OVERPAY) throw new Error('pay_card_014 unapplied is not 1530')
if (new Set(batchInvoiceIds).size !== 14) throw new Error('Batch invoices are not distinct')
if (batchPaymentIds.length !== 14) throw new Error('batch_0908 must hold 14 payments')
if (processorBatches[0].netCents !== 127722) throw new Error(`batch_0908 net is ${processorBatches[0].netCents}, expected 127722`)
for (const id of oakInvoices) if (balance(id) !== 0) throw new Error(`Oakridge check does not cover ${id} in full`)
for (const c of charges) {
  if (c.lineType !== 'recurring' || !c.period) continue
  const env = c.fees.find(f => f.feeRuleId === 'fee_env_1')?.cents
  const months = (Number(c.period.end.slice(0, 4)) - Number(c.period.start.slice(0, 4))) * 12 + Number(c.period.end.slice(5, 7)) - Number(c.period.start.slice(5, 7)) + 1
  if (env !== ENV_FLAT * months) throw new Error(`${c.id} carries env ${env}, expected ${ENV_FLAT * months}`)
}
// ---------- billing groups ----------
// Customers billed together (addendum P). Every existing account keeps the dates it already billed on: the quarterly
// group starts its quarters in January (Jan, Apr, Jul, Oct, the old calendar) and both monthly groups bill on the 1st.
// The February group starts empty to show staggering. Net 30 and per-job accounts bill on their own terms, ungrouped.
const billingGroups: BillingGroup[] = [
  { id: 'grp_res_quarterly', name: 'Residential quarterly', schedule: { frequency: 'quarterly', every: 1, startDate: '2026-01-01' }, termsDays: 15, delivery: 'email', customerChoice: true, note: 'Homeowners billed every three months, in advance.' },
  { id: 'grp_res_quarterly_feb', name: 'Residential quarterly, February start', schedule: { frequency: 'quarterly', every: 1, startDate: '2026-02-01' }, termsDays: 15, delivery: 'email', customerChoice: true, note: 'Moves some quarterly customers a month later so the office is not billing everyone in the same week.' },
  { id: 'grp_res_monthly', name: 'Residential monthly', schedule: { frequency: 'monthly', every: 1, startDate: '2026-01-01' }, termsDays: 15, delivery: 'email', customerChoice: true, note: 'Homeowners who asked for a smaller monthly bill.' },
  { id: 'grp_commercial_monthly', name: 'Commercial monthly', schedule: { frequency: 'monthly', every: 1, startDate: '2026-01-01' }, termsDays: 15, delivery: 'email', customerChoice: true, note: 'Front load customers billed on the 1st.' },
]
for (const a of accounts) {
  if (a.cycle === 'quarterly') a.billingGroupId = 'grp_res_quarterly'
  else if (a.cycle === 'monthly') a.billingGroupId = a.id.startsWith('acct_res_') ? 'grp_res_monthly' : 'grp_commercial_monthly'
}

const text = JSON.stringify({ parties, sites, charges, waivedCharges, quotes, requests, serviceEvents })
if (/\u2014/.test(text)) throw new Error('Em dash found in seed strings')

// ---------- write ----------
mkdirSync(outDir, { recursive: true })
const tables: Record<string, unknown> = {
  hauler, zones, routes, catalog, containers, parties, accounts, billingGroups, sites, serviceItems, rateVersions, feeRules, taxRules, contracts,
  quotes, workOrders, serviceEvents, scaleTickets, charges, waivedCharges, invoices, creditMemos, payments, allocations, processorBatches, requests,
  rolloffMaterials, rolloffRates, rolloffPolicy, serviceCategories, pricingDimensions, geoZones,
}
for (const [name, rows] of Object.entries(tables)) {
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(rows, null, 2) + '\n')
}
writeFileSync(join(outDir, 'eventRates.json'), JSON.stringify(eventRates) + '\n')

console.log('Seed written to', outDir)
console.log({
  parties: parties.length, accounts: accounts.length, sites: sites.length, serviceItems: serviceItems.length, containers: containers.length,
  serviceEvents: serviceEvents.length, charges: charges.length, invoices: invoices.length, payments: payments.length, allocations: allocations.length,
  waivedCharges: waivedCharges.length, batchGross: grossCents, mapleBalance: balance('inv_maple_2026q3'), unapplied014,
  shortPay: { invoice: SHORT_PAY_INVOICE, cents: shortfall, open: balance(SHORT_PAY_INVOICE) },
})
