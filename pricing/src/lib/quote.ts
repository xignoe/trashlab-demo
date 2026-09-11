// Read-side and planning helpers for the Quote workbench (Phase 5). Pure over the store tables so the page,
// the tests, and the scenario check all agree on what an address matches, what the list price is, how far a
// quote sits from the ratebook, and exactly what Save will write.
import type { BillingAccount, Contract, Frequency, LOB, Quote, RateVersion, ServiceCatalog, Site } from '../types';
import { FREQUENCY_LABEL, resolvePrice, type EngineState, type ResolvePriceResult } from '../store/engine';
import { TODAY, dateOnly, within } from '../store/dates';
import { lapsedContractFor, writableContractFor } from '../store/contracts';
import type { Material } from '../store/costToServe';
import { formatCents, formatCentsCompact, formatPct } from './money';

export interface QuoteState extends EngineState {
  quotes: Quote[];
}

export const FREQUENCY_ORDER: Frequency[] = ['weekly', 'eow', '2x', '3x', 'onCall'];

export const RULE_LABEL: Record<ResolvePriceResult['ruleWon'], string> = {
  contractOverride: 'contract override',
  zoneRate: 'zone rate',
  standardRate: 'standard rate',
  manualException: 'manual exception',
};

/** The workbench quotes containers, not carts: frontload and rolloff, grouped by lob (checklist 5.2). */
export const QUOTABLE_LOBS: LOB[] = ['frontload', 'rolloff'];

const norm = (s: string): string => s.trim().toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ');

export function accountName(state: Pick<QuoteState, 'accounts' | 'parties'>, accountId: string | undefined): string | undefined {
  const account = state.accounts.find((a) => a.id === accountId);
  return account ? state.parties.find((p) => p.id === account.payerPartyId)?.name : undefined;
}

/** A storefront commercialRequest that pricing may still price: draft or held, same address. */
function openRequestAt(quotes: Quote[], address: string): Quote | undefined {
  const key = norm(address);
  if (!key) return undefined;
  return quotes.find((q) => q.kind === 'commercialRequest' && (q.status === 'draft' || q.status === 'held') && norm(q.address) === key);
}

export interface AddressSuggestion {
  key: string;
  address: string;
  siteId?: string;
  accountId?: string;
  accountName?: string;
  zoneId?: string;
  requestId?: string;
}

/** Seed Sites whose address or account name contains the text, address prefix matches first, plus any open
 *  commercialRequest at an address no Site has yet (a prospect the storefront captured). */
export function addressSuggestions(state: QuoteState, text: string, limit = 8): AddressSuggestion[] {
  const q = norm(text);
  const siteRows: (AddressSuggestion & { rank: number })[] = [];
  for (const site of state.sites) {
    const name = accountName(state, site.accountId);
    const addr = norm(site.address);
    const hit = !q || addr.includes(q) || (name !== undefined && norm(name).includes(q));
    if (!hit) continue;
    siteRows.push({
      key: site.id,
      address: site.address,
      siteId: site.id,
      accountId: site.accountId,
      accountName: name,
      zoneId: site.zoneId,
      requestId: openRequestAt(state.quotes, site.address)?.id,
      rank: q && addr.startsWith(q) ? 0 : 1,
    });
  }
  const siteAddresses = new Set(state.sites.map((s) => norm(s.address)));
  const requestRows = state.quotes
    .filter((r) => r.kind === 'commercialRequest' && (r.status === 'draft' || r.status === 'held') && !siteAddresses.has(norm(r.address)))
    .filter((r) => !q || norm(r.address).includes(q))
    .map((r) => ({ key: r.id, address: r.address, zoneId: r.zoneId, requestId: r.id, rank: 1 }));
  return [...siteRows, ...requestRows]
    .sort((a, b) => a.rank - b.rank || Number(Boolean(b.requestId)) - Number(Boolean(a.requestId)))
    .slice(0, limit)
    .map(({ rank: _rank, ...row }) => row);
}

export interface AddressMatch {
  text: string;
  site?: Site;
  account?: BillingAccount;
  accountName?: string;
  /** Open storefront commercialRequest at this address, which Save prices instead of creating a Quote. */
  request?: Quote;
  zoneId: string;
  zoneSource: 'site' | 'request' | 'addressText' | 'default';
}

/** A selected suggestion (siteId) wins; otherwise the typed text must equal a Site address (case, commas and
 *  periods ignored). Unknown addresses fall back to zone_open unless the text contains "Ridge"
 *  (zone_boundary) or "Franchise" (zone_franchise). */
