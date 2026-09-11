import type { Seed } from '../seed'

/**
 * Db is the in-memory database: one array per table, typed from src/types.ts.
 * It is exactly the Seed shape so `loadSeed()` is a valid Db and the zustand
 * store (Phase 4) can hold a Db directly in its state.
 */
export type Db = Seed

/** A Db, or a getter that returns the current Db (the store binds a getter so engine reads always see live state). */
export type DbSource = Db | (() => Db)

let source: DbSource | null = null

function isGetter(s: DbSource): s is () => Db {
  return typeof s === 'function'
}

/**
 * Bind the db the engine reads from. Pass a Db (tests inject a seed clone) or a
 * getter (the store passes `() => useStore.getState().db`).
 */
export function setEngineDb(db: DbSource): void {
  source = db
}

/** Clear the binding. Tests call this in afterEach so a forgotten setEngineDb fails loudly. */
export function clearEngineDb(): void {
  source = null
}

/** Whether an engine db is currently bound. */
export function hasEngineDb(): boolean {
  return source !== null
}

/** The db every engine function reads through. Throws when nothing is bound rather than silently reading an empty db. */
export function getEngineDb(): Db {
  if (source === null) {
    throw new Error('Engine db is not set. Call setEngineDb(loadSeed()) in tests or let the store bind it.')
  }
  return isGetter(source) ? source() : source
}

/**
 * Run `fn` with a different db bound, then restore the previous binding.
 * Phase 3 uses this to run a prior-cycle comparison on a throwaway clone
 * without touching the live store.
 */
export function withEngineDb<T>(db: DbSource, fn: () => T): T {
  const previous = source
  source = db
  try {
    return fn()
  } finally {
    source = previous
  }
}

/** An empty Db with every table present, for tests that build a tiny world by hand. */
export function emptyDb(): Db {
  return {
    hauler: [], zones: [], routes: [], catalog: [], containers: [], parties: [], accounts: [], sites: [],
    serviceItems: [], rateVersions: [], feeRules: [], taxRules: [], contracts: [], quotes: [], workOrders: [],
    serviceEvents: [], scaleTickets: [], charges: [], waivedCharges: [], invoices: [], creditMemos: [],
    payments: [], allocations: [], processorBatches: [], requests: [],
  }
}
