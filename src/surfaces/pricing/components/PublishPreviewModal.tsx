import { useEffect, useState, type ReactNode } from 'react'
import type { BillingAccount, Charge, LOB } from '../../../types'
import type { BlastRadius, ExcludedContractAccount, InvoicePreview, RepresentativeAccount } from '../lib/preview'
import { formatCents } from '../lib/money'
import { LOB_LABEL } from './LobTabs'
import Pill, { type PillTone } from './Pill'

const SHOW_FIRST = 10

const signed = (cents: number): string => (cents > 0 ? `+${formatCents(cents)}` : formatCents(cents))

/** "zone rate rv_res_96_2026", "standard rate ...", "contract override contract_bakery". */
export function ruleWonLabel(pricing: Charge['pricing']): string {
  switch (pricing.ruleWon) {
    case 'contractOverride':
      return `contract override ${pricing.contractId ?? ''}`.trim()
    case 'zoneRate':
      return `zone rate ${pricing.rateVersionId ?? ''}`.trim()
    case 'standardRate':
      return `standard rate ${pricing.rateVersionId ?? ''}`.trim()
    default:
      return 'manual exception'
  }
}

export type NoteKind = 'covers' | 'outOfScope' | 'moves' | 'lapsed'

/** The four note kinds blastRadius writes (pricing DECISIONS 40) and how each is shown. */
export function noteKind(row: Pick<ExcludedContractAccount, 'protected' | 'note'>): NoteKind {
  if (!row.protected) return 'lapsed'
  if (row.note.includes('moves')) return 'moves'
  if (row.note.startsWith('override covers')) return 'covers'
  return 'outOfScope'
}

export const NOTE_STYLE: Record<NoteKind, { pill: string; tone: PillTone }> = {
  covers: { pill: 'protected, override covers', tone: 'success' },
  outOfScope: { pill: 'protected, out of scope', tone: 'accent' },
  moves: { pill: 'partly protected, an item moves', tone: 'warning' },
  // Not in force on the evaluated date: replaced by a newer contract (addendum K3) or not started. A contract past its
  // signed term auto-renews and stays protected (addendum I1), so it is never this kind.
  lapsed: { pill: 'not in force, no longer protected', tone: 'warning' },
}

const PER: Record<BillingAccount['cycle'], string> = { daily: 'day', weekly: 'week', monthly: 'month', quarterly: 'quarter', net30: 'month', perJob: 'job' }

function Stat({ label, value, sub, tone = 'ink' }: { label: string; value: string; sub?: string; tone?: 'ink' | 'success' | 'warning' }) {
  const color = tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-ink'
  return (
    <div className="rounded-card border border-line bg-surface-muted px-4 py-3">
      <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">{label}</p>
      <p className={`mt-0.5 font-mono text-h1 font-bold ${color}`}>{value}</p>
      {sub && <p className="text-small text-muted">{sub}</p>}
    </div>
  )
}

