/**
 * Tenants: one hauler's whole world.
 *
 * TrashLab ships as one app that several haulers each use as their own. The store already holds the entire world in
 * one Db (src/store/db.ts), so a tenant is not a column on every row: it is a Db. Signing in as a hauler swaps the Db,
 * and every engine call, selector, and screen keeps working unchanged because none of them ever knew there was more
 * than one hauler. That is why nothing in this folder adds a haulerId.
 *
 * A tenant is configuration, not code (memory: pricing is configuration, not code). Each hauler is a TenantConfig
 * describing which lines of business it sells, the sizes it stocks, what it charges, where it runs, and the customers
 * already on its books. src/tenants/build.ts turns that into a Db.
 *
 * Ids that the surfaces match on are deliberately the same in every tenant (zone_open, zone_notserved, cat_res_96,
 * cat_ro_20yd, and so on). The storefront's address matcher looks up zone_notserved by id, and its commercial form
 * lists container ids from a fixed table, so a tenant varies the name, the price, and whether a size is stocked at
 * all, never the id. A size the hauler does not stock is simply absent from its catalog, and the forms filter to what
 * the tenant actually has.
 */
import type { SeedAddress } from '../seed';
import type { Db } from '../store/db';
import type { Frequency, LOB } from '../types';

/**
 * The hauler's colors, applied as --rt-* overrides on the surface wrapper (src/styles/theme.css). Each tenant reads
 * as its own company without a second stylesheet: the theme bridge already routes every utility through a variable.
 */
export interface TenantBrand {
  /** The header band and primary buttons. */
  accent: string;
  /** Text and marks on top of accent. Must clear 4.5:1 against it. */
  onAccent: string;
  /** Deeper shade for secondary button text and headings. */
  deep: string;
  /** The small square in the logo tile and other quiet marks. */
  mark: string;
  /** The page ground behind cards. */
  bg: string;
}

/** Who a demo visitor can sign in as. A customer login opens the portal on that account. */
export interface TenantLogin {
  /** The BillingAccount this login opens. */
  accountId: string;
  /** The person or company signing in. */
  name: string;
  /** What kind of customer they are, for the login card. */
  role: string;
  /** The line of business this login demonstrates. */
  lob: LOB;
  /** One line on the card saying what this login is good for. */
  blurb: string;
}

/**
 * A customer already on the hauler's books when the demo starts. The builder turns each into a Party, a
 * BillingAccount, a Site, and one ServiceItem plus Containers per line. No invoices or charges: these tenants are new
 * to TrashLab, so their history starts empty and the first bill run is the one you watch happen.
 */
export interface TenantCustomer {
  /** Suffix for every id this customer gets: acct_<key>, party_<key>, site_<key>. */
  key: string;
  name: string;
  kind: 'homeowner' | 'business' | 'contractor' | 'propertyManager' | 'hoa';
  address: string;
  zoneId: string;
  routeId?: string;
  cycle: 'monthly' | 'quarterly' | 'perJob' | 'net30';
  lines: { catalogId: string; qty: number; frequency: Frequency }[];
  accessNotes?: string;
  /** Shown on the login card. */
  blurb: string;
  role: string;
  /** Leave this customer out of the login list (they exist only to fill a route). */
  hidden?: boolean;
}

/** A container size the hauler stocks, and what it charges for it. */
export interface TenantService {
  /** A catalog id from the shared table. A size the hauler does not stock is left out entirely. */
  catalogId: string;
  /** Overrides the shared catalog name, for haulers that call a size something else. */
  name?: string;
  /** Overrides the shared size label, for a hauler that markets a range ("10-15 yd") as one class. */
  sizeLabel?: string;
  /** What the hauler says the size is for, in its own words: dimensions, capacity, typical jobs. */
  description?: string;
  /** Published price per month (per haul for roll-off), in cents, at each frequency the hauler sells. */
  rates: Partial<Record<Frequency, number>>;
  /** Roll-off only: tons and days included in the haul price. Defaults to the shared catalog's terms. */
  includedTons?: number;
  includedDays?: number;
}

