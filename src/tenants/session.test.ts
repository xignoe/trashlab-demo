// @vitest-environment jsdom
/**
 * The signed-in hauler survives a page reload.
 *
 * Every other piece of demo state is in memory on purpose, so a reload returns to the seed. The hauler is the
 * exception: without it a reload drops you into a different company's data with no warning, which is the one failure
 * a build serving several haulers cannot have. These tests pin the storage contract the reload path depends on.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../store/useStore'
import { piedmont } from '.'

const store = () => useStore.getState()
const stored = () => JSON.parse(window.sessionStorage.getItem('trashlab.session') ?? 'null')
const signInToPiedmont = () => store().signIn({ tenantId: piedmont.id, role: 'office', name: 'Piedmont office' })

beforeEach(() => {
  window.sessionStorage.clear()
  signInToPiedmont()
})

/** Leave the seeded hauler signed in, so a later file in this worker starts where it expects to. */
afterAll(() => {
  window.sessionStorage.clear()
  signInToPiedmont()
})

describe('the signed-in hauler', () => {
  it('is written to session storage on sign in, so a reload can come back to it', () => {
    store().signIn({ tenantId: 'omni-waste', role: 'customer', accountId: 'acct_om_hudson', name: 'Hudson Demolition Co' })
    expect(stored()).toEqual({ tenantId: 'omni-waste', role: 'customer', accountId: 'acct_om_hudson', name: 'Hudson Demolition Co' })
  })

  it('is cleared on sign out, so the next load starts at the sign-in screen', () => {
    store().signIn({ tenantId: 'direct-waste', role: 'office', name: 'Direct Waste office' })
    expect(stored()).not.toBeNull()
    store().signOut()
    expect(stored()).toBeNull()
    expect(store().tenantSession).toBeNull()
  })

  it('survives reset, which reloads the hauler rather than leaving it', () => {
    store().signIn({ tenantId: 'waste-industries', role: 'office', name: 'Waste Industries office' })
    store().reset()
    expect(store().tenantId).toBe('waste-industries')
    expect(stored().tenantId).toBe('waste-industries')
  })
})
