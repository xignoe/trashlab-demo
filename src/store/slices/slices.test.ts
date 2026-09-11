import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { create } from 'zustand'
import { loadSeed } from '../../seed'
import { setToday, today, TODAY } from '../clock'
import { getEngineDb } from '../db'
import { findAccount } from '../engine'
import { composeSlices, DEFAULT_CYCLE_DATE, useStore, type RootState } from '../useStore'
import { SLICE_NAMES, sliceRegistry } from './index'
import { CORE_KEYS } from './types'

const store = () => useStore.getState()

beforeEach(() => store().reset())
afterEach(() => setToday())

describe('slice registry (box 1.6)', () => {
  it('lists billing and the four ported surfaces', () => {
    expect(SLICE_NAMES).toEqual(['billing', 'account', 'pricing', 'portal', 'storefront'])
  })

  it('every slice returns an object, never claims a core key, and no two slices share a key', () => {
    const api = useStore
    const owner = new Map<string, string>()
    for (const name of SLICE_NAMES) {
      const slice = sliceRegistry[name](api.setState, api.getState, api)
      expect(typeof slice).toBe('object')
      for (const key of Object.keys(slice)) {
        expect(CORE_KEYS as readonly string[]).not.toContain(key)
        expect(owner.get(key), `"${key}" is claimed by both ${owner.get(key)} and ${name}`).toBeUndefined()
        owner.set(key, name)
      }
    }
  })

  it('billing contributes its UI state and actions and never a core key', () => {
    const keys = Object.keys(sliceRegistry.billing(useStore.setState, useStore.getState, useStore))
    expect(keys).toEqual(expect.arrayContaining(['cycleDate', 'runs', 'runCycle', 'approve', 'waive', 'post', 'applyUnapplied']))
    for (const k of CORE_KEYS) expect(keys).not.toContain(k)
  })

  it('composition refuses a key two slices both claim', () => {
    const original = sliceRegistry.account
    ;(sliceRegistry as unknown as Record<string, unknown>).account = () => ({ approve: () => undefined })
    try {
      expect(() => create<RootState>()((set, get, api) => ({ ...composeSlices(set, get, api) } as RootState)))
        .toThrow(/"approve" from the account slice is already owned by billing/)
    } finally {
      ;(sliceRegistry as unknown as Record<string, unknown>).account = original
    }
  })
})

describe('root store (box 1.5)', () => {
  it('holds db and binds the engine to it', () => {
    expect(store().db.accounts.length).toBe(45)
    expect(getEngineDb()).toBe(store().db)
  })

  it('mutateDb writes db and its patch in one update, and the engine sees the new db', () => {
    let updates = 0
    const unsub = useStore.subscribe(() => { updates++ })
    store().mutateDb(
      db => ({ ...db, accounts: db.accounts.map(a => (a.id === 'acct_res_maple' ? { ...a, deliveryMethod: 'portal' as const } : a)) }),
      () => ({ cycleDate: '2026-11-01' }),
    )
    unsub()
    expect(updates).toBe(1)
    expect(store().cycleDate).toBe('2026-11-01')
    expect(findAccount('acct_res_maple').deliveryMethod).toBe('portal')
  })

  it('mutateDb ignores db from the patch: fn decides db', () => {
    const before = store().db
    store().mutateDb(db => db, () => ({ db: loadSeed() }))
    expect(store().db).toBe(before)
  })

  it('reset restores the seed, every slice, and the clock', () => {
    store().runCycle()
    store().mutateDb(db => ({ ...db, accounts: [] }))
    setToday('2026-10-10')
    store().reset()
    expect(store().db.accounts.length).toBe(45)
    expect(store().runs).toEqual({})
    expect(store().cycleDate).toBe(DEFAULT_CYCLE_DATE)
    expect(today()).toBe(TODAY)
  })
})
