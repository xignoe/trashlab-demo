/**
 * Adjustments (fees, surcharges, discounts, credits), tax layers, and the price tester (DECISIONS.md entries 64 and
 * 65). Pure functions over a Db: the sentences a person checks a rule by, the write rules for a new version of a
 * rule, and previews priced by the canonical engine on a copy of the db. Nothing here writes.
 */
import type { BillingAccount, Charge, FeeRule, Frequency, LineType, RateVersion, Site, TaxRule } from '../../../types'
import type { Db } from '../../../store/db'
import {
  computeCharge, feeRuleCents, feeRuleMiss, feeScopeFor, generateRecurringCharges, lineDims, lineFieldNumber, lineLob, rateDimsMatch, resolvePrice,
  taxRulesFor, type ResolvedPrice,
} from '../../../store/engine'
import { addDays, addMonths, dateOnly, firstOfNextMonth } from './dates'
import { pricingOf, withPreviewChargeIds } from './engine'
import { formatCents, formatPct } from './money'
import { dimensionById, dimensionLabel, valueLabel } from './config'

export const LINE_TYPES: LineType[] = ['recurring', 'event', 'fee', 'lateFee']
export const LINE_TYPE_LABEL: Record<LineType, string> = {
  recurring: 'Recurring service', event: 'Events and hauls', fee: 'One-time fees', lateFee: 'Late fees',
}

export type FeeCategory = NonNullable<FeeRule['category']>
export const FEE_CATEGORIES: FeeCategory[] = ['surcharge', 'regulatory', 'location', 'credit']
export const CATEGORY_LABEL: Record<FeeCategory, string> = {
  surcharge: 'Surcharges', regulatory: 'Regulatory fees', location: 'Location pricing', credit: 'Discounts and credits',
}
export const CATEGORY_HINT: Record<FeeCategory, string> = {
  surcharge: 'Added on top: fuel, rush, weekend, access',
  regulatory: 'Pass-through fees set by others',
  location: 'Distance from the yard and route density',
  credit: 'Taken off: tiers, loyalty, prepay, dense routes',
}

export function isLocationRule(rule: Pick<FeeRule, 'minMiles' | 'maxMiles' | 'minNeighborStops'>): boolean {
  return rule.minMiles !== undefined || rule.maxMiles !== undefined || rule.minNeighborStops !== undefined
}

export function feeCategory(rule: FeeRule): FeeCategory {
  if (rule.category) return rule.category
  if (rule.value < 0) return 'credit'
  return isLocationRule(rule) ? 'location' : 'surcharge'
}

/** "+7% of the line", "-10% of the line", "+$1.00 a month". */
export function feeAmountText(rule: Pick<FeeRule, 'kind' | 'value'>): string {
  const sign = rule.value < 0 ? '-' : '+'
  return rule.kind === 'percent' ? `${sign}${formatPct(Math.abs(rule.value))} of the line` : `${sign}${formatCents(Math.abs(rule.value))} a month`
}

export function distanceText(rule: Pick<FeeRule, 'minMiles' | 'maxMiles'>): string | null {
  const { minMiles: a, maxMiles: b } = rule
  if (a === undefined && b === undefined) return null
  if (a !== undefined && b !== undefined) return `${a} to ${b} mi from the yard`
  if (a !== undefined) return `${a} mi or more from the yard`
  return `under ${b} mi from the yard`
}

export function densityText(rule: Pick<FeeRule, 'minNeighborStops'>): string | null {
  return rule.minNeighborStops === undefined ? null : `${rule.minNeighborStops}+ stops within 1/4 mi`
}

/** "Customer tier: VIP or Friends and family" for each condition. */
export function whenText(db: Db, when: Record<string, string[]> | undefined): string[] {
  return Object.entries(when ?? {})
    .filter(([, values]) => values.length > 0)
    .map(([dimId, values]) => `${dimensionLabel(db, dimId)}: ${values.map(v => valueLabel(db, dimId, v)).join(' or ')}`)
}

/** Every condition and limit on a rule, as short phrases. */
export function feeScopeChips(db: Db, rule: FeeRule): string[] {
  const chips = whenText(db, rule.when)
  const d = distanceText(rule)
  if (d) chips.push(d)
  const n = densityText(rule)
  if (n) chips.push(n)
  if (rule.minCents !== undefined) chips.push(`at least ${formatCents(rule.minCents)} a month`)
  if (rule.maxCents !== undefined) chips.push(`at most ${formatCents(rule.maxCents)} a month`)
  if (rule.exemptContracts) chips.push('skips contract prices')
  if (rule.stackGroup) chips.push(`best of "${rule.stackGroup}"`)
  return chips
}

