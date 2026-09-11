/**
 * Every hauler's world is internally consistent, and signing in swaps it whole.
 *
 * These are the checks that a tenant configuration cannot quietly be wrong: a rate that points at a size the hauler
 * does not stock, a customer on a route that does not exist, an address in a zone that was never defined. They run
 * over every tenant in the registry, so adding a fourth hauler is covered the moment it is listed.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../store/useStore'
import { TENANTS, tenantById, piedmont } from '.'

const store = () => useStore.getState()
const signInToPiedmont = () => store().signIn({ tenantId: piedmont.id, role: 'office', name: 'Piedmont office' })

beforeEach(signInToPiedmont)

/**
 * The store is module state shared by every test file in a worker, and signing in changes which hauler it holds. Any
 * file that switches hauler puts the seeded one back, so a later file that only calls reset() is not silently run
 * against a hauler it never asked for.
 */
afterAll(signInToPiedmont)

describe.each(TENANTS.map(t => [t.name, t.id] as const))('%s', (_name, id) => {
  const tenant = tenantById(id)

  it('builds a Db with one hauler row and the zones the storefront needs', () => {
    const db = tenant.buildDb()
    expect(db.hauler).toHaveLength(1)
    expect(db.hauler[0].name).toBe(tenant.name)
    // The storefront's address matcher looks this zone up by id for anything it cannot serve.
    expect(db.zones.find(z => z.id === 'zone_notserved')).toBeTruthy()
    expect(db.zones.every(z => z.id && z.name)).toBe(true)
  })

  it('sells only the lines of business it claims, and stocks a catalog for each', () => {
    const db = tenant.buildDb()
    const stocked = new Set(db.catalog.map(c => c.lob))
    for (const lob of tenant.lines) expect(stocked.has(lob)).toBe(true)
    // Nothing is stocked in a line the hauler does not sell.
    for (const item of db.catalog) expect(tenant.lines).toContain(item.lob)
  })

  it('prices every service it stocks against a zone and frequency it serves', () => {
    const db = tenant.buildDb()
    const catalogIds = new Set(db.catalog.map(c => c.id))
    const zoneIds = new Set(db.zones.map(z => z.id))
    for (const rate of db.rateVersions) {
      expect(catalogIds.has(rate.catalogId), `${rate.id} prices an unstocked service`).toBe(true)
      expect(zoneIds.has(rate.zoneId!), `${rate.id} prices an unknown zone`).toBe(true)
      expect(rate.priceCents).toBeGreaterThan(0)
      expect(rate.status).toBe('published')
    }
  })

  it('puts every existing customer on a real route, zone, and service', () => {
    const db = tenant.buildDb()
    const routeIds = new Set(db.routes.map(r => r.id))
    const zoneIds = new Set(db.zones.map(z => z.id))
    const catalogIds = new Set(db.catalog.map(c => c.id))
    const accountIds = new Set(db.accounts.map(a => a.id))
    for (const site of db.sites) {
      expect(accountIds.has(site.accountId)).toBe(true)
      expect(zoneIds.has(site.zoneId), `${site.id} is in unknown zone ${site.zoneId}`).toBe(true)
      if (site.routeId) expect(routeIds.has(site.routeId), `${site.id} is on unknown route ${site.routeId}`).toBe(true)
    }
    for (const item of db.serviceItems) {
      expect(catalogIds.has(item.catalogId), `${item.id} uses an unstocked service`).toBe(true)
      expect(item.containerIds).toHaveLength(item.qty)
    }
  })

  it('recognises addresses that all sit in zones it defined', () => {
    const zoneIds = new Set(tenant.buildDb().zones.map(z => z.id))
    expect(tenant.addresses.length).toBeGreaterThan(0)
    for (const address of tenant.addresses) {
      expect(zoneIds.has(address.zoneId), `${address.id} is in unknown zone ${address.zoneId}`).toBe(true)
    }
  })

  it('offers a login for every line of business it sells', () => {
    const db = tenant.buildDb()
    const accountIds = new Set(db.accounts.map(a => a.id))
    for (const login of tenant.logins) {
      expect(accountIds.has(login.accountId), `${login.accountId} has no account`).toBe(true)
      expect(tenant.lines).toContain(login.lob)
    }
    expect(new Set(tenant.logins.map(l => l.lob))).toEqual(new Set(tenant.lines))
  })
})

