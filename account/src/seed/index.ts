// One typed SeedData object built from the plain JSON files in this directory.
// The JSON is generated once by scripts/gen_seed.mjs and committed; do not hand-edit numbers here.
import type {
  BillingAccount, Charge, Container, Contract, CreditMemo, FeeRule, Hauler, Invoice, Party, Payment,
  PaymentAllocation, ProcessorBatch, Quote, RateVersion, Request, Route, ScaleTicket, ServiceCatalog,
  ServiceEvent, ServiceItem, Site, TaxRule, WaivedCharge, WorkOrder, Zone,
} from '../types';

import haulers from './haulers.json';
import parties from './parties.json';
import billingAccounts from './accounts.json';
import sites from './sites.json';
import zones from './zones.json';
import routes from './routes.json';
import serviceCatalog from './serviceCatalog.json';
import containers from './containers.json';
import serviceItems from './serviceItems.json';
import rateVersions from './rateVersions.json';
import feeRules from './feeRules.json';
import taxRules from './taxRules.json';
import contracts from './contracts.json';
import quotes from './quotes.json';
import workOrders from './workOrders.json';
import serviceEvents from './serviceEvents.json';
import scaleTickets from './scaleTickets.json';
import charges from './charges.json';
import waivedCharges from './waivedCharges.json';
import invoices from './invoices.json';
import creditMemos from './creditMemos.json';
import payments from './payments.json';
import paymentAllocations from './paymentAllocations.json';
import processorBatches from './processorBatches.json';
import requests from './requests.json';
import eventRates from './eventRates.json';

/** Exceptions a driver can log that carry a price. notOut is deliberately absent: it never charges. */
export type PricedException = 'extraBags' | 'overload' | 'contamination' | 'dryRun';

/** Cents per ServiceEvent exception (addendum B4). Surface seed data, not a contract entity, so it is not in types.ts. */
export type EventRates = Record<PricedException, number>;

export interface SeedData {
  haulers: Hauler[];
  parties: Party[];
  billingAccounts: BillingAccount[];
  sites: Site[];
  zones: Zone[];
  routes: Route[];
  serviceCatalog: ServiceCatalog[];
  containers: Container[];
  serviceItems: ServiceItem[];
  rateVersions: RateVersion[];
  feeRules: FeeRule[];
  taxRules: TaxRule[];
  contracts: Contract[];
  quotes: Quote[];
  workOrders: WorkOrder[];
  serviceEvents: ServiceEvent[];
  scaleTickets: ScaleTicket[];
  charges: Charge[];
  waivedCharges: WaivedCharge[];
  invoices: Invoice[];
  creditMemos: CreditMemo[];
  payments: Payment[];
  paymentAllocations: PaymentAllocation[];
  processorBatches: ProcessorBatch[];
  requests: Request[];
  eventRates: EventRates;
}

// JSON imports infer `string` where the contract has union literals; the casts narrow them.
export const seed: SeedData = {
  haulers: haulers as Hauler[],
  parties: parties as Party[],
  billingAccounts: billingAccounts as BillingAccount[],
  sites: sites as Site[],
  zones: zones as Zone[],
  routes: routes as Route[],
  serviceCatalog: serviceCatalog as ServiceCatalog[],
  containers: containers as Container[],
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
  paymentAllocations: paymentAllocations as PaymentAllocation[],
  processorBatches: processorBatches as ProcessorBatch[],
  requests: requests as Request[],
  eventRates: eventRates as EventRates,
};

export default seed;
