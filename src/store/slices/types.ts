/**
 * The store contract every slice is written against.
 *
 * The root store (src/store/useStore.ts) is CoreState plus every slice in src/store/slices/index.ts, spread into one
 * flat zustand state. A slice creator gets the root store's set and get, so it can read db and call another
 * slice's action, and it must write db only through get().mutateDb(fn).
 *
 * Rules for a slice file (src/store/slices/<name>.ts):
 * - Export `interface <Name>Slice` spelled out by hand (fields and actions). Do not derive it from the creator with
 *   ReturnType: the creator's type refers to RootState, which includes the slice, and the cycle breaks the types.
 * - Export `const create<Name>Slice: SliceCreator<<Name>Slice>`.
 * - The creator must be free of side effects. reset() calls it again and uses what it returns as the fresh initial
 *   state, so the object it returns is the slice's initial state plus its actions.
 * - Keys must be unique across the whole store. The core owns db, mutateDb, and reset, and the store throws at
 *   startup (and slices.test.ts fails) when two slices claim the same key.
 */
import type { StateCreator } from 'zustand'
import type { TenantSession } from '../../tenants/types'
import type { Db } from '../db'
import type { SlicesState } from './index'

export interface CoreState {
  /** The one database every surface reads and writes (billing's table shape, addendum C1). */
  db: Db
  /**
   * The hauler whose world `db` currently is (src/tenants). A tenant is not a column on every row: it is a whole Db,
   * so switching hauler swaps `db` and nothing else in the app needs to know haulers exist.
   */
  tenantId: string
  /** Who is signed in and in which seat, or null on the sign-in screen. */
  tenantSession: TenantSession | null
  /**
   * The single write path for db. fn receives the current db and returns the next one; build new arrays, never mutate
   * the one you were given. patch, when given, returns other store fields to set in the same update, so a db write
   * and the UI state it implies land together (one render, no half-applied state). Anything patch returns for db is
   * ignored: fn decides db.
   */
  mutateDb(fn: (db: Db) => Db, patch?: (state: RootState) => Partial<RootState>): void
  /** Reload the signed-in hauler's world, return the engine clock to TODAY, and rebuild every slice from its creator. */
  reset(): void
  /**
   * Sign in to a hauler in one seat. Swaps `db` for that hauler's world, rebuilds every slice, rebinds the
   * storefront's address book, and points the portal at the seat's account. Passing a different tenant than the one
   * showing discards the current hauler's unsaved demo state, which is the point: they are separate worlds.
   */
  signIn(session: TenantSession): void
  /** Back to the sign-in screen. The hauler's world is left as it is, so signing back in continues where it was. */
  signOut(): void
}

/** The whole store: core plus every slice. Selectors and components read from this. */
export type RootState = CoreState & SlicesState

/** The type every slice creator has. */
export type SliceCreator<T extends object> = StateCreator<RootState, [], [], T>

/** Keys the core owns. No slice may return these. */
export const CORE_KEYS = ['db', 'tenantId', 'tenantSession', 'mutateDb', 'reset', 'signIn', 'signOut'] as const
