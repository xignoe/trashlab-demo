import { useUi } from './store/ui';
import { BoundaryIntakeScreen } from './ui/BoundaryIntake';
import { CheckoutScreen } from './ui/Checkout';
import { CommercialScreen } from './ui/Commercial';
import { FranchiseScreen } from './ui/Franchise';
import { useHashRoute } from './ui/hashRoute';
import { HeldStatusScreen } from './ui/HeldStatus';
import { Landing } from './ui/Landing';
import { NotServed } from './ui/NotServed';
import { OfferScreen } from './ui/Offer';
import { OfficeScreen } from './ui/Office';
import { SuccessScreen } from './ui/Success';
import { AgentDrawer, AGENT_DRAWER_WIDTH_CLASS } from './ui/AgentDrawer';
import { cx } from './ui/components';
import { TopBar } from './ui/TopBar';

/** Routing is the `screen` value in the ui store; no router library. #office and #status/<id> map onto it. */
function Screen() {
  const screen = useUi((s) => s.screen);
  switch (screen) {
    case 'landing':
      return <Landing />;
    case 'notServed':
      return <NotServed />;
    case 'offer':
    case 'boundary':
      return <OfferScreen />;
    case 'checkout':
      return <CheckoutScreen />;
    case 'success':
      return <SuccessScreen />;
    case 'franchise':
      return <FranchiseScreen />;
    case 'boundaryIntake':
      return <BoundaryIntakeScreen />;
    case 'held':
      return <HeldStatusScreen />;
    case 'commercial':
      return <CommercialScreen />;
    case 'office':
    case 'store':
      return <OfficeScreen />;
  }
}

export default function App() {
  const agentOpen = useUi((s) => s.agentOpen);
  useHashRoute();
  return (
    <>
      {/* At 1280px and wider the page makes room for the drawer, so the price panel and the transcript sit side by side. */}
      <div className={cx('min-h-screen bg-bg text-ink', agentOpen && AGENT_DRAWER_WIDTH_CLASS)}>
        <TopBar />
        <Screen />
      </div>
      {agentOpen ? <AgentDrawer /> : null}
    </>
  );
}
