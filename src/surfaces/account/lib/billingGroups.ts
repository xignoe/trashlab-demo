/**
 * Billing groups (addenda P and Q): customers billed together. A group answers three questions for the office:
 *   how its invoices go out (delivery, and whether members may choose their own),
 *   how often it bills (a schedule: every N days, weeks, months, or quarters from a start date), and
 *   who is in it (members, added by hand or in bulk by zone, customer type, service, and route).
 * Pure over a Db; the account slice commits what these plan. A member's cycle is its group's frequency and its bill
 * dates are the group's schedule (store/cycles.ts cadenceOf), so the canonical engine bills every member together.
 */
import type { Db } from '../../../store/db'
import { computeCharge, dayOf, resolvePrice } from '../../../store/engine'
import {
  addDays, addMonths, billDateOnOrAfter, cadenceOf, daysBetween, groupCadence, isDue, nextCycleDate, periodFor, periodLabel,
  type CadenceOf, type Period,
} from '../../../store/cycles'
import type { BillingAccount, BillingFrequency, BillingGroup, BillingSchedule, Charge, InvoiceDelivery, LOB, Party } from '../../../types'
import { withRows } from './db'
import { EngineError } from './engine'
import { nextId } from './ids'

export const GROUP_ID_PREFIX = 'grp_ac_'

// ---------------------------------------------------------------------------------------------
// 1. How invoices go out
// ---------------------------------------------------------------------------------------------

export const INVOICE_DELIVERIES: InvoiceDelivery[] = ['mail', 'email', 'text', 'portal']
export const DELIVERY_NAME: Record<InvoiceDelivery, string> = { mail: 'Printed mail', email: 'Email', text: 'Text message', portal: 'Portal' }
export const DELIVERY_HINT: Record<InvoiceDelivery, string> = {
  mail: 'A printed invoice mailed to the billing address',
  email: 'A PDF invoice with a pay link, by email',
  text: 'A pay link by text message',
  portal: 'Posted to the customer portal, with a notice',
}
export const TERMS_CHOICES = [0, 7, 10, 15, 30, 45, 60] as const

// ---------------------------------------------------------------------------------------------
// 2. How often
// ---------------------------------------------------------------------------------------------

export const FREQUENCIES: { id: BillingFrequency; label: string; unit: string; units: string; maxEvery: number }[] = [
  // Every N days also serves the screen's Custom choice (every 21 days, every 45 days).
  { id: 'daily', label: 'Daily', unit: 'day', units: 'days', maxEvery: 365 },
  { id: 'weekly', label: 'Weekly', unit: 'week', units: 'weeks', maxEvery: 12 },
  { id: 'monthly', label: 'Monthly', unit: 'month', units: 'months', maxEvery: 12 },
  { id: 'quarterly', label: 'Quarterly', unit: 'quarter', units: 'quarters', maxEvery: 4 },
]

/** A legacy cycle as the schedule it has always billed on, so a move can tell whether bill dates change. */
function scheduleOf(cadence: CadenceOf): BillingSchedule | undefined {
  if (cadence.schedule) return cadence.schedule
  switch (cadence.cycle) {
    case 'daily': return { frequency: 'daily', every: 1, startDate: '2026-01-01' }
    case 'weekly': return { frequency: 'weekly', every: 1, startDate: '2026-01-05' }
    case 'monthly':
    case 'net30': return { frequency: 'monthly', every: 1, startDate: '2026-01-01' }
    case 'quarterly': return { frequency: 'quarterly', every: 1, startDate: '2026-01-01' }
    case 'perJob': return undefined
  }
}

/** True when two cadences bill on different dates (the same step, anchored on a date both bill, bills the same). */
export function cadenceChanges(from: CadenceOf, to: CadenceOf): boolean {
  const a = scheduleOf(from)
  const b = scheduleOf(to)
  if (!a || !b) return a !== b
  return a.frequency !== b.frequency || Math.max(1, a.every) !== Math.max(1, b.every) || !isDue({ cycle: b.frequency, schedule: b }, a.startDate)
}

