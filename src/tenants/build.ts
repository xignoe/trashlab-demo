/**
 * Turns a TenantConfig into the Db that is that hauler's world.
 *
 * The shape is billing's table shape (addendum C1), so everything the merged app already does works unchanged: the
 * canonical engine prices against these rateVersions, the storefront's address matcher reads these zones, and the
 * office screens list these accounts. Nothing here is hauler-specific code; every difference between two haulers is a
 * difference between two configs.
 *
 * What a tenant starts with: its rate card, its routes, and the customers already on its books. What it starts
 * without: invoices, charges, payments, and quotes. These haulers are new to TrashLab, so the first bill run and the
 * first signup are the ones you watch happen rather than ones the seed did for you. Piedmont Disposal keeps its full
 * seeded history and stays the default (src/tenants/piedmont.ts).
 */
import { seed } from '../seed';
import type { Db } from '../store/db';
import type {
  BillingAccount, BillingGroup, Container, FeeRule, Hauler, Party, PricingDimension, RateVersion, RolloffMaterial,
  RolloffPolicy, RolloffRate, Route, ServiceCatalog, ServiceItem, Site, TaxRule,
} from '../types';
import type { TenantConfig } from './types';

/** When this rate card was published. Before the demo clock, so every rate is live on day one. */
const PUBLISHED_AT = '2025-12-15T09:00:00-05:00';
const EFFECTIVE_FROM = '2026-01-01';
/** Existing customers have been on service for a while, so their lines predate the demo clock. */
const IN_SERVICE_SINCE = '2025-03-01';

/** The shared catalog, keyed. A tenant picks from it by id so the storefront's fixed id tables keep matching. */
const BASE_CATALOG: Record<string, ServiceCatalog> = Object.fromEntries(seed.catalog.map(c => [c.id, c]));

/**
 * The catalog the hauler stocks: the shared row for each service it sells, with its own name, size label,
 * description, and roll-off terms where it sets them. A size the hauler does not stock is absent, which is what
 * closes it off in the storefront's forms.
 */
function catalogFor(config: TenantConfig): ServiceCatalog[] {
  return config.services.map(s => {
    const base = BASE_CATALOG[s.catalogId];
    if (!base) throw new Error(`${config.id}: unknown catalog id ${s.catalogId}`);
    const rolloff = base.rolloff
      ? {
          ...base.rolloff,
          ...(s.includedTons !== undefined ? { includedTons: s.includedTons } : {}),
          ...(s.includedDays !== undefined ? { includedDays: s.includedDays } : {}),
        }
      : undefined;
    return {
      ...base,
      ...(s.name ? { name: s.name } : {}),
      ...(s.sizeLabel ? { sizeLabel: s.sizeLabel } : {}),
      ...(s.description ? { description: s.description } : {}),
      ...(rolloff ? { rolloff } : {}),
    };
  });
}

/**
 * One published RateVersion per service, zone, and frequency the hauler sells. Rates are written for the open-market
 * zone and repeated for the boundary zone at a premium, because a boundary stop costs more to reach; a franchise zone
 * is priced by the city's agreement, so it gets no public rate at all.
 */
function ratesFor(config: TenantConfig): RateVersion[] {
  const out: RateVersion[] = [];
  const priced = config.zones.filter(z => z.serviceability === 'open' || z.serviceability === 'boundary');
  for (const service of config.services) {
    for (const zone of priced) {
      const premium = zone.serviceability === 'boundary' ? 1.15 : 1;
      for (const [frequency, cents] of Object.entries(service.rates)) {
        out.push({
          id: `rv_${config.id}_${service.catalogId}_${zone.id}_${frequency}`,
          catalogId: service.catalogId,
          zoneId: zone.id,
          frequency: frequency as RateVersion['frequency'],
          priceCents: Math.round(cents * premium),
          effectiveFrom: EFFECTIVE_FROM,
          status: 'published',
          publishedAt: PUBLISHED_AT,
        });
      }
    }
  }
  return out;
}

