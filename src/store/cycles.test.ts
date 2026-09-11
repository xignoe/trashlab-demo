import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, daysInMonth, isDue, nextCycleDate, periodFor, periodLabel, priorCycleDate, shortDate, wholeMonths } from './cycles'

describe('wholeMonths (addendum C5, Phase 3.2a: month arithmetic from the period start)', () => {
  it('every calendar-aligned period counts as before', () => {
    expect(wholeMonths({ start: '2026-10-01', end: '2026-12-31' })).toBe(3)
    expect(wholeMonths({ start: '2026-07-01', end: '2026-09-30' })).toBe(3)
    expect(wholeMonths({ start: '2026-10-01', end: '2026-10-31' })).toBe(1)
    expect(wholeMonths({ start: '2026-02-01', end: '2026-02-28' })).toBe(1)
    expect(wholeMonths({ start: '2026-01-01', end: '2026-12-31' })).toBe(12)
  })

  it('a mid-month quarter is 3 months: Sep 15 to Dec 14 (inclusive end), and Sep 15 to Dec 15 read tolerantly', () => {
    expect(wholeMonths({ start: '2026-09-15', end: '2026-12-14' })).toBe(3)
    expect(wholeMonths({ start: '2026-09-15', end: '2026-12-15' })).toBe(3)
    expect(wholeMonths({ start: '2026-09-15', end: '2026-12-13' })).toBe(2)
    expect(wholeMonths({ start: '2026-09-14', end: '2026-12-13' })).toBe(3)
  })

  it('clamps month ends (Jan 31 plus one month is Feb 28) and floors a partial period at 1', () => {
    expect(wholeMonths({ start: '2026-01-31', end: '2026-02-27' })).toBe(1)
    expect(wholeMonths({ start: '2026-01-31', end: '2026-04-29' })).toBe(3)
    expect(wholeMonths({ start: '2026-09-15', end: '2026-09-20' })).toBe(1)
    expect(wholeMonths({ start: '2026-09-15', end: '2026-09-15' })).toBe(1)
  })

  it('daysBetween counts calendar days (Aug 7 to Sep 10 is 34, across a leap day too)', () => {
    expect(daysBetween('2026-08-07', '2026-09-10')).toBe(34)
    expect(daysBetween('2026-09-10', '2026-09-10')).toBe(0)
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2)
    expect(daysBetween('2026-09-10', '2026-09-07')).toBe(-3)
  })
})

const monthly = { cycle: 'monthly' as const }
const net30 = { cycle: 'net30' as const }
const quarterly = { cycle: 'quarterly' as const }
const perJob = { cycle: 'perJob' as const }

describe('isDue', () => {
  it('monthly and net30 are due on day 1 of any month and never on another day', () => {
    for (const a of [monthly, net30]) {
      expect(isDue(a, '2026-10-01')).toBe(true)
      expect(isDue(a, '2026-11-01')).toBe(true)
      expect(isDue(a, '2026-02-01')).toBe(true)
      expect(isDue(a, '2026-10-02')).toBe(false)
      expect(isDue(a, '2026-10-15')).toBe(false)
    }
  })

  it('quarterly is due only on Jan 1, Apr 1, Jul 1, Oct 1', () => {
    expect(isDue(quarterly, '2026-01-01')).toBe(true)
    expect(isDue(quarterly, '2026-04-01')).toBe(true)
    expect(isDue(quarterly, '2026-07-01')).toBe(true)
    expect(isDue(quarterly, '2026-10-01')).toBe(true)
    expect(isDue(quarterly, '2026-11-01')).toBe(false)
    expect(isDue(quarterly, '2026-12-01')).toBe(false)
    expect(isDue(quarterly, '2026-10-02')).toBe(false)
  })

  it('perJob is never due', () => {
    expect(isDue(perJob, '2026-10-01')).toBe(false)
    expect(isDue(perJob, '2026-01-01')).toBe(false)
  })

  it('accepts a full timestamp and compares by calendar day', () => {
    expect(isDue(monthly, '2026-10-01T00:00:00-04:00')).toBe(true)
  })
})

describe('periodFor', () => {
  it('monthly and net30 cover the first to the last day of that month', () => {
    expect(periodFor(monthly, '2026-10-01')).toEqual({ start: '2026-10-01', end: '2026-10-31' })
    expect(periodFor(net30, '2026-11-01')).toEqual({ start: '2026-11-01', end: '2026-11-30' })
    expect(periodFor(monthly, '2028-02-01')).toEqual({ start: '2028-02-01', end: '2028-02-29' })
  })

  it('quarterly covers three months', () => {
    expect(periodFor(quarterly, '2026-10-01')).toEqual({ start: '2026-10-01', end: '2026-12-31' })
    expect(periodFor(quarterly, '2026-07-01')).toEqual({ start: '2026-07-01', end: '2026-09-30' })
    expect(periodFor(quarterly, '2026-01-01')).toEqual({ start: '2026-01-01', end: '2026-03-31' })
  })

  it('perJob falls back to a one month period for reporting', () => {
    expect(periodFor(perJob, '2026-10-01')).toEqual({ start: '2026-10-01', end: '2026-10-31' })
  })
})

describe('priorCycleDate', () => {
  it('monthly and net30 step back one month', () => {
    expect(priorCycleDate(monthly, '2026-10-01')).toBe('2026-09-01')
    expect(priorCycleDate(net30, '2026-01-01')).toBe('2025-12-01')
  })

  it('quarterly steps back to the previous quarter start', () => {
    expect(priorCycleDate(quarterly, '2026-10-01')).toBe('2026-07-01')
    expect(priorCycleDate(quarterly, '2026-01-01')).toBe('2025-10-01')
  })

  it('from a date that is not a due date, returns the latest due date before it', () => {
    expect(priorCycleDate(quarterly, '2026-11-01')).toBe('2026-10-01')
    expect(priorCycleDate(monthly, '2026-10-15')).toBe('2026-10-01')
  })

  it('perJob returns the prior month start so reporting has a value', () => {
    expect(priorCycleDate(perJob, '2026-10-01')).toBe('2026-09-01')
  })
})

describe('nextCycleDate', () => {
  it('monthly moves to the next month start, quarterly to the next quarter start', () => {
    expect(nextCycleDate(monthly, '2026-10-01')).toBe('2026-11-01')
    expect(nextCycleDate(monthly, '2026-12-01')).toBe('2027-01-01')
    expect(nextCycleDate(quarterly, '2026-10-01')).toBe('2027-01-01')
    expect(nextCycleDate(quarterly, '2026-11-01')).toBe('2027-01-01')
  })
})

describe('date helpers', () => {
  it('daysInMonth handles leap years', () => {
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2026, 12)).toBe(31)
  })

  it('addDays crosses month and year ends', () => {
    expect(addDays('2026-09-10', 15)).toBe('2026-09-25')
    expect(addDays('2026-09-10', 30)).toBe('2026-10-10')
    expect(addDays('2026-12-20', 15)).toBe('2027-01-04')
  })

  it('labels read like the seed descriptions', () => {
    expect(shortDate('2026-10-01')).toBe('Oct 1')
    expect(periodLabel({ start: '2026-10-01', end: '2026-12-31' })).toBe('Oct 1 to Dec 31')
  })
})
