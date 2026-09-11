// zustand store shaped like tables: one array per entity, initialised from the canonical seed.
// Phase 2 adds the pricing actions. Every action replaces arrays with new arrays and never mutates a
// row in place; publishRateVersions in particular returns the very same object for every RateVersion it
// does not publish, which is what the invariant test checks.
import { create } from 'zustand';
import { cloneSeed, type Seed } from '../seed';
import type { Contract, Frequency, LOB, Quote, RateVersion } from '../types';
import { TODAY, dateOnly, yyyymmdd } from './dates';
import { linkAccountToContract, newContract, newContractIdFor, writableContractFor } from './contracts';

export interface CreateDraftRateVersionArgs {
  catalogId: string;
  zoneId?: string;
  frequency?: Frequency;
  priceCents: number;
  effectiveFrom: string;
  supersedesId?: string;
}

export interface CreateBulkIncreaseDraftsArgs {
  lob: LOB;
  pct: number;
  effectiveFrom: string;
}

export interface PublishRateVersionsArgs {
  draftIds: string[];
  publishedAt: string;
}

export interface SaveContractOverrideArgs {
  accountId: string;
  catalogId: string;
  frequency: Frequency;
  priceCents: number;
  reason: string;
  pctBelowRateCard: number;
  /** Defaults to the pinned demo date. Tests pass an explicit value. */
  today?: string;
}

export interface SetContractEscalatorArgs {
  accountId: string;
  escalator: NonNullable<Contract['escalator']>;
  /** Defaults to the pinned demo date. Tests pass an explicit value. */
  today?: string;
}

export interface PriceCommercialRequestArgs {
  quoteId: string;
  /** Priced lines from the quote workbench. Each replaces the request's line for the same catalogId, or is
   *  appended when the request did not ask for that item. priceCents is per unit per month. */
  lines: Quote['lines'];
}

/** A Quote as the workbench builds it; createdVia is always written as 'agent' by saveQuote. */
export type QuoteInput = Omit<Quote, 'createdVia'> & { createdVia?: Quote['createdVia'] };

export interface PricingState extends Seed {
  /** Ids of drafts created by approving agent proposals (Phase 6), for the Ratebook status line. Not a seed
   *  table: RateVersion carries no provenance field and types.ts is frozen. */
  agentDraftIds: string[];
  /** Phase 6: records drafts the agent panel created. Never changes a RateVersion. */
  markAgentDrafts: (ids: string[]) => void;
  reset: () => void;
  createDraftRateVersion: (args: CreateDraftRateVersionArgs) => RateVersion;
  createBulkIncreaseDrafts: (args: CreateBulkIncreaseDraftsArgs) => RateVersion[];
  publishRateVersions: (args: PublishRateVersionsArgs) => RateVersion[];
  discardDraft: (args: { id: string }) => void;
  saveContractOverride: (args: SaveContractOverrideArgs) => Contract;
  /** Phase 6: schedules a Contract escalator. Never writes a lapsed contract; opens a new one instead. */
  setContractEscalator: (args: SetContractEscalatorArgs) => Contract;
  saveQuote: (quote: QuoteInput) => Quote;
  /** Phase 5: pricing prices a storefront commercialRequest (OWNERSHIP.md). Writes priced lines and
   *  recurringCents onto the existing Quote by replacing its row; never creates a Quote. */
  priceCommercialRequest: (args: PriceCommercialRequestArgs) => Quote;
  /** Phase 3: flips a zone's publicPricing flag. Replaces the Zone row, never mutates it. */
  setZonePublicPricing: (args: { zoneId: string; publicPricing: boolean }) => void;
}

