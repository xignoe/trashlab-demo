/**
 * Account slice (Phase 2, box 2A.2; Phase 3 box 3.6). Moved from account/src/store/useStore.ts: the office actions the
 * account view (/office/account/:accountId) calls.
 *
 * The db lives in the core store (./types.ts CoreState) in billing's table shape. Every db write here goes through
 * get().mutateDb(fn), with the edit log that changes alongside it passed as its patch, so a db write and the record of
 * it land in one update. Pure planning (service change plans, allocation checks, the reinstatement fee) lives in
 * src/surfaces/account/lib and calls the canonical engine.
 *
 * Phase 3 routed the slice's two write sidecars to their owners' tables (box 3.6, addendum L):
 * - The office's phone requests (cart change, vacation hold) are Request rows in db.requests with status scheduled, so
 *   the portal shows them next to the customer's own. A request the portal already filed is passed in as requestId and
 *   never written twice.
 * - The reinstatement fee is a proposed Charge in db.charges (same chg_ac_ id), on no invoice and in no run: the intake
 *   rule's shape, so billing's next run takes it into its queue as a decision.
 * What stays here is accountEdits, the office's own session log: { ledgerWrites, statusChanges }. Billing already owns
 * the store key `edits` (its charge edit sidecar), so account's log lives under this name.
 *
 * Keys are chosen to be unique across the whole store: the prototype's `setAccountStatus` and `allocate` became
 * `changeAccountStatus` and `allocatePayment` because other surfaces' prototypes use those words.
 */
import type { BillingAccount, BillingGroup, Charge, CreditMemo, InvoiceDelivery, Payment, PaymentAllocation, Request, ServiceItem, WorkOrder } from '../../types'
import { today } from '../clock'
import { findAccount } from '../engine'
import type { Db } from '../db'
import { byId, withRows } from '../../surfaces/account/lib/db'
import {
  EngineError, allocateChecked, buildReinstatementFee, itemStatusForAccountStatus, planServiceChange, statusAfterReinstatement,
  type AllocateArgs,
} from '../../surfaces/account/lib/engine'
import { nextId } from '../../surfaces/account/lib/ids'
import {
  planAddAccount, planRemoveAccount, type AddAccountPlan, type NewAccountDraft, type RemoveAccountPlan,
} from '../../surfaces/account/lib/lifecycle'
import {
  DELIVERY_NAME, INVOICE_DELIVERIES, membersOf, planAddToGroup, planGroupSave, planRemoveGroup, planTakeOut, type AddToGroupPlan, type BillingGroupDraft,
} from '../../surfaces/account/lib/billingGroups'
import type {
  AccountEdits, LedgerWrite, OfficeRequestDraft, ServiceChangeArgs, ServiceChangePlan, StatusChange, SuspensionReason,
} from '../../surfaces/account/lib/types'
import type { RootState, SliceCreator } from './types'

export interface TakePaymentArgs {
  accountId: string
  method: Payment['method']
  cents: number
  /** Default today. */
  receivedAt?: string
  /** Card reference or batch id; only kept for card payments. */
  processorBatchId?: string
  /** Optional allocation applied in the same action; validated before anything is written. */
  allocations?: { invoiceIds: string[]; cents: number[] }
}

export interface IssueCreditMemoArgs {
  accountId: string
  cents: number
  reason: string
  note?: string
  /** When given, the credit is allocated against this invoice; otherwise it stays unapplied on the account. */
  invoiceId?: string
  by?: string
}

export interface ChangeAccountStatusOptions {
  /** Free text from the office, kept on the status change and (for holds) the vacationHold Request's note. */
  note?: string
  /** For holds: the site the vacationHold Request names (default the account's first site). */
  siteId?: string
  createdVia?: Request['createdVia']
  /** Default today. */
  effectiveFrom?: string
  /** Holds: the date service resumes. */
  resumeOn?: string
  /** Suspensions: non-payment or customer request. */
  reason?: SuspensionReason
  /** A Request that already records this hold (the portal's vacationHold). When given, no Request is written. */
  requestId?: string
}