describe('signing in', () => {
  it('swaps the whole world: the hauler, its customers, and its rate card', () => {
    expect(store().db.hauler[0].name).toBe('Piedmont Disposal')
    const piedmontAccounts = store().db.accounts.length

    store().signIn({ tenantId: 'waste-industries', role: 'office', name: 'Waste Industries office' })
    expect(store().tenantId).toBe('waste-industries')
    expect(store().db.hauler[0].name).toBe('Waste Industries')
    // A different hauler's customers are simply not here. There is no filtering, because there is nothing to filter.
    expect(store().db.accounts.some(a => a.id === 'acct_res_maple')).toBe(false)
    expect(store().db.accounts.length).not.toBe(piedmontAccounts)
    expect(store().db.rateVersions.find(r => r.catalogId === 'cat_res_96' && r.zoneId === 'zone_open')?.priceCents).toBe(3400)
  })

  it('opens the portal on an account the signed-in hauler actually has', () => {
    store().signIn({ tenantId: 'direct-waste', role: 'customer', accountId: 'acct_dw_okafor', name: 'Grace Okafor' })
    expect(store().portalSession.accountId).toBe('acct_dw_okafor')

    // A staff seat names no account, so the portal falls back to this hauler's first customer rather than the last
    // hauler's, which would be an account that does not exist here.
    store().signIn({ tenantId: 'omni-waste', role: 'office', name: 'Omni Waste office' })
    const accountIds = store().db.accounts.map(a => a.id)
    expect(accountIds).toContain(store().portalSession.accountId)
  })

  it('reset reloads the signed-in hauler, not the seeded one', () => {
    store().signIn({ tenantId: 'omni-waste', role: 'office', name: 'Omni Waste office' })
    store().reset()
    expect(store().tenantId).toBe('omni-waste')
    expect(store().db.hauler[0].name).toBe('Omni Waste Services')
  })

  it('starts each hauler with no billing history, so the first run is the one you watch', () => {
    for (const tenant of TENANTS.filter(t => t.id !== piedmont.id)) {
      const db = tenant.buildDb()
      expect(db.invoices, tenant.name).toHaveLength(0)
      expect(db.charges, tenant.name).toHaveLength(0)
      expect(db.payments, tenant.name).toHaveLength(0)
      expect(db.quotes, tenant.name).toHaveLength(0)
      // Customers and their service are already there: these haulers have a book of business, just no bills yet.
      expect(db.accounts.length, tenant.name).toBeGreaterThan(0)
      expect(db.serviceItems.length, tenant.name).toBeGreaterThan(0)
    }
  })
})

describe('a hauler that does not sell residential', () => {
  it('Omni Waste stocks no cart, prices no cart, and offers no homeowner login', () => {
    const db = tenantById('omni-waste').buildDb()
    expect(tenantById('omni-waste').lines).not.toContain('residential')
    expect(db.catalog.filter(c => c.lob === 'residential')).toHaveLength(0)
    expect(db.rateVersions.filter(r => r.catalogId.startsWith('cat_res_'))).toHaveLength(0)
    expect(db.routes.filter(r => r.lob === 'residential')).toHaveLength(0)
    expect(tenantById('omni-waste').logins.every(l => l.lob !== 'residential')).toBe(true)
  })
})

describe('a hauler that stocks only some sizes', () => {
  it('Direct Waste carries 10, 20, and 30 yard boxes and no 40 yard or compactor, as its site lists', () => {
    const db = tenantById('direct-waste').buildDb()
    const boxes = db.catalog.filter(c => c.lob === 'rolloff').map(c => c.id).sort()
    expect(boxes).toEqual(['cat_ro_10yd', 'cat_ro_20yd', 'cat_ro_30yd'])
    expect(db.rateVersions.some(r => r.catalogId === 'cat_ro_40yd')).toBe(false)
  })
})

describe('Waste Industries stocks the roll-off classes on its spec sheet', () => {
  // The company's "Roll Off Containers" sheet: four classes, with dimensions and what each is for. The names and
  // descriptions are the hauler's own words; the ids stay shared so the storefront's size table keeps matching.
  const db = tenantById('waste-industries').buildDb()
  const box = (id: string) => db.catalog.find(c => c.id === id)!

  it('names the smallest box as one 10-15 yard class', () => {
    expect(box('cat_ro_10yd').name).toBe('10-15 cubic yard roll-off')
    expect(box('cat_ro_10yd').sizeLabel).toBe('10-15 yd')
    expect(box('cat_ro_10yd').description).toContain("15'-20' long x 8' wide x 4' tall")
  })

  it.each([
    ['cat_ro_20yd', "20' long x 8' wide x 4' tall", '10 pickup truck loads'],
    ['cat_ro_30yd', "20' long x 8' wide x 6' tall", '15 pickup truck loads'],
    ['cat_ro_40yd', "20' long x 8' wide x 8' tall", '20 pickup truck loads'],
  ])('%s carries its dimensions and capacity', (id, dims, loads) => {
    expect(box(id).description).toContain(dims)
    expect(box(id).description).toContain(loads)
  })

  it('shows the yard address, phone, and email from the sheet on its profile', () => {
    const tenant = tenantById('waste-industries')
    expect(tenant.address).toBe('800 East Grand Street')
    expect(tenant.city).toBe('Elizabeth')
    expect(tenant.phone).toBe('(908) 436-1966')
    expect(tenant.email).toBe('info@waste-industries.com')
  })
})