/** The engine's reason a rule missed a line, in words ("not this customerTier" becomes "not for this customer tier"). */
export function explainMiss(db: Db, miss: string): string {
  const m = /^not this (.+)$/.exec(miss)
  return m ? `not for this ${dimensionLabel(db, m[1]).toLowerCase()}` : miss
}

export type RuleState = 'active' | 'scheduled' | 'paused' | 'ended'

export function ruleState(rule: { status?: 'active' | 'paused'; effectiveFrom?: string; effectiveTo?: string }, today: string): RuleState {
  if (rule.effectiveTo && dateOnly(rule.effectiveTo) < dateOnly(today)) return 'ended'
  if (rule.status === 'paused') return 'paused'
  if (rule.effectiveFrom && dateOnly(rule.effectiveFrom) > dateOnly(today)) return 'scheduled'
  return 'active'
}

export interface RuleChain<T> {
  head: T
  older: T[]
}

/** Each chain of versions (linked by supersedesId) with its newest row as head, in the order the first version was created. */
export function ruleChains<T extends { id: string; supersedesId?: string }>(rules: readonly T[]): RuleChain<T>[] {
  const successor = new Set(rules.filter(r => r.supersedesId).map(r => r.supersedesId!))
  const byId = new Map(rules.map(r => [r.id, r] as [string, T]))
  const index = new Map(rules.map((r, i) => [r.id, i] as [string, number]))
  return rules
    .filter(r => !successor.has(r.id))
    .map(head => {
      const older: T[] = []
      let cur = head.supersedesId ? byId.get(head.supersedesId) : undefined
      while (cur) {
        older.push(cur)
        cur = cur.supersedesId ? byId.get(cur.supersedesId) : undefined
      }
      return { head, older }
    })
    .sort((a, b) => (index.get((a.older.at(-1) ?? a.head).id) ?? 0) - (index.get((b.older.at(-1) ?? b.head).id) ?? 0))
}

export type FeeRuleInput = Omit<FeeRule, 'id' | 'supersedesId' | 'effectiveFrom' | 'effectiveTo'>
export type TaxRuleInput = Omit<TaxRule, 'id' | 'supersedesId' | 'effectiveFrom' | 'effectiveTo'>

function dateProblems(effectiveFrom: string, today: string, previous?: { effectiveFrom?: string }): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly(effectiveFrom ?? ''))) return ['Enter an effective date']
  if (dateOnly(effectiveFrom) < dateOnly(today)) return [`The effective date cannot be before today (${dateOnly(today)}); a rule never reprices past billing`]
  if (previous?.effectiveFrom && dateOnly(effectiveFrom) <= dateOnly(previous.effectiveFrom)) {
    return [`Pick a date after ${dateOnly(previous.effectiveFrom)}, when the current version starts`]
  }
  return []
}

/** The problems with a fee rule a person entered; empty when it can be saved. */
export function validateFeeRule(input: FeeRuleInput, effectiveFrom: string, today: string, previous?: FeeRule): string[] {
  const problems: string[] = []
  if (!input.name.trim()) problems.push('Give the adjustment a name')
  if (input.appliesTo.length === 0) problems.push('Pick at least one kind of line')
  if (!Number.isFinite(input.value) || input.value === 0) problems.push('Enter an amount other than zero')
  if (input.kind === 'percent' && Math.abs(input.value) > 100) problems.push('A percentage must be between -100 and 100')
  if (input.kind === 'flat' && !Number.isInteger(input.value)) problems.push('A flat amount is whole cents')
  if (input.minMiles !== undefined && input.maxMiles !== undefined && input.minMiles >= input.maxMiles) problems.push('The distance band must end after it starts')
  if ([input.minMiles, input.maxMiles, input.minNeighborStops, input.minCents, input.maxCents].some(v => v !== undefined && (!Number.isFinite(v) || v < 0))) {
    problems.push('Distances, stop counts, and limits cannot be negative')
  }
  if (input.minCents !== undefined && input.maxCents !== undefined && input.minCents > input.maxCents) problems.push('The floor is above the cap')
  problems.push(...dateProblems(effectiveFrom, today, previous))
  return problems
}

