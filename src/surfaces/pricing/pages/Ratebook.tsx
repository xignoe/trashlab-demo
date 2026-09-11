import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { LOB, RateVersion } from '../../../types'
import { useStore } from '../../../store/useStore'
import { today as clockToday } from '../../../store/clock'
import { blastRadius, type BlastRadius } from '../lib/preview'
import { isNoChangeDraft, publishedAtFor, withDrafts } from '../lib/rateVersions'
import { lobDrafts, versionHistory, type RateGroupKey } from '../lib/ratebook'
import { ALL_LOBS, rateRows, type RateRow } from '../lib/config'
import { ruleState } from '../lib/rules'
import type { ApprovalResult } from '../lib/agentProposals'
import VersionHistoryDrawer from '../components/VersionHistoryDrawer'
import WorkedExample from '../components/WorkedExample'
import DraftsTray from '../components/DraftsTray'
import PublishPreviewModal from '../components/PublishPreviewModal'
import HistoryProof from '../components/HistoryProof'
import Toast from '../components/Toast'
import Pill from '../components/Pill'
import AgentPanel from '../components/AgentPanel'
import RateSheet from '../components/RateSheet'
import FeeSchedule from '../components/FeeSchedule'
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from '../components/form'
import { BulkAdjustDrawer, RateForm } from '../components/RateTools'
import ServicesSection from '../sections/ServicesSection'
import DimensionsSection from '../sections/DimensionsSection'
import AdjustmentsSection from '../sections/AdjustmentsSection'
import TaxesSection from '../sections/TaxesSection'
import ZonesSection from '../sections/ZonesSection'
import GeoZonesSection from '../sections/GeoZonesSection'
import CyclesSection from '../sections/CyclesSection'
import RolloffSection from '../sections/RolloffSection'
import NewRateSection from '../sections/NewRateSection'

const SECTIONS = [
  { id: 'rates', label: 'Rates', hint: 'Every rate in one sheet; click a price to change it' },
  { id: 'services', label: 'Services', hint: 'Categories and what you sell' },
  { id: 'dimensions', label: 'Fields', hint: 'Anything a price can depend on, including your own fields' },
  { id: 'adjustments', label: 'Adjustments', hint: 'Fees, surcharges, discounts' },
  { id: 'taxes', label: 'Taxes', hint: 'Layers by zone type' },
  { id: 'geozones', label: 'Zones', hint: 'Areas drawn on the map, around a city or a stretch of county' },
  { id: 'zones', label: 'Zone types', hint: 'Open market, boundary, franchise, not served; distance and density' },
  { id: 'cycles', label: 'Billing cycles', hint: 'Cycles and cycle pricing' },
  { id: 'rolloff', label: 'Roll-off', hint: 'Materials, tons, days, trips' },
  { id: 'newrate', label: 'New rate', hint: 'Add a rate from scratch, step by step' },
] as const
export type RatebookSection = (typeof SECTIONS)[number]['id']
const isSection = (v: string | null): v is RatebookSection => SECTIONS.some(s => s.id === v)

/**
 * The Ratebook: the owner's pricing configuration (DECISIONS.md entries 65, 68, and 69). Rates open on one sheet of every
 * rate line, editable in place; the other sections are forms over the rest of the model: services, fields (built in and
 * custom), adjustments, tax layers, zone types, billing cycles, roll-off terms, and a step-by-step new rate. The section is in the
 * URL (?section=) so a link can open one. Every write goes through the pricing slice; rates are drafted and published as
 * new versions, and rules are versioned by effective date.
 */
