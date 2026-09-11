/**
 * The rate tools of the Ratebook (DECISIONS.md entry 65): the Add rate form and the bulk adjust
 * drawer (Adjust rates by x%). Every rate they write goes through the pricing slice as a draft RateVersion and bills nobody until it is
 * published from the drafts tray. The one exception is Add rate's "Publish now", offered only for a rate for new
 * service only (DECISIONS.md entry 67), which by construction moves no current line. The props are the contract the
 * Ratebook shell calls them with.
 */
import { useMemo, useState } from 'react'
import type { RateVersion, ServiceCatalog } from '../../../types'
import type { Db } from '../../../store/db'
import { useStore } from '../../../store/useStore'
import { lineDims, rateDimsMatch } from '../../../store/engine'
import {
  dimensionLabel, PRICE_UNIT_LABEL, PRICE_UNIT_SHORT, priceFor, pricedByOf, priceUnitOf, rateFieldsOf,
  servicesByCategory, valueLabel, valuesOf,
} from '../lib/config'
import { rateGroupKey } from '../lib/rateVersions'
import { newestFirst } from '../lib/ratebook'
import { dateOnly, firstOfNextMonth } from '../lib/dates'
import { formatCents, formatPct } from '../lib/money'
import {
  attempt, BUTTON_PRIMARY, BUTTON_SECONDARY, Drawer, Field, FormSection, INPUT, MoneyInput, NumberInput, Problems, Select,
  type Option,
} from './form'

type Values = Record<string, string>
type RateFields = ReturnType<typeof rateFieldsOf>

const PREVIEW_ROWS = 50

// ---------------------------------------------------------------------------
// Helpers shared by the tools
// ---------------------------------------------------------------------------

/** Services grouped by category, each labelled with what one unit of its price buys. */
export function serviceOptions(db: Db): Option[] {
  return servicesByCategory(db).flatMap(g =>
    g.items.map(item => ({ value: item.id, label: `${item.name} (${PRICE_UNIT_LABEL[priceUnitOf(item)]})`, group: g.category?.name ?? 'Other' })),
  )
}

/** Only the values of the dimensions the service is priced by, with blanks (Any) dropped. */
function pickValues(values: Values, pricedBy: string[]): Values {
  return Object.fromEntries(pricedBy.filter(d => !!values[d]).map(d => [d, values[d]]))
}

/** The newest published version of each rate line of one service, by rateGroupKey. */
function newestByKey(db: Db, catalogId: string): Map<string, RateVersion> {
  const out = new Map<string, RateVersion>()
  for (const rv of db.rateVersions) {
    if (rv.catalogId !== catalogId || rv.status !== 'published') continue
    const key = rateGroupKey(rv)
    const cur = out.get(key)
    if (!cur || newestFirst(rv, cur) < 0) out.set(key, rv)
  }
  return out
}

/** "Open market, weekly, Customer tier VIP" for a rate's zone, frequency, and extra dimensions. */
function rateLabel(db: Db, rv: Pick<RateVersion, 'zoneId' | 'frequency' | 'dims'>): string {
  return [
    rv.zoneId ? valueLabel(db, 'zone', rv.zoneId) : 'All zone types',
    rv.frequency ? valueLabel(db, 'frequency', rv.frequency) : 'any frequency',
    ...Object.entries(rv.dims ?? {}).map(([d, v]) => `${dimensionLabel(db, d)} ${valueLabel(db, d, v)}`),
  ].join(', ')
}

/** "Open market, weekly, any customer tier": every dimension the service is priced by, Any where none is chosen. */
function comboLabel(db: Db, pricedBy: string[], values: Values): string {
  return pricedBy.map(d => (values[d] ? valueLabel(db, d, values[d]) : `any ${dimensionLabel(db, d).toLowerCase()}`)).join(', ')
}

/**
 * Active service lines of one service that carry every value of the combination today: site zone, line frequency,
 * and the line's dimension values (lineDims). Only that service's lines are read. `starting` counts the ones that
 * start on or after `from`: a rate for new service only bills those and leaves the rest on their current price.
 */
