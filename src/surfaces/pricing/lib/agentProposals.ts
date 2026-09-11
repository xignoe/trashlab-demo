/**
 * Agent proposals: annual increase (moved from pricing/src/store/agentProposals.ts; pricing checklist 6.1 and 6.4).
 *
 * Agent drafts. Rules authorize. You approve. Nothing here publishes.
 *
 * proposeIncreases is a pure function over the db: one row per billable account with active service items, priced
 * with the canonical resolvePrice and costed with costToServe at DEFAULT_ASSUMPTIONS. planApproval turns approved rows
 * into the writes they would make (deduplicated draft RateVersions and Contract escalator entries) so the panel can
 * state them before anything runs. Applying a plan is the pricing slice's approvePricingProposals, which only calls
 * createDraftRateVersion and setContractEscalator, never publishRateVersions. Proposals are computed, never stored.
 */
import type { BillingAccount, Contract, Frequency, LOB, RateVersion } from '../../../types'
import type { Db } from '../../../store/db'
import { contractTermOn, type ContractTerm } from '../../../store/engine'
import { DEFAULT_ASSUMPTIONS, costToServe, defaultMaterial, type CostAssumptions } from './costToServe'
import { addDays, dateOnly, firstOfNextMonth } from './dates'
import { contractsOfAccount } from './contracts'
import { FREQUENCY_LABEL, resolveRate, type ResolvedPrice } from './engine'
import { formatCents } from './money'
import { rateGroupKey, type CreateDraftRateVersionArgs } from './rateVersions'

/** Standard annual increase for an account with no contract. */
export const STANDARD_INCREASE_PCT = 4
/** Increase proposed when margin is below MARGIN_FLOOR_PCT. */
export const LOW_MARGIN_INCREASE_PCT = 6
export const MARGIN_FLOOR_PCT = 20
/** Days of notice a customer gets before a proposed ratebook increase takes effect (pricing decision 93). */
export const PROPOSAL_NOTICE_DAYS = 30

export type ChurnRisk = 'low' | 'medium' | 'high'
export type EligibilityKind = 'eligible' | 'escalatorScheduled' | 'locked'

export interface ProposalItem {
  catalogId: string
  catalogName: string
  frequency: Frequency
  zoneId: string
  qty: number
  /** Per unit per month, from resolvePrice on onDate. */
  priceCents: number
  ruleWon: ResolvedPrice['ruleWon']
  rateVersionId?: string
  contractId?: string
  /** Full cost to serve per unit per month at the default assumptions. */
  costCents: number
}

/** One (catalogId, zoneId, frequency) rate line a no-contract account resolves to. */
export interface RateGroup {
  key: string
  catalogId: string
  zoneId?: string
  frequency?: Frequency
  /** The published RateVersion the account resolves to today; a draft supersedes it. */
  rateVersionId: string
  currentPriceCents: number
}

export type ProposalAction =
  | { kind: 'draftRateVersion'; groups: RateGroup[]; label: string }
  | { kind: 'escalator'; contractId: string; escalator: NonNullable<Contract['escalator']>; label: string }
  | { kind: 'none'; label: 'none' }

export interface ProposalRow {
  accountId: string
  name: string
  lob: LOB
  accountStatus: BillingAccount['status']
  items: ProposalItem[]
  currentMonthlyCents: number
  costMonthlyCents: number
  /** (current - cost) / current, one decimal. */
  marginPct: number
  monthsSinceLastIncrease: number
  /** Where monthsSinceLastIncrease was measured from. */
  lastIncrease: { date: string; source: 'rateVersion' | 'contract'; id: string }
  contractEligibility: string
  eligibilityKind: EligibilityKind
  /** The contract in force on onDate, when there is one: in its signed term or auto-renewed (addendum I1). */
  contract?: Contract
  /** The term of `contract` containing onDate. renewedOn is set when that term is an auto-renewal (addendum I1). */
  contractTerm?: { start: string; end: string; renewedOn?: string }
  /** The account's contract that has ended and is not in force (replaced, addendum K3). Shown, never written. */
  lapsedContract?: { id: string; termEnd: string; overridePriceCents?: number }
  churnRisk: ChurnRisk
  churnBasis: string
  /** Percent that takes effect: the scheduled escalator pct, 0 while a price is locked, else 4 or 6. */
  proposedPct: number
  proposedMonthlyCents: number
  /** When proposedMonthlyCents would take effect. */
  proposedEffective: string
  /** For a locked contract: the fixed escalator approving would schedule at termEnd + 1 day. */
  escalatorPct?: number
  rationale: string
  action: ProposalAction
}

