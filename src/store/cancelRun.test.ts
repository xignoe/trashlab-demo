import { beforeEach, describe, expect, it } from 'vitest'
import { queueItems } from './selectors'
import { useStore } from './useStore'

const store = () => useStore.getState()

beforeEach(() => store().reset())

describe('cancelRun: undoing a run before anything posts', () => {
  it('removes the run and every charge it generated, approvals and edits included, and leaves the rest of db alone', () => {
    const before = store().db
    store().runCycle()
    const [first, second] = queueItems(store()).filter(i => !i.decided)
    store().approve(first.chargeId)
    store().editAmount(second.chargeId, second.charge.baseCents + 100, 'test edit')
    store().bulkApproveClean()

    const result = store().cancelRun()
    expect(result.decided).toBeGreaterThan(2)
    expect(store().runs).toEqual({})
    expect(store().edits).toEqual([])
    expect(store().db.charges).toEqual(before.charges)
    expect(store().db.invoices).toBe(before.invoices)

    // The cycle can run again and generates the same charges.
    const rerun = store().runCycle()
    expect(rerun.chargeIds).toHaveLength(result.removed)
  })

  it('refuses once a charge in the run is waived (a waive is never deleted) and writes nothing', () => {
    store().runCycle()
    const item = queueItems(store()).find(i => !i.decided)!
    store().waive(item.chargeId, 'goodwill')
    const db = store().db
    expect(() => store().cancelRun()).toThrow('a waive is never deleted')
    expect(store().db).toBe(db)
  })

  it('refuses once the run has posted, and when the cycle has not run', () => {
    expect(() => store().cancelRun()).toThrow('has not run')
    store().runCycle()
    for (const i of queueItems(store())) if (!i.decided) store().approve(i.chargeId)
    store().bulkApproveClean()
    store().post()
    expect(() => store().cancelRun()).toThrow('has posted invoices')
  })
})
