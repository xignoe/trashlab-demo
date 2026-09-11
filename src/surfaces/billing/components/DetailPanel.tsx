import { useState } from 'react'
import type { Charge, WaivedCharge } from '../../../types'
import type { ChargeDetail, Evidence } from '../../../store/selectors'
import { DECISION_LABEL, WAIVE_REASON_LABEL } from '../../../store/selectors'
import type { Suggestion } from '../../../store/suggest'
import { WAIVE_REASONS } from '../../../store/waive'
import { fmt, parseDollars } from '../../../store/money'
import { resolvePhoto } from '../../../seed/photos'
import { CONFIDENCE_LABEL, dayLabel, lbs, stampLabel, tenureLabel } from './format'
import { STATUS_LABEL, statusTone, suggestionTone } from './pills'

interface Props {
  detail: ChargeDetail | undefined
  ran: boolean
  onApprove: (chargeId: string) => void
  onEdit: (chargeId: string, newBaseCents: number, reason: string) => void
  onWaive: (chargeId: string, reason: WaivedCharge['reason'], note?: string) => void
  /** Re-prices a charge at a new base without committing (store.previewEdit). */
  previewEdit: (chargeId: string, newBaseCents: number) => Charge
  feeName: (feeRuleId: string) => string
}

type Mode = 'idle' | 'edit' | 'waive'

/**
 * Side panel for the selected queue item: amount, evidence, policy, customer context, agent suggestion, actions.
 * The parent keys it on the charge id, so an open Edit or Waive form closes when the selection moves.
 */