export interface ProposeIncreasesArgs {
  onDate: string
  assumptions?: CostAssumptions
}

const BILLABLE = new Set<BillingAccount['status']>(['active', 'pastDue'])

const increased = (cents: number, pct: number): number => Math.round((cents * (100 + pct)) / 100)

/** Whole calendar months from `from` to `to`: 2025-01-01 to 2026-09-10 is 20. */
export function monthsBetween(from: string, to: string): number {
  const [y1, m1, d1] = dateOnly(from).split('-').map(Number)
  const [y2, m2, d2] = dateOnly(to).split('-').map(Number)
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0))
}

/** effectiveFrom for an agent drafted ratebook increase: first of the month at least PROPOSAL_NOTICE_DAYS out. */
export const proposalEffectiveFrom = (onDate: string): string => firstOfNextMonth(addDays(onDate, PROPOSAL_NOTICE_DAYS - 1))

/** Placeholder churn signal, labelled as such everywhere it is shown: pastDue high, autopay low, else medium. */
export function churnRiskFor(account: BillingAccount): { risk: ChurnRisk; basis: string } {
  if (account.status === 'pastDue') return { risk: 'high', basis: 'past due' }
  if (account.autopay) return { risk: 'low', basis: 'on autopay' }
  return { risk: 'medium', basis: 'no autopay, current' }
}

function partyName(account: BillingAccount, db: Db): string {
  return db.parties.find(p => p.id === account.payerPartyId)?.name ?? account.id
}

export function zoneName(zoneId: string | undefined, db: Db): string {
  if (!zoneId) return 'all zones'
  return db.zones.find(z => z.id === zoneId)?.name ?? zoneId
}

/** "cat_res_96, zone_open, weekly" in the checklist's "<catalog, zone, frequency>" shape. */
export function groupLabel(g: Pick<RateGroup, 'catalogId' | 'zoneId' | 'frequency'>): string {
  return `${g.catalogId}, ${g.zoneId ?? 'all zones'}, ${g.frequency ?? 'any frequency'}`
}

/**
 * The contract in force on the date with its term, as billing reads it: the canonical contractTermOn, so a contract
 * past its signed term has auto-renewed (addendum I1) unless a newer one replaced it (K3). In-term contracts first,
 * then the one account.contractId names.
 */
function contractInForce(db: Db, account: BillingAccount, onDate: string): { contract: Contract; term: ContractTerm } | undefined {
  const mine = contractsOfAccount(db, account.id)
  return mine
    .map(contract => ({ contract, term: contractTermOn(contract, onDate, db.contracts) }))
    .filter((x): x is { contract: Contract; term: ContractTerm } => x.term !== undefined)
    .sort((a, b) => a.term.renewal - b.term.renewal || Number(b.contract.id === account.contractId) - Number(a.contract.id === account.contractId))[0]
}

function lapsedFor(db: Db, account: BillingAccount, onDate: string, items: ProposalItem[]): ProposalRow['lapsedContract'] {
  const ended = contractsOfAccount(db, account.id)
    .filter(c => dateOnly(c.termEnd) < onDate && contractTermOn(c, onDate, db.contracts) === undefined)
    .sort((a, b) => dateOnly(b.termEnd).localeCompare(dateOnly(a.termEnd)))[0]
  if (!ended) return undefined
  const override = ended.overrides.find(o => items.some(i => i.catalogId === o.catalogId && (o.frequency === undefined || o.frequency === i.frequency)))
  return { id: ended.id, termEnd: dateOnly(ended.termEnd), ...(override ? { overridePriceCents: override.priceCents } : {}) }
}

function activeItemsOf(db: Db, accountId: string, onDate: string): { catalogId: string; frequency: Frequency; qty: number; zoneId: string }[] {
  const out: { catalogId: string; frequency: Frequency; qty: number; zoneId: string }[] = []
  for (const site of db.sites) {
    if (site.accountId !== accountId) continue
    for (const si of db.serviceItems) {
      if (si.siteId !== site.id || si.status !== 'active') continue
      if (dateOnly(si.effectiveFrom) > onDate) continue
      if (si.effectiveTo !== undefined && dateOnly(si.effectiveTo) < onDate) continue
      out.push({ catalogId: si.catalogId, frequency: si.frequency, qty: si.qty, zoneId: site.zoneId })
    }
  }
  return out
}

