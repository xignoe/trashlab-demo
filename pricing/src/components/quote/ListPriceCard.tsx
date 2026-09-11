import type { ListPrice, PriceOutcome } from '../../lib/quote';
import { RULE_LABEL } from '../../lib/quote';
import { formatCents } from '../../lib/money';
import Pill, { type PillTone } from '../Pill';

const RULE_TONE: Record<string, PillTone> = { contractOverride: 'accent', zoneRate: 'success', standardRate: 'success', manualException: 'warning' };

function sourceId(o: PriceOutcome): string | undefined {
  return o.ok ? (o.result.contractId ?? o.result.rateVersionId) : undefined;
}

/** resolvePrice for the matched account and zone. A contract override shows as the list price with the
 *  ratebook price on a secondary line, because an exception is always measured against the ratebook. */
export default function ListPriceCard({ price, accountName }: { price: ListPrice; accountName?: string }) {
  const { list, ratebook, existing } = price;
  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card" aria-label="List price">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-h2 font-bold">List price</h2>
          <p className="mt-0.5 text-small text-muted">resolvePrice{accountName ? ` for ${accountName}` : ', no account'} on today's date</p>
        </div>
        {list.ok && (
          <Pill tone={RULE_TONE[list.result.ruleWon]} dot>
            {RULE_LABEL[list.result.ruleWon]}
          </Pill>
        )}
      </div>

      {list.ok ? (
        <>
          <p className="mt-3 font-mono text-display font-bold tracking-tight" data-testid="list-price">
            {formatCents(list.result.priceCents)}
            <span className="ml-1 font-sans text-small font-semibold text-muted">/ mo</span>
          </p>
          <p className="font-mono text-mono text-muted">
            {list.result.ruleWon === 'contractOverride' ? 'from contract ' : 'from '}
            {sourceId(list)}
          </p>
          {list.result.ruleWon === 'contractOverride' && ratebook.ok && (
            <p className="mt-2 flex items-baseline justify-between gap-2 border-t border-line pt-2 text-body" data-testid="ratebook-price">
              <span className="text-muted">Ratebook {formatCents(ratebook.result.priceCents)}</span>
              <span className="font-mono text-mono text-muted">
                {RULE_LABEL[ratebook.result.ruleWon]} {sourceId(ratebook)}
              </span>
            </p>
          )}
        </>
      ) : (
        <div className="mt-3 rounded-sm border-l-[3px] border-danger bg-danger-soft px-3 py-2" role="alert">
          <p className="text-body font-semibold text-danger">No published rate for this item and frequency</p>
          <p className="font-mono text-mono text-muted">{'error' in list ? list.error : ''}</p>
        </div>
      )}

      {existing && existing.inForce && (
        <p className="mt-2 text-small text-ink">
          Existing contract price <span className="font-semibold">{formatCents(existing.override.priceCents)}</span> ({existing.override.reason ?? 'no reason recorded'}) on{' '}
          <span className="font-mono text-mono">{existing.contract.id}</span>, term {existing.contract.termStart} to {existing.contract.termEnd}.
        </p>
      )}
      {existing && !existing.inForce && (
        <p className="mt-2 rounded-sm border-l-[3px] border-warning bg-warning-soft px-3 py-2 text-small text-ink">
          <span className="font-mono text-mono">{existing.contract.id}</span> ended {existing.contract.termEnd}; its {formatCents(existing.override.priceCents)} override (
          {existing.override.reason ?? 'no reason'}) no longer applies, so this account lists at the ratebook.
        </p>
      )}
      <p className="mt-3 text-small text-muted">Exceptions are measured against the ratebook price, not a contract price.</p>
    </section>
  );
}
