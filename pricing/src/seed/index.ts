// One typed seed object built from the JSON tables in this folder.
// JSON imports widen string literals (for example status: string), so each table is narrowed to its
// contract type from src/types.ts with a concrete assertion. There are no `any` casts here; seed.test.ts
// checks referential integrity and enum values at runtime so a bad row fails the test suite, not the UI.
import type {
  Hauler, Party, BillingAccount, Site, Zone, Route, ServiceCatalog, Container, ServiceItem, RateVersion,
  FeeRule, TaxRule, Contract, Quote, WorkOrder, ServiceEvent, ScaleTicket, Charge, WaivedCharge, Invoice,
  CreditMemo, Payment, PaymentAllocation, ProcessorBatch, Request,
} from '../types';

import haulerJson from './hauler.json';
import partiesJson from './parties.json';
import accountsJson from './accounts.json';
import sitesJson from './sites.json';
import zonesJson from './zones.json';
import routesJson from './routes.json';
import catalogJson from './catalog.json';
import containersJson from './containers.json';
import serviceItemsJson from './serviceItems.json';
import rateVersionsJson from './rateVersions.json';
import feeRulesJson from './feeRules.json';
import taxRulesJson from './taxRules.json';
import contractsJson from './contracts.json';
import quotesJson from './quotes.json';
import workOrdersJson from './workOrders.json';
import serviceEventsJson from './serviceEvents.json';
import scaleTicketsJson from './scaleTickets.json';
import chargesJson from './charges.json';
import waivedChargesJson from './waivedCharges.json';
import invoicesJson from './invoices.json';
import creditMemosJson from './creditMemos.json';
import paymentsJson from './payments.json';
import allocationsJson from './allocations.json';
import processorBatchesJson from './processorBatches.json';
import requestsJson from './requests.json';

export interface Seed {
  haulers: Hauler[];
  parties: Party[];
  accounts: BillingAccount[];
  sites: Site[];
  zones: Zone[];
  routes: Route[];
  catalog: ServiceCatalog[];
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
  allocations: PaymentAllocation[];
  processorBatches: ProcessorBatch[];
  requests: Request[];
}

export const seed: Seed = {
  haulers: [haulerJson as Hauler],
  parties: partiesJson as Party[],
  accounts: accountsJson as BillingAccount[],
  sites: sitesJson as Site[],
  zones: zonesJson as Zone[],
  routes: routesJson as Route[],
  catalog: catalogJson as ServiceCatalog[],
  containers: containersJson as Container[],
  serviceItems: serviceItemsJson as ServiceItem[],
  rateVersions: rateVersionsJson as RateVersion[],
  feeRules: feeRulesJson as FeeRule[],
  taxRules: taxRulesJson as TaxRule[],
  contracts: contractsJson as Contract[],
  quotes: quotesJson as Quote[],
  workOrders: workOrdersJson as WorkOrder[],
  serviceEvents: serviceEventsJson as ServiceEvent[],
  scaleTickets: scaleTicketsJson as ScaleTicket[],
  charges: chargesJson as Charge[],
  waivedCharges: waivedChargesJson as WaivedCharge[],
  invoices: invoicesJson as Invoice[],
  creditMemos: creditMemosJson as CreditMemo[],
  payments: paymentsJson as Payment[],
  allocations: allocationsJson as PaymentAllocation[],
  processorBatches: processorBatchesJson as ProcessorBatch[],
  requests: requestsJson as Request[],
};

/** Deep copy so the store can reset() to pristine seed without sharing object identity. */
export function cloneSeed(): Seed {
  return structuredClone(seed);
}
