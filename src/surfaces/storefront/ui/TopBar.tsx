// The storefront's own header, drawn as the trashlab.com indigo band (Paper ES-0): brand ground, 80px tall, content in
// the 1200px container. White logo tile with a cyan inner square, the hauler name, and the Residential / Business
// switch. The persona bar above it owns cross-surface navigation; everything here is part of the storefront page itself. At 390px the nav wraps under the name and the bar grows instead of scrolling sideways.
import { Container, FOCUS_RING_ON_BRAND, Switch, cx } from './components';
import { useScreen, useStartOver, useUi, useView } from './hooks';

/** The drawer hands focus back to this button when it closes. */
export const AGENT_BUTTON_ID = 'agent-view-button';

const NAV_TEXT = 'text-label font-semibold text-on-brand-80';

export function TopBar() {
  const haulerName = useView().hauler.name;
  const business = useUi((s) => s.business);
  const setBusiness = useUi((s) => s.setBusiness);
  const startOver = useStartOver();
  // ER-0: on the landing the header sits inside the indigo hero band, so a 1px white-12% hairline across the
  // 1200px container separates it from the hero. ES-0 (every other screen) has no hairline.
  const onLanding = useScreen().screen === 'landing';

  return (
    <header className="bg-accent">
      <Container
        className={cx(
          'flex min-h-header flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3 md:h-header md:py-0',
          onLanding && 'border-b border-on-brand-12',
        )}
      >
        <button
          type="button"
          onClick={startOver}
          className={cx('flex items-center gap-3 rounded-sm', FOCUS_RING_ON_BRAND)}
          aria-label={`${haulerName}, back to the start`}
        >
          <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-sm bg-white">
            <span className="block h-3 w-3 rounded-[3px] bg-cyan" />
          </span>
          <span className="text-eyebrow font-bold text-on-brand">{haulerName}</span>
        </button>
        <nav className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 sm:w-auto sm:justify-start sm:gap-x-6" aria-label="Storefront">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setBusiness(false)} className={cx('rounded-sm', NAV_TEXT, !business && 'text-on-brand', FOCUS_RING_ON_BRAND)}>
              Residential
            </button>
            <Switch onBrand checked={business} onChange={setBusiness} label="Business" />
            <button type="button" onClick={() => setBusiness(true)} className={cx('rounded-sm', NAV_TEXT, business && 'text-on-brand', FOCUS_RING_ON_BRAND)}>
              Business
            </button>
          </div>
        </nav>
      </Container>
    </header>
  );
}
