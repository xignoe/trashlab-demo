// "Add account" drawer, opened from the accounts table. The office's own intake, beside the storefront's signup:
// payer, service address, billing settings, and an optional first service line. The preview is computed purely from
// planAddAccount on the live state, so what it shows is exactly what Add writes (invariant 3). Confirm calls
// addAccount, which writes the party, account, site, first item, its container, and an open delivery work order.
import { useMemo, useState, type FormEvent } from 'react';
import { useStore } from '../../../store/useStore';
import type { BillingAccount, Frequency, Party } from '../../../types';
import { FREQUENCY_LABEL } from '../lib/engine';
import { addAccountError, firstServiceDay, planAddAccount, type NewAccountDraft } from '../lib/lifecycle';
import { useAccountData } from '../selectors';
import { Drawer } from './Drawer';
import { CYCLE_LABEL, DELIVERY_LABEL, PARTY_KIND_LABEL, capitalize, fmtDate, money } from './format';

const KINDS: Party['kind'][] = ['homeowner', 'business', 'contractor', 'propertyManager', 'hoa'];
const CYCLES: BillingAccount['cycle'][] = ['monthly', 'quarterly', 'net30', 'perJob'];
const DELIVERIES: BillingAccount['deliveryMethod'][] = ['mail', 'email', 'portal'];
const FREQUENCIES: Frequency[] = ['weekly', 'eow', '2x', '3x', 'onCall'];

export interface AddAccountResult {
  accountId: string;
  title: string;
  detail: string;
}

