// Billing: invoices newest first, one invoice open in detail, the provenance drawer, pay now, autopay,
// the saved method, and payment history. Every money value goes through money().

import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { nextCycleStart } from '../store/engine';
import { accountBalance, invoiceOpenBalance, invoicePaid, invoiceStatus, invoicesForAccount } from '../store/selectors';
import { TODAY, formatDate } from '../store/clock';
import { money } from '../lib/money';
import { AccountStatusPill } from '../components/StatusPill';
import { InvoiceStatusPill } from './billing/InvoiceStatusPill';
import { InvoiceDetail } from './billing/InvoiceDetail';
import { WhyThisChargeDrawer } from './billing/WhyThisChargeDrawer';
import { PaymentSheet } from './billing/PaymentSheet';
import { MethodSheet } from './billing/MethodSheet';
import { AutopayPanel, SavedMethodPanel } from './billing/AutopayPanel';
import { PaymentHistory } from './billing/PaymentHistory';
import type { Charge, Invoice } from '../types';

type Overlay =
  | { kind: 'none' }
  | { kind: 'why'; charge: Charge; invoice: Invoice }
  | { kind: 'pay'; invoiceId: string }
  | { kind: 'method'; thenAutopay: boolean };

export function Billing() {
  const state = useStore();
  const { accountId } = state.session;
  const account = state.accounts.find((a) => a.id === accountId)!;
  const party = state.parties.find((p) => p.id === account.payerPartyId);
  const invoices = invoicesForAccount(state, accountId);
  const balance = accountBalance(state, accountId);

  // Default to the newest invoice with something open, else the newest invoice.
  const defaultId = (invoices.find((i) => invoiceOpenBalance(state, i.id) > 0) ?? invoices[0])?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(defaultId);
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'none' });

  // Switching accounts must reselect and drop any open sheet.
  useEffect(() => {
    setSelectedId(defaultId);
    setOverlay({ kind: 'none' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const selected = invoices.find((i) => i.id === selectedId) ?? null;
  const close = () => setOverlay({ kind: 'none' });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-ink-2 text-sm">{party?.name}, {account.cycle === 'net30' ? 'net 30' : account.cycle} billing, {account.billedInAdvance ? 'in advance' : 'in arrears'}</p>
      </div>

      <section className="grid gap-3" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        <div className="tl-panel">
          <div className="tl-label">Balance due</div>
          <div className="text-xl font-semibold tl-money" style={{ color: balance > 0 ? 'var(--color-danger)' : 'var(--color-ink)' }}>{money(balance)}</div>
          <div className="text-xs text-ink-3 mt-1">{balance > 0 ? `Across ${invoices.filter((i) => invoiceOpenBalance(state, i.id) > 0).length} open invoice(s)` : 'Nothing due'}</div>
        </div>
        <div className="tl-panel">
          <div className="tl-label">Account status</div>
          <AccountStatusPill status={account.status} />
          {account.status === 'pastDue' && <div className="text-xs text-ink-3 mt-2">Paying every past due invoice restores active status.</div>}
        </div>
        <AutopayPanel accountId={accountId} onSaveMethod={(thenAutopay) => setOverlay({ kind: 'method', thenAutopay })} />
        <SavedMethodPanel accountId={accountId} onReplace={() => setOverlay({ kind: 'method', thenAutopay: false })} />
      </section>

      <section className="tl-panel">
        <h2 className="text-lg font-medium mb-3">Invoices</h2>
        {invoices.length === 0 ? (
          <p className="text-sm text-ink-3" data-testid="no-invoices">
            No invoices yet. Your first invoice is issued {formatDate(nextCycleStart(account, TODAY))}; it will appear here with a Pay now button.
          </p>
        ) : (
        <table className="tl-table">
          <thead>
            <tr>
              <th>Number</th>
              <th>Issued</th>
              <th>Due</th>
              <th className="num">Total</th>
              <th className="num">Paid</th>
              <th className="num">Open balance</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => {
              const open = invoiceOpenBalance(state, inv.id);
              const status = invoiceStatus(state, inv.id, TODAY);
              const isSelected = inv.id === selectedId;
              return (
                <tr
                  key={inv.id}
                  onClick={() => setSelectedId(inv.id)}
                  style={{ cursor: 'pointer', background: isSelected ? 'var(--color-accent-soft)' : undefined }}
                  aria-selected={isSelected}
                >
                  <td className="font-medium">{inv.number}</td>
                  <td className="whitespace-nowrap">{formatDate(inv.issuedAt)}</td>
                  <td className="whitespace-nowrap">{formatDate(inv.dueAt)}</td>
                  <td className="num tl-money">{money(inv.totalCents)}</td>
                  <td className="num tl-money">{money(invoicePaid(state, inv.id))}</td>
                  <td className="num tl-money font-medium" style={{ color: open > 0 ? 'var(--color-danger)' : undefined }}>{money(open)}</td>
                  <td><InvoiceStatusPill status={status} /></td>
                  <td className="num whitespace-nowrap">
                    <button type="button" className="tl-button tl-button--ghost" style={{ height: 28, padding: '0 8px' }} onClick={(e) => { e.stopPropagation(); setSelectedId(inv.id); }}>
                      {isSelected ? 'Viewing' : 'View'}
                    </button>
                    {open > 0 && (
                      <button type="button" className="tl-button ml-1" style={{ height: 28, padding: '0 10px' }} onClick={(e) => { e.stopPropagation(); setOverlay({ kind: 'pay', invoiceId: inv.id }); }}>
                        Pay now
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        )}
      </section>

      {selected && (
        <InvoiceDetail
          invoice={selected}
          onWhy={(charge) => setOverlay({ kind: 'why', charge, invoice: selected })}
          onPay={(inv) => setOverlay({ kind: 'pay', invoiceId: inv.id })}
        />
      )}

      <PaymentHistory accountId={accountId} />

      {overlay.kind === 'why' && <WhyThisChargeDrawer charge={overlay.charge} invoice={overlay.invoice} onClose={close} />}
      {overlay.kind === 'pay' && (() => {
        const inv = invoices.find((i) => i.id === overlay.invoiceId);
        return inv ? <PaymentSheet invoice={inv} onClose={close} /> : null;
      })()}
      {overlay.kind === 'method' && (
        <MethodSheet
          accountId={accountId}
          reason={overlay.thenAutopay ? 'Autopay needs a saved method. Save one and autopay turns on.' : undefined}
          onSaved={() => {
            if (overlay.thenAutopay) state.setAutopay(accountId, true);
            close();
          }}
          onClose={close}
        />
      )}
    </div>
  );
}
