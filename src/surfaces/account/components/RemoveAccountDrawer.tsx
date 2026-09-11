// "Remove account" drawer. One decision made for the office by the data (DECISIONS.md, delete if clean else close):
// an account that carries no charge, invoice, payment, credit memo, service event, scale ticket, or contract is a
// typo or a duplicate, and Delete removes its own rows; any other account is closed, which ends its service lines,
// raises one recovery work order, and suspends it, leaving every financial record in place. The preview is
// planRemoveAccount on the live state, so it says exactly what the button will do.
import { useMemo, useState } from 'react';
import { useStore } from '../../../store/useStore';
import { today } from '../lib/clock';
import { planRemoveAccount } from '../lib/lifecycle';
import { useAccountData } from '../selectors';
import { Drawer } from './Drawer';
import { fmtDate, money, plural } from './format';

export interface RemoveAccountResult {
  deleted: boolean;
  title: string;
  detail: string;
}

export function RemoveAccountDrawer({
  accountId,
  onClose,
  onDone,
}: {
  accountId: string;
  onClose: () => void;
  onDone: (result: RemoveAccountResult) => void;
}) {
  const { db } = useAccountData();
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [confirmed, setConfirmed] = useState(false);

  const plan = useMemo(() => {
    try {
      return planRemoveAccount(db, accountId, { effectiveFrom });
    } catch {
      return undefined;
    }
  }, [db, accountId, effectiveFrom]);

  if (!plan) {
    return (
      <Drawer title="Remove account" onClose={onClose}>
        <p className="change-note muted">Account {accountId} no longer exists.</p>
      </Drawer>
    );
  }

  const { canDelete, blockers, closes, deletes } = plan;
  const rowCount = 1 + deletes.siteIds.length + deletes.itemIds.length + deletes.containerIds.length + deletes.workOrderIds.length + deletes.requestIds.length + deletes.partyIds.length;

  const run = () => {
    try {
      if (canDelete) {
        useStore.getState().deleteAccount(accountId);
        onDone({
          deleted: true,
          title: `${plan.name} deleted`,
          detail: `${plural(rowCount, 'row')} removed. The account carried no invoice, payment, or charge, so nothing financial was deleted.`,
        });
      } else {
        useStore.getState().closeAccount(accountId, { effectiveFrom, note: note.trim() || undefined });
        onDone({
          deleted: false,
          title: `${plan.name} closed`,
          detail: `${plural(closes.items.length, 'service line')} ended ${fmtDate(effectiveFrom)}${
            closes.recovery ? `, recovery work order ${closes.recovery.id} raised` : ''
          }. Invoices, payments, and credits are unchanged.`,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Drawer
      title={canDelete ? 'Delete account' : 'Close account'}
      eyebrow={`Office · ${plan.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-tertiary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-danger" onClick={run} disabled={!confirmed}>
            {canDelete ? 'Delete account' : 'Close account'}
          </button>
        </>
      }
    >
      <div className="drawer-form">
        {error && <p className="form-error" role="alert">{error}</p>}

        {canDelete ? (
          <>
            <p className="change-note">
              <span className="status-text">{plan.name}</span> (<code className="code">{accountId}</code>) carries no invoice, charge, payment, credit memo, service event, scale ticket, or
              contract, so it can be deleted outright. This cannot be undone.
            </p>
            <div className="inset">
              <p className="change-note">Deleting removes {plural(rowCount, 'row')}:</p>
              <ul className="change-note" style={{ margin: 0, paddingLeft: 18 }}>
                <li>the account and {plural(deletes.siteIds.length, 'site')}</li>
                <li>{plural(deletes.itemIds.length, 'service line')} and {plural(deletes.containerIds.length, 'container')}</li>
                <li>{plural(deletes.workOrderIds.length, 'work order')} and {plural(deletes.requestIds.length, 'request')}</li>
                {deletes.partyIds.length > 0 && <li>the payer record, which nothing else names</li>}
              </ul>
            </div>
          </>
        ) : (
          <>
            <p className="change-note">
              <span className="status-text">{plan.name}</span> (<code className="code">{accountId}</code>) carries {blockers.join(', ')}, so it cannot be deleted. Closing keeps every record and
              stops the service.
            </p>
            <div className="field-row field-row-even">
              <div className="field">
                <label className="eyebrow" htmlFor="close-date">Service ends</label>
                <input id="close-date" className="input input-mono" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
              </div>
              <div className="field">
                <label className="eyebrow" htmlFor="close-note">Reason</label>
                <input id="close-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Moved away" autoComplete="off" />
              </div>
            </div>
            <div className="inset">
              <p className="change-note">Closing will:</p>
              <ul className="change-note" style={{ margin: 0, paddingLeft: 18 }}>
                <li>end {plural(closes.items.length, 'service line')} on {fmtDate(effectiveFrom)}</li>
                {closes.recovery
                  ? <li>raise recovery work order {closes.recovery.id} for {plural(closes.recoverContainers.length, 'container')} on {fmtDate(closes.recovery.scheduledFor)}</li>
                  : <li>leave no container to collect</li>}
                <li>suspend the account and switch autopay off, so no further charge is generated</li>
                {closes.openRequests.length > 0 && <li className="danger-text">leave {plural(closes.openRequests.length, 'open request')} on the account, which still needs an answer</li>}
                <li>keep every invoice, payment, credit, and waive</li>
              </ul>
            </div>
            {plan.openBalanceCents !== 0 && (
              <p className="change-note">
                <span className={`mono${plan.pastDueCents > 0 ? ' danger-text' : ''}`}>{money(plan.openBalanceCents)}</span> is still open
                {plan.pastDueCents > 0 ? ` (${money(plan.pastDueCents)} past due)` : ''}. Closing does not write it off; collect or issue a credit first if that is what you mean to do.
              </p>
            )}
            <p className="change-note meta">Reinstate from the account&apos;s own page brings the account back; the ended lines stay ended and are re-added with Change service.</p>
          </>
        )}

        <label className="cluster" style={{ gap: 8 }}>
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-autofocus />
          <span className="meta">{canDelete ? `Yes, delete ${plan.name} and its ${plural(rowCount - 1, 'row')}` : `Yes, close ${plan.name}`}</span>
        </label>
      </div>
    </Drawer>
  );
}