export interface ReinstateResult {
  account: BillingAccount
  statusChange: StatusChange
  /** Present when the account was suspended: the reinstatement fee, now a proposed Charge in db.charges. */
  fee?: Charge
}

export interface LinkAccountToContractArgs {
  accountId: string
  contractId: string
}

export interface AccountSlice {
  /** The office's ledger writes (QuickBooks chip) and status changes (hold, suspend, resume, reinstate). */
  accountEdits: AccountEdits

  /**
   * Closes the old item (effectiveTo, status ended; never deleted), inserts the new one, its container and a WorkOrder,
   * and, unless args.requestId names a Request that already exists (the portal's cart change), the scheduled
   * cartChange Request the WorkOrder answers, all in one update. Returns the plan, with the Request it wrote.
   */
  changeServiceItem(args: ServiceChangeArgs): ServiceChangePlan
  /** Records a request the office took (by phone) as a scheduled Request row the portal shows. */
  recordOfficeRequest(draft: OfficeRequestDraft): Request
  /**
   * Appends a Payment (settled for check and cash, pending for card and ach) and, when allocations are given, its
   * PaymentAllocations, validated by one allocate() call on a shadow db first: nothing is written on failure.
   */
  takePayment(args: TakePaymentArgs): Payment
  /** Appends a CreditMemo and, when an invoice is chosen, allocates it in the same write. */
  issueCreditMemo(args: IssueCreditMemoArgs): CreditMemo
  /**
   * Hold or suspend (the prototype's setAccountStatus). Sets the account status, flips its non-ended ServiceItems
   * (a suspension holds them; see itemStatusForAccountStatus), and records a StatusChange. A hold also writes its
   * scheduled vacationHold Request unless opts.requestId names one already filed. Effective dates never move.
   */
  changeAccountStatus(accountId: string, status: BillingAccount['status'], opts?: ChangeAccountStatusOptions): BillingAccount
  /**
   * Ends a hold or suspension: status back to pastDue when anything is past due, else active, items back to active.
   * Reinstating a suspension also proposes the reinstatement fee into db.charges, all in one update.
   */
  reinstateAccount(accountId: string, opts?: { note?: string }): ReinstateResult
  /** Builds the reinstatement fee through the canonical computeCharge and writes it to db.charges as proposed. */
  proposeReinstatementFee(accountId: string, sourceId: string): Charge
  /**
   * Applies an existing Payment or CreditMemo across invoices through the canonical allocate() (the prototype's
   * `allocate`). Validates first; appends the rows and a ledgerWrites entry. Billing's unapplied-cash action routes
   * here (src/store/stubs.ts applyUnappliedThroughAccount).
   */
  allocatePayment(args: AllocateArgs): PaymentAllocation[]
  /** Moves an open WorkOrder to scheduled, or a scheduled one to done. Never removes it. */
  setWorkOrderStatus(workOrderId: string, status: WorkOrder['status']): WorkOrder
  /**
   * Points BillingAccount.contractId at a contract written for that account (pricing's new contract under addendum
   * K3). Throws for an unknown account or contract, or a contract on another account. A no-op when already linked.
   */
  linkAccountToContract(args: LinkAccountToContractArgs): BillingAccount
  /**
   * Create a billing group, or update one when id is given (addenda P and Q). A new schedule moves every member with
   * it, effective at their next bill date, with bridge charges for any days left unbilled; periods already billed are
   * not billed again. Turning customer choice off puts every member on the group's delivery. Refused while a member
   * whose bill dates would change has recurring charges generated and not yet posted.
   */
  saveBillingGroup(draft: BillingGroupDraft, id?: string): BillingGroup
  /**
   * Add accounts to a group in one step (the office's bulk add by zone, type, service, or route). Each takes the
   * group's frequency as its cycle and, when customers may not choose, the group's delivery. Accounts that cannot move
   * yet are skipped with the reason rather than failing the whole add.
   */
  addAccountsToBillingGroup(groupId: string, accountIds: string[]): Omit<AddToGroupPlan, 'db'>
  /**
   * Remove a billing group. Its members move first, to moveTo or (null) out of any group, with bridge charges where a
   * move leaves days unbilled; refused while a member has unposted recurring charges. The one delete in this slice:
   * a group is configuration, and no financial record is removed (invariant 5 holds).
   */
  deleteBillingGroup(groupId: string, moveTo: string | null): { moved: number; bridges: number }
  /** Put one account in a group, or with null take it out (it keeps its cycle and bills on that cycle's usual dates). */
  assignBillingGroup(accountId: string, groupId: string | null): BillingAccount
  /** How the customer wants their invoices. Refused when the account's group sends every invoice one way. */
  setInvoiceDelivery(accountId: string, method: InvoiceDelivery): BillingAccount
  /** Switch every member of a group to the group's delivery. Returns how many accounts changed. */
  applyGroupDelivery(groupId: string): number