/** The problems with a tax layer a person entered; empty when it can be saved. */
export function validateTaxRule(input: TaxRuleInput, effectiveFrom: string, today: string, zoneIds: ReadonlySet<string>, previous?: TaxRule): string[] {
  const problems: string[] = []
  if (!zoneIds.has(input.zoneId)) problems.push('Pick a zone')
  if (!Number.isFinite(input.ratePct) || input.ratePct < 0 || input.ratePct > 25) problems.push('A tax rate is between 0% and 25%')
  if (input.appliesTo.length === 0) problems.push('Pick at least one kind of line')
  if (input.appliesTo.includes('lateFee')) problems.push('Late fees are never taxed')
  problems.push(...dateProblems(effectiveFrom, today, previous))
  return problems
}

/** Drop undefined fields and empty scope lists and conditions, so a saved rule reads like a seeded one. */
function compact<T extends object>(o: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === '') continue
    if (k === 'when' && v && typeof v === 'object') {
      const when = Object.fromEntries(Object.entries(v as Record<string, string[]>).filter(([, vals]) => vals.length > 0))
      if (Object.keys(when).length) out.when = when
      continue
    }
    out[k] = v
  }
  return out as T
}

/**
 * A rules table after saving a version: a new rule is appended; a revision ends the previous version the day before
 * the new one starts and appends the new one with supersedesId. Nothing is removed and no other row changes.
 */
export function withRuleVersion<T extends { id: string; effectiveFrom?: string; effectiveTo?: string; supersedesId?: string }>(
  rows: readonly T[],
  input: object,
  args: { id: string; effectiveFrom: string; previousId?: string },
): { rows: T[]; saved: T } {
  const previous = args.previousId ? rows.find(r => r.id === args.previousId) : undefined
  if (args.previousId && !previous) throw new Error(`Unknown rule ${args.previousId}`)
  const saved = compact({ ...input, id: args.id, effectiveFrom: dateOnly(args.effectiveFrom), ...(previous ? { supersedesId: previous.id } : {}) }) as T
  const lastDay = addDays(args.effectiveFrom, -1)
  const next = rows.map(r => (r === previous && (!r.effectiveTo || dateOnly(r.effectiveTo) > lastDay) ? { ...r, effectiveTo: lastDay } : r))
  return { rows: [...next, saved], saved }
}

// ---------------------------------------------------------------------------
// Previews
// ---------------------------------------------------------------------------

export const SCRATCH_ACCOUNT_ID = 'acct_pr_scratch'
export const SCRATCH_SITE_ID = 'site_pr_scratch'

export interface ScratchSite {
  zoneId: string
  milesFromYard?: number
  neighborStops?: number
  taxExempt?: boolean
  cycle?: BillingAccount['cycle']
  /** Account and site dimension values to assign to the scratch account and site. */
  values?: Record<string, string>
}

/** A copy of the db with a synthetic account and site, so the engine can price a line nobody has yet. */
export function withScratchSite(db: Db, s: ScratchSite): Db {
  const account: BillingAccount = {
    id: SCRATCH_ACCOUNT_ID, payerPartyId: 'party_pr_scratch', cycle: s.cycle ?? 'monthly', billedInAdvance: true, autopay: false,
    status: 'active', deliveryMethod: 'email', taxExempt: !!s.taxExempt,
  }
  const site: Site = {
    id: SCRATCH_SITE_ID, accountId: SCRATCH_ACCOUNT_ID, address: 'Price test', zoneId: s.zoneId,
    ...(s.milesFromYard !== undefined ? { milesFromYard: s.milesFromYard } : {}),
    ...(s.neighborStops !== undefined ? { neighborStops: s.neighborStops } : {}),
  }
  const values = s.values ?? {}
  return {
    ...db,
    accounts: [...db.accounts.filter(a => a.id !== SCRATCH_ACCOUNT_ID), account],
    sites: [...db.sites.filter(x => x.id !== SCRATCH_SITE_ID), site],
    pricingDimensions: (db.pricingDimensions ?? []).map(d => {
      const v = values[d.id]
      if (!v || (d.source !== 'account' && d.source !== 'site')) return d
      return { ...d, assignments: { ...d.assignments, [d.source === 'account' ? SCRATCH_ACCOUNT_ID : SCRATCH_SITE_ID]: v } }
    }),
  }
}

export interface ImpactAccount {
  accountId: string
  name: string
  beforeCents: number
  afterCents: number
}

