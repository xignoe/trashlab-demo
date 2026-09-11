import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setToday } from '../../../store/clock'
import { cadenceOf, groupCadence, isDue, periodFor, scheduleText } from '../../../store/cycles'
import { generateRecurringCharges, invoiceTermsDays } from '../../../store/engine'
import { nextRunDate, queueItems, uncoveredDueAccounts } from '../../../store/selectors'
import { useStore } from '../../../store/useStore'
import type { BillingSchedule } from '../../../types'
import {
  EMPTY_FILTER, accountFacts, deliveryMix, isBridgeCharge, matchAccounts, membersOf, nextBillDates, planGroupSave, type BillingGroupDraft,
} from '../lib/billingGroups'

const st = () => useStore.getState()
const account = (id: string) => st().db.accounts.find(a => a.id === id)!
const group = (id: string) => st().db.billingGroups.find(g => g.id === id)!
const bridges = (accountId: string) => st().db.charges.filter(c => c.accountId === accountId && isBridgeCharge(c))
const billedOn = (cycleDate: string) => new Set(generateRecurringCharges({ cycleDate }, st().db).map(c => c.accountId))
const draft = (over: Partial<BillingGroupDraft> & { schedule?: BillingSchedule }): BillingGroupDraft => ({
  name: 'Test group', schedule: { frequency: 'monthly', every: 1, startDate: '2026-01-01' }, termsDays: 15, delivery: 'email', customerChoice: true, ...over,
})

beforeEach(() => st().reset())
afterEach(() => setToday())

describe('seeded billing groups', () => {
  it('groups every monthly and quarterly account and leaves net 30 and per job accounts on their own terms', () => {
    const db = st().db
    expect(db.billingGroups.map(g => g.id)).toEqual(['grp_res_quarterly', 'grp_res_quarterly_feb', 'grp_res_monthly', 'grp_commercial_monthly'])
    expect(membersOf(db, 'grp_res_quarterly')).toHaveLength(23)
    expect(membersOf(db, 'grp_res_quarterly_feb')).toHaveLength(0)
    expect(membersOf(db, 'grp_res_monthly')).toHaveLength(10)
    expect(membersOf(db, 'grp_commercial_monthly')).toHaveLength(9)
    expect(db.accounts.filter(a => !a.billingGroupId).map(a => a.cycle).sort()).toEqual(['net30', 'net30', 'perJob'])
    for (const a of db.accounts) {
      const g = db.billingGroups.find(x => x.id === a.billingGroupId)
      if (g) expect(a.cycle).toBe(g.schedule.frequency)
    }
  })

  it('describes and schedules each group', () => {
    expect(scheduleText(group('grp_res_quarterly').schedule)).toBe('Quarterly on the 1st: Jan, Apr, Jul, Oct')
    expect(scheduleText(group('grp_res_quarterly_feb').schedule)).toBe('Quarterly on the 1st: Feb, May, Aug, Nov')
    expect(scheduleText(group('grp_res_monthly').schedule)).toBe('Monthly on the 1st')
    expect(nextBillDates(groupCadence(group('grp_res_quarterly')), '2026-09-10')).toEqual(['2026-10-01', '2027-01-01', '2027-04-01'])
    expect(nextBillDates(groupCadence(group('grp_res_quarterly_feb')), '2026-09-10')).toEqual(['2026-11-01', '2027-02-01', '2027-05-01'])
  })

  it('bills the seeded accounts on the same dates and periods as before', () => {
    const oct = billedOn('2026-10-01')
    expect(oct.has('acct_res_maple')).toBe(true)
    expect(oct.has('acct_res_001')).toBe(true)
    expect(billedOn('2026-11-01').has('acct_res_maple')).toBe(false)
    expect(periodFor(cadenceOf(account('acct_res_maple'), st().db.billingGroups), '2026-10-01')).toEqual({ start: '2026-10-01', end: '2026-12-31' })
    expect(nextRunDate(st().db, '2026-10-01')).toBe('2026-11-01')
  })
})

