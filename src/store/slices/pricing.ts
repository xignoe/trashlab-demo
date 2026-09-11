/**
 * Pricing slice (Phase 2, CHECKLIST.md box 2B.2). Moved from pricing/src/store/store.ts.
 *
 * What lives where:
 * - db (through get().mutateDb only): published RateVersions (publishRateVersions), Contracts (saveContractOverride,
 *   setContractEscalator), Quotes (priceCommercialRequest), and Zone.publicPricing (setZonePublicPricing, addendum K1).
 * - this slice: pending draft RateVersions, which agent approvals created them, and the last publish and its history
 *   proof. None of it is a Db table, so no other surface ever sees a draft, and the canonical resolvePrice could not
 *   bill one even if it did.
 * - account's linkAccountToContract (box 3.6): when a save opens a new contract (addendum K3), the account is pointed
 *   at it through account's action, since BillingAccount is account's to write.
 *
 * Invariant 1: publishRateVersions only appends. Every RateVersion already in db, the superseded one included, stays
 * the same object with the same fields, and invoices and charges are never touched.
 *
 * Pure write rules (draft ids, the no-change rule, contract selection and override order) live in
 * src/surfaces/pricing/lib so the Ratebook and the quote workbench can state a write before it runs. The creator has
 * no side effects: reset() calls it again to clear drafts, the publish record, and the links.
 */
import type { Contract, Frequency, LOB, Quote, RateVersion } from '../../types'
import { today } from '../clock'
import { dateOnly } from '../../surfaces/pricing/lib/dates'
import {
  draftFrom, isNoChangeDraft, latestPublishedPerGroup, publishedAtFor, withDrafts, type CreateDraftRateVersionArgs,
} from '../../surfaces/pricing/lib/rateVersions'
import { contractWithOverride, newContract, writableContractFor, type ContractOverride } from '../../surfaces/pricing/lib/contracts'
import { planApproval, proposeIncreases, type ApprovalResult, type ProposalRow } from '../../surfaces/pricing/lib/agentProposals'
import { proofInvoiceFor, snapshotProof, type PublishProof } from '../../surfaces/pricing/lib/proof'
import type { SliceCreator } from './types'
import type { GeoZone } from '../../types'
import type {
  FeeRule, PricingDimension, RolloffMaterial, RolloffPolicy, RolloffRate, ServiceCatalog, ServiceCategory, TaxRule, Zone,
} from '../../types'
import { stamp } from '../clock'
import { rolloffRateFor } from '../engine'
import { addDays, yyyymmdd } from '../../surfaces/pricing/lib/dates'
import { rateGroupKey } from '../../surfaces/pricing/lib/rateVersions'
import { validateFeeRule, validateTaxRule, withRuleVersion, type FeeRuleInput, type TaxRuleInput } from '../../surfaces/pricing/lib/rules'
import { CUSTOM_SOURCES, dimensionUsage, FIELD_TYPE_LABEL, fieldTypeOf, slugify, uniqueId, YES_NO_VALUES, type FieldType } from '../../surfaces/pricing/lib/config'

export type { CreateDraftRateVersionArgs } from '../../surfaces/pricing/lib/rateVersions'

export interface CreateBulkIncreaseDraftsArgs {
  lob: LOB
  pct: number
  effectiveFrom: string
  /** Discard the lob's pending drafts first, so a second bulk increase replaces the first instead of stacking. */
  replacePending?: boolean
}

export interface PublishRateVersionsArgs {
  /** Pending draft ids. Ids that are not pending drafts are ignored, and so is a draft with no change. */
  draftIds: string[]
  /** Defaults to the clock's day at 09:00 -04:00, one minute later per publish in the session. */
  publishedAt?: string
}

export interface SaveContractOverrideArgs {
  accountId: string
  catalogId: string
  frequency: Frequency
  priceCents: number
  reason: string
  pctBelowRateCard: number
  /** The date of the write. Defaults to the engine clock (src/store/clock.ts). */
  today?: string
}

export interface SetContractEscalatorArgs {
  accountId: string
  escalator: NonNullable<Contract['escalator']>
  /** The date of the write. Defaults to the engine clock. */
  today?: string
}

export interface PriceCommercialRequestArgs {
  quoteId: string
  /** Priced lines from the quote workbench. Each replaces the request's line for the same catalogId, or is appended
   *  when the request did not ask for that item. priceCents is per unit per month. */
  lines: Quote['lines']
}

export interface ApprovePricingProposalsArgs {
  accountIds: string[]
  /** Defaults to the engine clock. */
  onDate?: string
  /** The rows the panel showed; recomputed from db when omitted. */
  rows?: ProposalRow[]
}

export interface CreateAdjustDraftsArgs {
  /** Published rate versions to move; each gets one draft that supersedes it, replacing any pending draft on its line. */
  rateVersionIds: string[]
  pct: number
  effectiveFrom: string
}

export interface SaveFeeRuleArgs {
  input: FeeRuleInput
  effectiveFrom: string
  /** The version this one replaces; it is ended the day before effectiveFrom and kept. */
  previousId?: string
  today?: string
}

export interface SaveTaxRuleArgs {
  input: TaxRuleInput
  effectiveFrom: string
  previousId?: string
  today?: string
}

export type RolloffCellInput = Pick<RolloffRate, 'available' | 'haulDeltaCents' | 'includedTons' | 'overageCentsPerTon'> & Partial<Pick<RolloffRate, 'overageTiers' | 'minBilledTons'>>

export interface SaveRolloffRateArgs {
  catalogId: string
  materialId: string
  cell: RolloffCellInput
  effectiveFrom: string
  today?: string
}

