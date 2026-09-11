/**
 * Pricing kernel. Pure functions that read the injected db through getEngineDb().
 * No zustand here: tests inject a seed clone, the store binds its live state.
 *
 * Trailing db (addendum C2): every exported function that reads the db also takes an optional last argument
 * `db?: Db`. When it is given, the call runs inside withEngineDb(db, ...) and the previous binding is restored
 * afterwards; when it is omitted, the function reads the bound db exactly as before. Functions that read no db
 * (formatters, id helpers) and functions whose first argument is already a Db (applyPosting, appendCharges,
 * nextInvoiceNumber) take no trailing db.
 *
 * Rounding: Math.round on cents at each step. Each fee is rounded on its own,
 * then tax is rounded once on (base + taxable fees).
 */
import { stamp, today } from './clock'
import type {
  BillingAccount, Charge, Contract, FeeRule, Frequency, Invoice, LineType, LOB, OverageTier, PaymentAllocation, RateVersion, RolloffMaterial,
  RolloffPolicy, RolloffRate, ServiceCatalog, Site, TaxRule,
} from '../types'
import { EVENT_RATES } from '../seed'
import { getEngineDb, withEngineDb, type Db } from './db'
import { addDays, addMonths, billingFactor, cadenceOf, daysBetween, flatFeeMonths, isDue, periodFor, periodLabel, shortDate, wholeMonths, type Period } from './cycles'

// ---------------------------------------------------------------------------
// Event rate table (seed/eventRates.json). Typed here per DECISIONS.md entry 1.
// ---------------------------------------------------------------------------

export type BillableException = 'extraBags' | 'overload' | 'contamination' | 'dryRun'
export type EventRateTable = Record<BillableException, number>

export const eventRates: EventRateTable = {
  extraBags: EVENT_RATES.extraBags,
  overload: EVENT_RATES.overload,
  contamination: EVENT_RATES.contamination,
  dryRun: EVENT_RATES.dryRun,
}

export function isBillableException(x: string | undefined): x is BillableException {
  return x === 'extraBags' || x === 'overload' || x === 'contamination' || x === 'dryRun'
}

// ---------------------------------------------------------------------------
// Runtime ids (addendum C12, DECISIONS.md entry 26). Everything billing mints at runtime carries the
// `_bl_` infix: `chg_bl_0001`, `inv_bl_0001`. A rate version billing publishes is pricing's row (`rv_pr_`, box 3.6).
// Counters start above the highest numeric suffix already in the db for that prefix, so ids never collide with seed
// rows or earlier runs.
// ---------------------------------------------------------------------------

export type IdGenerator = () => string

/** Highest numeric suffix among ids shaped `${prefix}####`, or 0 when there are none. */
export function maxIdSuffix(ids: Iterable<string>, prefix: string): number {
  let max = 0
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue
    const rest = id.slice(prefix.length)
    if (/^\d+$/.test(rest)) max = Math.max(max, Number(rest))
  }
  return max
}

