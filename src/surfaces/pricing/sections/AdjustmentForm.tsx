/**
 * The adjustment drawer (add, and new version of an existing chain) and the small pieces the Adjustments and Taxes
 * sections share: the conditions editor, the impact preview, the state pill, and a date field (DECISIONS.md entry 65).
 */
import { useMemo, useState, type ReactNode } from 'react'
import type { FeeRule, LineType } from '../../../types'
import { useStore } from '../../../store/useStore'
import type { Db } from '../../../store/db'
import {
  BUTTON_LINK, BUTTON_PRIMARY, BUTTON_SECONDARY, ChipPicker, Checkbox, Drawer, Field, FormSection, INPUT, MoneyInput, NumberInput, Problems, Select,
  TextInput, attempt,
} from '../components/form'
import Pill, { type PillTone } from '../components/Pill'
import {
  CATEGORY_HINT, CATEGORY_LABEL, FEE_CATEGORIES, LINE_TYPES, LINE_TYPE_LABEL, feeCategory, ruleImpact, ruleState, validateFeeRule, withRuleVersion,
  type FeeCategory, type FeeRuleInput, type RuleImpact, type RuleState,
} from '../lib/rules'
import { dimensionById, dimensionLabel, dimensionValues, dimensions } from '../lib/config'
import { formatCents } from '../lib/money'
import { firstOfNextMonth } from '../lib/dates'

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const STATE_TONE: Record<RuleState, PillTone> = { active: 'success', scheduled: 'accent', paused: 'warning', ended: 'muted' }

/** Active, Scheduled from a date, Paused, or Ended on a date, for a fee rule or tax layer. */
export function StatePill({ rule, today }: { rule: { status?: 'active' | 'paused'; effectiveFrom?: string; effectiveTo?: string }; today: string }) {
  const state = ruleState(rule, today)
  const label = state === 'scheduled' ? `Scheduled from ${rule.effectiveFrom}` : state === 'ended' ? `Ended ${rule.effectiveTo}` : state === 'paused' ? 'Paused' : 'Active'
  return <Pill tone={STATE_TONE[state]} dot>{label}</Pill>
}

/** "from 2026-10-01 to 2026-10-31", "since the start", "from 2026-11-01". */
export function datesText(rule: { effectiveFrom?: string; effectiveTo?: string }): string {
  const from = rule.effectiveFrom ? `from ${rule.effectiveFrom}` : 'since the start'
  return rule.effectiveTo ? `${from} to ${rule.effectiveTo}` : from
}