  /**
   * The office's own intake (the storefront signs customers up; this is the account taken over the phone or counter).
   * Writes one Party, one BillingAccount, one Site and, when the draft carries a first service, its ServiceItem,
   * Container and open delivery WorkOrder, in one update. Throws on an invalid draft (addAccountError) and writes
   * nothing. No Charge: the account's first invoice comes from the next billing run like any other.
   */
  addAccount(draft: NewAccountDraft): AddAccountPlan
  /**
   * Closes an account: every service line ends on the effective date, the containers still out get one open recovery
   * work order, autopay goes off and the account is suspended, with a StatusChange recording it. Invoices, payments,
   * credits, charges, and waives are untouched, and an open balance stays owed.
   */
  closeAccount(accountId: string, opts?: { effectiveFrom?: string; note?: string }): RemoveAccountPlan
  /**
   * Removes an account that carries no money and no field history at all (planRemoveAccount's canDelete): its row,
   * its sites, service items, containers, work orders, requests, and the payer party when nothing else names it.
   * Refused for any account with a charge, invoice, payment, credit memo, service event, scale ticket, or contract;
   * close those instead. The second delete in this slice (deleteBillingGroup is the first), and like that one it
   * removes no financial record, so invariant 5 holds.
   */
  deleteAccount(accountId: string): RemoveAccountPlan
}

/** Fresh session log: nothing recorded this session. */
export function initialAccountData(): Pick<AccountSlice, 'accountEdits'> {
  return { accountEdits: { ledgerWrites: [], statusChanges: [] } }
}

const sumCents = (rows: { cents: number }[]) => rows.reduce((s, r) => s + r.cents, 0)

function requireAccount(db: Db, accountId: string): BillingAccount {
  const account = byId(db.accounts, accountId)
  if (!account) throw new EngineError(`BillingAccount ${accountId} not found`)
  return account
}

/** New ledgerWrites entries, numbered after the ones already recorded. */
function ledgerWrites(existing: LedgerWrite[], entries: Omit<LedgerWrite, 'id' | 'at'>[]): LedgerWrite[] {
  const ids = existing.map(w => w.id)
  return entries.map((e, i) => ({ ...e, id: nextId('lw', ids, i), at: today() }))
}

function withLedger(s: RootState, entries: Omit<LedgerWrite, 'id' | 'at'>[]): Pick<AccountSlice, 'accountEdits'> {
  const added = ledgerWrites(s.accountEdits.ledgerWrites, entries)
  return { accountEdits: { ...s.accountEdits, ledgerWrites: [...s.accountEdits.ledgerWrites, ...added] } }
}

/**
 * A request the office took, as a Request row: status scheduled (the office acted on it while the customer was on the
 * phone), numbered req_ac_#### after every Request in db. The portal lists it with the customer's own requests.
 */