/** The next `count` bill dates on or after `from`. */
export function nextBillDates(cadence: CadenceOf, from: string, count = 3): string[] {
  if (cadence.cycle === 'perJob') return []
  const out = [billDateOnOrAfter(cadence, from)]
  while (out.length < count) out.push(nextCycleDate(cadence, out[out.length - 1]))
  return out
}

/** The period a group's bill on cycleDate covers. */
export function groupPeriod(group: Pick<BillingGroup, 'schedule'>, cycleDate: string): Period {
  return periodFor(groupCadence(group), cycleDate)
}

/** Whether an account bills on cycleDate, on its group's schedule when it has one. */
export function accountDueOn(db: Pick<Db, 'billingGroups'>, account: BillingAccount, cycleDate: string): boolean {
  return isDue(cadenceOf(account, db.billingGroups), cycleDate)
}

// ---------------------------------------------------------------------------------------------
// Saving a group
// ---------------------------------------------------------------------------------------------

export interface BillingGroupDraft {
  name: string
  schedule: BillingSchedule
  termsDays: number
  delivery: InvoiceDelivery
  customerChoice: boolean
  note?: string
}

/** A checked, trimmed group. Throws EngineError naming the first problem. */
export function checkGroupDraft(draft: BillingGroupDraft, db: Pick<Db, 'billingGroups'>, id?: string): BillingGroupDraft {
  const name = draft.name.trim()
  if (!name) throw new EngineError('Give the group a name')
  if (db.billingGroups.some(g => g.id !== id && g.name.trim().toLowerCase() === name.toLowerCase())) throw new EngineError(`A group named "${name}" already exists`)
  const freq = FREQUENCIES.find(f => f.id === draft.schedule?.frequency)
  if (!freq) throw new EngineError('Pick how often the group bills')
  const every = Number(draft.schedule.every)
  if (!Number.isInteger(every) || every < 1 || every > freq.maxEvery) throw new EngineError(`Bill every 1 to ${freq.maxEvery} ${freq.units}`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.schedule.startDate ?? '')) throw new EngineError('Pick the first bill date')
  if (!Number.isInteger(draft.termsDays) || draft.termsDays < 0 || draft.termsDays > 90) throw new EngineError('Payment terms must be 0 to 90 days')
  if (!INVOICE_DELIVERIES.includes(draft.delivery)) throw new EngineError('Pick how the group gets its invoices')
  const note = draft.note?.trim()
  return {
    name,
    schedule: { frequency: freq.id, every, startDate: draft.schedule.startDate },
    termsDays: draft.termsDays,
    delivery: draft.delivery,
    customerChoice: Boolean(draft.customerChoice),
    ...(note ? { note } : {}),
  }
}

/** A new group id, numbered after every grp_ac_ id in db. */
export function nextGroupId(db: Pick<Db, 'billingGroups'>): string {
  const max = db.billingGroups.reduce((m, g) => {
    const n = g.id.startsWith(GROUP_ID_PREFIX) ? Number(g.id.slice(GROUP_ID_PREFIX.length)) : 0
    return Number.isFinite(n) ? Math.max(m, n) : m
  }, 0)
  return `${GROUP_ID_PREFIX}${String(max + 1).padStart(4, '0')}`
}

export function membersOf(db: Pick<Db, 'accounts'>, groupId: string): BillingAccount[] {
  return db.accounts.filter(a => a.billingGroupId === groupId)
}

/** Delivery counts for a set of accounts, in INVOICE_DELIVERIES order. */
export function deliveryMix(accounts: Pick<BillingAccount, 'deliveryMethod'>[]): Record<InvoiceDelivery, number> {
  const out: Record<InvoiceDelivery, number> = { mail: 0, email: 0, text: 0, portal: 0 }
  for (const a of accounts) out[a.deliveryMethod] += 1
  return out
}

