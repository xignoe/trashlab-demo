/**
 * Pure preview helpers for the publish step (moved from pricing/src/store/preview.ts). Nothing here writes: "after"
 * is computed against a copy of the db in which the chosen drafts are appended as published, and every price comes
 * from the canonical engine in its trailing-db form.
 */
import type { BillingAccount, Charge, Frequency, RateVersion } from '../../../types'
import type { Db } from '../../../store/db'
import { contractTermOn, generateRecurringCharges } from '../../../store/engine'
import { cadenceOf, isDue, type CadenceOf } from '../../../store/cycles'
import { addMonths, dateOnly, firstOfNextMonth } from './dates'
import { resolveRate, withPreviewChargeIds, type ResolvedPrice } from './engine'

export interface InvoicePreview {
  accountId: string
  /** The cycle date the invoice was priced on: the first date on or after the requested one the account is billed. */
  onDate: string
  lines: Charge[]
  subtotalCents: number
  feeCents: number
  taxCents: number
  totalCents: number
}

export interface PreviewInvoiceArgs {
  accountId: string
  onDate: string
  db: Db
  /** Overrides the rateVersions table for this run (for example drafts appended as published). */
  rateVersions?: RateVersion[]
}

/**
 * The account's next billing date on or after onDate. The canonical generateRecurringCharges bills an account only
 * on a date it isDue (a quarterly account on Jan, Apr, Jul, Oct 1), so a preview for a draft effective 2026-11-01
 * shows a quarterly account's next real invoice, 2027-01-01, instead of an empty one.
 */
export function invoiceDateFor(account: CadenceOf, onDate: string): string {
  const d = dateOnly(onDate)
  const first = d.endsWith('-01') ? d : firstOfNextMonth(d)
  for (let i = 0; i < 24; i += 1) {
    const candidate = addMonths(first, i)
    if (isDue(account, candidate)) return candidate
  }
  return d
}

/**
 * The account's next recurring invoice, priced by the canonical generateRecurringCharges on a copy of the db scoped
 * to that account, with no existing charges (so nothing is skipped as already billed) and throwaway charge ids.
 * subtotalCents is the sum of base cents: service lines before fees and tax.
 */
export function previewInvoice(args: PreviewInvoiceArgs): InvoicePreview {
  const { db, accountId } = args
  const account = db.accounts.find(a => a.id === accountId)
  const onDate = account ? invoiceDateFor(cadenceOf(account, db.billingGroups), args.onDate) : dateOnly(args.onDate)
  const siteIds = new Set(db.sites.filter(s => s.accountId === accountId).map(s => s.id))
  const scoped: Db = {
    ...db,
    rateVersions: args.rateVersions ?? db.rateVersions,
    accounts: db.accounts.filter(a => a.id === accountId),
    serviceItems: db.serviceItems.filter(si => siteIds.has(si.siteId)),
    charges: [],
  }
  const lines = account ? withPreviewChargeIds(() => generateRecurringCharges({ cycleDate: onDate }, scoped)) : []
  const sum = (f: (c: Charge) => number) => lines.reduce((acc, c) => acc + f(c), 0)
  return {
    accountId,
    onDate,
    lines,
    subtotalCents: sum(c => c.baseCents),
    feeCents: sum(c => c.fees.reduce((a, f) => a + f.cents, 0)),
    taxCents: sum(c => c.taxCents),
    totalCents: sum(c => c.totalCents),
  }
}

export interface MovedAccount {
  accountId: string
  name: string
  beforeMonthlyCents: number
  afterMonthlyCents: number
}

export interface ExcludedContractAccount {
  accountId: string
  name: string
  contractId: string
  reason: string
  coveredCatalogIds: string[]
  protected: boolean
  /**
   * Start of the auto-renewed term the contract is in on evaluatedOn, when that is past its signed termEnd (addendum
   * I1, the canonical contractTermOn). Absent for a contract in its signed term or not in force.
   */
  renewedOn?: string
  note: string
}

export interface RepresentativeAccount {
  accountId: string
  name: string
  cycle: BillingAccount['cycle']
  before: InvoicePreview
  after: InvoicePreview
  /** True when every line prices the same before and after (for example a contract override held). */
  unchanged: boolean
}

export interface BlastRadius {
  draftIds: string[]
  /** The date both sides were priced on: the later of onDate and the latest draft effectiveFrom. */
  evaluatedOn: string
  movedAccounts: MovedAccount[]
  excludedContractAccounts: ExcludedContractAccount[]
  representativeAccounts: RepresentativeAccount[]
  /** Sum over movedAccounts of after minus before, in base service cents per month. */
  totalMonthlyDeltaCents: number
  /**
   * Active lines a draft would reach if it billed everyone, left on their current price because the draft is for new
   * service only (RateVersion.appliesTo, DECISIONS.md entry 67). Zero when no draft is new service only.
   */
  keptOnCurrentPrice: { lines: number; accounts: number }
}