export interface RuleImpact {
  cycleDate: string
  accounts: ImpactAccount[]
  linesPriced: number
  linesChanged: number
  deltaCents: number
}

export function nextCycleOnOrAfter(day: string): string {
  const d = dateOnly(day)
  return d.endsWith('-01') ? d : firstOfNextMonth(d)
}

/**
 * What a change to the rules does to the first billing run on or after `from`: the canonical generateRecurringCharges
 * on a copy of the db with the rules as they are and as they would be, nothing skipped as already billed, and
 * throwaway charge ids. Posted invoices are never repriced; this only shows the next run.
 */
export function ruleImpact(db: Db, next: Partial<Pick<Db, 'feeRules' | 'taxRules' | 'pricingDimensions' | 'rateVersions'>>, from: string): RuleImpact {
  const cycleDate = nextCycleOnOrAfter(from)
  const run = (d: Db) => withPreviewChargeIds(() => generateRecurringCharges({ cycleDate }, { ...d, charges: [] }))
  const before = run(db)
  const after = run({ ...db, ...next })
  const key = (c: Charge) => `${c.source.id}|${c.period?.start ?? ''}`
  const beforeByKey = new Map(before.map(c => [key(c), c] as [string, Charge]))
  const totals = new Map<string, { before: number; after: number }>()
  const add = (accountId: string, side: 'before' | 'after', cents: number) => {
    const t = totals.get(accountId) ?? { before: 0, after: 0 }
    t[side] += cents
    totals.set(accountId, t)
  }
  for (const c of before) add(c.accountId, 'before', c.totalCents)
  let linesChanged = 0
  for (const c of after) {
    add(c.accountId, 'after', c.totalCents)
    const b = beforeByKey.get(key(c))
    if (!b || b.totalCents !== c.totalCents) linesChanged += 1
  }
  const nameOf = (accountId: string) => {
    const account = db.accounts.find(a => a.id === accountId)
    return db.parties.find(p => p.id === account?.payerPartyId)?.name ?? accountId
  }
  const accounts = [...totals.entries()]
    .filter(([, t]) => t.before !== t.after)
    .map(([accountId, t]) => ({ accountId, name: nameOf(accountId), beforeCents: t.before, afterCents: t.after }))
    .sort((a, b) => Math.abs(b.afterCents - b.beforeCents) - Math.abs(a.afterCents - a.beforeCents))
  return { cycleDate, accounts, linesPriced: after.length, linesChanged, deltaCents: accounts.reduce((s, a) => s + a.afterCents - a.beforeCents, 0) }
}

export interface LocationRow {
  site: Site
  accountId: string
  name: string
  monthlyBaseCents: number
  /** Monthly cents each location rule would add (negative for a credit), on the date the rule is in force. */
  hits: Record<string, number>
}

/** Every active site with recurring service, its monthly base, and what each given rule adds to it a month. */
export function locationRows(db: Db, rules: FeeRule[], today: string): LocationRow[] {
  const out: LocationRow[] = []
  for (const site of db.sites) {
    const account = db.accounts.find(a => a.id === site.accountId)
    if (!account || account.status === 'suspended') continue
    const items = db.serviceItems.filter(si => si.siteId === site.id && si.status === 'active' && si.frequency !== 'onCall')
    if (items.length === 0) continue
    let monthlyBaseCents = 0
    const hits: Record<string, number> = {}
    for (const item of items) {
      let price: ResolvedPrice
      try {
        price = resolvePrice({ catalogId: item.catalogId, frequency: item.frequency, zoneId: site.zoneId, accountId: account.id, onDate: today, siteId: site.id }, db)
      } catch {
        continue
      }
      const base = price.priceCents * item.qty
      monthlyBaseCents += base
      const lob = lineLob(item.catalogId, site, db)
      for (const rule of rules) {
        const day = rule.effectiveFrom && dateOnly(rule.effectiveFrom) > dateOnly(today) ? dateOnly(rule.effectiveFrom) : dateOnly(today)
        const dims = lineDims({ accountId: account.id, siteId: site.id, catalogId: item.catalogId, frequency: item.frequency, onDate: day, lineType: 'recurring' }, db)
        const scope = feeScopeFor(site, 'recurring', day, lob, price.ruleWon === 'contractOverride', dims)
        if (feeRuleMiss(rule, scope) !== null) continue
        hits[rule.id] = (hits[rule.id] ?? 0) + feeRuleCents(rule, base, 1)
      }
    }
    const name = db.parties.find(p => p.id === account.payerPartyId)?.name ?? account.id
    out.push({ site, accountId: account.id, name, monthlyBaseCents, hits })
  }
  return out
}