function countMatchingLines(db: Db, item: ServiceCatalog, fields: RateFields, today: string, from: string): { all: number; starting: number } {
  const sites = new Map(db.sites.map(s => [s.id, s] as const))
  let n = 0
  let starting = 0
  for (const si of db.serviceItems) {
    if (si.catalogId !== item.id || si.status !== 'active') continue
    if (fields.frequency && si.frequency !== fields.frequency) continue
    const site = sites.get(si.siteId)
    if (!site) continue
    if (fields.zoneId && site.zoneId !== fields.zoneId) continue
    if (fields.dims) {
      const ctx = lineDims({
        siteId: site.id, catalogId: item.id, frequency: si.frequency, zoneId: site.zoneId, onDate: today,
        lineType: item.lob === 'rolloff' ? 'event' : 'recurring',
      }, db)
      if (!rateDimsMatch(fields.dims, ctx)) continue
    }
    n += 1
    if (dateOnly(si.effectiveFrom) >= from) starting += 1
  }
  return { all: n, starting }
}

const dimCount = (r: { dims?: Record<string, string> }) => Object.keys(r.dims ?? {}).length

/**
 * How a new rate with these fields competes with the rate that bills the combination today. The engine takes zone
 * rates before rates with no zone, then the rate with the most dimension values, then the latest effective.
 */
function specificity(fields: RateFields, billing: RateVersion): 'more' | 'same' | 'less' {
  const tierNew = fields.zoneId ? 1 : 0
  const tierCur = billing.zoneId ? 1 : 0
  if (tierNew !== tierCur) return tierNew > tierCur ? 'more' : 'less'
  const a = dimCount(fields)
  const b = dimCount(billing)
  return a > b ? 'more' : a < b ? 'less' : 'same'
}

function dateProblem(effectiveFrom: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) return 'Pick an effective date'
  if (effectiveFrom < today) return `Effective date cannot be before today (${today})`
  return null
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const signedCents = (c: number) => (c > 0 ? `+${formatCents(c)}` : formatCents(c))

export function EffectiveDate({ value, onChange, today, hint }: { value: string; onChange: (v: string) => void; today: string; hint?: string }) {
  return (
    <Field label="Effective from" hint={hint ?? 'Defaults to the first of next month. Cannot be before today.'}>
      <input type="date" value={value} min={today} onChange={e => onChange(e.target.value)} aria-label="Effective from" className={`${INPUT} font-mono`} />
    </Field>
  )
}

/** Who a new rate bills (RateVersion.appliesTo, DECISIONS.md entry 67). */
type Audience = NonNullable<RateVersion['appliesTo']>

const AUDIENCES: { value: Audience; label: string; hint: string }[] = [
  {
    value: 'newService',
    label: 'New service only',
    hint: 'Current customers keep their price. Service that starts on or after the effective date pays this rate, and so do new quotes and sign-ups.',
  },
  {
    value: 'everyone',
    label: 'Everyone on this line',
    hint: 'Every active line with these values moves to this price on the effective date, except where a contract price wins.',
  },
]

/** A new-service-only rate moves no current line, so it can take effect today; one for everyone waits for next month. */
const defaultEffectiveFrom = (audience: Audience, today: string) => (audience === 'newService' ? today : firstOfNextMonth(today))

const NEW_SERVICE_DATE_HINT = 'Defaults to today: current customers keep their price, so the rate can take effect now. Cannot be before today.'