/** `${prefix}` plus a four digit zero padded counter. */
export function formatId(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(4, '0')}`
}

export const CHARGE_ID_PREFIX = 'chg_bl_'
export const INVOICE_ID_PREFIX = 'inv_bl_'

let chargeCounter = 0
/** Default generator: one above the larger of the session counter and the highest `chg_bl_` suffix in the db. */
const defaultIdGenerator: IdGenerator = () => {
  const floor = maxIdSuffix(getEngineDb().charges.map(c => c.id), CHARGE_ID_PREFIX)
  chargeCounter = Math.max(chargeCounter, floor) + 1
  return formatId(CHARGE_ID_PREFIX, chargeCounter)
}
let idGenerator: IdGenerator = defaultIdGenerator

/** Swap the charge id generator (tests can make ids fully predictable). Pass nothing to restore the default. */
export function setChargeIdGenerator(gen?: IdGenerator): void {
  idGenerator = gen ?? defaultIdGenerator
}

/** Restore the default generator and rewind its session counter so a test run is repeatable. */
export function resetChargeIds(): void {
  chargeCounter = 0
  idGenerator = defaultIdGenerator
}

/** Next unused charge id. Skips ids already present in the db so an injected generator never collides with existing rows. */
export function nextChargeId(db?: Db): string {
  if (db) return withEngineDb(db, () => nextChargeId())
  const existing = new Set(getEngineDb().charges.map(c => c.id))
  let id = idGenerator()
  let guard = 0
  while (existing.has(id) && guard++ < 10_000) id = idGenerator()
  return id
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function findAccount(accountId: string, db?: Db): BillingAccount {
  if (db) return withEngineDb(db, () => findAccount(accountId))
  const a = getEngineDb().accounts.find(x => x.id === accountId)
  if (!a) throw new Error(`Unknown account ${accountId}`)
  return a
}

export function findSite(siteId: string, db?: Db): Site {
  if (db) return withEngineDb(db, () => findSite(siteId))
  const s = getEngineDb().sites.find(x => x.id === siteId)
  if (!s) throw new Error(`Unknown site ${siteId}`)
  return s
}

export function findCatalog(catalogId: string, db?: Db): ServiceCatalog | undefined {
  if (db) return withEngineDb(db, () => findCatalog(catalogId))
  return getEngineDb().catalog.find(x => x.id === catalogId)
}

/** ISO date portion (YYYY-MM-DD) of a date or timestamp string, for ordering comparisons. */
export function dayOf(iso: string): string {
  return iso.slice(0, 10)
}

// ---------------------------------------------------------------------------
// resolvePrice
// ---------------------------------------------------------------------------

export interface ResolvePriceInput {
  catalogId: string
  frequency: Frequency
  zoneId: string
  accountId: string
  onDate: string
  /** The line's site, so site dimensions (PricingDimension source site) can key a rate. */
  siteId?: string
  /** The service line, so service line fields (PricingDimension source serviceLine) can key a rate. */
  serviceItemId?: string
  /** Values for input dimensions (service speed and the like) and any override; the rest is read from the line. */
  context?: Record<string, string>
}

export interface ResolvedPrice {
  priceCents: number
  rateVersionId?: string
  contractId?: string
  ruleWon: Charge['pricing']['ruleWon']
  /** The extra dimension values of the winning rate, when it is keyed by any (RateVersion.dims). */
  dims?: Record<string, string>
  /**
   * Set only when a lapsed contract was auto-renewed (addendum I1): the first day of the renewed term that contains
   * onDate, so a surface can say "auto-renewed on <date>". Charge.pricing has no field for it (types.ts is frozen).
   */
  renewedOn?: string
  /** Set only when the contract's escalator has stepped: how many anniversaries were applied on or before onDate. */
  escalations?: number
}

/** The term of a contract that contains a day: the signed term, or an auto-renewed one (addendum I1). */
export interface ContractTerm {
  start: string
  end: string
  /** 0 for the signed term, 1 for the first renewal, and so on. */
  renewal: number
}

/**
 * The contract term containing `day`, or undefined when the day is before termStart or the contract was replaced.
 * Addendum I1: past termEnd a contract auto-renews for another term of the same length, as many times as it takes.
 * A term of whole months (Jan 1 to Dec 31 is 12) renews by month arithmetic; any other term renews by its day count.
 * Addendum K3: a lapsed contract whose account has since opened another contract, starting after this one's termEnd
 * and on or before `day`, is history and does not renew.
 */
export function contractTermOn(contract: Contract, day: string, others: readonly Contract[] = []): ContractTerm | undefined {
  const d = dayOf(day)
  const start = dayOf(contract.termStart)
  const end = dayOf(contract.termEnd)
  if (d < start || end < start) return undefined
  if (d <= end) return { start, end, renewal: 0 }
  const replaced = others.some(o =>
    o.id !== contract.id && o.accountId === contract.accountId && dayOf(o.termStart) > end && dayOf(o.termStart) <= d)
  if (replaced) return undefined
  const months = wholeMonths({ start, end })
  const monthTerm = addDays(addMonths(start, months), -1) === end
  const days = daysBetween(start, end) + 1
  const startOf = (k: number) => (monthTerm ? addMonths(start, k * months) : addDays(start, k * days))
  let k = 1
  while (addDays(startOf(k + 1), -1) < d && k < 10_000) k += 1
  return { start: startOf(k), end: addDays(startOf(k + 1), -1), renewal: k }
}

/**
 * How many escalator anniversaries fall on or before `day`. Addendum B1: the anniversary is a full ISO date, the
 * first escalation; it then recurs every twelve months (account's nextAnniversary reads it the same way).
 */
export function escalatorSteps(contract: Pick<Contract, 'escalator'>, day: string): number {
  const esc = contract.escalator
  if (!esc) return 0
  const first = dayOf(esc.anniversary)
  const d = dayOf(day)
  let n = 0
  while (addMonths(first, 12 * n) <= d && n < 1000) n += 1
  return n
}

/** An override price after `steps` escalator anniversaries, rounded half up after each step (addendum C6). */
export function escalatedCents(priceCents: number, pct: number, steps: number): number {
  let cents = priceCents
  for (let i = 0; i < steps; i++) cents = Math.round(cents * (1 + pct / 100))
  return cents
}

/** Latest effectiveFrom not after onDate wins; ties go to the later publishedAt, then the later row. */
function latestEffective(candidates: RateVersion[], day: string): RateVersion | undefined {
  let best: RateVersion | undefined
  for (const rv of candidates) {
    if (rv.status !== 'published') continue
    if (dayOf(rv.effectiveFrom) > day) continue
    if (!best) { best = rv; continue }
    const a = dayOf(rv.effectiveFrom)
    const b = dayOf(best.effectiveFrom)
    if (a > b || (a === b && (rv.publishedAt ?? '') >= (best.publishedAt ?? ''))) best = rv
  }
  return best
}

/** True when the line has every dimension value the rate is keyed by. A rate with no dims matches every line. */
export function rateDimsMatch(dims: Record<string, string> | undefined, ctx: Record<string, string>): boolean {
  if (!dims) return true
  for (const [k, v] of Object.entries(dims)) if (ctx[k] !== v) return false
  return true
}

const dimCount = (rv: RateVersion) => (rv.dims ? Object.keys(rv.dims).length : 0)

/** The most specific candidates in force on the day win; inside one level, the latest effective (latestEffective). */
function mostSpecificEffective(candidates: RateVersion[], day: string): RateVersion | undefined {
  const levels = [...new Set(candidates.map(dimCount))].sort((a, b) => b - a)
  for (const level of levels) {
    const hit = latestEffective(candidates.filter(c => dimCount(c) === level), day)
    if (hit) return hit
  }
  return undefined
}

function withRateDims(r: ResolvedPrice, rv: RateVersion): ResolvedPrice {
  return rv.dims && Object.keys(rv.dims).length > 0 ? { ...r, dims: { ...rv.dims } } : r
}

/** A rate version with no frequency is a wildcard; one with a frequency must match the requested one. */
function frequencyMatches(ruleFrequency: Frequency | undefined, wanted: Frequency | undefined): boolean {
  if (ruleFrequency === undefined || wanted === undefined) return true
  return ruleFrequency === wanted
}

/**
 * Precedence (SHARED_CONTRACT.md, binding):
 *   1. contract override for this account and catalog (frequency match when the override has one)  ruleWon contractOverride
 *   2. published RateVersion matching zone and frequency                                            ruleWon zoneRate
 *   3. published RateVersion with no zoneId                                                          ruleWon standardRate
 *   4. throw, naming catalogId, zoneId, and date
 * Among candidates the latest effectiveFrom not after onDate wins. Drafts are ignored.
 */
export function resolvePrice(input: ResolvePriceInput, db?: Db): ResolvedPrice {
  if (db) return withEngineDb(db, () => resolvePrice(input))
  return resolvePriceLoose(input)
}

/** Same as resolvePrice but frequency may be omitted, in which case any rate frequency qualifies. */
function resolvePriceLoose(input: Omit<ResolvePriceInput, 'frequency'> & { frequency?: Frequency }): ResolvedPrice {
  const db = getEngineDb()
  const { catalogId, frequency, zoneId, accountId, onDate } = input
  const day = dayOf(onDate)

  // 1. Contract override. Contracts are matched by accountId (and the account's contractId, if any) on a term that
  // contains the day: the signed term first, then an auto-renewed one (addendum I1). Among in-term contracts the
  // account's linked contract comes first, then db order. Inside a contract the FIRST matching override wins
  // (pricing writes the newest override first and keeps older rows after it as history; Phase 3.7e pins this).
  const account = db.accounts.find(a => a.id === accountId)
  const linked = (c: Contract) => account?.contractId !== undefined && c.id === account.contractId
  const mine = db.contracts.filter(c => c.accountId === accountId || linked(c))
  const candidates = mine
    .map((contract, index) => ({ contract, index, term: contractTermOn(contract, day, mine) }))
    .filter((x): x is { contract: Contract; index: number; term: ContractTerm } => x.term !== undefined)
    .sort((a, b) => (a.term.renewal > 0 ? 1 : 0) - (b.term.renewal > 0 ? 1 : 0)
      || Number(linked(b.contract)) - Number(linked(a.contract))
      || a.index - b.index)
  for (const { contract, term } of candidates) {
    const override = contract.overrides.find(o => o.catalogId === catalogId && frequencyMatches(o.frequency, frequency))
    if (!override) continue
    const steps = escalatorSteps(contract, day)
    const out: ResolvedPrice = {
      priceCents: steps > 0 ? escalatedCents(override.priceCents, contract.escalator!.pct, steps) : override.priceCents,
      contractId: contract.id,
      ruleWon: 'contractOverride',
    }
    if (term.renewal > 0) out.renewedOn = term.start
    if (steps > 0) out.escalations = steps
    return out
  }

  // Rates keyed by extra dimensions (RateVersion.dims, DECISIONS.md entry 65) match only a line that has every one of
  // those values, and among the matches in a tier the most specific wins. A rate with no dims matches every line, so a
  // ratebook without dimension rates resolves exactly as before (and the line's values are not even read).
  const dimmed = db.rateVersions.some(rv => rv.catalogId === catalogId && rv.dims !== undefined && Object.keys(rv.dims).length > 0)
  const ctx = dimmed
    ? lineDims({
      accountId, zoneId, onDate: day, catalogId,
      ...(frequency ? { frequency } : {}), ...(input.siteId ? { siteId: input.siteId } : {}), ...(input.context ? { input: input.context } : {}),
      ...(input.serviceItemId ? { serviceItemId: input.serviceItemId } : {}),
    })
    : {}
  // A rate for new service only (RateVersion.appliesTo, DECISIONS.md entry 67) skips a line that was in service before
  // the rate took effect, so that line keeps resolving to the rate it had. A caller with no line (a quote, a sign-up)
  // is pricing new service.
  const lineStart = input.serviceItemId ? db.serviceItems.find(si => si.id === input.serviceItemId)?.effectiveFrom : undefined
  const billsLine = (rv: RateVersion) => rv.appliesTo !== 'newService' || lineStart === undefined || dayOf(lineStart) >= dayOf(rv.effectiveFrom)
  const forCatalog = db.rateVersions.filter(rv =>
    rv.catalogId === catalogId && frequencyMatches(rv.frequency, frequency) && rateDimsMatch(rv.dims, ctx) && billsLine(rv))

  // 2. Zone rate.
  const zoneRate = mostSpecificEffective(forCatalog.filter(rv => rv.zoneId === zoneId), day)
  if (zoneRate) return withRateDims({ priceCents: zoneRate.priceCents, rateVersionId: zoneRate.id, ruleWon: 'zoneRate' }, zoneRate)

  // 3. Standard rate (no zone).
  const standardRate = mostSpecificEffective(forCatalog.filter(rv => rv.zoneId === undefined || rv.zoneId === null), day)
  if (standardRate) return withRateDims({ priceCents: standardRate.priceCents, rateVersionId: standardRate.id, ruleWon: 'standardRate' }, standardRate)

  // 4. Nothing published.
  throw new Error(`No published rate for ${catalogId} in ${zoneId} on ${day}`)
}

// ---------------------------------------------------------------------------
// computeCharge
// ---------------------------------------------------------------------------

export interface ComputeChargeInput {
  accountId: string
  siteId: string
  lineType: LineType
  baseCents: number
  servicedOn?: string
  period?: { start: string; end: string }
  source: Charge['source']
  catalogId?: string
  description?: string
  /** Optional: caller supplied pricing is used as given. When absent and catalogId is set, resolvePrice fills it. */
  pricing?: Charge['pricing']
  /** Optional: frequency for the resolvePrice call. Defaults to the site's service item for this catalog. */
  frequency?: Frequency
  /** Optional: values for input dimensions (service speed and the like), as ResolvePriceInput.context. */
  context?: Record<string, string>
  /** Optional: explicit id (tests, or a caller that already reserved one). */
  id?: string
  evidenceIds?: string[]
  status?: Charge['status']
}

function round(n: number): number {
  return Math.round(n)
}

/** The frequency a resolvePrice call should use when the caller did not say: the site's service item for that catalog. */
function inferFrequency(siteId: string, catalogId: string): Frequency | undefined {
  const items = getEngineDb().serviceItems.filter(si => si.siteId === siteId && si.catalogId === catalogId)
  const active = items.find(si => si.status === 'active') ?? items[0]
  return active?.frequency
}

function defaultDescription(input: ComputeChargeInput): string {
  const cat = input.catalogId ? findCatalog(input.catalogId) : undefined
  if (cat) return cat.name
  switch (input.lineType) {
    case 'lateFee': return 'Late fee'
    case 'fee': return 'Fee'
    case 'event': return 'Service event'
    default: return 'Service'
  }
}

/**
 * Builds a proposed Charge from a base amount.
 *   fees:  every FeeRule whose appliesTo includes lineType. percent: round(baseCents * value / 100);
 *          flat: value x whole months in input.period (1 when the charge has servicedOn), per addendum C5.
 *   tax:   round((baseCents + taxable fee cents) * ratePct / 100) when a TaxRule for the site's zone lists lineType.
 *          0 when the account is taxExempt. Always 0 for lateFee.
 *   total: base + fees + tax.
 *   pricing: as given by the caller, else resolved via resolvePrice when catalogId is present.
 */
export function computeCharge(input: ComputeChargeInput, db?: Db): Charge {
  if (db) return withEngineDb(db, () => computeCharge(input))
  return computeChargeBound(input)
}

function computeChargeBound(input: ComputeChargeInput): Charge {
  const db = getEngineDb()
  const account = findAccount(input.accountId)
  const site = findSite(input.siteId)
  if (!Number.isInteger(input.baseCents)) throw new Error(`baseCents must be integer cents, got ${input.baseCents}`)
  if (!input.servicedOn && !input.period) throw new Error('computeCharge needs servicedOn or period')

  const baseCents = input.baseCents
  const onDate = input.servicedOn ?? input.period!.start
  const day = dayOf(onDate)
  const lineFrequency = input.frequency ?? (input.catalogId ? inferFrequency(input.siteId, input.catalogId) : undefined)

  // Pricing: caller wins, else resolve when a catalog is named, else a sensible default. Resolved before the fees
  // because a fee rule marked exemptContracts skips a line a contract override priced.
  let pricing: Charge['pricing']
  const serviceItemId = input.source.type === 'serviceItem' ? input.source.id : undefined
  if (input.pricing) {
    pricing = input.pricing
  } else if (input.catalogId) {
    const r = resolvePriceLoose({
      catalogId: input.catalogId,
      frequency: lineFrequency,
      zoneId: site.zoneId,
      accountId: input.accountId,
      onDate,
      siteId: input.siteId,
      ...(serviceItemId ? { serviceItemId } : {}),
      ...(input.context ? { context: input.context } : {}),
    })
    pricing = { ruleWon: r.ruleWon }
    if (r.rateVersionId) pricing.rateVersionId = r.rateVersionId
    if (r.contractId) pricing.contractId = r.contractId
  } else {
    pricing = { ruleWon: input.source.type === 'manual' ? 'manualException' : 'standardRate' }
  }

  // Fees, each rounded individually. A flat fee applies once per whole month in the period (addendum C5):
  // a quarterly line takes it three times; a line with servicedOn instead of a period takes it once. A period shorter
  // than a month (a weekly or daily billing group, addendum Q) takes that fraction of it. A rule applies
  // when its scope matches the line (feeRuleMiss); a rule with no scope fields applies to every line it lists.
  const flatMultiplier = input.period ? flatFeeMonths(input.period) : 1
  const lob = lineLob(input.catalogId, site)
  const dims = lineDims({
    accountId: input.accountId, siteId: input.siteId, zoneId: site.zoneId, onDate: day, lineType: input.lineType,
    ...(input.catalogId ? { catalogId: input.catalogId } : {}),
    ...(lineFrequency ? { frequency: lineFrequency } : {}),
    ...(serviceItemId ? { serviceItemId } : {}),
    ...(input.context ? { input: input.context } : {}),
  })
  const scope = feeScopeFor(site, input.lineType, day, lob, pricing.ruleWon === 'contractOverride', dims)
  const applied: { rule: FeeRule; cents: number }[] = []
  for (const rule of db.feeRules) {
    if (feeRuleApplies(rule, scope)) applied.push({ rule, cents: feeRuleCents(rule, baseCents, flatMultiplier) })
  }
  const fees: Charge['fees'] = []
  let taxableFeeCents = 0
  for (const { rule, cents } of keepStackWinners(applied)) {
    fees.push({ feeRuleId: rule.id, cents })
    if (rule.taxable) taxableFeeCents += cents
  }
  const feeCents = fees.reduce((sum, f) => sum + f.cents, 0)

  // Tax, rounded once per layer on base plus taxable fees. A zone's layers in force on the day add up.
  let taxCents = 0
  if (input.lineType !== 'lateFee' && !account.taxExempt) {
    for (const t of taxRulesFor(site.zoneId, input.lineType, day, dims)) taxCents += round((baseCents + taxableFeeCents) * t.ratePct / 100)
  }

  const charge: Charge = {
    id: input.id ?? nextChargeId(),
    accountId: input.accountId,
    siteId: input.siteId,
    lineType: input.lineType,
    description: input.description ?? defaultDescription(input),
    source: { ...input.source },
    baseCents,
    fees,
    taxCents,
    totalCents: baseCents + feeCents + taxCents,
    pricing,
    status: input.status ?? 'proposed',
    evidenceIds: input.evidenceIds ? [...input.evidenceIds] : [],
  }
  if (input.catalogId) charge.catalogId = input.catalogId
  if (input.period) charge.period = { ...input.period }
  if (input.servicedOn) charge.servicedOn = input.servicedOn
  return charge
}

/** Sum of fee cents on a charge, for callers that show base, fees, tax, total. */
export function feeTotal(charge: Pick<Charge, 'fees'>): number {
  return charge.fees.reduce((sum, f) => sum + f.cents, 0)
}

// ---------------------------------------------------------------------------
// Rule scope (pricing model, DECISIONS.md entry 64). Every optional FeeRule and TaxRule field that is left out
// means "no restriction", so the seed's unscoped fuel, environmental, and tax rules price exactly as before.
// ---------------------------------------------------------------------------

/** What a fee rule is matched against: the line, its day, and where the site is. */
export interface FeeScope {
  onDate: string
  lineType: LineType
  zoneId: string
  lob?: LOB
  milesFromYard?: number
  neighborStops?: number
  /** A contract override priced the line. */
  contractPriced: boolean
  /** Every dimension value the line has (lineDims). FeeRule.when is checked against these. */
  dims: Record<string, string>
}

/** The scope for a line at a site. */
export function feeScopeFor(
  site: Pick<Site, 'zoneId' | 'milesFromYard' | 'neighborStops'>, lineType: LineType, onDate: string, lob: LOB | undefined, contractPriced: boolean,
  dims: Record<string, string> = {},
): FeeScope {
  return {
    onDate: dayOf(onDate),
    lineType,
    zoneId: site.zoneId,
    contractPriced,
    dims: { ...dims, zone: site.zoneId, ...(lob ? { lob } : {}) },
    ...(lob ? { lob } : {}),
    ...(site.milesFromYard !== undefined ? { milesFromYard: site.milesFromYard } : {}),
    ...(site.neighborStops !== undefined ? { neighborStops: site.neighborStops } : {}),
  }
}

/** In force on the day: effectiveFrom absent or on or before it, effectiveTo (inclusive) absent or on or after it. */
export function ruleInEffect(rule: { effectiveFrom?: string; effectiveTo?: string }, day: string): boolean {
  const d = dayOf(day)
  if (rule.effectiveFrom && dayOf(rule.effectiveFrom) > d) return false
  if (rule.effectiveTo && dayOf(rule.effectiveTo) < d) return false
  return true
}

/** Why a fee rule does not apply to a line, or null when it does. computeCharge only asks whether; the Ratebook says why. */
export function feeRuleMiss(rule: FeeRule, scope: FeeScope): string | null {
  if (rule.status === 'paused') return 'paused'
  if (!rule.appliesTo.includes(scope.lineType)) return `not on ${scope.lineType} lines`
  if (rule.effectiveFrom && dayOf(rule.effectiveFrom) > dayOf(scope.onDate)) return `starts ${dayOf(rule.effectiveFrom)}`
  if (rule.effectiveTo && dayOf(rule.effectiveTo) < dayOf(scope.onDate)) return `ended ${dayOf(rule.effectiveTo)}`
  const failed = whenMiss(rule.when, scope.dims)
  if (failed) return `not this ${failed}`
  if (rule.minMiles !== undefined || rule.maxMiles !== undefined) {
    const miles = scope.milesFromYard
    if (miles === undefined) return 'site has no distance on file'
    if (rule.minMiles !== undefined && miles < rule.minMiles) return `under ${rule.minMiles} mi`
    if (rule.maxMiles !== undefined && miles >= rule.maxMiles) return `${rule.maxMiles} mi or more`
  }
  if (rule.minNeighborStops !== undefined) {
    if (scope.neighborStops === undefined) return 'site has no density on file'
    if (scope.neighborStops < rule.minNeighborStops) return `fewer than ${rule.minNeighborStops} stops nearby`
  }
  if (rule.exemptContracts && scope.contractPriced) return 'contract price is all in'
  return null
}

export function feeRuleApplies(rule: FeeRule, scope: FeeScope): boolean {
  return feeRuleMiss(rule, scope) === null
}

/** The first dimension a `when` condition fails on, or null when every condition holds (an empty list means any). */
export function whenMiss(when: Record<string, string[]> | undefined, dims: Record<string, string>): string | null {
  for (const [dimId, allowed] of Object.entries(when ?? {})) {
    if (allowed.length === 0) continue
    if (!allowed.includes(dims[dimId] ?? '')) return dimId
  }
  return null
}

/** Of the applied rules that share a stackGroup, keep only the largest by size; rules with no group all stay. */
export function keepStackWinners<T extends { rule: Pick<FeeRule, 'stackGroup'>; cents: number }>(applied: readonly T[]): T[] {
  const best = new Map<string, T>()
  for (const a of applied) {
    const group = a.rule.stackGroup
    if (!group) continue
    const current = best.get(group)
    if (!current || Math.abs(a.cents) > Math.abs(current.cents)) best.set(group, a)
  }
  return applied.filter(a => !a.rule.stackGroup || best.get(a.rule.stackGroup) === a)
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

/** "mon" to "sun" for an ISO date, by day arithmetic (1970-01-04 was a Sunday); no Date outside clock.ts. */
export function dayOfWeekOf(iso: string): string {
  const n = daysBetween('1970-01-04', dayOf(iso))
  return WEEKDAYS[((n % 7) + 7) % 7]
}

export interface LineDimsInput {
  accountId?: string
  siteId?: string
  catalogId?: string
  frequency?: Frequency
  zoneId?: string
  onDate: string
  lineType?: LineType
  /** A scale ticket material code, mapped to its RolloffMaterial. */
  material?: string
  /** The service line, for service line fields. */
  serviceItemId?: string
  /** Input dimension values (and overrides), merged last. A number field takes a number here, or a band id. */
  input?: Record<string, string>
}

type Field = Db['pricingDimensions'][number]

/** The sources a person fills in (custom fields); the rest are read from the line itself. */
const FIELD_SOURCES: ReadonlySet<string> = new Set(['account', 'site', 'serviceLine', 'input'])

/**
 * A field value as the id a rate or rule is keyed by (DECISIONS.md entry 68): a number field's band (min inclusive, max
 * exclusive), yes or no, a choice's id. A text field, or a number outside every band, keys nothing.
 */
export function fieldValueId(dim: Pick<Field, 'type' | 'values'>, raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined
  switch (dim.type) {
    case 'text':
      return undefined
    case 'yesNo':
      return raw === 'yes' || raw === 'no' ? raw : undefined
    case 'number': {
      if (dim.values.some(v => v.id === raw)) return raw
      const n = Number(raw)
      if (!Number.isFinite(n)) return undefined
      return dim.values.find(v => (v.min === undefined || n >= v.min) && (v.max === undefined || n < v.max))?.id
    }
    default:
      return raw
  }
}

/** What a line carries on a custom field before it is turned into a value id: the quote's input, else the assignment. */
function rawFieldValue(dim: Field, args: Pick<LineDimsInput, 'input' | 'serviceItemId'>, accountId: string | undefined, siteId: string | undefined): string | undefined {
  const typed = args.input?.[dim.id]
  if (typed !== undefined && typed !== '') return typed
  if (dim.source === 'account') return accountId ? dim.assignments?.[accountId] : undefined
  if (dim.source === 'site') return siteId ? dim.assignments?.[siteId] : undefined
  if (dim.source === 'serviceLine') return args.serviceItemId ? dim.assignments?.[args.serviceItemId] : undefined
  return undefined
}

/** The number a line carries on a number field (quote input, else assignment, else the field's default), or undefined. */
export function lineFieldNumber(dimId: string, args: Pick<LineDimsInput, 'accountId' | 'siteId' | 'serviceItemId' | 'input'>, db?: Db): number | undefined {
  const bound = db ?? getEngineDb()
  const dim = (bound.pricingDimensions ?? []).find(d => d.id === dimId)
  if (!dim || dim.type !== 'number') return undefined
  const site = args.siteId ? bound.sites.find(s => s.id === args.siteId) : undefined
  const raw = rawFieldValue(dim, args, args.accountId || site?.accountId, site?.id) ?? dim.defaultValueId
  const n = raw === undefined ? NaN : Number(raw)
  return Number.isFinite(n) ? n : undefined
}

/**
 * What a service's price is multiplied by on a line: the number on its quantityField (12 collections per month, 300
 * lbs), or 1 when the service has none or the line carries no number.
 */
export function quantityFactor(catalogId: string, args: Pick<LineDimsInput, 'accountId' | 'siteId' | 'serviceItemId' | 'input'>, db?: Db): number {
  const bound = db ?? getEngineDb()
  const field = bound.catalog.find(c => c.id === catalogId)?.quantityField
  if (!field) return 1
  return lineFieldNumber(field, args, bound) ?? 1
}

/** Ray casting: whether [lat, lng] is inside the polygon of [lat, lng] vertices. A point exactly on an edge may go either way. */
export function pointInPolygon(lat: number, lng: number, polygon: readonly (readonly [number, number])[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i]
    const [yj, xj] = polygon[j]
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * The zone drawn on the map a site is in (DECISIONS.md entry 69): the first GeoZone, in list order, whose polygon holds
 * the site's coordinates. A site with no coordinates, or outside every polygon, is in none.
 */
export function geoZoneFor(site: Pick<Site, 'lat' | 'lng'> | undefined, db?: Db): string | undefined {
  if (!site || site.lat === undefined || site.lng === undefined) return undefined
  const bound = db ?? getEngineDb()
  const { lat, lng } = site
  return (bound.geoZones ?? []).find(z => z.polygon.length >= 3 && pointInPolygon(lat, lng, z.polygon))?.id
}

/**
 * Every dimension value a line has (pricing model, DECISIONS.md entry 65): zone, frequency, service, category, lob,
 * cycle, and day of week from the line, its catalog item, account, and route (a recurring line's day is its route day,
 * an event's is its date); account and site dimensions from their assignments; input dimensions from `input`. A
 * dimension with nothing assigned takes its default value.
 */
export function lineDims(args: LineDimsInput, db?: Db): Record<string, string> {
  const bound = db ?? getEngineDb()
  const site = args.siteId ? bound.sites.find(s => s.id === args.siteId) : undefined
  const accountId = args.accountId || site?.accountId
  const account = accountId ? bound.accounts.find(a => a.id === accountId) : undefined
  const cat = args.catalogId ? bound.catalog.find(c => c.id === args.catalogId) : undefined
  const route = site?.routeId ? bound.routes.find(r => r.id === site.routeId) : undefined
  const out: Record<string, string> = {}
  const zoneId = args.zoneId || site?.zoneId
  if (zoneId) out.zone = zoneId
  const drawn = geoZoneFor(site, bound)
  if (drawn) out.geoZone = drawn
  if (args.frequency) out.frequency = args.frequency
  if (cat) {
    out.service = cat.id
    out.lob = cat.lob
    if (cat.categoryId) out.category = cat.categoryId
  } else if (route) {
    out.lob = route.lob
  }
  if (account) out.cycle = account.cycle
  out.dayOfWeek = args.lineType === 'recurring' && route ? route.day.toLowerCase() : dayOfWeekOf(args.onDate)
  if (args.material) {
    const material = materialFor(args.material, bound)
    if (material) out.material = material.id
  }
  // Custom fields: the quote's input, else the account, site, or service line assignment, else the default, turned
  // into the value id rates and rules are keyed by (a number field's band, yes or no).
  const fields = new Set<string>()
  for (const dim of bound.pricingDimensions ?? []) {
    if (!FIELD_SOURCES.has(dim.source)) continue
    fields.add(dim.id)
    const value = fieldValueId(dim, rawFieldValue(dim, args, accountId, site?.id) ?? dim.defaultValueId)
    if (value) out[dim.id] = value
  }
  for (const [k, v] of Object.entries(args.input ?? {})) if (v && !fields.has(k)) out[k] = v
  return out
}

/**
 * percent: round(base x value / 100); flat: value once per month of the line. Then the floor and cap (per month of the
 * line, like a flat fee) on its size; a credit keeps its sign.
 */
export function feeRuleCents(rule: FeeRule, baseCents: number, flatMultiplier = 1): number {
  // Rounded again after the multiplier: it is a whole number of months except on a bill shorter than a month (addendum Q).
  let cents = rule.kind === 'percent' ? round(baseCents * rule.value / 100) : round(round(rule.value) * flatMultiplier)
  if (cents !== 0 && (rule.minCents !== undefined || rule.maxCents !== undefined)) {
    let size = Math.abs(cents)
    if (rule.minCents !== undefined) size = Math.max(size, round(rule.minCents * flatMultiplier))
    if (rule.maxCents !== undefined) size = Math.min(size, round(rule.maxCents * flatMultiplier))
    cents = Math.sign(cents) * size
  }
  return cents
}

/** The line's LOB: its catalog item's, else the site's route's (an extra bags event names no catalog item). */
export function lineLob(catalogId: string | undefined, site: Pick<Site, 'routeId'>, db?: Db): LOB | undefined {
  const bound = db ?? getEngineDb()
  const cat = catalogId ? bound.catalog.find(c => c.id === catalogId) : undefined
  return cat?.lob ?? bound.routes.find(r => r.id === site.routeId)?.lob
}

/** A zone's tax layers in force for a line on a day. Late fees are never taxed; the caller skips them. */
export function taxRulesFor(zoneId: string, lineType: LineType, day: string, dims: Record<string, string> = {}, db?: Db): TaxRule[] {
  const bound = db ?? getEngineDb()
  return bound.taxRules.filter(t =>
    t.zoneId === zoneId
    && t.appliesTo.includes(lineType)
    && t.status !== 'paused'
    && ruleInEffect(t, day)
    && whenMiss(t.when, dims) === null,
  )
}

// ---------------------------------------------------------------------------
// Roll-off terms (pricing model, DECISIONS.md entry 64). The standard material is priced by the size's haul
// RateVersion and catalog.rolloff; every other material by the latest RolloffRate cell for its size.
// ---------------------------------------------------------------------------

export interface RolloffTerms {
  catalogId: string
  materialId?: string
  materialName?: string
  /** catalog: the standard material's catalog terms. matrix: a RolloffRate cell. */
  source: 'catalog' | 'matrix'
  rateId?: string
  /** False when the material is not accepted in this size; the numbers are then the standard ones, so a ticket still bills. */
  available: boolean
  haulDeltaCents: number
  includedTons: number
  overageCentsPerTon: number
  overageTiers?: OverageTier[]
  minBilledTons?: number
}

/** The hauler's roll-off policy row, if the db has one. */
export function rolloffPolicyOf(db?: Db): RolloffPolicy | undefined {
  return ((db ?? getEngineDb()).rolloffPolicy ?? [])[0]
}

/** The material a scale ticket code maps to (case insensitive), else the standard material. */
export function materialFor(ticketMaterial: string | undefined, db?: Db): RolloffMaterial | undefined {
  const materials = (db ?? getEngineDb()).rolloffMaterials ?? []
  const code = ticketMaterial?.trim().toLowerCase()
  const hit = code ? materials.find(m => m.ticketCodes.some(c => c.toLowerCase() === code)) : undefined
  return hit ?? materials.find(m => m.handling === 'standard')
}

/** The latest RolloffRate cell for a size and material in force on the day. */
export function rolloffRateFor(catalogId: string, materialId: string, day: string, db?: Db): RolloffRate | undefined {
  let best: RolloffRate | undefined
  for (const r of (db ?? getEngineDb()).rolloffRates ?? []) {
    if (r.catalogId !== catalogId || r.materialId !== materialId || dayOf(r.effectiveFrom) > dayOf(day)) continue
    if (!best || dayOf(r.effectiveFrom) > dayOf(best.effectiveFrom) || (dayOf(r.effectiveFrom) === dayOf(best.effectiveFrom) && (r.publishedAt ?? '') >= (best.publishedAt ?? ''))) best = r
  }
  return best
}

/** The terms that price a haul of this size and material on the day. Undefined when the item is not a roll-off. */
export function rolloffTermsFor(args: { catalogId: string; materialId?: string; ticketMaterial?: string; onDate: string }, db?: Db): RolloffTerms | undefined {
  const bound = db ?? getEngineDb()
  const cat = bound.catalog.find(c => c.id === args.catalogId)
  if (!cat?.rolloff) return undefined
  const materials = bound.rolloffMaterials ?? []
  const material = args.materialId ? materials.find(m => m.id === args.materialId) : materialFor(args.ticketMaterial, bound)
  const standard: RolloffTerms = {
    catalogId: cat.id,
    source: 'catalog',
    available: true,
    haulDeltaCents: 0,
    includedTons: cat.rolloff.includedTons,
    overageCentsPerTon: cat.rolloff.overageCentsPerTon,
    ...(cat.rolloff.overageTiers?.length ? { overageTiers: cat.rolloff.overageTiers } : {}),
    ...(cat.rolloff.minBilledTons ? { minBilledTons: cat.rolloff.minBilledTons } : {}),
    ...(material ? { materialId: material.id, materialName: material.name } : {}),
  }
  if (!material || material.handling === 'standard') {
    // A dated cell for the standard material replaces the catalog's weight terms from its effective date; the haul
    // price itself always comes from the size's RateVersion, so its delta stays 0.
    const own = material ? rolloffRateFor(cat.id, material.id, args.onDate, bound) : undefined
    if (!own?.available) return standard
    return {
      ...standard,
      rateId: own.id,
      includedTons: own.includedTons,
      overageCentsPerTon: own.overageCentsPerTon,
      ...(own.overageTiers?.length ? { overageTiers: own.overageTiers } : { overageTiers: undefined }),
      ...(own.minBilledTons ? { minBilledTons: own.minBilledTons } : { minBilledTons: undefined }),
    }
  }
  const cell = material.handling === 'prohibited' ? undefined : rolloffRateFor(cat.id, material.id, args.onDate, bound)
  if (!cell || !cell.available) return { ...standard, available: false, ...(cell ? { rateId: cell.id } : {}) }
  return {
    catalogId: cat.id,
    materialId: material.id,
    materialName: material.name,
    source: 'matrix',
    rateId: cell.id,
    available: true,
    haulDeltaCents: cell.haulDeltaCents,
    includedTons: cell.includedTons,
    overageCentsPerTon: cell.overageCentsPerTon,
    ...(cell.overageTiers?.length ? { overageTiers: cell.overageTiers } : {}),
    ...(cell.minBilledTons ? { minBilledTons: cell.minBilledTons } : {}),
  }
}

const TON_STEP: Record<RolloffPolicy['tonRounding'], number> = { exact: 0, tenth: 0.1, quarter: 0.25, half: 0.5, whole: 1 }

/** Tons rounded up to the policy's increment ("exact" leaves them alone). */
export function roundTons(tons: number, rounding: RolloffPolicy['tonRounding'] = 'exact'): number {
  const step = TON_STEP[rounding]
  if (!step) return tons
  return Number((Math.ceil(tons / step - 1e-9) * step).toFixed(4))
}

/** Overage cents for tons over the allowance: the base rate up to the first tier, then each tier's rate above it. */
export function overageCents(overTons: number, centsPerTon: number, tiers: readonly OverageTier[] = []): number {
  if (overTons <= 0) return 0
  let cents = 0
  let from = 0
  let rate = centsPerTon
  for (const tier of [...tiers].sort((a, b) => a.aboveTons - b.aboveTons)) {
    if (overTons <= tier.aboveTons) break
    cents += (tier.aboveTons - from) * rate
    from = tier.aboveTons
    rate = tier.centsPerTon
  }
  return Math.round(cents + (overTons - from) * rate)
}

/** A scale ticket against the terms: tons, the tons billed (at least the minimum), the tons over, and their cents. */
export function rolloffOverage(
  netLbs: number,
  terms: Pick<RolloffTerms, 'includedTons' | 'overageCentsPerTon' | 'overageTiers' | 'minBilledTons'>,
  rounding: RolloffPolicy['tonRounding'] = 'exact',
): { tons: number; billedTons: number; overTons: number; cents: number } {
  const tons = roundTons(netLbs / 2000, rounding)
  const billedTons = Math.max(tons, terms.minBilledTons ?? 0)
  const overTons = Math.max(0, billedTons - terms.includedTons)
  return { tons, billedTons, overTons, cents: overageCents(overTons, terms.overageCentsPerTon, terms.overageTiers) }
}

// ---------------------------------------------------------------------------
// Clock. Lives in src/store/clock.ts (addendum E1); re-exported so existing imports keep working.
// ---------------------------------------------------------------------------

export { setToday, today } from './clock'

// ---------------------------------------------------------------------------
// generateRecurringCharges
// ---------------------------------------------------------------------------

const FREQUENCY_LABEL: Record<Frequency, string> = {
  weekly: 'weekly',
  eow: 'every other week',
  '2x': '2x weekly',
  '3x': '3x weekly',
  '4x': '4x weekly',
  '5x': '5x weekly',
  '6x': '6x weekly',
  onCall: 'on call',
}

export function frequencyLabel(f: Frequency): string {
  return FREQUENCY_LABEL[f]
}

/** "96 gal cart, weekly, Oct 1 to Dec 31" (qty shown when more than one). */
export function recurringDescription(catalogName: string, qty: number, frequency: Frequency, period: Period): string {
  const name = qty > 1 ? `${qty} x ${catalogName}` : catalogName
  return `${name}, ${frequencyLabel(frequency)}, ${periodLabel(period)}`
}

/**
 * The posted or approved recurring Charge that already covers this service item for any part of this period, if any
 * (addendum C13, Phase 3.2 and 3.2b). Periods end on their last day inclusive, so a charge covers the cycle when its
 * period overlaps it: a storefront signup's Sep 15 to Dec 14 first quarter covers the Oct 1 to Dec 31 cycle, and the
 * Oct 1 run does not bill it again. Hauler proration is none, so the uncovered tail (Dec 15 to Dec 31) is not billed.
 * An exact match on the period start (billing's original rule, DECISIONS.md entry 6) is the special case.
 */
export function coveringCharge(serviceItemId: string, period: Period, db?: Db): Charge | undefined {
  if (db) return withEngineDb(db, () => coveringCharge(serviceItemId, period))
  return getEngineDb().charges.find(c =>
    c.source.type === 'serviceItem'
    && c.source.id === serviceItemId
    && c.lineType === 'recurring'
    && (c.status === 'posted' || c.status === 'approved')
    && c.period !== undefined
    && dayOf(c.period.start) <= period.end
    && dayOf(c.period.end) >= period.start,
  )
}

/**
 * Advance billing for one cycle date. For every account that isDue on cycleDate and is not suspended,
 * one proposed recurring Charge per active ServiceItem whose effectiveFrom is on or before the period
 * start and whose effectiveTo is absent or after the period start. Priced by resolvePrice on the period
 * start with the site zone, the item frequency and the account. Rates are monthly, so baseCents is
 * price x qty x months in the period (a quarterly 96 gal cart bills 3 x 2900 = 8700, matching the seed).
 * onCall items (rolloff boxes) are billed per haul, never as a recurring line (DECISIONS.md entry 24).
 * Pairs (serviceItemId, period start) that already have a posted or approved Charge are skipped, so a
 * re-run is idempotent. Returns new rows; nothing is written to the db.
 */
export function generateRecurringCharges(args: { cycleDate: string }, db?: Db): Charge[] {
  if (db) return withEngineDb(db, () => generateRecurringCharges(args))
  const { cycleDate } = args
  const bound = getEngineDb()
  return generateRecurringFrom(bound, cycleDate)
}

function generateRecurringFrom(db: Db, cycleDate: string): Charge[] {
  const out: Charge[] = []
  const sitesByAccount = new Map<string, Site[]>()
  for (const s of db.sites) {
    const list = sitesByAccount.get(s.accountId) ?? []
    list.push(s)
    sitesByAccount.set(s.accountId, list)
  }

  for (const account of db.accounts) {
    if (account.status === 'suspended') continue
    const cadence = cadenceOf(account, db.billingGroups)
    if (!isDue(cadence, cycleDate)) continue
    const period = periodFor(cadence, cycleDate)
    // Rates are monthly: a quarter bills 3 months, a weekly group's bill 12/52 of a month (addendum Q).
    const months = billingFactor(cadence)

    for (const site of sitesByAccount.get(account.id) ?? []) {
      const items = db.serviceItems.filter(si =>
        si.siteId === site.id
        && si.status === 'active'
        && si.frequency !== 'onCall'
        && dayOf(si.effectiveFrom) <= period.start
        && (si.effectiveTo === undefined || dayOf(si.effectiveTo) > period.start),
      )
      for (const item of items) {
        if (coveringCharge(item.id, period, db)) continue
        const cat = findCatalog(item.catalogId)
        if (!cat) throw new Error(`Unknown catalog ${item.catalogId} on ${item.id}`)
        const price = resolvePrice({
          catalogId: item.catalogId,
          frequency: item.frequency,
          zoneId: site.zoneId,
          accountId: account.id,
          onDate: period.start,
          siteId: site.id,
          serviceItemId: item.id,
        })
        const pricing: Charge['pricing'] = { ruleWon: price.ruleWon }
        if (price.rateVersionId) pricing.rateVersionId = price.rateVersionId
        if (price.contractId) pricing.contractId = price.contractId
        // A service priced per unit of a number field (DECISIONS.md entry 68) bills price x that number; others x 1.
        const factor = quantityFactor(item.catalogId, { accountId: account.id, siteId: site.id, serviceItemId: item.id })
        const unit = factor !== 1 ? (db.pricingDimensions ?? []).find(d => d.id === cat.quantityField)?.unit : undefined
        const description = recurringDescription(cat.name, item.qty, item.frequency, period)
        out.push(computeCharge({
          accountId: account.id,
          siteId: site.id,
          lineType: 'recurring',
          catalogId: item.catalogId,
          frequency: item.frequency,
          baseCents: round(price.priceCents * item.qty * factor * months),
          period,
          source: { type: 'serviceItem', id: item.id },
          description: factor !== 1 ? `${description}, ${factor}${unit ? ` ${unit}` : ''}` : description,
          pricing,
          evidenceIds: [item.id],
        }))
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// generateEventCharges
// ---------------------------------------------------------------------------

const EXCEPTION_LABEL: Record<BillableException, string> = {
  extraBags: 'Extra bags',
  overload: 'Overloaded cart',
  contamination: 'Contamination',
  dryRun: 'Dry run',
}

export function exceptionLabel(x: BillableException): string {
  return EXCEPTION_LABEL[x]
}

/** Tons over the included cap for a ticket, or 0 when under. */
export function overageTons(netLbs: number, includedTons: number): number {
  return Math.max(0, netLbs / 2000 - includedTons)
}

function hasChargeFor(db: Db, type: Charge['source']['type'], id: string): boolean {
  return db.charges.some(c => c.source.type === type && c.source.id === id)
}

/**
 * One proposed event Charge per ServiceEvent with a billable exception (extraBags, overload, contamination,
 * dryRun) at the flat eventRates.json rate, plus one overage Charge per ScaleTicket whose net tons exceed
 * the container catalog includedTons. notOut produces nothing. Suspended accounts produce nothing.
 * Events and tickets that already have a Charge with a matching source are skipped (any status, so a
 * waived charge is not re-proposed). Returns new rows; nothing is written to the db.
 */
export function generateEventCharges(db?: Db): Charge[] {
  if (db) return withEngineDb(db, () => generateEventCharges())
  return generateEventChargesBound()
}

function generateEventChargesBound(): Charge[] {
  const db = getEngineDb()
  const out: Charge[] = []

  // Exception events, oldest first so ids read in date order.
  const events = [...db.serviceEvents]
    .filter(e => isBillableException(e.exception))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  for (const event of events) {
    const exception = event.exception as BillableException
    if (hasChargeFor(db, 'serviceEvent', event.id)) continue
    const site = findSite(event.siteId)
    const account = findAccount(site.accountId)
    if (account.status === 'suspended') continue
    out.push(computeCharge({
      accountId: account.id,
      siteId: site.id,
      lineType: 'event',
      baseCents: eventRates[exception],
      servicedOn: dayOf(event.date),
      source: { type: 'serviceEvent', id: event.id },
      description: `${exceptionLabel(exception)}, ${shortDate(event.date)}`,
      pricing: { ruleWon: 'standardRate' },
      evidenceIds: [event.id],
    }))
  }

  // Scale ticket overages.
  const tickets = [...db.scaleTickets].sort((a, b) => a.ticketedAt.localeCompare(b.ticketedAt) || a.id.localeCompare(b.id))
  for (const ticket of tickets) {
    if (hasChargeFor(db, 'scaleTicket', ticket.id)) continue
    const workOrder = db.workOrders.find(w => w.id === ticket.workOrderId)
    if (!workOrder) throw new Error(`Scale ticket ${ticket.id} has no work order ${ticket.workOrderId}`)
    const container = db.containers.find(c => c.id === ticket.containerId)
    if (!container) throw new Error(`Scale ticket ${ticket.id} names unknown container ${ticket.containerId}`)
    const cat = findCatalog(container.catalogId)
    if (!cat?.rolloff) continue
    // The ticket's material picks the matrix cell; the standard material (and any material not accepted in this
    // size) bills on the catalog terms, which is what every seeded ticket does.
    const terms = rolloffTermsFor({ catalogId: cat.id, ticketMaterial: ticket.material, onDate: dayOf(ticket.ticketedAt) }, db)!
    const { overTons: over, cents: overCents } = rolloffOverage(ticket.netLbs, terms, rolloffPolicyOf(db)?.tonRounding)
    if (over <= 0) continue
    const site = findSite(workOrder.siteId)
    const account = findAccount(site.accountId)
    if (account.status === 'suspended') continue
    out.push(computeCharge({
      accountId: account.id,
      siteId: site.id,
      lineType: 'event',
      catalogId: cat.id,
      baseCents: overCents,
      servicedOn: dayOf(ticket.ticketedAt),
      source: { type: 'scaleTicket', id: ticket.id },
      description: terms.source === 'matrix'
        ? `Overage ${over.toFixed(2)} t over ${terms.includedTons} t cap, ${terms.materialName}`
        : `Overage ${over.toFixed(2)} t over ${terms.includedTons} t cap`,
      // The overage rate lives on the catalog, not on a RateVersion, so it is a standard rate with no version id.
      pricing: { ruleWon: 'standardRate' },
      evidenceIds: [ticket.id, workOrder.id],
    }))
  }

  // Roll-off extra days (Phase 3.7b, account port request 3).
  out.push(...extraDayCharges(db))

  return out
}

/**
 * One proposed event Charge per roll-off box kept past its catalog's includedDays, at extraDayCents a day, priced
 * standardRate (addendum C11), sourced from the box's ServiceItem, with the delivery work order (when there is one)
 * and the box as evidence. Days out are counted as account's roll-off card counts them: from the latest completed
 * deliver work order for the box (else the container's assignedFrom, else the item's effectiveFrom) to today, so a
 * dump and return does not restart the clock; a completed remove work order stops it. The included window is the
 * delivery day plus includedDays, so a box delivered Aug 7 with 30 included is out 34 days on Sep 10 and owes Sep 7
 * to Sep 10, four days.
 *
 * Extra days accrue: each charge carries the days it bills as an inclusive period, and the next run bills from the
 * day after the latest such period on the box (any status, so a waived stretch is not re-proposed). Re-running on
 * the same day proposes nothing new once the first charge is committed.
 */
function extraDayCharges(db: Db): Charge[] {
  const out: Charge[] = []
  const now = today()
  const items = [...db.serviceItems].sort((a, b) => a.id.localeCompare(b.id))
  for (const item of items) {
    const cat = findCatalog(item.catalogId)
    const rolloff = cat?.rolloff
    if (!cat || !rolloff || rolloff.extraDayCents <= 0) continue
    const site = db.sites.find(s => s.id === item.siteId)
    if (!site) continue
    const account = db.accounts.find(a => a.id === site.accountId)
    if (!account || account.status === 'suspended') continue
    for (const containerId of item.containerIds) {
      const container = db.containers.find(c => c.id === containerId)
      const deliver = db.workOrders
        .filter(w => w.kind === 'deliver' && w.status === 'done' && w.containerId === containerId)
        .sort((a, b) => dayOf(b.completedAt ?? b.scheduledFor).localeCompare(dayOf(a.completedAt ?? a.scheduledFor)))[0]
      const deliveredRaw = deliver ? (deliver.completedAt ?? deliver.scheduledFor) : (container?.assignedFrom ?? item.effectiveFrom)
      if (!deliveredRaw) continue
      const deliveredOn = dayOf(deliveredRaw)
      const removal = db.workOrders
        .filter(w => w.kind === 'remove' && w.status === 'done' && w.containerId === containerId && dayOf(w.completedAt ?? w.scheduledFor) >= deliveredOn)
        .map(w => dayOf(w.completedAt ?? w.scheduledFor))
        .sort()[0]
      const through = removal !== undefined && removal < dayOf(now) ? removal : dayOf(now)
      const firstExtra = addDays(deliveredOn, rolloff.includedDays + (rolloff.graceDays ?? 0) + 1)
      const billedThrough = db.charges
        .filter(c => c.source.type === 'serviceItem' && c.source.id === item.id && c.lineType === 'event' && c.period && c.evidenceIds.includes(containerId))
        .map(c => dayOf(c.period!.end))
        .sort()
        .at(-1)
      const start = billedThrough !== undefined && addDays(billedThrough, 1) > firstExtra ? addDays(billedThrough, 1) : firstExtra
      if (start > through) continue
      const days = daysBetween(start, through) + 1
      const period = { start, end: through }
      const serial = container?.serial ?? containerId
      out.push(computeCharge({
        accountId: account.id,
        siteId: site.id,
        lineType: 'event',
        catalogId: cat.id,
        baseCents: days * rolloff.extraDayCents,
        period,
        source: { type: 'serviceItem', id: item.id },
        description: `Extra days, ${serial}: ${days} day${days === 1 ? '' : 's'} past ${rolloff.includedDays} included, ${periodLabel(period)}`,
        // The extra-day rate lives on the catalog, not on a RateVersion: a catalog-formula line (addendum C11).
        pricing: { ruleWon: 'standardRate' },
        evidenceIds: deliver ? [deliver.id, containerId] : [containerId],
      }))
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// postInvoices
// ---------------------------------------------------------------------------

export const INVOICE_NUMBER_PREFIX = 'INV-2026-'

/** The next invoice number after the highest one in the db (seed runs 0201 to 0222, so posting starts at 0223). */
export function nextInvoiceNumber(db: Db, offset = 0): string {
  let max = 0
  for (const inv of db.invoices) {
    const m = /^INV-\d{4}-(\d+)$/.exec(inv.number)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${INVOICE_NUMBER_PREFIX}${String(max + 1 + offset).padStart(4, '0')}`
}