export function DetailPanel({ detail, ran, onApprove, onEdit, onWaive, previewEdit, feeName }: Props) {
  const [mode, setMode] = useState<Mode>('idle')

  if (!detail) {
    return (
      <aside className="tl-detail" aria-label="Item detail">
        <div className="tl-detail-empty">
          {ran
            ? 'Pick an item in the queue to see its amount, evidence, and the agent suggestion.'
            : 'Run the cycle, then pick an item in the queue to see its amount, evidence, and the agent suggestion.'}
        </div>
      </aside>
    )
  }

  const { charge, item, lines, evidence, policy, context, waived } = detail
  const date = charge.servicedOn ?? charge.period?.start
  const undecided = item ? item.decision === 'undecided' : charge.status === 'proposed'
  const edit = item?.edit

  return (
    <aside className="tl-detail" aria-label="Item detail">
      <section className="tl-detail-section">
        <div className="tl-detail-head">
          <h2 className="tl-card-title">{item ? `${item.kindLabel}, ${item.accountName}` : charge.description}</h2>
          {date && <span className="tl-card-meta tl-mono">{dayLabel(date)}</span>}
        </div>
        <p className="tl-detail-sub">{item ? `${item.siteAddress} · ${item.routeLabel}` : charge.siteId}</p>
        <p className="tl-detail-sub"><span className="tl-mono">{charge.id}</span> · {charge.description}</p>
      </section>

      <section className="tl-detail-section" aria-label="Proposed amount">
        <span className="tl-eyebrow">{edit ? 'Edited amount' : waived ? 'Waived amount' : 'Proposed amount'}</span>
        <div className="tl-detail-total-row">
          <span className="tl-detail-total" data-waived={waived ? 'true' : undefined}>{fmt(charge.totalCents)}</span>
          {edit && <span className="tl-was" title="Originally proposed total">{fmt(edit.originalTotalCents)}</span>}
        </div>
        <dl className="tl-lines">
          {lines.map(l => (
            <div key={l.label}>
              <dt>{l.label}</dt>
              <dd>{fmt(l.cents)}</dd>
            </div>
          ))}
          <div className="tl-lines-total">
            <dt>Total</dt>
            <dd>{fmt(charge.totalCents)}</dd>
          </div>
        </dl>
        {edit && (
          <p className="tl-detail-note">
            Originally proposed at {fmt(edit.originalTotalCents)} ({fmt(edit.originalBaseCents)} base). Edited by {edit.by}: {edit.reason}
          </p>
        )}
        {waived && (
          <p className="tl-detail-note">
            Waived as {WAIVE_REASON_LABEL[waived.reason].toLowerCase()} by {waived.by} on {dayLabel(waived.at)}
            {waived.note ? `: ${waived.note}` : '.'} The charge stays on record and counts toward leakage.
          </p>
        )}
      </section>

      <section className="tl-detail-section" aria-label="Evidence">
        <span className="tl-eyebrow">Evidence</span>
        <EvidenceBlock evidence={evidence} />
      </section>

      <section className="tl-detail-section" aria-label="Policy">
        <span className="tl-eyebrow">Policy</span>
        <p className="tl-detail-body">{policy}</p>
      </section>

      {context && (
        <section className="tl-detail-section" aria-label="Customer context">
          <span className="tl-eyebrow">Customer context</span>
          <div className="tl-context-grid">
            <div>
              <span className="tl-context-label">Tenure</span>
              <span className="tl-context-value">{tenureLabel(context.tenureMonths)}</span>
            </div>
            <div>
              <span className="tl-context-label">Open balance</span>
              <span className="tl-context-value" data-tone={context.balanceCents > 0 ? 'danger' : undefined}>{fmt(context.balanceCents)}</span>
            </div>
            <div>
              <span className="tl-context-label">Prior waives</span>
              <span className="tl-context-value">{context.priorWaives.count} · {fmt(context.priorWaives.cents)}</span>
            </div>
          </div>
          <div className="tl-context-foot">
            <span className="tl-pill" data-tone={statusTone(context.status)}>{STATUS_LABEL[context.status]}</span>
            <span>
              Autopay {context.autopay ? 'on' : 'off'}
              {context.paymentMethodOnFile ? `, ${context.paymentMethodOnFile} on file` : ', no method on file'}
            </span>
            <span>{context.cycle === 'net30' ? 'Net 30' : context.cycle.charAt(0).toUpperCase() + context.cycle.slice(1)}</span>
          </div>
        </section>
      )}

      {item && (
        <section className="tl-detail-section" aria-label="Agent suggestion">
          <SuggestionCallout suggestion={item.suggestion} />
        </section>
      )}

      <section className="tl-detail-section tl-detail-actions" aria-label="Actions" data-mode={mode}>
        {!undecided ? (
          <p className="tl-detail-note" role="status">
            {item ? DECISION_LABEL[item.decision] : charge.status}. Nothing else to decide on this item.
          </p>
        ) : mode === 'edit' ? (
          <EditForm
            charge={charge}
            previewEdit={previewEdit}
            feeName={feeName}
            onCancel={() => setMode('idle')}
            onConfirm={(cents, reason) => onEdit(charge.id, cents, reason)}
          />
        ) : mode === 'waive' ? (
          <WaiveForm
            charge={charge}
            suggestion={item?.suggestion}
            onCancel={() => setMode('idle')}
            onConfirm={(reason, note) => onWaive(charge.id, reason, note)}
          />
        ) : (
          <div className="tl-action-row">
            <button type="button" className="tl-btn tl-btn-primary" onClick={() => onApprove(charge.id)}>
              Approve {fmt(charge.totalCents)}
            </button>
            <button type="button" className="tl-btn tl-btn-secondary" onClick={() => setMode('edit')}>Edit</button>
            <button type="button" className="tl-btn tl-btn-secondary" onClick={() => setMode('waive')}>Waive</button>
          </div>
        )}
      </section>
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Edit amount
// ---------------------------------------------------------------------------

interface EditFormProps {
  charge: Charge
  previewEdit: (chargeId: string, newBaseCents: number) => Charge
  feeName: (feeRuleId: string) => string
  onCancel: () => void
  onConfirm: (newBaseCents: number, reason: string) => void
}

/** Inline edit: new base in dollars and a required reason, with before and after totals from computeCharge. */
function EditForm({ charge, previewEdit, feeName, onCancel, onConfirm }: EditFormProps) {
  const [amount, setAmount] = useState((charge.baseCents / 100).toFixed(2))
  const [reason, setReason] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const cents = parseDollars(amount)
  let amountError: string | undefined
  if (cents === null) amountError = 'Enter an amount in dollars, like 5.00.'
  else if (cents < 0) amountError = 'The amount cannot be negative.'
  else if (cents === charge.baseCents) amountError = 'That is the proposed base. Enter a different amount, or approve it as proposed.'

  let preview: Charge | undefined
  let previewError: string | undefined
  if (!amountError && cents !== null) {
    try {
      preview = previewEdit(charge.id, cents)
    } catch (e) {
      previewError = e instanceof Error ? e.message : String(e)
    }
  }
  const reasonMissing = reason.trim() === ''
  const canConfirm = preview !== undefined && !reasonMissing
  const amountChanged = amount !== (charge.baseCents / 100).toFixed(2)
  const reasonId = `edit-reason-${charge.id}`
  const amountId = `edit-amount-${charge.id}`

  return (
    <form
      className="tl-form"
      aria-label="Edit amount"
      onSubmit={e => {
        e.preventDefault()
        setSubmitted(true)
        if (canConfirm && cents !== null) onConfirm(cents, reason.trim())
      }}
    >
      <span className="tl-eyebrow">Edit amount</span>
      <div className="tl-field">
        <label className="tl-field-label" htmlFor={amountId}>New base amount</label>
        <div className="tl-input-money">
          <span aria-hidden="true">$</span>
          <input
            id={amountId}
            className="tl-input"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            aria-invalid={amountError && (amountChanged || submitted) ? 'true' : undefined}
            autoFocus
          />
        </div>
        <span className="tl-field-hint">Before fuel and tax, which are recomputed. Proposed base {fmt(charge.baseCents)}.</span>
        {amountError && (amountChanged || submitted) && <span className="tl-field-error" role="alert">{amountError}</span>}
        {previewError && <span className="tl-field-error" role="alert">{previewError}</span>}
      </div>
      <div className="tl-field">
        <label className="tl-field-label" htmlFor={reasonId}>Reason <span className="tl-field-required">required</span></label>
        <textarea
          id={reasonId}
          className="tl-input tl-textarea"
          rows={2}
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Why the amount changes, for the audit trail"
          aria-invalid={submitted && reasonMissing ? 'true' : undefined}
        />
        {submitted && reasonMissing && <span className="tl-field-error" role="alert">A reason is required to change an amount.</span>}
      </div>

      <table className="tl-compare" aria-label="Before and after">
        <thead>
          <tr><th scope="col"></th><th scope="col">Proposed</th><th scope="col">After edit</th></tr>
        </thead>
        <tbody>
          <tr><th scope="row">Base</th><td>{fmt(charge.baseCents)}</td><td>{preview ? fmt(preview.baseCents) : '-'}</td></tr>
          {charge.fees.map(f => {
            const after = preview?.fees.find(x => x.feeRuleId === f.feeRuleId)
            return (
              <tr key={f.feeRuleId}><th scope="row">{feeName(f.feeRuleId)}</th><td>{fmt(f.cents)}</td><td>{after ? fmt(after.cents) : '-'}</td></tr>
            )
          })}
          <tr><th scope="row">Tax</th><td>{fmt(charge.taxCents)}</td><td>{preview ? fmt(preview.taxCents) : '-'}</td></tr>
        </tbody>
        <tfoot>
          <tr><th scope="row">Total</th><td>{fmt(charge.totalCents)}</td><td>{preview ? fmt(preview.totalCents) : '-'}</td></tr>
        </tfoot>
      </table>

      <p className="tl-detail-note">The item keeps showing the original {fmt(charge.totalCents)} and is marked edited. Confirming approves the new amount.</p>
      <div className="tl-action-row">
        <button type="submit" className="tl-btn tl-btn-primary" disabled={submitted && !canConfirm}>
          {preview ? `Confirm ${fmt(preview.totalCents)}` : 'Confirm edit'}
        </button>
        <button type="button" className="tl-btn tl-btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Waive
// ---------------------------------------------------------------------------

const REASON_HELP: Record<WaivedCharge['reason'], string> = {
  goodwill: 'A relationship call. The charge is valid and we chose not to bill it.',
  salesPromise: 'Sales or a contract promised this would not be billed.',
  insufficientEvidence: 'The evidence would not hold up if the customer disputed it.',
  operationalFault: 'Our side caused it: driver, route, timing, or equipment.',
  immaterial: 'Too small to be worth billing or disputing.',
}

interface WaiveFormProps {
  charge: Charge
  suggestion?: Suggestion
  onCancel: () => void
  onConfirm: (reason: WaivedCharge['reason'], note?: string) => void
}

/** Inline waive: one of the five WaivedCharge reasons, an optional note, confirm. Nothing is deleted. */
function WaiveForm({ charge, suggestion, onCancel, onConfirm }: WaiveFormProps) {
  const suggested = suggestion?.action === 'waive' ? suggestion.reason : undefined
  const [reason, setReason] = useState<WaivedCharge['reason'] | undefined>(suggested)
  const [note, setNote] = useState('')
  const name = `waive-reason-${charge.id}`

  return (
    <form
      className="tl-form"
      aria-label="Waive charge"
      onSubmit={e => {
        e.preventDefault()
        if (reason) onConfirm(reason, note.trim() === '' ? undefined : note.trim())
      }}
    >
      <fieldset className="tl-radio-list">
        <legend className="tl-eyebrow">Waive reason</legend>
        {WAIVE_REASONS.map(r => (
          <label key={r} className="tl-radio" data-checked={reason === r ? 'true' : undefined}>
            <input type="radio" name={name} value={r} checked={reason === r} onChange={() => setReason(r)} />
            <span className="tl-radio-text">
              <span className="tl-radio-label">
                {WAIVE_REASON_LABEL[r]}
                {r === suggested && <span className="tl-radio-tag">Haul-E suggests</span>}
              </span>
              <span className="tl-radio-help">{REASON_HELP[r]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="tl-field">
        <label className="tl-field-label" htmlFor={`waive-note-${charge.id}`}>Note <span className="tl-field-optional">optional</span></label>
        <textarea
          id={`waive-note-${charge.id}`}
          className="tl-input tl-textarea"
          rows={2}
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="What the customer or driver said"
        />
      </div>
      <p className="tl-detail-note">The charge stays on record as waived with this reason and counts toward leakage. Nothing is deleted.</p>
      <div className="tl-action-row">
        <button type="submit" className="tl-btn tl-btn-primary" disabled={!reason}>Waive {fmt(charge.totalCents)}</button>
        <button type="button" className="tl-btn tl-btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Evidence and suggestion
// ---------------------------------------------------------------------------

function fileName(path: string): string {
  return path.split('/').pop() ?? path
}

function EvidenceBlock({ evidence }: { evidence: Evidence }) {
  if (evidence.type === 'event') {
    const { event, label } = evidence
    return (
      <div className="tl-evidence">
        {event.photoUrl && resolvePhoto(event.photoUrl) ? (
          // The driver's photo, served from public/photos (DECISIONS.md entry 13 maps billing's evidence names to it).
          <div className="tl-photo-frame" data-photo="true">
            <img src={resolvePhoto(event.photoUrl)} alt={`Driver photo, ${label}, ${dayLabel(event.date)}`} />
          </div>
        ) : event.photoUrl ? (
          <div className="tl-photo-frame" role="img" aria-label={`Photo placeholder for ${event.photoUrl}`}>{fileName(event.photoUrl)}</div>
        ) : (
          <div className="tl-photo-frame" data-missing="true" role="img" aria-label="No photo on this event">No photo</div>
        )}
        <div className="tl-evidence-text">
          <span className="tl-evidence-head">{label}, {dayLabel(event.date)}</span>
          <span className="tl-detail-sub">Driver {event.driver} · {event.outcome}</span>
          <span className="tl-cell-sub tl-mono">{event.photoUrl ?? event.id}</span>
          {event.note && <p className="tl-quote">“{event.note}”</p>}
        </div>
      </div>
    )
  }
  if (evidence.type === 'ticket') {
    const { ticket, workOrder } = evidence
    return (
      <dl className="tl-kv">
        <dt>Ticket</dt><dd className="tl-mono">{ticket.id}</dd>
        <dt>Gross</dt><dd className="tl-mono">{lbs(ticket.grossLbs)}</dd>
        <dt>Tare</dt><dd className="tl-mono">{lbs(ticket.tareLbs)}</dd>
        <dt>Net</dt><dd className="tl-mono">{lbs(ticket.netLbs)} ({evidence.netTons.toFixed(2)} t)</dd>
        <dt>Over cap</dt><dd className="tl-mono">{evidence.overTons.toFixed(2)} t over {evidence.includedTons} t</dd>
        <dt>Facility</dt><dd>{ticket.facility}</dd>
        <dt>Material</dt><dd>{ticket.material}</dd>
        <dt>Ticketed</dt><dd className="tl-mono">{stampLabel(ticket.ticketedAt)}</dd>
        {workOrder && (<><dt>Work order</dt><dd className="tl-mono">{workOrder.id}</dd></>)}
      </dl>
    )
  }
  if (evidence.type === 'recurring') {
    const { before, after, change, serviceItem } = evidence
    return (
      <dl className="tl-kv">
        <dt>Service item</dt><dd className="tl-mono">{serviceItem?.id ?? 'unknown'}</dd>
        <dt>Service</dt><dd>{evidence.catalogName}{serviceItem && serviceItem.qty > 1 ? ` x ${serviceItem.qty}` : ''}</dd>
        {serviceItem && (<><dt>Effective</dt><dd className="tl-mono">{dayLabel(serviceItem.effectiveFrom)}</dd></>)}
        <dt>Before</dt>
        <dd className="tl-mono">
          {before?.monthlyCents !== undefined ? `${fmt(before.monthlyCents)}/mo` : 'Not billed last cycle'}
          {before?.rateVersionId ? ` · ${before.rateVersionId}` : ''}
        </dd>
        <dt>After</dt>
        <dd className="tl-mono">{fmt(after.monthlyCents)}/mo{after.rateVersionId ? ` · ${after.rateVersionId}` : after.contractId ? ` · ${after.contractId}` : ''}</dd>
        {change && (<><dt>Why flagged</dt><dd>{change.reason.charAt(0).toUpperCase() + change.reason.slice(1)}</dd></>)}
      </dl>
    )
  }
  if (evidence.type === 'extraDays') {
    const { container, workOrder, serviceItem } = evidence
    return (
      <dl className="tl-kv">
        <dt>Box</dt><dd className="tl-mono">{container ? `${container.serial} (${container.id})` : 'unknown'}</dd>
        <dt>Service item</dt><dd className="tl-mono">{serviceItem?.id ?? 'unknown'}</dd>
        {evidence.deliveredOn && (<><dt>Delivered</dt><dd className="tl-mono">{dayLabel(evidence.deliveredOn)}</dd></>)}
        <dt>Included</dt><dd className="tl-mono">{evidence.includedDays} days</dd>
        <dt>Billed days</dt><dd className="tl-mono">{evidence.days} ({dayLabel(evidence.period.start)} to {dayLabel(evidence.period.end)})</dd>
        <dt>Rate</dt><dd className="tl-mono">{fmt(evidence.extraDayCents)} a day</dd>
        {workOrder && (<><dt>Work order</dt><dd className="tl-mono">{workOrder.id}</dd></>)}
      </dl>
    )
  }
  return <p className="tl-detail-body">No evidence is linked to this charge.</p>
}

function SuggestionCallout({ suggestion }: { suggestion: Suggestion }) {
  return (
    <div className="tl-callout">
      <div className="tl-callout-head">
        <span className="tl-eyebrow">Haul-E suggests: {suggestion.action}</span>
        <span className="tl-pill" data-tone={suggestionTone(suggestion.action)}>{CONFIDENCE_LABEL[suggestion.confidence]}</span>
      </div>
      <p className="tl-callout-body">{suggestion.rationale}</p>
      {suggestion.reason && (
        <p className="tl-detail-note">Waive reason if a person agrees: {WAIVE_REASON_LABEL[suggestion.reason].toLowerCase()}</p>
      )}
      {suggestion.evidenceIds.length > 0 && (
        <div className="tl-chips" aria-label="Evidence the suggestion relied on">
          {suggestion.evidenceIds.map(id => <span className="tl-chip" key={id}>{id}</span>)}
        </div>
      )}
      <p className="tl-callout-foot">Agents draft. A person approves anything that moves money.</p>
    </div>
  )
}