export function AudienceField({ value, onChange, name }: { value: Audience; onChange: (v: Audience) => void; name: string }) {
  return (
    <fieldset aria-label="Who pays this rate" className="space-y-1.5">
      <legend className="mb-1.5 text-small font-semibold text-ink">Who pays this rate</legend>
      {AUDIENCES.map(o => (
        <label
          key={o.value}
          className={['flex cursor-pointer items-start gap-2 rounded-card border px-3 py-2', value === o.value ? 'border-accent bg-accent-soft' : 'border-line bg-surface'].join(' ')}
        >
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="mt-1 h-4 w-4 accent-[var(--rt-color-accent)]" />
          <span>
            <span className="block text-body font-semibold text-ink">{o.label}</span>
            <span className="block text-small text-muted">{o.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}

/** Audience and effective date together: switching audience moves the date to that audience's default until it is edited. */
function useAudience(today: string, initial: Audience = 'newService') {
  const [audience, setAudience] = useState<Audience>(initial)
  const [effectiveFrom, setDate] = useState(defaultEffectiveFrom(initial, today))
  const [touched, setTouched] = useState(false)
  return {
    audience,
    effectiveFrom,
    chooseAudience: (a: Audience) => {
      setAudience(a)
      if (!touched) setDate(defaultEffectiveFrom(a, today))
    },
    setEffectiveFrom: (v: string) => {
      setDate(v)
      setTouched(true)
    },
    dateHint: audience === 'newService' ? NEW_SERVICE_DATE_HINT : undefined,
  }
}

// ---------------------------------------------------------------------------
// RateForm
// ---------------------------------------------------------------------------

export interface RateFormProps {
  today: string
  /** Prefill: a service, values for its dimensions (zone, frequency, and any others), and a price. */
  initial?: { catalogId?: string; values?: Record<string, string>; priceCents?: number }
  /** 'edit' opens on an existing line: titled Edit rate, bills everyone on the line by default, and replaces its pending draft. */
  mode?: 'add' | 'edit'
  onClose: () => void
  onSaved: (draft: RateVersion) => void
  /** A new-service-only rate published straight from the form ("Publish now"). Omit to offer drafts only. */
  onPublished?: (published: RateVersion) => void
}

/** What saving a rate did: a draft, a published version, or the problems it refused with (already set on the form). */
export type RateSaveResult = { kind: 'draft'; rate: RateVersion } | { kind: 'published'; rate: RateVersion } | { kind: 'refused' }

/**
 * The state and rules of one new or edited rate, shared by the Add rate form and the New rate section: service,
 * dimension values, price, audience, and date; the "What this does" lines; and save, which drafts it and, for a
 * new-service-only rate asked to publish, publishes it too.
 */
export function useRateDraft({ today, initial, mode = 'add', anyField = false }: Pick<RateFormProps, 'today' | 'initial' | 'mode'> & { anyField?: boolean }) {
  const editing = mode === 'edit'
  const db = useStore(s => s.db)
  const drafts = useStore(s => s.pricingDrafts)
  const createDraftRateVersion = useStore(s => s.createDraftRateVersion)
  const publishRateVersions = useStore(s => s.publishRateVersions)
  const discardDraft = useStore(s => s.discardDraftRateVersion)

  const [catalogId, setCatalogId] = useState(initial?.catalogId ?? '')
  const [values, setValues] = useState<Values>(initial?.values ?? {})
  const [priceCents, setPriceCents] = useState<number | undefined>(initial?.priceCents)
  const { audience, chooseAudience, effectiveFrom, setEffectiveFrom, dateHint } = useAudience(today, editing ? 'everyone' : 'newService')
  const forNew = audience === 'newService'
  const [problems, setProblems] = useState<string[]>([])

  const item = db.catalog.find(c => c.id === catalogId)
  const pricedBy = item ? pricedByOf(item) : []
  const unit = item ? priceUnitOf(item) : 'month'
  // anyField: every field given a value keys the rate, not only the service's rate columns (New rate adds the new ones).
  const chosen = anyField ? Object.fromEntries(Object.entries(values).filter(([, v]) => !!v)) : pickValues(values, pricedBy)
  const fields = rateFieldsOf(chosen)
  const key = item ? rateGroupKey({ catalogId: item.id, ...fields }) : ''
  const billing = item ? priceFor(db, item.id, chosen, today) : undefined
  const exact = item ? newestByKey(db, item.id).get(key) : undefined
  const pending = item ? drafts.find(d => rateGroupKey(d) === key) : undefined
  const lines = item ? countMatchingLines(db, item, fields, today, effectiveFrom) : { all: 0, starting: 0 }

  const refuse = (p: string[]): RateSaveResult => {
    setProblems(p)
    return { kind: 'refused' }
  }

  /** The first problem that stops a save, or null. */
  const problemFor = (): string | null => {
    if (!item) return 'Pick a service'
    if (priceCents === undefined || priceCents <= 0) return 'Enter a price above $0.00'
    return dateProblem(effectiveFrom, today)
  }

  const save = (publish: boolean): RateSaveResult => {
    const p = problemFor()
    if (p || !item || priceCents === undefined) return refuse([p ?? 'Pick a service'])
    // Editing a line replaces its pending draft, as saving a price in the sheet does.
    if (editing && pending) discardDraft({ id: pending.id })
    const r = attempt(() =>
      createDraftRateVersion({ catalogId: item.id, ...fields, priceCents, effectiveFrom, appliesTo: audience, ...(exact ? { supersedesId: exact.id } : {}) }),
    )
    if (!r.ok) return refuse(r.problems)
    if (!publish) return { kind: 'draft', rate: r.value }
    const [published] = publishRateVersions({ draftIds: [r.value.id] })
    if (!published) {
      // publishRateVersions leaves a draft that repeats the superseded price; do not leave one behind from this form.
      discardDraft({ id: r.value.id })
      return refuse([`${formatCents(priceCents)} is already the price of ${exact?.id ?? 'this line'}, so there is nothing to publish`])
    }
    return { kind: 'published', rate: published }
  }

  const effect: string[] = []
  if (item) {
    const combo = comboLabel(db, [...new Set([...pricedBy, ...Object.keys(chosen)])], chosen)
    effect.push(
      billing
        ? `Today ${combo} bills ${formatCents(billing.cents)}${PRICE_UNIT_SHORT[unit]}${billing.rate ? ` from ${billing.rate.id} (${rateLabel(db, billing.rate)})` : ''}.`
        : `Nothing bills ${combo} today. This would be its first price.`,
    )
    effect.push(
      exact
        ? `A line with exactly these values exists. This draft supersedes its newest version, ${exact.id} (${formatCents(exact.priceCents)} from ${exact.effectiveFrom}).`
        : 'No line has exactly these values, so this opens a new rate line.',
    )
    if (billing?.rate && rateGroupKey(billing.rate) !== key) {
      const s = specificity(fields, billing.rate)
      effect.push(
        s === 'more'
          ? `More specific than ${billing.rate.id}, so from ${effectiveFrom} it wins for ${forNew ? 'new service' : 'lines'} with these values.`
          : s === 'same'
            ? `As specific as ${billing.rate.id}; being the newer rate, it takes over ${forNew ? 'for new service ' : ''}from ${effectiveFrom}.`
            : `Less specific than ${billing.rate.id}, which keeps billing these values. This rate only prices lines no more specific rate covers.`,
      )
    }
    if (forNew) {
      const current = lines.all - lines.starting
      effect.push(
        `${plural(current, 'current service line')} of this service ${current === 1 ? 'has these values and keeps its' : 'have these values and keep their'} current price. ` +
          `Only service starting on or after ${effectiveFrom}, and new quotes and sign-ups, pay this rate.`,
      )
      if (lines.starting > 0) {
        effect.push(`${plural(lines.starting, 'scheduled line')} with these values ${lines.starting === 1 ? 'starts' : 'start'} on or after ${effectiveFrom}, so ${lines.starting === 1 ? 'it counts' : 'they count'} as new service and will pay this rate.`)
      }
    } else {
      effect.push(`${plural(lines.all, 'active service line')} of this service ${lines.all === 1 ? 'has' : 'have'} these values today and will pay this rate from ${effectiveFrom}. Contract prices still win where an account has one.`)
    }
    if (pending) {
      effect.push(
        editing
          ? `A draft for this line is already pending (${pending.id}). Saving replaces it.`
          : `A draft for this line is already pending (${pending.id}). Discard it from the drafts tray if this one replaces it.`,
      )
    }
  }

  return {
    db, item, unit, pricedBy, chosen, catalogId, values, priceCents, audience, forNew, effectiveFrom, dateHint, problems, effect,
    pickService: (v: string) => {
      setCatalogId(v)
      setProblems([])
    },
    setValue: (d: string, v: string) => setValues(prev => ({ ...prev, [d]: v })),
    setPriceCents,
    chooseAudience,
    setEffectiveFrom,
    setProblems,
    problemFor,
    save,
  }
}

/**
 * "Add a rate": pick a service (grouped by category), a value or Any for each dimension it is priced by, a price in
 * its unit, and a date. The "What this does" panel says what the combination bills today and from which rate, whether
 * the draft supersedes an existing line with exactly these values (it then carries that line's newest version as
 * supersedesId), whether it is specific enough to win over today's rate, and how many active service lines have these
 * values. "Who pays this rate" defaults to new service only, effective today: current customers keep their price.
 * Saving creates one draft; for a new-service-only rate, "Publish now" also publishes it, since it moves no current line.
 */
export function RateForm({ today, initial, mode = 'add', onClose, onSaved, onPublished }: RateFormProps) {
  const editing = mode === 'edit'
  const r = useRateDraft({ today, ...(initial ? { initial } : {}), mode })
  const { db, item, unit, pricedBy, catalogId, values, priceCents, audience, forNew, effectiveFrom, dateHint, problems, effect } = r
  const options = useMemo(() => serviceOptions(db), [db])

  const save = (publish: boolean) => {
    const result = r.save(publish)
    if (result.kind === 'draft') onSaved(result.rate)
    else if (result.kind === 'published') onPublished?.(result.rate)
  }

  return (
    <Drawer
      title={editing ? 'Edit rate' : 'Add a rate'}
      eyebrow={editing && item ? `Rates, ${item.name}` : 'Rates'}
      subtitle={
        forNew && onPublished
          ? 'Current customers keep their price. Publish it now, or save a draft to publish later.'
          : editing
            ? 'Change the price, the values it is keyed by, who pays it, or when. Your change is a draft until you publish it from the drafts tray.'
            : 'A new rate is a draft until you publish it from the drafts tray.'
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className={BUTTON_SECONDARY} onClick={onClose}>Cancel</button>
          {forNew && onPublished ? (
            <>
              <button type="button" className={BUTTON_SECONDARY} onClick={() => save(false)}>Save draft</button>
              <button type="button" className={BUTTON_PRIMARY} onClick={() => save(true)}>Publish now</button>
            </>
          ) : (
            <button type="button" className={BUTTON_PRIMARY} onClick={() => save(false)}>Save draft</button>
          )}
        </>
      }
    >
      <Field label="Service">
        <Select value={catalogId} onChange={r.pickService} options={options} ariaLabel="Service" placeholder="Pick a service" />
      </Field>

      {item && (
        <FormSection title="Keyed by" hint="Leave a dimension at Any to price every value of it.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {pricedBy.map(d => {
              const label = dimensionLabel(db, d)
              return (
                <Field key={d} label={label}>
                  <Select
                    value={values[d] ?? ''}
                    onChange={v => r.setValue(d, v)}
                    options={valuesOf(db, d).map(v => ({ value: v.id, label: v.label }))}
                    ariaLabel={label}
                    placeholder={`Any ${label.toLowerCase()}`}
                  />
                </Field>
              )
            })}
          </div>
        </FormSection>
      )}

      <AudienceField value={audience} onChange={r.chooseAudience} name="rate-form-audience" />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={`Price ${PRICE_UNIT_LABEL[unit]}`}>
          <MoneyInput cents={priceCents} onChange={r.setPriceCents} ariaLabel={`Price ${PRICE_UNIT_LABEL[unit]}`} />
        </Field>
        <EffectiveDate value={effectiveFrom} onChange={r.setEffectiveFrom} today={today} {...(dateHint ? { hint: dateHint } : {})} />
      </div>

      {item && (
        <section aria-label="What this does" data-testid="rate-effect" className="rounded-card border border-line bg-surface-muted px-4 py-3">
          <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">What this does</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-small text-ink">
            {effect.map(line => <li key={line}>{line}</li>)}
          </ul>
        </section>
      )}

      <Problems problems={problems} />
    </Drawer>
  )
}

// ---------------------------------------------------------------------------
// BulkAdjustDrawer
// ---------------------------------------------------------------------------

export interface BulkAdjustProps {
  today: string
  /** The newest published version of each rate line shown. */
  rateVersionIds: string[]
  /** "14 rate lines shown: Residential, Open market". */
  scopeLabel: string
  onClose: () => void
  onCreated: (drafts: RateVersion[]) => void
}

/**
 * "Adjust rates by x%": a percentage (negative for a decrease) and a date, applied to the newest published
 * version of each rate line the table shows. The preview lists the first 50 lines with the new price,
 * round(price x (100 + pct) / 100), and the difference, then a total. Creating replaces any pending drafts on those
 * lines with one draft each that supersedes the version shown.
 */
export function BulkAdjustDrawer({ today, rateVersionIds, scopeLabel, onClose, onCreated }: BulkAdjustProps) {
  const db = useStore(s => s.db)
  const drafts = useStore(s => s.pricingDrafts)
  const createAdjustDrafts = useStore(s => s.createAdjustDrafts)

  const [pct, setPct] = useState<number | undefined>(undefined)
  const [effectiveFrom, setEffectiveFrom] = useState(firstOfNextMonth(today))
  const [problems, setProblems] = useState<string[]>([])

  const rates = useMemo(() => {
    const byId = new Map(db.rateVersions.map(rv => [rv.id, rv] as const))
    return rateVersionIds.map(id => byId.get(id)).filter((rv): rv is RateVersion => !!rv && rv.status === 'published')
  }, [db, rateVersionIds])
  const catalog = useMemo(() => new Map(db.catalog.map(c => [c.id, c] as const)), [db])
  const replaced = useMemo(() => {
    const keys = new Set(rates.map(rateGroupKey))
    return drafts.filter(d => keys.has(rateGroupKey(d))).length
  }, [rates, drafts])

  const p = pct ?? 0
  const valid = Number.isFinite(p) && p !== 0 && p > -100
  const next = (cents: number) => (valid ? Math.round((cents * (100 + p)) / 100) : cents)
  const totalNow = rates.reduce((n, rv) => n + rv.priceCents, 0)
  const totalNext = rates.reduce((n, rv) => n + next(rv.priceCents), 0)

  const create = () => {
    if (pct === undefined || !Number.isFinite(pct) || pct === 0) return setProblems(['Enter a percentage other than 0'])
    if (pct <= -100) return setProblems(['A decrease must be less than 100%'])
    const dp = dateProblem(effectiveFrom, today)
    if (dp) return setProblems([dp])
    if (rates.length === 0) return setProblems(['No published rate lines are shown'])
    const r = attempt(() => createAdjustDrafts({ rateVersionIds: rates.map(rv => rv.id), pct, effectiveFrom }))
    if (!r.ok) return setProblems(r.problems)
    onCreated(r.value)
  }

  return (
    <Drawer
      title="Adjust rates by a percentage"
      eyebrow="Rates"
      subtitle={scopeLabel}
      width={720}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={BUTTON_SECONDARY} onClick={onClose}>Cancel</button>
          <button type="button" className={BUTTON_PRIMARY} disabled={!valid || rates.length === 0} onClick={create}>
            Create {plural(rates.length, 'draft')}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Change by" hint="Negative for a decrease.">
          <NumberInput value={pct} onChange={setPct} ariaLabel="Adjust by percent" suffix="%" />
        </Field>
        <EffectiveDate value={effectiveFrom} onChange={setEffectiveFrom} today={today} />
      </div>
      {replaced > 0 && <p className="text-small text-warning">Replaces {plural(replaced, 'pending draft')} on these lines.</p>}

      <div className="overflow-x-auto rounded-card border border-line">
        <table className="w-full min-w-[600px] text-left text-body" data-testid="adjust-preview">
          <thead className="bg-surface-muted text-small text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">Service</th>
              <th className="px-3 py-2 font-semibold">Keyed by</th>
              <th className="px-3 py-2 text-right font-semibold">Current</th>
              <th className="px-3 py-2 text-right font-semibold">New</th>
              <th className="px-3 py-2 text-right font-semibold">Difference</th>
            </tr>
          </thead>
          <tbody>
            {rates.slice(0, PREVIEW_ROWS).map(rv => {
              const item = catalog.get(rv.catalogId)
              const short = item ? PRICE_UNIT_SHORT[priceUnitOf(item)] : ''
              return (
                <tr key={rv.id} data-rate={rv.id} className="border-t border-line">
                  <td className="px-3 py-2 text-ink">{item?.name ?? rv.catalogId}</td>
                  <td className="px-3 py-2 text-small text-muted">{rateLabel(db, rv)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatCents(rv.priceCents)}{short}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatCents(next(rv.priceCents))}{short}</td>
                  <td className="px-3 py-2 text-right font-mono">{signedCents(next(rv.priceCents) - rv.priceCents)}</td>
                </tr>
              )
            })}
            {rates.length > PREVIEW_ROWS && (
              <tr className="border-t border-line">
                <td colSpan={5} className="px-3 py-2 text-small text-muted">and {rates.length - PREVIEW_ROWS} more</td>
              </tr>
            )}
          </tbody>
          <tfoot className="border-t border-line bg-surface-muted font-semibold">
            <tr data-testid="adjust-total">
              <td colSpan={2} className="px-3 py-2">Total of {plural(rates.length, 'line')}{valid ? `, ${p > 0 ? '+' : ''}${formatPct(p)}` : ''}</td>
              <td className="px-3 py-2 text-right font-mono">{formatCents(totalNow)}</td>
              <td className="px-3 py-2 text-right font-mono">{formatCents(totalNext)}</td>
              <td className="px-3 py-2 text-right font-mono">{signedCents(totalNext - totalNow)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <Problems problems={problems} />
    </Drawer>
  )
}
