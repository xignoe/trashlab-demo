import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { BillingGroup, FeeRule } from '../../../types'
import { useStore } from '../../../store/useStore'
import { scheduleText } from '../../../store/cycles'
import { BUTTON_LINK, BUTTON_SECONDARY, Card, SectionHeader } from '../components/form'
import { AdjustmentForm } from './AdjustmentForm'
import Pill from '../components/Pill'
import { CYCLE_LABEL } from '../lib/config'
import { dateOnly } from '../lib/dates'
import { feeAmountText, ruleState } from '../lib/rules'

const CYCLE_SENTENCE: Record<string, string> = {
  monthly: 'One invoice a month for the month.',
  quarterly: 'One invoice every three months for the quarter.',
  perJob: 'An invoice when each job is done.',
  net30: 'Invoiced monthly, due 30 days after the invoice date.',
}
const TH = 'px-3 py-2 text-left text-eyebrow font-bold uppercase tracking-[0.08em] text-muted whitespace-nowrap'
const TD = 'px-3 py-2.5 align-middle'

/** "Jan, Apr, Jul, Oct" for a quarterly group starting in month 1. */
/** Active, scheduled (with its start date), paused, or ended, as a pill. */
function RuleStatePill({ rule, today }: { rule: FeeRule; today: string }) {
  const state = ruleState(rule, today)
  if (state === 'scheduled') return <Pill tone="accent">scheduled from {dateOnly(rule.effectiveFrom ?? '')}</Pill>
  if (state === 'active') return <Pill tone="success">active</Pill>
  return <Pill tone="muted">{state}</Pill>
}

/**
 * The Billing cycles section: one card per cycle the billing engine runs (plus any other cycle found on an account),
 * with the accounts on it, how many bill in advance or in arrears, and the adjustments priced by it (a `when.cycle`
 * condition). Lists billing groups with their members when the db has them, read defensively since another surface
 * owns them. New kinds of cycle are billing engine work; pricing by cycle is an adjustment.
 */
export default function CyclesSection({ today }: { today: string }) {
  const db = useStore(s => s.db)
  const [editing, setEditing] = useState<FeeRule | null>(null)
  const [params, setParams] = useSearchParams()
  const openAdjustments = () => {
    const next = new URLSearchParams(params)
    next.set('section', 'adjustments')
    setParams(next, { replace: true })
  }

  const cycles = [...new Set([...Object.keys(CYCLE_LABEL), ...db.accounts.map(a => a.cycle)])]
  const groupsRaw = (db as { billingGroups?: unknown }).billingGroups
  const groups: BillingGroup[] = Array.isArray(groupsRaw) ? (groupsRaw as BillingGroup[]).filter(g => g && typeof g.id === 'string') : []
  const ungrouped = db.accounts.filter(a => !a.billingGroupId).length

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Billing cycles"
        description="The cycles the billing engine runs. Price by cycle with adjustments, for example a prepay discount on quarterly."
        actions={<button type="button" className={BUTTON_SECONDARY} onClick={openAdjustments}>Add a cycle discount</button>}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cycles.map(cycle => {
          const accounts = db.accounts.filter(a => a.cycle === cycle)
          const advance = accounts.filter(a => a.billedInAdvance).length
          const rules = db.feeRules.filter(r => r.when?.cycle?.includes(cycle) && ruleState(r, today) !== 'ended')
          return (
            <Card key={cycle} label={`${CYCLE_LABEL[cycle] ?? cycle} cycle`} className="flex flex-col p-5">
              <div data-cycle={cycle} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-h2 font-bold">{CYCLE_LABEL[cycle] ?? cycle}</h3>
                  <p className="font-mono text-small text-muted">{cycle}</p>
                </div>
                {!CYCLE_LABEL[cycle] && <Pill tone="warning">found on accounts</Pill>}
              </div>
              <p className="mt-1 text-small text-muted">{CYCLE_SENTENCE[cycle] ?? 'Not a cycle the Ratebook knows; billing decides how it runs.'}</p>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-surface-muted px-2 py-2">
                  <dt className="text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">Accounts</dt>
                  <dd className="font-mono text-h2 font-bold text-ink">{accounts.length}</dd>
                </div>
                <div className="rounded-md bg-surface-muted px-2 py-2">
                  <dt className="text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">Advance</dt>
                  <dd className="font-mono text-h2 font-bold text-ink">{advance}</dd>
                </div>
                <div className="rounded-md bg-surface-muted px-2 py-2">
                  <dt className="text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">Arrears</dt>
                  <dd className="font-mono text-h2 font-bold text-ink">{accounts.length - advance}</dd>
                </div>
              </dl>
              <h4 className="mt-4 text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">Priced by this cycle</h4>
              {rules.length === 0 ? (
                <p className="mt-1 text-small text-muted">No adjustment has a condition on this cycle.</p>
              ) : (
                <ul className="mt-1 space-y-1.5">
                  {rules.map(rule => (
                    <li key={rule.id} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span className="min-w-0">
                        <span className="block text-body font-semibold text-ink">{rule.name}</span>
                        <span className="block font-mono text-small text-muted">{feeAmountText(rule)}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <RuleStatePill rule={rule} today={today} />
                        <button type="button" className={BUTTON_LINK} aria-label={`Edit ${rule.name}`} onClick={() => setEditing(rule)}>Edit</button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )
        })}
      </div>

      {groups.length > 0 && (
        <Card label="Billing groups" className="overflow-x-auto">
          <div className="px-5 pt-5">
            <h3 className="text-h2 font-bold">Billing groups</h3>
            <p className="mt-0.5 text-small text-muted">
              Customers billed together on the same dates and terms. A member's cycle follows its group's. {ungrouped} account{ungrouped === 1 ? '' : 's'} bill on their own terms.
            </p>
          </div>
          <table className="mt-3 w-full min-w-[720px] text-body">
            <thead className="border-y border-line bg-surface-muted">
              <tr>
                <th className={TH}>Group</th>
                <th className={TH}>Cycle</th>
                <th className={TH}>Bills in</th>
                <th className={`${TH} text-right`}>Terms</th>
                <th className={`${TH} text-right`}>Members</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => {
                const members = db.accounts.filter(a => a.billingGroupId === g.id).length
                return (
                  <tr key={g.id} data-group={g.id} className="border-b border-line last:border-b-0">
                    <td className={TD}>
                      <span className="block font-semibold text-ink">{g.name}</span>
                      {g.note && <span className="block text-small text-muted">{g.note}</span>}
                    </td>
                    <td className={TD}>{g.schedule ? CYCLE_LABEL[g.schedule.frequency] ?? g.schedule.frequency : 'none'}</td>
                    <td className={TD}>{g.schedule ? scheduleText(g.schedule) : 'none'}</td>
                    <td className={`${TD} text-right font-mono`}>{typeof g.termsDays === 'number' ? `${g.termsDays} days` : 'none'}</td>
                    <td className={`${TD} text-right font-mono`}>{members}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Card label="New kinds of cycle" className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="max-w-[720px] text-body text-muted">
          Adding a new kind of cycle, such as semiannual or annual, is billing engine work: billing has to know how to date, prorate, and collect it.
          Pricing by an existing cycle is configuration: add an adjustment with a billing cycle condition.
        </p>
        <button type="button" className={BUTTON_SECONDARY} onClick={openAdjustments}>Add a cycle discount</button>
      </Card>

      {editing && (
        <AdjustmentForm key={editing.id} today={today} head={editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />
      )}
    </div>
  )
}
