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
import { DEFAULT_TENANT_ID, tenantById } from '../tenants'
import type { TenantSession } from '../tenants/types'
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

/**
 * Which hauler you are signed in to, remembered across a page reload.
 *
 * Every other piece of demo state is deliberately in memory, so a reload returns to the seed. The signed-in hauler is
 * the exception: dropping it would land a reload in a different company's data without saying so, which is the one
 * thing a build serving several haulers must never do quietly. Only the seat is kept, never the hauler's data, so a
 * reload still starts that hauler's world fresh.
 *
 * sessionStorage rather than localStorage, so a new tab starts at the sign-in screen. Guarded because tests run with
 * no DOM, and a browser set to block site data throws on access rather than returning null.
 */
const SESSION_KEY = 'trashlab.session'

function readStoredSession(): TenantSession | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as TenantSession
    // A hauler that no longer exists (a renamed or removed tenant) falls back to the sign-in screen.
    tenantById(session.tenantId)
    return session
  } catch {
    return null
  }
}

function writeStoredSession(session: TenantSession | null): void {
  try {
    if (session) globalThis.sessionStorage?.setItem(SESSION_KEY, JSON.stringify(session))
    else globalThis.sessionStorage?.removeItem(SESSION_KEY)
  } catch {
    // A browser that refuses storage still signs in; it just forgets on reload.
  }
}

export const useStore = create<RootState>()((set, get, api) => {
  // Engine reads always see the current store.
  setEngineDb(() => get().db)

  const restored = readStoredSession()

  /**
   * Load a hauler's world: its Db, a fresh set of slices, its address book, and the demo clock back at TODAY. Every
   * caller that changes which hauler is showing goes through here, so none of them can forget one of the four.
   */
  function loadTenant(tenantId: string, session: TenantSession | null) {
    const tenant = tenantById(tenantId)
    setToday()
    set({ db: tenant.buildDb(), ...composeSlices(set, get, api), tenantId, tenantSession: session })
    // After the slices are fresh, point the portal at an account this hauler actually has. A customer seat names one;
    // a staff seat gets the hauler's first customer, so opening the portal never lands on another hauler's account.
    const accountId = session?.accountId ?? tenant.logins[0]?.accountId
    if (accountId) get().portalSwitchAccount(accountId)
  }

  const core: CoreState = {
    // A reload comes back to the hauler it left, with that hauler's world rebuilt from its configuration.
    db: tenantById(restored?.tenantId ?? DEFAULT_TENANT_ID).buildDb(),
    tenantId: restored?.tenantId ?? DEFAULT_TENANT_ID,
    tenantSession: restored,

    mutateDb(fn, patch) {
      set(s => {
        const db = fn(s.db)
        return patch ? { ...patch(s), db } : { db }
      })
    },

    reset() {
      loadTenant(get().tenantId, get().tenantSession)
    },

    signIn(session) {
      writeStoredSession(session)
      loadTenant(session.tenantId, session)
    },

    signOut() {
      writeStoredSession(null)
      set({ tenantSession: null })
    },
  }

  return { ...core, ...composeSlices(set, get, api) }
})

/**
 * Finish restoring a signed-in session.
 *
 * The store's initial state builds the restored hauler's Db, but the portal slice is created with its own default
 * account, which belongs to the seeded hauler. Without this the portal opens on an account the restored hauler does
 * not have and the Overview crashes. loadTenant does the same thing for every later sign-in; this covers the one path
 * that does not go through it, a page load with a session already stored.
 */
{
  const { tenantSession, tenantId, portalSwitchAccount } = useStore.getState()
  if (tenantSession) {
    const accountId = tenantSession.accountId ?? tenantById(tenantId).logins[0]?.accountId
    if (accountId) portalSwitchAccount(accountId)
  }
}
