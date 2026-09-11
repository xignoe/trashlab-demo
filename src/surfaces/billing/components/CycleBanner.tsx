import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../../../store/useStore'
import { fmt } from '../../../store/money'
import { useBillingData } from './useBillingData'
import { monthYear } from './format'

type Confirming = 'bulk' | 'rates' | 'post' | null

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * The billing cycle on the Accounts page, once it has run (the Run cycle button beside the Accounts title runs it). What used to be
 * the billing run's header and queue actions: how many charges still need a person, bulk approve of the clean lines,
 * the grouped rate-change approval, and Post invoices, each behind an inline confirmation. The per-charge decisions
 * (evidence, approve, edit, waive) live on each account's page. Renders nothing before the cycle runs.
 */
export function CycleBanner({ reviewHref }: { reviewHref: string }) {
  const { data, summary, bulk, posting, rateChanges } = useBillingData()
  const bulkApproveClean = useStore(s => s.bulkApproveClean)
  const approveRateChanges = useStore(s => s.approveRateChanges)
  const post = useStore(s => s.post)
  const [confirming, setConfirming] = useState<Confirming>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!summary.ran) return null

  const postTitle = posting.undecidedCount > 0
    ? `Decide the ${plural(posting.undecidedCount, 'charge')} under review first`
    : posting.invoiceCount === 0
      ? 'Nothing approved is waiting to post'
      : `Post ${plural(posting.invoiceCount, 'invoice')}`

  function run(action: () => { count: number; cents: number }, done: (r: { count: number; cents: number }) => string) {
    setError(null)
    try {
      setNotice(done(action()))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setConfirming(null)
  }
  const toggle = (c: Confirming) => {
    setNotice(null)
    setConfirming(confirming === c ? null : c)
  }

  return (
    <div className="surface-billing surface-billing-embed">
      <section className="tl-card tl-card-flush" aria-labelledby="cycle-title">
        <header className="tl-card-header">
          <div className="tl-card-titles">
            <h2 id="cycle-title" className="tl-card-title">
              {monthYear(data.cycleDate)} cycle{' '}
              {summary.allPosted ? (
                <span className="tl-pill" data-tone="ok">Posted</span>
              ) : summary.undecidedCount > 0 ? (
                <span className="tl-pill" data-tone="warn">{plural(summary.undecidedCount, 'charge')} to review</span>
              ) : (
                <span className="tl-pill" data-tone="ok">Ready to post</span>
              )}
            </h2>
            <span className="tl-card-meta">
              {summary.allPosted
                ? `${plural(summary.postedInvoiceCount, 'invoice')} posted and locked, ${fmt(summary.postedTotalCents)}. `
                : `${plural(summary.invoicesToGenerate, 'invoice')}, ${fmt(summary.runTotalCents)} run total. ${summary.needDecisions > 0 ? `${plural(summary.needDecisions, 'account')} waiting on a decision. ` : ''}`}
              {summary.allPosted
                ? <Link to="/office/payments">Charge cards and apply payments on Payments</Link>
                : summary.undecidedCount > 0 && <Link to={reviewHref}>Show accounts to review</Link>}
            </span>
          </div>
          {!summary.allPosted && (
            <div className="tl-header-actions">
              {rateChanges.count > 0 && (
                <button type="button" className="tl-btn tl-btn-secondary tl-btn-compact" aria-expanded={confirming === 'rates'} onClick={() => toggle('rates')}>
                  Approve {plural(rateChanges.count, 'rate change')}
                </button>
              )}
              <button
                type="button"
                className="tl-btn tl-btn-secondary tl-btn-compact"
                disabled={bulk.count === 0}
                aria-expanded={confirming === 'bulk'}
                title={bulk.count === 0 ? 'No proposed clean charges left' : undefined}
                onClick={() => toggle('bulk')}
              >
                Bulk approve {bulk.count} clean
              </button>
              <button
                type="button"
                className={`tl-btn tl-btn-compact ${posting.ready ? 'tl-btn-primary' : 'tl-btn-muted'}`}
                disabled={!posting.ready}
                aria-expanded={confirming === 'post'}
                title={postTitle}
                onClick={() => toggle('post')}
              >
                Post invoices
              </button>
            </div>
          )}
        </header>

        {confirming === 'bulk' && (
          <div className="tl-confirm" role="dialog" aria-label="Confirm bulk approve">
            <div className="tl-confirm-text">
              <strong>Approve {plural(bulk.count, 'clean charge')} totaling {fmt(bulk.cents)}?</strong>
              <span>These are the lines with no exception and no change from the prior cycle. Charges under review stay exactly as they are.</span>
            </div>
            <div className="tl-action-row">
              <button type="button" className="tl-btn tl-btn-primary tl-btn-compact" autoFocus
                onClick={() => run(bulkApproveClean, r => `Approved ${plural(r.count, 'clean charge')}, ${fmt(r.cents)}.`)}>
                Approve {bulk.count}
              </button>
              <button type="button" className="tl-btn tl-btn-secondary tl-btn-compact" onClick={() => setConfirming(null)}>Cancel</button>
            </div>
          </div>
        )}

        {confirming === 'rates' && (
          <div className="tl-confirm" role="dialog" aria-label="Confirm rate changes">
            <div className="tl-confirm-text">
              <strong>Approve {plural(rateChanges.count, 'rate change')} totaling {fmt(rateChanges.cents)}?</strong>
              <span>
                Each is a recurring line priced at a rate version the owner published since the prior cycle. The other
                {' '}{plural(rateChanges.otherUndecided, 'charge')} under review stay one decision each.
              </span>
            </div>
            <div className="tl-action-row">
              <button type="button" className="tl-btn tl-btn-primary tl-btn-compact" autoFocus
                onClick={() => run(approveRateChanges, r => `Approved ${plural(r.count, 'rate change')}, ${fmt(r.cents)}.`)}>
                Approve {plural(rateChanges.count, 'rate change')}
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
                onClick={() => run(() => {
                  const invoices = post()
                  return { count: invoices.length, cents: invoices.reduce((s, i) => s + i.totalCents, 0) }
                }, r => `Posted ${plural(r.count, 'invoice')}, ${fmt(r.cents)}. Each one is locked.`)}>
                Post {plural(posting.invoiceCount, 'invoice')}
              </button>
              <button type="button" className="tl-btn tl-btn-secondary tl-btn-compact" onClick={() => setConfirming(null)}>Cancel</button>
            </div>
          </div>
        )}

        {notice && <div className="tl-notice" role="status">{notice}</div>}
        {error && <div className="tl-notice" data-tone="danger" role="alert">{error}</div>}
      </section>
    </div>
  )
}
