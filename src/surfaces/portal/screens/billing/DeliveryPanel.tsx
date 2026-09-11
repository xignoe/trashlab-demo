// How you get your bill (addendum P): the customer picks printed mail, email, text, or the portal for their invoices,
// and sees their billing schedule from their billing group (cadence, next bill date, when payment is due). The choice
// is BillingAccount.deliveryMethod, the same field the office sets on the account page. Email, text, and printed mail
// each need somewhere to send the invoice (DECISIONS.md entry 70), so choosing one asks for it before anything changes.

import { useState } from 'react';
import { usePortal } from '../../store';
import { billingMonths, cadenceOf, scheduleText } from '../../../../store/cycles';
import { invoiceTermsDays } from '../../../../store/engine';
import type { InvoiceDelivery } from '../../../../types';
import { DELIVERY_CONTACT, contactOnFile } from '../../lib/deliveryContact';
import { nextCycleStart } from '../../lib/engine';
import { formatDate, today } from '../../lib/clock';

const OPTIONS: { id: InvoiceDelivery; label: string; hint: string }[] = [
  { id: 'email', label: 'Email', hint: 'A PDF invoice with a pay link' },
  { id: 'text', label: 'Text message', hint: 'A pay link by text' },
  { id: 'mail', label: 'Printed mail', hint: 'A paper invoice to your billing address' },
  { id: 'portal', label: 'Portal only', hint: 'We post it here and send a notice' },
];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "quarterly (Feb, May, Aug, Nov)", "monthly", "net 30", or "per job". */
function cycleText(cycle: string, months: number[]): string {
  if (cycle === 'quarterly') return `quarterly (${months.map((m) => MONTH[m - 1]).join(', ')})`;
  if (cycle === 'net30') return 'monthly, net 30';
  if (cycle === 'perJob') return 'per job';
  return 'monthly';
}

export function DeliveryPanel({ accountId }: { accountId: string }) {
  const state = usePortal();
  const account = state.accounts.find((a) => a.id === accountId)!;
  const cadence = cadenceOf(account, state.billingGroups);
  const next = account.cycle === 'perJob' ? undefined : nextCycleStart(account, today(), state.billingGroups);
  const terms = invoiceTermsDays(account, state);
  const group = account.billingGroupId ? state.billingGroups.find((g) => g.id === account.billingGroupId) : undefined;
  const locked = group !== undefined && !group.customerChoice;

  // The method whose contact the customer is entering. The saved choice changes only when they save it.
  const [editing, setEditing] = useState<InvoiceDelivery | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = account.deliveryMethod;
  const onFile = contactOnFile(account, current);
  // A saved method with nothing on file (a seeded account, or one a billing group moved) asks for it straight away.
  const formMethod = editing ?? (DELIVERY_CONTACT[current] && !onFile ? current : null);
  const form = formMethod ? DELIVERY_CONTACT[formMethod] : undefined;
  const serviceAddress = state.sites.find((s) => s.accountId === accountId)?.address;
  const value = draft ?? (formMethod ? contactOnFile(account, formMethod) ?? (formMethod === 'mail' ? serviceAddress : undefined) ?? '' : '');

  const reset = () => {
    setEditing(null);
    setDraft(null);
    setError(null);
  };
  const save = (method: InvoiceDelivery, contact?: string) => {
    try {
      state.setDeliveryMethod(accountId, method, contact);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const choose = (method: InvoiceDelivery) => {
    if (!DELIVERY_CONTACT[method] || contactOnFile(account, method)) return save(method);
    setError(null);
    setDraft(null);
    setEditing(method);
  };

  return (
    <section className="tl-panel flex flex-col gap-3" aria-label="How you get your bill" data-testid="delivery-panel">
      <div>
        <h2 className="text-lg font-medium">How you get your bill</h2>
        <p className="text-sm text-ink-2" data-testid="billing-schedule">
          You are billed {cadence.schedule ? scheduleText(cadence.schedule).replace(/^./, (c) => c.toLowerCase()) : cycleText(account.cycle, billingMonths(cadence))}
          {account.billedInAdvance && account.cycle !== 'perJob' ? ', in advance' : ''}.
          {next ? ` Your next bill is ${formatDate(next)}, due ${terms} days later.` : ''}
        </p>
      </div>
      <fieldset className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', border: 'none', margin: 0, padding: 0 }}>
        <legend className="tl-label">Send my invoices by</legend>
        {locked ? (
          <p className="text-xs text-ink-3" style={{ gridColumn: '1 / -1' }} data-testid="delivery-locked">
            Your account is billed with a group that sends every invoice the same way. Call the office to change it.
          </p>
        ) : null}
        {OPTIONS.map((o) => {
          const on = (formMethod ?? current) === o.id;
          return (
            <label
              key={o.id}
              className={`tl-card flex items-start gap-3 ${locked ? '' : 'cursor-pointer'}`}
              style={{ borderColor: on ? 'var(--color-accent)' : undefined, background: on ? 'var(--color-accent-soft)' : undefined, opacity: locked && !on ? 0.55 : 1 }}
            >
              <input type="radio" name="invoice-delivery" value={o.id} checked={on} disabled={locked} onChange={() => choose(o.id)} style={{ marginTop: 3 }} />
              <span className="flex flex-col">
                <span className="text-sm font-medium">{o.label}</span>
                <span className="text-xs text-ink-3">{o.hint}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {form && formMethod ? (
        <form
          className="flex items-end gap-3 flex-wrap"
          data-testid="delivery-contact-form"
          noValidate
          onSubmit={(e) => { e.preventDefault(); save(formMethod, value); }}
        >
          <div className="flex flex-col" style={{ flex: '1 1 280px' }}>
            <label className="tl-label" htmlFor="delivery-contact">{form.label}</label>
            <input
              id="delivery-contact"
              className="tl-field"
              type={form.inputType}
              autoComplete={form.autoComplete}
              value={value}
              onChange={(e) => setDraft(e.target.value)}
            />
          </div>
          <button type="submit" className="tl-button">Save {form.label.toLowerCase()}</button>
          {editing ? <button type="button" className="tl-button tl-button--secondary" onClick={reset}>Cancel</button> : null}
          <p className="text-xs text-ink-3 basis-full">
            {editing ? '' : `We need your ${form.label.toLowerCase()} so your next invoice reaches you. `}
            {form.hint}
          </p>
        </form>
      ) : onFile ? (
        <div className="flex items-center gap-3 flex-wrap text-sm text-ink-2">
          <span data-testid="delivery-contact">Invoices go to <span className="font-medium text-ink">{onFile}</span>.</span>
          <button type="button" className="tl-button tl-button--secondary" onClick={() => { reset(); setEditing(current); }}>Change</button>
        </div>
      ) : null}
      {error ? <p className="text-sm" data-testid="delivery-error" style={{ color: 'var(--color-danger)' }}>{error}</p> : null}
    </section>
  );
}