export interface BlastRadiusArgs {
  /** The drafts to preview, by id. Each must be one of `drafts`. */
  draftIds: string[]
  /** The pending drafts (the pricing slice's pricingDrafts). */
  drafts: RateVersion[]
  onDate: string
  db: Db
  /** The publishedAt the publish will stamp; defaults to evaluatedOn. Decides ties with a version on the same date. */
  publishedAt?: string
}

/** Account ids are shared across the five surfaces (addendum D1), so these may stay named. */
export const REPRESENTATIVE_ACCOUNT_IDS = ['acct_res_maple', 'acct_res_001', 'acct_bakery'] as const

const BILLABLE = new Set<BillingAccount['status']>(['active', 'pastDue'])

function partyName(accountId: string, db: Db): string {
  const account = db.accounts.find(a => a.id === accountId)
  return db.parties.find(p => p.id === account?.payerPartyId)?.name ?? accountId
}

function catalogName(catalogId: string, db: Db): string {
  return db.catalog.find(c => c.id === catalogId)?.name ?? catalogId
}

interface ActiveItem {
  itemId: string
  siteId: string
  catalogId: string
  frequency: Frequency
  qty: number
  zoneId: string
}

/** Active items on an account's sites, effective on the date. */
function activeItems(accountId: string, onDate: string, db: Db): ActiveItem[] {
  const out: ActiveItem[] = []
  for (const site of db.sites) {
    if (site.accountId !== accountId) continue
    for (const si of db.serviceItems) {
      if (si.siteId !== site.id || si.status !== 'active') continue
      if (dateOnly(si.effectiveFrom) > onDate) continue
      if (si.effectiveTo !== undefined && dateOnly(si.effectiveTo) < onDate) continue
      out.push({ itemId: si.id, siteId: site.id, catalogId: si.catalogId, frequency: si.frequency, qty: si.qty, zoneId: site.zoneId })
    }
  }
  return out
}

function tryResolve(item: ActiveItem, accountId: string, onDate: string, db: Db): ResolvedPrice | null {
  try {
    return resolveRate({ catalogId: item.catalogId, frequency: item.frequency, zoneId: item.zoneId, accountId, onDate, serviceItemId: item.itemId, siteId: item.siteId }, db)
  } catch {
    return null
  }
}

/** Would this draft be the row an item resolves to if no contract stood in the way? */
function draftCovers(draft: RateVersion, item: ActiveItem): boolean {
  return (
    draft.catalogId === item.catalogId &&
    (draft.frequency === undefined || draft.frequency === item.frequency) &&
    (draft.zoneId === undefined || draft.zoneId === item.zoneId)
  )
}

/**
 * Who moves, who is protected, and what three representative invoices look like before and after the drafts are
 * published. An account moves only when at least one of its active items resolves to a draft after publish and did
 * not resolve to a contract override before. Monthly cents are base service cents per month (qty times resolved
 * price, no cycle multiplier, before fees and tax). Every Contract row is listed, whatever its line of business.
 */
