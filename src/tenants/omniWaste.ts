/**
 * Omni Waste Services, Northern NJ and New York. Read from https://www.omni-waste.com on 2026-09-11.
 *
 * The commercial and roll-off hauler: roll-off containers, open tops, compactors, commercial garbage and recycling,
 * and cardboard, across Northern NJ, Rockland and Westchester counties, and the five boroughs. The site sells no
 * residential curbside at all, which makes this the tenant that proves a line of business can be closed off: the
 * storefront must not offer a homeowner a cart here.
 *
 * Taken from the site: the name, the service lines, the service area, both phone numbers, and the advertised
 * promotion. The site publishes no rates, so prices are modeled at New York metro levels, which run above New Jersey.
 * The site also advertises a half yard mini container; the shared catalog has no size below 2 yards, so it is not
 * stocked here (see docs/tenant-workflows.md).
 */
import type { TenantConfig } from './types';

export const omniWaste: TenantConfig = {
  id: 'omni-waste',
  name: 'Omni Waste Services',
  shortName: 'Omni Waste',
  tagline: 'Waste management in NJ and NY, guaranteed satisfaction',
  phone: '(973) 279-0003',
  city: 'Paterson',
  state: 'NJ',
  serviceArea: ['Paterson', 'Clifton', 'Hackensack', 'Yonkers', 'New Rochelle', 'Bronx', 'Manhattan', 'Brooklyn'],
  // No residential curbside: this hauler serves businesses and job sites only.
  lines: ['frontload', 'rolloff'],
  brand: {
    accent: '#0F5132',
    onAccent: '#FFFFFF',
    deep: '#0A3622',
    mark: '#4ADE80',
    bg: '#F3F8F5',
  },
  source: 'https://www.omni-waste.com',
  note: 'Service lines, service area, phones, and the first-rental promotion are from the live site. The site publishes no rates or container dimensions, so prices here are modeled at New York metro levels.',
  taxRatePct: 8.875,
  fuelPct: 9,
  envFeeCents: 250,
  promo: '$25 off your first roll-off rental',
  zones: [
    { id: 'zone_open', name: 'Northern NJ open market', serviceability: 'open' },
    { id: 'zone_franchise', name: 'NYC commercial waste zone', serviceability: 'franchise', franchiseFeePct: 20 },
    { id: 'zone_boundary', name: 'Rockland and Westchester', serviceability: 'boundary', deliveryFeeCents: 4500 },
    { id: 'zone_notserved', name: 'Outside the service area', serviceability: 'notServed' },
  ],
  routes: [
    { id: 'route_tue_fl', day: 'Tue', lob: 'frontload' },
    { id: 'route_wed_fl', day: 'Wed', lob: 'frontload' },
    { id: 'route_thu_ro', day: 'Thu', lob: 'rolloff' },
  ],
  services: [
    { catalogId: 'cat_fl_2yd', rates: { eow: 17500, weekly: 26000, '2x': 42000, '3x': 57000 } },
    { catalogId: 'cat_fl_3yd', rates: { eow: 21000, weekly: 31500, '2x': 51000, '3x': 68500, '4x': 84000 } },
    { catalogId: 'cat_fl_3yd_wood', rates: { weekly: 34000, '2x': 55000 } },
    { catalogId: 'cat_fl_4yd', rates: { eow: 24500, weekly: 37000, '2x': 59500, '3x': 80000, '4x': 99000 } },
    { catalogId: 'cat_fl_6yd', rates: { eow: 31500, weekly: 47000, '2x': 76000, '3x': 102000, '4x': 126000, '5x': 148000 } },
    { catalogId: 'cat_fl_8yd', rates: { eow: 38500, weekly: 57000, '2x': 92000, '3x': 124000, '4x': 153000, '5x': 180000, '6x': 206000 } },
    { catalogId: 'cat_ro_10yd', rates: { onCall: 59500 }, includedTons: 2 },
    { catalogId: 'cat_ro_20yd', rates: { onCall: 66500 }, includedTons: 3 },
    { catalogId: 'cat_ro_30yd', rates: { onCall: 74500 }, includedTons: 4 },
    { catalogId: 'cat_ro_40yd', rates: { onCall: 82500 }, includedTons: 5 },
    // The compactor is always priced by a person, so it is stocked with no published rate.
    { catalogId: 'cat_ro_compactor_30yd', rates: {}, includedTons: 6 },
  ],
  rolloff: {
    freeRadiusMiles: 10,
    tripCentsPerMile: 500,
    swapCents: 39500,
    relocationCents: 9500,
    dryRunCents: 22500,
    prohibited: ['Hazardous'],
  },
  customers: [
    {
      key: 'om_paterson',
      name: 'Paterson Fresh Market',
      kind: 'business',
      address: '215 Market St, Paterson, NJ 07505',
      zoneId: 'zone_open',
      routeId: 'route_tue_fl',
      cycle: 'monthly',
      accessNotes: 'Container behind the loading dock',
      lines: [
        { catalogId: 'cat_fl_6yd', qty: 1, frequency: '3x' },
        { catalogId: 'cat_fl_3yd', qty: 1, frequency: 'weekly' },
      ],
      role: 'Grocer, commercial front load',
      blurb: 'A 6 yard trash container three times a week plus a 3 yard for cardboard.',
    },
    {
      key: 'om_hudson',
      name: 'Hudson Demolition Co',
      kind: 'contractor',
      address: '40 River Rd, Yonkers, NY 10701',
      zoneId: 'zone_boundary',
      routeId: 'route_thu_ro',
      cycle: 'perJob',
      lines: [{ catalogId: 'cat_ro_40yd', qty: 2, frequency: 'onCall' }],
      role: 'Demolition contractor, roll-off',
      blurb: 'Two 40 yard boxes on a Westchester tear-down, billed per job.',
    },
    {
      key: 'om_lofts',
      name: 'Bergen Lofts Management',
      kind: 'propertyManager',
      address: '88 Essex St, Hackensack, NJ 07601',
      zoneId: 'zone_open',
      routeId: 'route_wed_fl',
      cycle: 'net30',
      lines: [{ catalogId: 'cat_fl_8yd', qty: 2, frequency: '2x' }],
      role: 'Property manager, commercial front load',
      blurb: 'Two 8 yard containers twice a week across an apartment portfolio, net 30.',
    },
  ],
  addresses: [
    {
      id: 'om_addr_open_comm',
      label: 'Commercial, Tuesday front load route',
      line1: '612 Main St',
      city: 'Paterson',
      state: 'NJ',
      zip: '07503',
      zoneId: 'zone_open',
      routeId: 'route_tue_fl',
    },
    {
      id: 'om_addr_open_comm2',
      label: 'Commercial, Wednesday front load route',
      line1: '145 State St',
      city: 'Hackensack',
      state: 'NJ',
      zip: '07601',
      zoneId: 'zone_open',
      routeId: 'route_wed_fl',
    },
    {
      id: 'om_addr_open_ro',
      label: 'Job site, Thursday roll-off route',
      line1: '300 Getty Ave',
      city: 'Clifton',
      state: 'NJ',
      zip: '07011',
      zoneId: 'zone_open',
      routeId: 'route_thu_ro',
    },
    {
      id: 'om_addr_franchise',
      label: 'Inside a New York City commercial waste zone',
      line1: '1450 Webster Ave',
      city: 'Bronx',
      state: 'NY',
      zip: '10456',
      zoneId: 'zone_franchise',
      franchiseHolder: 'NYC Commercial Waste Zone carter',
    },
    {
      id: 'om_addr_boundary',
      label: 'Westchester, outside the core area',
      line1: '22 Nepperhan Ave',
      city: 'Yonkers',
      state: 'NY',
      zip: '10701',
      zoneId: 'zone_boundary',
      boundaryReason: 'crosses the state line, dispatch confirms the run',
    },
  ],
};