/**
 * Posting. Groups the given approved charges by account and returns one locked Invoice per account with
 * an `inv_bl_####` id (addendum C12) and a sequential INV-2026-#### number continuing from the highest in the db, issuedAt today, dueAt +30 days for net30 and
 * +15 days otherwise, deliveredVia the account delivery method. Throws when any charge is missing, is not
 * approved, or already sits on a locked invoice. Nothing is written to the db: the caller commits with
 * applyPosting(db, invoices), which appends the invoices and marks their charges posted (DECISIONS.md entry 23b).
 */
export function postInvoices(args: { chargeIds: string[] }, db?: Db): Invoice[] {
  if (db) return withEngineDb(db, () => postInvoices(args))
  return postInvoicesBound(args.chargeIds)
}

function postInvoicesBound(chargeIds: string[]): Invoice[] {
  const db = getEngineDb()
  if (chargeIds.length === 0) return []
  const seen = new Set<string>()
  const charges: Charge[] = []
  for (const id of chargeIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const c = db.charges.find(x => x.id === id)
    if (!c) throw new Error(`Cannot post: unknown charge ${id}`)
    if (c.status !== 'approved') throw new Error(`Cannot post ${id}: status is ${c.status}, only approved charges post`)
    const onLocked = db.invoices.find(inv => inv.locked && inv.chargeIds.includes(id))
    if (onLocked) throw new Error(`Cannot post ${id}: already on locked invoice ${onLocked.number}`)
    charges.push(c)
  }

  const byAccount = new Map<string, Charge[]>()
  for (const c of charges) {
    const list = byAccount.get(c.accountId) ?? []
    list.push(c)
    byAccount.set(c.accountId, list)
  }

  const issuedAt = today()
  const invoices: Invoice[] = []
  const idBase = maxIdSuffix(db.invoices.map(i => i.id), INVOICE_ID_PREFIX)
  let offset = 0
  for (const [accountId, lines] of byAccount) {
    const account = findAccount(accountId)
    const id = formatId(INVOICE_ID_PREFIX, idBase + 1 + offset)
    const number = nextInvoiceNumber(db, offset++)
    const subtotalCents = lines.reduce((s, c) => s + c.baseCents, 0)
    const feeCents = lines.reduce((s, c) => s + feeTotal(c), 0)
    const taxCents = lines.reduce((s, c) => s + c.taxCents, 0)
    invoices.push({
      id,
      accountId,
      number,
      chargeIds: lines.map(c => c.id),
      subtotalCents,
      feeCents,
      taxCents,
      totalCents: subtotalCents + feeCents + taxCents,
      issuedAt,
      dueAt: addDays(issuedAt, invoiceTermsDays(account, db)),
      postedAt: stamp(),
      locked: true,
      deliveredVia: account.deliveryMethod,
    })
  }
  return invoices
}

