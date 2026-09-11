/**
 * Direct Waste Services Inc., Newark NJ. Read from https://www.directwasteservices.com on 2026-09-11.
 *
 * The roll-off led hauler: residential and commercial dumpster rentals, roll-off containers, recycling, and garbage
 * pickup, around Newark and the surrounding New Jersey communities. It is the tenant modeled most closely on a real
 * published offer, because this site is the only one of the three that names its sizes and their dimensions.
 *
 * Taken from the site: the name, the tagline, the three roll-off sizes and their dimensions, the 24 hour service
 * promise, the prohibited materials list, the service area, the phone, and the blue on white brand. It stocks no 40
 * yard box and no compactor, because the site lists only 10, 20, and 30 yard. Prices are modeled: the site publishes
 * none and quotes every job by phone.
 */
import type { TenantConfig } from './types';

export const directWaste: TenantConfig = {
  id: 'direct-waste',
  name: 'Direct Waste Services',
  shortName: 'Direct Waste',
  tagline: 'Convenient and cost-effective dumpster rentals',
  phone: '(973) 242-8008',
  city: 'Newark',
  state: 'NJ',
  serviceArea: ['Newark', 'Irvington', 'East Orange', 'Bloomfield', 'Belleville', 'Harrison', 'Kearny'],
  lines: ['residential', 'frontload', 'rolloff'],
  brand: {
    accent: '#0B5FA5',
    onAccent: '#FFFFFF',
    deep: '#08436F',
    mark: '#7DD3FC',
    bg: '#F3F8FC',
  },
  source: 'https://www.directwasteservices.com/roll-off-dumpster-rental',
  note: 'Sizes, dimensions, the 24 hour service promise, the prohibited materials list, and the service area are from the live site. The site publishes no rates, so prices here are modeled at New Jersey market levels.',
  taxRatePct: 6.625,
  fuelPct: 8,
  envFeeCents: 175,
  promo: 'Service within 24 hours, same day if you call early',
  zones: [
    { id: 'zone_open', name: 'Newark and surrounding towns', serviceability: 'open' },
    { id: 'zone_franchise', name: 'Municipal contract towns', serviceability: 'franchise', franchiseFeePct: 12 },
    { id: 'zone_boundary', name: 'Outer Essex and Hudson', serviceability: 'boundary', deliveryFeeCents: 3000 },
    { id: 'zone_notserved', name: 'Outside the service area', serviceability: 'notServed' },
  ],
  routes: [
    { id: 'route_tue_res', day: 'Tue', lob: 'residential' },
    { id: 'route_wed_fl', day: 'Wed', lob: 'frontload' },
    { id: 'route_thu_ro', day: 'Thu', lob: 'rolloff' },
    { id: 'route_fri_ro', day: 'Fri', lob: 'rolloff' },
  ],
  services: [
    { catalogId: 'cat_res_96', rates: { weekly: 3200 } },
    { catalogId: 'cat_res_64', rates: { weekly: 2850 } },
    { catalogId: 'cat_res_extra_cart', rates: { weekly: 1000 } },
    { catalogId: 'cat_res_recycling', rates: { eow: 1100, weekly: 1650 } },
    { catalogId: 'cat_fl_2yd', rates: { eow: 13500, weekly: 20000, '2x': 32500, '3x': 44000 } },
    { catalogId: 'cat_fl_3yd', rates: { eow: 16500, weekly: 24500, '2x': 39500, '3x': 53000, '4x': 65500 } },
    { catalogId: 'cat_fl_4yd', rates: { eow: 19500, weekly: 29000, '2x': 46500, '3x': 62500, '4x': 77500 } },
    { catalogId: 'cat_fl_6yd', rates: { eow: 24500, weekly: 36500, '2x': 59000, '3x': 79000, '4x': 97500 } },
    // 10, 20, and 30 yard only: the site lists no 40 yard box and no compactor.
    { catalogId: 'cat_ro_10yd', rates: { onCall: 44500 }, includedTons: 2, includedDays: 14 },
    { catalogId: 'cat_ro_20yd', rates: { onCall: 49500 }, includedTons: 3, includedDays: 14 },
    { catalogId: 'cat_ro_30yd', rates: { onCall: 55500 }, includedTons: 4, includedDays: 14 },
  ],
  rolloff: {
    freeRadiusMiles: 15,
    tripCentsPerMile: 350,
    swapCents: 29500,
    relocationCents: 7500,
    dryRunCents: 15000,
    // The site's prohibited list is long and includes paint, batteries, asbestos, and solvents.
    prohibited: ['Hazardous'],
  },
  customers: [
    {
      key: 'dw_okafor',
      name: 'Grace Okafor',
      kind: 'homeowner',
      address: '91 Tichenor St, Newark, NJ 07108',
      zoneId: 'zone_open',
      routeId: 'route_tue_res',
      cycle: 'quarterly',
      lines: [{ catalogId: 'cat_res_96', qty: 1, frequency: 'weekly' }],
      role: 'Homeowner, residential curbside',
      blurb: 'A single 96 gallon cart on the Tuesday route. Bills quarterly.',
    },
    {
      key: 'dw_brickcity',
      name: 'Brick City Auto Body',
      kind: 'business',
      address: '533 Frelinghuysen Ave, Newark, NJ 07114',
      zoneId: 'zone_open',
      routeId: 'route_wed_fl',
      cycle: 'monthly',
      lines: [{ catalogId: 'cat_fl_3yd', qty: 1, frequency: '2x' }],
      role: 'Auto shop, commercial front load',
      blurb: 'A 3 yard container twice a week. Bills monthly.',
    },
    {
      key: 'dw_summit',
      name: 'Summit Renovations',
      kind: 'contractor',
      address: '17 Clay St, Harrison, NJ 07029',
      zoneId: 'zone_open',
      routeId: 'route_thu_ro',
      cycle: 'perJob',
      lines: [{ catalogId: 'cat_ro_20yd', qty: 1, frequency: 'onCall' }],
      role: 'Renovation contractor, roll-off',
      blurb: 'A 20 yard box on a gut renovation, hauled on call and billed per job.',
    },
  ],
  addresses: [
    {
      id: 'dw_addr_open_res',
      label: 'Residential, Tuesday route',
      line1: '256 Mount Prospect Ave',
      city: 'Newark',
      state: 'NJ',
      zip: '07104',
      zoneId: 'zone_open',
      routeId: 'route_tue_res',
    },
    {
      id: 'dw_addr_open_comm',
      label: 'Commercial, Wednesday front load route',
      line1: '410 Central Ave',
      city: 'East Orange',
      state: 'NJ',
      zip: '07018',
      zoneId: 'zone_open',
      routeId: 'route_wed_fl',
    },
    {
      id: 'dw_addr_open_ro',
      label: 'Job site, Thursday roll-off route',
      line1: '75 Sussex Ave',
      city: 'Newark',
      state: 'NJ',
      zip: '07103',
      zoneId: 'zone_open',
      routeId: 'route_thu_ro',
    },
    {
      id: 'dw_addr_franchise',
      label: 'Inside a municipal contract town',
      line1: '1 Municipal Plaza',
      city: 'Bloomfield',
      state: 'NJ',
      zip: '07003',
      zoneId: 'zone_franchise',
      franchiseHolder: 'Township of Bloomfield',
    },
    {
      id: 'dw_addr_boundary',
      label: 'Outer Hudson county, access confirmed by dispatch',
      line1: '640 Kearny Ave',
      city: 'Kearny',
      state: 'NJ',
      zip: '07032',
      zoneId: 'zone_boundary',
      boundaryReason: 'narrow street, truck access confirmed by dispatch',
    },
  ],
};
