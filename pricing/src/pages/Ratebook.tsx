import { useCallback, useMemo, useState } from 'react';
import type { LOB } from '../types';
import { isNoChangeDraft, useStore } from '../store/store';
import { toEngineState } from '../store/engine';
import { blastRadius, type BlastRadius } from '../store/preview';
import { TODAY } from '../store/dates';
import { catalogGroups, lobDrafts, versionHistory, type CatalogLine, type RateGroupKey } from '../lib/ratebook';
import LobTabs, { LOBS } from '../components/LobTabs';
import CatalogTable from '../components/CatalogTable';
import VersionHistoryDrawer from '../components/VersionHistoryDrawer';
import ZonesPanel from '../components/ZonesPanel';
import FeeRulesPanel from '../components/FeeRulesPanel';
import WorkedExample from '../components/WorkedExample';
import NewDraftForm from '../components/NewDraftForm';
import BulkIncreaseControl from '../components/BulkIncreaseControl';
import DraftsTray from '../components/DraftsTray';
import PublishPreviewModal from '../components/PublishPreviewModal';
import HistoryProof from '../components/HistoryProof';
import Toast from '../components/Toast';
import Pill from '../components/Pill';
import AgentPanel from '../components/AgentPanel';
import FearStrip from '../components/FearStrip';
import type { ApprovalResult } from '../store/agentProposals';

interface LastPublish {
  ids: string[];
  publishedAt: string;
}

/** publishedAt for a publish made from this screen (addendum E1: no new Date(), Eastern daylight time).
 *  The first publish of the session is TODAY at 09:00 -04:00; each later one is a minute after the last so
 *  the history drawer still orders publishes made in one sitting. */