const pctText = (n: number): string => `${Number.isInteger(n) ? n : n.toFixed(1)}%`

/** One row per billable (active or pastDue) account with active service items on onDate, ranked: rows with something
 *  to approve first, then lowest margin first. Suspended and hold accounts are left out (see unproposedAccounts); an
 *  item with no published rate is skipped rather than crashing the panel. */
export function proposeIncreases(args: ProposeIncreasesArgs, db: Db): ProposalRow[] {
  const onDate = dateOnly(args.onDate)
  const assumptions = args.assumptions ?? DEFAULT_ASSUMPTIONS
  const rows: ProposalRow[] = []

  for (const account of db.accounts) {
    if (!BILLABLE.has(account.status)) continue
    const items: ProposalItem[] = []
    for (const it of activeItemsOf(db, account.id, onDate)) {
      const catalog = db.catalog.find(c => c.id === it.catalogId)
      if (!catalog) continue
      let price: ResolvedPrice
      try {
        price = resolveRate({ catalogId: it.catalogId, frequency: it.frequency, zoneId: it.zoneId, accountId: account.id, onDate }, db)
      } catch {
        continue
      }
      const cost = costToServe({ item: catalog, material: defaultMaterial(catalog), frequency: it.frequency, assumptions })
      items.push({
        catalogId: it.catalogId,
        catalogName: catalog.name,
        frequency: it.frequency,
        zoneId: it.zoneId,
        qty: it.qty,
        priceCents: price.priceCents,
        ruleWon: price.ruleWon,
        ...(price.rateVersionId !== undefined ? { rateVersionId: price.rateVersionId } : {}),
        ...(price.contractId !== undefined ? { contractId: price.contractId } : {}),
        costCents: cost.fullCostCents,
      })
    }
    if (items.length === 0) continue

    const currentMonthlyCents = items.reduce((s, i) => s + i.priceCents * i.qty, 0)
    const costMonthlyCents = items.reduce((s, i) => s + i.costCents * i.qty, 0)
    const marginPct = currentMonthlyCents > 0 ? Math.round(((currentMonthlyCents - costMonthlyCents) / currentMonthlyCents) * 1000) / 10 : 0
    const lowMargin = marginPct < MARGIN_FLOOR_PCT
    const ratebookPct = lowMargin ? LOW_MARGIN_INCREASE_PCT : STANDARD_INCREASE_PCT

    // Months since last increase: the latest effectiveFrom among the RateVersions its items resolve to, or the
    // termStart of the contract whose override prices an item.
    let lastIncrease: ProposalRow['lastIncrease'] | undefined
    for (const i of items) {
      let candidate: ProposalRow['lastIncrease'] | undefined
      if (i.contractId) {
        const c = db.contracts.find(cc => cc.id === i.contractId)
        if (c) candidate = { date: dateOnly(c.termStart), source: 'contract', id: c.id }
      } else if (i.rateVersionId) {
        const rv = db.rateVersions.find(r => r.id === i.rateVersionId)
        if (rv) candidate = { date: dateOnly(rv.effectiveFrom), source: 'rateVersion', id: rv.id }
      }
      if (candidate && (!lastIncrease || candidate.date > lastIncrease.date)) lastIncrease = candidate
    }
    lastIncrease ??= { date: onDate, source: 'rateVersion', id: 'unknown' }
    const monthsSinceLastIncrease = monthsBetween(lastIncrease.date, onDate)

    const lobCounts = new Map<LOB, number>()
    for (const i of items) {
      const lob = db.catalog.find(c => c.id === i.catalogId)!.lob
      lobCounts.set(lob, (lobCounts.get(lob) ?? 0) + i.qty)
    }
    const lob = [...lobCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]

    const { risk: churnRisk, basis: churnBasis } = churnRiskFor(account)
    const inForce = contractInForce(db, account, onDate)
    const contract = inForce?.contract
    const contractTerm = inForce
      ? { start: inForce.term.start, end: inForce.term.end, ...(inForce.term.renewal > 0 ? { renewedOn: inForce.term.start } : {}) }
      : undefined
    const lapsedContract = contract ? undefined : lapsedFor(db, account, onDate, items)

    const since = `${monthsSinceLastIncrease} month${monthsSinceLastIncrease === 1 ? '' : 's'} since the last increase (${lastIncrease.id}, ${lastIncrease.date})`
    const marginText = `${pctText(marginPct)} margin over ${formatCents(costMonthlyCents)} a month cost to serve${lowMargin ? `, below the ${MARGIN_FLOOR_PCT}% floor` : ''}`
    const churnText = `churn risk ${churnRisk} (placeholder: ${churnBasis})`

    let contractEligibility: string
    let eligibilityKind: EligibilityKind
    let proposedPct: number
    let proposedMonthlyCents: number
    let proposedEffective: string
    let escalatorPct: number | undefined
    let action: ProposalAction
    let decision: string

    if (contract?.escalator) {
      const esc = contract.escalator
      contractEligibility = `contract escalator ${pctText(esc.pct)} due ${dateOnly(esc.anniversary)}`
      eligibilityKind = 'escalatorScheduled'
      proposedPct = esc.pct
      proposedMonthlyCents = items.reduce((s, i) => s + increased(i.priceCents, esc.pct) * i.qty, 0)
      proposedEffective = dateOnly(esc.anniversary)
      action = { kind: 'none', label: 'none' }
      decision = `${contract.id} already schedules ${pctText(esc.pct)} on ${dateOnly(esc.anniversary)}, so nothing new is written${lowMargin ? ' and the margin is one to raise at renewal' : ''}`
    } else if (contract && contractTerm) {
      // The term in force: the signed one, or the auto-renewed one billing prices this account under (addendum I1).
      const termEnd = contractTerm.end
      const anniversary = addDays(termEnd, 1)
      contractEligibility = `contract, no escalator, locked until ${termEnd}`
      eligibilityKind = 'locked'
      proposedPct = 0
      proposedMonthlyCents = currentMonthlyCents
      proposedEffective = anniversary
      escalatorPct = ratebookPct
      action = { kind: 'escalator', contractId: contract.id, escalator: { kind: 'fixedPct', pct: ratebookPct, anniversary }, label: `escalator entry on ${contract.id}` }
      decision = `the price is held until ${termEnd}, so propose 0% now and a ${pctText(ratebookPct)} fixed escalator on ${contract.id} from ${anniversary}`
    } else {
      const groups = new Map<string, RateGroup>()
      for (const i of items) {
        if (!i.rateVersionId) continue
        const rv = db.rateVersions.find(r => r.id === i.rateVersionId)
        if (!rv) continue
        const g: RateGroup = {
          key: rateGroupKey(rv),
          catalogId: rv.catalogId,
          ...(rv.zoneId !== undefined ? { zoneId: rv.zoneId } : {}),
          ...(rv.frequency !== undefined ? { frequency: rv.frequency } : {}),
          rateVersionId: rv.id,
          currentPriceCents: rv.priceCents,
        }
        groups.set(g.key, g)
      }
      const list = [...groups.values()]
      contractEligibility = 'no contract, eligible'
      eligibilityKind = 'eligible'
      proposedPct = ratebookPct
      proposedMonthlyCents = items.reduce((s, i) => s + increased(i.priceCents, ratebookPct) * i.qty, 0)
      proposedEffective = proposalEffectiveFrom(onDate)
      action = list.length
        ? { kind: 'draftRateVersion', groups: list, label: `draft RateVersion for ${list.map(g => groupLabel(g)).join('; ')}` }
        : { kind: 'none', label: 'none' }
      decision = `no contract, so propose ${pctText(ratebookPct)} on the ratebook from ${proposedEffective}`
    }

    // Addendum I1: a contract past its signed term auto-renews, so it still prices the account. Only a contract a newer
    // one replaced (K3) has stopped pricing it, and only then does the account bill at the ratebook.
    const renewedText = contract && contractTerm?.renewedOn
      ? `Contract ${contract.id}'s signed term ended ${dateOnly(contract.termEnd)} and it auto-renewed on ${contractTerm.renewedOn}, so it still prices this account; `
      : ''
    const lapsedText = lapsedContract
      ? `Contract ${lapsedContract.id} ended ${lapsedContract.termEnd} and a newer contract replaced it, so it no longer prices this account${lapsedContract.overridePriceCents !== undefined ? ` (its ${formatCents(lapsedContract.overridePriceCents)} contract price is history)` : ''}; `
      : ''
    const rationale = `${renewedText}${lapsedText}${since}, ${marginText}, ${churnText}: ${decision}.`

    rows.push({
      accountId: account.id,
      name: partyName(account, db),
      lob,
      accountStatus: account.status,
      items,
      currentMonthlyCents,
      costMonthlyCents,
      marginPct,
      monthsSinceLastIncrease,
      lastIncrease,
      contractEligibility,
      eligibilityKind,
      ...(contract ? { contract } : {}),
      ...(contractTerm ? { contractTerm } : {}),
      ...(lapsedContract ? { lapsedContract } : {}),
      churnRisk,
      churnBasis,
      proposedPct,
      proposedMonthlyCents,
      proposedEffective,
      ...(escalatorPct !== undefined ? { escalatorPct } : {}),
      rationale,
      action,
    })
  }

  return rows.sort((a, b) => Number(a.action.kind === 'none') - Number(b.action.kind === 'none') || a.marginPct - b.marginPct || a.name.localeCompare(b.name))
}