/** Days from the invoice date to its due date: the account's billing group's terms, else 30 on net30 and 15 otherwise. */
export function invoiceTermsDays(account: Pick<BillingAccount, 'cycle' | 'billingGroupId'>, db?: Db): number {
  const groups = (db ?? getEngineDb()).billingGroups ?? []
  const group = account.billingGroupId ? groups.find(g => g.id === account.billingGroupId) : undefined
  return group?.termsDays ?? (account.cycle === 'net30' ? 30 : 15)
}

/**
 * Commit a postInvoices result: returns a new Db with the invoices appended and every charge they name
 * marked posted. The input db is not mutated (arrays are replaced, untouched rows are shared).
 */
export function applyPosting(db: Db, invoices: Invoice[]): Db {
  const posted = new Set(invoices.flatMap(inv => inv.chargeIds))
  return {
    ...db,
    charges: db.charges.map(c => (posted.has(c.id) ? { ...c, status: 'posted' } : c)),
    invoices: [...db.invoices, ...invoices],
  }
}

/** Commit generated charges: returns a new Db with the rows appended. Ids already present are replaced, not duplicated. */
export function appendCharges(db: Db, charges: Charge[]): Db {
  const incoming = new Map(charges.map(c => [c.id, c]))
  return {
    ...db,
    charges: [...db.charges.filter(c => !incoming.has(c.id)), ...charges],
  }
}