describe('schedules: any day, weekly, daily', () => {
  it('says each schedule in words', () => {
    expect(scheduleText({ frequency: 'daily', every: 1, startDate: '2026-10-01' })).toBe('Every day')
    expect(scheduleText({ frequency: 'daily', every: 3, startDate: '2026-10-01' })).toBe('Every 3 days')
    expect(scheduleText({ frequency: 'weekly', every: 1, startDate: '2026-10-05' })).toBe('Every Monday')
    expect(scheduleText({ frequency: 'weekly', every: 2, startDate: '2026-10-09' })).toBe('Every 2 weeks on Friday')
    expect(scheduleText({ frequency: 'monthly', every: 1, startDate: '2026-10-15' })).toBe('Monthly on the 15th')
    expect(scheduleText({ frequency: 'monthly', every: 2, startDate: '2026-01-22' })).toBe('Every 2 months on the 22nd')
    expect(scheduleText({ frequency: 'quarterly', every: 1, startDate: '2026-03-10' })).toBe('Quarterly on the 10th: Mar, Jun, Sep, Dec')
  })

  it('a group billing on the 15th bills Oct 15 for Oct 15 to Nov 14 at one month of the rate', () => {
    st().saveBillingGroup(draft({ name: 'Residential monthly', schedule: { frequency: 'monthly', every: 1, startDate: '2026-01-15' } }), 'grp_res_monthly')
    expect(billedOn('2026-10-01').has('acct_res_001')).toBe(false)
    const oct15 = generateRecurringCharges({ cycleDate: '2026-10-15' }, st().db).filter(c => c.accountId === 'acct_res_001')
    expect(oct15.length).toBeGreaterThan(0)
    expect(oct15[0].period).toEqual({ start: '2026-10-15', end: '2026-11-14' })
    const flat = oct15[0].fees.find(f => f.feeRuleId === 'fee_env_1')
    if (flat) expect(flat.cents).toBe(100)
  })

  it('a weekly group bills every Thursday at 12/52 of the monthly rate, with the flat fee split the same way', () => {
    const g = st().saveBillingGroup(draft({ name: 'Weekly commercial', schedule: { frequency: 'weekly', every: 1, startDate: '2026-10-01' } }))
    st().addAccountsToBillingGroup(g.id, ['acct_bakery'])
    expect(account('acct_bakery').cycle).toBe('weekly')
    const cadence = cadenceOf(account('acct_bakery'), st().db.billingGroups)
    expect(isDue(cadence, '2026-10-08')).toBe(true)
    expect(isDue(cadence, '2026-10-09')).toBe(false)
    expect(periodFor(cadence, '2026-10-08')).toEqual({ start: '2026-10-08', end: '2026-10-14' })
    expect(nextRunDate(st().db, '2026-10-01')).toBe('2026-10-08')

    const week = generateRecurringCharges({ cycleDate: '2026-10-01' }, st().db).filter(c => c.accountId === 'acct_bakery')
    const asMonthly = { ...st().db, accounts: st().db.accounts.map(a => (a.id === 'acct_bakery' ? { ...a, cycle: 'monthly' as const, billingGroupId: undefined } : a)) }
    const month = generateRecurringCharges({ cycleDate: '2026-10-01' }, asMonthly).filter(c => c.accountId === 'acct_bakery')
    expect(week.length).toBeGreaterThan(0)
    expect(week.map(c => c.catalogId)).toEqual(month.map(c => c.catalogId))
    for (let i = 0; i < week.length; i++) expect(week[i].baseCents).toBe(Math.round(month[i].baseCents * 12 / 52))
    const env = week[0].fees.find(f => f.feeRuleId === 'fee_env_1')
    if (env) expect(env.cents).toBe(Math.round(100 * 7 * 12 / 365))
  })

  it('a custom schedule bills every 21 days at 21 x 12/365 of the monthly rate', () => {
    const every21: BillingSchedule = { frequency: 'daily', every: 21, startDate: '2026-10-01' }
    expect(scheduleText(every21)).toBe('Every 21 days')
    const g = st().saveBillingGroup(draft({ name: 'Every 21 days', schedule: every21 }))
    st().addAccountsToBillingGroup(g.id, ['acct_bakery'])
    const cadence = cadenceOf(account('acct_bakery'), st().db.billingGroups)
    expect(nextBillDates(cadence, '2026-10-01', 3)).toEqual(['2026-10-01', '2026-10-22', '2026-11-12'])
    expect(periodFor(cadence, '2026-10-22')).toEqual({ start: '2026-10-22', end: '2026-11-11' })
    const bill = generateRecurringCharges({ cycleDate: '2026-10-01' }, st().db).filter(c => c.accountId === 'acct_bakery')
    const asMonthly = { ...st().db, accounts: st().db.accounts.map(a => (a.id === 'acct_bakery' ? { ...a, cycle: 'monthly' as const, billingGroupId: undefined } : a)) }
    const month = generateRecurringCharges({ cycleDate: '2026-10-01' }, asMonthly).filter(c => c.accountId === 'acct_bakery')
    for (let i = 0; i < bill.length; i++) expect(bill[i].baseCents).toBe(Math.round(month[i].baseCents * 21 * 12 / 365))
    expect(() => st().saveBillingGroup(draft({ name: 'Too long', schedule: { frequency: 'daily', every: 366, startDate: '2026-10-01' } }))).toThrow(/1 to 365 days/)
  })

  it('advancing past a run steps to the next date any group bills', () => {
    const g = st().saveBillingGroup(draft({ name: 'Weekly', schedule: { frequency: 'weekly', every: 1, startDate: '2026-10-01' } }))
    st().addAccountsToBillingGroup(g.id, ['acct_fl_001'])
    st().runCycle()
    for (const item of queueItems(st()).filter(i => !i.decided)) st().approve(item.chargeId)
    st().bulkApproveClean()
    st().post()
    st().advanceCycle()
    expect(st().cycleDate).toBe('2026-10-08')
  })
})