// ---------------------------------------------------------------------------
// Price tester
// ---------------------------------------------------------------------------

export interface PriceTestInput {
  catalogId: string
  frequency: Frequency
  zoneId: string
  lineType: 'recurring' | 'event'
  onDate: string
  /** Months in the period for a recurring line. */
  months: number
  /** Values for any dimension: account, site, and input ones, material, or an override of a line value. */
  values: Record<string, string>
  milesFromYard?: number
  neighborStops?: number
  cycle?: BillingAccount['cycle']
  contractPriced: boolean
  taxExempt: boolean
}

export type CandidateOutcome = 'won' | 'lessSpecific' | 'superseded' | 'notYet' | 'otherZone' | 'otherFrequency' | 'dimsDiffer' | 'ended'

export interface RateCandidate {
  rate: RateVersion
  outcome: CandidateOutcome
  detail: string
}

export interface FeeRow {
  rule: FeeRule
  cents?: number
  miss: string | null
  /** It applied, but a larger rule in the same stack group won. */
  lostStack: boolean
}

export interface PriceTestResult {
  dims: Record<string, string>
  price?: ResolvedPrice
  candidates: RateCandidate[]
  charge?: Charge
  feeRows: FeeRow[]
  taxRows: { rule: TaxRule; cents: number }[]
  taxableCents: number
  /**
   * Set when the service multiplies its price by a number field (ServiceCatalog.quantityField): the number the line
   * carries (undefined when none), and the factor the base was multiplied by (1 for an event, or with no number).
   */
  quantity?: { fieldId: string; number?: number; factor: number }
  error?: string
}

/**
 * Prices one line exactly as billing would, on a synthetic account and site carrying the chosen values, and says why:
 * which rate won and why each other rate for the service did not, which adjustments applied or missed, and each tax
 * layer. Every figure comes from the canonical resolvePrice and computeCharge.
 */
export function testPrice(db: Db, input: PriceTestInput): PriceTestResult {
  const world = withScratchSite(db, {
    zoneId: input.zoneId, taxExempt: input.taxExempt, values: input.values,
    ...(input.milesFromYard !== undefined ? { milesFromYard: input.milesFromYard } : {}),
    ...(input.neighborStops !== undefined ? { neighborStops: input.neighborStops } : {}),
    ...(input.cycle ? { cycle: input.cycle } : {}),
  })
  const inputValues = Object.fromEntries(
    Object.entries(input.values).filter(([k, v]) => {
      const d = dimensionById(db, k)
      return !!v && (!d || (d.source !== 'account' && d.source !== 'site'))
    }),
  )
  const dims = lineDims({
    accountId: SCRATCH_ACCOUNT_ID, siteId: SCRATCH_SITE_ID, catalogId: input.catalogId, frequency: input.frequency, zoneId: input.zoneId,
    onDate: input.onDate, lineType: input.lineType, input: inputValues,
  }, world)
  const day = dateOnly(input.onDate)
  const empty: PriceTestResult = { dims, candidates: [], feeRows: [], taxRows: [], taxableCents: 0 }

  let price: ResolvedPrice
  try {
    price = resolvePrice({
      catalogId: input.catalogId, frequency: input.frequency, zoneId: input.zoneId, accountId: SCRATCH_ACCOUNT_ID, siteId: SCRATCH_SITE_ID,
      onDate: day, context: inputValues,
    }, world)
  } catch (e) {
    return { ...empty, candidates: candidatesFor(db, input, dims, undefined), error: e instanceof Error ? e.message : String(e) }
  }

  const months = input.lineType === 'recurring' ? Math.max(1, input.months) : 1
  // A service priced per unit of a number field bills price x that number on a recurring line, as
  // generateRecurringCharges does (DECISIONS.md entry 68). Account and site numbers sit on the scratch rows; service
  // line and quote numbers come in as input values.
  const quantityField = db.catalog.find(c => c.id === input.catalogId)?.quantityField
  const quantityNumber = quantityField ? lineFieldNumber(quantityField, { accountId: SCRATCH_ACCOUNT_ID, siteId: SCRATCH_SITE_ID, input: inputValues }, world) : undefined
  const factor = quantityField && input.lineType === 'recurring' ? quantityNumber ?? 1 : 1
  const quantity = quantityField ? { quantity: { fieldId: quantityField, factor, ...(quantityNumber !== undefined ? { number: quantityNumber } : {}) } } : {}
  const charge = computeCharge({
    id: 'chg_pr_price_test', accountId: SCRATCH_ACCOUNT_ID, siteId: SCRATCH_SITE_ID, lineType: input.lineType, catalogId: input.catalogId,
    frequency: input.frequency, baseCents: Math.round(price.priceCents * factor * months),
    ...(input.lineType === 'recurring' ? { period: { start: day, end: addDays(addMonths(day, months), -1) } } : { servicedOn: day }),
    source: { type: 'manual', id: 'price_test' }, description: 'Price test',
    pricing: input.contractPriced ? { ruleWon: 'contractOverride', contractId: 'contract_pr_price_test' } : pricingOf(price),
    context: inputValues,
  }, world)

  const site = world.sites.find(s => s.id === SCRATCH_SITE_ID)!
  const scope = feeScopeFor(site, input.lineType, day, lineLob(input.catalogId, site, world), input.contractPriced, dims)
  const feeRows: FeeRow[] = db.feeRules
    .filter(r => ruleState(r, day) !== 'ended')
    .map(rule => {
      const miss = feeRuleMiss(rule, scope)
      const cents = charge.fees.find(f => f.feeRuleId === rule.id)?.cents
      return { rule, miss, lostStack: miss === null && cents === undefined, ...(cents !== undefined ? { cents } : {}) }
    })
  const taxableCents = charge.baseCents + charge.fees.filter(f => db.feeRules.find(r => r.id === f.feeRuleId)?.taxable).reduce((s, f) => s + f.cents, 0)
  const taxRows = input.taxExempt ? [] : taxRulesFor(input.zoneId, input.lineType, day, dims, world).map(rule => ({ rule, cents: Math.round(taxableCents * rule.ratePct / 100) }))

  return { dims, price, candidates: candidatesFor(db, input, dims, price), charge, feeRows, taxRows, taxableCents, ...quantity }
}

