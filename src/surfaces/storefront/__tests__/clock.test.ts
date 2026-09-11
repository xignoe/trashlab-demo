import { afterEach, describe, expect, it } from 'vitest';
import { setToday } from '../../../store/clock';
import {
  addDays, addHours, addMonths, dayBefore, formatDateTime, formatDay, nextBusinessDay, nextServiceDays, now, today,
  weekdayOf, wholeMonthsBetween,
} from '../lib/clock';

afterEach(() => setToday());

describe('storefront clock', () => {
  it('reads the engine clock: 2026-09-10, a Thursday, at 10:00 AM Eastern', () => {
    expect(today()).toBe('2026-09-10');
    expect(weekdayOf(today())).toBe('Thu');
    expect(now()).toBe('2026-09-10T10:00:00-04:00');
  });

  it('follows the engine clock when the billing run moves it', () => {
    setToday('2026-10-10');
    expect(today()).toBe('2026-10-10');
    expect(now()).toBe('2026-10-10T10:00:00-04:00');
    expect(nextServiceDays('Tue', 1)).toEqual(['2026-10-13']);
  });

  it('nextServiceDays returns the next N occurrences strictly after from', () => {
    expect(nextServiceDays('Tue', 2)).toEqual(['2026-09-15', '2026-09-22']);
    expect(nextServiceDays('Mon', 2)).toEqual(['2026-09-14', '2026-09-21']);
    expect(nextServiceDays('Thu', 1)).toEqual(['2026-09-17']);
    expect(nextServiceDays('Tue', 1, '2026-09-15')).toEqual(['2026-09-22']);
  });

  it('day arithmetic', () => {
    expect(dayBefore('2026-09-15')).toBe('2026-09-14');
    expect(dayBefore('2026-10-01')).toBe('2026-09-30');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addMonths('2026-09-15', 3)).toBe('2026-12-15');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(wholeMonthsBetween('2026-09-15', '2026-12-15')).toBe(3);
    expect(wholeMonthsBetween('2026-09-15', '2026-12-14')).toBe(2);
  });

  it('addHours keeps the offset and crosses days', () => {
    expect(addHours(now(), 72)).toBe('2026-09-13T10:00:00-04:00');
    expect(addHours(now(), 7 * 24)).toBe('2026-09-17T10:00:00-04:00');
    expect(addHours('2026-09-10', 1)).toBe('2026-09-10T01:00:00-04:00');
    expect(addHours('2026-09-10T23:30:00Z', 1)).toBe('2026-09-11T00:30:00Z');
  });

  it('formats days and deadlines', () => {
    expect(formatDay('2026-09-15')).toBe('Tue Sep 15');
    expect(formatDay(now())).toBe('Thu Sep 10');
    expect(formatDateTime(addHours(now(), 72))).toBe('Sun Sep 13 at 10:00 AM');
    expect(formatDateTime('2026-09-11T17:05:00-04:00')).toBe('Fri Sep 11 at 5:05 PM');
  });

  it('nextBusinessDay skips weekends', () => {
    expect(nextBusinessDay(today())).toBe('2026-09-11');
    expect(nextBusinessDay('2026-09-11')).toBe('2026-09-14');
  });
});
