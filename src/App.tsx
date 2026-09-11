import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './shell/Layout'
import { NotFound } from './shell/NotFound'
import AccountSurface, { BillingGroupsSurface } from './surfaces/account'
import BillingSurface from './surfaces/billing'
import PortalSurface from './surfaces/portal'
import PricingSurface from './surfaces/pricing'
import StorefrontSurface from './surfaces/storefront'
import StorefrontOfficeSurface from './surfaces/storefront/office'

/** React Router 7 behaviour opted into now, which also silences the v6 future-flag warnings. */
export const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const

/**
 * Routes by persona (DECISIONS.md entry 4). Each surface mounts at a splat so it can own sub-routes in its own
 * src/surfaces/<name>/ folder without editing this file.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/office/account" replace />} />
        <Route path="owner" element={<Navigate to="/owner/pricing" replace />} />
        <Route path="owner/pricing/*" element={<PricingSurface />} />
        <Route path="office" element={<Navigate to="/office/account" replace />} />
        <Route path="office/account" element={<AccountSurface />} />
        <Route path="office/account/:accountId/*" element={<AccountSurface />} />
        <Route path="office/groups" element={<BillingGroupsSurface />} />
        <Route path="office/payments/*" element={<BillingSurface />} />
        {/* The billing run screen is gone (its cycle moved to the persona bar and Accounts); old links land on Payments. */}
        <Route path="office/billing/*" element={<Navigate to="/office/payments" replace />} />
        <Route path="office/approvals/*" element={<StorefrontOfficeSurface />} />
        <Route path="customer" element={<Navigate to="/customer/store" replace />} />
        <Route path="customer/store/*" element={<StorefrontSurface />} />
        <Route path="customer/portal/*" element={<PortalSurface />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL} future={ROUTER_FUTURE}>
      <AppRoutes />
    </BrowserRouter>
  )
}