export type RolloffTermsPatch = Partial<NonNullable<ServiceCatalog['rolloff']>>

export interface SaveServiceArgs {
  /** Omit to add a service. */
  id?: string
  name: string
  categoryId: string
  sizeLabel: string
  unit: ServiceCatalog['unit']
  priceUnit: NonNullable<ServiceCatalog['priceUnit']>
  pricedBy: string[]
  public: boolean
  description?: string
  /** Required when the category is roll-off. */
  rolloff?: ServiceCatalog['rolloff']
  /** A number field the price is multiplied by (collections per month, lbs). Omit for a flat price per unit. */
  quantityField?: string
}

export interface SaveServiceCategoryArgs {
  id?: string
  name: string
  lob: ServiceCategory['lob']
  description?: string
}

export interface SaveDimensionArgs {
  id?: string
  name: string
  /** For a new field: account, site, serviceLine, or input. Built-in dimensions keep theirs. */
  source?: PricingDimension['source']
  /** For a new field: choice (the default), number, yesNo, or text. A field keeps its type once saved. */
  type?: FieldType
  /** Number fields: what the number counts. */
  unit?: string
  /** Values in order (a number field's bands, with min and max). A value with no id is new and gets one from its label.
   *  Yes or no fields always have yes and no; text fields have none. */
  values?: { id?: string; label: string; min?: number; max?: number }[]
  /** A choice or yes or no field: a value id. A number field: a number. */
  defaultValueId?: string
  description?: string
}

export interface SaveZoneArgs {
  id?: string
  name: string
  serviceability: Zone['serviceability']
  franchiseFeePct: number
  deliveryFeeCents: number
  publicPricing: boolean
  /** A new zone only: its first tax layer, from today. Later tax changes are tax layers. */
  taxRatePct?: number
  today?: string
}

export type SaveRolloffMaterialArgs = Omit<RolloffMaterial, 'id'> & { id?: string }

/** What the Ratebook shows after a publish: the ids, the stamp, and the posted invoice snapshotted just before. */
export interface PricingPublishRecord {
  ids: string[]
  publishedAt: string
  proof?: PublishProof
}

export interface PricingSlice {
  /** Pending draft RateVersions (status draft). Never in db until publishRateVersions appends them as published. */
  pricingDrafts: RateVersion[]
  /** Ids of drafts created by approving agent proposals, for the "agent" label and the Ratebook status line. */
  pricingAgentDraftIds: string[]
  /** Publishes made this session; spaces publishedAt one minute apart. */
  pricingPublishCount: number
  pricingLastPublish: PricingPublishRecord | null

  /** Queue a draft for one rate line. Throws for an unknown catalog item, a non-positive price, or a bad date. */
  createDraftRateVersion(args: CreateDraftRateVersionArgs): RateVersion
  /** One draft per latest published version of the lob's rate lines, at round(price x (100 + pct) / 100). */
  createBulkIncreaseDrafts(args: CreateBulkIncreaseDraftsArgs): RateVersion[]
  /** Remove a pending draft. Published versions are never removed. */
  discardDraftRateVersion(args: { id: string }): void
  /**
   * Append the pending drafts to db.rateVersions as published copies (status published, publishedAt set, supersedesId
   * kept). Returns the rows written, in draft order. Every other RateVersion is left as it was.
   */
  publishRateVersions(args: PublishRateVersionsArgs): RateVersion[]
  /**
   * Write a contract override for a quote below the ratebook. Lands on the contract in force on the date; with none
   * in force (no contract, or only lapsed ones) it opens contract_<accountId>_<yyyymmdd> for a year (addendum K3),
   * points the account at it through account's linkAccountToContract, and leaves the lapsed contract untouched. The new override is written first so the canonical resolvePrice bills it;
   * earlier rows for the same item stay after it as history. Returns the contract as written.
   */
  saveContractOverride(args: SaveContractOverrideArgs): Contract
  /** Write Contract.escalator on the contract in force; same lapsed rule. Refuses to overwrite a scheduled escalator. */
  setContractEscalator(args: SetContractEscalatorArgs): Contract
  /** Price a storefront commercialRequest in place (lines upserted by catalogId, recurringCents recomputed). */
  priceCommercialRequest(args: PriceCommercialRequestArgs): Quote
  /** Flip a zone's public pricing flag (addendum K1: the only runtime write on Zone). */
  setZonePublicPricing(args: { zoneId: string; publicPricing: boolean }): void
  /** Apply an agent approval plan: drafts and escalator entries only. Never publishes. */
  approvePricingProposals(args: ApprovePricingProposalsArgs): ApprovalResult