export function matchAddress(state: QuoteState, text: string, siteId?: string): AddressMatch {
  const site = (siteId ? state.sites.find((s) => s.id === siteId) : undefined) ?? state.sites.find((s) => norm(s.address) === norm(text) && norm(text) !== '');
  const account = site ? state.accounts.find((a) => a.id === site.accountId) : undefined;
  const request = openRequestAt(state.quotes, site?.address ?? text);
  const base = { text, site, account, accountName: accountName(state, account?.id), request };
  if (site) return { ...base, zoneId: site.zoneId, zoneSource: 'site' };
  if (request?.zoneId) return { ...base, zoneId: request.zoneId, zoneSource: 'request' };
  const lower = text.toLowerCase();
  if (lower.includes('ridge')) return { ...base, zoneId: 'zone_boundary', zoneSource: 'addressText' };
  if (lower.includes('franchise')) return { ...base, zoneId: 'zone_franchise', zoneSource: 'addressText' };
  return { ...base, zoneId: 'zone_open', zoneSource: 'default' };
}

export function containerOptions(catalog: ServiceCatalog[]): { lob: LOB; items: ServiceCatalog[] }[] {
  return QUOTABLE_LOBS.map((lob) => ({ lob, items: catalog.filter((c) => c.lob === lob) })).filter((g) => g.items.length > 0);
}

/** Frequencies with a published RateVersion for the item, in a fixed order. A published row with no
 *  frequency prices every frequency. Drafts never count. */
export function frequenciesFor(rateVersions: RateVersion[], catalogId: string): Frequency[] {
  const rows = rateVersions.filter((rv) => rv.catalogId === catalogId && rv.status === 'published');
  if (rows.some((rv) => rv.frequency === undefined)) return [...FREQUENCY_ORDER];
  const set = new Set(rows.map((rv) => rv.frequency));
  return FREQUENCY_ORDER.filter((f) => set.has(f));
}

/** Material the container is for when the catalog says so; mixed trash otherwise. */
export function defaultMaterial(item: ServiceCatalog | undefined): Material {
  if (!item) return 'msw';
  if (/wood/i.test(`${item.id} ${item.name}`)) return 'wood';
  if (item.lob === 'rolloff') return 'cAndD';
  return 'msw';
}

export interface LineDefaults {
  catalogId?: string;
  frequency?: Frequency;
  qty?: number;
}

/** What the address already has: the request's first quotable line, else the site's first active quotable
 *  ServiceItem. Used to preselect container, frequency, and qty when an address is chosen. */
export function lineDefaultsFor(state: QuoteState, match: AddressMatch): LineDefaults {
  const quotable = new Set(state.catalog.filter((c) => QUOTABLE_LOBS.includes(c.lob)).map((c) => c.id));
  const reqLine = match.request?.lines.find((l) => quotable.has(l.catalogId));
  if (reqLine) return { catalogId: reqLine.catalogId, frequency: reqLine.frequency, qty: reqLine.qty };
  const item = match.site ? state.serviceItems.find((si) => si.siteId === match.site?.id && si.status === 'active' && quotable.has(si.catalogId)) : undefined;
  if (item) return { catalogId: item.catalogId, frequency: item.frequency, qty: item.qty };
  return {};
}

/** Qty for one item and frequency at the address: request line, else the site's active item, else 1. */
export function qtyFor(state: QuoteState, match: AddressMatch, catalogId: string, frequency: Frequency): number {
  const reqLine = match.request?.lines.find((l) => l.catalogId === catalogId && l.frequency === frequency);
  if (reqLine) return reqLine.qty;
  const item = match.site ? state.serviceItems.find((si) => si.siteId === match.site?.id && si.status === 'active' && si.catalogId === catalogId && si.frequency === frequency) : undefined;
  return item?.qty ?? 1;
}

export interface ExistingOverride {
  contract: Contract;
  override: Contract['overrides'][number];
  inForce: boolean;
}

/** The override resolvePrice would use for this account and item (last exact frequency match, else last
 *  frequency-agnostic row), preferring a contract in force on onDate. A lapsed contract's override is still
 *  returned, with inForce false, so the workbench can say why it no longer applies. */
export function existingOverride(state: QuoteState, accountId: string | undefined, catalogId: string, frequency: Frequency, onDate: string): ExistingOverride | undefined {
  if (!accountId) return undefined;
  const account = state.accounts.find((a) => a.id === accountId);
  const contracts = state.contracts.filter((c) => c.accountId === accountId || c.id === account?.contractId);
  const candidates: ExistingOverride[] = [];
  for (const contract of contracts) {
    const matching = contract.overrides.filter((o) => o.catalogId === catalogId && (o.frequency === undefined || o.frequency === frequency));
    const exact = matching.filter((o) => o.frequency === frequency);
    const override = (exact.length ? exact : matching).at(-1);
    if (override) candidates.push({ contract, override, inForce: within(onDate, contract.termStart, contract.termEnd) });
  }
  return candidates.find((c) => c.inForce) ?? candidates[0];
}

