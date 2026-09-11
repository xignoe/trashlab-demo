import { useState } from 'react'
import type { FeeRule } from '../../../types'
import { useStore } from '../../../store/useStore'
import { BUTTON_LINK, BUTTON_PRIMARY, Card, SectionHeader, Toggle } from '../components/form'
import Pill from '../components/Pill'
import { CATEGORY_HINT, CATEGORY_LABEL, FEE_CATEGORIES, LINE_TYPE_LABEL, feeAmountText, feeCategory, feeScopeChips, ruleChains, ruleState, type RuleChain } from '../lib/rules'
import { AdjustmentForm, StatePill, datesText } from './AdjustmentForm'

/** One chain of versions: the newest row with its controls, and the older rows behind a disclosure. */
function ChainRow({ chain, today, onEdit }: { chain: RuleChain<FeeRule>; today: string; onEdit: (head: FeeRule) => void }) {
  const db = useStore(s => s.db)
  const setFeeRuleStatus = useStore(s => s.setFeeRuleStatus)
  const { head, older } = chain
  const state = ruleState(head, today)
  const chips = feeScopeChips(db, head)
  const inForce = state === 'scheduled' ? older.find(r => ruleState(r, today) === 'active') : undefined
  return (
    <li className="border-t border-line px-5 py-4 first:border-t-0" data-chain={head.id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body font-semibold text-ink">{head.name}</span>
            <span className="font-mono text-eyebrow text-muted">{head.id}</span>
            <StatePill rule={head} today={today} />
          </div>
          {head.description && <p className="mt-0.5 text-small text-muted">{head.description}</p>}
          <p className="mt-1 font-mono text-mono font-semibold text-ink" data-testid="fee-amount">
            {feeAmountText(head)}
            <span className="ml-2 font-sans text-small font-normal text-muted">
              on {head.appliesTo.map(t => LINE_TYPE_LABEL[t].toLowerCase()).join(', ')}{head.taxable ? ', taxable' : ', not taxed'}
            </span>
          </p>
          {inForce && <p className="mt-0.5 text-small text-muted">In force now: {feeAmountText(inForce)} until {inForce.effectiveTo}</p>}
          {chips.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chips.map(c => <Pill key={c} tone="muted">{c}</Pill>)}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {state !== 'ended' && (
            <span className="flex items-center gap-2 text-small text-muted">
              <Toggle on={head.status !== 'paused'} label={`${head.name} active`} onChange={on => setFeeRuleStatus({ id: head.id, status: on ? 'active' : 'paused' })} />
              {head.status === 'paused' ? 'Paused' : 'On'}
            </span>
          )}
          <button type="button" className={BUTTON_LINK} aria-label={`Edit ${head.name}`} onClick={() => onEdit(head)}>
            Edit
          </button>
        </div>
      </div>
      {older.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-small font-semibold text-accent">
            {older.length} earlier version{older.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-1.5 space-y-1 border-l-2 border-line pl-3">
            {older.map(r => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-small" data-version={r.id}>
                <span className="font-mono text-ink">{feeAmountText(r)}</span>
                <span className="text-muted">{datesText(r)}</span>
                <span className="font-mono text-eyebrow text-muted">{r.id}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  )
}

/**
 * The Adjustments section: every fee, surcharge, discount, and credit, grouped by category, one row per chain of
 * versions. A row can be paused or resumed, and Edit saves a new version from a date (the old one is ended the day
 * before and kept). Ended chains sit collapsed at the bottom. Add adjustment opens the same drawer empty.
 */
export default function AdjustmentsSection({ today }: { today: string }) {
  const db = useStore(s => s.db)
  const [form, setForm] = useState<null | { head?: FeeRule }>(null)
  const [saved, setSaved] = useState<FeeRule | null>(null)

  const chains = ruleChains(db.feeRules)
  const live = chains.filter(c => ruleState(c.head, today) !== 'ended')
  const ended = chains.filter(c => ruleState(c.head, today) === 'ended')
  const openForm = (head?: FeeRule) => {
    setSaved(null)
    setForm(head ? { head } : {})
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Adjustments"
        description="Every fee, surcharge, discount, and credit on a charge line. A change is a new version from a date; charges already computed keep their fees."
        actions={<button type="button" className={BUTTON_PRIMARY} onClick={() => openForm()}>Add adjustment</button>}
      />

      {saved && (
        <p role="status" data-testid="adjustment-saved" className="rounded-card border border-success/40 bg-success-soft px-4 py-3 text-body text-success">
          Saved {saved.name} ({saved.id}), {feeAmountText(saved)} from {saved.effectiveFrom}.
          {saved.supersedesId ? ` ${saved.supersedesId} ends the day before and is kept.` : ''} Posted invoices never change.
        </p>
      )}

      {FEE_CATEGORIES.map(cat => {
        const list = live.filter(c => feeCategory(c.head) === cat)
        return (
          <Card key={cat} label={CATEGORY_LABEL[cat]}>
            <header className="border-b border-line px-5 py-3">
              <h3 className="text-h2 font-bold">{CATEGORY_LABEL[cat]}</h3>
              <p className="text-small text-muted">{CATEGORY_HINT[cat]}</p>
            </header>
            {list.length === 0
              ? <p className="px-5 py-4 text-small text-muted">None yet.</p>
              : <ul>{list.map(c => <ChainRow key={c.head.id} chain={c} today={today} onEdit={openForm} />)}</ul>}
          </Card>
        )
      })}

      {ended.length > 0 && (
        <details className="rounded-card border border-line bg-surface shadow-card">
          <summary className="cursor-pointer px-5 py-3 text-body font-semibold text-muted">Ended ({ended.length})</summary>
          <ul className="border-t border-line">{ended.map(c => <ChainRow key={c.head.id} chain={c} today={today} onEdit={openForm} />)}</ul>
        </details>
      )}

      {form && (
        <AdjustmentForm
          key={form.head?.id ?? 'new'}
          today={today}
          {...(form.head ? { head: form.head } : {})}
          onClose={() => setForm(null)}
          onSaved={rule => {
            setForm(null)
            setSaved(rule)
          }}
        />
      )}
    </div>
  )
}
