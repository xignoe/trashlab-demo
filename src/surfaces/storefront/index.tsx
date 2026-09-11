import { useStore } from '../../store/useStore';
import { StorefrontRoutes } from './routes';
import { AgentDrawer, AGENT_DRAWER_WIDTH_CLASS } from './ui/AgentDrawer';
import { cx } from './ui/components';
import { TopBar } from './ui/TopBar';

/**
 * Storefront surface (Customer persona), ported from storefront/src (CHECKLIST.md 2D.1 to 2D.5). Everything mounts
 * inside `surface-storefront`, where src/styles/surfaces/storefront.css sets trashlab.com's values (addendum M) for the
 * theme bridge, so they never reach another surface. The storefront header (TopBar) sits under the persona bar;
 * the screens are nested routes under /customer/store (./routes.tsx). The agent drawer is inside the wrapper too.
 */
export default function StorefrontSurface() {
  const agentOpen = useStore((s) => s.sfUi.agentOpen);
  return (
    <div className="surface-storefront">
      {/* At 1280px and wider the page makes room for the drawer, so the price panel and the transcript sit side by side. */}
      <div className={cx('sf-page bg-bg text-ink', agentOpen && AGENT_DRAWER_WIDTH_CLASS)}>
        <TopBar />
        <StorefrontRoutes />
      </div>
      {agentOpen ? <AgentDrawer /> : null}
    </div>
  );
}
