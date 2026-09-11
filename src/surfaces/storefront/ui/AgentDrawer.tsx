// The "Agent view" drawer: how an intake agent would run this screen's branch, as a text-message thread
// built by runIntake from the same address match, rate card, and clock as the page. On screens with a
// price panel it quotes the panel's own Offer object. Customer bubbles sit right, agent bubbles left,
// handoffs are a full-width card. The "Rules used" footer lists what fired. Closes with the button or Escape.
//
// At 1280px and wider the drawer is non-modal: the page shifts left to make room (../index.tsx), so a buyer can
// change a configurator option and watch the transcript follow. Narrower, it overlays the page with a scrim.
// It starts below the persona bar (--sf-chrome-top, src/styles/surfaces/storefront.css) so the bar stays usable.
import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../../../store/useStore';
import { runIntake, type IntakeBranch, type Message } from '../lib/agent';
import { formatDay, formatTime, today } from '../lib/clock';
import { agentContextFor, OFFER_SCREENS } from './agentView';
import { cx, Pill, SecondaryButton, type PillTone } from './components';
import { uiActions, useOfferView, useScreen, useView } from './hooks';
import { AGENT_BUTTON_ID } from './TopBar';

export const AGENT_DRAWER_TITLE = 'How an intake agent would run this';
/** Page padding while the drawer is open at xl, equal to the drawer width. */
export const AGENT_DRAWER_WIDTH_CLASS = 'xl:pr-[460px]';

const BRANCH_PILL: Record<IntakeBranch, { tone: PillTone; label: string }> = {
  open: { tone: 'accent', label: 'Open zone, priced on chat' },
  boundary: { tone: 'warning', label: 'Boundary, a person confirms' },
  franchise: { tone: 'neutral', label: 'Franchise zone, no price' },
  commercial: { tone: 'accent', label: 'Business, a person prices it' },
  notServed: { tone: 'neutral', label: 'Outside service area' },
};

export function AgentDrawer() {
  const sfUi = useStore((s) => s.sfUi);
  const { screen, quoteId } = useScreen();
  const tables = useView();
  const { offer } = useOfferView();
  const panelRef = useRef<HTMLElement>(null);
  const close = uiActions.toggleAgent;

  const context = useMemo(
    () => agentContextFor({ ...sfUi, screen, statusQuoteId: quoteId }, tables),
    [sfUi, screen, quoteId, tables],
  );
  const run = useMemo(() => {
    if (!context.args) return undefined;
    const pageOffer = OFFER_SCREENS.has(screen) ? offer : undefined;
    return runIntake({ ...context.args, ...(pageOffer ? { offer: pageOffer } : {}) }, tables);
  }, [context, offer, tables, screen]);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.getElementById(AGENT_BUTTON_ID)?.focus();
    };
  }, [close]);

  const pill = run ? BRANCH_PILL[run.branch] : undefined;

  return (
    <>
      <div aria-hidden="true" className="fixed inset-x-0 bottom-0 top-[var(--sf-chrome-top)] z-20 bg-ink opacity-30 xl:hidden" onClick={() => close(false)} />
      <aside
        id="agent-drawer"
        ref={panelRef}
        tabIndex={-1}
        aria-labelledby="agent-drawer-title"
        className="fixed bottom-0 right-0 top-[var(--sf-chrome-top)] z-20 flex w-full flex-col border-l border-line bg-bg shadow-lg focus:outline-hidden sm:w-[460px]"
      >
        <header className="flex flex-col gap-3 border-b border-line bg-surface px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <h2 id="agent-drawer-title" className="text-heading font-bold text-ink text-balance">
              {AGENT_DRAWER_TITLE}
            </h2>
            <SecondaryButton size="compact" onClick={() => close(false)} aria-label="Close the agent view">
              Close
            </SecondaryButton>
          </div>
          <p className="text-small text-ink-muted">
            Written from the same address match, rate card, and calendar as this page. Change an option and the thread
            follows.
          </p>
          {pill ? (
            <div>
              <Pill tone={pill.tone}>{pill.label}</Pill>
            </div>
          ) : null}
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4" data-testid="agent-thread">
          {context.note ? <p className="mb-3 text-small text-ink-muted">{context.note}</p> : null}
          {run ? (
            <ol className="flex flex-col gap-3" aria-label="Text message transcript">
              <li className="self-center text-small text-ink-muted">Text messages, {formatDay(today())}</li>
              {run.messages.map((m, i) => (
                <Bubble key={i} message={m} />
              ))}
            </ol>
          ) : (
            <p className="rounded-lg border border-line bg-surface p-4 text-body text-ink-muted">{context.empty}</p>
          )}
        </div>

        <footer className="max-h-[36%] overflow-y-auto border-t border-line bg-surface px-5 py-3" aria-label="Rules used">
          <h3 className="text-small font-semibold text-ink">Rules used</h3>
          {run ? (
            <dl className="mt-2 grid grid-cols-[104px_minmax(0,1fr)] items-start gap-x-3 gap-y-1" data-testid="agent-rules">
              {run.rules.map((r, i) => (
                <div key={i} className="contents">
                  <dt className="py-[2px] text-small text-ink-muted">{r.rule}</dt>
                  <dd className="min-w-0 justify-self-start rounded bg-gray-100 px-2 py-[2px] text-small text-ink [overflow-wrap:anywhere]">
                    {r.detail}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-1 text-small text-ink-muted">No rules have run yet.</p>
          )}
        </footer>
      </aside>
    </>
  );
}

function Bubble({ message }: { message: Message }) {
  const time = formatTime(message.at);
  if (message.from === 'handoff') {
    return (
      <li className="rounded-lg border border-warning bg-warning-soft p-4" data-from="handoff">
        <p className="flex items-center gap-2 text-small font-semibold text-ink">
          <span aria-hidden="true" className="block h-2 w-2 rounded-full bg-warning" />
          Handoff to a person
        </p>
        <p className="mt-1 text-body text-ink">{message.text}</p>
        <p className="mt-1 text-small text-ink-muted">{time}</p>
      </li>
    );
  }
  const customer = message.from === 'customer';
  return (
    <li className={cx('flex flex-col gap-1', customer ? 'items-end' : 'items-start')} data-from={message.from}>
      <p
        className={cx(
          'max-w-[85%] rounded-lg px-4 py-2 text-body',
          customer ? 'rounded-br-sm bg-accent text-white' : 'rounded-bl-sm border border-line bg-surface text-ink',
        )}
      >
        {message.text}
      </p>
      <span className="text-small text-ink-muted">
        {customer ? 'Customer' : 'Agent'}, {time}
      </span>
    </li>
  );
}