export function AddAccountDrawer({ onClose, onDone }: { onClose: () => void; onDone: (result: AddAccountResult) => void }) {
  const { db } = useAccountData();
  const zones = db.zones.filter((z) => z.serviceability !== 'notServed');
  const [draft, setDraft] = useState<NewAccountDraft>(() => {
    const zoneId = zones[0]?.id ?? db.zones[0]?.id ?? '';
    const routeId = db.routes[0]?.id;
    return {
      payerName: '',
      kind: 'homeowner',
      address: '',
      zoneId,
      routeId,
      cycle: 'quarterly',
      billedInAdvance: true,
      deliveryMethod: 'mail',
      autopay: false,
      taxExempt: false,
      service: { catalogId: db.catalog[0]?.id ?? '', qty: 1, frequency: 'weekly', startOn: firstServiceDay(routeId, db) },
    };
  });
  const [error, setError] = useState<string | undefined>();
  const set = (patch: Partial<NewAccountDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setService = (patch: Partial<NonNullable<NewAccountDraft['service']>>) =>
    setDraft((d) => (d.service ? { ...d, service: { ...d.service, ...patch } } : d));

  const problem = addAccountError(draft, db);
  const plan = useMemo(() => {
    if (problem) return undefined;
    try {
      return planAddAccount(draft, db);
    } catch {
      return undefined;
    }
  }, [draft, db, problem]);

  const catalog = draft.service ? db.catalog.find((c) => c.id === draft.service!.catalogId) : undefined;
  const route = db.routes.find((r) => r.id === draft.routeId);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    try {
      const written = useStore.getState().addAccount(draft);
      const lines = written.item && catalog
        ? `${catalog.name}${written.item.qty > 1 ? ` x${written.item.qty}` : ''} from ${fmtDate(written.item.effectiveFrom)}, cart ${written.container?.serial} delivered ${fmtDate(written.workOrder?.scheduledFor)}`
        : 'No service yet. Use Change service to add one.';
      onDone({
        accountId: written.account.id,
        title: `${written.party.name} added as ${written.account.id}`,
        detail: `${written.site.address}. ${lines}`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Drawer
      title="Add account"
      eyebrow="Office · New customer"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-tertiary" onClick={onClose}>Cancel</button>
          <button type="submit" form="add-account-form" className="btn btn-primary" disabled={Boolean(problem)}>Add account</button>
        </>
      }
    >
      <form id="add-account-form" className="drawer-form" onSubmit={onSubmit}>
        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="field">
          <label className="eyebrow" htmlFor="add-name">Payer name</label>
          <input id="add-name" className="input" value={draft.payerName} onChange={(e) => set({ payerName: e.target.value })} autoComplete="off" />
        </div>
        <div className="field-row field-row-even">
          <div className="field">
            <label className="eyebrow" htmlFor="add-kind">Type</label>
            <select id="add-kind" className="select" value={draft.kind} onChange={(e) => set({ kind: e.target.value as Party['kind'] })}>
              {KINDS.map((k) => <option key={k} value={k}>{PARTY_KIND_LABEL[k]}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="eyebrow" htmlFor="add-po">PO number</label>
            <input id="add-po" className="input" value={draft.poNumber ?? ''} onChange={(e) => set({ poNumber: e.target.value })} autoComplete="off" />
          </div>
        </div>
        <div className="field">
          <label className="eyebrow" htmlFor="add-address">Service address</label>
          <input id="add-address" className="input" value={draft.address} onChange={(e) => set({ address: e.target.value })} autoComplete="off" />
        </div>
        <div className="field-row field-row-even">
          <div className="field">
            <label className="eyebrow" htmlFor="add-zone">Zone type</label>
            <select id="add-zone" className="select" value={draft.zoneId} onChange={(e) => set({ zoneId: e.target.value })}>
              {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="eyebrow" htmlFor="add-route">Route</label>
            <select
              id="add-route"
              className="select"
              value={draft.routeId ?? ''}
              onChange={(e) => {
                const routeId = e.target.value || undefined;
                setDraft((d) => ({ ...d, routeId, service: d.service ? { ...d.service, startOn: firstServiceDay(routeId, db) } : undefined }));
              }}
            >
              <option value="">No route yet</option>
              {db.routes.map((r) => <option key={r.id} value={r.id}>{r.day} · {r.lob}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label className="eyebrow" htmlFor="add-notes">Access notes</label>
          <input id="add-notes" className="input" value={draft.accessNotes ?? ''} onChange={(e) => set({ accessNotes: e.target.value })} autoComplete="off" />
        </div>

        <div className="eyebrow drawer-section-label">Billing</div>
        <div className="field-row field-row-even">
          <div className="field">
            <label className="eyebrow" htmlFor="add-cycle">Cycle</label>
            <select id="add-cycle" className="select" value={draft.cycle} onChange={(e) => set({ cycle: e.target.value as BillingAccount['cycle'] })}>
              {CYCLES.map((c) => <option key={c} value={c}>{CYCLE_LABEL[c]}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="eyebrow" htmlFor="add-delivery">Invoices</label>
            <select id="add-delivery" className="select" value={draft.deliveryMethod} onChange={(e) => set({ deliveryMethod: e.target.value as BillingAccount['deliveryMethod'] })}>
              {DELIVERIES.map((d) => <option key={d} value={d}>{DELIVERY_LABEL[d]}</option>)}
            </select>
          </div>
        </div>
        <div className="cluster">
          <label className="cluster" style={{ gap: 6 }}>
            <input type="checkbox" checked={draft.billedInAdvance} onChange={(e) => set({ billedInAdvance: e.target.checked })} />
            <span className="meta">Billed in advance</span>
          </label>
          <label className="cluster" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={draft.autopay}
              onChange={(e) => set({ autopay: e.target.checked, paymentMethodOnFile: e.target.checked ? (draft.paymentMethodOnFile ?? 'card') : draft.paymentMethodOnFile })}
            />
            <span className="meta">Autopay</span>
          </label>
          <label className="cluster" style={{ gap: 6 }}>
            <input type="checkbox" checked={draft.taxExempt} onChange={(e) => set({ taxExempt: e.target.checked })} />
            <span className="meta">Tax exempt</span>
          </label>
        </div>

        <div className="eyebrow drawer-section-label">First service</div>
        <label className="cluster" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={Boolean(draft.service)}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                service: e.target.checked
                  ? { catalogId: db.catalog[0]?.id ?? '', qty: 1, frequency: 'weekly', startOn: firstServiceDay(d.routeId, db) }
                  : undefined,
              }))
            }
          />
          <span className="meta">Start a service line now</span>
        </label>
        {draft.service && (
          <>
            <div className="field-row field-row-even">
              <div className="field">
                <label className="eyebrow" htmlFor="add-service">Service</label>
                <select id="add-service" className="select" value={draft.service.catalogId} onChange={(e) => setService({ catalogId: e.target.value })}>
                  {db.catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="eyebrow" htmlFor="add-qty">Quantity</label>
                <input id="add-qty" className="input input-mono" type="number" min={1} step={1} value={draft.service.qty} onChange={(e) => setService({ qty: Number(e.target.value) })} />
              </div>
            </div>
            <div className="field-row field-row-even">
              <div className="field">
                <label className="eyebrow" htmlFor="add-frequency">Frequency</label>
                <select id="add-frequency" className="select" value={draft.service.frequency} onChange={(e) => setService({ frequency: e.target.value as Frequency })}>
                  {FREQUENCIES.map((f) => <option key={f} value={f}>{capitalize(FREQUENCY_LABEL[f])}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="eyebrow" htmlFor="add-start">Starts</label>
                <input id="add-start" className="input input-mono" type="date" value={draft.service.startOn} onChange={(e) => setService({ startOn: e.target.value })} />
              </div>
            </div>
          </>
        )}

        <div className="inset">
          {problem ? (
            <p className="change-note muted">{problem}</p>
          ) : (
            <>
              <p className="change-note">
                <span className="status-text">{draft.payerName.trim()}</span> becomes <code className="code">{plan?.account.id}</code> at {draft.address.trim()}
                {route ? `, on the ${route.day} route` : ', with no route yet'}.
              </p>
              {plan?.item && catalog && (
                <p className="change-note">
                  {catalog.name}{plan.item.qty > 1 ? ` x${plan.item.qty}` : ''}, {FREQUENCY_LABEL[plan.item.frequency]}, from {fmtDate(plan.item.effectiveFrom)}.{' '}
                  {plan.priceCents !== undefined
                    ? <><span className="mono">{money(plan.priceCents)}</span> per month at today&apos;s rate.</>
                    : <span className="danger-text">{plan.priceError}</span>}
                </p>
              )}
              {plan?.workOrder && (
                <p className="change-note meta">
                  Work order {plan.workOrder.id}: deliver cart {plan.container?.serial} on {fmtDate(plan.workOrder.scheduledFor)}, open until dispatch schedules it.
                </p>
              )}
              <p className="change-note meta">
                {CYCLE_LABEL[draft.cycle]}{draft.cycle !== 'perJob' && draft.billedInAdvance ? ' in advance' : ''} · {DELIVERY_LABEL[draft.deliveryMethod]} · autopay {draft.autopay ? 'on' : 'off'}.
                No charge is written now; the next billing run raises the first invoice.
              </p>
            </>
          )}
        </div>
      </form>
    </Drawer>
  );
}
