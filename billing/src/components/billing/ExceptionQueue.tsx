import { useState } from 'react'
import type { BatchSummary, CleanApprovalPreview, PostPreview, QueueItem } from '../../store/selectors'
import { DECISION_LABEL } from '../../store/selectors'
import { fmt } from '../../store/money'
import { CONFIDENCE_LABEL, capitalize } from './format'
import { decisionTone, kindTone, suggestionTone } from './pills'

interface Props {
  items: QueueItem[]
  summary: BatchSummary
  selectedId: string | null
  onSelect: (chargeId: string) => void
  bulk: CleanApprovalPreview
  posting: PostPreview
  onBulkApprove: () => { count: number; cents: number }
  onPost: () => { count: number; cents: number }
}

type Confirming = 'bulk' | 'post' | null

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * One row per queue item. Undecided rows come first (the selector sorts); clicking a row selects it.
 * The header carries Bulk approve clean and Post invoices, each behind an inline confirmation.
 */
export function ExceptionQueue({ items, summary, selectedId, onSelect, bulk, posting, onBulkApprove, onPost }: Props) {
  const [confirming, setConfirming] = useState<Confirming>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const undecided = items.filter(i => !i.decided).length
  const meta = !summary.ran
    ? 'Nothing generated for this cycle yet'
    : `${plural(items.length, 'item')}, ${undecided} undecided`

  const postTitle = !summary.ran
    ? 'Run the cycle first'
    : posting.undecidedCount > 0
      ? `Decide the ${plural(posting.undecidedCount, 'open queue item')} first`
      : posting.invoiceCount === 0
        ? 'Nothing approved is waiting to post'
        : `Post ${plural(posting.invoiceCount, 'invoice')}`

  function run(action: () => { count: number; cents: number }, done: (r: { count: number; cents: number }) => string) {
    setError(null)
    try {
      const r = action()
      setNotice(done(r))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setConfirming(null)
  }

  return (
    <section className="tl-card tl-card-flush" aria-labelledby="queue-title">
      <header className="tl-card-header">
        <div className="tl-card-titles">
          <h2 id="queue-title" className="tl-card-title">Exception queue</h2>
          <span className="tl-card-meta">{meta}</span>
        </div>
        <div className="tl-header-actions">
          <button
            type="button"
            className="tl-btn tl-btn-secondary tl-btn-compact"
            disabled={bulk.count === 0}
            aria-expanded={confirming === 'bulk'}
            title={bulk.count === 0 ? 'No proposed clean charges left' : undefined}
            onClick={() => { setNotice(null); setConfirming(confirming === 'bulk' ? null : 'bulk') }}
          >
            Bulk approve {bulk.count} clean
          </button>
          <button
            type="button"
            className={`tl-btn tl-btn-compact ${posting.ready ? 'tl-btn-primary' : 'tl-btn-muted'}`}
            disabled={!posting.ready}
            aria-expanded={confirming === 'post'}
            title={postTitle}
            onClick={() => { setNotice(null); setConfirming(confirming === 'post' ? null : 'post') }}
          >
            Post invoices
          </button>
        </div>
      </header>

      {confirming === 'bulk' && (
        <div className="tl-confirm" role="dialog" aria-label="Confirm bulk approve">
          <div className="tl-confirm-text">
            <strong>Approve {plural(bulk.count, 'clean charge')} totaling {fmt(bulk.cents)}?</strong>
            <span>
              These are the lines with no exception and no change from the prior cycle. The {plural(items.length, 'queue item')} below
              {' '}stay exactly as they are.
            </span>
          </div>
          <div className="tl-action-row">
            <button type="button" className="tl-btn tl-btn-primary tl-btn-compact" autoFocus
              onClick={() => run(onBulkApprove, r => `Approved ${plural(r.count, 'clean charge')}, ${fmt(r.cents)}.`)}>
              Approve {bulk.count}
            </button>
            <button type="button" className="tl-btn tl-btn-secondary tl-btn-compact" onClick={() => setConfirming(null)}>Cancel</button>
          </div>
        </div>
      )}

      {confirming === 'post' && (
        <div className="tl-confirm" role="dialog" aria-label="Confirm posting">
          <div className="tl-confirm-text">
            <strong>Post {plural(posting.invoiceCount, 'invoice')} totaling {fmt(posting.totalCents)}?</strong>
            <span>
              Numbers {posting.firstNumber}{posting.lastNumber !== posting.firstNumber ? ` to ${posting.lastNumber}` : ''}, one per account,
              {' '}from {plural(posting.chargeIds.length, 'approved charge')}. Posting locks each invoice; corrections after posting are credit memos.
            </span>
            {posting.unapprovedCleanCount > 0 && (
              <span className="tl-confirm-warn">
                {plural(posting.unapprovedCleanCount, 'clean charge is', 'clean charges are')} not approved yet and will stay off these invoices.
                {' '}Bulk approve them first to include them.
              </span>
            )}
          </div>
          <ul className="tl-confirm-list" aria-label="Invoices to post">
            {posting.rows.map(r => (
              <li key={r.accountId}>
                <span>{r.accountName}</span>
                <span className="tl-cell-sub">{plural(r.chargeCount, 'line')}</span>
                <span className="tl-mono">{fmt(r.totalCents)}</span>
              </li>
            ))}
          </ul>
          <div className="tl-action-row">
            <button type="button" className="tl-btn tl-btn-primary tl-btn-compact" autoFocus
              onClick={() => run(onPost, r => `Posted ${plural(r.count, 'invoice')}, ${fmt(r.cents)}. Each one is locked.`)}>
              Post {plural(posting.invoiceCount, 'invoice')}
            </button>
            <button type="button" className="tl-btn tl-btn-secondary tl-btn-compact" onClick={() => setConfirming(null)}>Cancel</button>
          </div>
        </div>
      )}

      {notice && <div className="tl-notice" role="status">{notice}</div>}
      {error && <div className="tl-notice" data-tone="danger" role="alert">{error}</div>}

      {!summary.ran ? (
        <div className="tl-empty" role="status">Run the cycle to see exceptions</div>
      ) : (
        <>
          {undecided === 0 && (
            <div className="tl-empty tl-empty-done" role="status">
              {summary.allPosted
                ? `All decisions made. ${plural(summary.postedInvoiceCount, 'invoice')} posted for this cycle.`
                : 'All decisions made. Ready to post.'}
            </div>
          )}
          {items.length > 0 && (
            <div className="tl-table-scroll">
              <table className="tl-table tl-queue-table">
                <colgroup>
                  <col style={{ width: 220 }} />
                  <col style={{ width: 150 }} />
                  <col style={{ width: 130 }} />
                  <col style={{ width: 100 }} />
                  <col style={{ width: 150 }} />
                  <col style={{ width: 90 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Route</th>
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
                        onClick={() => onSelect(item.chargeId)}
                      >
                        <td>
                          <button
                            type="button"
                            className="tl-row-button"
                            aria-pressed={selected}
                            onClick={e => { e.stopPropagation(); onSelect(item.chargeId) }}
                          >
                            {item.accountName}
                          </button>
                          <span className="tl-cell-sub tl-mono">{item.accountId}</span>
                        </td>
                        <td><span className="tl-pill" data-tone={kindTone(item.kind)}>{item.kindLabel}</span></td>
                        <td>
                          <span className="tl-cell-text">{item.routeLabel}</span>
                          <span className="tl-cell-sub" title={item.siteAddress}>{item.siteAddress}</span>
                        </td>
                        <td className="tl-money">
                          <span data-waived={item.decision === 'waived' ? 'true' : undefined}>{fmt(item.charge.totalCents)}</span>
                          {item.edit && (
                            <span className="tl-cell-sub tl-was" title="Originally proposed">{fmt(item.edit.originalTotalCents)}</span>
                          )}
                        </td>
                        <td>
                          <span className="tl-pill" data-tone={suggestionTone(item.suggestion.action)}>{capitalize(item.suggestion.action)}</span>
                          <span className="tl-cell-sub">{CONFIDENCE_LABEL[item.suggestion.confidence]}</span>
                        </td>
                        <td><span className="tl-pill" data-tone={decisionTone(item.decision)}>{DECISION_LABEL[item.decision]}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}