// ---------------------------------------------------------------------------
// allocate
// ---------------------------------------------------------------------------

/** Cents allocated to an invoice so far, from payments and credit memos. */
export function allocatedTo(invoiceId: string, db?: Db): number {
  if (db) return withEngineDb(db, () => allocatedTo(invoiceId))
  return getEngineDb().allocations.filter(a => a.invoiceId === invoiceId).reduce((s, a) => s + a.cents, 0)
}

/** Open balance on an invoice: total minus every allocation against it. */
export function invoiceBalance(invoiceId: string, db?: Db): number {
  if (db) return withEngineDb(db, () => invoiceBalance(invoiceId))
  const inv = getEngineDb().invoices.find(i => i.id === invoiceId)
  if (!inv) throw new Error(`Unknown invoice ${invoiceId}`)
  return inv.totalCents - allocatedTo(invoiceId)
}

/** Unapplied cents on a payment or credit memo: its cents minus the sum of its allocations (DECISIONS.md entry 10). */
export function unappliedFor(sourceId: string, db?: Db): number {
  if (db) return withEngineDb(db, () => unappliedFor(sourceId))
  return unappliedForBound(sourceId)
}

function unappliedForBound(sourceId: string): number {
  const db = getEngineDb()
  const source = db.payments.find(p => p.id === sourceId) ?? db.creditMemos.find(m => m.id === sourceId)
  if (!source) throw new Error(`Unknown payment or credit memo ${sourceId}`)
  const applied = db.allocations.filter(a => a.sourceId === sourceId).reduce((s, a) => s + a.cents, 0)
  return source.cents - applied
}

