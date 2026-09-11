import { useState } from 'react'
import type { LineType, TaxRule, Zone } from '../../../types'
import { useStore } from '../../../store/useStore'
import {
  BUTTON_LINK, BUTTON_PRIMARY, BUTTON_SECONDARY, Card, ChipPicker, Drawer, Field, FormSection, NumberInput, Problems, SectionHeader, Select, TextInput,
  attempt,
} from '../components/form'
import { LINE_TYPE_LABEL, ruleChains, ruleImpact, ruleState, validateTaxRule, whenText, withRuleVersion, type RuleChain, type TaxRuleInput } from '../lib/rules'
import { formatPct } from '../lib/money'
import { addDays, dateOnly, firstOfNextMonth } from '../lib/dates'
import {
  ConditionsEditor, DateInput, Group, ImpactPreview, StatePill, conditionProblems, conditionRowsOf, datesText, whenOf, type ConditionRow,
} from './AdjustmentForm'

type Jurisdiction = NonNullable<TaxRule['jurisdiction']>
const JURISDICTIONS: Jurisdiction[] = ['state', 'county', 'city', 'district']
const JURISDICTION_LABEL: Record<Jurisdiction, string> = { state: 'State', county: 'County', city: 'City', district: 'District' }
const TAXABLE_LINES: LineType[] = ['recurring', 'event', 'fee']

/** Sum of the unconditional layers in force today, and whether conditional layers add to it on some lines. */
function combinedRate(rules: TaxRule[], today: string): { pct: number; conditional: number } {
  const active = rules.filter(r => ruleState(r, today) === 'active')
  const plain = active.filter(r => !r.when || Object.keys(r.when).length === 0)
  return { pct: Number(plain.reduce((s, r) => s + r.ratePct, 0).toFixed(4)), conditional: active.length - plain.length }
}

/**
 * Add a tax layer to a zone, or change a layer's rate as a new version from a date (head given; the zone is fixed).
 * Late fees are never offered. Problems from validateTaxRule show under Save, which stays disabled until there are none.
 */
export function TaxForm({
  today, zoneId, head, onClose, onSaved, initialWhen, initialEffectiveFrom,
}: {
  today: string
  zoneId: string
  head?: TaxRule
  onClose: () => void
  onSaved: (rule: TaxRule) => void
  /** A new layer only: conditions and date to start from (New rate scopes one to its rate). */
  initialWhen?: Record<string, string[]>
  initialEffectiveFrom?: string
}) {
  const db = useStore(s => s.db)
  const saveTaxRule = useStore(s => s.saveTaxRule)
  const [zone, setZone] = useState(head?.zoneId ?? zoneId)
  const [name, setName] = useState(head?.name ?? '')
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>(head?.jurisdiction ?? 'city')
  const [ratePct, setRatePct] = useState<number | undefined>(head?.ratePct)
  const [appliesTo, setAppliesTo] = useState<LineType[]>(head?.appliesTo.filter(t => t !== 'lateFee') ?? [...TAXABLE_LINES])
  const [conditions, setConditions] = useState<ConditionRow[]>(conditionRowsOf(head ? head.when : initialWhen))
  const [effectiveFrom, setEffectiveFrom] = useState(
    !head && initialEffectiveFrom ? initialEffectiveFrom : firstOfNextMonth(head?.effectiveFrom && head.effectiveFrom > today ? head.effectiveFrom : today),
  )
  const [saveProblems, setSaveProblems] = useState<string[]>([])

  const when = whenOf(conditions)
  const input: TaxRuleInput = {
    zoneId: zone, ratePct: ratePct ?? Number.NaN, appliesTo, jurisdiction,
    ...(name.trim() ? { name: name.trim() } : {}),
    ...(when ? { when } : {}),
    ...(head?.status === 'paused' ? { status: 'paused' as const } : {}),
  }
  const problems = [...conditionProblems(db, conditions), ...validateTaxRule(input, effectiveFrom, today, new Set(db.zones.map(z => z.id)), head)]

  const save = () => {
    const r = attempt(() => saveTaxRule({ input, effectiveFrom, ...(head ? { previousId: head.id } : {}) }))
    if (!r.ok) {
      setSaveProblems(r.problems)
      return
    }
    onSaved(r.value)
  }

  const zoneName = db.zones.find(z => z.id === zone)?.name ?? zone
  return (
    <Drawer
      title={head ? `Edit ${head.name ?? head.id}` : `Add a tax layer to ${zoneName}`}
      eyebrow="Taxes"
      subtitle={head ? `Replaces ${head.id} from the date you pick. The current version is ended the day before and kept.` : "A zone's layers add up: state plus county plus city."}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={BUTTON_SECONDARY} onClick={onClose}>Cancel</button>
          <button type="button" className={BUTTON_PRIMARY} disabled={problems.length > 0} onClick={save}>
            {head ? 'Save new rate' : 'Save layer'}
          </button>
          {problems.length > 0 && (
            <ul className="w-full list-disc pl-5 text-small text-muted" data-testid="form-problems">
              {problems.map(p => <li key={p}>{p}</li>)}
            </ul>
          )}
        </>
      }
    >
      <Problems problems={saveProblems} />
      <FormSection title="Layer">
        <Field label="Zone type">
          <Select value={zone} onChange={setZone} ariaLabel="Zone type" disabled={!!head} options={db.zones.map(z => ({ value: z.id, label: z.name }))} />
        </Field>
        <Field label="Name">
          <TextInput value={name} onChange={setName} ariaLabel="Name" placeholder="City sales tax" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Jurisdiction">
            <Select value={jurisdiction} onChange={v => setJurisdiction(v as Jurisdiction)} ariaLabel="Jurisdiction" options={JURISDICTIONS.map(j => ({ value: j, label: JURISDICTION_LABEL[j] }))} />
          </Field>
          <Field label="Rate">
            <NumberInput value={ratePct} onChange={setRatePct} ariaLabel="Rate" suffix="%" min={0} />
          </Field>
        </div>
        <Group label="Applies to" hint="Late fees are never taxed.">
          <ChipPicker ariaLabel="Applies to" options={TAXABLE_LINES.map(t => ({ value: t, label: LINE_TYPE_LABEL[t] }))} value={appliesTo} onChange={v => setAppliesTo(v as LineType[])} />
        </Group>
      </FormSection>
      <FormSection title="When" hint="Optional. Leave empty to tax every line of the kinds above in this zone.">
        <ConditionsEditor rows={conditions} onChange={setConditions} />
      </FormSection>
      <FormSection title="Effective from" hint={head ? `Must be after ${head.effectiveFrom ?? 'the current version starts'}.` : 'Charges already computed keep their tax; posted invoices never change.'}>
        <DateInput value={effectiveFrom} onChange={setEffectiveFrom} ariaLabel="Effective from" />
      </FormSection>
      <FormSection title="Impact">
        <ImpactPreview
          signature={JSON.stringify([input, effectiveFrom])}
          disabled={problems.length > 0}
          notes={appliesTo.includes('recurring') ? [] : ['This layer does not tax recurring lines, so the next recurring run does not change.']}
          compute={() => ruleImpact(db, { taxRules: withRuleVersion(db.taxRules, input, { id: 'tax_preview', effectiveFrom, ...(head ? { previousId: head.id } : {}) }).rows }, effectiveFrom)}
        />
      </FormSection>
    </Drawer>
  )
}

