import { useCallback, useState } from 'react'
import { useStore } from '../store/useStore'
import { postedInvoices } from '../store/selectors'
import { nextCycleDate } from '../store/cycles'
import { NavBar } from '../components/billing/NavBar'
import { SummaryTiles } from '../components/billing/SummaryTiles'
import { ExceptionQueue } from '../components/billing/ExceptionQueue'
import { DetailPanel } from '../components/billing/DetailPanel'
import { LeakageCard, ReadyToPostCard } from '../components/billing/SideCards'
import { PostedInvoicesCard } from '../components/billing/PostedInvoices'
import { RatesDrawer } from '../components/billing/RatesDrawer'
import { PaymentsTab } from '../components/billing/PaymentsTab'
import { useBillingData } from '../components/billing/useBillingData'
import { dayLabel, longDate, monthYear } from '../components/billing/format'

/**
 * Billing run at /billing. Layout follows the manager's Paper artboard "Billing run, Office" (P2-0):
 * nav, header, four tiles, then the exception queue, posted invoices, and leakage card beside the detail panel
 * and the ready-to-post card. Every figure comes from src/store/selectors.ts. The Payments tab (artboard XV-0)
 * renders in place of the run when the store's activeTab is payments; switching never reloads the page.
 */
export function BillingRun() {
  const { data, queue, summary, detail, leakage, bulk, posting, postedCycles, cadence, through } = useBillingData()
  const runCycle = useStore(s => s.runCycle)
  const approve = useStore(s => s.approve)
  const editAmount = useStore(s => s.editAmount)
  const waive = useStore(s => s.waive)
  const previewEdit = useStore(s => s.previewEdit)
  const bulkApproveClean = useStore(s => s.bulkApproveClean)
  const post = useStore(s => s.post)
  const publishRate = useStore(s => s.publishRateVersionStub)
  const advanceCycle = useStore(s => s.advanceCycle)
  const selectCharge = useStore(s => s.selectCharge)
  const setActiveTab = useStore(s => s.setActiveTab)
  const [ratesOpen, setRatesOpen] = useState(false)
  const hauler = data.db.hauler[0]
  const nextCycle = nextCycleDate({ cycle: 'monthly' }, data.cycleDate)
  const feeRules = data.db.feeRules
  const feeName = useCallback((id: string) => feeRules.find(r => r.id === id)?.name ?? id, [feeRules])
  const rowsFor = useCallback((cycle: string) => postedInvoices(data, cycle), [data])

  const subtitle = [
    `Cycle date ${longDate(data.cycleDate)}`,
    cadence,
    through ? `Events through ${dayLabel(through)}` : undefined,
    hauler?.name,
  ].filter(Boolean).join(' · ')

  // Payments is a tab on the same page: the store switches it, nothing reloads (manager artboard XV-0).
  const showTab = (tab: 'run' | 'payments') => {
    setActiveTab(tab)
    window.scrollTo({ top: 0 })
  }

  if (data.activeTab === 'payments') {
    return (
      <div>
        <NavBar actor={data.actor} />
        <main className="tl-page">
          <PaymentsTab onSelectTab={showTab} />
        </main>
      </div>
    )
  }

  return (
    <div>
      <NavBar actor={data.actor} />
      <main className="tl-page">
        <header className="tl-page-header">
          <div>
            <div className="tl-eyebrow">Office · Billing run</div>
            <div className="tl-header-title-row">
              <h1 className="tl-page-title">{monthYear(data.cycleDate)} cycle</h1>
              {!summary.ran ? (
                <span className="tl-pill">Not run yet</span>
              ) : summary.allPosted ? (
                <span className="tl-pill" data-tone="ok">Posted</span>
              ) : summary.undecidedCount > 0 ? (
                <span className="tl-pill" data-tone="warn">{summary.undecidedCount} decision{summary.undecidedCount === 1 ? '' : 's'} open</span>
              ) : (
                <span className="tl-pill" data-tone="ok">All decided</span>
              )}
            </div>
            <p className="tl-page-subtitle">{subtitle}</p>
          </div>
          <div className="tl-header-actions">
            <button type="button" className="tl-btn tl-btn-secondary" aria-haspopup="dialog" aria-expanded={ratesOpen} onClick={() => setRatesOpen(true)}>
              Rates
            </button>
            <button type="button" className="tl-btn tl-btn-secondary" onClick={() => showTab('payments')}>Payments</button>
            {summary.allPosted ? (
              <>
                <button type="button" className="tl-btn tl-btn-secondary" onClick={() => runCycle()}>Run cycle</button>
                <button type="button" className="tl-btn tl-btn-primary" onClick={() => advanceCycle()}>
                  Next cycle, {dayLabel(nextCycle)}
                </button>
              </>
            ) : (
              <button type="button" className="tl-btn tl-btn-primary" onClick={() => runCycle()}>Run cycle</button>
            )}
          </div>
        </header>

        <SummaryTiles summary={summary} />

        <div className="tl-columns">
          <div className="tl-stack">
            <ExceptionQueue
              key={data.cycleDate}
              items={queue}
              summary={summary}
              selectedId={data.selectedChargeId}
              onSelect={selectCharge}
              bulk={bulk}
              posting={posting}
              onBulkApprove={bulkApproveClean}
              onPost={() => {
                const invoices = post()
                return { count: invoices.length, cents: invoices.reduce((s, i) => s + i.totalCents, 0) }
              }}
            />
            <PostedInvoicesCard cycles={postedCycles} currentCycle={data.cycleDate} rowsFor={rowsFor} />
            <LeakageCard leakage={leakage} />
          </div>
          <div className="tl-stack">
            <DetailPanel
              key={detail?.charge.id ?? 'none'}
              detail={detail}
              ran={summary.ran}
              onApprove={approve}
              onEdit={(id, cents, reason) => { editAmount(id, cents, reason) }}
              onWaive={(id, reason, note) => waive(id, reason, note)}
              previewEdit={previewEdit}
              feeName={feeName}
            />
            <ReadyToPostCard summary={summary} cycleDate={data.cycleDate} nextCycle={nextCycle} />
          </div>
        </div>
      </main>
      <RatesDrawer
        open={ratesOpen}
        onClose={() => setRatesOpen(false)}
        db={data.db}
        cycleDate={data.cycleDate}
        onPublish={publishRate}
      />
    </div>
  )
}
