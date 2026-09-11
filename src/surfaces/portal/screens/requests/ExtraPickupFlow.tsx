// Extra pickup: three checks shown as rows, then the price stack from computeCharge, then the mock tokenized
// payment, then the work order id and day. Any failed check ends in the HandoffCard with an open Request.

import { useMemo, useState } from 'react';
import { usePortal } from '../../store';
import { extraPickupEligibility } from '../../lib/selectors';
import { EXTRA_PICKUP_RATE_CENTS, EXTRA_PICKUP_SOURCE, PREVIEW_CHARGE_ID, computeCharge } from '../../lib/engine';
import { today, formatDayLong } from '../../lib/clock';
import { money } from '../../lib/money';
import { Drawer } from '../../components/Drawer';
import { HandoffCard } from '../../components/HandoffCard';
import { HostedField } from '../billing/HostedField';
import { CheckRows } from './CheckRows';
import type { PaymentToken } from '../../lib/paymentToken';
import type { Charge, Payment, Request, WorkOrder } from '../../../../types';

type Booked = { charge: Charge; payment: Payment; request: Request; workOrder: WorkOrder };

export function ExtraPickupFlow({ onDone }: { onDone: () => void }) {
  const state = usePortal();
  const { accountId, siteId } = state.session;
  const site = state.sites.find((s) => s.id === siteId)!;
  const eligibility = useMemo(() => extraPickupEligibility(state, accountId, siteId, today()), [state, accountId, siteId]);
  const [paying, setPaying] = useState(false);
  const [booked, setBooked] = useState<Booked | null>(null);

  // The quote is only computed when every check passes; a failed check never prices anything.
  const quote = useMemo(() => {
    if (!eligibility.ok || !eligibility.nextRouteDay || !eligibility.serviceItem) return null;
    try {
      return computeCharge({
        id: PREVIEW_CHARGE_ID, accountId, siteId, lineType: 'event',
        baseCents: EXTRA_PICKUP_RATE_CENTS,
        // A flat table rate, not a hand-set amount (addendum C11), as billing prices every event exception.
        pricing: { ruleWon: 'standardRate' },
        servicedOn: eligibility.nextRouteDay,
        source: { ...EXTRA_PICKUP_SOURCE },
        description: `Extra pickup at ${site.address} on ${eligibility.nextRouteDay}`,
      });
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, [state, accountId, siteId, site, eligibility]);

  if (booked) {
    return (
      <div className="flex flex-col gap-3">
        <div className="tl-card flex flex-col gap-2" style={{ background: 'var(--color-ok-soft)', borderColor: 'transparent' }}>
          <div className="flex items-center gap-2">
            <span className="tl-pill tl-pill--ok">scheduled</span>
            <span className="font-medium">Extra pickup booked for {formatDayLong(booked.workOrder.scheduledFor)}</span>
          </div>
          <p className="text-sm text-ink-2">
            Set the cart out the night before. Our driver picks it up on {formatDayLong(booked.workOrder.scheduledFor)} with the regular route.
          </p>
        </div>
        <dl className="text-sm grid gap-x-3 gap-y-1" style={{ gridTemplateColumns: 'auto 1fr' }}>
          <dt className="text-ink-3">Work order</dt><dd className="font-mono">{booked.workOrder.id}</dd>
          <dt className="text-ink-3">Day</dt><dd>{formatDayLong(booked.workOrder.scheduledFor)}</dd>
          <dt className="text-ink-3">Request</dt><dd className="font-mono">{booked.request.id}</dd>
          <dt className="text-ink-3">Paid</dt><dd className="tl-money">{money(booked.payment.cents)} <span className="font-mono text-xs text-ink-3">{booked.payment.id}</span></dd>
          <dt className="text-ink-3">Charge</dt><dd className="font-mono text-xs">{booked.charge.id} (approved, posts on your next invoice)</dd>
        </dl>
        <div><button type="button" className="tl-button" onClick={onDone}>Back to requests</button></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-2">
        A one-off pickup of your cart on your next route day. We check three things first, then quote the price before you pay.
      </p>
      <CheckRows title="Checks" checks={eligibility.checks} />

      {!eligibility.ok && eligibility.reason && (
        <HandoffCard
          title="Extra pickup"
          reason={eligibility.reason}
          createRequest={{ kind: 'extraPickup', accountId, siteId }}
        >
          <div><button type="button" className="tl-button tl-button--secondary" onClick={onDone}>Back to requests</button></div>
        </HandoffCard>
      )}

      {eligibility.ok && typeof quote === 'string' && (
        <HandoffCard title="Extra pickup" reason={`Could not price the pickup: ${quote}`} createRequest={{ kind: 'extraPickup', accountId, siteId }}>
          <div><button type="button" className="tl-button tl-button--secondary" onClick={onDone}>Back to requests</button></div>
        </HandoffCard>
      )}

      {eligibility.ok && quote && typeof quote !== 'string' && eligibility.nextRouteDay && (
        <>
          <PriceStack charge={quote} day={eligibility.nextRouteDay} />
          <div className="flex gap-2">
            <button type="button" className="tl-button" onClick={() => setPaying(true)}>Pay {money(quote.totalCents)} and book</button>
            <button type="button" className="tl-button tl-button--secondary" onClick={onDone}>Cancel</button>
          </div>
          {paying && (
            <ExtraPickupPaySheet
              charge={quote}
              scheduledFor={eligibility.nextRouteDay}
              serviceItemId={eligibility.serviceItem?.id}
              containerId={eligibility.serviceItem?.containerIds[0]}
              onBooked={(b) => { setPaying(false); setBooked(b); }}
              onClose={() => setPaying(false)}
            />
          )}
        </>
      )}
    </div>
  );
}

export function PriceStack({ charge, day }: { charge: Charge; day: string }) {
  const feeRules = usePortal((s) => s.feeRules);
  const taxRules = usePortal((s) => s.taxRules);
  const sites = usePortal((s) => s.sites);
  const site = sites.find((s) => s.id === charge.siteId);
  const tax = taxRules.find((t) => t.zoneId === site?.zoneId);
  return (
    <div className="tl-card flex flex-col gap-1 text-sm" data-testid="price-stack">
      <div className="flex items-baseline justify-between mb-1">
        <span className="tl-label" style={{ margin: 0 }}>Price for {formatDayLong(day)}</span>
        <span className="text-xs text-ink-3">Extra pickup event rate</span>
      </div>
      <div className="flex justify-between"><span>Extra pickup (base)</span><span className="tl-money">{money(charge.baseCents)}</span></div>
      {charge.fees.map((f) => {
        const rule = feeRules.find((r) => r.id === f.feeRuleId);
        return (
          <div key={f.feeRuleId} className="flex justify-between">
            <span>{rule?.name ?? f.feeRuleId}{rule?.kind === 'percent' ? ` (${rule.value}%)` : ''}</span>
            <span className="tl-money">{money(f.cents)}</span>
          </div>
        );
      })}
      <div className="flex justify-between"><span>Tax{tax ? ` (${tax.ratePct}%)` : ''}</span><span className="tl-money">{money(charge.taxCents)}</span></div>
      <div className="flex justify-between font-semibold border-t border-border pt-1 mt-1"><span>Total due now</span><span className="tl-money">{money(charge.totalCents)}</span></div>
    </div>
  );
}

function ExtraPickupPaySheet({
  charge, scheduledFor, serviceItemId, containerId, onBooked, onClose,
}: {
  charge: Charge; scheduledFor: string; serviceItemId?: string; containerId?: string;
  onBooked: (b: Booked) => void; onClose: () => void;
}) {
  const state = usePortal();
  const saved = state.paymentMethods.find((m) => m.accountId === charge.accountId);
  const [useSaved, setUseSaved] = useState(Boolean(saved));
  const [token, setToken] = useState<PaymentToken | null>(null);
  const [saveToken, setSaveToken] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const method = useSaved ? saved?.kind : token?.kind;
  const methodLabel = useSaved && saved ? `${saved.brand} ending in ${saved.last4}` : token ? `${token.brand} ending in ${token.last4}` : null;
  const ready = method !== undefined;

  const confirm = () => {
    if (!ready || method === undefined) return;
    try {
      if (!useSaved && token && saveToken) {
        state.savePaymentMethod({ accountId: charge.accountId, kind: token.kind, last4: token.last4, tokenId: token.tokenId, brand: token.brand });
      }
      const input: Parameters<typeof state.bookExtraPickup>[0] = { accountId: charge.accountId, siteId: charge.siteId, charge, method, scheduledFor };
      if (serviceItemId) input.serviceItemId = serviceItemId;
      if (containerId) input.containerId = containerId;
      onBooked(state.bookExtraPickup(input));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Drawer title={`Pay ${money(charge.totalCents)} for an extra pickup`} eyebrow="Extra pickup" onClose={onClose}>
      <PriceStack charge={charge} day={scheduledFor} />
      <div className="flex flex-col gap-2">
        <span className="tl-label">Pay with</span>
        {saved && (
          <label className="tl-card flex items-center gap-3 cursor-pointer" style={{ borderColor: useSaved ? 'var(--color-accent)' : undefined }}>
            <input type="radio" name="xp-method" checked={useSaved} onChange={() => setUseSaved(true)} />
            <div className="flex-1">
              <div className="text-sm font-medium">{saved.brand} ending in {saved.last4}</div>
              <div className="text-xs text-ink-3">Saved {saved.kind === 'card' ? 'card' : 'bank account'} on file</div>
            </div>
            <span className="tl-pill tl-pill--ok">On file</span>
          </label>
        )}
        <label className="tl-card flex items-center gap-3 cursor-pointer" style={{ borderColor: !useSaved ? 'var(--color-accent)' : undefined }}>
          <input type="radio" name="xp-method" checked={!useSaved} onChange={() => setUseSaved(false)} />
          <div className="text-sm font-medium">{saved ? 'Use a different method' : 'Add a payment method'}</div>
        </label>
        {!useSaved && (
          <>
            <HostedField token={token} onToken={setToken} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={saveToken} onChange={(e) => setSaveToken(e.target.checked)} />
              Save this as my method on file
            </label>
          </>
        )}
      </div>
      {error && <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" className="tl-button tl-button--secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="tl-button" disabled={!ready} onClick={confirm}>Pay {money(charge.totalCents)}{methodLabel ? ` with ${methodLabel}` : ''}</button>
      </div>
      <p className="text-xs text-ink-3">
        This pickup is prepaid. The charge is approved now and posts on your next invoice with this payment applied to it. We never see your card or bank numbers; the processor holds them and gives us a token.
      </p>
    </Drawer>
  );
}