/** End a tax layer after a last day (yesterday at the earliest). The row is kept with effectiveTo. */
function EndLayerDrawer({ today, rule, onClose, onEnded }: { today: string; rule: TaxRule; onClose: () => void; onEnded: (rule: TaxRule) => void }) {
  const endTaxRule = useStore(s => s.endTaxRule)
  const [lastDay, setLastDay] = useState(addDays(firstOfNextMonth(today), -1))
  const [problems, setProblems] = useState<string[]>([])
  const local = rule.effectiveFrom && dateOnly(lastDay) < dateOnly(rule.effectiveFrom) ? [`The last day is before this layer starts (${rule.effectiveFrom})`] : []
  const end = () => {
    const r = attempt(() => endTaxRule({ id: rule.id, lastDay }))
    if (!r.ok) {
      setProblems(r.problems)
      return
    }
    onEnded(r.value)
  }
  return (
    <Drawer
      title={`End ${rule.name ?? rule.id}`}
      eyebrow="Taxes"
      subtitle="The layer stops applying after the last day. It is kept, and charges already computed keep their tax."
      onClose={onClose}
      width={440}
      footer={
        <>
          <button type="button" className={BUTTON_SECONDARY} onClick={onClose}>Cancel</button>
          <button type="button" className={BUTTON_PRIMARY} disabled={local.length > 0} onClick={end}>End layer</button>
        </>
      }
    >
      <Problems problems={[...local, ...problems]} />
      <Field label="Last day" hint={`Yesterday (${addDays(today, -1)}) at the earliest.`}>
        <DateInput value={lastDay} onChange={setLastDay} ariaLabel="Last day" />
      </Field>
    </Drawer>
  )
}

