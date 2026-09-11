// Phase 5: the agent drawer's transcript. The drawer itself is React; everything it shows comes from
// runIntake and agentContextFor, which are pure and tested here in the node environment.
import { beforeEach, describe, expect, it } from 'vitest';
import { agentContextFor, OFFER_SCREENS, type AgentUi } from '../../ui/agentView';
import { runIntake, type TranscriptArgs } from '../agent';
import { dayName, formatDateTime, formatDay } from '../clock';
import { COMMERCIAL_NO_PRICE_REASON } from '../commercial';
import { formatCents } from '../money';
import { buildOffer } from '../offer';
import { matchAddress } from '../serviceability';
import { snapshot, useStore } from '../store';
import { DEFAULT_COMMERCIAL_DRAFT, DEFAULT_SELECTIONS } from '../ui';
// The source text of the files that build the thread, via Vite's ?raw import (no node types needed).
import agentSource from '../agent.ts?raw';
import drawerSource from '../../ui/AgentDrawer.tsx?raw';
import agentViewSource from '../../ui/agentView.ts?raw';

beforeEach(() => useStore.getState().reset());

/** Lines containing a dollar sign followed by a digit: what `grep '\$[0-9]'` would print. */
const dollarLiterals = (source: string) => source.split('\n').filter((line) => /\$[0-9]/.test(line));
const base = { business: false, cartCatalogId: 'cat_res_96', extraCart: false, recycling: false };
const text = (args: TranscriptArgs) => runIntake(args).messages.map((m) => m.text).join('\n');

/** The Offer the price panel shows for a seed address: useOfferView's exact call. */
function panelOffer(addressId: string, selections: Partial<typeof DEFAULT_SELECTIONS> = {}) {
  const match = matchAddress(addressId);
  return buildOffer({ zoneId: match.zone.id, routeId: match.route?.id, ...DEFAULT_SELECTIONS, ...selections });
}

function ui(patch: Partial<AgentUi>): AgentUi {
  return {
    screen: 'offer',
    query: '',
    addressId: undefined,
    business: false,
    selections: DEFAULT_SELECTIONS,
    statusQuoteId: undefined,
    commercialDraft: DEFAULT_COMMERCIAL_DRAFT,
    ...patch,
  };
}

describe('no dollar amount is typed into the agent', () => {
  it('agent.ts contains no "$" followed by a digit', () => {
    expect(agentSource).toContain('export function runIntake');
    expect(dollarLiterals(agentSource)).toEqual([]);
  });

  it('the drawer and its context builder contain no "$" followed by a digit either', () => {
    expect(drawerSource).toContain('export function AgentDrawer');
    expect(agentViewSource).toContain('export function agentContextFor');
    expect(dollarLiterals(drawerSource)).toEqual([]);
    expect(dollarLiterals(agentViewSource)).toEqual([]);
  });
});

describe('open branch quotes the price panel', () => {
  it('reuses the Offer object the price panel was built from and quotes its three totals', () => {
    const offer = panelOffer('addr_open_single');
    const run = runIntake({ ...base, query: 'addr_open_single', offer });
    expect(run.offer).toBe(offer);
    const all = run.messages.map((m) => m.text).join('\n');
    expect(all).toContain(`${formatCents(offer.dueTodayCents)} due today`);
    expect(all).toContain(`then ${formatCents(offer.recurringQuarterlyCents)} every quarter`);
    expect(all).toContain(`about ${formatCents(offer.recurringMonthlyEquivalentCents)} a month`);
    expect(all).toContain(`We can start ${formatDay(offer.startDateOptions[0])} or ${formatDay(offer.startDateOptions[1])}.`);
    const last = run.messages.at(-1)!;
    expect(last.from).toBe('agent');
    expect(last.text).toMatch(/hosted payment link/);
    expect(last.text).toMatch(/consent/);
  });

  it('ignores a page offer for a different zone or route and prices the matched address itself', () => {
    const boundary = panelOffer('addr_boundary');
    const run = runIntake({ ...base, query: 'addr_open_single', offer: boundary });
    expect(run.offer).not.toBe(boundary);
    expect(run.offer?.zoneId).toBe('zone_open');
  });

  it('lists the rules that fired, read from the offer object', () => {
    const offer = panelOffer('addr_open_recycling', { recycling: true });
    const run = runIntake({ ...base, recycling: true, query: 'addr_open_recycling', offer });
    const details = run.rules.map((r) => `${r.rule}: ${r.detail}`);
    expect(details).toContain(`Zone match: addr_open_recycling in ${offer.rules.zoneId}, open`);
    expect(details).toContain(`Route day: ${offer.rules.routeId}, ${dayName(offer.rules.routeDay)}`);
    for (const v of offer.rules.rateVersions) {
      expect(details).toContain(`Rate version: ${v.catalogId}: ${v.rateVersionId}, ruleWon ${v.ruleWon}`);
    }
    expect(offer.rules.rateVersions).toHaveLength(2);
    expect(details).toContain(`Fee rules: ${offer.rules.feeRuleIds.join(', ')}`);
    expect(offer.rules.feeRuleIds).toEqual(expect.arrayContaining(['fee_fuel_7pct', 'fee_env_1']));
    expect(details).toContain(`Tax rule: ${offer.rules.taxRuleId}`);
  });
});

