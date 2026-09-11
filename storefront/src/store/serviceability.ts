// Address to zone matching. The storefront has no geocoder; the six seed addresses stand in for it.
import type { SeedAddress } from '../seed';
import type { Route, Zone } from '../types';
import { snapshot, type StoreTables } from './store';

export type Branch = 'open' | 'franchise' | 'boundary' | 'notServed';

export interface AddressMatch {
  query: string;
  /** Undefined when nothing matched. */
  address?: SeedAddress;
  zone: Zone;
  route?: Route;
  branch: Branch;
  /** Set on the franchise branch, from the address or the zone name's parenthetical. */
  franchiseHolder?: string;
  /** Set on the boundary branch, e.g. "private road access". */
  boundaryReason?: string;
}

export type MatchState = Pick<StoreTables, 'addresses' | 'zones' | 'routes'>;

export const NOT_SERVED_ZONE_ID = 'zone_notserved';

export function formatAddress(a: SeedAddress): string {
  return `${a.line1}, ${a.city}, ${a.state} ${a.zip}`;
}

/** Franchise holder for a zone: the text inside the last parentheses of its name, if any. */
export function franchiseHolderOf(zone: Zone, address?: SeedAddress): string | undefined {
  if (address?.franchiseHolder) return address.franchiseHolder;
  const m = zone.name.match(/\(([^)]+)\)\s*$/);
  return m ? m[1] : undefined;
}

const normalise = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Every seed address whose line1 contains the query (or whose line1 the query contains), for typeahead. */
export function searchAddresses(query: string, state: MatchState = snapshot()): SeedAddress[] {
  const q = normalise(query);
  if (!q) return [];
  return Object.values(state.addresses).filter((a) => {
    if (a.id === query.trim()) return true;
    const line = normalise(a.line1);
    return line.includes(q) || q.includes(line);
  });
}

/**
 * Finds a seed address by id or by case-insensitive substring of line1 (a pasted full address that
 * contains line1 also matches). Unknown addresses land on the notServed branch with the notserved zone.
 */
export function matchAddress(query: string, state: MatchState = snapshot()): AddressMatch {
  const notServed = state.zones[NOT_SERVED_ZONE_ID];
  if (!notServed) throw new Error(`matchAddress: seed is missing ${NOT_SERVED_ZONE_ID}`);

  const address = state.addresses[query.trim()] ?? searchAddresses(query, state)[0];
  if (!address) return { query, zone: notServed, branch: 'notServed' };

  const zone = state.zones[address.zoneId];
  if (!zone) throw new Error(`matchAddress: address ${address.id} points at unknown zone ${address.zoneId}`);
  const route = address.routeId ? state.routes[address.routeId] : undefined;
  const branch: Branch = zone.serviceability;

  return {
    query,
    address,
    zone,
    route,
    branch,
    ...(branch === 'franchise' ? { franchiseHolder: franchiseHolderOf(zone, address) } : {}),
    ...(branch === 'boundary' ? { boundaryReason: address.boundaryReason ?? 'service at this address' } : {}),
  };
}