function candidatesFor(db: Db, input: PriceTestInput, dims: Record<string, string>, price: ResolvedPrice | undefined): RateCandidate[] {
  const day = dateOnly(input.onDate)
  const winner = price?.rateVersionId ? db.rateVersions.find(rv => rv.id === price.rateVersionId) : undefined
  const winnerDims = winner?.dims ? Object.keys(winner.dims).length : 0
  const superseded = new Set(db.rateVersions.filter(rv => rv.supersedesId).map(rv => rv.supersedesId!))
  return db.rateVersions
    .filter(rv => rv.catalogId === input.catalogId && rv.status === 'published')
    .map((rate): RateCandidate => {
      if (rate.id === winner?.id) return { rate, outcome: 'won', detail: winnerDims ? 'most specific match in force' : 'in force for this zone and frequency' }
      if (rate.zoneId && rate.zoneId !== input.zoneId) return { rate, outcome: 'otherZone', detail: `for ${valueLabel(db, 'zone', rate.zoneId)}` }
      if (rate.frequency && rate.frequency !== input.frequency) return { rate, outcome: 'otherFrequency', detail: `for ${valueLabel(db, 'frequency', rate.frequency)}` }
      if (!rateDimsMatch(rate.dims, dims)) {
        const [k, v] = Object.entries(rate.dims ?? {}).find(([dk, dv]) => dims[dk] !== dv) ?? ['', '']
        return { rate, outcome: 'dimsDiffer', detail: `only for ${dimensionLabel(db, k).toLowerCase()} ${valueLabel(db, k, v)}` }
      }
      if (dateOnly(rate.effectiveFrom) > day) return { rate, outcome: 'notYet', detail: `starts ${dateOnly(rate.effectiveFrom)}` }
      const rateDims = rate.dims ? Object.keys(rate.dims).length : 0
      if (winner && (rateDims < winnerDims || (!rate.zoneId && winner.zoneId))) return { rate, outcome: 'lessSpecific', detail: 'a more specific rate matched' }
      if (superseded.has(rate.id)) return { rate, outcome: 'superseded', detail: 'replaced by a newer version' }
      return { rate, outcome: 'superseded', detail: 'an equally specific rate is newer' }
    })
    .sort((a, b) => (a.outcome === 'won' ? -1 : b.outcome === 'won' ? 1 : 0))
}
