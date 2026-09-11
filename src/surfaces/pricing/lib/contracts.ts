/**
 * Contract write rules shared by the pricing slice and the quote workbench's save plan (moved from
 * pricing/src/store/contracts.ts), so the screen can say exactly which contract a save will touch. Pure: no store
 * access, no clock.
 *
 * Lapsed contracts (addendum K3, pricing decision 80): pricing never writes into a Contract whose termEnd is before
 * the date of the write. The ended contract stays exactly as it was, as history, and a new override or escalator
 * opens contract_<accountId>_<yyyymmdd> instead.
 *
 * Account link (addendum K4, L): BillingAccount belongs to storefront and account, so pricing never writes
 * BillingAccount.contractId itself. When a save opens a new contract, the pricing slice calls account's
 * linkAccountToContract action (box 3.6). The canonical resolvePrice also finds contracts through Contract.accountId.
 *
 * Override order: the canonical resolvePrice bills the FIRST override on a contract whose catalogId matches and
 * whose frequency is absent or equal (src/store/engine.ts). So a new override is written first, and earlier rows
 * for the same item stay after it as history. overrideInForce reads a contract with that same rule, so the
 * workbench, the slice, and every billing run agree on which row is billed.
 */
import type { BillingAccount, Contract, Frequency } from '../../../types'
import { addYears, dateOnly, yyyymmdd } from './dates'

interface ContractTables {
  accounts: BillingAccount[]
  contracts: Contract[]
}

export type ContractOverride = Contract['overrides'][number]

/** contract_<accountId>_<yyyymmdd>, the id a new contract written on `day` gets (addendum K3). */
export const newContractIdFor = (accountId: string, day: string): string => `contract_${accountId}_${yyyymmdd(day)}`

/** Every contract row that belongs to the account: Contract.accountId, plus the one account.contractId names. */
export function contractsOfAccount(state: ContractTables, accountId: string): Contract[] {
  const account = state.accounts.find(a => a.id === accountId)
  return state.contracts.filter(c => c.accountId === accountId || (account?.contractId !== undefined && c.id === account.contractId))
}

/** True when a write dated `day` may land on the contract: its termEnd is not before that day. */
export const isWritable = (contract: Contract, day: string): boolean => dateOnly(contract.termEnd) >= dateOnly(day)

/**
 * The contract a write dated `day` lands on, or undefined when the write must open a new contract. Among the
 * account's contracts that have not ended: the one created on `day` first (so a same-day correction replaces rather
 * than stacks), then one whose term contains `day`, preferring the contract account.contractId names, then the
 * latest termStart. A contract that has not started yet is writable but only chosen when nothing is in force.
 */
export function writableContractFor(state: ContractTables, accountId: string, day: string): Contract | undefined {
  const d = dateOnly(day)
  const account = state.accounts.find(a => a.id === accountId)
  const open = contractsOfAccount(state, accountId).filter(c => isWritable(c, d))
  if (open.length === 0) return undefined
  const todayId = newContractIdFor(accountId, d)
  const rank = (c: Contract): number[] => [c.id === todayId ? 1 : 0, dateOnly(c.termStart) <= d ? 1 : 0, c.id === account?.contractId ? 1 : 0]
  return [...open].sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    for (let i = 0; i < ra.length; i += 1) if (ra[i] !== rb[i]) return rb[i] - ra[i]
    return dateOnly(b.termStart).localeCompare(dateOnly(a.termStart))
  })[0]
}

/** The contract the account's latest contract ended on, when every contract it has is lapsed on `day`. */
export function lapsedContractFor(state: ContractTables, accountId: string, day: string): Contract | undefined {
  const rows = contractsOfAccount(state, accountId)
  if (rows.length === 0 || rows.some(c => isWritable(c, day))) return undefined
  return [...rows].sort((a, b) => dateOnly(b.termEnd).localeCompare(dateOnly(a.termEnd)))[0]
}

/** A fresh one year contract for the account starting `day`, renewal notice 60 days. */
export function newContract(accountId: string, day: string, fields: Partial<Pick<Contract, 'overrides' | 'escalator'>> = {}): Contract {
  const d = dateOnly(day)
  return {
    id: newContractIdFor(accountId, d),
    accountId,
    termStart: d,
    termEnd: addYears(d, 1),
    renewalNoticeDays: 60,
    overrides: fields.overrides ?? [],
    ...(fields.escalator ? { escalator: fields.escalator } : {}),
  }
}

/** The override the canonical resolvePrice bills on this contract for the item and frequency (first match). */
export function overrideInForce(contract: Contract, catalogId: string, frequency: Frequency): ContractOverride | undefined {
  return contract.overrides.find(o => o.catalogId === catalogId && (o.frequency === undefined || o.frequency === frequency))
}

/**
 * The contract with `override` written. The new row goes first, so the canonical resolvePrice bills it. On a
 * contract created on `day` a row for the same item and frequency is replaced (a same-day correction); on an older
 * contract the earlier rows stay after the new one, as history.
 */
export function contractWithOverride(existing: Contract, override: ContractOverride, accountId: string, day: string): Contract {
  const createdToday = existing.id === newContractIdFor(accountId, day)
  const rest = createdToday
    ? existing.overrides.filter(o => !(o.catalogId === override.catalogId && o.frequency === override.frequency))
    : existing.overrides
  return { ...existing, overrides: [override, ...rest] }
}
