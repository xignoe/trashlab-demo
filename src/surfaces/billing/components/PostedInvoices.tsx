import { Fragment, useState } from 'react'
import type { PostedInvoiceRow } from '../../../store/selectors'
import { fmt } from '../../../store/money'
import { dayLabel } from './format'

export function LockIcon({ title = 'Locked' }: { title?: string }) {
  return (
    <svg className="tl-lock" width="14" height="14" viewBox="0 0 16 16" role="img" aria-label={title}>
      <title>{title}</title>
      <rect x="3" y="7" width="10" height="7.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

interface Props {
  /** Cycle dates with posted invoices, oldest first. */
  cycles: string[]
  currentCycle: string
  rowsFor: (cycleDate: string) => PostedInvoiceRow[]
  /** True when the account has a card on file, so an open posted invoice offers "Charge card on file" (box 4.5a). */
  cardOnFile?: (accountId: string) => boolean
  /** The office's explicit charge: one settled card payment applied to the invoice. Throws when it cannot. */
  onChargeCard?: (invoiceId: string) => { payment: { id: string; cents: number } }
}

/**
 * "Posted this cycle": every invoice posted from the current run with number, account, total, and a lock.
 * Earlier posted cycles stay reachable from the segmented control, so after advancing a person can still open
 * the October invoice and see its lines at the price they were posted at.
 */
export function PostedInvoicesCard({ cycles, currentCycle, rowsFor, cardOnFile, onChargeCard }: Props) {
  const [picked, setPicked] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [confirmCharge, setConfirmCharge] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null)
  if (cycles.length === 0) return null
  const view = picked && cycles.includes(picked) ? picked : cycles.includes(currentCycle) ? currentCycle : cycles[cycles.length - 1]
  const rows = rowsFor(view)
  const total = rows.reduce((s, r) => s + r.invoice.totalCents, 0)
  const isCurrent = view === currentCycle

  return (
    <section className="tl-card tl-card-flush" aria-labelledby="posted-title">
      <header className="tl-card-header">
        <div className="tl-card-titles">
          <h2 id="posted-title" className="tl-card-title">{isCurrent ? 'Posted this cycle' : `Posted, ${dayLabel(view)} cycle`}</h2>
          <span className="tl-card-meta">{rows.length} invoice{rows.length === 1 ? '' : 's'} · {fmt(total)} · locked</span>
        </div>
        {cycles.length > 1 && (
          <div className="tl-segmented" role="group" aria-label="Posted cycle">
            {cycles.map(c => (
              <button key={c} type="button" aria-pressed={c === view} onClick={() => { setPicked(c); setOpen(null) }}>
                {dayLabel(c)}{c === currentCycle ? ', this cycle' : ''}
              </button>
            ))}
          </div>
        )}
      </header>
      {notice && <div className="tl-notice" data-tone={notice.tone === 'danger' ? 'danger' : undefined} role={notice.tone === 'danger' ? 'alert' : 'status'}>{notice.text}</div>}
      <div className="tl-table-scroll tl-posted-scroll">
        <table className="tl-table tl-posted-table">
          <colgroup>
            <col style={{ width: 36 }} />
            <col style={{ width: 150 }} />
            <col />
            <col style={{ width: 70 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 110 }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col"><span className="tl-visually-hidden">Locked</span></th>
              <th scope="col">Number</th>
              <th scope="col">Account</th>
              <th scope="col" className="tl-num">Lines</th>
              <th scope="col">Due</th>
              <th scope="col" className="tl-num">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ invoice, accountName, lines, allocations, balanceCents }) => {
              const expanded = open === invoice.id
              return (
                <Fragment key={invoice.id}>
                  <tr data-expanded={expanded ? 'true' : undefined} onClick={() => setOpen(expanded ? null : invoice.id)}>
                    <td className="tl-lock-cell">{invoice.locked && <LockIcon />}</td>
                    <td>
                      <button
                        type="button"
                        className="tl-row-button tl-mono tl-invoice-number"
                        aria-expanded={expanded}
                        aria-controls={`lines-${invoice.id}`}
                        onClick={e => { e.stopPropagation(); setOpen(expanded ? null : invoice.id) }}
                      >
                        {invoice.number}
                      </button>
                    </td>
                    <td>
                      <span className="tl-cell-text">{accountName}</span>
                      <span className="tl-cell-sub tl-mono">{invoice.accountId}</span>
                    </td>
                    <td className="tl-num tl-mono">{lines.length}</td>
                    <td className="tl-mono tl-cell-date">{dayLabel(invoice.dueAt)}</td>
                    <td className="tl-money">{fmt(invoice.totalCents)}</td>
                  </tr>
                  {expanded && (
                    <tr className="tl-posted-lines" id={`lines-${invoice.id}`}>
                      <td></td>
                      <td colSpan={5}>
                        <ul>
                          {lines.map(l => (
                            <li key={l.chargeId}>
                              <span>{l.description}</span>
                              <span className="tl-cell-sub tl-mono">
                                base {fmt(l.baseCents)}{l.rateVersionId ? ` · ${l.rateVersionId}` : l.contractId ? ` · ${l.contractId}` : ` · ${l.ruleWon}`}
                              </span>
                              <span className="tl-mono">{fmt(l.totalCents)}</span>
                            </li>
                          ))}
                          {allocations.map(a => (
                            <li key={`${a.sourceId}-${a.invoiceId}`} data-testid={`applied-${a.sourceId}`}>
                              <span>{a.sourceType === 'payment' ? 'Payment applied' : 'Credit applied'}</span>
                              <span className="tl-cell-sub tl-mono">{a.sourceId}</span>
                              <span className="tl-mono">({fmt(a.cents)})</span>
                            </li>
                          ))}
                          {allocations.length > 0 && (
                            <li data-testid={`balance-${invoice.id}`}>
                              <span>Balance</span>
                              <span className="tl-cell-sub"></span>
                              <span className="tl-mono">{fmt(balanceCents)}</span>
                            </li>
                          )}
                        </ul>
                        {onChargeCard && cardOnFile?.(invoice.accountId) && balanceCents > 0 && (
                          <div className="tl-posted-charge">
                            {confirmCharge === invoice.id ? (
                              <div className="tl-confirm" role="dialog" aria-label={`Confirm card charge for ${invoice.number}`}>
                                <div className="tl-confirm-text">
                                  <strong>Charge {fmt(balanceCents)} to {accountName}'s card on file for {invoice.number}?</strong>
                                  <span>This records a settled card payment for the open balance and applies it to this invoice. Posting never charges a card; this click does.</span>
                                </div>
                                <div className="tl-action-row">
                                  <button type="button" className="tl-btn tl-btn-primary tl-btn-compact" autoFocus
                                    onClick={() => {
                                      try {
                                        const { payment } = onChargeCard(invoice.id)
                                        setNotice({ tone: 'ok', text: `Charged ${fmt(payment.cents)} to ${accountName}'s card on file: ${payment.id} applied to ${invoice.number}, balance ${fmt(0)}.` })
                                      } catch (e) {
                                        setNotice({ tone: 'danger', text: e instanceof Error ? e.message : String(e) })
                                      }
                                      setConfirmCharge(null)
                                    }}>
                                    Charge {fmt(balanceCents)}
                                  </button>
                                  <button type="button" className="tl-btn tl-btn-secondary tl-btn-compact" onClick={() => setConfirmCharge(null)}>Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <button type="button" className="tl-btn tl-btn-secondary tl-btn-compact" onClick={() => { setNotice(null); setConfirmCharge(invoice.id) }}>
                                Charge card on file
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
