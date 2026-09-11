import { useEffect, useMemo, useState } from 'react';
import type { LOB } from '../types';
import { useStore } from '../store/store';
import { toEngineState } from '../store/engine';
import { DEFAULT_ASSUMPTIONS } from '../store/costToServe';
import {
  approveButtonLabel,
  MARGIN_FLOOR_PCT, approveProposals, planApproval, proposeIncreases, rowStatus, unproposedAccounts,
  type ApprovalPlan, type ApprovalResult, type ChurnRisk, type ProposalRow, type RowStatus,
} from '../store/agentProposals';
import { formatCents } from '../lib/money';
import { LOBS, LOB_LABEL } from './LobTabs';
import Pill, { type PillTone } from './Pill';

export const AGENT_RULE = 'Agent drafts. Rules authorize. You approve. Nothing here publishes.';

const CHURN_TONE: Record<ChurnRisk, PillTone> = { high: 'danger', medium: 'warning', low: 'success' };

const pct = (n: number): string => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

// Columns: select, account, current, proposed, pct, months, margin, eligibility, churn, rationale, approve.
const GRID = 'grid grid-cols-[24px_minmax(140px,1.1fr)_84px_104px_56px_56px_76px_150px_84px_minmax(220px,2fr)_112px] gap-x-2';

interface Pending {
  ids: string[];
  label: string;
}

/** Annual increase proposals (checklist 6.3 to 6.5): a right rail card on the Ratebook that opens a wide
 *  drawer with the ranked table. Approving shows the exact writes first, then creates draft RateVersions
 *  or Contract escalator entries through the store. Nothing in this component calls publishRateVersions. */
