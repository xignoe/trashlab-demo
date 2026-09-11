// Scenario check for checklist 5.10, driven through the store the way the Quote workbench drives it:
// match "88 Commerce Way", price cat_fl_3yd 2x, quote $198 against the $220 ratebook, save.
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { resolvePrice } from './engine';
import { TODAY } from './dates';
import {
  addressSuggestions, contractForWrite, exceptionSummary, frequenciesFor, lastOverrideFor, lineDefaultsFor, listPriceFor, matchAddress, planSave, reasonText,
} from '../lib/quote';

const state = () => useStore.getState();

beforeEach(() => state().reset());

describe('address matching', () => {
  it('88 Commerce Way matches Sunrise Bakery, its site, zone, and the open commercial request', () => {
    const m = matchAddress(state(), '88 commerce way');
    expect(m.site?.id).toBe('site_bakery');
    expect(m.account?.id).toBe('acct_bakery');
    expect(m.accountName).toBe('Sunrise Bakery');
    expect(m.zoneId).toBe('zone_open');
    expect(m.zoneSource).toBe('site');
    expect(m.request?.id).toBe('quote_bakery_request');
    expect(lineDefaultsFor(state(), m)).toEqual({ catalogId: 'cat_fl_3yd', frequency: '2x', qty: 1 });
  });

  it('suggests seed sites by address or account name', () => {
    expect(addressSuggestions(state(), '88 Com')[0]).toMatchObject({ siteId: 'site_bakery', accountName: 'Sunrise Bakery', requestId: 'quote_bakery_request' });
    expect(addressSuggestions(state(), 'hale').map((s) => s.siteId)).toEqual(['site_hale_1', 'site_hale_2']);
  });

  it('unknown addresses fall back by text and match no account', () => {
    expect(matchAddress(state(), '17 Ridge Rd')).toMatchObject({ zoneId: 'zone_boundary', zoneSource: 'addressText', account: undefined, request: undefined });
    expect(matchAddress(state(), '9 Franchise Blvd').zoneId).toBe('zone_franchise');
    expect(matchAddress(state(), '1 Nowhere St')).toMatchObject({ zoneId: 'zone_open', zoneSource: 'default' });
  });
});

