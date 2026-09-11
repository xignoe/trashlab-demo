import type {
  BillingAccount, BillingGroup, Charge, Container, Contract, CreditMemo, FeeRule, Hauler, Invoice, Party, Payment, PaymentAllocation,
  ProcessorBatch, Quote, RateVersion, Request, RolloffMaterial, RolloffPolicy, RolloffRate, Route, ScaleTicket, ServiceCatalog,
  ServiceEvent, ServiceItem, Site, TaxRule, WaivedCharge, WorkOrder, Zone,
} from '../types'
import type { GeoZone, PricingDimension, ServiceCategory } from '../types'
import hauler from './hauler.json'
import zones from './zones.json'
import routes from './routes.json'
import catalog from './catalog.json'
import containers from './containers.json'
import parties from './parties.json'
import accounts from './accounts.json'
import billingGroups from './billingGroups.json'
import sites from './sites.json'
import serviceItems from './serviceItems.json'
import rateVersions from './rateVersions.json'
import feeRules from './feeRules.json'
import taxRules from './taxRules.json'
import contracts from './contracts.json'
import quotes from './quotes.json'
import workOrders from './workOrders.json'
import serviceEvents from './serviceEvents.json'
import scaleTickets from './scaleTickets.json'
import charges from './charges.json'
import waivedCharges from './waivedCharges.json'
import invoices from './invoices.json'
import creditMemos from './creditMemos.json'
import payments from './payments.json'
import allocations from './allocations.json'
import processorBatches from './processorBatches.json'
import requests from './requests.json'
import rolloffMaterials from './rolloffMaterials.json'
import rolloffRates from './rolloffRates.json'
import rolloffPolicy from './rolloffPolicy.json'
import serviceCategories from './serviceCategories.json'
import pricingDimensions from './pricingDimensions.json'
import geoZones from './geoZones.json'
import eventRates from './eventRates.json'
import addresses from './addresses.json'

/** One array per table. The store Db in Phase 2 is built from this shape. */
export interface Seed {
  hauler: Hauler[]
  zones: Zone[]
  routes: Route[]
  catalog: ServiceCatalog[]
  containers: Container[]
  parties: Party[]
  accounts: BillingAccount[]
  /** Customers billed together on one cadence and terms (BillingAccount.billingGroupId). */
  billingGroups: BillingGroup[]
  sites: Site[]
  serviceItems: ServiceItem[]
  rateVersions: RateVersion[]
  feeRules: FeeRule[]
  taxRules: TaxRule[]
  contracts: Contract[]
  quotes: Quote[]
  workOrders: WorkOrder[]
  serviceEvents: ServiceEvent[]
  scaleTickets: ScaleTicket[]
  charges: Charge[]
  waivedCharges: WaivedCharge[]
  invoices: Invoice[]
  creditMemos: CreditMemo[]
  payments: Payment[]
  allocations: PaymentAllocation[]
  processorBatches: ProcessorBatch[]
  requests: Request[]
  /** Pricing's roll-off model: materials, the size by material matrix, and the one-row hauler policy. */
  rolloffMaterials: RolloffMaterial[]
  rolloffRates: RolloffRate[]
  rolloffPolicy: RolloffPolicy[]
  /** Pricing configuration (DECISIONS.md entry 65): the owner's service categories and pricing dimensions. */
  serviceCategories: ServiceCategory[]
  pricingDimensions: PricingDimension[]
  /** Zones drawn on the map (DECISIONS.md entry 69), in priority order. */
  geoZones: GeoZone[]
}

/**
 * Flat per-event rates in cents, keyed by ServiceEvent exception, plus extraPickup (addendum B4, K6). The engine
 * types the four billable exceptions in engine.ts; extraPickup is read by the portal's extra pickup request.
 */
export const EVENT_RATES = eventRates as Record<string, number>

export const seed: Seed = {
  hauler: hauler as Hauler[],
  zones: zones as Zone[],
  routes: routes as Route[],
  catalog: catalog as ServiceCatalog[],
  containers: containers as Container[],
  parties: parties as Party[],
  accounts: accounts as BillingAccount[],
  billingGroups: billingGroups as BillingGroup[],
  sites: sites as Site[],
  serviceItems: serviceItems as ServiceItem[],
  rateVersions: rateVersions as RateVersion[],
  feeRules: feeRules as FeeRule[],
  taxRules: taxRules as TaxRule[],
  contracts: contracts as Contract[],
  quotes: quotes as Quote[],
  workOrders: workOrders as WorkOrder[],
  serviceEvents: serviceEvents as ServiceEvent[],
  scaleTickets: scaleTickets as ScaleTicket[],
  charges: charges as Charge[],
  waivedCharges: waivedCharges as WaivedCharge[],
  invoices: invoices as Invoice[],
  creditMemos: creditMemos as CreditMemo[],
  payments: payments as Payment[],
  allocations: allocations as PaymentAllocation[],
  processorBatches: processorBatches as ProcessorBatch[],
  requests: requests as Request[],
  rolloffMaterials: rolloffMaterials as RolloffMaterial[],
  rolloffRates: rolloffRates as RolloffRate[],
  rolloffPolicy: rolloffPolicy as RolloffPolicy[],
  serviceCategories: serviceCategories as ServiceCategory[],
  pricingDimensions: pricingDimensions as PricingDimension[],
  geoZones: geoZones as GeoZone[],
}

/** Deep clone so callers can mutate freely without touching the module level seed. */
export function loadSeed(): Seed {
  return structuredClone(seed)
}

/**
 * Storefront-local address book (addendum B3), copied from storefront/src/seed/addresses.json. It is not a Db table:
 * it is never part of Seed, never in the store's db, and nothing writes it. The storefront's address matcher reads it.
 */
export interface SeedAddress {
  id: string
  label: string
  line1: string
  city: string
  state: string
  zip: string
  zoneId: string
  routeId?: string
  franchiseHolder?: string
  boundaryReason?: string
}

export const ADDRESSES: readonly SeedAddress[] = addresses as SeedAddress[]

export { resolvePhoto, PHOTO_FILES } from './photos'