/**
 * Accounts whose recurring charges are generated but not posted yet. Changing how they bill now would leave those
 * charges billing the old period, so a change to their bill dates waits until the run is posted or cancelled.
 */
export function accountsWithPendingRecurring(db: Pick<Db, 'charges'>, accountIds: Iterable<string>): string[] {
  const ids = new Set(accountIds)
  const out = new Set<string>()
  for (const c of db.charges) {
    if (ids.has(c.accountId) && c.lineType === 'recurring' && (c.status === 'proposed' || c.status === 'approved') && !isBridgeCharge(c)) out.add(c.accountId)
  }
  return [...out]
}

// ---------------------------------------------------------------------------------------------
// 3. Who is in it: bulk add by zone, customer type, service, and route
// ---------------------------------------------------------------------------------------------

export const CUSTOMER_TYPES: { id: Party['kind']; label: string }[] = [
  { id: 'homeowner', label: 'Residential' },
  { id: 'business', label: 'Commercial' },
  { id: 'contractor', label: 'Contractor' },
  { id: 'propertyManager', label: 'Property manager' },
  { id: 'hoa', label: 'HOA' },
]
export const SERVICE_TYPES: { id: LOB; label: string }[] = [
  { id: 'residential', label: 'Carts' },
  { id: 'frontload', label: 'Front load' },
  { id: 'rolloff', label: 'Roll-off' },
]

/** Empty lists mean any. inGroup: 'any', 'none' (not in a group), or a group id. */
export interface MemberFilter {
  zoneIds: string[]
  kinds: Party['kind'][]
  lobs: LOB[]
  routeIds: string[]
  inGroup: string
  search: string
}
export const EMPTY_FILTER: MemberFilter = { zoneIds: [], kinds: [], lobs: [], routeIds: [], inGroup: 'any', search: '' }

/** What the filters match on, per account. */
export interface AccountFacts {
  account: BillingAccount
  name: string
  kind?: Party['kind']
  address?: string
  zoneIds: string[]
  routeIds: string[]
  lobs: LOB[]
}

export function accountFacts(db: Pick<Db, 'accounts' | 'parties' | 'sites' | 'serviceItems' | 'catalog' | 'routes'>): AccountFacts[] {
  const party = new Map(db.parties.map(p => [p.id, p]))
  const lobOf = new Map(db.catalog.map(c => [c.id, c.lob]))
  const routeLob = new Map(db.routes.map(r => [r.id, r.lob]))
  return db.accounts.map(account => {
    const sites = db.sites.filter(s => s.accountId === account.id)
    const siteIds = new Set(sites.map(s => s.id))
    const lobs = new Set<LOB>()
    for (const si of db.serviceItems) {
      if (!siteIds.has(si.siteId) || si.status === 'ended') continue
      const l = lobOf.get(si.catalogId)
      if (l) lobs.add(l)
    }
    for (const s of sites) {
      const l = s.routeId ? routeLob.get(s.routeId) : undefined
      if (l) lobs.add(l)
    }
    const p = party.get(account.payerPartyId)
    return {
      account,
      name: p?.name ?? account.id,
      kind: p?.kind,
      address: sites[0]?.address,
      zoneIds: [...new Set(sites.map(s => s.zoneId))],
      routeIds: [...new Set(sites.map(s => s.routeId).filter((r): r is string => !!r))],
      lobs: [...lobs],
    }
  })
}

function anyOf<T>(wanted: T[], have: T[]): boolean {
  return wanted.length === 0 || have.some(h => wanted.includes(h))
}

