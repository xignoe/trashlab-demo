/**
 * The fee schedule under the rate sheet: every fee, surcharge, discount, and credit in one table, like the "maximum
 * additional fee schedule" grid on a commercial waste zone calculator. Each amount is click-to-edit in place; a change
 * is a new version from the toolbar's date (the old version ends the day before and is kept). Compare across a field
 * turns the Amount column into one column per value of that field, so the owner sees where each fee is charged.
 * Edit and Add fee open the Adjustments drawer (AdjustmentForm). A strip under the table sums each zone's tax layers.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { FeeRule } from '../../../types'
import { useStore } from '../../../store/useStore'
import { AdjustmentForm, StatePill } from '../sections/AdjustmentForm'
import { BUTTON_LINK, BUTTON_PRIMARY, Card, INPUT, MoneyInput, NumberInput, Select, Toggle, attempt } from './form'
import Pill from './Pill'
import {
  CATEGORY_HINT, CATEGORY_LABEL, FEE_CATEGORIES, LINE_TYPE_LABEL, feeCategory, feeScopeChips, ruleChains, ruleState,
  type FeeCategory, type FeeRuleInput, type RuleChain,
} from '../lib/rules'
import { dimensionLabel, dimensions, isPriceable, valuesOf, type DimValue } from '../lib/config'
import { firstOfNextMonth } from '../lib/dates'
import { formatCents, formatPct } from '../lib/money'

const MAX_COMPARE_VALUES = 12

/** "7%", "-10%", "$1.00", "-$5.00". */
function amountShort(rule: Pick<FeeRule, 'kind' | 'value'>): string {
  if (rule.kind === 'percent') return `${rule.value < 0 ? '-' : ''}${formatPct(Math.abs(rule.value))}`
  return formatCents(rule.value)
}

/** How the amount is measured: a share of the line, per month of the line, or once per charge. */
function howText(rule: FeeRule): string {
  if (rule.kind === 'percent') return 'of the line'
  return rule.appliesTo.includes('recurring') ? 'per month of the line' : 'per charge'
}

/** Every field of a rule that a new version carries over. */
function inputOf(rule: FeeRule): FeeRuleInput {
  const copy: Partial<FeeRule> = { ...rule }
  delete copy.id
  delete copy.supersedesId
  delete copy.effectiveFrom
  delete copy.effectiveTo
  return copy as FeeRuleInput
}

/** The version of the chain billing uses today, when the row shown is a scheduled one. */
function inForceNow(chain: RuleChain<FeeRule>, today: string): FeeRule | undefined {
  if (ruleState(chain.head, today) !== 'scheduled') return undefined
  return chain.older.find(r => ruleState(r, today) === 'active')
}

/** Whether a rule would reach a line carrying this value of the field. */
function appliesToValue(rule: FeeRule, dimId: string, valueId: string): boolean {
  const values = rule.when?.[dimId]
  return !values || values.length === 0 || values.includes(valueId)
}

/**
 * The amount as an input, in place. Enter saves, Escape cancels, and leaving the field saves when the amount changed.
 * A credit stays a credit: typing 12 on a credit saves -12.
 */
function AmountEditor({ rule, label, onSave, onCancel }: { rule: FeeRule; label: string; onSave: (value: number) => void; onCancel: () => void }) {
  const [pct, setPct] = useState<number | undefined>(rule.kind === 'percent' ? rule.value : undefined)
  const [cents, setCents] = useState<number | undefined>(rule.kind === 'flat' ? rule.value : undefined)
  const done = useRef(false)
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    box.current?.querySelector('input')?.focus()
  }, [])

  const typed = rule.kind === 'percent' ? pct : cents
  const next = typed === undefined || !Number.isFinite(typed) ? undefined : rule.value < 0 && typed > 0 ? -typed : typed

  const finish = (how: 'enter' | 'blur' | 'cancel') => {
    if (done.current) return
    done.current = true
    if (how === 'cancel' || next === rule.value || (how === 'blur' && next === undefined)) onCancel()
    else onSave(next ?? Number.NaN)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      finish('enter')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      finish('cancel')
    }
  }

  return (
    <span ref={box} className="block w-28" onKeyDown={onKeyDown} onBlur={() => finish('blur')}>
      {rule.kind === 'percent'
        ? <NumberInput value={pct} onChange={setPct} ariaLabel={label} suffix="%" />
        : <MoneyInput cents={cents} onChange={setCents} ariaLabel={label} signed={rule.value < 0} />}
    </span>
  )
}