export interface AllocateInput {
  sourceType: PaymentAllocation['sourceType']
  sourceId: string
  invoiceIds: string[]
  cents: number[]
}

/**
 * Many-to-many allocation of one source (payment or credit memo) across invoices. Returns one
 * PaymentAllocation per invoice id given. Throws when cents and invoiceIds differ in length, when any
 * amount is not a positive integer, when the sum exceeds the source's unapplied amount, or when any
 * invoice would be allocated more than its open balance. Nothing is written to the db.
 */
export function allocate(input: AllocateInput, db?: Db): PaymentAllocation[] {
  if (db) return withEngineDb(db, () => allocate(input))
  return allocateBound(input)
}

function allocateBound({ sourceType, sourceId, invoiceIds, cents }: AllocateInput): PaymentAllocation[] {
  const db = getEngineDb()
  if (invoiceIds.length !== cents.length) {
    throw new Error(`allocate needs one amount per invoice: ${invoiceIds.length} invoices, ${cents.length} amounts`)
  }
  if (invoiceIds.length === 0) return []
  const source = sourceType === 'payment'
    ? db.payments.find(p => p.id === sourceId)
    : db.creditMemos.find(m => m.id === sourceId)
  if (!source) throw new Error(`Unknown ${sourceType} ${sourceId}`)

  for (const amount of cents) {
    if (!Number.isInteger(amount) || amount <= 0) throw new Error(`Allocation amounts must be positive integer cents, got ${amount}`)
  }
  const total = cents.reduce((s, c) => s + c, 0)
  const unapplied = unappliedFor(sourceId)
  if (total > unapplied) {
    throw new Error(`Cannot allocate ${total} cents from ${sourceId}: only ${unapplied} cents unapplied`)
  }

  // Sum per invoice so the same invoice listed twice is checked as one amount.
  const perInvoice = new Map<string, number>()
  invoiceIds.forEach((invoiceId, i) => perInvoice.set(invoiceId, (perInvoice.get(invoiceId) ?? 0) + cents[i]))
  for (const [invoiceId, amount] of perInvoice) {
    const balance = invoiceBalance(invoiceId)
    if (amount > balance) {
      const inv = db.invoices.find(i => i.id === invoiceId)
      throw new Error(`Cannot allocate ${amount} cents to ${inv?.number ?? invoiceId}: open balance is ${balance} cents`)
    }
  }

  return invoiceIds.map((invoiceId, i) => ({ sourceType, sourceId, invoiceId, cents: cents[i] }))
}

