// The office manager's single-account view at /office/account/:accountId (merged app; the persona bar is the nav).
// Layout: a three-column workspace (pinned rail, flexing main column, 400px side column).
// The side column carries the action buttons, field history, open items, and the navy next-run card. Action
// drawers portal into the element with id "drawer-root"; Phase 4 wires "Change service", Phase 5 "Take a payment"
// (with allocation of unapplied payments) and "Issue credit"; Phase 6 the hold or suspension.
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AccountHeader, MoneyStrip } from '../components/AccountHeader';
import { AccountRail } from '../components/AccountRail';
import { ActionButtons, type AccountAction } from '../components/ActionButtons';
import { ChangeServiceDrawer, type ChangeServiceTarget } from '../components/ChangeServiceDrawer';
import { ContractCard } from '../components/ContractCard';
import { CreditDrawer } from '../components/CreditDrawer';
import { PaymentDrawer, type DrawerResult, type PaymentDrawerSource } from '../components/PaymentDrawer';
import { FieldHistory } from '../components/FieldHistory';
import { HoldDrawer } from '../components/HoldDrawer';
import { InvoicesPanel } from '../components/InvoicesPanel';
import { NextRunCard } from '../components/NextRunCard';
import { OpenItems } from '../components/OpenItems';
import { BillingSetupCard } from '../components/BillingSetupCard';
import { RolloffDetail } from '../components/RolloffDetail';
import { SiteCard } from '../components/SiteCard';
import { Toast, type ToastMessage } from '../components/Toast';
import { WO_KIND_LABEL, fmtDate } from '../components/format';
import type { ServiceChangePlan } from '../lib/types';
import { hasRolloff, useAccountView, type PortalHoldDraft } from '../selectors';
import { useStore } from '../../../store/useStore';
import { ReviewPanel } from '../../billing/components/ReviewPanel';

export const DEFAULT_ACCOUNT_ID = 'acct_res_maple';

type DrawerState =
  | { kind: 'changeService'; target: ChangeServiceTarget }
  | { kind: 'payment'; source?: PaymentDrawerSource }
  | { kind: 'credit'; invoiceId?: string }
  | { kind: 'hold'; initial?: PortalHoldDraft };

/** Actions with a working drawer; the rest keep their "later phase" title until their phase lands. */
const WIRED_ACTIONS: AccountAction[] = ['takePayment', 'changeService', 'issueCredit', 'holdOrSuspend'];