/** Accounts matching every filter, by name. */
export function matchAccounts(facts: AccountFacts[], f: MemberFilter): AccountFacts[] {
  const q = f.search.trim().toLowerCase()
  return facts
    .filter(x =>
      anyOf(f.zoneIds, x.zoneIds)
      && (f.kinds.length === 0 || (x.kind !== undefined && f.kinds.includes(x.kind)))
      && anyOf(f.lobs, x.lobs)
      && anyOf(f.routeIds, x.routeIds)
      && (f.inGroup === 'any' || (f.inGroup === 'none' ? !x.account.billingGroupId : x.account.billingGroupId === f.inGroup))
      && (!q || x.name.toLowerCase().includes(q) || (x.address ?? '').toLowerCase().includes(q) || x.account.id.includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------------------------
// Bridge charges
// ---------------------------------------------------------------------------------------------

const BRIDGE_PREFIX = 'Bridge to '

/** A bridge charge the office proposed when an account changed bill dates (see planBridgeCharges). */
export function isBridgeCharge(c: Pick<Charge, 'id' | 'lineType' | 'description'>): boolean {
  return c.id.startsWith('chg_ac_') && c.lineType === 'recurring' && c.description.startsWith(BRIDGE_PREFIX)
}

/** Proposed bridge charges on these accounts that a new move replaces (an approved or posted one stays). */
export function staleBridgeIds(db: Pick<Db, 'charges'>, accountIds: Iterable<string>): Set<string> {
  const ids = new Set(accountIds)
  return new Set(db.charges.filter(c => ids.has(c.accountId) && c.status === 'proposed' && isBridgeCharge(c)).map(c => c.id))
}

/** Months of the monthly rate a gap covers: whole months, plus leftover days at 12/365 of a month each. */
function monthsIn(period: Period): number {
  const next = addDays(period.end, 1)
  let m = 0
  while (addMonths(period.start, m + 1) <= next) m += 1
  return m + daysBetween(addMonths(period.start, m), next) * 12 / 365
}

/**
 * Moving an account to other bill dates can leave days nobody bills: a quarterly account paid through Sep 30 that
 * joins a February start group next bills Nov 1, so October would go free. For each active recurring line, this
 * proposes one charge from the day after the line is paid through to the day before the new schedule's first bill
 * date on or after it, priced by the canonical resolvePrice and computeCharge (whole months at the monthly rate, and
 * leftover days at 12/365 of it). Proposed on no invoice and in no run (the intake rule), so billing's next run brings
 * it into its queue as a decision. A line never billed follows the hauler's policy instead.
 */
export function planBridgeCharges(db: Db, accountId: string, next: CadenceOf, groupName: string): Charge[] {
  const account = db.accounts.find(a => a.id === accountId)
  if (!account || account.status === 'suspended' || next.cycle === 'perJob') return []
  const stale = staleBridgeIds(db, [accountId])
  const charges = db.charges.filter(c => !stale.has(c.id))
  const scoped: Db = { ...db, charges }
  const takenIds = charges.map(c => c.id)
  const out: Charge[] = []
  for (const site of db.sites.filter(s => s.accountId === accountId)) {
    for (const item of db.serviceItems.filter(si => si.siteId === site.id && si.status === 'active' && si.frequency !== 'onCall')) {
      const billed = charges.filter(c => c.source.type === 'serviceItem' && c.source.id === item.id && c.lineType === 'recurring' && c.period && c.status !== 'waived')
      if (billed.length === 0) continue
      const paidThrough = billed.map(c => dayOf(c.period!.end)).sort().at(-1)!
      const gapStart = addDays(paidThrough, 1)
      if (item.effectiveTo !== undefined && dayOf(item.effectiveTo) <= gapStart) continue
      const firstBill = billDateOnOrAfter(next, gapStart)
      if (firstBill <= gapStart) continue
      const period = { start: gapStart, end: addDays(firstBill, -1) }
      const price = resolvePrice({ catalogId: item.catalogId, frequency: item.frequency, zoneId: site.zoneId, accountId, onDate: gapStart }, scoped)
      const name = db.catalog.find(c => c.id === item.catalogId)?.name ?? item.catalogId
      out.push(computeCharge(
        {
          id: nextId('chg', takenIds, out.length),
          accountId,
          siteId: site.id,
          lineType: 'recurring',
          catalogId: item.catalogId,
          frequency: item.frequency,
          baseCents: Math.round(price.priceCents * item.qty * monthsIn(period)),
          period,
          source: { type: 'serviceItem', id: item.id },
          description: `${BRIDGE_PREFIX}${groupName}: ${name}, ${periodLabel(period)}`,
          pricing: {
            ruleWon: price.ruleWon,
            ...(price.rateVersionId ? { rateVersionId: price.rateVersionId } : {}),
            ...(price.contractId ? { contractId: price.contractId } : {}),
          },
        },
        scoped,
      ))
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Plans the account slice commits (and the screen previews before a save)
// ---------------------------------------------------------------------------------------------

/** An account and the cadence it moves to. */
export interface CadenceMove {
  account: BillingAccount
  cadence: CadenceOf
}

/**
 * The db after accounts move to new bill dates: their proposed bridge charges from an earlier move are replaced by the
 * ones this move needs (planBridgeCharges), then the account rows are written.
 */
export function withCadenceMoves(db: Db, moves: CadenceMove[], label: string): { db: Db; bridges: Charge[] } {
  const stale = staleBridgeIds(db, moves.map(m => m.account.id))
  let next: Db = { ...db, charges: db.charges.filter(c => !stale.has(c.id)) }
  next = withRows(next, { accounts: moves.map(m => m.account) })
  const bridges: Charge[] = []
  for (const m of moves) bridges.push(...planBridgeCharges({ ...next, charges: [...next.charges, ...bridges] }, m.account.id, m.cadence, label))
  return { db: bridges.length ? withRows(next, { charges: bridges }) : next, bridges }
}

export interface GroupSavePlan {
  group: BillingGroup
  db: Db
  /** Members whose bill dates change with this save. */
  moved: number
  /** Members that cannot move yet: recurring charges from the current run are not posted. */
  blocked: string[]
  bridges: Charge[]
  /** Members switched to the group's delivery because customers may not choose. */
  deliveryChanged: number
}

/** What saving a group does. Throws EngineError for a bad draft or an unknown id. */
export function planGroupSave(db: Db, draft: BillingGroupDraft, id?: string): GroupSavePlan {
  const clean = checkGroupDraft(draft, db, id)
  const existing = id ? db.billingGroups.find(g => g.id === id) : undefined
  if (id && !existing) throw new EngineError(`Billing group ${id} not found`)
  const group: BillingGroup = { id: existing?.id ?? nextGroupId(db), ...clean }
  const withGroup: Db = { ...db, billingGroups: existing ? db.billingGroups.map(g => (g.id === group.id ? group : g)) : [...db.billingGroups, group] }
  const members = existing ? membersOf(db, existing.id) : []
  const scheduleMoves = existing && cadenceChanges(groupCadence(existing), groupCadence(group))
  const blocked = scheduleMoves ? accountsWithPendingRecurring(db, members.map(a => a.id)) : []
  let deliveryChanged = 0
  const updated = members.map(a => {
    const deliveryMethod = group.customerChoice ? a.deliveryMethod : group.delivery
    if (deliveryMethod !== a.deliveryMethod) deliveryChanged += 1
    return { ...a, cycle: group.schedule.frequency, deliveryMethod }
  })
  if (scheduleMoves) {
    const { db: next, bridges } = withCadenceMoves(withGroup, updated.map(account => ({ account, cadence: groupCadence(group) })), group.name)
    return { group, db: next, moved: members.length, blocked, bridges, deliveryChanged }
  }
  return { group, db: updated.length ? withRows(withGroup, { accounts: updated }) : withGroup, moved: 0, blocked, bridges: [], deliveryChanged }
}

export interface AddToGroupPlan {
  db: Db
  added: string[]
  /** Accounts left where they were, and why. */
  skipped: { accountId: string; reason: string }[]
  bridges: Charge[]
}

/**
 * What adding accounts to a group does: each joins, takes the group's frequency as its cycle and, when customers may
 * not choose, the group's delivery. An account already in the group is left alone. One whose bill dates would change
 * while it has unposted recurring charges from the current run is skipped with the reason.
 */
export function planAddToGroup(db: Db, groupId: string, accountIds: string[]): AddToGroupPlan {
  const group = db.billingGroups.find(g => g.id === groupId)
  if (!group) throw new EngineError(`Billing group ${groupId} not found`)
  const target = groupCadence(group)
  const moves: CadenceMove[] = []
  const plain: BillingAccount[] = []
  const skipped: AddToGroupPlan['skipped'] = []
  const pending = new Set(accountsWithPendingRecurring(db, accountIds))
  for (const id of accountIds) {
    const account = db.accounts.find(a => a.id === id)
    if (!account) {
      skipped.push({ accountId: id, reason: 'not found' })
      continue
    }
    if (account.billingGroupId === group.id) continue
    const changes = cadenceChanges(cadenceOf(account, db.billingGroups), target)
    if (changes && pending.has(id)) {
      skipped.push({ accountId: id, reason: 'charges from the current run are not posted yet' })
      continue
    }
    const next: BillingAccount = {
      ...account,
      billingGroupId: group.id,
      cycle: group.schedule.frequency,
      ...(group.customerChoice ? {} : { deliveryMethod: group.delivery }),
    }
    if (changes) moves.push({ account: next, cadence: target })
    else plain.push(next)
  }
  let next = plain.length ? withRows(db, { accounts: plain }) : db
  let bridges: Charge[] = []
  if (moves.length) ({ db: next, bridges } = withCadenceMoves(next, moves, group.name))
  return { db: next, added: [...plain, ...moves.map(m => m.account)].map(a => a.id), skipped, bridges }
}

/** Taking an account out of its group: it keeps its cycle and bills on that cycle's usual dates from then on. */
export function planTakeOut(db: Db, accountId: string): { db: Db; bridges: Charge[]; account: BillingAccount } {
  const account = db.accounts.find(a => a.id === accountId)
  if (!account) throw new EngineError(`BillingAccount ${accountId} not found`)
  if (!account.billingGroupId) return { db, bridges: [], account }
  const { billingGroupId: _left, ...rest } = account
  const next: BillingAccount = rest
  const own: CadenceOf = { cycle: next.cycle }
  if (!cadenceChanges(cadenceOf(account, db.billingGroups), own)) return { db: withRows(db, { accounts: [next] }), bridges: [], account: next }
  if (accountsWithPendingRecurring(db, [accountId]).length) {
    throw new EngineError('This account has charges from the current run that are not posted yet. Post or cancel the run before changing when it bills.')
  }
  const moved = withCadenceMoves(db, [{ account: next, cadence: own }], 'own schedule')
  return { ...moved, account: next }
}

/**
 * Removing a group (Kevin's ask, addendum Q): its members move first, to another group or out of any group, then the
 * group row goes. A billing group is configuration, not a financial record; no charge, invoice, or payment is touched
 * except the bridge charges a move needs. Throws when a member cannot move yet (unposted recurring charges).
 */
export function planRemoveGroup(db: Db, groupId: string, moveTo: string | null): { db: Db; moved: number; bridges: Charge[] } {
  const group = db.billingGroups.find(g => g.id === groupId)
  if (!group) throw new EngineError(`Billing group ${groupId} not found`)
  if (moveTo === groupId) throw new EngineError('Pick a different group for the members')
  const ids = membersOf(db, groupId).map(a => a.id)
  let next = db
  let bridges: Charge[] = []
  if (ids.length && moveTo) {
    const plan = planAddToGroup(db, moveTo, ids)
    if (plan.skipped.length) throw new EngineError(`${plural(plan.skipped.length, 'member')} cannot move yet: ${plan.skipped[0].reason}. Post or cancel the run first.`)
    next = plan.db
    bridges = plan.bridges
  } else {
    for (const id of ids) {
      const plan = planTakeOut(next, id)
      next = plan.db
      bridges = [...bridges, ...plan.bridges]
    }
  }
  return { db: { ...next, billingGroups: next.billingGroups.filter(g => g.id !== groupId) }, moved: ids.length, bridges }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}