describe('boundary, franchise, and commercial branches', () => {
  it('boundary ends with the handoff card built from the address reason and the clock', () => {
    const run = runIntake({ ...base, query: 'addr_boundary' });
    const reason = matchAddress('addr_boundary').boundaryReason;
    expect(reason).toBe('private road access');
    expect(run.branch).toBe('boundary');
    expect(run.messages.at(-1)).toMatchObject({ from: 'handoff' });
    expect(run.messages.at(-1)?.text).toMatch(new RegExp(`^I can't confirm ${reason}, a person will text you by .+\\.$`));
    expect(run.rules.map((r) => r.rule)).toContain('Hold');
  });

  it('a saved held quote uses its recorded deadline', () => {
    const quote = snapshot().quotes.quote_held_ridge;
    const ctx = agentContextFor(ui({ screen: 'held', statusQuoteId: 'quote_held_ridge' }), snapshot());
    const run = runIntake(ctx.args!);
    expect(run.messages.at(-1)?.text).toBe(`I can't confirm private road access, a person will text you by ${formatDateTime(quote.holdDeadline!)}.`);
    expect(run.offer?.dueTodayCents).toBe(quote.dueTodayCents);
    expect(ctx.note).toContain('quote_held_ridge');
  });

  it('franchise names the holder and never shows a price', () => {
    const run = runIntake({ ...base, query: 'addr_franchise' });
    const all = run.messages.map((m) => m.text).join('\n');
    expect(run.branch).toBe('franchise');
    expect(all).toContain('Southeast Sanitation');
    // Phase 6 copy rule: say the holder's name at most once per message.
    for (const m of run.messages) expect(m.text.split('Southeast Sanitation').length - 1).toBeLessThanOrEqual(1);
    expect(all).not.toMatch(/\$\d/);
    expect(run.offer).toBeUndefined();
    expect(run.messages.some((m) => m.from === 'handoff')).toBe(false);
  });

  it('commercial asks for container, material, frequency, and access, gives the reason, and hands off', () => {
    const run = runIntake({ ...base, business: true, query: 'addr_commercial', commercial: { containerCatalogId: 'cat_fl_2yd', material: 'wood waste', frequency: '3x', accessNotes: 'Alley behind the shop' } });
    const agent = run.messages.filter((m) => m.from === 'agent').map((m) => m.text).join('\n');
    expect(agent).toMatch(/container size/);
    expect(agent).toMatch(/What goes in it/);
    expect(agent).toMatch(/How often/);
    expect(agent).toMatch(/access/);
    expect(agent).toContain(COMMERCIAL_NO_PRICE_REASON);
    expect(run.messages.at(-1)?.from).toBe('handoff');
    expect(run.messages.map((m) => m.text).join('\n')).not.toMatch(/\$\d/);
    expect(run.messages.map((m) => m.text)).toContain('Alley behind the shop');
  });
});

describe('the drawer follows the screen and the configurator', () => {
  it('changing an option changes the transcript', () => {
    const tables = snapshot();
    const before = runIntake(agentContextFor(ui({ addressId: 'addr_open_single' }), tables).args!);
    const withRecycling = { ...DEFAULT_SELECTIONS, recycling: true };
    const after = runIntake(agentContextFor(ui({ addressId: 'addr_open_single', selections: withRecycling }), tables).args!);
    const recyclingOffer = panelOffer('addr_open_single', { recycling: true });
    const recyclingLine = recyclingOffer.lines.find((l) => l.catalogId === 'cat_res_recycling')!;
    expect(before.messages.map((m) => m.text).join('\n')).not.toContain('every other week');
    expect(after.messages.map((m) => m.text).join('\n')).toContain(`every other week at ${formatCents(recyclingLine.monthlyCents)} a month`);
    expect(after.messages.map((m) => m.text).join('\n')).toContain(formatCents(recyclingOffer.dueTodayCents));
    expect(before.offer?.dueTodayCents).not.toBe(after.offer?.dueTodayCents);

    const second = before.offer!.startDateOptions[1];
    const later = runIntake(agentContextFor(ui({ addressId: 'addr_open_single', selections: { ...DEFAULT_SELECTIONS, startDate: second } }), tables).args!);
    expect(later.messages.find((m) => m.from === 'customer' && m.text.endsWith('works.'))?.text).toBe(`${formatDay(second)} works.`);
  });

  it('commercial answers on the form show up as customer replies', () => {
    const draft = { ...DEFAULT_COMMERCIAL_DRAFT, address: '1500 Commerce Way', containerCatalogId: 'cat_fl_3yd', material: 'cardboard', frequency: '2x' as const };
    const all = text(agentContextFor(ui({ screen: 'commercial', business: true, commercialDraft: draft }), snapshot()).args!);
    expect(all).toContain('3 yd works.');
    expect(all).toContain('Cardboard.');
    expect(all).toContain('Twice a week.');
  });

  it('every screen either has a transcript or says why not', () => {
    const tables = snapshot();
    expect(agentContextFor(ui({ screen: 'office' }), tables).empty).toBeTruthy();
    expect(agentContextFor(ui({ screen: 'landing' }), tables).empty).toBeTruthy();
    expect(agentContextFor(ui({ screen: 'landing', query: 'Larkspur' }), tables).args?.query).toBe('Larkspur');
    for (const screen of OFFER_SCREENS) {
      expect(agentContextFor(ui({ screen, addressId: 'addr_open_single' }), tables).args?.query).toBe('addr_open_single');
    }
    expect(agentContextFor(ui({ screen: 'franchise', addressId: 'addr_franchise' }), tables).args?.query).toBe('addr_franchise');
    expect(agentContextFor(ui({ screen: 'notServed', query: '1 Nowhere Rd' }), tables).args?.query).toBe('1 Nowhere Rd');
  });
});
