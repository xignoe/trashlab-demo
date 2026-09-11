/**
 * Pricing kernel. Pure functions that read the injected db through getEngineDb().
 * No zustand here: tests inject a seed clone, the store binds its live state.
 *
 * Rounding: Math.round on cents at each step. Each fee is rounded on its own,
 * then tax is rounded once on (base + taxable fees).
 */
import { stamp, today } from './clock'
import type { BillingAccount, Charge, Frequency, Invoice, LineType, PaymentAllocation, RateVersion, ServiceCatalog, Site } from '../types'
import { EVENT_RATES } from '../seed'
import { getEngineDb, type Db } from './db'
import { addDays, isDue, periodFor, periodLabel, periodMonths, shortDate, wholeMonths, type Period } from './cycles'

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
// `_bl_` infix: `chg_bl_0001`, `inv_bl_0001`, `rv_bl_0001`. Counters start above the highest numeric
// suffix already in the db for that prefix, so ids never collide with seed rows or earlier runs.
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
export const RATE_VERSION_ID_PREFIX = 'rv_bl_'

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
export function nextChargeId(): string {
  const existing = new Set(getEngineDb().charges.map(c => c.id))
  let id = idGenerator()
  let guard = 0
  while (existing.has(id) && guard++ < 10_000) id = idGenerator()
  return id
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function findAccount(accountId: string): BillingAccount {
  const a = getEngineDb().accounts.find(x => x.id === accountId)
  if (!a) throw new Error(`Unknown account ${accountId}`)
  return a
}

export function findSite(siteId: string): Site {
  const s = getEngineDb().sites.find(x => x.id === siteId)
  if (!s) throw new Error(`Unknown site ${siteId}`)
  return s
}

export function findCatalog(catalogId: string): ServiceCatalog | undefined {
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
}

export interface ResolvedPrice {
  priceCents: number
  rateVersionId?: string
  contractId?: string
  ruleWon: Charge['pricing']['ruleWon']
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
export function resolvePrice(input: ResolvePriceInput): ResolvedPrice {
  return resolvePriceLoose(input)
}

/** Same as resolvePrice but frequency may be omitted, in which case any rate frequency qualifies. */
function resolvePriceLoose(input: Omit<ResolvePriceInput, 'frequency'> & { frequency?: Frequency }): ResolvedPrice {
  const db = getEngineDb()
  const { catalogId, frequency, zoneId, accountId, onDate } = input
  const day = dayOf(onDate)

  // 1. Contract override. Contracts are matched by accountId (and the account's contractId, if any), inside their term.
  const account = db.accounts.find(a => a.id === accountId)
  const contracts = db.contracts.filter(c =>
    (c.accountId === accountId || (account?.contractId !== undefined && c.id === account.contractId))
    && dayOf(c.termStart) <= day && day <= dayOf(c.termEnd),
  )
  for (const contract of contracts) {
    const override = contract.overrides.find(o => o.catalogId === catalogId && frequencyMatches(o.frequency, frequency))
    if (override) {
      return { priceCents: override.priceCents, contractId: contract.id, ruleWon: 'contractOverride' }
    }
  }

  const forCatalog = db.rateVersions.filter(rv => rv.catalogId === catalogId && frequencyMatches(rv.frequency, frequency))

  // 2. Zone rate.
  const zoneRate = latestEffective(forCatalog.filter(rv => rv.zoneId === zoneId), day)
  if (zoneRate) return { priceCents: zoneRate.priceCents, rateVersionId: zoneRate.id, ruleWon: 'zoneRate' }

  // 3. Standard rate (no zone).
  const standardRate = latestEffective(forCatalog.filter(rv => rv.zoneId === undefined || rv.zoneId === null), day)
  if (standardRate) return { priceCents: standardRate.priceCents, rateVersionId: standardRate.id, ruleWon: 'standardRate' }

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
export function computeCharge(input: ComputeChargeInput): Charge {
  const db = getEngineDb()
  const account = findAccount(input.accountId)
  const site = findSite(input.siteId)
  if (!Number.isInteger(input.baseCents)) throw new Error(`baseCents must be integer cents, got ${input.baseCents}`)
  if (!input.servicedOn && !input.period) throw new Error('computeCharge needs servicedOn or period')

  const baseCents = input.baseCents
  const onDate = input.servicedOn ?? input.period!.start

  // Fees, each rounded individually. A flat fee applies once per whole month in the period (addendum C5):
  // a quarterly line takes it three times; a line with servicedOn instead of a period takes it once.
  const flatMultiplier = input.period ? wholeMonths(input.period) : 1
  const fees: Charge['fees'] = []
  let taxableFeeCents = 0
  for (const rule of db.feeRules) {
    if (!rule.appliesTo.includes(input.lineType)) continue
    const cents = rule.kind === 'percent' ? round(baseCents * rule.value / 100) : round(rule.value) * flatMultiplier
    fees.push({ feeRuleId: rule.id, cents })
    if (rule.taxable) taxableFeeCents += cents
  }
  const feeCents = fees.reduce((sum, f) => sum + f.cents, 0)

  // Tax, rounded once on base plus taxable fees.
  let taxCents = 0
  if (input.lineType !== 'lateFee' && !account.taxExempt) {
    const rules = db.taxRules.filter(t => t.zoneId === site.zoneId && t.appliesTo.includes(input.lineType))
    for (const t of rules) taxCents += round((baseCents + taxableFeeCents) * t.ratePct / 100)
  }

  // Pricing: caller wins, else resolve when a catalog is named, else a sensible default.
  let pricing: Charge['pricing']
  if (input.pricing) {
    pricing = input.pricing
  } else if (input.catalogId) {
    const r = resolvePriceLoose({
      catalogId: input.catalogId,
      frequency: input.frequency ?? inferFrequency(input.siteId, input.catalogId),
      zoneId: site.zoneId,
      accountId: input.accountId,
      onDate,
    })
    pricing = { ruleWon: r.ruleWon }
    if (r.rateVersionId) pricing.rateVersionId = r.rateVersionId
    if (r.contractId) pricing.contractId = r.contractId
  } else {
    pricing = { ruleWon: input.source.type === 'manual' ? 'manualException' : 'standardRate' }
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

/** True when a posted or approved recurring Charge already covers this service item for this period start (DECISIONS.md entry 6). */
function alreadyBilled(db: Db, serviceItemId: string, periodStart: string): boolean {
  return db.charges.some(c =>
    c.source.type === 'serviceItem'
    && c.source.id === serviceItemId
    && c.lineType === 'recurring'
    && (c.status === 'posted' || c.status === 'approved')
    && c.period !== undefined
    && dayOf(c.period.start) === periodStart,
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
export function generateRecurringCharges({ cycleDate }: { cycleDate: string }): Charge[] {
  const db = getEngineDb()
  const out: Charge[] = []
  const sitesByAccount = new Map<string, Site[]>()
  for (const s of db.sites) {
    const list = sitesByAccount.get(s.accountId) ?? []
    list.push(s)
    sitesByAccount.set(s.accountId, list)
  }

  for (const account of db.accounts) {
    if (account.status === 'suspended') continue
    if (!isDue(account, cycleDate)) continue
    const period = periodFor(account, cycleDate)
    const months = periodMonths(account.cycle)

    for (const site of sitesByAccount.get(account.id) ?? []) {
      const items = db.serviceItems.filter(si =>
        si.siteId === site.id
        && si.status === 'active'
        && si.frequency !== 'onCall'
        && dayOf(si.effectiveFrom) <= period.start
        && (si.effectiveTo === undefined || dayOf(si.effectiveTo) > period.start),
      )
      for (const item of items) {
        if (alreadyBilled(db, item.id, period.start)) continue
        const cat = findCatalog(item.catalogId)
        if (!cat) throw new Error(`Unknown catalog ${item.catalogId} on ${item.id}`)
        const price = resolvePrice({
          catalogId: item.catalogId,
          frequency: item.frequency,
          zoneId: site.zoneId,
          accountId: account.id,
          onDate: period.start,
        })
        const pricing: Charge['pricing'] = { ruleWon: price.ruleWon }
        if (price.rateVersionId) pricing.rateVersionId = price.rateVersionId
        if (price.contractId) pricing.contractId = price.contractId
        out.push(computeCharge({
          accountId: account.id,
          siteId: site.id,
          lineType: 'recurring',
          catalogId: item.catalogId,
          frequency: item.frequency,
          baseCents: price.priceCents * item.qty * months,
          period,
          source: { type: 'serviceItem', id: item.id },
          description: recurringDescription(cat.name, item.qty, item.frequency, period),
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
export function generateEventCharges(): Charge[] {
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
    const over = overageTons(ticket.netLbs, cat.rolloff.includedTons)
    if (over <= 0) continue
    const site = findSite(workOrder.siteId)
    const account = findAccount(site.accountId)
    if (account.status === 'suspended') continue
    out.push(computeCharge({
      accountId: account.id,
      siteId: site.id,
      lineType: 'event',
      catalogId: cat.id,
      baseCents: Math.round(over * cat.rolloff.overageCentsPerTon),
      servicedOn: dayOf(ticket.ticketedAt),
      source: { type: 'scaleTicket', id: ticket.id },
      description: `Overage ${over.toFixed(2)} t over ${cat.rolloff.includedTons} t cap`,
      // The overage rate lives on the catalog, not on a RateVersion, so it is a standard rate with no version id.
      pricing: { ruleWon: 'standardRate' },
      evidenceIds: [ticket.id, workOrder.id],
    }))
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
export function postInvoices({ chargeIds }: { chargeIds: string[] }): Invoice[] {
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
      dueAt: addDays(issuedAt, account.cycle === 'net30' ? 30 : 15),
      postedAt: stamp(),
      locked: true,
      deliveredVia: account.deliveryMethod,
    })
  }
  return invoices
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
export function allocatedTo(invoiceId: string): number {
  return getEngineDb().allocations.filter(a => a.invoiceId === invoiceId).reduce((s, a) => s + a.cents, 0)
}

/** Open balance on an invoice: total minus every allocation against it. */
export function invoiceBalance(invoiceId: string): number {
  const inv = getEngineDb().invoices.find(i => i.id === invoiceId)
  if (!inv) throw new Error(`Unknown invoice ${invoiceId}`)
  return inv.totalCents - allocatedTo(invoiceId)
}

/** Unapplied cents on a payment or credit memo: its cents minus the sum of its allocations (DECISIONS.md entry 10). */
export function unappliedFor(sourceId: string): number {
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
export function allocate({ sourceType, sourceId, invoiceIds, cents }: AllocateInput): PaymentAllocation[] {
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