export default function AgentPanel({ lob, onLob, today, onApproved }: { lob: LOB; onLob: (lob: LOB) => void; today: string; onApproved: (result: ApprovalResult) => void }) {
  const accounts = useStore((s) => s.accounts);
  const parties = useStore((s) => s.parties);
  const sites = useStore((s) => s.sites);
  const catalog = useStore((s) => s.catalog);
  const serviceItems = useStore((s) => s.serviceItems);
  const rateVersions = useStore((s) => s.rateVersions);
  const contracts = useStore((s) => s.contracts);
  const zones = useStore((s) => s.zones);
  const agentDraftIds = useStore((s) => s.agentDraftIds);

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Pending | null>(null);
  const [last, setLast] = useState<ApprovalResult | null>(null);

  const allRows = useMemo(
    () => proposeIncreases({ onDate: today }, toEngineState(useStore.getState())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, parties, sites, catalog, serviceItems, rateVersions, contracts, zones, today],
  );
  const skipped = useMemo(
    () => unproposedAccounts({ onDate: today }, toEngineState(useStore.getState())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, sites, serviceItems, today],
  );
  const statusOf = useMemo(() => new Map(allRows.map((r) => [r.accountId, rowStatus(r, rateVersions)] as [string, RowStatus])), [allRows, rateVersions]);
  const rows = allRows.filter((r) => r.lob === lob);
  const eligibleIds = rows.filter((r) => statusOf.get(r.accountId)?.kind === 'open').map((r) => r.accountId);
  const selectedIds = eligibleIds.filter((id) => selected.has(id));
  const scheduled = rows.filter((r) => statusOf.get(r.accountId)?.kind === 'alreadyScheduled').length;
  const draftPendingRows = rows.filter((r) => statusOf.get(r.accountId)?.kind === 'draftPending').length;
  const agentPending = rateVersions.filter((rv) => rv.status === 'draft' && agentDraftIds.includes(rv.id)).length;
  const countsByLob = Object.fromEntries(LOBS.map((l) => [l, allRows.filter((r) => r.lob === l).length])) as Record<LOB, number>;

  const eligiblePlan = useMemo(() => planApproval(allRows, eligibleIds, rateVersions, today), [allRows, eligibleIds.join(','), rateVersions, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const pendingPlan = useMemo(() => (pending ? planApproval(allRows, pending.ids, rateVersions, today) : null), [allRows, pending, rateVersions, today]);
  const monthlyUplift = rows
    .filter((r) => statusOf.get(r.accountId)?.kind === 'open' && r.action.kind === 'draftRateVersion')
    .reduce((s, r) => s + (r.proposedMonthlyCents - r.currentMonthlyCents), 0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (pending) setPending(null);
      else setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, pending]);

  const changeLob = (l: LOB) => {
    onLob(l);
    setSelected(new Set());
    setPending(null);
  };

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const confirm = () => {
    if (!pending) return;
    const result = approveProposals({ accountIds: pending.ids, onDate: today, rows: allRows });
    setLast(result);
    setPending(null);
    setSelected(new Set());
    onApproved(result);
  };

  const lobLabel = LOB_LABEL[lob].toLowerCase();

  return (
    <>
      <section className="rounded-card bg-accent-strong p-5 text-surface" aria-label="Agent proposals">
        <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-accent-soft">Agent proposals</p>
        <h2 className="mt-1 text-h2 font-bold">Annual increase</h2>
        <p className="mt-1 text-mono leading-5 text-accent-soft">{AGENT_RULE}</p>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md bg-surface/10 px-2 py-2">
            <dt className="text-eyebrow uppercase tracking-[0.08em] text-accent-soft">To approve</dt>
            <dd className="text-h1 font-bold">{eligibleIds.length}</dd>
          </div>
          <div className="rounded-md bg-surface/10 px-2 py-2">
            <dt className="text-eyebrow uppercase tracking-[0.08em] text-accent-soft">Scheduled</dt>
            <dd className="text-h1 font-bold">{scheduled}</dd>
          </div>
          <div className="rounded-md bg-surface/10 px-2 py-2">
            <dt className="text-eyebrow uppercase tracking-[0.08em] text-accent-soft">Drafted</dt>
            <dd className="text-h1 font-bold">{draftPendingRows}</dd>
          </div>
        </dl>
        <p className="mt-2 text-small text-accent-soft">
          {LOB_LABEL[lob]} accounts, as of {today}.{agentPending > 0 ? ` ${agentPending} draft${agentPending === 1 ? '' : 's'} pending from agent proposals.` : ''}
        </p>
        <button type="button" onClick={() => setOpen(true)} className="mt-3 w-full rounded-md bg-surface px-3 py-2 text-body font-semibold text-accent-strong hover:bg-accent-soft">
          Review {rows.length} {lobLabel} proposal{rows.length === 1 ? '' : 's'}
        </button>
      </section>

      {open && (
        <div className="fixed inset-0 z-30 flex justify-end" role="dialog" aria-modal="true" aria-label="Agent proposals: annual increase">
          <button type="button" aria-label="Close agent proposals" className="absolute inset-0 cursor-default bg-accent-strong/30" onClick={() => (pending ? setPending(null) : setOpen(false))} />
          <div className="relative flex h-full w-full max-w-[1200px] flex-col bg-bg shadow-raised">
            <header className="bg-accent-strong px-6 py-5 text-surface">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-accent-soft">Pricing agent, as of {today}</p>
                  <h2 className="mt-1 text-h1 font-bold">Agent proposals: annual increase</h2>
                  <p className="mt-1 text-body font-semibold text-accent-soft">{AGENT_RULE}</p>
                </div>
                <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-surface/30 px-3 py-1.5 text-mono font-semibold text-surface hover:bg-surface/10">
                  Close
                </button>
              </div>
            </header>

            <div className="border-b border-line bg-surface px-6 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div role="tablist" aria-label="Filter by line of business" className="flex items-center gap-1">
                  {LOBS.map((l) => (
                    <button
                      key={l}
                      role="tab"
                      type="button"
                      aria-selected={l === lob}
                      onClick={() => changeLob(l)}
                      className={['rounded-pill px-3 py-1.5 text-body font-semibold', l === lob ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink'].join(' ')}
                    >
                      {LOB_LABEL[l]} <span className="font-mono text-small">{countsByLob[l]}</span>
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={selectedIds.length === 0}
                    onClick={() => setPending({ ids: selectedIds, label: `Approve ${selectedIds.length} selected ${lobLabel} proposal${selectedIds.length === 1 ? '' : 's'}` })}
                    className="rounded-md border border-line bg-surface px-3 py-2 text-mono font-semibold text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Approve selected ({selectedIds.length})
                  </button>
                  <button
                    type="button"
                    disabled={eligibleIds.length === 0}
                    onClick={() => setPending({ ids: eligibleIds, label: `Approve all ${eligibleIds.length} eligible ${lobLabel} proposals` })}
                    className="rounded-md bg-accent px-3.5 py-2 text-mono font-semibold text-surface hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Approve all eligible ({eligibleIds.length})
                  </button>
                </div>
              </div>
              <p className="mt-2 text-small text-ink" data-testid="eligible-summary">
                <span className="font-semibold">Approve all eligible:</span> {eligiblePlan.summary}
                {monthlyUplift > 0 && <span className="text-muted"> Proposed uplift on these rows +{formatCents(monthlyUplift)} a month before fees and tax.</span>}
              </p>
              <p className="mt-0.5 text-small text-muted">
                Margins use the default cost assumptions: {DEFAULT_ASSUMPTIONS.residentialStopsPerDay} residential stops, {DEFAULT_ASSUMPTIONS.baseLiftsPerDay} frontload lifts, {DEFAULT_ASSUMPTIONS.rolloffHaulsPerDay} rolloff hauls a day. Below {MARGIN_FLOOR_PCT}% margin proposes 6%, otherwise 4%. Churn risk is a placeholder.
              </p>
            </div>

            {last && (
              <div className="border-b border-line bg-success-soft px-6 py-2.5 text-body text-ink" role="status">
                <span className="font-semibold">Approved.</span> {last.drafts.length} draft rate version{last.drafts.length === 1 ? '' : 's'} and {last.contracts.length} escalator entr{last.contracts.length === 1 ? 'y' : 'ies'} written. {last.drafts.length > 0 ? 'Nothing published: the drafts wait in the drafts tray for Preview publish.' : 'Nothing published: escalator entries take effect on their anniversary.'}
                <button type="button" onClick={() => setOpen(false)} className="ml-2 font-semibold text-accent hover:underline">
                  Close and review drafts
                </button>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-auto">
              <div className="min-w-[1180px]">
                <div className={`${GRID} sticky top-0 z-10 border-b border-line bg-surface-muted px-6 py-2 text-eyebrow font-bold uppercase tracking-[0.08em] text-muted`}>
                  <span className="sr-only">Select</span>
                  <span>Account</span>
                  <span className="text-right">Current</span>
                  <span className="text-right">Proposed</span>
                  <span className="text-right">Pct</span>
                  <span className="text-right">Months since increase</span>
                  <span className="text-right">Margin</span>
                  <span>Contract eligibility</span>
                  <span>Churn risk</span>
                  <span>Rationale</span>
                  <span className="text-right">Approve</span>
                </div>
                <ul>
                  {rows.map((r) => (
                    <ProposalLine key={r.accountId} row={r} status={statusOf.get(r.accountId) ?? { kind: 'open' }} checked={selected.has(r.accountId)} onToggle={() => toggle(r.accountId)} onApprove={() => setPending({ ids: [r.accountId], label: `Approve ${r.name}` })} />
                  ))}
                </ul>
                {rows.length === 0 && <p className="px-6 py-6 text-body text-muted">No billable {lobLabel} accounts with active service.</p>}
                {skipped.length > 0 && (
                  <p className="px-6 py-3 text-small text-muted">
                    Not proposed: {skipped.map((s) => `${s.name} (${s.accountId}, ${s.status})`).join(', ')}. Only active and past due accounts are billed, so only they get an increase proposal.
                  </p>
                )}
              </div>
            </div>

            {pending && pendingPlan && <ConfirmBar label={pending.label} plan={pendingPlan} onConfirm={confirm} onCancel={() => setPending(null)} />}
          </div>
        </div>
      )}
    </>
  );
}

function ProposalLine({ row: r, status, checked, onToggle, onApprove }: { row: ProposalRow; status: RowStatus; checked: boolean; onToggle: () => void; onApprove: () => void }) {
  const canApprove = status.kind === 'open';
  const low = r.marginPct < MARGIN_FLOOR_PCT;
  return (
    <li className={`${GRID} items-start border-b border-line bg-surface px-6 py-3 text-body`} data-account={r.accountId}>
      <input type="checkbox" aria-label={`Select ${r.name}`} checked={checked && canApprove} disabled={!canApprove} onChange={onToggle} className="mt-1 h-4 w-4 accent-[var(--tl-accent)]" />
      <div className="min-w-0">
        <p className="truncate font-semibold text-ink" title={r.name}>{r.name}</p>
        <p className="truncate font-mono text-small text-muted">{r.accountId}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {r.accountStatus === 'pastDue' && <Pill tone="danger">past due</Pill>}
          {r.lapsedContract && <Pill tone="warning" title={`${r.lapsedContract.id} is kept as history and never written to`}>contract ended {r.lapsedContract.termEnd}</Pill>}
        </div>
      </div>
      <span className="text-right font-mono text-mono text-ink">{formatCents(r.currentMonthlyCents)}</span>
      <span className="flex flex-col items-end font-mono text-mono">
        <span className="font-bold text-ink">{formatCents(r.proposedMonthlyCents)}</span>
        <span className="text-eyebrow text-muted">{r.eligibilityKind === 'locked' ? `held to ${r.contract?.termEnd}` : `from ${r.proposedEffective}`}</span>
      </span>
      <span className="flex flex-col items-end gap-0.5">
        <Pill tone={r.proposedPct === 0 ? 'muted' : r.eligibilityKind === 'escalatorScheduled' ? 'accent' : 'warning'}>{r.proposedPct === 0 ? '0%' : `+${pct(r.proposedPct)}`}</Pill>
        {r.escalatorPct !== undefined && <span className="text-right text-eyebrow text-muted">then +{pct(r.escalatorPct)} from {r.proposedEffective}</span>}
      </span>
      <span className="text-right font-mono text-mono text-ink" title={`Measured from ${r.lastIncrease.id}, ${r.lastIncrease.date}`}>{r.monthsSinceLastIncrease} mo</span>
      <span className="flex flex-col items-end">
        <span className={`font-mono text-mono font-semibold ${low ? 'text-danger' : 'text-success'}`}>{pct(r.marginPct)}</span>
        <span className="text-eyebrow text-muted">cost {formatCents(r.costMonthlyCents)}</span>
      </span>
      <span className="text-small leading-4 text-ink">{r.contractEligibility}</span>
      <span className="flex flex-col items-start gap-0.5">
        <Pill tone={CHURN_TONE[r.churnRisk]} dot>{r.churnRisk}</Pill>
        <span className="text-eyebrow text-muted">placeholder</span>
      </span>
      <span className="text-small leading-4 text-muted">
        {r.rationale}
        <span className="mt-1 block font-mono text-eyebrow text-muted">Action: {r.action.label}</span>
      </span>
      <span className="flex justify-end">
        {status.kind === 'open' && (
          <button type="button" onClick={onApprove} className="rounded-md bg-accent px-3 py-1.5 text-mono font-semibold text-surface hover:bg-accent-strong">
            Approve
          </button>
        )}
        {status.kind === 'draftPending' && (
          <span className="flex flex-col items-end gap-0.5" title={status.draftIds.join(', ')}>
            <Pill tone="warning" dot>Draft pending</Pill>
            <span className="max-w-[112px] truncate font-mono text-eyebrow text-muted">{status.draftIds[0]}</span>
          </span>
        )}
        {status.kind === 'alreadyScheduled' && <Pill tone="accent">Already scheduled</Pill>}
      </span>
    </li>
  );
}

/** States every write before it runs: the drafts (deduplicated), who they cover, escalator entries, and
 *  what is skipped. The approve button is the only writer in the panel. */
function ConfirmBar({ label, plan, onConfirm, onCancel }: { label: string; plan: ApprovalPlan; onConfirm: () => void; onCancel: () => void }) {
  const nothing = plan.drafts.length === 0 && plan.escalators.length === 0;
  return (
    <div className="border-t-2 border-accent bg-surface px-6 py-4 shadow-raised" role="region" aria-label="Confirm approval">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-accent">{label}</p>
          <p className="mt-1 text-h2 font-bold text-ink" data-testid="approval-summary">{plan.summary}</p>
          <ul className="mt-2 max-h-[160px] space-y-1 overflow-y-auto text-small text-ink">
            {plan.drafts.map((d) => (
              <li key={d.key} className="font-mono text-mono">
                Draft {d.args.catalogId}, {d.args.zoneId ?? 'all zones'}, {d.args.frequency ?? 'any'}: {formatCents(d.currentPriceCents)} to {formatCents(d.args.priceCents)} (+{pct(d.pct)}) from {d.args.effectiveFrom}, supersedes {d.args.supersedesId}
                {d.pctConflict && <span className="font-sans text-warning"> Approved rows disagree on the percent; the lower one is used.</span>}
              </li>
            ))}
            {plan.escalators.map((e) => (
              <li key={e.contractId} className="font-mono text-mono">
                Escalator on {e.contractId}: {e.escalator.kind} {pct(e.escalator.pct)} on {e.escalator.anniversary}
              </li>
            ))}
            {plan.alreadyPending.map((p) => (
              <li key={p.key} className="text-muted">
                {p.label} already has a pending draft ({p.draftIds.join(', ')}), so nothing new is drafted there.
              </li>
            ))}
            {plan.alreadyScheduled.length > 0 && <li className="text-muted">{plan.alreadyScheduled.length} already scheduled, no write.</li>}
          </ul>
          {plan.drafts.length > 0 && (
            <p className="mt-2 rounded-sm border-l-[3px] border-warning bg-warning-soft px-3 py-2 text-small text-ink">
              A rate version is a list price. Once published it moves every account on that rate line, approved here or not; the {plan.coveredAccountIds.length} covered accounts are everyone on these lines. Contract accounts stay protected. Preview publish lists exactly who moves.
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border border-line bg-surface px-3 py-2 text-mono font-semibold text-muted hover:text-ink">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={nothing} className="rounded-md bg-accent px-3.5 py-2 text-mono font-semibold text-surface hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40">
            {approveButtonLabel(plan)}
          </button>
        </div>
      </div>
    </div>
  );
}