export default function Ratebook() {
  const [params, setParams] = useSearchParams()
  const section: RatebookSection = isSection(params.get('section')) ? (params.get('section') as RatebookSection) : 'rates'
  const openSection = (id: RatebookSection) => {
    const next = new URLSearchParams(params)
    if (id === 'rates') next.delete('section')
    else next.set('section', id)
    setParams(next, { replace: true })
  }

  const [toast, setToast] = useState<{ message: string; detail?: string } | null>(null)
  const closeToast = useCallback(() => setToast(null), [])

  const db = useStore(s => s.db)
  const drafts = useStore(s => s.pricingDrafts)
  const agentDraftIds = useStore(s => s.pricingAgentDraftIds)
  const today = useStore(() => clockToday())
  const published = db.rateVersions.filter(rv => rv.status === 'published').length
  const draftCount = drafts.length
  const agentPending = drafts.filter(d => agentDraftIds.includes(d.id)).length

  const counts: Record<RatebookSection, string> = {
    rates: String(published),
    services: String(db.catalog.length),
    dimensions: String((db.pricingDimensions ?? []).length),
    adjustments: String(db.feeRules.filter(r => ruleState(r, today) !== 'ended').length),
    taxes: String(db.taxRules.filter(r => ruleState(r, today) !== 'ended').length),
    geozones: String((db.geoZones ?? []).length),
    zones: String(db.zones.length),
    cycles: String(new Set(db.accounts.map(a => a.cycle)).size),
    rolloff: String((db.rolloffMaterials ?? []).length),
    newrate: '',
  }

  let body: ReactNode
  switch (section) {
    case 'services': body = <ServicesSection today={today} />; break
    case 'dimensions': body = <DimensionsSection today={today} />; break
    case 'adjustments': body = <AdjustmentsSection today={today} />; break
    case 'taxes': body = <TaxesSection today={today} />; break
    case 'geozones': body = <GeoZonesSection today={today} />; break
    case 'zones': body = <ZonesSection today={today} />; break
    case 'cycles': body = <CyclesSection today={today} />; break
    case 'rolloff': body = <RolloffSection today={today} />; break
    case 'newrate': body = <NewRateSection today={today} onOpenSection={openSection} />; break
    default: body = <RatesView today={today} onToast={setToast} onOpenSection={openSection} />
  }

  return (
    <div className="mx-auto max-w-[1440px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-accent">Pricing</p>
          <h1 className="mt-1 text-display font-bold tracking-tight">Ratebook</h1>
        </div>
        <div className="flex flex-col items-end gap-1.5" data-testid="ratebook-status">
          <Pill tone={draftCount > 0 ? 'warning' : 'success'} dot>
            {published} published, {draftCount} draft{draftCount === 1 ? '' : 's'}
          </Pill>
          {agentPending > 0 && (
            <Pill tone="accent" dot>
              {agentPending} draft{agentPending === 1 ? '' : 's'} pending from agent proposals
            </Pill>
          )}
        </div>
      </div>

      <nav aria-label="Ratebook sections" className="mt-6 overflow-x-auto">
        <ul className="flex min-w-max gap-1 rounded-card border border-line bg-surface p-1 shadow-card">
          {SECTIONS.map(s => {
            const active = s.id === section
            return (
              <li key={s.id}>
                <button
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  title={s.hint}
                  onClick={() => openSection(s.id)}
                  className={['flex items-center gap-1.5 rounded-md px-3 py-2 text-body font-semibold transition-colors', active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-muted hover:text-ink'].join(' ')}
                >
                  {s.label}
                  {counts[s.id] && <span className={['rounded-pill px-1.5 text-small font-bold', active ? 'bg-surface text-accent' : 'bg-surface-muted text-muted'].join(' ')}>{counts[s.id]}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="mt-6">{body}</div>
      <Toast message={toast?.message ?? null} detail={toast?.detail} onClose={closeToast} />
    </div>
  )
}

type Toasted = { message: string; detail?: string }
type Tool = null | { kind: 'rate'; catalogId?: string; values?: Record<string, string>; priceCents?: number; edit?: boolean } | { kind: 'adjust'; ids: string[]; label: string }

/**
 * The rate sheet with its tools: every rate line of every line of business in one table, editable in place, with the
 * drafts tray (one per line of business with pending drafts), publish preview, history drawer and proof, Add rate, and
 * Adjust rates by x% (a percentage on the lines the filters show).
 */
function RatesView({ today, onToast, onOpenSection }: { today: string; onToast: (t: Toasted) => void; onOpenSection: (id: 'adjustments' | 'taxes') => void }) {
  const [lob, setLob] = useState<LOB | 'all'>('all')
  const [historyKey, setHistoryKey] = useState<RateGroupKey | null>(null)
  const [preview, setPreview] = useState<{ lob: LOB; result: BlastRadius } | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [tool, setTool] = useState<Tool>(null)

  const db = useStore(s => s.db)
  const drafts = useStore(s => s.pricingDrafts)
  const agentDraftIds = useStore(s => s.pricingAgentDraftIds)
  const publishCount = useStore(s => s.pricingPublishCount)
  const lastPublish = useStore(s => s.pricingLastPublish)
  const discardDraft = useStore(s => s.discardDraftRateVersion)
  const publishRateVersions = useStore(s => s.publishRateVersions)

  const view = useMemo(() => withDrafts(db, drafts), [db, drafts])
  const rows = useMemo(() => rateRows(view, today), [view, today])
  const pendingBy = useMemo(() => Object.fromEntries(ALL_LOBS.map(l => [l, lobDrafts(view, l)])) as Record<LOB, ReturnType<typeof lobDrafts>>, [view])
  const trayLobs = (lob === 'all' ? ALL_LOBS : [lob]).filter(l => pendingBy[l].length > 0)
  const historyRows = useMemo(() => (historyKey ? versionHistory(view, historyKey, today) : []), [view, historyKey, today])
  const historyItem = historyKey ? db.catalog.find(c => c.id === historyKey.catalogId) : undefined
  const closeHistory = useCallback(() => setHistoryKey(null), [])
  const cancelPreview = useCallback(() => setPreview(null), [])

  const onAgentApproved = (r: ApprovalResult) => {
    const lobs = [...new Set(r.drafts.map(d => db.catalog.find(c => c.id === d.catalogId)?.lob).filter((l): l is LOB => !!l))]
    const n = r.plan.approvedAccountIds.length
    onToast({
      message: `Approved ${n} proposal${n === 1 ? '' : 's'}: ${r.drafts.length} draft${r.drafts.length === 1 ? '' : 's'}, ${r.contracts.length} escalator entr${r.contracts.length === 1 ? 'y' : 'ies'}. Nothing published.`,
      detail: r.drafts.length ? `Drafts wait in the ${lobs.join(', ')} drafts tray. Preview publish shows who moves before anything is billed.` : 'Escalator entries take effect on their anniversary; nothing a customer is billed changed today.',
    })
  }

  const openPreview = (l: LOB) => {
    const draftIds = pendingBy[l].filter(({ draft }) => !isNoChangeDraft(draft, view.rateVersions)).map(({ draft }) => draft.id)
    if (draftIds.length === 0) return
    setPreview({ lob: l, result: blastRadius({ draftIds, drafts, onDate: today, db, publishedAt: publishedAtFor(today, publishCount) }) })
  }

  const confirmPublish = () => {
    if (!preview) return
    setPublishing(true)
    const result = publishRateVersions({ draftIds: preview.result.draftIds })
    setPublishing(false)
    setPreview(null)
    onToast({
      message: `Published ${result.length} version${result.length === 1 ? '' : 's'}. Old versions kept.`,
      detail: 'Each new version carries supersedesId; the superseded versions were not edited. See the history proof below the sheet.',
    })
  }

  const draftsCreated = (created: RateVersion[], what: string) => {
    setTool(null)
    onToast({ message: `${created.length} draft${created.length === 1 ? '' : 's'} created: ${what}.`, detail: 'Not in force until you preview and publish from the drafts tray.' })
  }

  const openHistory = (row: RateRow) =>
    setHistoryKey({ catalogId: row.catalogId, ...(row.zoneId ? { zoneId: row.zoneId } : {}), ...(row.frequency ? { frequency: row.frequency } : {}), ...(row.dims ? { dims: row.dims } : {}) })

  const actions = (shown: RateRow[]) => {
    const ids = shown.map(r => (r.scheduled[0] ?? r.current)?.id).filter((id): id is string => !!id && !drafts.some(d => d.id === id))
    return (
      <>
        <button type="button" className={BUTTON_SECONDARY} disabled={ids.length === 0} onClick={() => setTool({ kind: 'adjust', ids, label: `${shown.length} rate line${shown.length === 1 ? '' : 's'} shown` })}>
          Adjust rates by x%
        </button>
        <button type="button" className={BUTTON_PRIMARY} onClick={() => setTool({ kind: 'rate' })}>
          Add rate
        </button>
      </>
    )
  }

  return (
    <div className="space-y-5">
      {trayLobs.map(l => (
        <DraftsTray
          key={l}
          lob={l}
          drafts={pendingBy[l]}
          zones={db.zones}
          agentDraftIds={agentDraftIds}
          onDiscard={id => discardDraft({ id })}
          onDiscardAll={() => {
            for (const { draft } of pendingBy[l]) discardDraft({ id: draft.id })
          }}
          onPreview={() => openPreview(l)}
        />
      ))}

      <RateSheet rows={rows} today={today} lob={lob} onLob={setLob} onHistory={openHistory} onAddRate={prefill => setTool({ kind: 'rate', ...prefill })} onEditRate={prefill => setTool({ kind: 'rate', ...prefill, edit: true })} actions={actions} />
      {lastPublish && <HistoryProof record={lastPublish} />}
      <FeeSchedule today={today} onOpenSection={onOpenSection} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <WorkedExample db={db} today={today} />
        <AgentPanel lob={lob === 'all' ? 'residential' : lob} onLob={setLob} today={today} onApproved={onAgentApproved} />
      </div>

      <VersionHistoryDrawer group={historyKey} item={historyItem} zones={db.zones} rows={historyRows} today={today} onClose={closeHistory} onDiscard={id => discardDraft({ id })} />
      {preview && <PublishPreviewModal lob={preview.lob} result={preview.result} draftCount={preview.result.draftIds.length} publishing={publishing} onConfirm={confirmPublish} onCancel={cancelPreview} />}
      {tool?.kind === 'rate' && (
        <RateForm
          today={today}
          initial={{ ...(tool.catalogId ? { catalogId: tool.catalogId } : {}), ...(tool.values ? { values: tool.values } : {}), ...(tool.priceCents !== undefined ? { priceCents: tool.priceCents } : {}) }}
          mode={tool.edit ? 'edit' : 'add'}
          onClose={() => setTool(null)}
          onSaved={draft => draftsCreated([draft], draft.id)}
          onPublished={rv => {
            setTool(null)
            onToast({
              message: `Published ${rv.id} for new service only.`,
              detail: `Current customers keep their price. Service starting on or after ${rv.effectiveFrom}, and new quotes and sign-ups, pay the new rate.`,
            })
          }}
        />
      )}
      {tool?.kind === 'adjust' && (
        <BulkAdjustDrawer today={today} rateVersionIds={tool.ids} scopeLabel={tool.label} onClose={() => setTool(null)} onCreated={created => draftsCreated(created, 'adjusted lines')} />
      )}
    </div>
  )
}