export function officeRequestRow(db: Db, draft: OfficeRequestDraft): Request {
  const row: Request = {
    id: nextId('req', db.requests.map(r => r.id)),
    accountId: draft.accountId,
    siteId: draft.siteId,
    kind: draft.kind,
    status: 'scheduled',
    createdVia: draft.createdVia,
    note: draft.note,
  }
  if (draft.workOrderId) row.workOrderId = draft.workOrderId
  return row
}

interface StatusPlan {
  account: BillingAccount
  items: ServiceItem[]
  change: StatusChange
  nextDb: Db
  request?: Request
}

/** The writes a status change makes, computed from the current state without committing. */
function planStatusChange(s: RootState, accountId: string, status: BillingAccount['status'], opts: ChangeAccountStatusOptions = {}): StatusPlan {
  const db = s.db
  const current = requireAccount(db, accountId)
  const effectiveFrom = opts.effectiveFrom ?? today()
  if (status === 'hold' && opts.resumeOn && opts.resumeOn <= effectiveFrom) throw new EngineError('A hold must resume after it starts')
  const account: BillingAccount = { ...current, status }
  const siteIds = db.sites.filter(site => site.accountId === accountId).map(site => site.id)
  const itemStatus = itemStatusForAccountStatus(status)
  const items = db.serviceItems
    .filter(si => siteIds.includes(si.siteId) && si.status !== 'ended' && si.status !== itemStatus)
    .map((si): ServiceItem => ({ ...si, status: itemStatus }))
  const kind: StatusChange['kind'] =
    status === 'hold' ? 'hold' : status === 'suspended' ? 'suspend' : current.status === 'hold' ? 'resume' : 'reinstate'
  const change: StatusChange = {
    id: nextId('sc', s.accountEdits.statusChanges.map(c => c.id)),
    accountId,
    kind,
    from: current.status,
    to: status,
    effectiveFrom,
    resumeOn: status === 'hold' ? opts.resumeOn : undefined,
    reason: status === 'suspended' ? opts.reason : undefined,
    note: opts.note,
    itemIds: items.map(i => i.id),
    at: today(),
  }
  // A hold the office takes by phone becomes the vacationHold Request the portal shows. One the portal filed is not
  // written again.
  let request: Request | undefined
  if (status === 'hold' && !opts.requestId) {
    const window = opts.resumeOn ? `from ${effectiveFrom}, resume ${opts.resumeOn}` : `from ${effectiveFrom}, no resume date`
    request = officeRequestRow(db, {
      kind: 'vacationHold',
      accountId,
      siteId: opts.siteId ?? siteIds[0] ?? '',
      createdVia: opts.createdVia ?? 'phone',
      note: opts.note ? `Vacation hold ${window}. ${opts.note}` : `Vacation hold ${window}`,
    })
  }
  return {
    account, items, change, request,
    nextDb: withRows(db, { accounts: [account], serviceItems: items, requests: request ? [request] : undefined }),
  }
}

