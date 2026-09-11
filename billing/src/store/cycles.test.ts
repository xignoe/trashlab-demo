import { describe, expect, it } from 'vitest'
import { addDays, daysInMonth, isDue, nextCycleDate, periodFor, periodLabel, priorCycleDate, shortDate } from './cycles'

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
