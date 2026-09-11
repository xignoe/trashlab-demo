import { useStore } from '../../../store/useStore'
import type { PricingPublishRecord } from '../../../store/slices/pricing'
import { formatCents } from '../lib/money'
import Pill from './Pill'

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="shrink-0">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

/**
 * Proof, read live from the store after a publish, that a posted invoice still carries its original total and its
 * charges still point at the rate versions they were priced with (owner fear: a rate edit rewriting history). The
 * invoice is the one the publish snapshotted (src/surfaces/pricing/lib/proof.ts): its totals at publish time sit
 * beside the live row, so "unchanged" is a comparison, not a claim.
 */
export default function HistoryProof({ record }: { record: PricingPublishRecord }) {
  const db = useStore(s => s.db)
  const proof = record.proof
  const invoice = proof ? db.invoices.find(i => i.id === proof.invoiceId) : undefined

  if (!proof || !invoice) {
    return (
      <section className="rounded-card border border-line bg-surface p-5 shadow-card" aria-label="History proof">
        <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-success">History proof</p>
        <p className="mt-1 text-body text-ink">Published {record.ids.length} version{record.ids.length === 1 ? '' : 's'} at {record.publishedAt}. No posted invoice exists yet to compare against.</p>
      </section>
    )
  }

  const lines = invoice.chargeIds.map(id => db.charges.find(c => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c)
  const account = db.accounts.find(a => a.id === invoice.accountId)
  const payer = db.parties.find(p => p.id === account?.payerPartyId)?.name ?? invoice.accountId
  const priceOf = (rateVersionId?: string) => db.rateVersions.find(rv => rv.id === rateVersionId)
  const before = new Map(proof.charges.map(c => [c.id, c]))
  const unchanged =
    invoice.totalCents === proof.totalCents &&
    lines.length === proof.charges.length &&
    lines.every(c => before.get(c.id)?.totalCents === c.totalCents && before.get(c.id)?.rateVersionId === c.pricing.rateVersionId)
  const superseded = new Set(record.ids.map(id => db.rateVersions.find(rv => rv.id === id)?.supersedesId).filter((x): x is string => !!x))

  return (
    <section className="rounded-card border border-success/40 bg-surface p-5 shadow-card" aria-label="History proof" data-testid="history-proof">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-success">History proof</p>
          <h2 className="mt-1 flex items-center gap-2 text-h2 font-bold">
            <span className={unchanged ? 'text-success' : 'text-danger'}>
              <LockIcon />
            </span>
            {unchanged ? 'Posted invoice unchanged by this publish' : 'Posted invoice changed after this publish'}
          </h2>
          <p className="mt-1 max-w-[640px] text-small text-muted">
            Snapshotted when {record.ids.length} version{record.ids.length === 1 ? ' was' : 's were'} published at {record.publishedAt}, read live from the store now.{' '}
            {proof.basis === 'superseded' ? 'Its lines were priced by versions this publish superseded; ' : ''}
            published versions were superseded, not edited, so every posted charge still resolves to the version it was billed with.
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-small text-muted">
            {invoice.number}, {payer}
          </p>
          <p className="font-mono text-h1 font-bold text-ink" data-testid="proof-total">
            {formatCents(invoice.totalCents)}
          </p>
          <p className="font-mono text-eyebrow text-muted">at publish {formatCents(proof.totalCents)}</p>
          <div className="mt-1 flex justify-end gap-1.5">
            <Pill tone={invoice.postedAt ? 'success' : 'danger'}>{invoice.postedAt ? `posted ${invoice.postedAt.slice(0, 10)}` : 'not posted'}</Pill>
            <Pill tone={invoice.locked ? 'success' : 'danger'}>{invoice.locked ? 'locked' : 'unlocked'}</Pill>
          </div>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-body">
          <thead>
            <tr className="bg-surface-muted text-left text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">
              <th className="px-3 py-2 font-bold">Charge</th>
              <th className="px-3 py-2 font-bold">Priced with</th>
              <th className="px-3 py-2 text-right font-bold">Base</th>
              <th className="px-3 py-2 text-right font-bold">Fees</th>
              <th className="px-3 py-2 text-right font-bold">Tax</th>
              <th className="px-3 py-2 text-right font-bold">Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(c => {
              const rv = priceOf(c.pricing.rateVersionId)
              return (
                <tr key={c.id} className="border-b border-line">
                  <td className="px-3 py-2">
                    <span className="block text-ink">{c.description}</span>
                    <span className="block font-mono text-eyebrow text-muted">
                      {c.id}, {c.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="block font-mono text-small text-ink">{c.pricing.rateVersionId ?? c.pricing.contractId ?? 'manual'}</span>
                    <span className="block font-mono text-eyebrow text-muted">
                      {c.pricing.ruleWon}
                      {rv ? `, ${rv.status}, ${formatCents(rv.priceCents)} effective ${rv.effectiveFrom}` : ''}
                      {rv && superseded.has(rv.id) ? ', superseded by this publish' : ''}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-mono text-ink">{formatCents(c.baseCents)}</td>
                  <td className="px-3 py-2 text-right font-mono text-mono text-ink">{formatCents(c.fees.reduce((s, f) => s + f.cents, 0))}</td>
                  <td className="px-3 py-2 text-right font-mono text-mono text-ink">{formatCents(c.taxCents)}</td>
                  <td className="px-3 py-2 text-right font-mono text-mono font-bold text-ink">{formatCents(c.totalCents)}</td>
                </tr>
              )
            })}
            <tr>
              <td className="px-3 py-2 text-small text-muted" colSpan={2}>
                Invoice subtotal {formatCents(invoice.subtotalCents)}, fees {formatCents(invoice.feeCents)}, tax {formatCents(invoice.taxCents)}. Issued {invoice.issuedAt.slice(0, 10)}, due {invoice.dueAt.slice(0, 10)}.
              </td>
              <td className="px-3 py-2 text-right font-mono text-mono text-ink">{formatCents(lines.reduce((s, c) => s + c.baseCents, 0))}</td>
              <td className="px-3 py-2 text-right font-mono text-mono text-ink">{formatCents(lines.reduce((s, c) => s + c.fees.reduce((a, f) => a + f.cents, 0), 0))}</td>
              <td className="px-3 py-2 text-right font-mono text-mono text-ink">{formatCents(lines.reduce((s, c) => s + c.taxCents, 0))}</td>
              <td className="px-3 py-2 text-right font-mono text-body font-bold text-ink">{formatCents(invoice.totalCents)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}
