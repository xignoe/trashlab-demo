// Box 6.0a and 6.0b: saveContractOverride and setContractEscalator never write into a Contract whose
// termEnd is before the date of the write, and neither ever writes BillingAccount.
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { resolvePrice } from './engine';
import { TODAY } from './dates';
import { lapsedContractFor, linkAccountToContract, writableContractFor } from './contracts';

const state = () => useStore.getState();

beforeEach(() => state().reset());

describe('writableContractFor', () => {
  it('picks the in-force contract, and nothing for an account whose only contract has ended', () => {
    expect(writableContractFor(state(), 'acct_bakery', TODAY)?.id).toBe('contract_bakery');
    expect(writableContractFor(state(), 'acct_fl_003', TODAY)?.id).toBe('contract_fl_003');
    expect(writableContractFor(state(), 'acct_fl_004', TODAY)).toBeUndefined();
    expect(lapsedContractFor(state(), 'acct_fl_004', TODAY)?.id).toBe('contract_fl_004');
    expect(writableContractFor(state(), 'acct_fl_005', TODAY)).toBeUndefined();
    expect(lapsedContractFor(state(), 'acct_fl_005', TODAY)).toBeUndefined();
  });

  it('a write on the last day of the term still lands on that contract', () => {
    expect(writableContractFor(state(), 'acct_fl_004', '2026-08-31')?.id).toBe('contract_fl_004');
  });
});

describe('saveContractOverride (6.0a, 6.0b)', () => {
  it('never writes a lapsed contract: acct_fl_004 gets contract_acct_fl_004_20260910 and contract_fl_004 is untouched', () => {
    const lapsed = state().contracts.find((c) => c.id === 'contract_fl_004')!;
    const accountsBefore = state().accounts;
    const c = state().saveContractOverride({ accountId: 'acct_fl_004', catalogId: 'cat_fl_3yd', frequency: '2x', priceCents: 20900, reason: 'relationship save', pctBelowRateCard: 5 });

    expect(c).toEqual({
      id: 'contract_acct_fl_004_20260910',
      accountId: 'acct_fl_004',
      termStart: '2026-09-10',
      termEnd: '2027-09-10',
      renewalNoticeDays: 60,
      overrides: [{ catalogId: 'cat_fl_3yd', frequency: '2x', priceCents: 20900, reason: 'relationship save', pctBelowRateCard: 5 }],
    });
    // The lapsed row is the very same object, not a rewritten copy.
    expect(state().contracts.find((cc) => cc.id === 'contract_fl_004')).toBe(lapsed);
    expect(lapsed.overrides).toHaveLength(1);
    // BillingAccount is not pricing's to write: the accounts table is the same array, and contractId still names the lapsed contract.
    expect(state().accounts).toBe(accountsBefore);
    expect(state().accounts.find((a) => a.id === 'acct_fl_004')!.contractId).toBe('contract_fl_004');
    // resolvePrice finds the new contract through Contract.accountId anyway.
    expect(resolvePrice({ catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', accountId: 'acct_fl_004', onDate: TODAY })).toEqual({
      priceCents: 20900, contractId: 'contract_acct_fl_004_20260910', ruleWon: 'contractOverride',
    });
  });

  it('a second save the same day replaces the override inside the new contract instead of stacking', () => {
    state().saveContractOverride({ accountId: 'acct_fl_004', catalogId: 'cat_fl_3yd', frequency: '2x', priceCents: 20900, reason: 'relationship save', pctBelowRateCard: 5 });
    const c = state().saveContractOverride({ accountId: 'acct_fl_004', catalogId: 'cat_fl_3yd', frequency: '2x', priceCents: 20500, reason: 'relationship save', pctBelowRateCard: 6.8 });
    expect(c.id).toBe('contract_acct_fl_004_20260910');
    expect(c.overrides).toEqual([{ catalogId: 'cat_fl_3yd', frequency: '2x', priceCents: 20500, reason: 'relationship save', pctBelowRateCard: 6.8 }]);
    expect(state().contracts.filter((cc) => cc.accountId === 'acct_fl_004')).toHaveLength(2);
  });

  it('an in-force contract is still appended to, and accounts are never written', () => {
    const accountsBefore = state().accounts;
    const c = state().saveContractOverride({ accountId: 'acct_fl_001', catalogId: 'cat_fl_3yd', frequency: '2x', priceCents: 20500, reason: 'renewal match', pctBelowRateCard: 6.8 });
    expect(c.id).toBe('contract_fl_001');
    expect(c.overrides).toHaveLength(2);
    expect(state().accounts).toBe(accountsBefore);
  });
});

describe('setContractEscalator (6.0a, 6.4)', () => {
  it('writes the escalator on an in-force contract without an escalator, replacing the row', () => {
    const before = state().contracts.find((c) => c.id === 'contract_fl_003')!;
    const c = state().setContractEscalator({ accountId: 'acct_fl_003', escalator: { kind: 'fixedPct', pct: 6, anniversary: '2027-01-01' } });
    expect(c.id).toBe('contract_fl_003');
    expect(c.escalator).toEqual({ kind: 'fixedPct', pct: 6, anniversary: '2027-01-01' });
    expect(c.overrides).toBe(before.overrides);
    expect(before.escalator).toBeUndefined(); // the old row object was not mutated
    expect(state().contracts.find((cc) => cc.id === 'contract_fl_003')).toBe(c);
  });

  it('never writes a lapsed contract: acct_fl_004 gets a new one year contract carrying the escalator', () => {
    const lapsed = state().contracts.find((c) => c.id === 'contract_fl_004')!;
    const accountsBefore = state().accounts;
    const c = state().setContractEscalator({ accountId: 'acct_fl_004', escalator: { kind: 'fixedPct', pct: 4, anniversary: '2027-09-11' } });
    expect(c).toEqual({
      id: 'contract_acct_fl_004_20260910',
      accountId: 'acct_fl_004',
      termStart: '2026-09-10',
      termEnd: '2027-09-10',
      renewalNoticeDays: 60,
      overrides: [],
      escalator: { kind: 'fixedPct', pct: 4, anniversary: '2027-09-11' },
    });
    expect(state().contracts.find((cc) => cc.id === 'contract_fl_004')).toBe(lapsed);
    expect(state().accounts).toBe(accountsBefore);
  });

  it('refuses to overwrite an escalator that is already scheduled', () => {
    expect(() => state().setContractEscalator({ accountId: 'acct_bakery', escalator: { kind: 'fixedPct', pct: 6, anniversary: '2027-01-01' } })).toThrow(/already has a 4% escalator/);
    expect(state().contracts.find((c) => c.id === 'contract_bakery')!.escalator).toEqual({ kind: 'fixedPct', pct: 4, anniversary: '2027-01-01' });
  });

  it('rejects a zero or negative pct', () => {
    expect(() => state().setContractEscalator({ accountId: 'acct_fl_003', escalator: { kind: 'fixedPct', pct: 0, anniversary: '2027-01-01' } })).toThrow(RangeError);
  });
});

describe('linkAccountToContract (6.0b)', () => {
  it('describes the link and does not apply it', () => {
    const accountsBefore = state().accounts;
    expect(linkAccountToContract({ accountId: 'acct_fl_004', contractId: 'contract_acct_fl_004_20260910' }, state())).toEqual({
      accountId: 'acct_fl_004', field: 'contractId', from: 'contract_fl_004', to: 'contract_acct_fl_004_20260910', applied: false, owner: 'storefront and account',
    });
    expect(state().accounts).toBe(accountsBefore);
  });
});
