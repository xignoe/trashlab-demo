import { describe, expect, it } from 'vitest';
import { formatAddress, matchAddress, searchAddresses } from '../serviceability';

describe('matchAddress', () => {
  it('matches by id and by case-insensitive substring of line1', () => {
    expect(matchAddress('addr_open_single').address?.id).toBe('addr_open_single');
    expect(matchAddress('larkspur').address?.id).toBe('addr_open_single');
    expect(matchAddress('  412 LARKSPUR ').address?.id).toBe('addr_open_single');
    expect(matchAddress('412 Larkspur Ln, Piedmont, GA 30512').address?.id).toBe('addr_open_single');
  });

  it('returns the branch, zone, and route for each seed address', () => {
    const open = matchAddress('88 Copper Kettle Ct');
    expect(open).toMatchObject({ branch: 'open', zone: { id: 'zone_open' }, route: { id: 'route_mon_res', day: 'Mon' } });
    const franchise = matchAddress('530 Main St');
    expect(franchise).toMatchObject({ branch: 'franchise', franchiseHolder: 'Southeast Sanitation' });
    expect(franchise.route).toBeUndefined();
    const boundary = matchAddress('Ridge Hollow');
    expect(boundary).toMatchObject({ branch: 'boundary', boundaryReason: 'private road access', zone: { id: 'zone_boundary' }, route: { id: 'route_tue_res' } });
    expect(matchAddress('Commerce Way')).toMatchObject({ branch: 'open', route: { id: 'route_wed_fl' } });
  });

  it('unknown or empty addresses land on notServed', () => {
    expect(matchAddress('1 Nowhere Rd')).toMatchObject({ branch: 'notServed', zone: { id: 'zone_notserved' } });
    expect(matchAddress('1 Nowhere Rd').address).toBeUndefined();
    expect(matchAddress('').branch).toBe('notServed');
  });

  it('searchAddresses lists every match for typeahead', () => {
    expect(searchAddresses('ow').map((a) => a.id)).toEqual(['addr_open_recycling', 'addr_boundary']);
    expect(searchAddresses('ST').map((a) => a.id)).toEqual(['addr_franchise']);
    expect(searchAddresses('')).toEqual([]);
    expect(formatAddress(searchAddresses('Ridge')[0])).toBe('1180 Ridge Hollow Rd, Piedmont, GA 30512');
  });
});