describe('changing how a group bills', () => {
  it('moves every member with a new schedule, with a bridge for days left unbilled, and waits while the run is not posted', () => {
    const on15th = draft({ name: 'Residential monthly', schedule: { frequency: 'monthly', every: 1, startDate: '2026-01-15' } })
    st().runCycle()
    expect(() => st().saveBillingGroup(on15th, 'grp_res_monthly')).toThrow(/Post or cancel the run/)
    st().cancelRun()
    const plan = planGroupSave(st().db, on15th, 'grp_res_monthly')
    expect(plan.moved).toBe(10)
    expect(plan.blocked).toEqual([])
    st().saveBillingGroup(on15th, 'grp_res_monthly')
    // Paid through Sep 30, next bill Oct 15: Oct 1 to 14 is bridged.
    const b = bridges('acct_res_001')
    expect(b.length).toBeGreaterThan(0)
    expect(b[0].period).toEqual({ start: '2026-10-01', end: '2026-10-14' })
  })

  it('moves Maple to the February group: an October bridge, and moving back drops it', () => {
    st().assignBillingGroup('acct_res_maple', 'grp_res_quarterly_feb')
    expect(billedOn('2026-10-01').has('acct_res_maple')).toBe(false)
    expect(bridges('acct_res_maple').map(c => [c.source.id, c.period, c.baseCents])).toEqual([
      ['si_maple_96', { start: '2026-10-01', end: '2026-10-31' }, 2900],
      ['si_maple_extra', { start: '2026-10-01', end: '2026-10-31' }, 900],
      ['si_maple_recycling', { start: '2026-10-01', end: '2026-10-31' }, 1200],
    ])
    st().assignBillingGroup('acct_res_maple', 'grp_res_quarterly')
    expect(bridges('acct_res_maple')).toHaveLength(0)
  })

  it('uses the group terms for the invoice due date', () => {
    st().saveBillingGroup(draft({ name: 'Commercial monthly', termsDays: 30 }), 'grp_commercial_monthly')
    expect(invoiceTermsDays(account('acct_bakery'), st().db)).toBe(30)
    expect(invoiceTermsDays(account('acct_pm_oakridge'), st().db)).toBe(30)
    expect(invoiceTermsDays(account('acct_ro_homeowner'), st().db)).toBe(15)
  })

  it('checks a draft', () => {
    const g = st().saveBillingGroup(draft({ name: '  HOA accounts ', delivery: 'mail' }))
    expect(g).toMatchObject({ id: 'grp_ac_0001', name: 'HOA accounts', delivery: 'mail', customerChoice: true })
    expect(() => st().saveBillingGroup(draft({ name: 'hoa ACCOUNTS' }))).toThrow(/already exists/)
    expect(() => st().saveBillingGroup(draft({ name: 'X', schedule: { frequency: 'weekly', every: 13, startDate: '2026-10-01' } }))).toThrow(/1 to 12 weeks/)
    expect(() => st().saveBillingGroup(draft({ name: 'Y', schedule: { frequency: 'weekly', every: 1, startDate: '' } }))).toThrow(/first bill date/)
  })
})