// ---------------------------------------------------------------------------
// Intake (Phase 3.2, addendum C13 and L; the rule is written out in the root DECISIONS.md)
// ---------------------------------------------------------------------------

/**
 * Intake: every Charge with status proposed or approved that is on no Invoice and whose id is not in `claimedIds`
 * (the caller passes every billing run's chargeIds). Other surfaces write these: storefront's approved first-cycle
 * charges (chg_sf_*), portal's approved extra pickups (chg_p*), account's proposed reinstatement fees. The next
 * billing run adds them to itself. Charges on a suspended account stay intake until it is active (invariant 4).
 * Returned in db order. Nothing is written.
 */
export function intakeCharges(args: { claimedIds: Iterable<string> }, db?: Db): Charge[] {
  if (db) return withEngineDb(db, () => intakeCharges(args))
  const bound = getEngineDb()
  const claimed = new Set(args.claimedIds)
  const invoiced = new Set(bound.invoices.flatMap(i => i.chargeIds))
  const suspended = new Set(bound.accounts.filter(a => a.status === 'suspended').map(a => a.id))
  return bound.charges.filter(c =>
    (c.status === 'proposed' || c.status === 'approved')
    && !invoiced.has(c.id)
    && !claimed.has(c.id)
    && !suspended.has(c.accountId))
}