/** Everything that makes one hauler's world. */
export interface TenantConfig {
  id: string;
  /** The company, as it writes its own name. */
  name: string;
  /** A short form for tight spaces. */
  shortName: string;
  tagline: string;
  phone: string;
  /** The hauler's public email, when it publishes one. */
  email?: string;
  /** The yard's street address, when the hauler publishes one. */
  address?: string;
  /** Where the yard is. */
  city: string;
  state: string;
  /** Towns the hauler names as its service area, for the storefront's area note. */
  serviceArea: string[];
  /** The lines of business this hauler sells. A line it does not sell is closed off in the storefront. */
  lines: LOB[];
  brand: TenantBrand;
  /** The real site this profile was read from, shown on the login screen so the mapping is auditable. */
  source: string;
  /** What the real site publishes versus what is modeled here, so nobody mistakes a demo rate for a real one. */
  note: string;
  /** Sales tax on service in this hauler's state, as a percent. */
  taxRatePct: number;
  /** Fuel surcharge, as a percent of the service lines. Haulers set this from their own diesel cost. */
  fuelPct: number;
  /** Environmental and regulatory pass-through, flat cents per month per service line. */
  envFeeCents: number;
  /** Named zones. Ids stay zone_open, zone_boundary, zone_franchise, zone_notserved (see the file comment). */
  zones: { id: string; name: string; serviceability: 'open' | 'franchise' | 'boundary' | 'notServed'; franchiseFeePct?: number; deliveryFeeCents?: number; publicPricing?: boolean }[];
  routes: { id: string; day: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri'; lob: LOB }[];
  services: TenantService[];
  customers: TenantCustomer[];
  /** The addresses the storefront's address field knows. Stands in for a geocoder (addendum B3). */
  addresses: SeedAddress[];
  /** Roll-off rules, when the hauler runs boxes. */
  rolloff?: {
    freeRadiusMiles: number;
    tripCentsPerMile: number;
    swapCents: number;
    relocationCents: number;
    dryRunCents: number;
    /** Materials the hauler refuses, from the real site's prohibited list. */
    prohibited: string[];
  };
  /** A promotion the real site advertises, shown on the storefront. */
  promo?: string;
}

/**
 * A tenant ready to sign in to: who the hauler is, the Db that is its world, and the logins it offers. Piedmont
 * Disposal is a profile with no config, because its world is the hand-built seed rather than a tenant configuration.
 */
export interface TenantProfile {
  id: string;
  name: string;
  shortName: string;
  tagline: string;
  phone: string;
  email?: string;
  address?: string;
  city: string;
  state: string;
  serviceArea: string[];
  lines: LOB[];
  brand: TenantBrand;
  source: string;
  note: string;
  promo?: string;
  /** Fresh every call, so signing in to a tenant twice starts from the same place. */
  buildDb(): Db;
  /** The customer logins this tenant offers, in line-of-business order. */
  logins: TenantLogin[];
  /** The addresses this hauler's storefront recognises. */
  addresses: SeedAddress[];
  /** Present for a configured hauler; absent for the seeded demo hauler. */
  config?: TenantConfig;
}

/**
 * Who is signed in, and to which hauler. The app has no passwords: this is a demo sign-in that picks a tenant and a
 * seat at it, the way the persona bar picks a persona. A customer seat also names the account the portal opens.
 */
export interface TenantSession {
  tenantId: string;
  role: 'owner' | 'office' | 'customer';
  /** Set on a customer seat: the BillingAccount the portal opens. */
  accountId?: string;
  /** Who the seat belongs to, for the persona bar. */
  name: string;
}

/** The lines of business, in the order the storefront and login screen show them. */
export const LINE_LABEL: Record<LOB, string> = {
  residential: 'Residential',
  frontload: 'Commercial',
  rolloff: 'Roll-off',
};