describe('who is in it', () => {
  it('filters accounts by zone, customer type, service, route, and current group', () => {
    const facts = accountFacts(st().db)
    const commercial = matchAccounts(facts, { ...EMPTY_FILTER, kinds: ['business'] })
    expect(commercial.length).toBeGreaterThan(0)
    expect(commercial.every(f => f.kind === 'business')).toBe(true)
    expect(matchAccounts(facts, { ...EMPTY_FILTER, lobs: ['frontload'] }).some(f => f.account.id === 'acct_bakery')).toBe(true)
    expect(matchAccounts(facts, { ...EMPTY_FILTER, routeIds: ['route_mon_res'] }).every(f => f.routeIds.includes('route_mon_res'))).toBe(true)
    expect(matchAccounts(facts, { ...EMPTY_FILTER, inGroup: 'none' }).map(f => f.account.cycle).sort()).toEqual(['net30', 'net30', 'perJob'])
    const open = matchAccounts(facts, { ...EMPTY_FILTER, zoneIds: ['zone_open'], kinds: ['homeowner'] })
    expect(open.length).toBeGreaterThan(0)
    expect(open.every(f => f.zoneIds.includes('zone_open') && f.kind === 'homeowner')).toBe(true)
  })

  it('adds a filtered set in one step and skips accounts that cannot move yet', () => {
    const g = st().saveBillingGroup(draft({ name: 'Front load, weekly', schedule: { frequency: 'weekly', every: 1, startDate: '2026-10-01' }, delivery: 'text', customerChoice: false }))
    const fl = matchAccounts(accountFacts(st().db), { ...EMPTY_FILTER, lobs: ['frontload'], inGroup: 'grp_commercial_monthly' }).map(f => f.account.id)
    expect(fl.length).toBeGreaterThan(0)
    st().runCycle({ groupId: 'grp_commercial_monthly' })
    const r = st().addAccountsToBillingGroup(g.id, fl)
    expect(r.added).toEqual([])
    expect(r.skipped.length).toBe(fl.length)
    st().cancelRun()
    const r2 = st().addAccountsToBillingGroup(g.id, fl)
    expect([...r2.added].sort()).toEqual([...fl].sort())
    expect(membersOf(st().db, g.id).every(a => a.cycle === 'weekly' && a.deliveryMethod === 'text')).toBe(true)
  })
})

