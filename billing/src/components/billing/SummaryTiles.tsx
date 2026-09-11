import type { BatchSummary } from '../../store/selectors'
import { fmt } from '../../store/money'

type Tone = 'ok' | 'warn' | 'danger'

/** Four stat tiles from batchSummary. They read 0 before the run, update as decisions land, and switch to posted figures after posting. */
export function SummaryTiles({ summary }: { summary: BatchSummary }) {
  const first = summary.allPosted
    ? { label: 'Invoices posted', value: String(summary.postedInvoiceCount), caption: 'Locked. Corrections are credit memos' }
    : { label: 'Invoices to generate', value: String(summary.invoicesToGenerate), caption: summary.ran ? 'Accounts with charges this run' : 'Run the cycle to count' }
  const second = summary.allPosted
    ? { label: 'Posted total', value: fmt(summary.postedTotalCents), caption: 'Sum of the posted invoices', tone: 'ok' as Tone }
    : { label: 'Clean', value: String(summary.clean), caption: 'No open decisions', tone: 'ok' as Tone }
  const tiles: { label: string; value: string; caption: string; tone?: Tone; valueTone?: Tone }[] = [
    first,
    second,
    {
      label: 'Need decisions',
      value: String(summary.needDecisions),
      caption: `${summary.undecidedCount} open item${summary.undecidedCount === 1 ? '' : 's'} in the queue`,
      tone: 'warn',
    },
    {
      label: 'Dollars at issue',
      value: fmt(summary.dollarsAtIssueCents),
      caption: 'Undecided queue totals',
      valueTone: summary.dollarsAtIssueCents > 0 ? 'danger' : undefined,
    },
  ]
  return (
    <section className="tl-tiles tl-tiles-4" aria-label="Batch summary">
      {tiles.map(t => (
        <div className="tl-card tl-stat" key={t.label}>
          <span className="tl-eyebrow" data-tone={t.tone}>{t.label}</span>
          <span className="tl-stat-value" data-tone={t.valueTone}>{t.value}</span>
          <span className="tl-stat-caption">{t.caption}</span>
        </div>
      ))}
    </section>
  )
}