function SectionTitle({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-accent">{eyebrow}</p>
        <h3 className="text-h2 font-bold text-ink">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function MovedAccounts({ result }: { result: BlastRadius }) {
  const [showAll, setShowAll] = useState(false)
  const rows = showAll ? result.movedAccounts : result.movedAccounts.slice(0, SHOW_FIRST)
  const hidden = result.movedAccounts.length - rows.length
  return (
    <section aria-label="Accounts that move">
      <SectionTitle eyebrow="Who changes" title={`${result.movedAccounts.length} account${result.movedAccounts.length === 1 ? '' : 's'} move`}>
        <p className="text-small text-muted">Base service per month, before fees and tax, as of {result.evaluatedOn}</p>
      </SectionTitle>
      {result.movedAccounts.length === 0 ? (
        <p className="mt-2 rounded-card border border-line bg-surface-muted px-4 py-3 text-body text-muted">
          No accounts move. Every account these lines could reach is covered by a contract override, has no active service in scope, or is not billable.
        </p>
      ) : (
        <div className="mt-2 overflow-hidden rounded-card border border-line">
          <div className="grid grid-cols-[minmax(0,1.6fr)_110px_110px_130px] gap-x-3 bg-surface-muted px-4 py-2 text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">
            <span>Account</span>
            <span className="text-right">Before</span>
            <span className="text-right">After</span>
            <span className="text-right">Delta</span>
          </div>
          <ul>
            {rows.map(m => {
              const delta = m.afterMonthlyCents - m.beforeMonthlyCents
              const pct = m.beforeMonthlyCents > 0 ? (delta / m.beforeMonthlyCents) * 100 : 0
              return (
                <li key={m.accountId} className="grid grid-cols-[minmax(0,1.6fr)_110px_110px_130px] items-center gap-x-3 border-t border-line px-4 py-1.5 text-body" data-account={m.accountId}>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink">{m.name}</span>
                    <span className="block font-mono text-eyebrow text-muted">{m.accountId}</span>
                  </span>
                  <span className="text-right font-mono text-mono text-muted">{formatCents(m.beforeMonthlyCents)}</span>
                  <span className="text-right font-mono text-mono font-bold text-ink">{formatCents(m.afterMonthlyCents)}</span>
                  <span className="text-right font-mono text-mono text-ink">
                    {signed(delta)}{' '}
                    <span className="text-muted">
                      ({delta > 0 ? '+' : ''}
                      {pct.toFixed(1)}%)
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
          {(hidden > 0 || showAll) && result.movedAccounts.length > SHOW_FIRST && (
            <button type="button" onClick={() => setShowAll(v => !v)} className="w-full border-t border-line bg-surface px-4 py-2 text-left text-mono font-semibold text-accent hover:bg-accent-soft">
              {showAll ? `Show first ${SHOW_FIRST}` : `Show all ${result.movedAccounts.length} (${hidden} more)`}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function ProtectedAccounts({ rows }: { rows: ExcludedContractAccount[] }) {
  const protectedCount = rows.filter(r => r.protected).length
  const lapsed = rows.length - protectedCount
  const renewed = rows.filter(r => r.renewedOn).length
  return (
    <section aria-label="Protected by contract">
      <SectionTitle eyebrow="Who does not change" title={`${protectedCount} protected by contract`}>
        <p className="text-small text-muted">
          Every account with a Contract is listed by name, whatever its line of business
          {renewed > 0 ? `; ${renewed} auto-renewed past ${renewed === 1 ? 'its' : 'their'} signed term and still protected` : ''}
          {lapsed > 0 ? `; ${lapsed} not in force` : ''}.
        </p>
      </SectionTitle>
      <div className="mt-2 overflow-hidden rounded-card border border-line">
        <div className="grid grid-cols-[minmax(0,1.3fr)_150px_minmax(0,1.2fr)_minmax(0,1.6fr)] gap-x-3 bg-surface-muted px-4 py-2 text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">
          <span>Account</span>
          <span>Contract</span>
          <span>Override reason</span>
          <span>Why it is protected</span>
        </div>
        <ul>
          {rows.map(r => {
            const kind = noteKind(r)
            const style = NOTE_STYLE[kind]
            return (
              <li key={r.contractId} className={['grid grid-cols-[minmax(0,1.3fr)_150px_minmax(0,1.2fr)_minmax(0,1.6fr)] items-start gap-x-3 border-t border-line px-4 py-2 text-body', kind === 'lapsed' ? 'bg-warning-soft/40' : ''].join(' ')} data-contract={r.contractId}>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink">{r.name}</span>
                  <span className="block font-mono text-eyebrow text-muted">{r.accountId}</span>
                </span>
                <span className="min-w-0 font-mono text-small text-ink">
                  <span className="block truncate" title={r.contractId}>
                    {r.contractId}
                  </span>
                  <span className="block truncate text-eyebrow text-muted" title={r.coveredCatalogIds.join(', ')}>
                    covers {r.coveredCatalogIds.join(', ')}
                  </span>
                </span>
                <span className="text-small text-ink">{r.reason || 'no reason recorded'}</span>
                <span className="min-w-0">
                  {/* A lapsed contract carries its end date on the warning pill itself. */}
                  <span className="flex flex-wrap gap-1">
                    <Pill tone={style.tone} dot={kind === 'lapsed'}>
                      {kind === 'lapsed' ? r.note : style.pill}
                    </Pill>
                    {r.renewedOn && <Pill tone="accent">auto-renewed {r.renewedOn}</Pill>}
                  </span>
                  {kind !== 'lapsed' && <span className="mt-1 block text-small text-ink">{r.note}</span>}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

function feeCents(c: Charge): number {
  return c.fees.reduce((s, f) => s + f.cents, 0)
}

function MiniInvoice({ title, preview, other, tone }: { title: string; preview: InvoicePreview; other: InvoicePreview; tone: 'before' | 'after' }) {
  const otherBySource = new Map(other.lines.map(l => [l.source.id, l] as [string, Charge]))
  return (
    <div className={['rounded-card border p-3', tone === 'after' ? 'border-accent/40 bg-surface' : 'border-line bg-surface-muted'].join(' ')}>
      <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">{title}</p>
      {preview.lines.length === 0 && <p className="mt-2 text-small text-muted">No billable lines on {preview.onDate}.</p>}
      <ul className="mt-2 space-y-2">
        {preview.lines.map(l => {
          const counterpart = otherBySource.get(l.source.id)
          const changed = counterpart !== undefined && counterpart.totalCents !== l.totalCents
          return (
            <li key={l.id} className="border-t border-line pt-2 first:border-t-0 first:pt-0">
              <p className="text-small font-semibold text-ink">{l.description}</p>
              <p className="font-mono text-eyebrow text-muted">{ruleWonLabel(l.pricing)}</p>
              <div className="mt-1 grid grid-cols-4 gap-x-2 font-mono text-eyebrow text-muted">
                <span>base</span>
                <span>fees</span>
                <span>tax</span>
                <span className="text-right">total</span>
              </div>
              <div className="grid grid-cols-4 gap-x-2 font-mono text-small text-ink">
                <span>{formatCents(l.baseCents)}</span>
                <span>{formatCents(feeCents(l))}</span>
                <span>{formatCents(l.taxCents)}</span>
                <span className={['text-right font-bold', changed && tone === 'after' ? 'text-accent' : ''].join(' ')}>{formatCents(l.totalCents)}</span>
              </div>
            </li>
          )
        })}
      </ul>
      <div className="mt-2 grid grid-cols-4 gap-x-2 border-t border-line pt-2 font-mono text-small text-ink">
        <span>{formatCents(preview.subtotalCents)}</span>
        <span>{formatCents(preview.feeCents)}</span>
        <span>{formatCents(preview.taxCents)}</span>
        <span className="text-right text-body font-bold">{formatCents(preview.totalCents)}</span>
      </div>
    </div>
  )
}

function RepresentativeInvoices({ rows }: { rows: RepresentativeAccount[] }) {
  return (
    <section aria-label="Representative invoices">
      <SectionTitle eyebrow="What the invoice looks like" title="Three representative accounts, before and after">
        <p className="text-small text-muted">Full charges from computeCharge: fees and tax on the new base, one billing cycle each</p>
      </SectionTitle>
      <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-3">
        {rows.map(r => {
          const delta = r.after.totalCents - r.before.totalCents
          return (
            <article key={r.accountId} className="rounded-card border border-line bg-surface p-3" data-representative={r.accountId}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-body font-bold text-ink">{r.name}</p>
                  <p className="font-mono text-eyebrow text-muted">
                    {r.accountId}, billed {r.cycle}, invoice of {r.after.onDate}
                  </p>
                </div>
                {r.unchanged ? (
                  <Pill tone="success">{r.after.lines.some(l => l.pricing.ruleWon === 'contractOverride') ? 'Unchanged: contract override' : 'Unchanged'}</Pill>
                ) : (
                  <Pill tone="warning">
                    {signed(delta)} per {PER[r.cycle]}
                  </Pill>
                )}
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-2">
                <MiniInvoice title="Before" preview={r.before} other={r.after} tone="before" />
                <MiniInvoice title="After" preview={r.after} other={r.before} tone="after" />
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

/** The blast-radius preview. Reads only what blastRadius() returned; the one write on this screen is the Confirm
 *  button, and it publishes exactly the drafts the preview was computed for. Stacks above the persona bar (z-30). */
export default function PublishPreviewModal({
  lob, result, draftCount, publishing, onConfirm, onCancel,
}: {
  lob: LOB
  result: BlastRadius
  draftCount: number
  publishing: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const moved = result.movedAccounts.length
  const protectedRows = result.excludedContractAccounts
  const protectedCount = protectedRows.filter(r => r.protected).length
  const lapsedCount = protectedRows.length - protectedCount
  const renewedCount = protectedRows.filter(r => r.renewedOn).length
  const protectedSub = lapsedCount > 0
    ? `${lapsedCount} contract${lapsedCount === 1 ? '' : 's'} not in force`
    : renewedCount > 0
      ? `${renewedCount} auto-renewed, still protected`
      : 'every Contract row listed'
  const monthly = result.totalMonthlyDeltaCents
  const annual = monthly * 12
  const label = LOB_LABEL[lob].toLowerCase()

  return (
    <div className="fixed inset-0 z-40" role="presentation">
      <button type="button" aria-label="Cancel publish" onClick={onCancel} className="absolute inset-0 bg-ink/40" />
      <div role="dialog" aria-modal="true" aria-labelledby="publish-preview-title" className="absolute inset-x-0 top-6 bottom-6 mx-auto flex w-[min(1120px,calc(100vw-48px))] flex-col overflow-hidden rounded-card bg-surface shadow-raised">
        <header className="border-b border-line px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-accent">Publish preview</p>
              <h2 id="publish-preview-title" className="mt-1 text-h1 font-bold tracking-tight">
                Publish {draftCount} {label} draft{draftCount === 1 ? '' : 's'} as new versions
              </h2>
              {moved === 0 && (
                <p className="mt-2 rounded-sm border-l-[3px] border-accent bg-accent-soft px-3 py-2 text-body font-semibold text-ink" role="status" data-testid="zero-moved">
                  No accounts move. Publishing adds {draftCount === 1 ? 'this version' : 'these versions'} to the ratebook and changes no current customer&apos;s bill.
                </p>
              )}
              {result.keptOnCurrentPrice.lines > 0 && (
                <p className="mt-2 rounded-sm border-l-[3px] border-success bg-success-soft px-3 py-2 text-body text-ink" role="status" data-testid="kept-on-current-price">
                  <span className="font-semibold">
                    {result.keptOnCurrentPrice.lines} service line{result.keptOnCurrentPrice.lines === 1 ? '' : 's'} on {result.keptOnCurrentPrice.accounts} account{result.keptOnCurrentPrice.accounts === 1 ? '' : 's'} keep their current price.
                  </span>{' '}
                  New service only: these rates bill service that starts on or after their effective date, and current customers are not moved.
                </p>
              )}
              <p className="mt-1 text-body text-ink" data-testid="preview-headline">
                <span className="font-semibold">
                  {moved} account{moved === 1 ? '' : 's'} move
                </span>
                , <span className="font-semibold">{protectedCount} protected by contract</span>, monthly revenue{' '}
                <span className="font-mono font-semibold">{moved === 0 ? 'unchanged' : signed(monthly)}</span>
                {moved === 0 ? '' : ' before fees and tax'}.
              </p>
              <p className="mt-0.5 text-small text-muted">
                Both sides priced as of <span className="font-mono">{result.evaluatedOn}</span>, the date every draft in this set is in force. Nothing is written until you confirm.
              </p>
            </div>
            <button type="button" onClick={onCancel} className="rounded-md px-2 py-1 text-body font-semibold text-muted hover:bg-surface-muted hover:text-ink">
              Cancel
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Accounts move" value={String(moved)} sub="billable accounts that resolve to a draft" />
            <Stat label="Protected by contract" value={String(protectedCount)} sub={protectedSub} tone="success" />
            <Stat label="Monthly delta" value={signed(monthly)} sub="service lines before fees and tax" />
            <Stat label="Evaluated as of" value={result.evaluatedOn} sub="latest draft effectiveFrom" />
          </div>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <MovedAccounts result={result} />
          <ProtectedAccounts rows={protectedRows} />
          <RepresentativeInvoices rows={result.representativeAccounts} />

          <section aria-label="Revenue delta" className="rounded-card border border-accent/40 bg-accent-soft px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-accent">Revenue delta</p>
                <p className="mt-0.5 text-small text-muted">
                  Service lines before fees and tax, summed over the {moved} moved account{moved === 1 ? '' : 's'}. Fees and tax scale with the base and are not revenue.
                </p>
              </div>
              <div className="flex items-baseline gap-6">
                <div className="text-right">
                  <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">Monthly</p>
                  <p className="font-mono text-h1 font-bold text-ink">{signed(monthly)}</p>
                </div>
                <div className="text-right">
                  <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">Annualised</p>
                  <p className="font-mono text-h1 font-bold text-ink">{signed(annual)}</p>
                </div>
              </div>
            </div>
          </section>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-muted px-6 py-4">
          <p className="text-small text-muted">
            Confirm creates {draftCount} published version{draftCount === 1 ? '' : 's'} with supersedesId set. The versions they supersede keep their status, price, and effective date; posted invoices are not touched.
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onCancel} className="rounded-md border border-line bg-surface px-3.5 py-2 text-mono font-semibold text-muted hover:text-ink">
              Cancel
            </button>
            <button type="button" onClick={onConfirm} disabled={publishing || draftCount === 0} className="rounded-md bg-accent px-4 py-2 text-mono font-semibold text-surface hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60">
              {publishing ? 'Publishing' : `Confirm and publish ${draftCount} version${draftCount === 1 ? '' : 's'}`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