describe('list price and frequencies', () => {
  it('limits frequencies to published RateVersions and ignores drafts', () => {
    expect(frequenciesFor(state().rateVersions, 'cat_fl_3yd')).toEqual(['weekly', '2x']);
    expect(frequenciesFor(state().rateVersions, 'cat_ro_20yd')).toEqual(['onCall']);
    state().createDraftRateVersion({ catalogId: 'cat_fl_3yd', frequency: '3x', priceCents: 30000, effectiveFrom: '2026-10-01' });
    expect(frequenciesFor(state().rateVersions, 'cat_fl_3yd')).toEqual(['weekly', '2x']);
  });

  it('bakery lists at the $198 contract override with the $220 ratebook beside it', () => {
    const lp = listPriceFor(state(), { catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', accountId: 'acct_bakery', onDate: TODAY });
    expect(lp.list).toEqual({ ok: true, result: { priceCents: 19800, contractId: 'contract_bakery', ruleWon: 'contractOverride' } });
    expect(lp.ratebook).toEqual({ ok: true, result: { priceCents: 22000, rateVersionId: 'rv_fl_3yd_2x', ruleWon: 'standardRate' } });
    expect(lp.existing).toMatchObject({ inForce: true, override: { priceCents: 19800, reason: 'competitive match' } });
  });

  it('a lapsed contract override is reported but not in force', () => {
    const lp = listPriceFor(state(), { catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', accountId: 'acct_fl_004', onDate: TODAY });
    expect(lp.list).toMatchObject({ ok: true, result: { priceCents: 22000, ruleWon: 'standardRate' } });
    expect(lp.existing).toMatchObject({ inForce: false, contract: { id: 'contract_fl_004' } });
  });

  it('an item with no published rate is an outcome, not a crash', () => {
    const lp = listPriceFor(state(), { catalogId: 'cat_fl_2yd', frequency: '3x', zoneId: 'zone_open', onDate: TODAY });
    expect(lp.ratebook).toEqual({ ok: false, error: 'No published rate for cat_fl_2yd' });
  });
});

describe('exception line', () => {
  it('reads the checklist strings', () => {
    expect(exceptionSummary(22000, 19800, 1)).toMatchObject({ kind: 'below', pct: 10, annualCents: 26400, text: '10% below ratebook, est. $264/yr' });
    expect(exceptionSummary(22000, 19800, 2).annualCents).toBe(52800);
    expect(exceptionSummary(22000, 22000, 1).text).toBe('At ratebook');
    expect(exceptionSummary(22000, 23000, 1).text).toBe('4.5% above ratebook');
    expect(exceptionSummary(22000, 20500, 1).text).toBe('6.8% below ratebook, est. $180/yr');
  });
});

describe('save (5.9, 5.10)', () => {
  const bakeryPlan = (reason: '' | 'competitive match' = 'competitive match') => {
    const m = matchAddress(state(), '88 Commerce Way');
    return planSave({
      state: state(), match: m, catalogId: 'cat_fl_3yd', frequency: '2x', qty: 1, quotedCents: 19800, ratebookCents: 22000, reason, note: '', onDate: TODAY, newContractId: 'unused',
    });
  };

  it('Save is disabled until a reason is chosen when below the ratebook', () => {
    const plan = bakeryPlan('');
    expect(plan.canSave).toBe(false);
    expect(plan.blockers).toContain('Choose a reason for pricing below the ratebook');
  });

  it('prices quote_bakery_request and appends the override with pctBelowRateCard 10, creating no Quote', () => {
    const quotesBefore = state().quotes.length;
    const plan = bakeryPlan();
    expect(plan.canSave).toBe(true);
    expect(plan.priceRequest).toEqual({ quoteId: 'quote_bakery_request', line: { catalogId: 'cat_fl_3yd', qty: 1, frequency: '2x', priceCents: 19800 } });
    expect(plan.override).toEqual({ accountId: 'acct_bakery', catalogId: 'cat_fl_3yd', frequency: '2x', priceCents: 19800, reason: 'competitive match', pctBelowRateCard: 10 });

    const quote = state().priceCommercialRequest({ quoteId: plan.priceRequest!.quoteId, lines: [plan.priceRequest!.line] });
    const contract = state().saveContractOverride(plan.override!);

    expect(state().quotes).toHaveLength(quotesBefore);
    expect(quote).toMatchObject({ id: 'quote_bakery_request', kind: 'commercialRequest', status: 'draft', createdVia: 'storefront', recurringCents: 19800 });
    expect(quote.lines).toEqual([{ catalogId: 'cat_fl_3yd', qty: 1, frequency: '2x', priceCents: 19800 }]);
    expect(state().quotes.find((q) => q.id === 'quote_bakery_request')).toBe(quote);

    expect(contract.id).toBe('contract_bakery');
    expect(contract.overrides).toHaveLength(3);
    expect(lastOverrideFor(contract, 'cat_fl_3yd', '2x')).toEqual({ catalogId: 'cat_fl_3yd', frequency: '2x', priceCents: 19800, reason: 'competitive match', pctBelowRateCard: 10 });
    expect(resolvePrice({ catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', accountId: 'acct_bakery', onDate: TODAY })).toMatchObject({ priceCents: 19800, contractId: 'contract_bakery' });
  });

  it('a new lower quote becomes the override resolvePrice uses, and the confirmation reads the last row', () => {
    const m = matchAddress(state(), '88 Commerce Way');
    const plan = planSave({ state: state(), match: m, catalogId: 'cat_fl_3yd', frequency: '2x', qty: 1, quotedCents: 18700, ratebookCents: 22000, reason: 'other', note: 'matched a competitor invoice', onDate: TODAY, newContractId: 'unused' });
    expect(plan.override?.pctBelowRateCard).toBe(15);
    expect(plan.override?.reason).toBe('other: matched a competitor invoice');
    const contract = state().saveContractOverride(plan.override!);
    expect(contract.overrides[0].priceCents).toBe(19800);
    expect(lastOverrideFor(contract, 'cat_fl_3yd', '2x')?.priceCents).toBe(18700);
    expect(resolvePrice({ catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', accountId: 'acct_bakery', onDate: TODAY }).priceCents).toBe(18700);
  });

  it('an account with no contract gets a new one-year contract', () => {
    const m = matchAddress(state(), state().sites.find((s) => s.accountId === 'acct_fl_005')!.address);
    expect(contractForWrite(state(), 'acct_fl_005')).toBeUndefined();
    const plan = planSave({ state: state(), match: m, catalogId: 'cat_fl_2yd', frequency: 'weekly', qty: 1, quotedCents: 15000, ratebookCents: 16000, reason: 'route density', note: '', onDate: TODAY, newContractId: 'contract_acct_fl_005_20260910' });
    expect(plan.canSave).toBe(true);
    expect(plan.priceRequest).toBeUndefined();
    const contract = state().saveContractOverride(plan.override!);
    expect(contract).toMatchObject({ id: 'contract_acct_fl_005_20260910', termStart: TODAY, termEnd: '2027-09-10' });
    expect(lastOverrideFor(contract, 'cat_fl_2yd', 'weekly')?.pctBelowRateCard).toBe(6.3);
  });

  it('a lapsed contract is left as history and the override opens a new contract (6.0a)', () => {
    const m = matchAddress(state(), state().sites.find((s) => s.accountId === 'acct_fl_004')!.address);
    const lapsedBefore = state().contracts.find((c) => c.id === 'contract_fl_004');
    const plan = planSave({ state: state(), match: m, catalogId: 'cat_fl_3yd', frequency: '2x', qty: 1, quotedCents: 20000, ratebookCents: 22000, reason: 'relationship save', note: '', onDate: TODAY, newContractId: 'contract_acct_fl_004_20260910' });
    expect(plan.canSave).toBe(true);
    expect(plan.blockers).toEqual([]);
    expect(contractForWrite(state(), 'acct_fl_004', TODAY)).toBeUndefined();
    expect(plan.writes.join(' ')).toContain('Create contract_acct_fl_004_20260910');
    expect(plan.notes.join(' ')).toContain('contract_fl_004 ended 2026-08-31');

    const contract = state().saveContractOverride(plan.override!);
    expect(contract).toMatchObject({ id: 'contract_acct_fl_004_20260910', accountId: 'acct_fl_004', termStart: TODAY, termEnd: '2027-09-10', renewalNoticeDays: 60 });
    expect(state().contracts.find((c) => c.id === 'contract_fl_004')).toBe(lapsedBefore);
    expect(resolvePrice({ catalogId: 'cat_fl_3yd', frequency: '2x', zoneId: 'zone_open', accountId: 'acct_fl_004', onDate: TODAY })).toMatchObject({ priceCents: 20000, contractId: 'contract_acct_fl_004_20260910', ruleWon: 'contractOverride' });
  });

  it('unknown addresses cannot save, and at-ratebook with no request has nothing to write', () => {
    const unknown = planSave({ state: state(), match: matchAddress(state(), '17 Ridge Rd'), catalogId: 'cat_fl_3yd', frequency: '2x', qty: 1, quotedCents: 22000, ratebookCents: 22000, reason: '', note: '', onDate: TODAY, newContractId: 'unused' });
    expect(unknown.canSave).toBe(false);
    const fl5 = matchAddress(state(), state().sites.find((s) => s.accountId === 'acct_fl_005')!.address);
    const atList = planSave({ state: state(), match: fl5, catalogId: 'cat_fl_2yd', frequency: 'weekly', qty: 1, quotedCents: 16000, ratebookCents: 16000, reason: '', note: '', onDate: TODAY, newContractId: 'unused' });
    expect(atList.canSave).toBe(false);
  });

  it('reasonText carries the note for other', () => {
    expect(reasonText('competitive match', 'ignored')).toBe('competitive match');
    expect(reasonText('other', '  flyer  ')).toBe('other: flyer');
  });

  it('priceCommercialRequest refuses a residentialSignup', () => {
    expect(() => state().priceCommercialRequest({ quoteId: 'quote_held_ridge', lines: [] })).toThrow(/only prices a commercialRequest/);
  });
});
