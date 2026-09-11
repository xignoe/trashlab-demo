import type {
  BillingAccount, Charge, Container, Contract, CreditMemo, FeeRule, Hauler, Invoice, Party, Payment, PaymentAllocation,
  ProcessorBatch, Quote, RateVersion, Request, Route, ScaleTicket, ServiceCatalog, ServiceEvent, ServiceItem, Site, TaxRule,
  WaivedCharge, WorkOrder, Zone,
} from '../types'
import hauler from './hauler.json'
import zones from './zones.json'
import routes from './routes.json'
import catalog from './catalog.json'
import containers from './containers.json'
import parties from './parties.json'
import accounts from './accounts.json'
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
import eventRates from './eventRates.json'

/** One array per table. The store Db in Phase 2 is built from this shape. */
export interface Seed {
  hauler: Hauler[]
  zones: Zone[]
  routes: Route[]
  catalog: ServiceCatalog[]
  containers: Container[]
  parties: Party[]
  accounts: BillingAccount[]
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
}

/** Flat per-event rates in cents, keyed by ServiceEvent exception. Typed locally in engine.ts in Phase 2. */
export const EVENT_RATES = eventRates as Record<string, number>

export const seed: Seed = {
  hauler: hauler as Hauler[],
  zones: zones as Zone[],
  routes: routes as Route[],
  catalog: catalog as ServiceCatalog[],
  containers: containers as Container[],
  parties: parties as Party[],
  accounts: accounts as BillingAccount[],
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
}

/** Deep clone so callers can mutate freely without touching the module level seed. */
export function loadSeed(): Seed {
  return structuredClone(seed)
}
