// One invoice: header, locked badge, the charge lines (grouped by site with the PO when the account has
// several sites), and totals that reconcile against the sum of the lines.

import { useStore } from '../../store/useStore';
import { invoiceOpenBalance, invoiceStatus, sitesForAccount } from '../../store/selectors';
import { TODAY, formatDate } from '../../store/clock';
import { money } from '../../lib/money';
import { InvoiceStatusPill } from './InvoiceStatusPill';
import type { Charge, Invoice, Site } from '../../types';

function chargeWhen(c: Charge): string {
  if (c.period) return `${formatDate(c.period.start)} to ${formatDate(c.period.end)}`;
  if (c.servicedOn) return formatDate(c.servicedOn);
  return '';
}

function feeTotal(c: Charge): number {
  return c.fees.reduce((s, f) => s + f.cents, 0);
}

export function InvoiceDetail({
  invoice, onWhy, onPay,
}: { invoice: Invoice; onWhy: (charge: Charge) => void; onPay: (invoice: Invoice) => void }) {
  const state = useStore();
  const lines = invoice.chargeIds
    .map((id) => state.charges.find((c) => c.id === id))
    .filter((c): c is Charge => Boolean(c));
  const sites = sitesForAccount(state, invoice.accountId);
  const grouped = sites.length > 1;
  const open = invoiceOpenBalance(state, invoice.id);
  const status = invoiceStatus(state, invoice.id, TODAY);

  const sum = lines.reduce(
    (acc, c) => {
      acc.base += c.baseCents;
      acc.fees += feeTotal(c);
      acc.tax += c.taxCents;
      acc.total += c.totalCents;
      return acc;
    },
    { base: 0, fees: 0, tax: 0, total: 0 },
  );
  const reconciles =
    sum.base === invoice.subtotalCents && sum.fees === invoice.feeCents && sum.tax === invoice.taxCents && sum.total === invoice.totalCents;

  // Group lines by site in the account's site order; lines on an unknown site fall to the end.
  const groups: { site: Site | undefined; lines: Charge[] }[] = grouped
    ? [...sites.map((site) => ({ site, lines: lines.filter((c) => c.siteId === site.id) })),
       { site: undefined, lines: lines.filter((c) => !sites.some((s) => s.id === c.siteId)) }].filter((g) => g.lines.length > 0)
    : [{ site: undefined, lines }];

  const columns = grouped ? 7 : 8;

  const renderLine = (c: Charge) => {
    const site = state.sites.find((s) => s.id === c.siteId);
    return (
      <tr key={c.id}>
        <td>
          <div>{c.description}</div>
          <div className="text-xs text-ink-3">{c.lineType === 'lateFee' ? 'Late fee' : c.lineType === 'event' ? 'Field event' : c.lineType === 'fee' ? 'Fee' : 'Recurring service'}</div>
        </td>
        <td className="whitespace-nowrap text-ink-2">{chargeWhen(c)}</td>
        {!grouped && (
          <td>
            <div>{site?.address ?? c.siteId}</div>
            {site?.poNumber && <div className="font-mono text-xs text-ink-3">{site.poNumber}</div>}
          </td>
        )}
        <td className="num tl-money">{money(c.baseCents)}</td>
        <td className="num tl-money">{money(feeTotal(c))}</td>
        <td className="num tl-money">{money(c.taxCents)}</td>
        <td className="num tl-money font-medium">{money(c.totalCents)}</td>
        <td className="num">
          <button type="button" className="tl-button tl-button--ghost whitespace-nowrap" style={{ height: 28, padding: '0 8px' }} onClick={() => onWhy(c)}>
            Why this charge
          </button>
        </td>
      </tr>
    );
  };

  return (
    <section className="tl-panel flex flex-col gap-4" aria-label={`Invoice ${invoice.number}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold">Invoice {invoice.number}</h2>
            <InvoiceStatusPill status={status} />
            {invoice.locked && <span className="tl-pill">Posted and locked</span>}
          </div>
          <div className="text-sm text-ink-2 mt-1">
            Issued {formatDate(invoice.issuedAt)}, due {formatDate(invoice.dueAt)}, delivered by {invoice.deliveredVia}
          </div>
          {invoice.locked && (
            <div className="text-xs text-ink-3 mt-1">
              This invoice was posted{invoice.postedAt ? ` on ${formatDate(invoice.postedAt)}` : ''} and cannot change. Corrections arrive as credit memos, never as edits.
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="tl-label">Open balance</div>
          <div className="text-xl font-semibold tl-money" style={{ color: open > 0 ? 'var(--color-danger)' : 'var(--color-ink)' }}>{money(open)}</div>
          {open > 0 && (
            <button type="button" className="tl-button mt-2" onClick={() => onPay(invoice)}>Pay now</button>
          )}
        </div>
      </div>

      <table className="tl-table">
        <thead>
          <tr>
            <th>Description</th>
            <th>Period or service date</th>
            {!grouped && <th>Site</th>}
            <th className="num">Base</th>
            <th className="num">Fees</th>
            <th className="num">Tax</th>
            <th className="num">Total</th>
            <th className="num"></th>
          </tr>
        </thead>
        {groups.map((g, gi) => (
          <tbody key={g.site?.id ?? `other-${gi}`}>
            {grouped && (
              <tr>
                <td colSpan={columns} className="text-sm font-medium" style={{ background: 'var(--color-surface-2)', height: 32 }}>
                  {g.site?.address ?? 'Other'}
                  {g.site?.poNumber && <span className="font-mono text-xs text-ink-3 ml-2">{g.site.poNumber}</span>}
                  <span className="text-xs text-ink-3 font-normal ml-2">
                    {g.lines.length} line{g.lines.length === 1 ? '' : 's'}, {money(g.lines.reduce((s, c) => s + c.totalCents, 0))}
                  </span>
                </td>
              </tr>
            )}
            {g.lines.map(renderLine)}
          </tbody>
        ))}
        <tfoot>
          <tr>
            <td colSpan={grouped ? 2 : 3} className="text-sm text-ink-2" rowSpan={3} style={{ verticalAlign: 'top' }}>
              {reconciles ? (
                <span className="text-xs text-ink-3">Totals reconcile to the sum of the {lines.length} lines.</span>
              ) : (
                <span className="text-xs" style={{ color: 'var(--color-danger)' }}>
                  Invoice totals do not match the lines (lines sum to {money(sum.total)}). Contact the office.
                </span>
              )}
            </td>
            <td className="num tl-money">{money(invoice.subtotalCents)}</td>
            <td className="num tl-money">{money(invoice.feeCents)}</td>
            <td className="num tl-money">{money(invoice.taxCents)}</td>
            <td className="num tl-money font-semibold">{money(invoice.totalCents)}</td>
            <td className="text-xs text-ink-3">Invoice total</td>
          </tr>
          <tr>
            <td colSpan={4} className="num text-xs text-ink-3">Paid {money(invoice.totalCents - open)}</td>
            <td></td>
          </tr>
          <tr>
            <td colSpan={4} className="num tl-money font-semibold" style={{ color: open > 0 ? 'var(--color-danger)' : undefined }}>Open {money(open)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