export const createAccountSlice: SliceCreator<AccountSlice> = (_set, get) => ({
  ...initialAccountData(),

  changeServiceItem(args) {
    const db = get().db
    const plan = planServiceChange(args, db)
    // The office's own change files its Request; a change the portal filed (args.requestId) answers that one.
    const request = args.requestId ? undefined : officeRequestRow(db, plan.officeRequest)
    const workOrder: WorkOrder = request ? { ...plan.workOrder, requestId: request.id } : plan.workOrder
    const rows = {
      serviceItems: plan.oldItem ? [plan.oldItem, plan.newItem] : [plan.newItem],
      containers: [plan.container],
      workOrders: [workOrder],
      requests: request ? [request] : undefined,
    }
    get().mutateDb(d => withRows(d, rows))
    return { ...plan, workOrder, request, nextDb: withRows(plan.nextDb, { workOrders: [workOrder], requests: rows.requests }) }
  },

  recordOfficeRequest(draft) {
    const row = officeRequestRow(get().db, draft)
    get().mutateDb(d => withRows(d, { requests: [row] }))
    return row
  },

  takePayment(args) {
    const db = get().db
    requireAccount(db, args.accountId)
    if (!Number.isInteger(args.cents) || args.cents <= 0) throw new EngineError('Payment cents must be a positive whole number')
    const payment: Payment = {
      id: nextId('pay', db.payments.map(p => p.id)),
      accountId: args.accountId,
      method: args.method,
      cents: args.cents,
      receivedAt: args.receivedAt ?? today(),
      status: args.method === 'card' || args.method === 'ach' ? 'pending' : 'settled',
    }
    if (args.method === 'card' && args.processorBatchId) payment.processorBatchId = args.processorBatchId
    // Validate the allocation against a shadow db that already holds the payment; nothing is written on failure.
    const shadow = withRows(db, { payments: [payment] })
    const allocations = args.allocations
      ? allocateChecked({ sourceType: 'payment', sourceId: payment.id, invoiceIds: args.allocations.invoiceIds, cents: args.allocations.cents }, shadow)
      : []
    const entries: Omit<LedgerWrite, 'id' | 'at'>[] = [{ accountId: args.accountId, kind: 'payment', sourceId: payment.id, cents: payment.cents }]
    if (allocations.length) entries.push({ accountId: args.accountId, kind: 'allocation', sourceId: payment.id, cents: sumCents(allocations) })
    get().mutateDb(d => withRows(d, { payments: [payment], allocations }), s => withLedger(s, entries))
    return payment
  },

  issueCreditMemo(args) {
    const db = get().db
    requireAccount(db, args.accountId)
    if (!Number.isInteger(args.cents) || args.cents <= 0) throw new EngineError('Credit cents must be a positive whole number')
    const memo: CreditMemo = {
      id: nextId('cm', db.creditMemos.map(m => m.id)),
      accountId: args.accountId,
      invoiceId: args.invoiceId,
      cents: args.cents,
      reason: args.note ? `${args.reason}: ${args.note}` : args.reason,
      by: args.by ?? 'office',
      at: today(),
    }
    const shadow = withRows(db, { creditMemos: [memo] })
    const allocations = args.invoiceId
      ? allocateChecked({ sourceType: 'creditMemo', sourceId: memo.id, invoiceIds: [args.invoiceId], cents: [args.cents] }, shadow)
      : []
    const entries: Omit<LedgerWrite, 'id' | 'at'>[] = [{ accountId: args.accountId, kind: 'creditMemo', sourceId: memo.id, cents: memo.cents }]
    if (allocations.length) entries.push({ accountId: args.accountId, kind: 'allocation', sourceId: memo.id, cents: sumCents(allocations) })
    get().mutateDb(d => withRows(d, { creditMemos: [memo], allocations }), s => withLedger(s, entries))
    return memo
  },

  changeAccountStatus(accountId, status, opts) {
    const plan = planStatusChange(get(), accountId, status, opts)
    get().mutateDb(
      db => withRows(db, { accounts: [plan.account], serviceItems: plan.items, requests: plan.request ? [plan.request] : undefined }),
      s => ({ accountEdits: { ...s.accountEdits, statusChanges: [...s.accountEdits.statusChanges, plan.change] } }),
    )
    return plan.account
  },

  reinstateAccount(accountId, opts) {
    const state = get()
    const before = requireAccount(state.db, accountId)
    if (before.status !== 'suspended' && before.status !== 'hold') throw new EngineError(`BillingAccount ${accountId} is ${before.status}, not on hold or suspended`)
    const plan = planStatusChange(state, accountId, statusAfterReinstatement(accountId, state.db), { note: opts?.note })
    const fee = before.status === 'suspended'
      ? buildReinstatementFee({ accountId, sourceId: plan.change.id, id: nextId('chg', state.db.charges.map(c => c.id)) }, plan.nextDb)
      : undefined
    get().mutateDb(
      db => withRows(db, { accounts: [plan.account], serviceItems: plan.items, charges: fee ? [fee] : undefined }),
      s => ({ accountEdits: { ...s.accountEdits, statusChanges: [...s.accountEdits.statusChanges, plan.change] } }),
    )
    return { account: plan.account, statusChange: plan.change, fee }
  },

  proposeReinstatementFee(accountId, sourceId) {
    const { db } = get()
    findAccount(accountId, db)
    const fee = buildReinstatementFee({ accountId, sourceId, id: nextId('chg', db.charges.map(c => c.id)) }, db)
    get().mutateDb(d => withRows(d, { charges: [fee] }))
    return fee
  },

  allocatePayment(args) {
    const db = get().db
    const rows = allocateChecked(args, db)
    const source = args.sourceType === 'payment' ? byId(db.payments, args.sourceId) : byId(db.creditMemos, args.sourceId)
    const accountId = source?.accountId ?? ''
    get().mutateDb(
      d => withRows(d, { allocations: rows }),
      s => withLedger(s, [{ accountId, kind: 'allocation', sourceId: args.sourceId, cents: sumCents(rows) }]),
    )
    return rows
  },

  setWorkOrderStatus(workOrderId, status) {
    const wo = byId(get().db.workOrders, workOrderId)
    if (!wo) throw new EngineError(`WorkOrder ${workOrderId} not found`)
    const next: WorkOrder = { ...wo, status }
    if (status === 'done' && !next.completedAt) next.completedAt = today()
    get().mutateDb(db => withRows(db, { workOrders: [next] }))
    return next
  },

  linkAccountToContract({ accountId, contractId }) {
    const db = get().db
    const account = requireAccount(db, accountId)
    const contract = byId(db.contracts, contractId)
    if (!contract) throw new EngineError(`Contract ${contractId} not found`)
    if (contract.accountId !== accountId) throw new EngineError(`Contract ${contractId} belongs to ${contract.accountId}, not ${accountId}`)
    if (account.contractId === contractId) return account
    const next: BillingAccount = { ...account, contractId }
    get().mutateDb(d => withRows(d, { accounts: [next] }))
    return next
  },

  saveBillingGroup(draft, id) {
    const plan = planGroupSave(get().db, draft, id)
    if (plan.blocked.length) {
      throw new EngineError(`${plan.blocked.length} ${plan.blocked.length === 1 ? 'member has' : 'members have'} charges from the current run that are not posted yet. Post or cancel the run before changing when this group bills.`)
    }
    get().mutateDb(() => plan.db)
    return plan.group
  },

  deleteBillingGroup(groupId, moveTo) {
    const plan = planRemoveGroup(get().db, groupId, moveTo)
    get().mutateDb(() => plan.db)
    return { moved: plan.moved, bridges: plan.bridges.length }
  },

  addAccountsToBillingGroup(groupId, accountIds) {
    const { db, ...result } = planAddToGroup(get().db, groupId, accountIds)
    if (result.added.length) get().mutateDb(() => db)
    return result
  },

  assignBillingGroup(accountId, groupId) {
    const db = get().db
    requireAccount(db, accountId)
    if (groupId === null) {
      const plan = planTakeOut(db, accountId)
      get().mutateDb(() => plan.db)
      return plan.account
    }
    const plan = planAddToGroup(db, groupId, [accountId])
    if (plan.skipped.length) throw new EngineError(`This account's ${plan.skipped[0].reason}. Post or cancel the run before changing when it bills.`)
    if (plan.added.length) get().mutateDb(() => plan.db)
    return requireAccount(get().db, accountId)
  },

  setInvoiceDelivery(accountId, method) {
    const db = get().db
    const account = requireAccount(db, accountId)
    if (!INVOICE_DELIVERIES.includes(method)) throw new EngineError(`Unknown delivery method ${method}`)
    const group = account.billingGroupId ? db.billingGroups.find(g => g.id === account.billingGroupId) : undefined
    if (group && !group.customerChoice && method !== group.delivery) {
      throw new EngineError(`${group.name} sends every invoice by ${DELIVERY_NAME[group.delivery].toLowerCase()}. Let customers choose on the group to change one account.`)
    }
    if (account.deliveryMethod === method) return account
    const next: BillingAccount = { ...account, deliveryMethod: method }
    get().mutateDb(d => withRows(d, { accounts: [next] }))
    return next
  },

  applyGroupDelivery(groupId) {
    const db = get().db
    const group = db.billingGroups.find(g => g.id === groupId)
    if (!group) throw new EngineError(`Billing group ${groupId} not found`)
    const accounts = membersOf(db, groupId).filter(a => a.deliveryMethod !== group.delivery).map(a => ({ ...a, deliveryMethod: group.delivery }))
    if (accounts.length) get().mutateDb(d => withRows(d, { accounts }))
    return accounts.length
  },

  addAccount(draft) {
    const plan = planAddAccount(draft, get().db)
    get().mutateDb(d => ({
      ...withRows(d, {
        accounts: [plan.account],
        serviceItems: plan.item ? [plan.item] : undefined,
        containers: plan.container ? [plan.container] : undefined,
        workOrders: plan.workOrder ? [plan.workOrder] : undefined,
      }),
      // Party and Site have no withRows key (the account surface never created them until now), so they append here.
      parties: [...d.parties, plan.party],
      sites: [...d.sites, plan.site],
    }))
    return plan
  },

  closeAccount(accountId, opts = {}) {
    const plan = planRemoveAccount(get().db, accountId, { effectiveFrom: opts.effectiveFrom })
    const { account, items, recovery, effectiveFrom } = plan.closes
    const change: StatusChange = {
      id: nextId('sc', get().accountEdits.statusChanges.map(c => c.id)),
      accountId,
      kind: 'suspend',
      from: requireAccount(get().db, accountId).status,
      to: 'suspended',
      effectiveFrom,
      reason: 'customerRequest',
      note: opts.note ? `Account closed. ${opts.note}` : 'Account closed',
      itemIds: items.map(i => i.id),
      at: today(),
    }
    get().mutateDb(
      d => withRows(d, { accounts: [account], serviceItems: items, workOrders: recovery ? [recovery] : undefined }),
      s => ({ accountEdits: { ...s.accountEdits, statusChanges: [...s.accountEdits.statusChanges, change] } }),
    )
    return plan
  },

  deleteAccount(accountId) {
    const plan = planRemoveAccount(get().db, accountId)
    if (!plan.canDelete) {
      throw new EngineError(`${plan.name} carries ${plan.blockers.join(', ')}, so it cannot be deleted. Close the account instead.`)
    }
    const { siteIds, itemIds, containerIds, workOrderIds, requestIds, partyIds } = plan.deletes
    const gone = (ids: string[]) => new Set(ids)
    const [sites, items, containers, workOrders, requests, parties] =
      [gone(siteIds), gone(itemIds), gone(containerIds), gone(workOrderIds), gone(requestIds), gone(partyIds)]
    get().mutateDb(d => ({
      ...d,
      accounts: d.accounts.filter(a => a.id !== accountId),
      sites: d.sites.filter(s => !sites.has(s.id)),
      serviceItems: d.serviceItems.filter(i => !items.has(i.id)),
      containers: d.containers.filter(c => !containers.has(c.id)),
      workOrders: d.workOrders.filter(w => !workOrders.has(w.id)),
      requests: d.requests.filter(r => !requests.has(r.id)),
      parties: d.parties.filter(p => !parties.has(p.id)),
    }))
    return plan
  },
})