/** The contract saveContractOverride would write to on onDate (writableContractFor in
 *  src/store/contracts.ts): never a contract whose termEnd is before onDate. Undefined means Save creates
 *  contract_<accountId>_<yyyymmdd>, leaving any lapsed contract untouched as history. */
export function contractForWrite(state: QuoteState, accountId: string, onDate: string = TODAY): Contract | undefined {
  return writableContractFor(state, accountId, onDate);
}

export type PriceOutcome = { ok: true; result: ResolvePriceResult } | { ok: false; error: string };

export function safeResolve(args: Parameters<typeof resolvePrice>[0], state: EngineState): PriceOutcome {
  try {
    return { ok: true, result: resolvePrice(args, state) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface ListPrice {
  /** resolvePrice with the matched account: a contract override wins when one is in force. */
  list: PriceOutcome;
  /** resolvePrice with no account: the ratebook price an exception is measured against. */
  ratebook: PriceOutcome;
  existing?: ExistingOverride;
}

export function listPriceFor(
  state: QuoteState,
  args: { catalogId: string; frequency: Frequency; zoneId: string; accountId?: string; onDate: string },
): ListPrice {
  const { catalogId, frequency, zoneId, accountId, onDate } = args;
  return {
    list: safeResolve({ catalogId, frequency, zoneId, accountId, onDate }, state),
    ratebook: safeResolve({ catalogId, frequency, zoneId, onDate }, state),
    existing: existingOverride(state, accountId, catalogId, frequency, dateOnly(onDate)),
  };
}

/** Percent rounded to one decimal, the precision pctBelowRateCard is stored at. */
export const roundPct1 = (pct: number): number => Math.round(pct * 10) / 10;

export interface ExceptionSummary {
  kind: 'below' | 'at' | 'above';
  /** Distance from the ratebook in percent, one decimal, always positive. */
  pct: number;
  /** Ratebook minus quoted, per unit per month (positive when below). */
  deltaCents: number;
  /** (ratebook - quoted) * 12 * qty; zero unless below. */
  annualCents: number;
  text: string;
}

/** "10% below ratebook, est. $264/yr" with Y = (list - quoted) * 12 * qty, "At ratebook", or
 *  "4.5% above ratebook". Always measured against the ratebook, never a contract price. */
export function exceptionSummary(ratebookCents: number, quotedCents: number, qty: number): ExceptionSummary {
  const deltaCents = ratebookCents - quotedCents;
  if (deltaCents === 0) return { kind: 'at', pct: 0, deltaCents: 0, annualCents: 0, text: 'At ratebook' };
  const pct = ratebookCents > 0 ? roundPct1((Math.abs(deltaCents) / ratebookCents) * 100) : 0;
  const pctText = pct === 0 ? 'under 0.1%' : formatPct(pct);
  if (deltaCents < 0) return { kind: 'above', pct, deltaCents, annualCents: 0, text: `${pctText} above ratebook` };
  const annualCents = deltaCents * 12 * qty;
  return { kind: 'below', pct, deltaCents, annualCents, text: `${pctText} below ratebook, est. ${formatCentsCompact(annualCents)}/yr` };
}

export const EXCEPTION_REASONS = ['competitive match', 'route density', 'strategic account', 'relationship save', 'other'] as const;
export type ExceptionReason = (typeof EXCEPTION_REASONS)[number];

/** The reason string stored on the override: "other" carries its note, "other: matched a flyer". */
export function reasonText(reason: ExceptionReason | '', note: string): string {
  if (reason === 'other') return `other: ${note.trim()}`;
  return reason;
}

export interface SavePlan {
  canSave: boolean;
  /** Why Save is disabled, in the order the owner should fix them. */
  blockers: string[];
  /** Plain sentences for every write Save will make. */
  writes: string[];
  /** Things Save deliberately does not do. */
  notes: string[];
  priceRequest?: { quoteId: string; line: Quote['lines'][number] };
  override?: { accountId: string; catalogId: string; frequency: Frequency; priceCents: number; reason: string; pctBelowRateCard: number };
}

export interface PlanSaveArgs {
  state: QuoteState;
  match: AddressMatch;
  catalogId: string;
  frequency: Frequency;
  qty: number;
  quotedCents: number | null;
  ratebookCents: number | null;
  reason: ExceptionReason | '';
  note: string;
  onDate: string;
  newContractId: string;
}

/** Ownership (OWNERSHIP.md): storefront creates Quotes, pricing prices a commercialRequest. So Save prices
 *  the open request at the address when there is one, never creates a Quote, and writes a Contract override
 *  only when the quote is below the ratebook and an account is matched. */
export function planSave(a: PlanSaveArgs): SavePlan {
  const blockers: string[] = [];
  const writes: string[] = [];
  const notes: string[] = [];
  const item = a.state.catalog.find((c) => c.id === a.catalogId);
  const itemName = item?.name ?? a.catalogId;
  const freqLabel = FREQUENCY_LABEL[a.frequency];

  if (a.ratebookCents === null) blockers.push('No published rate for this item and frequency, so there is nothing to measure the quote against');
  if (a.quotedCents === null || a.quotedCents <= 0) blockers.push('Enter a quoted price in dollars');
  if (!Number.isInteger(a.qty) || a.qty < 1) blockers.push('Quantity must be a whole number of 1 or more');
  if (!a.match.account && !a.match.request) blockers.push('No account matched and no pricing request at this address, so there is nothing to save to');

  const summary = a.ratebookCents !== null && a.quotedCents !== null && a.quotedCents > 0 ? exceptionSummary(a.ratebookCents, a.quotedCents, a.qty) : undefined;
  const below = summary?.kind === 'below';
  if (below && !a.reason) blockers.push('Choose a reason for pricing below the ratebook');
  if (below && a.reason === 'other' && !a.note.trim()) blockers.push('Add a note for the "other" reason');

  let priceRequest: SavePlan['priceRequest'];
  if (a.match.request && a.quotedCents !== null && a.quotedCents > 0) {
    const line = { catalogId: a.catalogId, qty: a.qty, frequency: a.frequency, priceCents: a.quotedCents };
    priceRequest = { quoteId: a.match.request.id, line };
    writes.push(`Price request ${a.match.request.id}: ${a.qty} x ${itemName}, ${freqLabel}, at ${formatCents(a.quotedCents)} a month (recurring ${formatCents(a.quotedCents * a.qty)} for this line).`);
  } else if (!a.match.request) {
    notes.push('No pricing request at this address. The workbench does not create Quotes; storefront does.');
  }

  let override: SavePlan['override'];
  if (below && a.match.account && a.quotedCents !== null && summary) {
    const target = contractForWrite(a.state, a.match.account.id, a.onDate);
    const lapsed = target ? undefined : lapsedContractFor(a.state, a.match.account.id, a.onDate);
    const reason = reasonText(a.reason, a.note);
    override = { accountId: a.match.account.id, catalogId: a.catalogId, frequency: a.frequency, priceCents: a.quotedCents, reason, pctBelowRateCard: summary.pct };
    const terms = `${itemName}, ${freqLabel}, ${formatCents(a.quotedCents)}, ${formatPct(summary.pct)} below ratebook, reason "${reason || 'none yet'}"`;
    writes.push(
      target
        ? `Add a contract override on ${target.id}: ${terms}. Earlier overrides stay as history.`
        : `Create ${a.newContractId} (one year from ${dateOnly(a.onDate)}) with an override: ${terms}.`,
    );
    if (lapsed) notes.push(`${lapsed.id} ended ${lapsed.termEnd}, so it is not written to; it stays exactly as it was, as history.`);
  } else if (below && !a.match.account && a.match.request) {
    notes.push('No account yet, so no contract override is written. The priced request carries the exception until storefront converts it.');
  } else if (summary && !below && a.match.account) {
    const current = existingOverride(a.state, a.match.account.id, a.catalogId, a.frequency, a.onDate);
    notes.push(
      current?.inForce
        ? `At or above ratebook, so no override is written. The existing contract price ${formatCents(current.override.priceCents)} on ${current.contract.id} stays in force.`
        : 'At or above ratebook, so no override is written; the account keeps resolving to the ratebook.',
    );
  }

  if (!priceRequest && !override && blockers.length === 0) blockers.push('Nothing to save: no pricing request here and the quote is not below the ratebook');

  return { canSave: blockers.length === 0, blockers, writes, notes, priceRequest, override };
}

/** The override just saved: the last row on the returned contract for this item and frequency, not
 *  overrides[0] (checklist 5.9). */
export function lastOverrideFor(contract: Contract, catalogId: string, frequency: Frequency): Contract['overrides'][number] | undefined {
  return contract.overrides.filter((o) => o.catalogId === catalogId && o.frequency === frequency).at(-1);
}
