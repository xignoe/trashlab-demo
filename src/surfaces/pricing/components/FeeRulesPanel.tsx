import type { FeeRule, TaxRule } from '../../../types'
import { feeRuleSentence, taxRuleSentence } from '../lib/ratebook'
import { feeAmountText, ruleState, type RuleState } from '../lib/rules'
import Pill, { type PillTone } from './Pill'

const STATE_TONE: Record<RuleState, PillTone> = { active: 'success', scheduled: 'accent', paused: 'muted', ended: 'muted' }

/** A summary of the adjustments and tax layers in force or scheduled, each as a sentence built from its fields, with a
 *  way into the Adjustments section where they are edited. Addresses the owner's fear of a fee on the wrong base. */
export default function FeeRulesPanel({ feeRules, taxRules, today, onManage }: { feeRules: FeeRule[]; taxRules: TaxRule[]; today: string; onManage?: () => void }) {
  const fees = feeRules.filter(r => ruleState(r, today) !== 'ended')
  const taxes = taxRules.filter(r => ruleState(r, today) !== 'ended')
  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-h2 font-bold">Fee and tax rules</h2>
          <p className="mt-0.5 text-small text-muted">Base, conditions, and appliesTo stated for every rule</p>
        </div>
        {onManage && (
          <button type="button" onClick={onManage} className="shrink-0 rounded-md px-2 py-1 text-mono font-semibold text-accent hover:bg-accent-soft">
            Manage
          </button>
        )}
      </div>
      <ul className="mt-2">
        {fees.map(r => {
          const state = ruleState(r, today)
          const unscoped = !r.when && !r.category?.startsWith('loc') && r.minMiles === undefined && r.minNeighborStops === undefined && !r.effectiveFrom
          return (
            <li key={r.id} className="border-t border-line py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body font-semibold">{r.name}</span>
                <span className="font-mono text-eyebrow text-muted">{r.id}</span>
                {state !== 'active' && <Pill tone={STATE_TONE[state]}>{state === 'scheduled' ? `from ${r.effectiveFrom}` : state}</Pill>}
              </div>
              <p className="text-mono leading-5 text-ink">{unscoped ? feeRuleSentence(r) : `${feeAmountText(r)}${r.description ? `: ${r.description}` : ''}`}</p>
            </li>
          )
        })}
        {taxes.map(r => (
          <li key={r.id} className="border-t border-line py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-body font-semibold">{r.name ?? 'Tax'}</span>
              <span className="font-mono text-eyebrow text-muted">{r.id}</span>
            </div>
            <p className="text-mono leading-5 text-ink">{taxRuleSentence(r)}</p>
          </li>
        ))}
      </ul>
      <p className="border-t border-line pt-2.5 text-small text-muted">Fees are computed when a charge is created and the base is kept on the charge</p>
    </section>
  )
}
