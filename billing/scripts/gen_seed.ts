/*
  Seed generator for the billing surface. Run with: npx tsx scripts/gen_seed.ts
  Writes every src/seed/*.json table deterministically. This file is the single source for the
  seed; edit it and re-run rather than hand editing the JSON.
  Money is integer cents. Dates are ISO strings. Today is 2026-09-10.
*/
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  BillingAccount, Charge, Container, Contract, CreditMemo, FeeRule, Hauler, Invoice, Party, Payment,
  PaymentAllocation, ProcessorBatch, Quote, RateVersion, Request, Route, ScaleTicket, ServiceCatalog,
  ServiceEvent, ServiceItem, Site, TaxRule, WaivedCharge, WorkOrder, Zone, Frequency,
} from '../src/types.ts'

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
]
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
  rv('rv_res_96_2026_boundary', 'cat_res_96', 'weekly', 2900, 'zone_boundary'),
  rv('rv_res_64_2026_boundary', 'cat_res_64', 'weekly', 2600, 'zone_boundary'),
  rv('rv_res_extra_2026_boundary', 'cat_res_extra_cart', 'weekly', 900, 'zone_boundary'),
  rv('rv_res_recycling_2026_boundary', 'cat_res_recycling', 'eow', 1200, 'zone_boundary'),
]
const rvFor = (catalogId: string) => rateVersions.find(r => r.catalogId === catalogId && r.zoneId === 'zone_open' && r.effectiveFrom === '2026-01-01')!
const price = (catalogId: string) => rvFor(catalogId).priceCents

// ---------- fee and tax rules ----------
const feeRules: FeeRule[] = [
  { id: 'fee_fuel_7pct', name: 'Fuel surcharge', kind: 'percent', value: 7, base: 'serviceLines', appliesTo: ['recurring', 'event'], taxable: true },
  { id: 'fee_env_1', name: 'Environmental fee', kind: 'flat', value: 100, base: 'serviceLines', appliesTo: ['recurring'], taxable: false },
]
const taxRules: TaxRule[] = [
  { id: 'tax_zone_open', zoneId: 'zone_open', ratePct: 7, appliesTo: ['recurring', 'event', 'fee'] },
  { id: 'tax_zone_boundary', zoneId: 'zone_boundary', ratePct: 7, appliesTo: ['recurring', 'event', 'fee'] },
  { id: 'tax_zone_franchise', zoneId: 'zone_franchise', ratePct: 7, appliesTo: ['recurring', 'event', 'fee'] },
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
accounts.push({ id: 'acct_res_maple', payerPartyId: 'party_maple', cycle: 'quarterly', billedInAdvance: true, autopay: false, status: 'pastDue', deliveryMethod: 'mail', taxExempt: false })
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
accounts.push({ id: 'acct_pm_oakridge', payerPartyId: 'party_oakridge', cycle: 'net30', billedInAdvance: true, autopay: false, status: 'active', deliveryMethod: 'email', taxExempt: true })
const oakBuildings = ['A', 'B', 'C', 'D']
oakBuildings.forEach((b, i) => {
  const n = i + 1
  const siteId = `site_oak_${n}`
  sites.push({ id: siteId, accountId: 'acct_pm_oakridge', address: `Oakridge Commons Bldg ${b}, 1500 Oakridge Pkwy`, zoneId: 'zone_open', routeId: 'route_wed_fl', poNumber: `PO-OAK-${b}${2026}` })
  serviceItems.push({ id: `si_oak_${n}`, siteId, catalogId: 'cat_fl_2yd', qty: 1, frequency: 'weekly', containerIds: [flBox(`fl_oak_${n}`, 'cat_fl_2yd', siteId, '2024-03-01')], effectiveFrom: '2024-03-01', status: 'active' })
})

parties.push({ id: 'party_hale', name: 'Hale Construction', kind: 'contractor' })
accounts.push({ id: 'acct_contractor_hale', payerPartyId: 'party_hale', cycle: 'net30', billedInAdvance: false, autopay: false, status: 'active', deliveryMethod: 'email', taxExempt: false })
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

// ---------- historical charges, invoices, waives ----------
const charges: Charge[] = []
const invoices: Invoice[] = []
const waivedCharges: WaivedCharge[] = []
const eventRates: Record<string, number> = { extraBags: 250, overload: 1000, contamination: 2000, dryRun: 2500 }
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
const quotes: Quote[] = [
  {
    id: 'quote_held_ridge', kind: 'residentialSignup', address: '17 Ridge Rd', zoneId: 'zone_boundary',
    lines: [{ catalogId: 'cat_res_96', qty: 1, frequency: 'weekly', priceCents: 2900 }],
    dueTodayCents: 2900 * 3 + zones[1].deliveryFeeCents, recurringCents: 2900, status: 'held',
    holdReason: 'confirm private road access', holdDeadline: '2026-09-11T10:00:00-04:00', expiresAt: '2026-09-17T23:59:59-04:00', createdVia: 'storefront',
  },
  {
    id: 'quote_bakery_request', kind: 'commercialRequest', address: '880 Commerce St', zoneId: 'zone_open',
    lines: [{ catalogId: 'cat_fl_3yd', qty: 1, frequency: '3x', priceCents: 0 }],
    dueTodayCents: 0, recurringCents: 0, status: 'draft', expiresAt: '2026-10-10T23:59:59-04:00', createdVia: 'storefront',
  },
]
requests.push({ id: 'req_bakery_quote', accountId: 'acct_bakery', siteId: 'site_bakery', kind: 'quote', status: 'open', createdVia: 'storefront', note: 'Asked about moving the 3 yd to 3x weekly for the holiday season' })

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
const text = JSON.stringify({ parties, sites, charges, waivedCharges, quotes, requests, serviceEvents })
if (/\u2014/.test(text)) throw new Error('Em dash found in seed strings')

// ---------- write ----------
mkdirSync(outDir, { recursive: true })
const tables: Record<string, unknown> = {
  hauler, zones, routes, catalog, containers, parties, accounts, sites, serviceItems, rateVersions, feeRules, taxRules, contracts,
  quotes, workOrders, serviceEvents, scaleTickets, charges, waivedCharges, invoices, creditMemos, payments, allocations, processorBatches, requests,
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