export function AccountPage() {
  // The router sends bare /account to the default account, so accountId is always present here.
  const accountId = useParams<{ accountId: string }>().accountId ?? DEFAULT_ACCOUNT_ID;
  const view = useAccountView(accountId);
  const [drawer, setDrawer] = useState<DrawerState | undefined>();
  const [toast, setToast] = useState<ToastMessage | undefined>();
  const toastSeq = useRef(0);

  // A drawer belongs to the account it was opened on; switching accounts closes it.
  useEffect(() => setDrawer(undefined), [accountId]);

  const openChangeService = (siteId: string, replaceItemId?: string) =>
    setDrawer({ kind: 'changeService', target: { accountId, siteId, replaceItemId } });

  const onAction = (action: AccountAction) => {
    if (action === 'changeService' && view?.sites[0]) {
      const first = view.sites[0];
      openChangeService(first.site.id, first.activeLines[0]?.item.id);
    }
    if (action === 'takePayment') setDrawer({ kind: 'payment' });
    if (action === 'issueCredit') setDrawer({ kind: 'credit' });
    if (action === 'holdOrSuspend') setDrawer({ kind: 'hold' });
  };

  const showToast = (title: string, detail?: string) => {
    toastSeq.current += 1;
    setToast({ key: toastSeq.current, title, detail });
  };

  const onMoneyDone = (result: DrawerResult) => {
    setDrawer(undefined);
    showToast(result.title, result.detail);
  };

  const onServiceChanged = (plan: ServiceChangePlan) => {
    setDrawer(undefined);
    const db = useStore.getState().db;
    const site = db.sites.find((x) => x.id === plan.workOrder.siteId);
    const catalogName = (id: string) => db.catalog.find((c) => c.id === id)?.name ?? id;
    const newName = catalogName(plan.newItem.catalogId);
    const oldName = plan.oldItem ? catalogName(plan.oldItem.catalogId) : undefined;
    toastSeq.current += 1;
    setToast({
      key: toastSeq.current,
      title: `Work order ${plan.workOrder.id} created`,
      detail: `${WO_KIND_LABEL[plan.workOrder.kind]} at ${site?.address ?? plan.workOrder.siteId} on ${fmtDate(plan.workOrder.scheduledFor)}. ${
        oldName ? `${oldName} ends and ${newName} starts` : `${newName} starts`
      } ${fmtDate(plan.newItem.effectiveFrom)}.`,
    });
  };

  return (
    <>
      <div className="workspace">
        <AccountRail activeId={accountId} />
        {!view ? (
          <main className="main-col">
            <div className="panel">
              <h1 className="page-title">Account not found</h1>
              <p className="text-ink-2">
                No account with id <code className="code">{accountId}</code>. Try <code className="code">{DEFAULT_ACCOUNT_ID}</code> or pick one from the rail.
              </p>
            </div>
          </main>
        ) : (
          <>
            <main className="main-col" aria-label="Account">
              <AccountHeader view={view} />
              <MoneyStrip view={view} />
              {/* The current billing cycle's charges on this account that need a decision (was the billing run's queue). */}
              <ReviewPanel key={accountId} accountId={accountId} />
              <InvoicesPanel
                view={view}
                onAllocate={(source) => setDrawer({ kind: 'payment', source })}
                onCredit={(invoiceId) => setDrawer({ kind: 'credit', invoiceId })}
              />
              {view.contract && <ContractCard contract={view.contract} />}
              {hasRolloff(view) && <RolloffDetail accountId={accountId} />}
              {view.sites.map((site) => (
                <SiteCard
                  key={site.site.id}
                  site={site}
                  onChangeItem={(itemId) => openChangeService(site.site.id, itemId)}
                  onAddService={() => openChangeService(site.site.id)}
                />
              ))}
            </main>
            <aside className="side-col" aria-label="Actions and activity">
              <ActionButtons view={view} onAction={onAction} wired={WIRED_ACTIONS} />
              <FieldHistory view={view} />
              <OpenItems view={view} onApplyHold={(initial) => setDrawer({ kind: 'hold', initial })} />
              <BillingSetupCard view={view} />
              <NextRunCard view={view} />
            </aside>
          </>
        )}
      </div>
      <div id="drawer-root" className="drawer-root" />
      {drawer?.kind === 'changeService' && view && (
        <ChangeServiceDrawer
          key={`${drawer.target.siteId}|${drawer.target.replaceItemId ?? 'add'}`}
          target={drawer.target}
          onClose={() => setDrawer(undefined)}
          onDone={onServiceChanged}
        />
      )}
      {drawer?.kind === 'payment' && view && (
        <PaymentDrawer
          key={drawer.source ? `${drawer.source.sourceType}|${drawer.source.sourceId}` : 'new'}
          accountId={accountId}
          initialSource={drawer.source}
          onClose={() => setDrawer(undefined)}
          onDone={onMoneyDone}
        />
      )}
      {drawer?.kind === 'credit' && view && (
        <CreditDrawer
          key={drawer.invoiceId ?? 'none'}
          accountId={accountId}
          initialInvoiceId={drawer.invoiceId}
          onClose={() => setDrawer(undefined)}
          onDone={onMoneyDone}
        />
      )}
      {drawer?.kind === 'hold' && view && (
        <HoldDrawer
          key={`${view.account.status}|${drawer.initial?.requestId ?? 'office'}`}
          accountId={accountId}
          initial={drawer.initial}
          onClose={() => setDrawer(undefined)}
          onDone={onMoneyDone}
        />
      )}
      <Toast toast={toast} onDismiss={() => setToast(undefined)} />
    </>
  );
}

export default AccountPage;