  // Pricing configuration (DECISIONS.md entries 64 and 65). Every write goes through mutateDb; rules and roll-off cells
  // are versioned by effective date, and nothing here touches a charge or an invoice.
  /** One draft per chosen published version at round(price x (100 + pct) / 100), replacing pending drafts on those lines. */
  createAdjustDrafts(args: CreateAdjustDraftsArgs): RateVersion[]
  /** Add an adjustment, or a new version of one (the old version ends the day before and is kept). Throws the problems. */
  saveFeeRule(args: SaveFeeRuleArgs): FeeRule
  /** Pause or resume an adjustment. Charges already computed keep their fees. */
  setFeeRuleStatus(args: { id: string; status: 'active' | 'paused' }): FeeRule
  saveTaxRule(args: SaveTaxRuleArgs): TaxRule
  /** End a tax layer after lastDay (on or after yesterday). */
  endTaxRule(args: { id: string; lastDay: string; today?: string }): TaxRule
  /** A new version of one cell of the roll-off material by size matrix, effective from a date. */
  saveRolloffRate(args: SaveRolloffRateArgs): RolloffRate
  /** Rental and weight terms of a roll-off size, written on its catalog row; they price extra days and tickets billed after. */
  updateRolloffTerms(args: { catalogId: string; patch: RolloffTermsPatch }): ServiceCatalog
  updateRolloffPolicy(args: { patch: Partial<Omit<RolloffPolicy, 'id'>> }): RolloffPolicy
  saveRolloffMaterial(args: SaveRolloffMaterialArgs): RolloffMaterial
  saveServiceCategory(args: SaveServiceCategoryArgs): ServiceCategory
  /** Add a service to the catalog, or edit one. Its LOB comes from its category and never changes. */
  saveService(args: SaveServiceArgs): ServiceCatalog
  saveDimension(args: SaveDimensionArgs): PricingDimension
  /** Set (or clear, with null) the value an account or site carries on an account or site dimension. */
  assignDimensionValue(args: { dimensionId: string; targetId: string; valueId: string | null }): PricingDimension
  /** Add a zone (with its first tax layer), or edit one. A zone that is not served cannot be public. */
  saveZone(args: SaveZoneArgs): Zone
  /** Add or edit a zone drawn on the map (DECISIONS.md entry 69). Needs a name and at least three points. */
  saveGeoZone(args: SaveGeoZoneArgs): GeoZone
  /** Remove a drawn zone. Refused while a rate or adjustment is keyed by it. */
  deleteGeoZone(args: { id: string }): void
  /** Move a drawn zone up or down the list. Where zones overlap, the one higher in the list wins. */
  moveGeoZone(args: { id: string; direction: 'up' | 'down' }): void
}

