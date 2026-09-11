import { useId, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Invoice, Payment } from '../../types'
import { useStore } from '../../store/useStore'
import { fmt, parseDollars } from '../../store/money'
import {
  batchView, checkView, openInvoicesFor, paidInvoicesFor, paymentTiles, suggestedSplit, unappliedPayments,
  type BatchView, type CheckView, type OpenInvoice, type PaymentRow, type PaymentTiles,
} from '../../store/paymentSelectors'
import { dayLabel, longDate } from './format'

type Tab = 'run' | 'payments'

const METHOD_LABEL: Record<Payment['method'], string> = {
  check: 'Check',
  card: 'Card',
  ach: 'ACH',
  autopay: 'Autopay',
  cash: 'Cash',
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * Payments tab on /billing, built from the manager's Paper artboard "Billing payments, Office" (XV-0): header
 * with the Run | Payments switch, four tiles, the processor batch and the Oakridge check in the main column, and
 * unapplied cash plus the allocation rules in the side column. Every figure comes from src/store/paymentSelectors.ts.
 */
export function PaymentsTab({ onSelectTab }: { onSelectTab: (tab: Tab) => void }) {
  const { db, leftOnAccount } = useStore(useShallow(s => ({ db: s.db, leftOnAccount: s.leftOnAccount })))
  const applyUnapplied = useStore(s => s.applyUnapplied)
  const leaveOnAccount = useStore(s => s.leaveOnAccount)
  const state = useMemo(() => ({ db }), [db])
  const tiles = useMemo(() => paymentTiles(state), [state])
  const batch = useMemo(() => batchView(state), [state])
  const check = useMemo(() => checkView(state), [state])
  const unapplied = useMemo(() => unappliedPayments(state), [state])

  return (
    <>
      <header className="tl-page-header">
        <div>
          <div className="tl-eyebrow">Office · Billing run · Payments</div>
          <div className="tl-header-title-row">
            <h1 className="tl-page-title">Payments and deposits</h1>
            {tiles.unappliedCount > 0
              ? <span className="tl-pill" data-tone="warn">{plural(tiles.unappliedCount, 'payment')} unapplied</span>
              : <span className="tl-pill" data-tone="ok">All cash applied</span>}
          </div>
          <p className="tl-page-subtitle">One check across three invoices, one processor batch split 14 ways, and whatever did not match.</p>
        </div>
        <div className="tl-header-actions">
          <div className="tl-segmented" role="group" aria-label="Billing view">
            <button type="button" aria-pressed={false} onClick={() => onSelectTab('run')}>Run</button>
            <button type="button" aria-pressed={true}>Payments</button>
          </div>
        </div>
      </header>

      <PaymentTilesRow tiles={tiles} />

      <div className="tl-columns">
        <div className="tl-stack">
          {batch ? <BatchCard view={batch} /> : <MissingCard title="Processor batch batch_0908" />}
          {check ? <CheckCard view={check} /> : <MissingCard title="Check: Oakridge Property Group" />}
        </div>
        <div className="tl-stack">
          <UnappliedCard
            rows={unapplied}
            leftOnAccount={leftOnAccount}
            openFor={accountId => openInvoicesFor(state, accountId)}
            paidFor={accountId => paidInvoicesFor(state, accountId)}
            onApply={(paymentId, invoiceIds, cents) => { applyUnapplied({ paymentId, invoiceIds, cents }) }}
            onLeave={leaveOnAccount}
          />
          <AllocationRulesCard />
        </div>
      </div>
    </>
  )
}

function MissingCard({ title }: { title: string }) {
  return (
    <section className="tl-card tl-card-lg">
      <h2 className="tl-card-title">{title}</h2>
      <p className="tl-detail-body">Not in the seed.</p>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

function PaymentTilesRow({ tiles }: { tiles: PaymentTiles }) {
  const span = `${dayLabel(tiles.from)} to ${dayLabel(tiles.to)}`
  const items: { label: string; value: string; caption: string; tone?: 'ok' | 'warn' | 'danger' }[] = [
    { label: 'Received this week', value: fmt(tiles.receivedCents), caption: `${plural(tiles.receivedCount, 'payment')}, ${span}` },
    { label: 'Applied', value: fmt(tiles.appliedCents), caption: `${plural(tiles.appliedCount, 'allocation')} to invoices`, tone: 'ok' },
    { label: 'Unapplied cash', value: fmt(tiles.unappliedCents), caption: `${plural(tiles.unappliedCount, 'payment')} with money left over`, tone: 'warn' },
    { label: 'Processor fees', value: fmt(tiles.feeCents), caption: `${plural(tiles.batchCount, 'batch', 'batches')}, never billed to a customer`, tone: 'danger' },
  ]
  return (
    <section className="tl-tiles tl-tiles-4" aria-label="Payments summary">
      {items.map(t => (
        <div className="tl-card tl-stat" key={t.label}>
          <span className="tl-eyebrow" data-tone={t.tone}>{t.label}</span>
          <span className="tl-stat-value">{t.value}</span>
          <span className="tl-stat-caption">{t.caption}</span>
        </div>
      ))}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Processor batch
// ---------------------------------------------------------------------------

function Figure({ label, value, tone, valueTone }: { label: string; value: string; tone?: 'ok' | 'danger'; valueTone?: 'danger' }) {
  return (
    <div className="tl-figure">
      <span className="tl-eyebrow" data-tone={tone}>{label}</span>
      <span className="tl-figure-value tl-mono" data-tone={valueTone}>{value}</span>
    </div>
  )
}

function unappliedTone(cents: number): 'zero' | 'danger' {
  return cents > 0 ? 'danger' : 'zero'
}

function BatchCard({ view }: { view: BatchView }) {
  const { batch, rows } = view
  const methods = [...new Set(rows.map(r => METHOD_LABEL[r.payment.method].toLowerCase()))].join(' and ')
  return (
    <section className="tl-card tl-card-flush" aria-labelledby="batch-title">
      <header className="tl-card-header">
        <div className="tl-card-titles">
          <h2 id="batch-title" className="tl-card-title">Processor batch {batch.id}</h2>
          <span className="tl-card-meta">Deposited {dayLabel(batch.depositedAt)} · {rows.length} {methods} payments · one line in the bank feed</span>
        </div>
        <div className="tl-figures" aria-label="Batch figures">
          <Figure label="Gross" value={fmt(batch.grossCents)} />
          <Figure label="Fees" value={`(${fmt(batch.feeCents)})`} tone="danger" valueTone="danger" />
          <Figure label="Net deposited" value={fmt(batch.netCents)} tone="ok" />
        </div>
      </header>
      <div className="tl-table-scroll">
        <table className="tl-table tl-pay-table" aria-label={`Payments in ${batch.id}`}>
          <colgroup>
            <col style={{ width: 130 }} />
            <col style={{ width: 230 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 110 }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Payment</th>
              <th scope="col">Account</th>
              <th scope="col">Invoice</th>
              <th scope="col" className="tl-num">Paid</th>
              <th scope="col" className="tl-num">Applied</th>
              <th scope="col" className="tl-num">Unapplied</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.payment.id} data-testid={`batch-row-${r.payment.id}`}>
                <td className="tl-pay-id">{r.payment.id}</td>
                <td className="tl-primary">{r.accountName}</td>
                <td>
                  {r.allocations.length === 0
                    ? <span className="tl-cell-sub">Not applied</span>
                    : r.allocations.map(a => <span key={a.invoiceId} className="tl-pay-invoice">{a.invoiceNumber}</span>)}
                  {r.openOnInvoicesCents > 0 && (
                    <span className="tl-cell-sub" data-tone="danger">Short {fmt(r.openOnInvoicesCents)}, still open on invoice</span>
                  )}
                  {r.unappliedCents > 0 && <span className="tl-cell-sub">Overpaid, see Unapplied cash</span>}
                </td>
                <td className="tl-money">{fmt(r.payment.cents)}</td>
                <td className="tl-money">{fmt(r.allocatedCents)}</td>
                <td className="tl-money" data-tone={unappliedTone(r.unappliedCents)}>{fmt(r.unappliedCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>{plural(rows.length, 'payment')}</td>
              <td className={view.grossMatches ? 'tl-foot-ok' : 'tl-foot-bad'}>
                {view.grossMatches ? 'Equals gross' : `Gross is ${fmt(batch.grossCents)}`}
              </td>
              <td className="tl-money" data-testid="batch-paid-sum">{fmt(view.paidCents)}</td>
              <td className="tl-money" data-testid="batch-applied-sum">{fmt(view.allocatedCents)}</td>
              <td className="tl-money" data-tone={unappliedTone(view.unappliedCents)} data-testid="batch-unapplied-sum">{fmt(view.unappliedCents)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="tl-callout tl-card-callout">
        <div className="tl-eyebrow">Why the bank shows {fmt(batch.netCents)}</div>
        <p className="tl-callout-body">
          The processor deposits the batch as one line: {fmt(batch.grossCents)} collected from customers less {fmt(batch.feeCents)} in
          processing fees. Fees are a cost of collecting and never reduce what a customer owes, so every invoice is
          credited at the full amount paid.
        </p>
        {view.shortPays.map(r => (
          <p key={r.payment.id} className="tl-callout-body">
            {r.accountName} paid {fmt(r.payment.cents)} against {r.allocations.map(a => a.invoiceNumber).join(', ')}, which
            leaves {fmt(r.openOnInvoicesCents)} open on the invoice. That is an open balance the customer still owes, not unapplied cash.
          </p>
        ))}
        <div className="tl-equation" aria-label="Batch arithmetic">
          <span>Gross <strong>{fmt(batch.grossCents)}</strong> less fees <strong>{fmt(batch.feeCents)}</strong> equals net <strong>{fmt(batch.grossCents - batch.feeCents)}</strong></span>
          <span>Applied <strong>{fmt(view.allocatedCents)}</strong> plus unapplied <strong>{fmt(view.unappliedCents)}</strong> equals gross <strong>{fmt(view.allocatedCents + view.unappliedCents)}</strong></span>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

function CheckCard({ view }: { view: CheckView }) {
  const { payment, allocations } = view
  const invoiceTotal = allocations.reduce((s, a) => s + a.invoiceTotalCents, 0)
  return (
    <section className="tl-card tl-card-flush" aria-labelledby="check-title">
      <header className="tl-card-header">
        <div className="tl-card-titles">
          <h2 id="check-title" className="tl-card-title">Check: {view.accountName}</h2>
          <span className="tl-card-meta">
            {payment.id} · received {longDate(payment.receivedAt)} · {METHOD_LABEL[payment.method].toLowerCase()} across {plural(allocations.length, 'invoice')}
          </span>
        </div>
        <div className="tl-figures">
          <Figure label="Check amount" value={fmt(payment.cents)} />
        </div>
      </header>
      <div className="tl-table-scroll">
        <table className="tl-table tl-pay-table" aria-label={`Allocations of ${payment.id}`}>
          <colgroup>
            <col style={{ width: 180 }} />
            <col style={{ width: 200 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 130 }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Invoice</th>
              <th scope="col">Period</th>
              <th scope="col" className="tl-num">Invoice total</th>
              <th scope="col" className="tl-num">Allocated</th>
              <th scope="col" className="tl-num">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {allocations.map(a => (
              <tr key={a.invoiceId}>
                <td>
                  <span className="tl-pay-invoice tl-pay-invoice-lg">{a.invoiceNumber}</span>
                  <span className="tl-cell-sub tl-mono">{a.invoiceId}</span>
                </td>
                <td className="tl-cell-text">{a.periodLabel}{a.siteCount > 1 ? `, ${a.siteCount} sites` : ''}</td>
                <td className="tl-money">{fmt(a.invoiceTotalCents)}</td>
                <td className="tl-money">{fmt(a.cents)}</td>
                <td className="tl-money" data-tone={a.invoiceBalanceCents === 0 ? 'ok' : 'danger'}>{fmt(a.invoiceBalanceCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>{plural(allocations.length, 'allocation')}</td>
              <td className={view.fullyApplied ? 'tl-foot-ok' : 'tl-foot-bad'} data-testid="check-status">
                {view.fullyApplied
                  ? `Check ${fmt(payment.cents)} equals allocations`
                  : `Check ${fmt(payment.cents)}, allocated ${fmt(view.allocatedCents)}`}
              </td>
              <td className="tl-money">{fmt(invoiceTotal)}</td>
              <td className="tl-money" data-testid="check-allocated-sum">{fmt(view.allocatedCents)}</td>
              <td className="tl-money" data-tone={view.remainingCents === 0 ? 'ok' : 'danger'}>{fmt(view.remainingCents)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="tl-card-note">
        {view.fullyApplied
          ? 'Check fully applied. One payment, three invoices: allocation is many to many, so a property manager can pay several months with one check.'
          : `${fmt(payment.cents - view.allocatedCents)} of the check is not yet on an invoice and shows under Unapplied cash.`}
      </p>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Unapplied cash
// ---------------------------------------------------------------------------

/** Artboard row title: what kind of leftover this is, not who paid (the payer is in the meta line). */
function unappliedKind(r: PaymentRow): string {
  const method = METHOD_LABEL[r.payment.method]
  return r.allocations.length > 0 ? `${method} overpayment` : `${method}, no invoice match`
}

/** "Apply to INV-2026-0204" when exactly one invoice is open, as on the artboard; plain "Apply" otherwise. */
function applyLabel(open: OpenInvoice[]): string {
  return open.length === 1 ? `Apply to ${open[0].invoice.number}` : 'Apply'
}

interface UnappliedCardProps {
  rows: PaymentRow[]
  leftOnAccount: Record<string, string>
  openFor: (accountId: string) => OpenInvoice[]
  paidFor: (accountId: string) => Invoice[]
  /** Throws the engine's error on over-allocation. */
  onApply: (paymentId: string, invoiceIds: string[], cents: number[]) => void
  onLeave: (paymentId: string) => void
}

function UnappliedCard({ rows, leftOnAccount, openFor, paidFor, onApply, onLeave }: UnappliedCardProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const total = rows.reduce((s, r) => s + r.unappliedCents, 0)

  return (
    <section className="tl-list-card" aria-labelledby="unapplied-title">
      <header className="tl-list-card-header">
        <h2 id="unapplied-title" className="tl-list-card-title">Unapplied cash</h2>
        <span className="tl-list-card-meta">{plural(rows.length, 'payment')} · {fmt(total)}</span>
      </header>
      {notice && <p className="tl-notice" role="status">{notice}</p>}
      {rows.length === 0 ? (
        <p className="tl-unapplied-empty">Every payment is on an invoice. Nothing unapplied.</p>
      ) : (
        <ul className="tl-unapplied-list">
          {rows.map(r => {
            const left = leftOnAccount[r.payment.id]
            const open = openId === r.payment.id
            return (
              <li key={r.payment.id} className="tl-unapplied-row" data-testid={`unapplied-${r.payment.id}`}>
                <div className="tl-unapplied-main">
                  <div className="tl-unapplied-text">
                    <span className="tl-unapplied-title">{unappliedKind(r)}</span>
                    <span className="tl-unapplied-meta">
                      <span className="tl-mono">{r.payment.id}</span> · {r.accountName} · {dayLabel(r.payment.receivedAt)}
                      {r.payment.processorBatchId ? ` · ${r.payment.processorBatchId}` : ''}
                    </span>
                    <span className="tl-unapplied-meta">
                      Paid {fmt(r.payment.cents)}, applied {fmt(r.allocatedCents)}
                      {r.allocations.length > 0 ? ` to ${r.allocations.map(a => a.invoiceNumber).join(', ')}` : ''}
                    </span>
                  </div>
                  <span className="tl-unapplied-amount" aria-label={`${fmt(r.unappliedCents)} unapplied`}>{fmt(r.unappliedCents)}</span>
                </div>
                {left && <span className="tl-pill">Left on account {dayLabel(left)}</span>}
                {open ? (
                  <ApplyForm
                    row={r}
                    open={openFor(r.payment.accountId)}
                    paid={paidFor(r.payment.accountId)}
                    onCancel={() => setOpenId(null)}
                    onLeave={() => {
                      onLeave(r.payment.id)
                      setOpenId(null)
                      setNotice(`${fmt(r.unappliedCents)} from ${r.payment.id} stays on ${r.accountName}'s account as a credit. No balance changed.`)
                    }}
                    onApply={(invoiceIds, cents, message) => {
                      onApply(r.payment.id, invoiceIds, cents)
                      setOpenId(null)
                      setNotice(message)
                    }}
                  />
                ) : (
                  <div className="tl-action-row">
                    <button
                      type="button"
                      className="tl-btn tl-btn-primary tl-btn-compact"
                      aria-expanded={false}
                      onClick={() => { setNotice(null); setOpenId(r.payment.id) }}
                    >
                      {applyLabel(openFor(r.payment.accountId))}
                    </button>
                    <button
                      type="button"
                      className="tl-btn tl-btn-secondary tl-btn-compact"
                      disabled={Boolean(left)}
                      onClick={() => {
                        onLeave(r.payment.id)
                        setNotice(`${fmt(r.unappliedCents)} from ${r.payment.id} stays on ${r.accountName}'s account as a credit. No balance changed.`)
                      }}
                    >
                      {left ? 'Left on account' : 'Leave on account'}
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <div className="tl-list-card-foot">
        <p>Unapplied is the payment amount minus its allocations. Nothing here changes a balance until a person applies it.</p>
        <p><strong>Account applies payments after merge.</strong> Apply here stands in until then: it runs the same allocate() rule on this screen's data.</p>
      </div>
    </section>
  )
}

interface ApplyFormProps {
  row: PaymentRow
  open: OpenInvoice[]
  paid: Invoice[]
  onCancel: () => void
  onLeave: () => void
  /** Throws the engine's error; the form shows it inline. */
  onApply: (invoiceIds: string[], cents: number[], message: string) => void
}

/** Lists the payer's open invoices with an amount each (oldest filled first). The engine decides; its refusal shows inline. */
function ApplyForm({ row, open, paid, onCancel, onLeave, onApply }: ApplyFormProps) {
  const formId = useId()
  const [amounts, setAmounts] = useState<Record<string, string>>(() => {
    const split = suggestedSplit(row.unappliedCents, open)
    return Object.fromEntries(open.map((o, i) => [o.invoice.id, split[i] > 0 ? (split[i] / 100).toFixed(2) : '']))
  })
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  if (open.length === 0) {
    const paidNumbers = paid.map(i => i.number)
    return (
      <div className="tl-apply" role="group" aria-label={`Apply ${row.payment.id}`}>
        <span className="tl-field-label">No open invoices on this account</span>
        <p className="tl-field-hint">
          {paidNumbers.length > 0
            ? `${row.accountName}'s posted invoice${paidNumbers.length === 1 ? '' : 's'} ${paidNumbers.join(', ')} ${paidNumbers.length === 1 ? 'is' : 'are'} paid in full, so there is nothing to apply ${fmt(row.unappliedCents)} to.`
            : `${row.accountName} has no posted invoices yet.`}
          {' '}Leave it on account as a credit; it can be applied once the next invoice posts.
        </p>
        <div className="tl-action-row">
          <button type="button" className="tl-btn tl-btn-primary tl-btn-compact" onClick={onLeave}>Leave on account</button>
          <button type="button" className="tl-btn tl-btn-secondary tl-btn-compact" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    )
  }

  const parsed = open.map(o => {
    const text = amounts[o.invoice.id] ?? ''
    return { o, text, cents: text.trim() === '' ? 0 : parseDollars(text) }
  })
  const invalid = parsed.filter(p => p.cents === null)
  const chosen = parsed.filter((p): p is typeof p & { cents: number } => p.cents !== null && p.cents !== 0)
  const applying = chosen.reduce((s, p) => s + p.cents, 0)
  const remaining = row.unappliedCents - applying

  function submit() {
    setSubmitted(true)
    setError(null)
    if (invalid.length > 0) return
    if (chosen.length === 0) {
      setError('Enter an amount for at least one invoice, or leave the payment on account.')
      return
    }
    const after = chosen.map(p => `${p.o.invoice.number} now ${fmt(p.o.balanceCents - p.cents)} open`).join(', ')
    const message = `Applied ${fmt(applying)} from ${row.payment.id}: ${after}.${remaining > 0 ? ` ${fmt(remaining)} stays unapplied.` : ''}`
    try {
      onApply(chosen.map(p => p.o.invoice.id), chosen.map(p => p.cents), message)
    } catch (e) {
      // The engine's refusal, shown as written (over-allocation of the payment or of an invoice balance).
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <form
      className="tl-apply"
      aria-label={`Apply ${row.payment.id}`}
      noValidate
      onSubmit={e => { e.preventDefault(); submit() }}
    >
      <span className="tl-field-label">Apply to {row.accountName}'s open invoices</span>
      <ul className="tl-apply-list">
        {parsed.map(p => {
          const id = `${formId}-${p.o.invoice.id}`
          return (
            <li key={p.o.invoice.id}>
              <label className="tl-apply-inv" htmlFor={id}>
                <span className="tl-invoice-number">{p.o.invoice.number}</span>
                <span className="tl-field-hint">{p.o.periodLabel} · open {fmt(p.o.balanceCents)}</span>
              </label>
              <div className="tl-input-money">
                <span aria-hidden="true">$</span>
                <input
                  id={id}
                  className="tl-input"
                  inputMode="decimal"
                  autoComplete="off"
                  value={p.text}
                  aria-invalid={submitted && p.cents === null ? true : undefined}
                  onChange={e => { setAmounts(a => ({ ...a, [p.o.invoice.id]: e.target.value })); setError(null) }}
                />
              </div>
              {submitted && p.cents === null && <span className="tl-field-error" role="alert">Enter a dollar amount like 15.30</span>}
            </li>
          )
        })}
      </ul>
      <div className="tl-apply-total">
        <span>Applying</span>
        <span>{fmt(applying)}</span>
      </div>
      <div className="tl-apply-total" data-tone={remaining < 0 ? 'danger' : undefined}>
        <span>{remaining < 0 ? 'Over the unapplied cash by' : 'Stays unapplied'}</span>
        <span>{fmt(Math.abs(remaining))}</span>
      </div>
      {error && <p className="tl-apply-error" role="alert" data-testid="apply-error">{error}</p>}
      <div className="tl-action-row">
        <button type="submit" className="tl-btn tl-btn-primary tl-btn-compact">Apply {fmt(applying)}</button>
        <button type="button" className="tl-btn tl-btn-secondary tl-btn-compact" onClick={onLeave}>Leave on account</button>
        <button type="button" className="tl-btn tl-btn-secondary tl-btn-compact" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Allocation rules
// ---------------------------------------------------------------------------

function AllocationRulesCard() {
  return (
    <section className="tl-summary-card" aria-labelledby="rules-title">
      <h2 id="rules-title" className="tl-summary-card-title">Allocation rules</h2>
      <ul className="tl-rules">
        <li>Allocation is many to many: one check can pay several invoices, and one invoice can be paid by several payments.</li>
        <li>A processor batch splits into gross, fees, and per-invoice allocations. Fees never touch an invoice.</li>
        <li>An allocation cannot exceed the invoice's open balance or the payment's unapplied amount.</li>
      </ul>
    </section>
  )
}
