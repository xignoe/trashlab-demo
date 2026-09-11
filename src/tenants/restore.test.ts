// @vitest-environment jsdom
/**
 * A page load that finds a stored session opens that hauler's world, pointed at an account that hauler has.
 *
 * This is its own file because it has to arrange the stored session before the store module is first evaluated, which
 * means resetting the module registry. The bug it pins: the store's initial state built the restored hauler's Db, but
 * the portal slice kept its own default account, which belongs to the seeded hauler. The portal then opened on an
 * account that did not exist and the Overview screen crashed on a blank page.
 */
import { describe, expect, it, vi } from 'vitest'

const KEY = 'trashlab.session'

/** Store a session, then load the store module fresh, as a page load with that session would. */
async function loadWith(session: unknown) {
  window.sessionStorage.setItem(KEY, JSON.stringify(session))
  vi.resetModules()
  const { useStore } = await import('../store/useStore')
  return useStore.getState()
}

describe('a page load with a stored session', () => {
  it('restores a customer seat onto that customer, in that hauler', async () => {
    const state = await loadWith({ tenantId: 'direct-waste', role: 'customer', accountId: 'acct_dw_okafor', name: 'Grace Okafor' })

    expect(state.tenantId).toBe('direct-waste')
    expect(state.db.hauler[0].name).toBe('Direct Waste Services')
    expect(state.portalSession.accountId).toBe('acct_dw_okafor')
    // The account the portal opens must exist in the restored hauler's world, or every portal screen throws.
    expect(state.db.accounts.some(a => a.id === state.portalSession.accountId)).toBe(true)
  })

  it('restores a staff seat onto one of that hauler\'s own customers', async () => {
    const state = await loadWith({ tenantId: 'omni-waste', role: 'office', name: 'Omni Waste office' })

    expect(state.tenantId).toBe('omni-waste')
    expect(state.db.accounts.some(a => a.id === state.portalSession.accountId)).toBe(true)
  })

  it('falls back to the seeded hauler when the stored session names one that is gone', async () => {
    const state = await loadWith({ tenantId: 'a-hauler-that-was-removed', role: 'office', name: 'Nobody' })

    expect(state.tenantId).toBe('piedmont')
    expect(state.tenantSession).toBeNull()
    expect(state.db.accounts.some(a => a.id === state.portalSession.accountId)).toBe(true)
  })
})
