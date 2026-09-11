// The storefront's screens as nested routes. App.tsx mounts the surface at customer/store/*, so these paths are
// relative to /customer/store (lib/paths.ts holds the same table for navigation). The prototype routed with one
// `screen` value in its ui store plus two hash links (#office, #status/<id>); each is a real path here.
import { Navigate, Route, Routes } from 'react-router-dom';
import { OLD_STORE_SEGMENT, pathFor, SCREEN_SEGMENT, STATUS_SEGMENT, STOREFRONT_BASE } from './lib/paths';
import { BoundaryIntakeScreen } from './ui/BoundaryIntake';
import { CheckoutScreen } from './ui/Checkout';
import { CommercialScreen } from './ui/Commercial';
import { FranchiseScreen } from './ui/Franchise';
import { HeldStatusScreen } from './ui/HeldStatus';
import { Landing } from './ui/Landing';
import { NotServed } from './ui/NotServed';
import { OfferScreen } from './ui/Offer';
import { SuccessScreen } from './ui/Success';

export function StorefrontRoutes() {
  return (
    <Routes>
      <Route index element={<Landing />} />
      <Route path={SCREEN_SEGMENT.offer} element={<OfferScreen />} />
      <Route path={SCREEN_SEGMENT.boundary} element={<OfferScreen />} />
      <Route path={SCREEN_SEGMENT.boundaryIntake} element={<BoundaryIntakeScreen />} />
      <Route path={SCREEN_SEGMENT.checkout} element={<CheckoutScreen />} />
      <Route path={SCREEN_SEGMENT.success} element={<SuccessScreen />} />
      <Route path={SCREEN_SEGMENT.franchise} element={<FranchiseScreen />} />
      <Route path={SCREEN_SEGMENT.notServed} element={<NotServed />} />
      <Route path={`${STATUS_SEGMENT}/:quoteId`} element={<HeldStatusScreen />} />
      <Route path={SCREEN_SEGMENT.commercial} element={<CommercialScreen />} />
      {/* Office approvals moved to the Office persona (box 3.7d); the old storefront links land there. */}
      <Route path={SCREEN_SEGMENT.office} element={<Navigate to={pathFor('office')} replace />} />
      <Route path={OLD_STORE_SEGMENT} element={<Navigate to={pathFor('office')} replace />} />
      <Route path="*" element={<Navigate to={STOREFRONT_BASE} replace />} />
    </Routes>
  );
}