/** The amount as a button that turns into an input on click. */
function AmountCell({
  rule, now, editing, label, title, onStart, onSave, onCancel,
}: {
  rule: FeeRule
  now?: FeeRule
  editing: boolean
  label: string
  title?: string
  onStart: () => void
  onSave: (value: number) => void
  onCancel: () => void
}) {
  if (editing) return <AmountEditor rule={rule} label={`New amount for ${rule.name}`} onSave={onSave} onCancel={onCancel} />
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <button
        type="button"
        aria-label={label}
        title={title ?? 'Click to change'}
        onClick={onStart}
        className="rounded-sm border border-dashed border-transparent px-1 font-mono text-mono font-semibold text-ink hover:border-line hover:bg-surface-muted"
      >
        {amountShort(rule)}
      </button>
      {now && <span className="whitespace-nowrap text-small text-muted">now {amountShort(now)}</span>}
    </span>
  )
}

interface Row {
  rule: FeeRule
  chain: RuleChain<FeeRule>
  category: FeeCategory
}

export default function FeeSchedule({ today, onOpenSection }: { today: string; onOpenSection?: (id: 'adjustments' | 'taxes') => void }) {
  const db = useStore(s => s.db)
  const saveFeeRule = useStore(s => s.saveFeeRule)
  const setFeeRuleStatus = useStore(s => s.setFeeRuleStatus)

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<FeeCategory | 'all'>('all')
  const [showEnded, setShowEnded] = useState(false)
  const [effectiveFrom, setEffectiveFrom] = useState(firstOfNextMonth(today))
  const [compareId, setCompareId] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState<null | { head?: FeeRule }>(null)

  const compareFields = dimensions(db).filter(d => {
    if (!isPriceable(d)) return false
    const n = valuesOf(db, d.id).length
    return n > 0 && n <= MAX_COMPARE_VALUES
  })
  const compareValues: DimValue[] = compareId ? valuesOf(db, compareId) : []
  const comparing = compareId !== '' && compareValues.length > 0

  // Rows: each chain's newest version, ended chains only when asked for.
  const allRows: Row[] = ruleChains(db.feeRules)
    .filter(c => showEnded || ruleState(c.head, today) !== 'ended')
    .map(chain => ({ rule: chain.head, chain, category: feeCategory(chain.head) }))
  const q = search.trim().toLowerCase()
  const searched = q
    ? allRows.filter(({ rule }) => [rule.name, rule.id, rule.description ?? '', rule.stackGroup ?? '', ...feeScopeChips(db, rule)].join(' ').toLowerCase().includes(q))
    : allRows
  const rows = category === 'all' ? searched : searched.filter(r => r.category === category)
  const countOf = (c: FeeCategory) => searched.filter(r => r.category === c).length

  const setRuleErrors = (id: string, problems: string[] | null) =>
    setErrors(prev => {
      const next = { ...prev }
      if (problems) next[id] = problems
      else delete next[id]
      return next
    })

  /** Save a new version of the rule with the patch, from the toolbar's date. */
  const saveVersion = (rule: FeeRule, patch: Partial<FeeRuleInput>, what: string) => {
    setEditing(null)
    const r = attempt(() => saveFeeRule({ input: { ...inputOf(rule), ...patch }, effectiveFrom, previousId: rule.id, today }))
    if (!r.ok) {
      setRuleErrors(rule.id, r.problems)
      return
    }
    setRuleErrors(rule.id, null)
    const ended = useStore.getState().db.feeRules.find(x => x.id === rule.id)
    setNotice(`Saved ${rule.name}: ${what} from ${r.value.effectiveFrom}. The version before it ends ${ended?.effectiveTo ?? 'the day before'} and is kept.`)
  }

  const setStatus = (rule: FeeRule, on: boolean) => {
    const r = attempt(() => setFeeRuleStatus({ id: rule.id, status: on ? 'active' : 'paused' }))
    setRuleErrors(rule.id, r.ok ? null : r.problems)
  }

  const colCount = 7 + (comparing ? compareValues.length : 1)
  const TH = 'px-3 py-2 text-left text-eyebrow font-bold uppercase tracking-[0.08em] text-muted whitespace-nowrap'
  const TD = 'px-3 py-2.5 align-top'

  const renderRow = ({ rule, chain }: Row) => {
    const state = ruleState(rule, today)
    const now = inForceNow(chain, today)
    const chips = feeScopeChips(db, rule).filter(c => !c.startsWith('best of'))
    const rowErrors = errors[rule.id]
    const editable = state !== 'ended'
    return [
      <tr key={rule.id} data-fee-row={rule.id} className="border-t border-line">
        <td className={TD}>
          <p className="text-body font-bold text-ink">{rule.name}</p>
          <p className="font-mono text-eyebrow text-muted">{rule.id}</p>
          {rule.description && <p className="mt-0.5 max-w-[280px] truncate text-small text-muted" title={rule.description}>{rule.description}</p>}
        </td>
        {comparing
          ? compareValues.map(v => {
            const hit = appliesToValue(rule, compareId, v.id)
            const n = compareValues.filter(x => appliesToValue(rule, compareId, x.id)).length
            const key = `${rule.id}|${v.id}`
            return (
              <td key={v.id} className={TD} data-compare-cell={v.id}>
                {!hit
                  ? <span className="text-small text-muted">not charged</span>
                  : editable
                    ? (
                      <AmountCell
                        rule={rule}
                        {...(now ? { now } : {})}
                        editing={editing === key}
                        label={`Change amount of ${rule.name} for ${v.label}`}
                        title={`Applies to ${n} of ${compareValues.length} ${dimensionLabel(db, compareId).toLowerCase()} values. A change here changes the fee for all ${n}.`}
                        onStart={() => setEditing(key)}
                        onSave={value => saveVersion(rule, { value }, amountShort({ kind: rule.kind, value }))}
                        onCancel={() => setEditing(null)}
                      />
                    )
                    : <span className="font-mono text-mono text-muted">{amountShort(rule)}</span>}
              </td>
            )
          })
          : (
            <td className={TD}>
              {editable
                ? (
                  <AmountCell
                    rule={rule}
                    {...(now ? { now } : {})}
                    editing={editing === rule.id}
                    label={`Change amount of ${rule.name}`}
                    onStart={() => setEditing(rule.id)}
                    onSave={value => saveVersion(rule, { value }, amountShort({ kind: rule.kind, value }))}
                    onCancel={() => setEditing(null)}
                  />
                )
                : <span className="font-mono text-mono text-muted">{amountShort(rule)}</span>}
            </td>
          )}
        <td className={`${TD} whitespace-nowrap text-small text-muted`}>{howText(rule)}</td>
        <td className={`${TD} text-small text-ink`}>{rule.appliesTo.map(t => LINE_TYPE_LABEL[t]).join(', ')}</td>
        <td className={TD}>
          {chips.length === 0
            ? <span className="text-small text-muted">Everywhere</span>
            : <span className="flex max-w-[260px] flex-wrap gap-1">{chips.map(c => <Pill key={c}>{c}</Pill>)}</span>}
        </td>
        <td className={`${TD} font-mono text-small text-muted`}>{rule.stackGroup ?? ''}</td>
        <td className={TD}>
          <span className="flex items-center gap-2 text-small text-ink">
            <Toggle
              on={rule.taxable}
              disabled={!editable}
              label={`${rule.name} taxable`}
              onChange={taxable => saveVersion(rule, { taxable }, taxable ? 'taxable' : 'not taxed')}
            />
            {rule.taxable ? 'Yes' : 'No'}
          </span>
        </td>
        <td className={TD}>
          <span className="flex items-center gap-2">
            <StatePill rule={rule} today={today} />
            {(state === 'active' || state === 'paused') && (
              <Toggle on={rule.status !== 'paused'} label={`${rule.name} active`} onChange={on => setStatus(rule, on)} />
            )}
          </span>
        </td>
        <td className={TD}>
          <button type="button" className={BUTTON_LINK} aria-label={`Edit ${rule.name}`} onClick={() => setForm({ head: rule })}>
            Edit
          </button>
        </td>
      </tr>,
      rowErrors && (
        <tr key={`${rule.id}-errors`} data-fee-errors={rule.id}>
          <td colSpan={colCount} className="px-3 pb-2.5">
            <p role="alert" className="text-small font-semibold text-danger">Not saved: {rowErrors.join('. ')}.</p>
          </td>
        </tr>
      ),
    ]
  }

  // Tax by zone: active layers with no conditions, summed per served zone.
  const taxByZone = db.zones
    .filter(z => z.serviceability !== 'notServed')
    .map(z => ({
      zone: z,
      pct: db.taxRules
        .filter(t => t.zoneId === z.id && ruleState(t, today) === 'active' && Object.keys(t.when ?? {}).length === 0)
        .reduce((s, t) => s + t.ratePct, 0),
    }))

  return (
    <Card label="Fee schedule">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-h2 font-bold">Fee schedule</h3>
          <p className="text-small text-muted">Every fee, surcharge, discount, and credit that can land on a bill. Click an amount to change it from a date; the old version is kept.</p>
        </div>
        {onOpenSection && (
          <button type="button" className={BUTTON_LINK} onClick={() => onOpenSection('adjustments')}>
            Open Adjustments
          </button>
        )}
      </header>

      <div className="space-y-3 border-b border-line px-5 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block w-full sm:w-60">
            <span className="block text-small font-semibold text-ink">Search</span>
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search fees" placeholder="Fuel, late payment, VIP" className={`${INPUT} mt-1`} />
          </label>
          <label className="block">
            <span className="block text-small font-semibold text-ink">Changes take effect</span>
            <input
              type="date"
              value={effectiveFrom}
              min={today}
              aria-label="Changes take effect"
              onChange={e => setEffectiveFrom(e.target.value)}
              className={`${INPUT} mt-1 font-mono`}
            />
          </label>
          <label className="block w-full sm:w-52">
            <span className="block text-small font-semibold text-ink">Compare across</span>
            <span className="mt-1 block">
              <Select
                value={compareId}
                onChange={v => {
                  setCompareId(v)
                  setEditing(null)
                }}
                ariaLabel="Compare across"
                placeholder="None"
                options={compareFields.map(d => ({ value: d.id, label: d.name }))}
              />
            </span>
          </label>
          <label className="flex h-9 cursor-pointer items-center gap-2 text-body text-ink">
            <input type="checkbox" checked={showEnded} onChange={e => setShowEnded(e.target.checked)} className="h-4 w-4 accent-[var(--rt-color-accent)]" />
            Show ended
          </label>
          <button type="button" className={`${BUTTON_PRIMARY} ml-auto`} onClick={() => setForm({})}>
            Add fee
          </button>
        </div>
        <div role="group" aria-label="Category" className="flex flex-wrap gap-1.5">
          {(['all', ...FEE_CATEGORIES] as const).map(c => {
            const on = category === c
            const label = c === 'all' ? 'All' : CATEGORY_LABEL[c]
            const count = c === 'all' ? searched.length : countOf(c)
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                title={c === 'all' ? undefined : CATEGORY_HINT[c]}
                onClick={() => setCategory(c)}
                className={['rounded-pill border px-2.5 py-1 text-small font-semibold transition-colors', on ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-muted hover:text-ink'].join(' ')}
              >
                {label} <span className="font-mono">{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {notice && (
        <p role="status" data-testid="fee-schedule-saved" className="border-b border-line bg-surface-muted px-5 py-2 text-small text-ink">
          {notice}
        </p>
      )}

      {db.feeRules.length === 0
        ? <p className="px-5 py-6 text-body text-muted">No fees yet. Add one for fuel, container cleaning, late payment, card payments, or anything else you charge.</p>
        : rows.length === 0
          ? (
            <p className="px-5 py-6 text-body text-muted">
              No fees match{q ? ` "${search.trim()}"` : ''}{category !== 'all' ? ` in ${CATEGORY_LABEL[category]}` : ''}{showEnded ? '' : ' among the fees in force or scheduled'}.
              {' '}Clear the search, pick All, or turn on Show ended.
            </p>
          )
          : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] border-collapse">
                <thead>
                  <tr className="bg-surface-muted">
                    <th className={TH}>Name</th>
                    {comparing
                      ? compareValues.map(v => <th key={v.id} className={TH} title={`${dimensionLabel(db, compareId)}: ${v.label}`}>{v.label}</th>)
                      : <th className={TH}>Amount</th>}
                    <th className={TH}>How</th>
                    <th className={TH}>Applies to</th>
                    <th className={TH}>Where</th>
                    <th className={TH}>Stack group</th>
                    <th className={TH}>Taxable</th>
                    <th className={TH}>State</th>
                    <th className={TH}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {FEE_CATEGORIES.flatMap(cat => {
                    const list = rows.filter(r => r.category === cat)
                    if (list.length === 0) return []
                    return [
                      <tr key={`group-${cat}`} data-fee-group={cat} className="border-t border-line bg-surface-muted/60">
                        <td colSpan={colCount} className="px-3 py-1.5">
                          <span className="text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">{CATEGORY_LABEL[cat]}</span>
                          <span className="ml-2 text-small text-muted">{CATEGORY_HINT[cat]}</span>
                        </td>
                      </tr>,
                      ...list.flatMap(renderRow),
                    ]
                  })}
                </tbody>
              </table>
            </div>
          )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-5 py-3" data-testid="tax-by-zone">
        <span className="text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">Tax by zone</span>
        {taxByZone.length === 0
          ? <span className="text-small text-muted">No zones yet.</span>
          : taxByZone.map(({ zone, pct }) => (
            <span key={zone.id} data-zone-tax={zone.id} className="text-small text-ink">
              {zone.name} <span className="font-mono font-semibold">{formatPct(pct)}</span>
            </span>
          ))}
        <button type="button" className={`${BUTTON_LINK} ml-auto`} onClick={() => onOpenSection?.('taxes')}>
          Edit tax layers
        </button>
      </div>

      {form && (
        <AdjustmentForm
          key={form.head?.id ?? 'new'}
          today={today}
          {...(form.head ? { head: form.head } : {})}
          onClose={() => setForm(null)}
          onSaved={rule => {
            setForm(null)
            setNotice(`Saved ${rule.name} (${rule.id}), ${amountShort(rule)} ${howText(rule)} from ${rule.effectiveFrom}.${rule.supersedesId ? ` ${rule.supersedesId} ends the day before and is kept.` : ''}`)
          }}
        />
      )}
    </Card>
  )
}
