// Contract write rules shared by the store actions and the quote workbench's save plan, so the screen can
// say exactly which contract a save will touch. Pure: no store access, no clock.
//
// Rule (decision 80, box 6.0a): pricing never writes into a Contract whose termEnd is before the date of
// the write. A lapsed contract stays exactly as it was, as history, and a new override or escalator opens
// contract_<accountId>_<yyyymmdd> instead.
//
// Ownership (OWNERSHIP.md, decision 81, box 6.0b): BillingAccount belongs to storefront and account, so
// pricing never sets BillingAccount.contractId. resolvePrice finds contracts through Contract.accountId, and
// linkAccountToContract describes the link the merge should wire without performing it.
import type { BillingAccount, Contract } from '../types';
import { addYears, dateOnly, yyyymmdd } from './dates';

interface ContractTables {
  accounts: BillingAccount[];
  contracts: Contract[];
}

/** contract_<accountId>_<yyyymmdd>, the id a new contract written on `day` gets. */
export const newContractIdFor = (accountId: string, day: string): string => `contract_${accountId}_${yyyymmdd(day)}`;

/** Every contract row that belongs to the account: Contract.accountId, plus the one account.contractId names. */
export function contractsOfAccount(state: ContractTables, accountId: string): Contract[] {
  const account = state.accounts.find((a) => a.id === accountId);
  return state.contracts.filter((c) => c.accountId === accountId || (account?.contractId !== undefined && c.id === account.contractId));
}

/** True when a write dated `day` may land on the contract: its termEnd is not before that day. */
export const isWritable = (contract: Contract, day: string): boolean => dateOnly(contract.termEnd) >= dateOnly(day);

/** The contract a write dated `day` lands on, or undefined when the write must open a new contract.
 *  Among the account's contracts that have not ended: the one created on `day` first (so a same-day
 *  correction replaces rather than stacks), then one whose term contains `day`, preferring the contract
 *  account.contractId names, then the latest termStart. A contract that has not started yet is writable
 *  but only chosen when nothing is in force. */
export function writableContractFor(state: ContractTables, accountId: string, day: string): Contract | undefined {
  const d = dateOnly(day);
  const account = state.accounts.find((a) => a.id === accountId);
  const open = contractsOfAccount(state, accountId).filter((c) => isWritable(c, d));
  if (open.length === 0) return undefined;
  const todayId = newContractIdFor(accountId, d);
  const rank = (c: Contract): number[] => [
    c.id === todayId ? 1 : 0,
    dateOnly(c.termStart) <= d ? 1 : 0,
    c.id === account?.contractId ? 1 : 0,
  ];
  return [...open].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i += 1) if (ra[i] !== rb[i]) return rb[i] - ra[i];
    return dateOnly(b.termStart).localeCompare(dateOnly(a.termStart));
  })[0];
}

/** The contract this account's latest contract ended on, when every contract it has is lapsed on `day`.
 *  Used to say "contract_fl_004 ended 2026-08-31 and stays as history" beside a new contract. */
export function lapsedContractFor(state: ContractTables, accountId: string, day: string): Contract | undefined {
  const rows = contractsOfAccount(state, accountId);
  if (rows.length === 0 || rows.some((c) => isWritable(c, day))) return undefined;
  return [...rows].sort((a, b) => dateOnly(b.termEnd).localeCompare(dateOnly(a.termEnd)))[0];
}

/** A fresh one year contract for the account starting `day`, renewal notice 60 days. */
export function newContract(accountId: string, day: string, fields: Partial<Pick<Contract, 'overrides' | 'escalator'>> = {}): Contract {
  const d = dateOnly(day);
  return {
    id: newContractIdFor(accountId, d),
    accountId,
    termStart: d,
    termEnd: addYears(d, 1),
    renewalNoticeDays: 60,
    overrides: fields.overrides ?? [],
    ...(fields.escalator ? { escalator: fields.escalator } : {}),
  };
}

export interface AccountContractLink {
  accountId: string;
  field: 'contractId';
  from?: string;
  to: string;
  /** Always false on this surface: the change is described, never applied. */
  applied: false;
  owner: 'storefront and account';
}

/** Stub (OWNERSHIP.md: BillingAccount belongs to storefront and account). Returns the change that would
 *  point account.contractId at the contract, without touching the accounts table. Pricing relies on
 *  Contract.accountId for price resolution, so nothing here depends on the link being applied. */
export function linkAccountToContract(
  { accountId, contractId }: { accountId: string; contractId: string },
  state?: Pick<ContractTables, 'accounts'>,
): AccountContractLink {
  const from = state?.accounts.find((a) => a.id === accountId)?.contractId;
  return { accountId, field: 'contractId', ...(from !== undefined ? { from } : {}), to: contractId, applied: false, owner: 'storefront and account' };
}