/** One tax layer: its newest version with actions, and the version in force now when the newest is scheduled. */
function LayerRow({ chain, today, onChange, onEnd }: { chain: RuleChain<TaxRule>; today: string; onChange: (r: TaxRule) => void; onEnd: (r: TaxRule) => void }) {
  const db = useStore(s => s.db)
  const { head, older } = chain
  const inForce = ruleState(head, today) === 'scheduled' ? older.find(r => ruleState(r, today) === 'active') : undefined
  const conditions = whenText(db, head.when)
  const label = head.name ?? head.id
  return (
    <li className="border-t border-line px-5 py-3" data-layer={head.id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body font-semibold text-ink">{label}</span>
            {head.jurisdiction && <span className="text-small text-muted">{JURISDICTION_LABEL[head.jurisdiction]}</span>}
            <span className="font-mono text-eyebrow text-muted">{head.id}</span>
            <StatePill rule={head} today={today} />
          </div>
          <p className="mt-0.5 text-small text-ink">
            <span className="font-mono font-semibold">{formatPct(head.ratePct)}</span>
            <span className="text-muted"> on {head.appliesTo.map(t => LINE_TYPE_LABEL[t].toLowerCase()).join(', ')}, {datesText(head)}</span>
          </p>
          {conditions.length > 0 && <p className="text-small text-muted">Only when {conditions.join('; ')}</p>}
          {inForce && <p className="text-small text-muted">In force now: {formatPct(inForce.ratePct)} until {inForce.effectiveTo}</p>}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className={BUTTON_LINK} aria-label={`Edit ${label}`} onClick={() => onChange(head)}>Edit</button>
          <button type="button" className={BUTTON_LINK} aria-label={`End ${label}`} onClick={() => onEnd(head)}>End layer</button>
        </div>
      </div>
    </li>
  )
}

/** A zone's layers in force or scheduled, the combined rate today, and Add layer. */
function ZoneCard({ zone, today, onAdd, onChange, onEnd }: { zone: Zone; today: string; onAdd: () => void; onChange: (r: TaxRule) => void; onEnd: (r: TaxRule) => void }) {
  const db = useStore(s => s.db)
  const rules = db.taxRules.filter(r => r.zoneId === zone.id)
  const chains = ruleChains(rules).filter(c => ruleState(c.head, today) !== 'ended')
  const { pct, conditional } = combinedRate(rules, today)
  return (
    <Card label={zone.name}>
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div>
          <h3 className="text-h2 font-bold">{zone.name}</h3>
          <p className="text-small text-muted" data-testid="combined-rate">
            Combined rate today: <span className="font-mono font-semibold text-ink">{formatPct(pct)}</span>
            {conditional > 0 ? `, plus ${conditional} layer${conditional === 1 ? '' : 's'} on some lines` : ''}
          </p>
        </div>
        <button type="button" className={BUTTON_SECONDARY} onClick={onAdd}>Add layer</button>
      </header>
      {chains.length === 0
        ? <p className="border-t border-line px-5 py-4 text-small text-muted">No tax layers. Lines in this zone are not taxed.</p>
        : <ul>{chains.map(c => <LayerRow key={c.head.id} chain={c} today={today} onChange={onChange} onEnd={onEnd} />)}</ul>}
    </Card>
  )
}

/**
 * The Taxes section: the fixed rules every layer follows, then one card per zone with its layers (state, county,
 * city, district add up). Add layer and Change rate save a version from a date; End layer sets a last day. Nothing
 * already computed or posted is retaxed.
 */
export default function TaxesSection({ today }: { today: string }) {
  const db = useStore(s => s.db)
  const [form, setForm] = useState<null | { kind: 'edit'; zoneId: string; head?: TaxRule } | { kind: 'end'; rule: TaxRule }>(null)
  const [note, setNote] = useState<string | null>(null)

  const exempt = db.accounts.filter(a => a.taxExempt).length
  const taxable = [...new Set(db.feeRules.filter(r => r.taxable && ruleState(r, today) !== 'ended').map(r => r.name))]
  const open = (f: NonNullable<typeof form>) => {
    setNote(null)
    setForm(f)
  }

  return (
    <div className="space-y-5">
      <SectionHeader title="Taxes" description="Tax layers by zone. A zone's layers add up. A rate change is a new version from a date." />

      <Card label="Rules every layer follows" className="px-5 py-4">
        <h3 className="text-h2 font-bold">Rules every layer follows</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-body text-ink">
          <li>Late fees are never taxed.</li>
          <li>Tax-exempt accounts pay no tax: {exempt} account{exempt === 1 ? '' : 's'} today.</li>
          <li>
            Adjustments marked taxable are added to the taxed base
            {taxable.length ? `: ${taxable.join(', ')}.` : '. None are marked taxable.'}
          </li>
        </ul>
      </Card>

      {note && (
        <p role="status" data-testid="tax-saved" className="rounded-card border border-success/40 bg-success-soft px-4 py-3 text-body text-success">{note}</p>
      )}

      {db.zones.map(z => (
        <ZoneCard
          key={z.id}
          zone={z}
          today={today}
          onAdd={() => open({ kind: 'edit', zoneId: z.id })}
          onChange={head => open({ kind: 'edit', zoneId: z.id, head })}
          onEnd={rule => open({ kind: 'end', rule })}
        />
      ))}

      {form?.kind === 'edit' && (
        <TaxForm
          key={form.head?.id ?? form.zoneId}
          today={today}
          zoneId={form.zoneId}
          {...(form.head ? { head: form.head } : {})}
          onClose={() => setForm(null)}
          onSaved={r => {
            setForm(null)
            setNote(`Saved ${r.name ?? r.id} (${r.id}), ${formatPct(r.ratePct)} from ${r.effectiveFrom}.${r.supersedesId ? ` ${r.supersedesId} ends the day before and is kept.` : ''} Posted invoices never change.`)
          }}
        />
      )}
      {form?.kind === 'end' && (
        <EndLayerDrawer
          today={today}
          rule={form.rule}
          onClose={() => setForm(null)}
          onEnded={r => {
            setForm(null)
            setNote(`${r.name ?? r.id} ends after ${r.effectiveTo}. The layer is kept.`)
          }}
        />
      )}
    </div>
  )
}
