// Autopay toggle plus the saved method panel. Turning autopay on needs a saved method; if there is none the
// method sheet opens and autopay turns on once a token is saved.

import { usePortal } from '../../store';
import { nextDueOpenInvoice } from '../../lib/selectors';
import { nextCycleStart } from '../../lib/engine';
import { today, formatDate } from '../../lib/clock';

export function AutopayPanel({ accountId, onSaveMethod }: { accountId: string; onSaveMethod: (thenAutopay: boolean) => void }) {
  const state = usePortal();
  const account = state.accounts.find((a) => a.id === accountId)!;
  const saved = state.paymentMethods.find((m) => m.accountId === accountId);
  const nextDue = nextDueOpenInvoice(state, accountId);
  const nextIssue = nextCycleStart(account, today(), state.billingGroups);

  const toggle = () => {
    if (account.autopay) {
      state.setAutopay(accountId, false);
      return;
    }
    if (!saved) {
      onSaveMethod(true);
      return;
    }
    state.setAutopay(accountId, true);
  };

  return (
    <div className="tl-panel flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="tl-label" style={{ margin: 0 }}>Autopay</div>
        <button
          type="button"
          role="switch"
          aria-checked={account.autopay}
          aria-label="Autopay"
          onClick={toggle}
          className="relative shrink-0 rounded-full"
          style={{
            width: 44, height: 24, border: 'none', cursor: 'pointer',
            background: account.autopay ? 'var(--color-accent)' : 'var(--color-border-strong)', transition: 'background 120ms',
          }}
        >
          <span
            className="absolute rounded-full bg-surface"
            style={{ width: 18, height: 18, top: 3, left: account.autopay ? 23 : 3, transition: 'left 120ms', boxShadow: 'var(--shadow-panel)' }}
          />
        </button>
      </div>
      {account.autopay ? (
        <>
          <div className="text-sm font-medium" style={{ color: 'var(--color-ok)' }}>Autopay on: we charge your saved method on each due date</div>
          {saved && <div className="text-xs text-ink-3">{saved.brand} ending in {saved.last4}</div>}
        </>
      ) : (
        <>
          <div className="text-sm font-medium">Autopay off</div>
          <div className="text-xs text-ink-3">
            {nextDue
              ? `Next due date you must pay manually: ${formatDate(nextDue.dueAt)} (${nextDue.number})`
              : `Nothing is open. Your next invoice is issued ${formatDate(nextIssue)}; pay it manually by its due date.`}
          </div>
          {!saved && <div className="text-xs text-ink-3">Turning autopay on will ask you to save a method first.</div>}
        </>
      )}
    </div>
  );
}

export function SavedMethodPanel({ accountId, onReplace }: { accountId: string; onReplace: () => void }) {
  const saved = usePortal((s) => s.paymentMethods.find((m) => m.accountId === accountId));
  return (
    <div className="tl-panel flex flex-col gap-2">
      <div className="tl-label" style={{ margin: 0 }}>Method on file</div>
      {saved ? (
        <>
          <div className="text-sm font-medium">
            {saved.kind === 'card' ? 'Card' : 'Bank account (ACH)'}, {saved.brand} ending in {saved.last4}
          </div>
          <div className="text-xs text-ink-3">
            Saved {formatDate(saved.savedAt)}. Token <span className="font-mono">{saved.tokenId}</span>
          </div>
        </>
      ) : (
        <div className="text-sm text-ink-3">No method saved.</div>
      )}
      <div>
        <button type="button" className="tl-button tl-button--secondary" style={{ height: 32 }} onClick={onReplace}>
          {saved ? 'Replace method' : 'Save a method'}
        </button>
      </div>
    </div>
  );
}
