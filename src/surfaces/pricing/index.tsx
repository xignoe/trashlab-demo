import { Navigate, Route, Routes } from 'react-router-dom'
import Ratebook from './pages/Ratebook'

/**
 * Pricing surface (Owner persona), ported from pricing/src: the Ratebook at /owner/pricing. Mounted at the
 * owner/pricing/* splat (DECISIONS.md entry 20); any other sub-path, including the removed /owner/pricing/quote
 * (entry 66), lands back on the Ratebook. Everything renders inside `surface-pricing`, which scopes pricing's --rt-*
 * values and aliases (src/styles/surfaces/pricing.css).
 */
export default function PricingSurface() {
  return (
    <div className="surface-pricing">
      <main className="px-10 py-8">
        <Routes>
          <Route index element={<Ratebook />} />
          <Route path="*" element={<Navigate to="/owner/pricing" replace />} />
        </Routes>
      </main>
    </div>
  )
}