/** A heading and hint over a group of controls that is not one input (a label would forward clicks to the first chip). */
export function Group({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <span className="block text-small font-semibold text-ink">{label}</span>
      {hint && <span className="block text-small text-muted">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

export function DateInput({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }) {
  return <input type="date" value={value} aria-label={ariaLabel} onChange={e => onChange(e.target.value)} className={`${INPUT} font-mono`} />
}

/** Two or more mutually exclusive choices as a row of pressed buttons. */
export function Segmented<T extends string>({ value, onChange, options, ariaLabel }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; ariaLabel: string }) {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex rounded-md border border-line bg-surface-muted p-0.5">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={['rounded-sm px-3 py-1.5 text-small font-semibold transition-colors', o.value === value ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'].join(' ')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export interface ConditionRow {
  dimId: string
  values: string[]
}

export function conditionRowsOf(when: Record<string, string[]> | undefined): ConditionRow[] {
  return Object.entries(when ?? {}).map(([dimId, values]) => ({ dimId, values: [...values] }))
}

/** Condition rows as a `when` map; rows with no dimension or no values are left out. */
export function whenOf(rows: ConditionRow[]): Record<string, string[]> | undefined {
  const when: Record<string, string[]> = {}
  for (const r of rows) {
    if (!r.dimId || r.values.length === 0) continue
    when[r.dimId] = [...new Set([...(when[r.dimId] ?? []), ...r.values])]
  }
  return Object.keys(when).length ? when : undefined
}

/** A problem for each condition row that names a dimension but picks no value. */
export function conditionProblems(db: Db, rows: ConditionRow[]): string[] {
  return rows.filter(r => r.dimId && r.values.length === 0).map(r => `Pick at least one value for ${dimensionLabel(db, r.dimId)}, or remove the condition`)
}

/**
 * Rows of [dimension] [values], each a condition on the line. All conditions must hold; within one, any picked value
 * matches. A dimension already used by another row is not offered again.
 */
export function ConditionsEditor({ rows, onChange }: { rows: ConditionRow[]; onChange: (rows: ConditionRow[]) => void }) {
  const db = useStore(s => s.db)
  const dims = dimensions(db)
  const set = (i: number, patch: Partial<ConditionRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <div className="space-y-3">
      <p className="text-small text-muted">Every condition must hold. Within a condition, any picked value matches. No conditions means every line.</p>
      {rows.map((row, i) => {
        const dim = row.dimId ? dimensionById(db, row.dimId) : undefined
        const taken = new Set(rows.filter((_, j) => j !== i).map(r => r.dimId))
        const label = dim?.name ?? `Condition ${i + 1}`
        return (
          <div key={i} data-condition={row.dimId || 'new'} className="space-y-2 rounded-md border border-line bg-surface-muted/50 p-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Select
                  value={row.dimId}
                  onChange={dimId => set(i, { dimId, values: [] })}
                  ariaLabel={`Condition ${i + 1} dimension`}
                  placeholder="Pick a dimension"
                  options={dims.filter(d => !taken.has(d.id)).map(d => ({ value: d.id, label: d.name, group: d.builtIn ? 'Read from the line' : 'Set by you' }))}
                />
              </div>
              <button type="button" className={BUTTON_LINK} aria-label={`Remove condition ${label}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
            {dim && (
              <>
                <ChipPicker ariaLabel={`${dim.name} values`} options={dimensionValues(db, dim).map(v => ({ value: v.id, label: v.label }))} value={row.values} onChange={values => set(i, { values })} />
                {dim.source === 'input' && (
                  <p className="text-small text-muted">
                    {dim.name} is asked when quoting. Recurring billing uses the default{dim.defaultValueId ? ` (${dimensionValues(db, dim).find(v => v.id === dim.defaultValueId)?.label ?? dim.defaultValueId})` : ''}.
                  </p>
                )}
              </>
            )}
          </div>
        )
      })}
      <button type="button" className={BUTTON_SECONDARY} onClick={() => onChange([...rows, { dimId: '', values: [] }])}>
        Add condition
      </button>
    </div>
  )
}

/**
 * The Preview impact button and its result. Pricing every account is slow, so it runs only on the click; when the
 * form changes after a preview, the result is marked stale until previewed again.
 */
export function ImpactPreview({ signature, compute, disabled, notes = [] }: { signature: string; compute: () => RuleImpact; disabled: boolean; notes?: string[] }) {
  const [result, setResult] = useState<{ signature: string; impact?: RuleImpact; error?: string } | null>(null)
  const run = () => {
    try {
      setResult({ signature, impact: compute() })
    } catch (e) {
      setResult({ signature, error: e instanceof Error ? e.message : String(e) })
    }
  }
  const stale = !!result && result.signature !== signature
  const impact = result?.impact
  const signed = (c: number) => `${c > 0 ? '+' : ''}${formatCents(c)}`
  return (
    <div className="space-y-3" data-testid="impact-preview">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={BUTTON_SECONDARY} disabled={disabled} onClick={run}>
          {result ? 'Preview again' : 'Preview impact'}
        </button>
        <span className="text-small text-muted">Prices every account's next recurring run, as it is and with this change.</span>
      </div>
      {notes.map(n => <p key={n} className="rounded-md bg-surface-muted px-3 py-2 text-small text-ink">{n}</p>)}
      {stale && <p className="text-small font-semibold text-warning">The form changed since this preview. Preview again to update it.</p>}
      {result?.error && <p role="alert" className="text-small font-semibold text-danger">{result.error}</p>}
      {impact && (
        <div className={stale ? 'opacity-50' : ''}>
          <p className="text-body text-ink" data-testid="impact-headline">
            First run on or after {impact.cycleDate}: {impact.accounts.length} account{impact.accounts.length === 1 ? '' : 's'} change, total {signed(impact.deltaCents)}, {impact.linesChanged} of {impact.linesPriced} lines changed.
          </p>
          {impact.accounts.length > 0 && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-small">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="py-1 pr-3 font-semibold">Account</th>
                    <th className="py-1 pr-3 text-right font-semibold">Before</th>
                    <th className="py-1 pr-3 text-right font-semibold">After</th>
                    <th className="py-1 text-right font-semibold">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {impact.accounts.slice(0, 8).map(a => (
                    <tr key={a.accountId} className="border-t border-line" data-impact-account={a.accountId}>
                      <td className="py-1 pr-3 text-ink">{a.name}</td>
                      <td className="py-1 pr-3 text-right font-mono">{formatCents(a.beforeCents)}</td>
                      <td className="py-1 pr-3 text-right font-mono">{formatCents(a.afterCents)}</td>
                      <td className="py-1 text-right font-mono font-semibold">{signed(a.afterCents - a.beforeCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {impact.accounts.length > 8 && <p className="mt-1 text-small text-muted">and {impact.accounts.length - 8} more.</p>}
            </div>
          )}
          <p className="mt-2 text-small text-muted">Charges already computed keep their amounts; posted invoices never change.</p>
        </div>
      )}
    </div>
  )
}

/** Why the next recurring run will not show a change, when the rule cannot reach a recurring line there. */
export function recurringRunNotes(db: Db, appliesTo: LineType[], when: Record<string, string[]> | undefined): string[] {
  if (!appliesTo.includes('recurring')) {
    const kinds = appliesTo.map(t => LINE_TYPE_LABEL[t].toLowerCase()).join(', ') || 'no lines'
    return [`This applies to ${kinds}, which are billed as they happen, so the next recurring run does not change.`]
  }
  const notes: string[] = []
  for (const [dimId, values] of Object.entries(when ?? {})) {
    const dim = dimensionById(db, dimId)
    if (dim?.source !== 'input') continue
    if (!dim.defaultValueId || !values.includes(dim.defaultValueId)) {
      notes.push(`${dim.name} is asked when quoting and recurring billing uses the default, so the next recurring run does not change. It applies to quotes and on-demand jobs that pick one of these values.`)
    }
  }
  return notes
}

// ---------------------------------------------------------------------------
// Adjustment drawer
// ---------------------------------------------------------------------------

type Direction = 'charge' | 'credit'

/**
 * Add an adjustment, or save a new version of one (head given). Every field of FeeRule is here: amount and sign,
 * line types, conditions on any dimension, distance and density, floor, cap, contract exemption, stack group, and the
 * date it takes effect. Problems from validateFeeRule show live under Save, which stays disabled until there are none.
 * A new version ends the head the day before it starts; the head is kept.
 */
export function AdjustmentForm({
  today, head, onClose, onSaved, initialWhen, initialAppliesTo, initialEffectiveFrom,
}: {
  today: string
  head?: FeeRule
  onClose: () => void
  onSaved: (rule: FeeRule) => void
  /** A new adjustment only: conditions, line types, and date to start from (New rate scopes one to its rate). */
  initialWhen?: Record<string, string[]>
  initialAppliesTo?: LineType[]
  initialEffectiveFrom?: string
}) {
  const db = useStore(s => s.db)
  const saveFeeRule = useStore(s => s.saveFeeRule)

  const [name, setName] = useState(head?.name ?? '')
  const [category, setCategory] = useState<FeeCategory>(head ? feeCategory(head) : 'surcharge')
  const [description, setDescription] = useState(head?.description ?? '')
  const [kind, setKind] = useState<FeeRule['kind']>(head?.kind ?? 'percent')
  const [direction, setDirection] = useState<Direction>(head && head.value < 0 ? 'credit' : 'charge')
  const [pct, setPct] = useState<number | undefined>(head?.kind === 'percent' ? Math.abs(head.value) : undefined)
  const [cents, setCents] = useState<number | undefined>(head?.kind === 'flat' ? Math.abs(head.value) : undefined)
  const [taxable, setTaxable] = useState(head?.taxable ?? true)
  const [appliesTo, setAppliesTo] = useState<LineType[]>(head?.appliesTo ?? initialAppliesTo ?? ['recurring'])
  const [conditions, setConditions] = useState<ConditionRow[]>(conditionRowsOf(head ? head.when : initialWhen))
  const [minMiles, setMinMiles] = useState(head?.minMiles)
  const [maxMiles, setMaxMiles] = useState(head?.maxMiles)
  const [minStops, setMinStops] = useState(head?.minNeighborStops)
  const [minCents, setMinCents] = useState(head?.minCents)
  const [maxCents, setMaxCents] = useState(head?.maxCents)
  const [exemptContracts, setExemptContracts] = useState(head?.exemptContracts ?? false)
  const [stackGroup, setStackGroup] = useState(head?.stackGroup ?? '')
  const [effectiveFrom, setEffectiveFrom] = useState(
    !head && initialEffectiveFrom ? initialEffectiveFrom : firstOfNextMonth(head?.effectiveFrom && head.effectiveFrom > today ? head.effectiveFrom : today),
  )
  const [saveProblems, setSaveProblems] = useState<string[]>([])

  const changeDirection = (d: Direction) => {
    setDirection(d)
    if (d === 'credit' && category === 'surcharge') setCategory('credit')
    if (d === 'charge' && category === 'credit') setCategory('surcharge')
  }

  const magnitude = Math.abs((kind === 'percent' ? pct : cents) ?? 0)
  const when = whenOf(conditions)
  const input: FeeRuleInput = {
    name: name.trim(), kind, value: direction === 'credit' ? -magnitude : magnitude, base: head?.base ?? 'serviceLines', appliesTo, taxable, category,
    ...(description.trim() ? { description: description.trim() } : {}),
    ...(head?.status === 'paused' ? { status: 'paused' as const } : {}),
    ...(when ? { when } : {}),
    ...(minMiles !== undefined ? { minMiles } : {}),
    ...(maxMiles !== undefined ? { maxMiles } : {}),
    ...(minStops !== undefined ? { minNeighborStops: minStops } : {}),
    ...(minCents !== undefined ? { minCents } : {}),
    ...(maxCents !== undefined ? { maxCents } : {}),
    ...(exemptContracts ? { exemptContracts } : {}),
    ...(stackGroup.trim() ? { stackGroup: stackGroup.trim() } : {}),
  }
  const problems = [...conditionProblems(db, conditions), ...validateFeeRule(input, effectiveFrom, today, head)]
  const signature = JSON.stringify([input, effectiveFrom])
  const stackGroups = useMemo(() => [...new Set(db.feeRules.map(r => r.stackGroup).filter((g): g is string => !!g))], [db.feeRules])

  const save = () => {
    const r = attempt(() => saveFeeRule({ input, effectiveFrom, ...(head ? { previousId: head.id } : {}) }))
    if (!r.ok) {
      setSaveProblems(r.problems)
      return
    }
    onSaved(r.value)
  }

  return (
    <Drawer
      title={head ? `New version of ${head.name}` : 'Add an adjustment'}
      eyebrow="Adjustments"
      subtitle={head ? `Replaces ${head.id} from the date you pick. The current version is ended the day before and kept.` : 'A fee, surcharge, discount, or credit on charge lines.'}
      onClose={onClose}
      width={640}
      footer={
        <>
          <button type="button" className={BUTTON_SECONDARY} onClick={onClose}>Cancel</button>
          <button type="button" className={BUTTON_PRIMARY} disabled={problems.length > 0} onClick={save}>
            {head ? 'Save new version' : 'Save adjustment'}
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

      <FormSection title="What it is">
        <Field label="Name">
          <TextInput value={name} onChange={setName} ariaLabel="Name" placeholder="Fuel surcharge" />
        </Field>
        <Field label="Category" hint={CATEGORY_HINT[category]}>
          <Select value={category} onChange={v => setCategory(v as FeeCategory)} ariaLabel="Category" options={FEE_CATEGORIES.map(c => ({ value: c, label: CATEGORY_LABEL[c] }))} />
        </Field>
        <Field label="Description" hint="Optional. Shown to staff next to the rule.">
          <TextInput value={description} onChange={setDescription} ariaLabel="Description" />
        </Field>
      </FormSection>

      <FormSection title="Amount">
        <div className="flex flex-wrap gap-3">
          <Segmented ariaLabel="Kind" value={kind} onChange={setKind} options={[{ value: 'percent', label: 'Percent of the line' }, { value: 'flat', label: 'Flat per month' }]} />
          <Segmented ariaLabel="Direction" value={direction} onChange={changeDirection} options={[{ value: 'charge', label: 'Adds a charge' }, { value: 'credit', label: 'Gives a credit' }]} />
        </div>
        <Field
          label={kind === 'percent' ? 'Percent of the line' : 'Amount per month'}
          hint={kind === 'percent' ? "Of the line's base price." : 'Per month of the line; once on a one-time line.'}
        >
          {kind === 'percent'
            ? <NumberInput value={pct} onChange={setPct} ariaLabel="Amount" suffix="%" min={0} />
            : <MoneyInput cents={cents} onChange={setCents} ariaLabel="Amount" />}
        </Field>
        <Checkbox checked={taxable} onChange={setTaxable} label="Taxable" hint="Added to the base the zone's tax layers are charged on." />
      </FormSection>

      <FormSection title="Applies to">
        <ChipPicker ariaLabel="Applies to" options={LINE_TYPES.map(t => ({ value: t, label: LINE_TYPE_LABEL[t] }))} value={appliesTo} onChange={v => setAppliesTo(v as LineType[])} />
      </FormSection>

      <FormSection title="When">
        <ConditionsEditor rows={conditions} onChange={setConditions} />
      </FormSection>

      <FormSection title="Location" hint="All optional. Distance needs the site's miles from the yard; density needs its count of nearby stops.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Min miles" hint="From the yard, inclusive">
            <NumberInput value={minMiles} onChange={setMinMiles} ariaLabel="Min miles from the yard" suffix="mi" min={0} />
          </Field>
          <Field label="Max miles" hint="Up to, not including">
            <NumberInput value={maxMiles} onChange={setMaxMiles} ariaLabel="Max miles from the yard" suffix="mi" min={0} />
          </Field>
          <Field label="Min stops" hint="Within a quarter mile">
            <NumberInput value={minStops} onChange={setMinStops} ariaLabel="Min stops within a quarter mile" step="1" min={0} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Limits and stacking">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Floor per month" hint="Optional. The fee is at least this much.">
            <MoneyInput cents={minCents} onChange={setMinCents} ariaLabel="Floor per month" />
          </Field>
          <Field label="Cap per month" hint="Optional. The fee is at most this much.">
            <MoneyInput cents={maxCents} onChange={setMaxCents} ariaLabel="Cap per month" />
          </Field>
        </div>
        <Checkbox checked={exemptContracts} onChange={setExemptContracts} label="Skip contract prices" hint="A contract price is all in; this adjustment does not touch it." />
        <Field label="Stack group" hint="Of the adjustments in one group that apply to a line, only the largest is taken, so discounts do not stack.">
          <input type="text" list="fee-stack-groups" value={stackGroup} aria-label="Stack group" onChange={e => setStackGroup(e.target.value)} className={INPUT} placeholder="customerDiscount" />
          <datalist id="fee-stack-groups">
            {stackGroups.map(g => <option key={g} value={g} />)}
          </datalist>
        </Field>
      </FormSection>

      <FormSection title="Effective from" hint={head ? `Must be after ${head.effectiveFrom ?? 'the current version starts'}. Charges already computed keep their fees.` : 'Charges already computed keep their fees; posted invoices never change.'}>
        <DateInput value={effectiveFrom} onChange={setEffectiveFrom} ariaLabel="Effective from" />
      </FormSection>

      <FormSection title="Impact">
        <ImpactPreview
          signature={signature}
          disabled={problems.length > 0}
          notes={recurringRunNotes(db, appliesTo, when)}
          compute={() => ruleImpact(db, { feeRules: withRuleVersion(db.feeRules, input, { id: 'fee_preview', effectiveFrom, ...(head ? { previousId: head.id } : {}) }).rows }, effectiveFrom)}
        />
      </FormSection>
    </Drawer>
  )
}
