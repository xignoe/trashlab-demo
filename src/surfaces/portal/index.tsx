import { Navigate, Route, Routes } from 'react-router-dom'
import { TopBar } from './components/TopBar'
import { SiteSwitcher } from './components/SiteSwitcher'
import { PORTAL_BASE, Tabs } from './components/Tabs'
import { Overview } from './screens/Overview'
import { Billing } from './screens/Billing'
import { Requests } from './screens/Requests'

/**
 * Customer portal (Customer persona), ported from portal/src (CHECKLIST.md 2C.1 to 2C.5). Mounted by App.tsx at
 * `customer/portal/*` inside the persona shell. Everything renders inside `.surface-portal`, which scopes the
 * portal's --rt-* values and pattern classes (src/styles/surfaces/portal.css).
 *
 * The sections are sub-routes: /customer/portal (Overview), /customer/portal/billing, /customer/portal/requests.
 * The signed-in account and site live in the portal slice, so they survive a section change and a reload of the
 * route, but not Reset seed.
 */
export default function PortalSurface() {
  return (
    <div className="surface-portal">
      <TopBar />
      <div className="mx-auto p-6 flex gap-6" style={{ maxWidth: 'var(--content-max)' }}>
        <aside className="w-40 shrink-0">
          <Tabs />
        </aside>
        <main className="flex-1 min-w-0">
          <SiteSwitcher />
          <Routes>
            <Route index element={<Overview />} />
            <Route path="billing" element={<Billing />} />
            <Route path="requests" element={<Requests />} />
            <Route path="*" element={<Navigate to={PORTAL_BASE} replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