export function publishedAtFor(publishIndex: number): string {
  const minutes = 9 * 60 + publishIndex;
  const hh = String(Math.floor(minutes / 60) % 24).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${TODAY}T${hh}:${mm}:00-04:00`;
}

export default function Ratebook() {
  const [lob, setLob] = useState<LOB>('residential');
  const [historyKey, setHistoryKey] = useState<RateGroupKey | null>(null);
  const [draftingLine, setDraftingLine] = useState<CatalogLine | null>(null);
  const [preview, setPreview] = useState<BlastRadius | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState<{ message: string; detail?: string } | null>(null);
  const [lastPublish, setLastPublish] = useState<LastPublish | null>(null);
  const [publishCount, setPublishCount] = useState(0);

  const catalog = useStore((s) => s.catalog);
  const rateVersions = useStore((s) => s.rateVersions);
  const zones = useStore((s) => s.zones);
  const feeRules = useStore((s) => s.feeRules);
  const taxRules = useStore((s) => s.taxRules);
  const setZonePublicPricing = useStore((s) => s.setZonePublicPricing);
  const discardDraft = useStore((s) => s.discardDraft);
  const createDraftRateVersion = useStore((s) => s.createDraftRateVersion);
  const createBulkIncreaseDrafts = useStore((s) => s.createBulkIncreaseDrafts);
  const publishRateVersions = useStore((s) => s.publishRateVersions);
  const agentDraftIds = useStore((s) => s.agentDraftIds);

  // Selectors read a snapshot of the engine tables; the deps below are the ones the read side can change.
  const engine = useMemo(() => toEngineState(useStore.getState()), [catalog, rateVersions, zones, feeRules, taxRules]);
  const groups = useMemo(() => catalogGroups(engine, lob, TODAY), [engine, lob]);
  const pending = useMemo(() => lobDrafts(engine, lob), [engine, lob]);
  const counts = useMemo(() => Object.fromEntries(LOBS.map((l) => [l, catalog.filter((c) => c.lob === l).length])) as Record<LOB, number>, [catalog]);
  const published = rateVersions.filter((rv) => rv.status === 'published').length;
  const drafts = rateVersions.length - published;
  const agentPending = rateVersions.filter((rv) => rv.status === 'draft' && agentDraftIds.includes(rv.id)).length;
  const historyRows = useMemo(() => (historyKey ? versionHistory(engine, historyKey, TODAY) : []), [engine, historyKey]);
  const historyItem = historyKey ? catalog.find((c) => c.id === historyKey.catalogId) : undefined;
  const closeHistory = useCallback(() => setHistoryKey(null), []);
  const closeToast = useCallback(() => setToast(null), []);
  const cancelPreview = useCallback(() => setPreview(null), []);

  const changeLob = (next: LOB) => {
    setLob(next);
    setDraftingLine(null);
  };

  /** Bulk increase: discard this LOB's pending drafts first, since createBulkIncreaseDrafts does not dedupe. */
  const applyBulk = ({ pct, effectiveFrom }: { pct: number; effectiveFrom: string }) => {
    for (const { draft } of pending) discardDraft({ id: draft.id });
    const created = createBulkIncreaseDrafts({ lob, pct, effectiveFrom });
    setDraftingLine(null);
    setToast({ message: `${created.length} ${lob} draft${created.length === 1 ? '' : 's'} created at +${pct}%.`, detail: 'Nothing a customer is billed has changed. Preview publish to see who moves.' });
  };

  /** Agent approvals write drafts and escalator entries only; the toast says so and where to find them. */
  const onAgentApproved = (r: ApprovalResult) => {
    const lobs = [...new Set(r.drafts.map((d) => catalog.find((c) => c.id === d.catalogId)?.lob).filter((l): l is LOB => !!l))];
    const n = r.plan.approvedAccountIds.length;
    setToast({
      message: `Approved ${n} proposal${n === 1 ? '' : 's'}: ${r.drafts.length} draft${r.drafts.length === 1 ? '' : 's'}, ${r.contracts.length} escalator entr${r.contracts.length === 1 ? 'y' : 'ies'}. Nothing published.`,
      detail: r.drafts.length ? `Drafts wait in the ${lobs.join(', ')} drafts tray. Preview publish shows who moves before anything is billed.` : 'Escalator entries take effect on their anniversary; nothing a customer is billed changed today.',
    });
  };

  /** Only drafts that change a price go to the preview; a no-change draft stays in the tray, flagged
   *  (checklist 7.7), and publishRateVersions would skip it anyway. */
  const openPreview = () => {
    const draftIds = pending.filter(({ draft }) => !isNoChangeDraft(draft, rateVersions)).map(({ draft }) => draft.id);
    if (draftIds.length === 0) return;
    setPreview(blastRadius({ draftIds, onDate: TODAY }));
  };

  const confirmPublish = () => {
    if (!preview) return;
    setPublishing(true);
    const publishedAt = publishedAtFor(publishCount);
    setPublishCount((n) => n + 1);
    const result = publishRateVersions({ draftIds: preview.draftIds, publishedAt });
    setPublishing(false);
    setPreview(null);
    setLastPublish({ ids: result.map((rv) => rv.id), publishedAt });
    setToast({ message: `Published ${result.length} version${result.length === 1 ? '' : 's'}. Old versions kept.`, detail: 'Each new version carries supersedesId; the superseded versions were not edited. See the history proof below the table.' });
  };

  const draftForm = draftingLine
    ? {
        key: draftingLine.key,
        node: (
          <NewDraftForm
            key={draftingLine.key}
            line={draftingLine}
            itemName={catalog.find((c) => c.id === draftingLine.catalogId)?.name ?? draftingLine.catalogId}
            zones={zones}
            today={TODAY}
            onCancel={() => setDraftingLine(null)}
            onSubmit={({ priceCents, effectiveFrom }) => {
              const draft = createDraftRateVersion({
                catalogId: draftingLine.catalogId,
                zoneId: draftingLine.zoneId,
                frequency: draftingLine.frequency,
                priceCents,
                effectiveFrom,
                supersedesId: draftingLine.current?.id,
              });
              setDraftingLine(null);
              setToast({ message: `Draft ${draft.id} created.`, detail: `Supersedes ${draft.supersedesId ?? 'nothing'} once published. Not in force until you preview and confirm.` });
            }}
          />
        ),
      }
    : undefined;

  return (
    <div className="mx-auto max-w-[1360px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-accent">Pricing</p>
          <h1 className="mt-1 text-display font-bold tracking-tight">Ratebook</h1>
          <p className="mt-1 text-body text-muted">Published rates by line of business, zone, and frequency. Versions are immutable; a change is a new version.</p>
          <FearStrip items={['increases hitting contract accounts', 'fees on the wrong base', 'rate edits rewriting history']} />
        </div>
        <div className="flex flex-col items-end gap-1.5" data-testid="ratebook-status">
          <Pill tone={drafts > 0 ? 'warning' : 'success'} dot>
            {published} published, {drafts} draft{drafts === 1 ? '' : 's'}
          </Pill>
          {agentPending > 0 && (
            <Pill tone="accent" dot>
              {agentPending} draft{agentPending === 1 ? '' : 's'} pending from agent proposals
            </Pill>
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <LobTabs lob={lob} counts={counts} onChange={changeLob} actions={<BulkIncreaseControl lob={lob} pendingCount={pending.length} today={TODAY} onApply={applyBulk} />} />
          <DraftsTray
            lob={lob}
            drafts={pending}
            zones={zones}
            agentDraftIds={agentDraftIds}
            onDiscard={(id) => discardDraft({ id })}
            onDiscardAll={() => {
              for (const { draft } of pending) discardDraft({ id: draft.id });
            }}
            onPreview={openPreview}
          />
          <CatalogTable
            groups={groups}
            zones={zones}
            today={TODAY}
            onHistory={(line) => setHistoryKey({ catalogId: line.catalogId, zoneId: line.zoneId, frequency: line.frequency })}
            onNewDraft={(line) => setDraftingLine((cur) => (cur?.key === line.key ? null : line))}
            draftForm={draftForm}
          />
          {lastPublish && <HistoryProof publishedIds={lastPublish.ids} publishedAt={lastPublish.publishedAt} />}
        </div>

        <aside className="space-y-5">
          <ZonesPanel zones={zones} onPublicPricing={(zoneId, publicPricing) => setZonePublicPricing({ zoneId, publicPricing })} />
          <FeeRulesPanel feeRules={feeRules} taxRules={taxRules} />
          <WorkedExample />
          <AgentPanel lob={lob} onLob={changeLob} today={TODAY} onApproved={onAgentApproved} />
        </aside>
      </div>

      <VersionHistoryDrawer group={historyKey} item={historyItem} zones={zones} rows={historyRows} today={TODAY} onClose={closeHistory} onDiscard={(id) => discardDraft({ id })} />
      {preview && <PublishPreviewModal lob={lob} result={preview} draftCount={preview.draftIds.length} publishing={publishing} onConfirm={confirmPublish} onCancel={cancelPreview} />}
      <Toast message={toast?.message ?? null} detail={toast?.detail} onClose={closeToast} />
    </div>
  );
}