/** Accounts with active items that get no proposal because they are not billable (suspended or hold). */
export function unproposedAccounts({ onDate }: { onDate: string }, db: Db): { accountId: string; name: string; status: BillingAccount['status'] }[] {
  const d = dateOnly(onDate)
  return db.accounts
    .filter(a => !BILLABLE.has(a.status) && activeItemsOf(db, a.id, d).length > 0)
    .map(a => ({ accountId: a.id, name: partyName(a, db), status: a.status }))
}

// -------------------------------------------------------------------------------------------------------------------
// Approval

export type RowStatus =
  /** Something to approve. */
  | { kind: 'open' }
  /** Every rate line the row resolves to already has a pending draft. */
  | { kind: 'draftPending'; draftIds: string[] }
  /** The contract already carries an escalator; nothing to write. */
  | { kind: 'alreadyScheduled' }

/** Pending drafts per rate group key. Pass the db's versions plus the slice's drafts. */
export function pendingDraftsByGroup(rateVersions: RateVersion[]): Map<string, RateVersion[]> {
  const out = new Map<string, RateVersion[]>()
  for (const rv of rateVersions) {
    if (rv.status !== 'draft') continue
    const k = rateGroupKey(rv)
    out.set(k, [...(out.get(k) ?? []), rv])
  }
  return out
}