/** The fuel surcharge and the environmental pass-through, at this hauler's own numbers. */
function feesFor(config: TenantConfig): FeeRule[] {
  return [
    {
      id: 'fee_fuel_pct',
      name: 'Fuel surcharge',
      kind: 'percent',
      value: config.fuelPct,
      base: 'serviceLines',
      appliesTo: ['recurring', 'event'],
      taxable: true,
      category: 'surcharge',
      description: 'Tracks diesel cost; reviewed quarterly',
    },
    {
      id: 'fee_env_1',
      name: 'Environmental fee',
      kind: 'flat',
      value: config.envFeeCents,
      base: 'serviceLines',
      appliesTo: ['recurring'],
      taxable: false,
      category: 'regulatory',
      description: 'Landfill host and state solid waste fees, passed through per month',
    },
  ];
}

/** Sales tax on every zone the hauler actually serves. A not-served zone is never billed, so it gets no rule. */
function taxesFor(config: TenantConfig): TaxRule[] {
  return config.zones
    .filter(z => z.serviceability !== 'notServed')
    .map(z => ({
      id: `tax_${z.id}`,
      zoneId: z.id,
      ratePct: config.taxRatePct,
      appliesTo: ['recurring', 'event', 'fee'] as TaxRule['appliesTo'],
      name: `Sales tax, ${config.state}`,
      jurisdiction: 'state' as const,
    }));
}

/** The roll-off size by material matrix, and the hauler's box rules, when it runs boxes. */
function rolloffFor(config: TenantConfig): { materials: RolloffMaterial[]; rates: RolloffRate[]; policy: RolloffPolicy[] } {
  if (!config.rolloff) return { materials: [], rates: [], policy: [] };
  const materials: RolloffMaterial[] = seed.rolloffMaterials.map(m =>
    // A material the hauler's own site names as refused is prohibited here, whatever the shared row says.
    config.rolloff!.prohibited.some(p => m.name.toLowerCase().includes(p.toLowerCase()))
      ? { ...m, handling: 'prohibited' as const }
      : m,
  );
  const boxes = config.services.filter(s => BASE_CATALOG[s.catalogId]?.lob === 'rolloff');
  const rates: RolloffRate[] = [];
  for (const box of boxes) {
    for (const material of materials) {
      const available = material.handling !== 'prohibited';
      rates.push({
        id: `rr_${config.id}_${box.catalogId}_${material.id}`,
        catalogId: box.catalogId,
        materialId: material.id,
        available,
        haulDeltaCents: material.handling === 'accepted' ? 2500 : 0,
        includedTons: box.includedTons ?? BASE_CATALOG[box.catalogId]?.rolloff?.includedTons ?? 0,
        overageCentsPerTon: 8000,
        effectiveFrom: EFFECTIVE_FROM,
        publishedAt: PUBLISHED_AT,
      });
    }
  }
  const policy: RolloffPolicy[] = [{
    id: 'rolloff_policy',
    tonRounding: 'exact',
    freeRadiusMiles: config.rolloff.freeRadiusMiles,
    tripCentsPerMile: config.rolloff.tripCentsPerMile,
    swapCents: config.rolloff.swapCents,
    relocationCents: config.rolloff.relocationCents,
    dryRunCents: config.rolloff.dryRunCents,
    prohibitedItems: seed.rolloffPolicy[0]?.prohibitedItems ?? [],
  }];
  return { materials, rates, policy };
}

/** Built-in pricing dimensions, with Piedmont's per-account assignments dropped: a new tenant assigns its own. */
function dimensionsFor(): PricingDimension[] {
  return seed.pricingDimensions.map(d => {
    const { assignments: _drop, ...rest } = d;
    return rest;
  });
}

interface People {
  parties: Party[];
  accounts: BillingAccount[];
  sites: Site[];
  serviceItems: ServiceItem[];
  containers: Container[];
  groups: BillingGroup[];
}

/**
 * The customers already on the books. Each becomes a Party, a BillingAccount, a Site, and one ServiceItem with its
 * Containers per line. Residential accounts bill quarterly together and commercial monthly together, which is how
 * these haulers describe their own billing and gives the billing groups screen something real to show.
 */