export interface SaveGeoZoneArgs {
  /** Omit to add a zone. */
  id?: string
  name: string
  /** [lat, lng] vertices in order. */
  polygon: [number, number][]
  color?: string
  description?: string
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

export function initialPricingData(): Pick<PricingSlice, 'pricingDrafts' | 'pricingAgentDraftIds' | 'pricingPublishCount' | 'pricingLastPublish'> {
  return { pricingDrafts: [], pricingAgentDraftIds: [], pricingPublishCount: 0, pricingLastPublish: null }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/

export const createPricingSlice: SliceCreator<PricingSlice> = (set, get) => {
  /** Write a new contract, then point its account at it through account's action (addendum K3 and K4, box 3.6). */
  const openContract = (contract: Contract): Contract => {
    get().mutateDb(current => ({ ...current, contracts: [...current.contracts, contract] }))
    get().linkAccountToContract({ accountId: contract.accountId, contractId: contract.id })
    return contract
  }

  return {
    ...initialPricingData(),

    createDraftRateVersion(args) {
      const { db, pricingDrafts } = get()
      if (!db.catalog.some(c => c.id === args.catalogId)) throw new Error(`Unknown catalog ${args.catalogId}`)
      if (!(Math.round(args.priceCents) > 0)) throw new RangeError(`priceCents must be greater than 0, got ${args.priceCents}`)
      if (!ISO_DATE.test(args.effectiveFrom)) throw new Error(`effectiveFrom must be an ISO date, got ${args.effectiveFrom}`)
      const taken = new Set([...db.rateVersions.map(r => r.id), ...pricingDrafts.map(d => d.id)])
      const draft = draftFrom(taken, args)
      set(s => ({ pricingDrafts: [...s.pricingDrafts, draft] }))
      return draft
    },

    createBulkIncreaseDrafts({ lob, pct, effectiveFrom, replacePending = false }) {
      const { db, pricingDrafts } = get()
      if (!Number.isFinite(pct)) throw new RangeError(`pct must be a number, got ${pct}`)
      if (!ISO_DATE.test(effectiveFrom)) throw new Error(`effectiveFrom must be an ISO date, got ${effectiveFrom}`)
      const lobIds = new Set(db.catalog.filter(c => c.lob === lob).map(c => c.id))
      const kept = replacePending ? pricingDrafts.filter(d => !lobIds.has(d.catalogId)) : pricingDrafts
      const removed = new Set(pricingDrafts.filter(d => !kept.includes(d)).map(d => d.id))
      const taken = new Set([...db.rateVersions.map(r => r.id), ...kept.map(d => d.id)])
      const drafts = latestPublishedPerGroup(db.rateVersions, lobIds).map(rv => {
        const draft = draftFrom(taken, {
          catalogId: rv.catalogId,
          zoneId: rv.zoneId,
          frequency: rv.frequency,
          // (price * (100 + pct)) / 100 keeps half cents exact: 57500 * 1.025 is 58937.4999 in binary floating point.
          priceCents: Math.round((rv.priceCents * (100 + pct)) / 100),
          effectiveFrom,
          supersedesId: rv.id,
        })
        taken.add(draft.id)
        return draft
      })
      set(s => ({
        pricingDrafts: [...kept, ...drafts],
        pricingAgentDraftIds: s.pricingAgentDraftIds.filter(id => !removed.has(id)),
      }))
      return drafts
    },

    discardDraftRateVersion({ id }) {
      set(s => ({
        pricingDrafts: s.pricingDrafts.filter(d => d.id !== id),
        pricingAgentDraftIds: s.pricingAgentDraftIds.filter(x => x !== id),
      }))
    },

    publishRateVersions({ draftIds, publishedAt }) {
      const { db, pricingDrafts, pricingPublishCount } = get()
      const ids = new Set(draftIds)
      const pool = [...db.rateVersions, ...pricingDrafts]
      const chosen = pricingDrafts.filter(d => ids.has(d.id) && d.status === 'draft' && !isNoChangeDraft(d, pool))
      if (chosen.length === 0) return []
      const at = publishedAt ?? publishedAtFor(today(), pricingPublishCount)
      const published: RateVersion[] = chosen.map(d => ({ ...d, status: 'published', publishedAt: at }))
      const publishedIds = new Set(published.map(p => p.id))

      // Snapshot the posted invoice the history proof will watch, before anything is written.
      const superseded = published.map(p => p.supersedesId).filter((x): x is string => !!x)
      const pick = proofInvoiceFor(db, superseded)
      const proof = pick ? snapshotProof(db, pick.invoice, pick.basis) : undefined

      get().mutateDb(
        current => ({ ...current, rateVersions: [...current.rateVersions, ...published] }),
        s => ({
          pricingDrafts: s.pricingDrafts.filter(d => !publishedIds.has(d.id)),
          pricingAgentDraftIds: s.pricingAgentDraftIds.filter(id => !publishedIds.has(id)),
          pricingPublishCount: s.pricingPublishCount + 1,
          pricingLastPublish: { ids: published.map(p => p.id), publishedAt: at, ...(proof ? { proof } : {}) },
        }),
      )
      return published
    },

    saveContractOverride({ accountId, catalogId, frequency, priceCents, reason, pctBelowRateCard, today: day }) {
      const { db } = get()
      if (!db.accounts.some(a => a.id === accountId)) throw new Error(`Unknown account ${accountId}`)
      if (!db.catalog.some(c => c.id === catalogId)) throw new Error(`Unknown catalog ${catalogId}`)
      if (!(Math.round(priceCents) > 0)) throw new RangeError(`priceCents must be greater than 0, got ${priceCents}`)
      const d = dateOnly(day ?? today())
      const override: ContractOverride = { catalogId, frequency, priceCents: Math.round(priceCents), reason, pctBelowRateCard }
      const existing = writableContractFor(db, accountId, d)

      if (!existing) return openContract(newContract(accountId, d, { overrides: [override] }))
      const contract = contractWithOverride(existing, override, accountId, d)
      get().mutateDb(current => ({ ...current, contracts: current.contracts.map(c => (c.id === existing.id ? contract : c)) }))
      return contract
    },

    setContractEscalator({ accountId, escalator, today: day }) {
      const { db } = get()
      if (!db.accounts.some(a => a.id === accountId)) throw new Error(`Unknown account ${accountId}`)
      if (!(Number.isFinite(escalator.pct) && escalator.pct > 0)) throw new RangeError('Escalator pct must be greater than 0')
      const d = dateOnly(day ?? today())
      const entry: NonNullable<Contract['escalator']> = { kind: escalator.kind, pct: escalator.pct, anniversary: dateOnly(escalator.anniversary) }
      const existing = writableContractFor(db, accountId, d)

      if (!existing) return openContract(newContract(accountId, d, { escalator: entry }))
      if (existing.escalator) {
        throw new Error(`${existing.id} already has a ${existing.escalator.pct}% escalator due ${existing.escalator.anniversary}; it is left as scheduled`)
      }
      const contract: Contract = { ...existing, escalator: entry }
      get().mutateDb(current => ({ ...current, contracts: current.contracts.map(c => (c.id === existing.id ? contract : c)) }))
      return contract
    },

    priceCommercialRequest({ quoteId, lines }) {
      const existing = get().db.quotes.find(q => q.id === quoteId)
      if (!existing) throw new Error(`Unknown quote ${quoteId}`)
      if (existing.kind !== 'commercialRequest') throw new Error(`${quoteId} is a ${existing.kind}; pricing only prices a commercialRequest`)
      const merged = [...existing.lines]
      for (const line of lines) {
        const priced = { catalogId: line.catalogId, qty: line.qty, frequency: line.frequency, priceCents: Math.round(line.priceCents) }
        const at = merged.findIndex(l => l.catalogId === line.catalogId)
        if (at >= 0) merged[at] = priced
        else merged.push(priced)
      }
      const quote: Quote = { ...existing, lines: merged, recurringCents: merged.reduce((sum, l) => sum + l.priceCents * l.qty, 0) }
      get().mutateDb(db => ({ ...db, quotes: db.quotes.map(q => (q.id === quoteId ? quote : q)) }))
      return quote
    },

    setZonePublicPricing({ zoneId, publicPricing }) {
      const zone = get().db.zones.find(z => z.id === zoneId)
      if (!zone) throw new Error(`Unknown zone ${zoneId}`)
      if (publicPricing && zone.serviceability === 'notServed') throw new Error(`${zoneId} is not served and cannot be priced publicly`)
      if (zone.publicPricing === publicPricing) return
      get().mutateDb(db => ({ ...db, zones: db.zones.map(z => (z.id === zoneId ? { ...z, publicPricing } : z)) }))
    },

    approvePricingProposals({ accountIds, onDate, rows }) {
      const { db, pricingDrafts } = get()
      const day = dateOnly(onDate ?? today())
      const allRows = rows ?? proposeIncreases({ onDate: day }, db)
      const plan = planApproval(allRows, accountIds, withDrafts(db, pricingDrafts).rateVersions, day)
      const drafts = plan.drafts.map(d => get().createDraftRateVersion(d.args))
      const contracts = plan.escalators.map(e => get().setContractEscalator({ accountId: e.accountId, escalator: e.escalator, today: day }))
      if (drafts.length > 0) set(s => ({ pricingAgentDraftIds: [...new Set([...s.pricingAgentDraftIds, ...drafts.map(d => d.id)])] }))
      return { plan, drafts, contracts }
    },

    createAdjustDrafts({ rateVersionIds, pct, effectiveFrom }) {
      const { db, pricingDrafts } = get()
      if (!Number.isFinite(pct) || pct <= -100) throw new RangeError(`pct must be a number above -100, got ${pct}`)
      if (!ISO_DATE.test(effectiveFrom)) throw new Error(`effectiveFrom must be an ISO date, got ${effectiveFrom}`)
      const ids = new Set(rateVersionIds)
      const chosen = db.rateVersions.filter(rv => ids.has(rv.id) && rv.status === 'published')
      const lines = new Set(chosen.map(rateGroupKey))
      const kept = pricingDrafts.filter(d => !lines.has(rateGroupKey(d)))
      const removed = new Set(pricingDrafts.filter(d => !kept.includes(d)).map(d => d.id))
      const taken = new Set([...db.rateVersions.map(r => r.id), ...kept.map(d => d.id)])
      const drafts = chosen.map(rv => {
        const draft = draftFrom(taken, {
          catalogId: rv.catalogId, zoneId: rv.zoneId, frequency: rv.frequency, dims: rv.dims,
          priceCents: Math.round((rv.priceCents * (100 + pct)) / 100), effectiveFrom, supersedesId: rv.id,
        })
        taken.add(draft.id)
        return draft
      })
      set(s => ({ pricingDrafts: [...kept, ...drafts], pricingAgentDraftIds: s.pricingAgentDraftIds.filter(id => !removed.has(id)) }))
      return drafts
    },

    saveFeeRule({ input, effectiveFrom, previousId, today: day }) {
      const { db } = get()
      const d = dateOnly(day ?? today())
      const previous = previousId ? db.feeRules.find(r => r.id === previousId) : undefined
      if (previousId && !previous) throw new Error(`Unknown adjustment ${previousId}`)
      const problems = validateFeeRule(input, effectiveFrom, d, previous)
      if (problems.length) throw new Error(problems.join('. '))
      const id = uniqueId('fee', `${input.name} ${yyyymmdd(effectiveFrom)}`, new Set(db.feeRules.map(r => r.id)))
      const { rows, saved } = withRuleVersion(db.feeRules, input, { id, effectiveFrom, ...(previousId ? { previousId } : {}) })
      get().mutateDb(current => ({ ...current, feeRules: rows }))
      return saved
    },

    setFeeRuleStatus({ id, status }) {
      const rule = get().db.feeRules.find(r => r.id === id)
      if (!rule) throw new Error(`Unknown adjustment ${id}`)
      const next: FeeRule = { ...rule, status }
      get().mutateDb(current => ({ ...current, feeRules: current.feeRules.map(r => (r.id === id ? next : r)) }))
      return next
    },

    saveTaxRule({ input, effectiveFrom, previousId, today: day }) {
      const { db } = get()
      const d = dateOnly(day ?? today())
      const previous = previousId ? db.taxRules.find(r => r.id === previousId) : undefined
      if (previousId && !previous) throw new Error(`Unknown tax layer ${previousId}`)
      const problems = validateTaxRule(input, effectiveFrom, d, new Set(db.zones.map(z => z.id)), previous)
      if (problems.length) throw new Error(problems.join('. '))
      const id = uniqueId('tax', `${input.zoneId.replace(/^zone_/, '')} ${input.name ?? input.jurisdiction ?? 'layer'} ${yyyymmdd(effectiveFrom)}`, new Set(db.taxRules.map(r => r.id)))
      const { rows, saved } = withRuleVersion(db.taxRules, input, { id, effectiveFrom, ...(previousId ? { previousId } : {}) })
      get().mutateDb(current => ({ ...current, taxRules: rows }))
      return saved
    },

    endTaxRule({ id, lastDay, today: day }) {
      const rule = get().db.taxRules.find(r => r.id === id)
      if (!rule) throw new Error(`Unknown tax layer ${id}`)
      const d = dateOnly(day ?? today())
      if (!ISO_DATE.test(lastDay) || dateOnly(lastDay) < addDays(d, -1)) throw new Error(`A tax layer can end yesterday at the earliest (${addDays(d, -1)})`)
      const next: TaxRule = { ...rule, effectiveTo: dateOnly(lastDay) }
      get().mutateDb(current => ({ ...current, taxRules: current.taxRules.map(r => (r.id === id ? next : r)) }))
      return next
    },

    saveRolloffRate({ catalogId, materialId, cell, effectiveFrom, today: day }) {
      const { db } = get()
      const d = dateOnly(day ?? today())
      const size = db.catalog.find(c => c.id === catalogId)
      const material = db.rolloffMaterials.find(m => m.id === materialId)
      if (!size?.rolloff) throw new Error(`${catalogId} is not a roll-off size`)
      if (!material) throw new Error(`Unknown material ${materialId}`)
      if (material.handling === 'prohibited') throw new Error(`${material.name} is prohibited; it has no prices`)
      if (!ISO_DATE.test(effectiveFrom) || dateOnly(effectiveFrom) < d) throw new Error(`The effective date cannot be before today (${d})`)
      const nums = [cell.includedTons, cell.overageCentsPerTon, cell.minBilledTons ?? 0, ...(cell.overageTiers ?? []).flatMap(t => [t.aboveTons, t.centsPerTon])]
      if (nums.some(n => !Number.isFinite(n) || n < 0)) throw new Error('Tons and rates cannot be negative')
      if (!Number.isInteger(cell.haulDeltaCents) || !Number.isInteger(cell.overageCentsPerTon)) throw new Error('Money is whole cents')
      const current = rolloffRateFor(catalogId, materialId, effectiveFrom, db)
      if (current && dateOnly(current.effectiveFrom) >= dateOnly(effectiveFrom)) throw new Error(`Pick a date after ${current.effectiveFrom}, when the current cell starts`)
      const taken = new Set(db.rolloffRates.map(r => r.id))
      const row: RolloffRate = {
        id: uniqueId('rr', `${catalogId.replace(/^cat_ro_/, '')} ${materialId.replace(/^mat_/, '')} ${yyyymmdd(effectiveFrom)}`, taken),
        catalogId, materialId, available: cell.available,
        haulDeltaCents: material.handling === 'standard' ? 0 : cell.haulDeltaCents,
        includedTons: cell.includedTons, overageCentsPerTon: cell.overageCentsPerTon,
        ...(cell.overageTiers?.length ? { overageTiers: cell.overageTiers } : {}),
        ...(cell.minBilledTons ? { minBilledTons: cell.minBilledTons } : {}),
        effectiveFrom: dateOnly(effectiveFrom), publishedAt: stamp(),
        ...(current ? { supersedesId: current.id } : {}),
      }
      get().mutateDb(x => ({ ...x, rolloffRates: [...x.rolloffRates, row] }))
      return row
    },

    updateRolloffTerms({ catalogId, patch }) {
      const item = get().db.catalog.find(c => c.id === catalogId)
      if (!item?.rolloff) throw new Error(`${catalogId} is not a roll-off size`)
      const nums = Object.entries(patch).filter(([k]) => k !== 'overageTiers').map(([, v]) => v as number)
      if (nums.some(n => n !== undefined && (!Number.isFinite(n) || n < 0))) throw new Error('Days, tons, and rates cannot be negative')
      const rolloff = { ...item.rolloff, ...patch }
      for (const k of Object.keys(rolloff) as (keyof typeof rolloff)[]) if (rolloff[k] === undefined) delete rolloff[k]
      const next: ServiceCatalog = { ...item, rolloff }
      get().mutateDb(db => ({ ...db, catalog: db.catalog.map(c => (c.id === catalogId ? next : c)) }))
      return next
    },

    updateRolloffPolicy({ patch }) {
      const current = get().db.rolloffPolicy[0]
      if (!current) throw new Error('No roll-off policy row')
      const nums = [patch.freeRadiusMiles, patch.tripCentsPerMile, patch.swapCents, patch.relocationCents, patch.dryRunCents, ...(patch.prohibitedItems ?? []).map(i => i.cents)]
      if (nums.some(n => n !== undefined && (!Number.isFinite(n) || n < 0))) throw new Error('Miles and amounts cannot be negative')
      const next: RolloffPolicy = { ...current, ...patch }
      get().mutateDb(db => ({ ...db, rolloffPolicy: [next, ...db.rolloffPolicy.slice(1)] }))
      return next
    },

    saveRolloffMaterial(args) {
      const { db } = get()
      if (!args.name.trim()) throw new Error('Give the material a name')
      const existing = args.id ? db.rolloffMaterials.find(m => m.id === args.id) : undefined
      if (args.id && !existing) throw new Error(`Unknown material ${args.id}`)
      if ((args.handling === 'standard') !== (existing?.handling === 'standard')) throw new Error('Exactly one material is the standard one; it is priced by the haul rate itself')
      const { id: _id, ...fields } = args
      const material: RolloffMaterial = { ...fields, id: existing?.id ?? uniqueId('mat', args.name, new Set(db.rolloffMaterials.map(m => m.id))), ticketCodes: args.ticketCodes.map(c => c.trim()).filter(Boolean) }
      get().mutateDb(x => ({ ...x, rolloffMaterials: existing ? x.rolloffMaterials.map(m => (m.id === material.id ? material : m)) : [...x.rolloffMaterials, material] }))
      return material
    },

    saveServiceCategory({ id, name, lob, description }) {
      const { db } = get()
      if (!name.trim()) throw new Error('Give the category a name')
      const existing = id ? db.serviceCategories.find(c => c.id === id) : undefined
      if (id && !existing) throw new Error(`Unknown category ${id}`)
      if (existing && existing.lob !== lob && db.catalog.some(c => c.categoryId === existing.id)) {
        throw new Error(`${existing.name} has services that bill as ${existing.lob}; move them first`)
      }
      const category: ServiceCategory = { id: existing?.id ?? uniqueId('sc', name, new Set(db.serviceCategories.map(c => c.id))), name: name.trim(), lob, ...(description?.trim() ? { description: description.trim() } : {}) }
      get().mutateDb(x => ({ ...x, serviceCategories: existing ? x.serviceCategories.map(c => (c.id === category.id ? category : c)) : [...x.serviceCategories, category] }))
      return category
    },

    saveService(args) {
      const { db } = get()
      const category = db.serviceCategories.find(c => c.id === args.categoryId)
      if (!category) throw new Error('Pick a category')
      if (!args.name.trim()) throw new Error('Give the service a name')
      if (!args.sizeLabel.trim()) throw new Error('Give the size, for example 96 gal or 3 yd')
      const dimIds = new Set(db.pricingDimensions.map(d => d.id))
      const unknown = args.pricedBy.filter(d => !dimIds.has(d))
      if (unknown.length) throw new Error(`Unknown dimension ${unknown.join(', ')}`)
      const existing = args.id ? db.catalog.find(c => c.id === args.id) : undefined
      if (args.id && !existing) throw new Error(`Unknown service ${args.id}`)
      if (existing && existing.lob !== category.lob) throw new Error(`${existing.name} bills as ${existing.lob}; pick a ${existing.lob} category`)
      if (category.lob === 'rolloff' && !args.rolloff) throw new Error('A roll-off service needs its included tons and days')
      if (args.quantityField && db.pricingDimensions.find(d => d.id === args.quantityField)?.type !== 'number') {
        throw new Error('A price can only be multiplied by a number field')
      }
      const item: ServiceCatalog = {
        id: existing?.id ?? uniqueId('cat', args.name, new Set(db.catalog.map(c => c.id))),
        lob: category.lob, name: args.name.trim(), sizeLabel: args.sizeLabel.trim(), unit: args.unit, public: args.public,
        categoryId: category.id, priceUnit: args.priceUnit, pricedBy: [...args.pricedBy],
        ...(args.quantityField ? { quantityField: args.quantityField } : {}),
        ...(args.description?.trim() ? { description: args.description.trim() } : {}),
        ...(category.lob === 'rolloff' && args.rolloff ? { rolloff: args.rolloff } : {}),
      }
      get().mutateDb(x => ({ ...x, catalog: existing ? x.catalog.map(c => (c.id === item.id ? item : c)) : [...x.catalog, item] }))
      return item
    },

    saveDimension({ id, name, source, type, unit, values, defaultValueId, description }) {
      const { db, pricingDrafts } = get()
      if (!name.trim()) throw new Error('Give the field a name')
      const existing = id ? db.pricingDimensions.find(d => d.id === id) : undefined
      if (id && !existing) throw new Error(`Unknown dimension ${id}`)
      if (existing?.builtIn) {
        const next: PricingDimension = { ...existing, name: name.trim(), ...(description?.trim() ? { description: description.trim() } : {}) }
        get().mutateDb(x => ({ ...x, pricingDimensions: x.pricingDimensions.map(d => (d.id === next.id ? next : d)) }))
        return next
      }
      const src = existing?.source ?? source
      if (!src || !CUSTOM_SOURCES.includes(src)) throw new Error('Say where the value comes from: the account, the site, the service line, or the quote')
      // A field keeps its type: rates, rules, and assignments were written against it.
      const kind: FieldType = existing ? fieldTypeOf(existing) : (type ?? 'choice')
      if (existing && type && type !== kind) throw new Error(`${existing.name} is a ${FIELD_TYPE_LABEL[kind].toLowerCase()} field; add a new field for another type`)

      let resolved: PricingDimension['values'] = []
      if (kind === 'yesNo') resolved = YES_NO_VALUES.map(v => ({ ...v }))
      else if (kind !== 'text') {
        const list = (values ?? []).filter(v => v.label.trim())
        if (kind === 'choice' && list.length === 0) throw new Error('Add at least one value')
        const seen = new Set<string>()
        resolved = list.map(v => {
          const vid = v.id ?? slugify(v.label, 20)
          if (seen.has(vid)) throw new Error(`Two values are both "${v.label}"`)
          seen.add(vid)
          const label = v.label.trim()
          if (kind !== 'number') return { id: vid, label }
          if (v.min === undefined && v.max === undefined) throw new Error(`Give the band ${label} a low end, a high end, or both`)
          if (v.min !== undefined && v.max !== undefined && !(v.min < v.max)) throw new Error(`${label}: the low end must be below the high end`)
          return { id: vid, label, ...(v.min !== undefined ? { min: v.min } : {}), ...(v.max !== undefined ? { max: v.max } : {}) }
        })
        if (kind === 'number') {
          // Bands may leave gaps (a number in a gap keys no band) but may not overlap, or one number would key two.
          const sorted = [...resolved].sort((a, b) => (a.min ?? -Infinity) - (b.min ?? -Infinity))
          for (let i = 1; i < sorted.length; i += 1) {
            if ((sorted[i - 1].max ?? Infinity) > (sorted[i].min ?? -Infinity)) throw new Error(`The bands ${sorted[i - 1].label} and ${sorted[i].label} overlap`)
          }
        }
      }
      const taken = new Set(resolved.map(v => v.id))
      if (existing) {
        const usage = dimensionUsage(db, existing.id, pricingDrafts)
        const dropped = existing.values.filter(v => !taken.has(v.id) && (usage.get(v.id) ?? 0) > 0)
        if (dropped.length) throw new Error(`${dropped.map(v => v.label).join(', ')} is still used by rates, rules, or assignments`)
      }
      if (defaultValueId) {
        if (kind === 'number' && !Number.isFinite(Number(defaultValueId))) throw new Error('The default must be a number')
        if ((kind === 'choice' || kind === 'yesNo') && !taken.has(defaultValueId)) throw new Error('The default must be one of the values')
      }
      const dim: PricingDimension = {
        id: existing?.id ?? uniqueId('dim', name, new Set(db.pricingDimensions.map(d => d.id))).replace(/^dim_/, '').replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
        name: name.trim(), source: src,
        ...(kind !== 'choice' ? { type: kind } : {}),
        ...(kind === 'number' && unit?.trim() ? { unit: unit.trim() } : {}),
        values: resolved,
        ...(defaultValueId ? { defaultValueId: kind === 'number' ? String(Number(defaultValueId)) : defaultValueId } : {}),
        ...(existing?.assignments ? { assignments: existing.assignments } : {}),
        ...(description?.trim() ? { description: description.trim() } : {}),
      }
      if (!existing && db.pricingDimensions.some(d => d.id === dim.id)) dim.id = `${dim.id}${db.pricingDimensions.length}`
      get().mutateDb(x => ({ ...x, pricingDimensions: existing ? x.pricingDimensions.map(d => (d.id === dim.id ? dim : d)) : [...x.pricingDimensions, dim] }))
      return dim
    },

    assignDimensionValue({ dimensionId, targetId, valueId }) {
      const { db } = get()
      const dim = db.pricingDimensions.find(d => d.id === dimensionId)
      if (!dim || (dim.source !== 'account' && dim.source !== 'site' && dim.source !== 'serviceLine')) {
        throw new Error(`${dimensionId} is not set on accounts, sites, or service lines`)
      }
      const exists = dim.source === 'account' ? db.accounts.some(a => a.id === targetId)
        : dim.source === 'site' ? db.sites.some(s => s.id === targetId)
          : db.serviceItems.some(si => si.id === targetId)
      if (!exists) throw new Error(`Unknown ${dim.source === 'serviceLine' ? 'service line' : dim.source} ${targetId}`)
      // A number field stores the number (priced by the band it falls in), a text field the text, the others a value id.
      const kind = fieldTypeOf(dim)
      const raw = valueId === null ? '' : valueId.trim()
      if (raw !== '') {
        if (kind === 'number' && !Number.isFinite(Number(raw))) throw new Error(`${dim.name} takes a number`)
        if ((kind === 'choice' || kind === 'yesNo') && !dim.values.some(v => v.id === raw)) throw new Error(`Unknown value ${raw}`)
      }
      const stored = kind === 'number' && raw !== '' ? String(Number(raw)) : raw
      const assignments = { ...(dim.assignments ?? {}) }
      if (stored === '' || stored === dim.defaultValueId) delete assignments[targetId]
      else assignments[targetId] = stored
      const next: PricingDimension = { ...dim, assignments }
      get().mutateDb(x => ({ ...x, pricingDimensions: x.pricingDimensions.map(d => (d.id === dim.id ? next : d)) }))
      return next
    },

    saveGeoZone({ id, name, polygon, color, description }) {
      const { db } = get()
      if (!name.trim()) throw new Error('Give the zone a name')
      if (polygon.length < 3) throw new Error('Draw at least three points around the area')
      for (const [lat, lng] of polygon) {
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('A point is off the map')
      }
      const existing = id ? db.geoZones.find(z => z.id === id) : undefined
      if (id && !existing) throw new Error(`Unknown zone ${id}`)
      const kept = color ?? existing?.color
      const zone: GeoZone = {
        id: existing?.id ?? uniqueId('gz', name, new Set(db.geoZones.map(z => z.id))),
        name: name.trim(),
        polygon: polygon.map(([lat, lng]) => [round6(lat), round6(lng)] as [number, number]),
        ...(kept ? { color: kept } : {}),
        ...(description?.trim() ? { description: description.trim() } : {}),
      }
      get().mutateDb(x => ({ ...x, geoZones: existing ? x.geoZones.map(z => (z.id === zone.id ? zone : z)) : [...x.geoZones, zone] }))
      return zone
    },

    deleteGeoZone({ id }) {
      const { db, pricingDrafts } = get()
      const zone = db.geoZones.find(z => z.id === id)
      if (!zone) throw new Error(`Unknown zone ${id}`)
      if ((dimensionUsage(db, 'geoZone', pricingDrafts).get(id) ?? 0) > 0) throw new Error(`Rates or adjustments still use ${zone.name}; change them first`)
      get().mutateDb(x => ({ ...x, geoZones: x.geoZones.filter(z => z.id !== id) }))
    },

    moveGeoZone({ id, direction }) {
      const list = [...get().db.geoZones]
      const i = list.findIndex(z => z.id === id)
      if (i < 0) throw new Error(`Unknown zone ${id}`)
      const j = direction === 'up' ? i - 1 : i + 1
      if (j < 0 || j >= list.length) return
      ;[list[i], list[j]] = [list[j], list[i]]
      get().mutateDb(x => ({ ...x, geoZones: list }))
    },

    saveZone({ id, name, serviceability, franchiseFeePct, deliveryFeeCents, publicPricing, taxRatePct, today: day }) {
      const { db } = get()
      if (!name.trim()) throw new Error('Give the zone a name')
      if (publicPricing && serviceability === 'notServed') throw new Error('A zone that is not served cannot be priced publicly')
      if (![franchiseFeePct, deliveryFeeCents, taxRatePct ?? 0].every(n => Number.isFinite(n) && n >= 0)) throw new Error('Rates and fees cannot be negative')
      const existing = id ? db.zones.find(z => z.id === id) : undefined
      if (id && !existing) throw new Error(`Unknown zone ${id}`)
      const zone: Zone = {
        id: existing?.id ?? uniqueId('zone', name, new Set(db.zones.map(z => z.id))),
        name: name.trim(), serviceability, taxRatePct: existing?.taxRatePct ?? taxRatePct ?? 0, franchiseFeePct, deliveryFeeCents: Math.round(deliveryFeeCents), publicPricing,
      }
      let taxRules = db.taxRules
      if (!existing && (taxRatePct ?? 0) > 0) {
        const d = dateOnly(day ?? today())
        taxRules = withRuleVersion(db.taxRules, { zoneId: zone.id, ratePct: taxRatePct, appliesTo: ['recurring', 'event', 'fee'], name: 'Sales tax', jurisdiction: 'state' }, {
          id: uniqueId('tax', zone.id.replace(/^zone_/, ''), new Set(db.taxRules.map(r => r.id))), effectiveFrom: d,
        }).rows
      }
      get().mutateDb(x => ({ ...x, zones: existing ? x.zones.map(z => (z.id === zone.id ? zone : z)) : [...x.zones, zone], taxRules }))
      return zone
    },
  }
}