describe('how they get invoices', () => {
  it('a group that lets customers choose keeps their choice; one that does not puts everyone on its delivery', () => {
    st().setInvoiceDelivery('acct_res_maple', 'text')
    expect(account('acct_res_maple').deliveryMethod).toBe('text')
    const before = deliveryMix(membersOf(st().db, 'grp_res_quarterly'))
    const mailOnly = draft({ name: 'Residential quarterly', schedule: group('grp_res_quarterly').schedule, delivery: 'mail', customerChoice: false })
    const plan = planGroupSave(st().db, mailOnly, 'grp_res_quarterly')
    expect(plan.deliveryChanged).toBe(23 - before.mail)
    expect(plan.moved).toBe(0)
    st().saveBillingGroup(mailOnly, 'grp_res_quarterly')
    expect(deliveryMix(membersOf(st().db, 'grp_res_quarterly'))).toEqual({ mail: 23, email: 0, text: 0, portal: 0 })
    expect(() => st().setInvoiceDelivery('acct_res_maple', 'email')).toThrow(/sends every invoice by printed mail/)
    expect(() => st().portalSetDeliveryMethod('acct_res_maple', 'email')).toThrow(/billing group/)
  })

  it('an account joining a group that decides delivery takes it', () => {
    st().saveBillingGroup(draft({ name: 'Commercial monthly', delivery: 'portal', customerChoice: false }), 'grp_commercial_monthly')
    st().assignBillingGroup('acct_pm_oakridge', 'grp_commercial_monthly')
    expect(account('acct_pm_oakridge')).toMatchObject({ billingGroupId: 'grp_commercial_monthly', cycle: 'monthly', deliveryMethod: 'portal' })
  })

  it('taking an account out keeps its cycle', () => {
    st().assignBillingGroup('acct_res_001', null)
    expect(account('acct_res_001').billingGroupId).toBeUndefined()
    expect(account('acct_res_001').cycle).toBe('monthly')
  })
})

describe('running one group on its own', () => {
  const COMMERCIAL = 'grp_commercial_monthly'
  it('runs, approves, and posts only the group, and the cycle cannot move on until the rest has run', () => {
    const inGroup = new Set(membersOf(st().db, COMMERCIAL).map(a => a.id))
    const run = st().runCycle({ groupId: COMMERCIAL })
    expect(st().db.charges.filter(c => run.chargeIds.includes(c.id)).every(c => inGroup.has(c.accountId))).toBe(true)
    expect(uncoveredDueAccounts(st()).some(a => a.id === 'acct_res_maple')).toBe(true)
    expect(() => st().advanceCycle()).toThrow(/not billed yet/)
    for (const item of queueItems(st()).filter(i => !i.decided && inGroup.has(i.accountId))) st().approve(item.chargeId)
    st().bulkApproveClean({ groupId: COMMERCIAL })
    expect(st().post({ groupId: COMMERCIAL }).every(i => inGroup.has(i.accountId))).toBe(true)
    expect(st().runCycle().ranAll).toBe(true)
    expect(uncoveredDueAccounts(st())).toEqual([])
  })
})

describe('removing a group', () => {
  it('moves its members to another group, then removes it', () => {
    const r = st().deleteBillingGroup('grp_res_monthly', 'grp_commercial_monthly')
    expect(r.moved).toBe(10)
    expect(st().db.billingGroups.some(g => g.id === 'grp_res_monthly')).toBe(false)
    expect(membersOf(st().db, 'grp_commercial_monthly')).toHaveLength(19)
  })

  it('or takes them out of any group, keeping their cycle', () => {
    st().deleteBillingGroup('grp_res_monthly', null)
    expect(account('acct_res_001').billingGroupId).toBeUndefined()
    expect(account('acct_res_001').cycle).toBe('monthly')
    expect(st().db.accounts.filter(a => !a.billingGroupId)).toHaveLength(13)
  })

  it('removes an empty group, and refuses while members have unposted charges', () => {
    st().deleteBillingGroup('grp_res_quarterly_feb', null)
    expect(st().db.billingGroups.map(g => g.id)).toEqual(['grp_res_quarterly', 'grp_res_monthly', 'grp_commercial_monthly'])
    st().runCycle()
    expect(() => st().deleteBillingGroup('grp_res_quarterly', 'grp_res_monthly')).toThrow(/cannot move yet/)
    expect(st().db.billingGroups).toHaveLength(3)
  })
})
