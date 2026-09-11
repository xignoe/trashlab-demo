/**
 * The single zustand store for the merged app (CHECKLIST.md box 1.5).
 *
 * State is CoreState (db, mutateDb, reset) plus every slice in ./slices/index.ts, spread flat. On create it binds the
 * engine to the live state (setEngineDb(() => get().db)), so every engine read without an explicit db sees the
 * current store. Every db write in every surface goes through mutateDb(fn).
 *
 * Phase 2 never edits this file. A surface adds state and actions in src/store/slices/<name>.ts only.
 */
import { create, type StoreApi } from 'zustand'
import { loadSeed } from '../seed'
import { setToday } from './clock'
import { setEngineDb } from './db'
import { sliceRegistry, type SliceName, type SlicesState } from './slices'
import { initialBillingData } from './slices/billing'
import { CORE_KEYS, type CoreState, type RootState } from './slices/types'
import type { StoreData } from './state'

export { DEFAULT_ACTOR, DEFAULT_CYCLE_DATE, computePriorChanges, type BillingActions } from './slices/billing'
export type { CoreState, RootState } from './slices/types'

/** Billing's name for the whole store type, kept so billing's selectors and tests read unchanged. */
export type StoreState = RootState

/** The data billing's selectors read (db plus billing UI state), fresh from the seed. Tests build worlds from it. */
export function initialData(): StoreData {
  return { db: loadSeed(), ...initialBillingData() }
}

type SetState = StoreApi<RootState>['setState']
type GetState = StoreApi<RootState>['getState']

/**
 * Run every slice creator and merge the results. Throws when a slice returns a core key or a key another slice
 * already returned, naming both, so a collision fails at startup instead of silently overwriting an action.
 */
export function composeSlices(set: SetState, get: GetState, api: StoreApi<RootState>): SlicesState {
  const merged: Record<string, unknown> = {}
  const owner: Record<string, SliceName | 'core'> = Object.fromEntries(CORE_KEYS.map(k => [k, 'core' as const]))
  for (const name of Object.keys(sliceRegistry) as SliceName[]) {
    const part = sliceRegistry[name](set, get, api) as object
    for (const key of Object.keys(part)) {
      if (key in owner) throw new Error(`Store key "${key}" from the ${name} slice is already owned by ${owner[key]}`)
      owner[key] = name
    }
    Object.assign(merged, part)
  }
  return merged as unknown as SlicesState
}

export const useStore = create<RootState>()((set, get, api) => {
  // Engine reads always see the current store.
  setEngineDb(() => get().db)

  const core: CoreState = {
    db: loadSeed(),

    mutateDb(fn, patch) {
      set(s => {
        const db = fn(s.db)
        return patch ? { ...patch(s), db } : { db }
      })
    },

    reset() {
      setToday()
      set({ db: loadSeed(), ...composeSlices(set, get, api) })
    },
  }

  return { ...core, ...composeSlices(set, get, api) }
})