export function rowStatus(row: ProposalRow, rateVersions: RateVersion[]): RowStatus {
  if (row.action.kind === 'none') return { kind: 'alreadyScheduled' }
  if (row.action.kind === 'escalator') return { kind: 'open' }
  const pending = pendingDraftsByGroup(rateVersions)
  const ids: string[] = []
  for (const g of row.action.groups) {
    const p = pending.get(g.key)
    if (!p?.length) return { kind: 'open' }
    ids.push(...p.map(rv => rv.id))
  }
  return { kind: 'draftPending', draftIds: ids }
}

export interface PlannedDraft {
  key: string
  args: CreateDraftRateVersionArgs
  pct: number
  currentPriceCents: number
  /** Approved rows that asked for this rate line. */
  approvedAccountIds: string[]
  /** When the approved rows disagree on pct (4 against 6), the lowest wins and this is true. */
  pctConflict: boolean
}

export interface ApprovalPlan {
  drafts: PlannedDraft[]
  /** Rate lines skipped because a draft is already pending there (from the bulk control or an earlier approval). */
  alreadyPending: { key: string; draftIds: string[]; label: string }[]
  escalators: { accountId: string; contractId: string; escalator: NonNullable<Contract['escalator']> }[]
  /** Approved rows with nothing to write (escalator already scheduled). */
  alreadyScheduled: string[]
  /** Rows that will be written for. */
  approvedAccountIds: string[]
  /** Every proposed account whose price the new drafts would move once published, approved or not. */
  coveredAccountIds: string[]
  summary: string
}

/** What approving these rows would write. Drafts are deduplicated by (catalogId, zoneId, frequency) so many accounts
 *  on the same rate produce one draft, and a rate line with a pending draft is left alone. */
