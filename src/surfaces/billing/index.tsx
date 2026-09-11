import { Payments } from './pages/Payments'

/**
 * Billing surface, mounted at /office/payments inside `surface-billing`, which scopes billing's pattern classes and
 * --rt-* values. The billing cycle itself has no screen of its own: the Accounts page runs it (CycleButton beside its
 * title) and carries its bulk approve and posting (CycleBanner), and each account's page its per-charge decisions (ReviewPanel).
 */
export default function BillingSurface() {
  return (
    <div className="surface-billing">
      <Payments />
    </div>
  )
}
