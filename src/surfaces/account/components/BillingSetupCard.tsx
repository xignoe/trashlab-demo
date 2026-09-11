// How this account is billed (addenda P and Q): its billing group, which sets the schedule, bill dates, and payment
// terms, and how its invoices go out. When the group lets customers choose, the office can pick another delivery for
// this account; otherwise the group's delivery applies. Changing the group can propose a bridge charge so no day goes
// unbilled; the card says so. Links to /office/groups for the group itself.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../../../store/useStore';
import { cadenceOf, scheduleText } from '../../../store/cycles';
import { invoiceTermsDays } from '../../../store/engine';
import type { InvoiceDelivery } from '../../../types';
import { DELIVERY_HINT, DELIVERY_NAME, INVOICE_DELIVERIES, isBridgeCharge, nextBillDates } from '../lib/billingGroups';
import type { AccountView } from '../selectors';
import { CYCLE_LABEL, fmtDay, money, plural } from './format';

export function BillingSetupCard({ view }: { view: AccountView }) {
  const { account } = view;
  const groups = useStore((s) => s.db.billingGroups);
  const db = useStore((s) => s.db);
  const cycleDate = useStore((s) => s.cycleDate);
  const assignBillingGroup = useStore((s) => s.assignBillingGroup);
  const setInvoiceDelivery = useStore((s) => s.setInvoiceDelivery);
  const [error, setError] = useState<string>();
  const group = groups.find((g) => g.id === account.billingGroupId);
  const locked = group !== undefined && !group.customerChoice;
  const next = nextBillDates(cadenceOf(account, groups), cycleDate, 1)[0];
  const bridges = db.charges.filter((c) => c.accountId === account.id && c.status === 'proposed' && isBridgeCharge(c));

  const attempt = (fn: () => void) => {
    setError(undefined);
    try {
      fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nothing was changed.');
    }
  };

  return (
    <section className="panel" aria-label="Billing setup">
      <div className="card-head">
        <h2 className="card-title">Billing</h2>
        <Link to={group ? `/office/groups?group=${group.id}` : '/office/groups'} className="card-note">
          Billing groups
        </Link>
      </div>

      <label className="field">
        <span className="eyebrow">Billing group</span>
        <select className="select" value={account.billingGroupId ?? ''} onChange={(e) => attempt(() => assignBillingGroup(account.id, e.target.value || null))}>
          <option value="">No group, bills on its own terms</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>

      <div className="kv">
        <div className="kv-item">
          <span className="eyebrow">Bills</span>
          <span className="kv-value">{group ? scheduleText(group.schedule) : CYCLE_LABEL[account.cycle]}</span>
        </div>
        <div className="kv-item">
          <span className="eyebrow">Next bill</span>
          <span className="kv-value">{next ? fmtDay(next) : 'Per job'}</span>
          <span className="meta">Due {invoiceTermsDays(account, db)} days after</span>
        </div>
      </div>

      {bridges.length ? (
        <p className="meta" data-testid="bridge-note">
          {plural(bridges.length, 'bridge charge')} ({money(bridges.reduce((s, c) => s + c.totalCents, 0))}) proposed for {bridges[0].description.split(', ').at(-1)} so
          the move leaves no day unbilled. The next run lists {bridges.length === 1 ? 'it' : 'them'} for review.
        </p>
      ) : null}
      {error ? <div className="form-error">{error}</div> : null}

      <fieldset className="field">
        <legend className="eyebrow">Invoices by</legend>
        {locked ? <p className="meta">{group!.name} sends every invoice by {DELIVERY_NAME[group!.delivery].toLowerCase()}.</p> : null}
        <div className="stack">
          {INVOICE_DELIVERIES.map((m: InvoiceDelivery) => (
            <label key={m} className="cluster" title={DELIVERY_HINT[m]}>
              <input
                type="radio"
                name={`delivery-${account.id}`}
                checked={account.deliveryMethod === m}
                disabled={locked && m !== account.deliveryMethod}
                onChange={() => attempt(() => setInvoiceDelivery(account.id, m))}
              />
              <span>{DELIVERY_NAME[m]}</span>
              {group?.delivery === m ? <span className="meta">group&apos;s choice</span> : null}
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  );
}
