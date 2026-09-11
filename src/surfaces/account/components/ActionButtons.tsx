// The four office actions. Each opens its right-hand drawer once its phase wires it (Phase 4: Change service;
// Phase 5: payment and credit; Phase 6: hold or suspend). Unwired buttons stay live but say so in their title.
import type { AccountView } from '../selectors';

export type AccountAction = 'takePayment' | 'changeService' | 'issueCredit' | 'holdOrSuspend';

export function ActionButtons({
  view,
  onAction,
  wired = [],
}: {
  view: AccountView;
  onAction?: (action: AccountAction) => void;
  /** Actions whose drawer exists; the others keep the "later phase" title. */
  wired?: AccountAction[];
}) {
  const status = view.account.status;
  const holdLabel = status === 'suspended' ? 'Reinstate' : status === 'hold' ? 'Resume' : 'Hold or suspend';
  const fire = (action: AccountAction) => () => onAction?.(action);
  const title = (action: AccountAction) => (onAction && wired.includes(action) ? undefined : 'Opens its drawer in a later phase');
  return (
    <div className="actions" role="group" aria-label="Account actions">
      <button type="button" className="btn btn-primary" onClick={fire('takePayment')} title={title('takePayment')}>Take a payment</button>
      <button type="button" className="btn btn-secondary" onClick={fire('changeService')} title={title('changeService')} aria-haspopup="dialog">Change service</button>
      <button type="button" className="btn btn-secondary" onClick={fire('issueCredit')} title={title('issueCredit')}>Issue credit</button>
      <button type="button" className="btn btn-secondary" onClick={fire('holdOrSuspend')} title={title('holdOrSuspend')}>{holdLabel}</button>
    </div>
  );
}