/**
 * Allocations for prepaid intake, run after posting (the db must already hold the invoices). For each invoice that
 * carries intake charges, the account's settled Payments that are on no allocation yet are applied newest first,
 * through allocate(), up to the smaller of the invoice's open balance and the total of its intake charges. The cap is
 * what makes this safe: a prepayment pays for the charges it prepaid, and an unrelated unapplied payment on the same
 * account (pay_chk_unknown on acct_res_017) stays in the Payments tab for a person. A payment used here is on an
 * allocation from then on, so it is never applied twice. Nothing is written; the caller appends the rows.
 */
export function intakeAllocations(args: { invoices: Invoice[]; intakeChargeIds: Iterable<string> }, db?: Db): PaymentAllocation[] {
  if (db) return withEngineDb(db, () => intakeAllocations(args))
  const intake = new Set(args.intakeChargeIds)
  let working = getEngineDb()
  const out: PaymentAllocation[] = []
  for (const invoice of args.invoices) {
    const byId = new Map(working.charges.map(c => [c.id, c]))
    let budget = invoice.chargeIds.filter(id => intake.has(id)).reduce((s, id) => s + (byId.get(id)?.totalCents ?? 0), 0)
    if (budget <= 0) continue
    const allocated = new Set(working.allocations.map(a => a.sourceId))
    const payments = working.payments
      .filter(p => p.accountId === invoice.accountId && p.status === 'settled' && p.cents > 0 && !allocated.has(p.id))
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id))
    for (const payment of payments) {
      const open = withEngineDb(working, () => invoiceBalance(invoice.id))
      const cents = Math.min(payment.cents, budget, open)
      if (cents <= 0) break
      const rows = withEngineDb(working, () => allocate({ sourceType: 'payment', sourceId: payment.id, invoiceIds: [invoice.id], cents: [cents] }))
      working = { ...working, allocations: [...working.allocations, ...rows] }
      out.push(...rows)
      budget -= cents
    }
  }
  return out
}
