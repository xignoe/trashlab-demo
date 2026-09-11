import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../../../store/useStore'
import { chargeDetail, DECISION_LABEL } from '../../../store/selectors'
import { fmt } from '../../../store/money'
import { DetailPanel } from './DetailPanel'
import { useBillingData } from './useBillingData'
import { capitalize, monthYear } from './format'
import { decisionTone, kindTone, suggestionTone } from './pills'

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * "Charges to review" on one account's page: this account's items from the current cycle's queue (the charges that
 * need a person: events, overages, rate changes, service changes), undecided first. The picked item opens billing's
 * detail panel below the list, with its evidence, policy, agent suggestion, and Approve, Edit, Waive. Deciding moves
 * to the next undecided item here; when none are left it points to the next account with charges to review.
 * Renders nothing when this account has no queue items this cycle.
 */
export function ReviewPanel({ accountId }: { accountId: string }) {
  const { data, queue } = useBillingData()
  const approve = useStore(s => s.approve)
  const editAmount = useStore(s => s.editAmount)
  const waive = useStore(s => s.waive)
  const previewEdit = useStore(s => s.previewEdit)
  const feeRules = data.db.feeRules
  const feeName = useCallback((id: string) => feeRules.find(r => r.id === id)?.name ?? id, [feeRules])

  const items = useMemo(() => queue.filter(i => i.accountId === accountId), [queue, accountId])
  const undecided = items.filter(i => !i.decided)
  const [picked, setPicked] = useState<string | null>(null)
  // The item the person picked; otherwise the first undecided, so a decision (which clears the pick) advances.
  const selectedId = picked !== null && items.some(i => i.chargeId === picked) ? picked : undecided[0]?.chargeId ?? null
  const detail = useMemo(() => chargeDetail(data, selectedId), [data, selectedId])
  const nextAccount = useMemo(() => queue.find(i => !i.decided && i.accountId !== accountId), [queue, accountId])

  if (items.length === 0) return null

  const decide = (fn: () => void) => {
    fn()
    setPicked(null)
  }

  return (
    <div className="surface-billing surface-billing-embed">
      <section className="tl-card tl-card-flush" aria-labelledby="review-title">
        <header className="tl-card-header">
          <div className="tl-card-titles">
            <h2 id="review-title" className="tl-card-title">Charges to review</h2>
            <span className="tl-card-meta">
              {monthYear(data.cycleDate)} cycle · {undecided.length > 0 ? `${plural(undecided.length, 'charge')} waiting on you` : 'all decided'}
            </span>
          </div>
        </header>
        <div className="tl-table-scroll">
          <table className="tl-table tl-queue-table">
            <colgroup>
              <col />
              <col style={{ width: 110 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 110 }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Charge</th>
                <th scope="col" className="tl-num">Proposed</th>
                <th scope="col">Haul-E suggests</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const selected = item.chargeId === selectedId
                return (
                  <tr
                    key={item.chargeId}
                    data-selected={selected ? 'true' : undefined}
                    data-decided={item.decided ? 'true' : undefined}
                    onClick={() => setPicked(item.chargeId)}
                  >
                    <td>
                      <button
                        type="button"
                        className="tl-row-button"
                        aria-pressed={selected}
                        onClick={e => { e.stopPropagation(); setPicked(item.chargeId) }}
                      >
                        <span className="tl-pill" data-tone={kindTone(item.kind)}>{item.kindLabel}</span>
                      </button>
                      <span className="tl-cell-sub" title={item.charge.description}>{item.charge.description}</span>
                    </td>
                    <td className="tl-money">
                      <span data-waived={item.decision === 'waived' ? 'true' : undefined}>{fmt(item.charge.totalCents)}</span>
                      {item.edit && <span className="tl-cell-sub tl-was" title="Originally proposed">{fmt(item.edit.originalTotalCents)}</span>}
                    </td>
                    <td><span className="tl-pill" data-tone={suggestionTone(item.suggestion.action)}>{capitalize(item.suggestion.action)}</span></td>
                    <td><span className="tl-pill" data-tone={decisionTone(item.decision)}>{DECISION_LABEL[item.decision]}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {undecided.length === 0 && (
          <div className="tl-empty tl-empty-done" role="status">
            Every charge on this account is decided.{' '}
            {nextAccount
              ? <Link to={`/office/account/${nextAccount.accountId}`}>Next account to review: {nextAccount.accountName}</Link>
              : <Link to="/office/account">Nothing left to review. Post invoices from Accounts.</Link>}
          </div>
        )}
      </section>
      {detail && (
        <DetailPanel
          key={detail.charge.id}
          detail={detail}
          ran
          onApprove={id => decide(() => approve(id))}
          onEdit={(id, cents, reason) => decide(() => { editAmount(id, cents, reason) })}
          onWaive={(id, reason, note) => decide(() => waive(id, reason, note))}
          previewEdit={previewEdit}
          feeName={feeName}
        />
      )}
    </div>
  )
}