export function blastRadius(args: BlastRadiusArgs): BlastRadius {
  const { db } = args
  const draftIds = [...new Set(args.draftIds)]
  const pool = new Map(args.drafts.map(d => [d.id, d] as [string, RateVersion]))
  const drafts = draftIds.map(id => {
    const rv = pool.get(id)
    if (rv && rv.status === 'draft') return rv
    if (db.rateVersions.some(r => r.id === id)) throw new Error(`${id} is already published`)
    throw new Error(`Unknown rate version ${id}`)
  })

  const latestEffective = drafts.reduce((max, d) => (dateOnly(d.effectiveFrom) > max ? dateOnly(d.effectiveFrom) : max), '')
  const evaluatedOn = latestEffective > dateOnly(args.onDate) ? latestEffective : dateOnly(args.onDate)
  const publishedAt = args.publishedAt ?? evaluatedOn

  const afterRates: RateVersion[] = [...db.rateVersions, ...drafts.map(d => ({ ...d, status: 'published' as const, publishedAt }))]
  const afterDb: Db = { ...db, rateVersions: afterRates }
  const draftIdSet = new Set(draftIds)
  // The same drafts as if they billed everyone: a line that would then resolve to one, but does not, keeps its price.
  const everyoneDb: Db | undefined = drafts.some(d => d.appliesTo === 'newService')
    ? { ...db, rateVersions: [...db.rateVersions, ...drafts.map(d => ({ ...d, appliesTo: 'everyone' as const, status: 'published' as const, publishedAt }))] }
    : undefined

  const movedAccounts: MovedAccount[] = []
  const kept = { lines: 0, accounts: 0 }
  for (const account of db.accounts) {
    if (!BILLABLE.has(account.status)) continue
    const items = activeItems(account.id, evaluatedOn, db)
    if (items.length === 0) continue
    let before = 0
    let after = 0
    let moved = false
    let keptHere = false
    for (const item of items) {
      const b = tryResolve(item, account.id, evaluatedOn, db)
      const a = tryResolve(item, account.id, evaluatedOn, afterDb)
      before += (b?.priceCents ?? 0) * item.qty
      after += (a?.priceCents ?? 0) * item.qty
      if (a?.rateVersionId !== undefined && draftIdSet.has(a.rateVersionId) && b?.ruleWon !== 'contractOverride') moved = true
      if (everyoneDb && b?.ruleWon !== 'contractOverride') {
        const e = tryResolve(item, account.id, evaluatedOn, everyoneDb)
        if (e?.rateVersionId !== undefined && draftIdSet.has(e.rateVersionId) && a?.rateVersionId !== e.rateVersionId) {
          kept.lines += 1
          keptHere = true
        }
      }
    }
    if (keptHere) kept.accounts += 1
    if (moved) movedAccounts.push({ accountId: account.id, name: partyName(account.id, db), beforeMonthlyCents: before, afterMonthlyCents: after })
  }
  movedAccounts.sort(
    (x, y) => y.afterMonthlyCents - y.beforeMonthlyCents - (x.afterMonthlyCents - x.beforeMonthlyCents) || x.accountId.localeCompare(y.accountId),
  )

  const excludedContractAccounts: ExcludedContractAccount[] = db.contracts.map(contract => {
    const accountId = contract.accountId
    // The engine's own term rule, so the preview protects exactly what billing bills as contractOverride: past termEnd a
    // contract auto-renews and still protects (addendum I1); one the account has since replaced is history (K3).
    const term = contractTermOn(contract, evaluatedOn, db.contracts)
    const isProtected = term !== undefined
    const renewedOn = term && term.renewal > 0 ? term.start : undefined
    const coveredCatalogIds = [...new Set(contract.overrides.map(o => o.catalogId))]
    const reasons = [...new Set(contract.overrides.map(o => o.reason).filter((r): r is string => !!r))]
    const items = activeItems(accountId, evaluatedOn, db)
    const inScope = items.filter(item => drafts.some(d => draftCovers(d, item)))
    const covered = inScope.filter(item =>
      contract.overrides.some(o => o.catalogId === item.catalogId && (o.frequency === undefined || o.frequency === item.frequency)),
    )
    const uncovered = inScope.filter(item => !covered.includes(item))
    const names = (rows: ActiveItem[]) => [...new Set(rows.map(r => catalogName(r.catalogId, db)))].join(' and ')

    let note: string
    if (!term) {
      const replacement = db.contracts.find(o =>
        o.id !== contract.id && o.accountId === accountId && dateOnly(o.termStart) > dateOnly(contract.termEnd) && dateOnly(o.termStart) <= evaluatedOn)
      note = evaluatedOn < dateOnly(contract.termStart)
        ? `contract starts ${dateOnly(contract.termStart)}, not yet in force`
        : `contract ended ${dateOnly(contract.termEnd)}, replaced by ${replacement?.id ?? 'a newer contract'}, no longer protected`
    } else {
      if (covered.length > 0 && uncovered.length === 0) note = `override covers ${names(covered)}`
      else if (covered.length > 0) note = `override covers ${names(covered)}; ${names(uncovered)} is not covered and moves`
      else if (inScope.length > 0) note = `override does not cover ${names(inScope)}, that item moves`
      else note = "no service in this draft's scope, contract still protects it"
      if (renewedOn) note += ` (signed term ended ${dateOnly(contract.termEnd)}, auto-renewed ${renewedOn}, still protected)`
    }

    return {
      accountId, name: partyName(accountId, db), contractId: contract.id, reason: reasons.join('; '), coveredCatalogIds,
      protected: isProtected, ...(renewedOn ? { renewedOn } : {}), note,
    }
  })

  const representativeAccounts: RepresentativeAccount[] = REPRESENTATIVE_ACCOUNT_IDS.filter(id => db.accounts.some(a => a.id === id)).map(accountId => {
    const before = previewInvoice({ accountId, onDate: evaluatedOn, db })
    const after = previewInvoice({ accountId, onDate: evaluatedOn, db, rateVersions: afterRates })
    const key = (p: InvoicePreview) => JSON.stringify(p.lines.map(l => [l.source.id, l.baseCents, l.totalCents, l.pricing]))
    const cycle = db.accounts.find(a => a.id === accountId)!.cycle
    return { accountId, name: partyName(accountId, db), cycle, before, after, unchanged: key(before) === key(after) }
  })

  const totalMonthlyDeltaCents = movedAccounts.reduce((sum, m) => sum + (m.afterMonthlyCents - m.beforeMonthlyCents), 0)
  return { draftIds, evaluatedOn, movedAccounts, excludedContractAccounts, representativeAccounts, totalMonthlyDeltaCents, keptOnCurrentPrice: kept }
}