/** Readable, unique RateVersion id in the seed's own style: rv_res_96_open_weekly_20261001. */
function nextRateVersionId(existing: RateVersion[], args: CreateDraftRateVersionArgs): string {
  const cat = args.catalogId.replace(/^cat_/, '');
  const zone = args.zoneId ? args.zoneId.replace(/^zone_/, '') : 'std';
  const freq = args.frequency ?? 'any';
  const base = `rv_${cat}_${zone}_${freq}_${yyyymmdd(args.effectiveFrom)}`;
  const taken = new Set(existing.map((rv) => rv.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

function draftFrom(existing: RateVersion[], args: CreateDraftRateVersionArgs): RateVersion {
  return {
    id: nextRateVersionId(existing, args),
    catalogId: args.catalogId,
    ...(args.zoneId !== undefined ? { zoneId: args.zoneId } : {}),
    ...(args.frequency !== undefined ? { frequency: args.frequency } : {}),
    priceCents: Math.round(args.priceCents),
    effectiveFrom: dateOnly(args.effectiveFrom),
    status: 'draft',
    ...(args.supersedesId !== undefined ? { supersedesId: args.supersedesId } : {}),
  };
}

const groupKey = (rv: RateVersion): string => `${rv.catalogId}|${rv.zoneId ?? ''}|${rv.frequency ?? ''}`;

/** A draft with no change: it supersedes a version at exactly the same price (checklist 7.7). Publishing it
 *  would add a version to history that bills nobody differently, so publishRateVersions leaves it as a
 *  draft and the Ratebook flags it in the drafts tray. A draft with no supersedesId opens a new line and is
 *  always a change. */
export function isNoChangeDraft(draft: RateVersion, rateVersions: RateVersion[]): boolean {
  if (draft.status !== 'draft' || !draft.supersedesId) return false;
  const superseded = rateVersions.find((rv) => rv.id === draft.supersedesId);
  return !!superseded && superseded.priceCents === draft.priceCents;
}

export const useStore = create<PricingState>((set, get) => ({
  ...cloneSeed(),
  agentDraftIds: [],

  reset: () => set(() => ({ ...cloneSeed(), agentDraftIds: [] })),

  markAgentDrafts: (ids) => set((s) => ({ agentDraftIds: [...new Set([...s.agentDraftIds, ...ids])] })),

  createDraftRateVersion: (args) => {
    const draft = draftFrom(get().rateVersions, args);
    set((s) => ({ rateVersions: [...s.rateVersions, draft] }));
    return draft;
  },

  /** For every published RateVersion of the lob that is the latest (by effectiveFrom, then publishedAt) for
   *  its (catalogId, zoneId, frequency) group, create a draft at round(price * (1 + pct/100)) superseding it. */
  createBulkIncreaseDrafts: ({ lob, pct, effectiveFrom }) => {
    const s = get();
    const lobCatalogIds = new Set(s.catalog.filter((c) => c.lob === lob).map((c) => c.id));
    const latest = new Map<string, RateVersion>();
    for (const rv of s.rateVersions) {
      if (rv.status !== 'published' || !lobCatalogIds.has(rv.catalogId)) continue;
      const key = groupKey(rv);
      const cur = latest.get(key);
      const newer =
        !cur ||
        dateOnly(rv.effectiveFrom) > dateOnly(cur.effectiveFrom) ||
        (dateOnly(rv.effectiveFrom) === dateOnly(cur.effectiveFrom) && (rv.publishedAt ?? '') > (cur.publishedAt ?? ''));
      if (newer) latest.set(key, rv);
    }
    const drafts: RateVersion[] = [];
    const pool = [...s.rateVersions];
    for (const rv of latest.values()) {
      const draft = draftFrom(pool, {
        catalogId: rv.catalogId,
        zoneId: rv.zoneId,
        frequency: rv.frequency,
        // (price * (100 + pct)) / 100 keeps half cents exact: 57500 * 1.025 is 58937.4999 in binary floating point.
        priceCents: Math.round((rv.priceCents * (100 + pct)) / 100),
        effectiveFrom,
        supersedesId: rv.id,
      });
      drafts.push(draft);
      pool.push(draft);
    }
    set((st) => ({ rateVersions: [...st.rateVersions, ...drafts] }));
    return drafts;
  },

  /** Replaces each draft with a published copy (publishedAt set, supersedesId kept). Every other RateVersion
   *  object, including the superseded one, is returned by identity and never touched. Ids that are not
   *  pending drafts are ignored rather than re-published, and so is a draft with no change (isNoChangeDraft):
   *  it stays a draft. */
  publishRateVersions: ({ draftIds, publishedAt }) => {
    const ids = new Set(draftIds);
    const published: RateVersion[] = [];
    set((s) => ({
      rateVersions: s.rateVersions.map((rv) => {
        if (!ids.has(rv.id) || rv.status !== 'draft') return rv;
        if (isNoChangeDraft(rv, s.rateVersions)) return rv;
        const copy: RateVersion = { ...rv, status: 'published', publishedAt };
        published.push(copy);
        return copy;
      }),
    }));
    return published;
  },

  discardDraft: ({ id }) => {
    set((s) => ({ rateVersions: s.rateVersions.filter((rv) => !(rv.id === id && rv.status === 'draft')) }));
  },

  /** Adds the override to the contract writableContractFor picks for today (src/store/contracts.ts): a
   *  contract whose termEnd is not before today. When the account has none (no contract, or only lapsed
   *  ones) it creates contract_<accountId>_<yyyymmdd> with a one year term and leaves any lapsed contract
   *  untouched as history (decision 80). Within a contract created today an override for the same
   *  catalogId and frequency is replaced; on an older contract the new override is appended and the earlier
   *  one kept as history (resolvePrice lets the later row win). Never writes BillingAccount: the account
   *  link is described by linkAccountToContract and resolvePrice finds the contract by Contract.accountId
   *  (decision 81). */
  saveContractOverride: ({ accountId, catalogId, frequency, priceCents, reason, pctBelowRateCard, today = TODAY }) => {
    const s = get();
    if (!s.accounts.some((a) => a.id === accountId)) throw new Error(`Unknown account ${accountId}`);
    const day = dateOnly(today);
    const override: Contract['overrides'][number] = { catalogId, frequency, priceCents: Math.round(priceCents), reason, pctBelowRateCard };
    const existing = writableContractFor(s, accountId, day);

    if (!existing) {
      const contract = newContract(accountId, day, { overrides: [override] });
      linkAccountToContract({ accountId, contractId: contract.id }, s);
      set((st) => ({ contracts: [...st.contracts, contract] }));
      return contract;
    }

    const createdToday = existing.id === newContractIdFor(accountId, day);
    const overrides = createdToday
      ? [...existing.overrides.filter((o) => !(o.catalogId === catalogId && o.frequency === frequency)), override]
      : [...existing.overrides, override];
    const contract: Contract = { ...existing, overrides };
    set((st) => ({ contracts: st.contracts.map((c) => (c.id === existing.id ? contract : c)) }));
    return contract;
  },

  /** Writes Contract.escalator on the contract writableContractFor picks for today, by replacing the row.
   *  Same lapsed rule as saveContractOverride: an ended contract is never written, a new one year contract
   *  carries the escalator instead. Contract.escalator is a single field (decision 7), so a contract that
   *  already has one is refused rather than overwritten. */
  setContractEscalator: ({ accountId, escalator, today = TODAY }) => {
    const s = get();
    if (!s.accounts.some((a) => a.id === accountId)) throw new Error(`Unknown account ${accountId}`);
    if (!(Number.isFinite(escalator.pct) && escalator.pct > 0)) throw new RangeError('Escalator pct must be greater than 0');
    const day = dateOnly(today);
    const entry: NonNullable<Contract['escalator']> = { kind: escalator.kind, pct: escalator.pct, anniversary: dateOnly(escalator.anniversary) };
    const existing = writableContractFor(s, accountId, day);

    if (!existing) {
      const contract = newContract(accountId, day, { escalator: entry });
      linkAccountToContract({ accountId, contractId: contract.id }, s);
      set((st) => ({ contracts: [...st.contracts, contract] }));
      return contract;
    }
    if (existing.escalator) {
      throw new Error(`${existing.id} already has a ${existing.escalator.pct}% escalator due ${existing.escalator.anniversary}; it is left as scheduled`);
    }
    const contract: Contract = { ...existing, escalator: entry };
    set((st) => ({ contracts: st.contracts.map((c) => (c.id === existing.id ? contract : c)) }));
    return contract;
  },

  saveQuote: (quote) => {
    const saved: Quote = { ...quote, createdVia: 'agent' };
    set((s) => ({ quotes: [...s.quotes, saved] }));
    return saved;
  },

  /** Replaces the commercialRequest row with a copy carrying the priced lines. Lines are upserted by
   *  catalogId (the workbench may change the frequency the storefront asked for), recurringCents is
   *  recomputed from every line as priceCents * qty, and id, kind, address, zoneId, status, expiresAt,
   *  dueTodayCents, and createdVia (storefront made it) are kept. A residentialSignup is refused: storefront
   *  owns those end to end. */
  priceCommercialRequest: ({ quoteId, lines }) => {
    const existing = get().quotes.find((q) => q.id === quoteId);
    if (!existing) throw new Error(`Unknown quote ${quoteId}`);
    if (existing.kind !== 'commercialRequest') throw new Error(`${quoteId} is a ${existing.kind}; pricing only prices a commercialRequest`);
    const merged = [...existing.lines];
    for (const line of lines) {
      const priced = { catalogId: line.catalogId, qty: line.qty, frequency: line.frequency, priceCents: Math.round(line.priceCents) };
      const at = merged.findIndex((l) => l.catalogId === line.catalogId);
      if (at >= 0) merged[at] = priced;
      else merged.push(priced);
    }
    const quote: Quote = { ...existing, lines: merged, recurringCents: merged.reduce((sum, l) => sum + l.priceCents * l.qty, 0) };
    set((s) => ({ quotes: s.quotes.map((q) => (q.id === quoteId ? quote : q)) }));
    return quote;
  },

  setZonePublicPricing: ({ zoneId, publicPricing }) => {
    set((s) => ({ zones: s.zones.map((z) => (z.id === zoneId ? { ...z, publicPricing } : z)) }));
  },
}));
