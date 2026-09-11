import { useCallback } from 'react'
import { useStore } from '../../../store/useStore'
import { postedInvoices } from '../../../store/selectors'
import { LeakageCard } from '../components/SideCards'
import { PostedInvoicesCard } from '../components/PostedInvoices'
import { PaymentsTab } from '../components/PaymentsTab'
import { useBillingData } from '../components/useBillingData'

/**
 * Payments at /office/payments: cash in and where it went (artboard XV-0), then the posted invoices, where an open
 * invoice on an account with a card on file can be charged (box 4.5a), and the leakage card for what was waived.
 * Running the cycle lives beside the Accounts title and deciding its charges on each account's page, so there is no
 * separate billing run screen.
 */
export function Payments() {
  const { data, leakage, postedCycles } = useBillingData()
  const chargeCardOnFile = useStore(s => s.chargeCardOnFile)
  const accounts = data.db.accounts
  const cardOnFile = useCallback((accountId: string) => accounts.find(a => a.id === accountId)?.paymentMethodOnFile === 'card', [accounts])
  const rowsFor = useCallback((cycle: string) => postedInvoices(data, cycle), [data])

  return (
    <main className="tl-page">
      <PaymentsTab />
      <div className="tl-stack tl-payments-more">
        <PostedInvoicesCard cycles={postedCycles} currentCycle={data.cycleDate} rowsFor={rowsFor} cardOnFile={cardOnFile} onChargeCard={chargeCardOnFile} />
        <LeakageCard leakage={leakage} />
      </div>
    </main>
  )
}
