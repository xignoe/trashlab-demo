/**
 * Addendum E1: the engine clock lives in src/store/clock.ts, runtime timestamps are Eastern daylight time, and
 * Next cycle moves the clock one month (DECISIONS.md entry 41).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { setToday, stamp, today, TODAY, TZ_OFFSET } from './clock'
import { today as engineToday } from './engine'
import { addDays, addMonths, daysInMonth } from './cycles'
import { cycleWindow, leakage, queueItems } from './selectors'
import { resetChargeIds } from './engine'
import { useStore } from './useStore'

const store = () => useStore.getState()

beforeEach(() => {
  store().reset()
  resetChargeIds()
})

describe('clock', () => {
  it('starts on TODAY 2026-09-10, and engine.ts reads the same clock', () => {
    expect(TODAY).toBe('2026-09-10')
    expect(today()).toBe(TODAY)
    expect(engineToday()).toBe(TODAY)
    setToday('2026-10-10T08:30:00-04:00')
    expect(engineToday()).toBe('2026-10-10')
    setToday()
    expect(today()).toBe(TODAY)
  })

  it('stamps runtime timestamps at noon Eastern daylight time (-04:00)', () => {
    expect(TZ_OFFSET).toBe('-04:00')
    expect(stamp()).toBe('2026-09-10T12:00:00-04:00')
  })

  it('refuses a value that is not an ISO date', () => {
    expect(() => setToday('Sep 10')).toThrow(/ISO date/)
  })

  it('no file in src/store constructs a Date outside clock.ts and tests (static scan)', () => {
    const dir = join(process.cwd(), 'src/store')
    const offenders = readdirSync(dir)
      .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'clock.ts')
      .filter(f => readFileSync(join(dir, f), 'utf8').includes('new Date('))
    expect(offenders).toEqual([])
  })
})

describe('calendar math without Date', () => {
  it('daysInMonth follows the Gregorian leap rule', () => {
    expect([daysInMonth(2024, 2), daysInMonth(2026, 2), daysInMonth(2000, 2), daysInMonth(1900, 2)]).toEqual([29, 28, 29, 28])
    expect(daysInMonth(2026, 9)).toBe(30)
  })

  it('addDays agrees with a day by day walk across month, year, and leap boundaries', () => {
    expect(addDays('2026-09-10', 15)).toBe('2026-09-25')
    expect(addDays('2026-12-25', 30)).toBe('2027-01-24')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
    expect(addDays('1970-01-01', 0)).toBe('1970-01-01')
  })

  it('addMonths keeps the day and clamps to the month end', () => {
    expect(addMonths('2026-09-10', 1)).toBe('2026-10-10')
    expect(addMonths('2026-12-10', 1)).toBe('2027-01-10')
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28')
    expect(addMonths('2026-01-15', -2)).toBe('2025-11-15')
  })
})

describe('Next cycle moves the clock one month (DECISIONS.md entry 41)', () => {
  it('advanceCycle moves the clock to 2026-10-10 and reset returns it to TODAY', () => {
    store().runCycle()
    store().advanceCycle()
    expect(store().cycleDate).toBe('2026-11-01')
    expect(today()).toBe('2026-10-10')
    store().reset()
    expect(today()).toBe(TODAY)
  })

  it('a waive in the November run is stamped Oct 10 and counts toward the Nov 1 cycle, not Oct 1', () => {
    store().publishRateVersionStub({ catalogId: 'cat_res_96', priceCents: 3100, effectiveFrom: '2026-11-01', zoneId: 'zone_open' })
    store().advanceCycle()
    store().runCycle()
    const item = queueItems(store()).find(i => !i.decided)!
    const before = leakage(store())
    store().waive(item.chargeId, 'goodwill')
    const row = store().db.waivedCharges.at(-1)!
    expect(row.at).toBe('2026-10-10T12:00:00-04:00')
    expect(cycleWindow('2026-11-01')).toEqual({ from: '2026-10-01', to: '2026-11-01' })
    const after = leakage(store())
    expect(after.cycles.at(-1)!.cents - before.cycles.at(-1)!.cents).toBe(store().db.charges.find(c => c.id === item.chargeId)!.totalCents)
  })

  it('invoices posted from the November run are issued and posted on 2026-10-10', () => {
    store().advanceCycle()
    store().runCycle()
    for (const item of queueItems(store())) if (!item.decided) store().approve(item.chargeId)
    store().bulkApproveClean()
    const invoices = store().post()
    expect(invoices.length).toBeGreaterThan(0)
    for (const inv of invoices) {
      expect(inv.issuedAt).toBe('2026-10-10')
      expect(inv.postedAt).toBe('2026-10-10T12:00:00-04:00')
    }
  })
})
