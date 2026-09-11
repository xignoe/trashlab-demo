/**
 * The tenant registry: every hauler this build of TrashLab can be signed in to.
 *
 * Piedmont Disposal is first and is the default, because it carries the full seeded history the runbook and the seven
 * scenarios are written against. Signing in to it changes nothing about the demo that existed before tenants. The
 * three New Jersey haulers are configurations read from their live sites (src/tenants/*.ts), each starting with its
 * rate card, its routes, and its existing customers, but no billing history.
 */
import { ADDRESSES, loadSeed } from '../seed';
import type { LOB, WaivedCharge } from '../types';
import { buildTenantDb } from './build';
import { directWaste } from './directWaste';
import { omniWaste } from './omniWaste';
import { wasteIndustries } from './wasteIndustries';
import type { TenantConfig, TenantLogin, TenantProfile } from './types';

/** Line of business order, so logins and line lists read residential, commercial, roll-off everywhere. */
const LINE_ORDER: LOB[] = ['residential', 'frontload', 'rolloff'];

/** The line of business a customer's first service line belongs to, for ordering the login cards. */
function lobOf(catalogId: string): LOB {
  if (catalogId.startsWith('cat_res_')) return 'residential';
  if (catalogId.startsWith('cat_ro_')) return 'rolloff';
  return 'frontload';
}

/** Turns a hauler's configured customers into the logins its sign-in screen offers. */
function loginsOf(config: TenantConfig): TenantLogin[] {
  return config.customers
    .filter(c => !c.hidden)
    .map(c => ({
      accountId: `acct_${c.key}`,
      name: c.name,
      role: c.role,
      lob: lobOf(c.lines[0]?.catalogId ?? ''),
      blurb: c.blurb,
    }))
    .sort((a, b) => LINE_ORDER.indexOf(a.lob) - LINE_ORDER.indexOf(b.lob));
}

/** A configured hauler as a signed-in-able tenant. */
function profileOf(config: TenantConfig): TenantProfile {
  return {
    id: config.id,
    name: config.name,
    shortName: config.shortName,
    tagline: config.tagline,
    phone: config.phone,
    ...(config.email ? { email: config.email } : {}),
    ...(config.address ? { address: config.address } : {}),
    city: config.city,
    state: config.state,
    serviceArea: config.serviceArea,
    lines: config.lines,
    brand: config.brand,
    source: config.source,
    note: config.note,
    ...(config.promo ? { promo: config.promo } : {}),
    buildDb: () => buildTenantDb(config),
    logins: loginsOf(config),
    addresses: config.addresses,
    config,
  };
}

/**
 * The original demo hauler. Its world is the hand-built seed (45 accounts, invoices, payments, and the seven
 * scenarios), not a tenant configuration, so it has no config and its logins are named by hand.
 */
export const piedmont: TenantProfile = {
  id: 'piedmont',
  name: 'Piedmont Disposal',
  shortName: 'Piedmont',
  tagline: 'The seeded demo hauler, with a full billing history',
  phone: '(706) 555-0142',
  city: 'Piedmont',
  state: 'GA',
  serviceArea: ['Piedmont', 'Ashford', 'Ridge Hollow'],
  lines: ['residential', 'frontload', 'rolloff'],
  brand: {
    accent: '#312D97',
    onAccent: '#FFFFFF',
    deep: '#2F2A90',
    mark: '#10D6E6',
    bg: '#F7F7FF',
  },
  source: 'scripts/gen_seed.ts',
  note: 'The built-in demo hauler. It carries the full seeded history the runbook and the seven scenarios depend on, so every figure in the demo script comes from here.',
  buildDb: loadSeed,
  addresses: [...ADDRESSES],
  logins: [
    {
      accountId: 'acct_res_maple',
      name: 'Ruth Maple',
      role: 'Homeowner, residential curbside',
      lob: 'residential',
      blurb: 'Three carts, quarterly billing, and a past due balance. The account every runbook starts from.',
    },
    {
      accountId: 'acct_bakery',
      name: 'Sunrise Bakery',
      role: 'Bakery, commercial front load',
      lob: 'frontload',
      blurb: 'A contract-priced front load line, and the request for a third weekly pickup that has no published rate.',
    },
    {
      accountId: 'acct_contractor_hale',
      name: 'Hale Construction',
      role: 'Contractor, roll-off',
      lob: 'rolloff',
      blurb: 'Roll-off boxes on two job sites, with scale tickets, tonnage overage, and extra rental days.',
    },
  ],
};

export const TENANTS: TenantProfile[] = [
  piedmont,
  profileOf(wasteIndustries),
  profileOf(omniWaste),
  profileOf(directWaste),
];

/** The tenant the app opens on, so nothing about the seeded demo changes until someone signs in elsewhere. */
export const DEFAULT_TENANT_ID = piedmont.id;

export function tenantById(id: string): TenantProfile {
  const tenant = TENANTS.find(t => t.id === id);
  if (!tenant) throw new Error(`Unknown tenant ${id}`);
  return tenant;
}

/**
 * The waived charges a hauler's world starts with, built once per hauler.
 *
 * Invariant 5 is "a waived row is never removed", so it has to compare what is in the store against what that hauler
 * started with. Comparing against the seeded hauler's rows would fail for every other hauler, which is the state the
 * portal's invariants panel was in before tenants existed as more than one.
 */
const startingWaived = new Map<string, readonly WaivedCharge[]>();

export function startingWaivedCharges(tenantId: string): readonly WaivedCharge[] {
  let rows = startingWaived.get(tenantId);
  if (!rows) {
    rows = tenantById(tenantId).buildDb().waivedCharges;
    startingWaived.set(tenantId, rows);
  }
  return rows;
}

export type { TenantBrand, TenantConfig, TenantLogin, TenantProfile, TenantSession } from './types';
export { LINE_LABEL } from './types';
