// Office approvals under the Office persona (box 3.7d, storefront request R7). App.tsx mounts this at
// office/approvals/*. It is the storefront's own Office screen (held signups first, approve or decline), rendered inside .surface-storefront so it keeps the storefront's styles, without the buyer's header
// or the agent drawer, which belong to the customer's page. /customer/store/office redirects here (./routes.tsx).
import { Navigate, Route, Routes } from 'react-router-dom';
import { OFFICE_APPROVALS_BASE } from './lib/paths';
import { OfficeScreen } from './ui/Office';

export default function StorefrontOfficeSurface() {
  return (
    <div className="surface-storefront">
      <div className="sf-page bg-bg text-ink">
        <Routes>
          <Route index element={<OfficeScreen />} />
          <Route path="*" element={<Navigate to={OFFICE_APPROVALS_BASE} replace />} />
        </Routes>
      </div>
    </div>
  );
}
