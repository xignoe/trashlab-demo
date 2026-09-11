import { beforeEach, describe, expect, it } from 'vitest';
import { ADDRESSES } from '../../../seed';
import { useStore } from '../../../store/useStore';
import { formatAddress, matchAddress, searchAddresses } from '../lib/serviceability';
import { ADDRESS_BOOK, viewOf } from '../lib/view';

const view = () => viewOf(useStore.getState());
beforeEach(() => useStore.getState().reset());

describe('the address book (box 2D.3)', () => {
  it('is src/seed/addresses.json through the seed index, never a Db table', () => {
    expect(Object.keys(ADDRESS_BOOK)).toEqual(ADDRESSES.map((a) => a.id));
    expect(Object.keys(ADDRESS_BOOK)).toEqual([
      'addr_open_single', 'addr_open_second_cart', 'addr_open_recycling', 'addr_franchise', 'addr_boundary', 'addr_commercial',
    ]);
    expect('addresses' in useStore.getState().db).toBe(false);
    // Every zone and route an address names is a shared seed id in the merged Db.
    for (const a of ADDRESSES) {
      expect(view().zones[a.zoneId], a.id).toBeDefined();
      if (a.routeId) expect(view().routes[a.routeId], a.id).toBeDefined();
    }
  });
});

describe('matchAddress', () => {
  it('matches by id and by case-insensitive substring of line1', () => {
    expect(matchAddress('addr_open_single', view()).address?.id).toBe('addr_open_single');
    expect(matchAddress('larkspur', view()).address?.id).toBe('addr_open_single');
    expect(matchAddress('  412 LARKSPUR ', view()).address?.id).toBe('addr_open_single');
    expect(matchAddress('412 Larkspur Ln, Piedmont, GA 30512', view()).address?.id).toBe('addr_open_single');
  });

  it('returns the branch, zone, and route for each address', () => {
    const open = matchAddress('88 Copper Kettle Ct', view());
    expect(open).toMatchObject({ branch: 'open', zone: { id: 'zone_open' }, route: { id: 'route_mon_res', day: 'Mon' } });
    const franchise = matchAddress('530 Main St', view());
    expect(franchise).toMatchObject({ branch: 'franchise', franchiseHolder: 'Southeast Sanitation' });
    expect(franchise.route).toBeUndefined();
    const boundary = matchAddress('Ridge Hollow', view());
    expect(boundary).toMatchObject({ branch: 'boundary', boundaryReason: 'private road access', zone: { id: 'zone_boundary' }, route: { id: 'route_tue_res' } });
    expect(matchAddress('Commerce Way', view())).toMatchObject({ branch: 'open', route: { id: 'route_wed_fl' } });
  });

  it('unknown or empty addresses land on notServed', () => {
    expect(matchAddress('1 Nowhere Rd', view())).toMatchObject({ branch: 'notServed', zone: { id: 'zone_notserved' } });
    expect(matchAddress('1 Nowhere Rd', view()).address).toBeUndefined();
    expect(matchAddress('', view()).branch).toBe('notServed');
  });

  it('searchAddresses lists every match for typeahead', () => {
    expect(searchAddresses('ow', view()).map((a) => a.id)).toEqual(['addr_open_recycling', 'addr_boundary']);
    expect(searchAddresses('ST', view()).map((a) => a.id)).toEqual(['addr_franchise']);
    expect(searchAddresses('', view())).toEqual([]);
    expect(formatAddress(searchAddresses('Ridge', view())[0])).toBe('1180 Ridge Hollow Rd, Piedmont, GA 30512');
  });
});
