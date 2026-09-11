import { useParams } from 'react-router-dom'
import AccountPage from './pages/AccountPage'
import AccountsPage from './pages/AccountsPage'
import BillingGroupsPage from './pages/BillingGroupsPage'

/**
 * Account surface: the office manager's accounts table at /office/account, and one account's page (account/src,
 * ported in Phase 2, boxes 2A.1 to 2A.5) at /office/account/:accountId. Mounted inside `surface-account`, which scopes
 * the account's --rt-* values, its tokens, and its pattern classes (src/styles/surfaces/account.css).
 */
export default function AccountSurface() {
  const { accountId } = useParams<{ accountId: string }>()
  return (
    <div className="surface-account">
      {accountId ? <AccountPage /> : <AccountsPage />}
    </div>
  )
}

/** Billing groups at /office/groups (addendum P), inside the same surface wrapper as the accounts pages. */
export function BillingGroupsSurface() {
  return (
    <div className="surface-account">
      <BillingGroupsPage />
    </div>
  )
}
