// Cart size change. Hauler proration is none, so the current invoice never changes; the new size starts on the
// next cycle start and the next quarterly (or monthly) invoice carries the new total. Both totals come from
// computeCharge over the cycle so the numbers match what Billing will show.

import { useMemo, useState } from 'react';
import { usePortal } from '../../store';
import { CART_CATALOG_IDS, serviceItemsInPeriod, serviceItemsForSite, routeForSite } from '../../lib/selectors';
import { PREVIEW_CHARGE_ID, computeCharge, monthsInCycle, nextCycleStart, resolvePrice, frequencyLabel } from '../../lib/engine';
import { cadenceOf, periodFor } from '../../../../store/cycles';
import { today, addDays, formatDate, formatDayLong, nextRouteDay } from '../../lib/clock';
import { money } from '../../lib/money';
import { HandoffCard } from '../../components/HandoffCard';
import { CheckRows, type CheckRow } from './CheckRows';
import type { Request, ServiceItem, WorkOrder } from '../../../../types';
import type { PendingChange } from '../../store';

export function CartChangeFlow({ onDone }: { onDone: () => void }) {
  const state = usePortal();
  const { accountId, siteId } = state.session;
  const account = state.accounts.find((a) => a.id === accountId)!;
  const site = state.sites.find((s) => s.id === siteId)!;
  const route = routeForSite(state, siteId);
  const hauler = state.hauler[0];

  const carts = serviceItemsForSite(state, siteId).filter(
    (i) => i.status === 'active' && (CART_CATALOG_IDS as readonly string[]).includes(i.catalogId) && i.effectiveFrom <= today(),
  );
  const [itemId, setItemId] = useState<string>(carts[0]?.id ?? '');
  const current = carts.find((c) => c.id === itemId) ?? carts[0];
  const targets = CART_CATALOG_IDS.filter((id) => id !== current?.catalogId);
  const [toCatalogId, setToCatalogId] = useState<string>(targets[0] ?? '');
  const target = targets.includes(toCatalogId as (typeof CART_CATALOG_IDS)[number]) ? toCatalogId : targets[0];
  const [result, setResult] = useState<{ pendingChange: PendingChange; workOrder: WorkOrder; request: Request } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nextStart = nextCycleStart(account, today(), state.billingGroups);
  const period = periodFor(cadenceOf(account, state.billingGroups), nextStart);
  const months = monthsInCycle(account, state.billingGroups);
  const swapDay = route ? nextRouteDay(route.day, today()) : undefined;
  const cycleWord = account.cycle === 'quarterly' || account.cycle === 'weekly' || account.cycle === 'daily' ? account.cycle : 'monthly';

  const plan = useMemo(() => {
    if (!current || !target || months === 0) return null;
    try {
      const priceNow = resolvePrice({ catalogId: current.catalogId, frequency: current.frequency, zoneId: site.zoneId, accountId, onDate: nextStart });
      const priceNew = resolvePrice({ catalogId: target, frequency: current.frequency, zoneId: site.zoneId, accountId, onDate: nextStart });
      // Every service line that will bill in the coming cycle, with the cart line swapped for the new size.
      const items = serviceItemsInPeriod(state, siteId, period).filter((i) => i.status === 'active');
      const lineFor = (item: ServiceItem, catalogId: string) =>
        computeCharge({
          id: PREVIEW_CHARGE_ID, accountId, siteId, lineType: 'recurring', catalogId, frequency: item.frequency,
          baseCents: resolvePrice({ catalogId, frequency: item.frequency, zoneId: site.zoneId, accountId, onDate: nextStart }).priceCents * months * item.qty,
          period, source: { type: 'serviceItem', id: item.id },
        });
      const oldTotal = items.reduce((sum, i) => sum + lineFor(i, i.catalogId).totalCents, 0);
      const newTotal = items.reduce((sum, i) => sum + lineFor(i, i.id === current.id ? target : i.catalogId).totalCents, 0);
      return { priceNow: priceNow.priceCents, priceNew: priceNew.priceCents, oldTotal, newTotal, lines: items.length };
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, [state, accountId, siteId, site, current, target, months, nextStart, period]);

  const checks: CheckRow[] = [
    { id: 'activeCart', label: 'An active cart to change', ok: Boolean(current), detail: current ? `${state.catalog.find((c) => c.id === current.catalogId)?.name}, ${frequencyLabel(current.frequency)}` : 'No active cart at this site' },
    { id: 'noPending', label: 'No change already waiting on this cart', ok: !current || !state.pendingChanges.some((p) => p.serviceItemId === current.id), detail: current && state.pendingChanges.some((p) => p.serviceItemId === current.id) ? 'This cart already has a change waiting for the next cycle' : 'Nothing pending' },
    { id: 'route', label: 'A route day for the swap', ok: Boolean(swapDay), detail: swapDay ? `Swap on ${formatDayLong(swapDay)}` : 'No route serves this site' },
    { id: 'priced', label: 'New size is priced for your zone', ok: typeof plan === 'object' && plan !== null, detail: typeof plan === 'string' ? plan : plan ? `${money(plan.priceNew)} per month` : 'Waiting on a cart' },
  ];
  const allOk = checks.every((c) => c.ok);
  const failReason = checks.find((c) => !c.ok)?.detail;

  const confirm = () => {
    if (!current || !target) return;
    try {
      setResult(state.changeCart({ accountId, siteId, serviceItemId: current.id, toCatalogId: target }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const catName = (id: string) => state.catalog.find((c) => c.id === id)?.name ?? id;

  if (result) {
    return (
      <div className="flex flex-col gap-3">
        <div className="tl-card flex flex-col gap-2" style={{ background: 'var(--color-ok-soft)', borderColor: 'transparent' }}>
          <div className="flex items-center gap-2">
            <span className="tl-pill tl-pill--ok">scheduled</span>
            <span className="font-medium">Switching to {catName(result.pendingChange.toCatalogId)} on {formatDate(result.pendingChange.effectiveFrom)}</span>
          </div>
          <p className="text-sm text-ink-2">
            Our driver swaps the cart on {formatDayLong(result.workOrder.scheduledFor)}. Your current invoice does not change; the new price starts on {formatDate(result.pendingChange.effectiveFrom)}.
          </p>
        </div>
        <dl className="text-sm grid gap-x-3 gap-y-1" style={{ gridTemplateColumns: 'auto 1fr' }}>
          <dt className="text-ink-3">Work order</dt><dd className="font-mono">{result.workOrder.id} (swap, {formatDayLong(result.workOrder.scheduledFor)})</dd>
          <dt className="text-ink-3">Request</dt><dd className="font-mono">{result.request.id}</dd>
          <dt className="text-ink-3">Current service</dt><dd>{catName(result.pendingChange.fromCatalogId)} bills through {formatDate(addDays(result.pendingChange.effectiveFrom, -1))}</dd>
          <dt className="text-ink-3">New service</dt><dd>{catName(result.pendingChange.toCatalogId)} bills from {formatDate(result.pendingChange.effectiveFrom)} <span className="font-mono text-xs text-ink-3">{result.pendingChange.id}</span></dd>
        </dl>
        <div><button type="button" className="tl-button" onClick={onDone}>Back to requests</button></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-2">Move between the 96 gallon and 64 gallon trash cart. The swap happens on your next route day; the price changes on your next billing cycle.</p>

      {carts.length > 0 && (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', maxWidth: 520 }}>
          <div>
            <label className="tl-label" htmlFor="cart-item">Current cart</label>
            <select id="cart-item" className="tl-field" value={current?.id ?? ''} onChange={(e) => setItemId(e.target.value)}>
              {carts.map((c) => (
                <option key={c.id} value={c.id}>{catName(c.catalogId)}, {frequencyLabel(c.frequency)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="tl-label" htmlFor="cart-target">Change to</label>
            <select id="cart-target" className="tl-field" value={target ?? ''} onChange={(e) => setToCatalogId(e.target.value)}>
              {targets.map((id) => (
                <option key={id} value={id}>{catName(id)}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <CheckRows title="Checks" checks={checks} />

      {!allOk && failReason && (
        <HandoffCard title="Cart size change" reason={failReason} createRequest={{ kind: 'cartChange', accountId, siteId }}>
          <div><button type="button" className="tl-button tl-button--secondary" onClick={onDone}>Back to requests</button></div>
        </HandoffCard>
      )}

      {allOk && plan && typeof plan === 'object' && current && swapDay && (
        <>
          <div className="tl-card flex flex-col gap-2 text-sm" data-testid="cart-plan">
            <div className="grid gap-x-6 gap-y-1" style={{ gridTemplateColumns: 'auto auto' }}>
              <span className="text-ink-3">Current monthly price</span><span className="tl-money">{money(plan.priceNow)} ({catName(current.catalogId)})</span>
              <span className="text-ink-3">New monthly price</span><span className="tl-money">{money(plan.priceNew)} ({catName(target)})</span>
            </div>
            <div className="border-t border-border pt-2 mt-1">
              <div className="font-medium">What changes on your bill</div>
              <p className="text-ink-2">
                {hauler.name} does not prorate. Your current invoice does not change. Starting {formatDate(nextStart)} your {cycleWord} invoice will be <strong className="tl-money">{money(plan.newTotal)}</strong> instead of <strong className="tl-money">{money(plan.oldTotal)}</strong>.
              </p>
              <p className="text-xs text-ink-3 mt-1">
                Totals cover every service at this site for {formatDate(period.start)} to {formatDate(period.end)} with fuel fee, environmental fee, and tax included, computed the same way your invoice is. The swap on {formatDayLong(swapDay)} costs nothing.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" className="tl-button" onClick={confirm}>Confirm change</button>
            <button type="button" className="tl-button tl-button--secondary" onClick={onDone}>Cancel</button>
          </div>
        </>
      )}
      {error && <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      <p className="text-xs text-ink-3">Current service ends {formatDate(addDays(nextStart, -1))}; the new service starts {formatDate(nextStart)}.</p>
    </div>
  );
}