function peopleFor(config: TenantConfig): People {
  const groups: BillingGroup[] = [
    {
      id: 'grp_res_quarterly',
      name: 'Residential, quarterly',
      schedule: { frequency: 'quarterly', every: 1, startDate: '2026-01-01' },
      termsDays: 15,
      delivery: 'email',
      customerChoice: true,
    },
    {
      id: 'grp_commercial_monthly',
      name: 'Commercial, monthly',
      schedule: { frequency: 'monthly', every: 1, startDate: '2026-01-01' },
      termsDays: 30,
      delivery: 'email',
      customerChoice: true,
    },
  ];

  const people: People = { parties: [], accounts: [], sites: [], serviceItems: [], containers: [], groups };
  for (const customer of config.customers) {
    const partyId = `party_${customer.key}`;
    const accountId = `acct_${customer.key}`;
    const siteId = `site_${customer.key}`;
    people.parties.push({ id: partyId, name: customer.name, kind: customer.kind });
    people.accounts.push({
      id: accountId,
      payerPartyId: partyId,
      cycle: customer.cycle,
      billedInAdvance: customer.cycle !== 'net30' && customer.cycle !== 'perJob',
      autopay: false,
      status: 'active',
      deliveryMethod: 'email',
      taxExempt: false,
      // Per job and net 30 accounts bill off cycle, so they stay out of a group (addendum P).
      ...(customer.cycle === 'quarterly'
        ? { billingGroupId: 'grp_res_quarterly' }
        : customer.cycle === 'monthly'
          ? { billingGroupId: 'grp_commercial_monthly' }
          : {}),
    });
    people.sites.push({
      id: siteId,
      accountId,
      occupantPartyId: partyId,
      address: customer.address,
      zoneId: customer.zoneId,
      ...(customer.routeId ? { routeId: customer.routeId } : {}),
      ...(customer.accessNotes ? { accessNotes: customer.accessNotes } : {}),
    });
    customer.lines.forEach((line, i) => {
      const containerIds: string[] = [];
      for (let n = 0; n < line.qty; n += 1) {
        const containerId = `cnt_${customer.key}_${i}_${n}`;
        containerIds.push(containerId);
        people.containers.push({
          id: containerId,
          serial: containerId.toUpperCase(),
          catalogId: line.catalogId,
          siteId,
          assignedFrom: IN_SERVICE_SINCE,
        });
      }
      people.serviceItems.push({
        id: `si_${customer.key}_${i}`,
        siteId,
        catalogId: line.catalogId,
        qty: line.qty,
        frequency: line.frequency,
        containerIds,
        effectiveFrom: IN_SERVICE_SINCE,
        status: 'active',
      });
    });
  }
  return people;
}

/** The hauler's world, fresh each call. */
export function buildTenantDb(config: TenantConfig): Db {
  const people = peopleFor(config);
  const rolloff = rolloffFor(config);

  const hauler: Hauler[] = [{
    id: `hauler_${config.id}`,
    name: config.name,
    policy: {
      proration: 'none',
      lateFeeCents: 1000,
      lateFeeDay: 5,
      graceMissedPickups: 2,
      suspendAfterDays: 30,
      reinstatementFeeCents: 2500,
    },
  }];

  const routes: Route[] = config.routes.map(r => ({
    ...r,
    stopSiteIds: people.sites.filter(s => s.routeId === r.id).map(s => s.id),
    capacityStops: r.lob === 'residential' ? 120 : r.lob === 'frontload' ? 60 : 24,
  }));

  return {
    hauler,
    zones: config.zones.map(z => ({
      id: z.id,
      name: z.name,
      serviceability: z.serviceability,
      taxRatePct: z.serviceability === 'notServed' ? 0 : config.taxRatePct,
      franchiseFeePct: z.franchiseFeePct ?? 0,
      deliveryFeeCents: z.deliveryFeeCents ?? 2500,
      publicPricing: z.publicPricing ?? (z.serviceability === 'open' || z.serviceability === 'boundary'),
    })),
    routes,
    catalog: catalogFor(config),
    containers: people.containers,
    parties: people.parties,
    accounts: people.accounts,
    billingGroups: people.groups,
    sites: people.sites,
    serviceItems: people.serviceItems,
    rateVersions: ratesFor(config),
    feeRules: feesFor(config),
    taxRules: taxesFor(config),
    contracts: [],
    quotes: [],
    workOrders: [],
    serviceEvents: [],
    scaleTickets: [],
    charges: [],
    waivedCharges: [],
    invoices: [],
    creditMemos: [],
    payments: [],
    allocations: [],
    processorBatches: [],
    requests: [],
    rolloffMaterials: rolloff.materials,
    rolloffRates: rolloff.rates,
    rolloffPolicy: rolloff.policy,
    serviceCategories: seed.serviceCategories,
    pricingDimensions: dimensionsFor(),
    geoZones: [],
  };
}