export function planApproval(allRows: ProposalRow[], accountIds: string[], rateVersions: RateVersion[], onDate: string): ApprovalPlan {
  const selected = new Set(accountIds)
  const pending = pendingDraftsByGroup(rateVersions)
  const drafts = new Map<string, PlannedDraft>()
  const alreadyPending = new Map<string, { key: string; draftIds: string[]; label: string }>()
  const escalators: ApprovalPlan['escalators'] = []
  const alreadyScheduled: string[] = []
  const approved: string[] = []
  const effectiveFrom = proposalEffectiveFrom(dateOnly(onDate))

  for (const row of allRows) {
    if (!selected.has(row.accountId)) continue
    const a = row.action
    if (a.kind === 'none') {
      alreadyScheduled.push(row.accountId)
      continue
    }
    if (a.kind === 'escalator') {
      escalators.push({ accountId: row.accountId, contractId: a.contractId, escalator: a.escalator })
      approved.push(row.accountId)
      continue
    }
    let wrote = false
    for (const g of a.groups) {
      const p = pending.get(g.key)
      if (p?.length) {
        alreadyPending.set(g.key, { key: g.key, draftIds: p.map(rv => rv.id), label: groupLabel(g) })
        continue
      }
      wrote = true
      const cur = drafts.get(g.key)
      if (!cur) {
        drafts.set(g.key, {
          key: g.key,
          pct: row.proposedPct,
          currentPriceCents: g.currentPriceCents,
          approvedAccountIds: [row.accountId],
          pctConflict: false,
          args: {
            catalogId: g.catalogId,
            ...(g.zoneId !== undefined ? { zoneId: g.zoneId } : {}),
            ...(g.frequency !== undefined ? { frequency: g.frequency } : {}),
            priceCents: increased(g.currentPriceCents, row.proposedPct),
            effectiveFrom,
            supersedesId: g.rateVersionId,
          },
        })
      } else {
        const pct = Math.min(cur.pct, row.proposedPct)
        drafts.set(g.key, {
          ...cur,
          pct,
          pctConflict: cur.pctConflict || cur.pct !== row.proposedPct,
          approvedAccountIds: [...cur.approvedAccountIds, row.accountId],
          args: { ...cur.args, priceCents: increased(cur.currentPriceCents, pct) },
        })
      }
    }
    if (wrote) approved.push(row.accountId)
  }

  const draftKeys = new Set(drafts.keys())
  const coveredAccountIds = allRows.filter(r => r.action.kind === 'draftRateVersion' && r.action.groups.some(g => draftKeys.has(g.key))).map(r => r.accountId)

  const n = drafts.size
  const m = coveredAccountIds.length
  const k = escalators.length
  const parts: string[] = []
  if (n > 0) parts.push(`Creates ${n} draft rate version${n === 1 ? '' : 's'} covering ${m} account${m === 1 ? '' : 's'}`)
  if (k > 0) parts.push(`${n > 0 ? 'writes' : 'Writes'} ${k} contract escalator entr${k === 1 ? 'y' : 'ies'}`)
  const summary = parts.length ? `${parts.join(' and ')}. Nothing publishes.` : 'Nothing to write. Nothing publishes.'

  return { drafts: [...drafts.values()], alreadyPending: [...alreadyPending.values()], escalators, alreadyScheduled, approvedAccountIds: approved, coveredAccountIds, summary }
}

/** The confirm button says what the approval will write (pricing checklist 7.8). Never the word "publish". */
export function approveButtonLabel(plan: Pick<ApprovalPlan, 'drafts' | 'escalators'>): string {
  const drafts = plan.drafts.length > 0
  const escalators = plan.escalators.length > 0
  if (drafts && escalators) return 'Approve, create drafts and escalators'
  if (escalators) return 'Approve, write escalator only'
  if (drafts) return 'Approve, create drafts only'
  return 'Nothing to approve'
}

export interface ApprovalResult {
  plan: ApprovalPlan
  drafts: RateVersion[]
  contracts: Contract[]
}

/** Frequency label for a rate group, for the panel. */
export const groupFrequencyLabel = (g: Pick<RateGroup, 'frequency'>): string => (g.frequency ? FREQUENCY_LABEL[g.frequency] : 'any frequency')
