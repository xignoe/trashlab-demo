// Requests: a picker of the request kinds this account can use, the flow for the one picked, and the open items
// list. The picker only offers what can succeed: the quote is for commercial accounts, and cart size change needs
// an active residential cart, so opening the picker never files a request by itself.

import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { ExtraPickupFlow } from './requests/ExtraPickupFlow';
import { VacationHoldFlow } from './requests/VacationHoldFlow';
import { CartChangeFlow } from './requests/CartChangeFlow';
import { MissedPickupFlow } from './requests/MissedPickupFlow';
import { QuoteRequestFlow } from './requests/QuoteRequestFlow';
import { OpenItems } from './requests/OpenItems';
import { accountHasResidentialCart } from '../store/selectors';
import type { Request } from '../types';

type Kind = Request['kind'];

const PICKER: { kind: Kind; label: string; blurb: string; commercialOnly?: boolean; needsCart?: boolean }[] = [
  { kind: 'extraPickup', label: 'Extra pickup', blurb: 'A one-off pickup on your next route day, paid up front.' },
  { kind: 'vacationHold', label: 'Vacation hold', blurb: 'Pause service for 7 to 90 days while you are away.' },
  { kind: 'cartChange', label: 'Cart size change', blurb: 'Swap between the 96 and 64 gallon trash cart.', needsCart: true },
  { kind: 'missedPickup', label: 'Missed pickup', blurb: 'Tell us a stop was missed and see what the driver recorded.' },
  { kind: 'quote', label: 'Request a quote', blurb: 'Price a new or larger container for a commercial site.', commercialOnly: true },
];

export function Requests() {
  const state = useStore();
  const { accountId, siteId } = state.session;
  const account = state.accounts.find((a) => a.id === accountId)!;
  const party = state.parties.find((p) => p.id === account.payerPartyId);
  const site = state.sites.find((s) => s.id === siteId)!;
  const commercial = party?.kind !== 'homeowner';
  const [kind, setKind] = useState<Kind | null>(null);

  const hasCart = accountHasResidentialCart(state, accountId);

  // Switching account closes any flow. Switching site closes a site-bound flow; the quote form stays open and
  // takes the new site as its default.
  useEffect(() => { setKind(null); }, [accountId]);
  useEffect(() => { setKind((k) => (k === 'quote' ? k : null)); }, [siteId]);

  const options = PICKER.filter((p) => (!p.commercialOnly || commercial) && (!p.needsCart || hasCart));
  const active = options.find((p) => p.kind === kind);
  const close = () => setKind(null);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Requests</h1>
        <p className="text-ink-2 text-sm">{party?.name}, {site.address}{site.poNumber ? ` (${site.poNumber})` : ''}</p>
      </div>

      <section className="tl-panel">
        <h2 className="text-lg font-medium mb-3">What do you need?</h2>
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 5)}, minmax(0, 1fr))` }} role="radiogroup" aria-label="Request type">
          {options.map((p) => {
            const selected = p.kind === kind;
            return (
              <button
                key={p.kind}
                type="button"
                role="radio"
                aria-checked={selected}
                data-kind={p.kind}
                className="tl-card text-left flex flex-col gap-1"
                style={{ borderColor: selected ? 'var(--color-accent)' : undefined, background: selected ? 'var(--color-accent-soft)' : undefined, cursor: 'pointer' }}
                onClick={() => setKind(selected ? null : p.kind)}
              >
                <span className="font-medium text-sm">{p.label}</span>
                <span className="text-xs text-ink-3">{p.blurb}</span>
              </button>
            );
          })}
        </div>
      </section>

      {active && (
        <section className="tl-panel" data-flow={active.kind}>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-medium">{active.label}</h2>
            <button type="button" className="tl-button tl-button--ghost" style={{ height: 28, padding: '0 8px' }} onClick={close}>Close</button>
          </div>
          {active.kind === 'extraPickup' && <ExtraPickupFlow key={siteId} onDone={close} />}
          {active.kind === 'vacationHold' && <VacationHoldFlow key={siteId} onDone={close} />}
          {active.kind === 'cartChange' && <CartChangeFlow key={siteId} onDone={close} />}
          {active.kind === 'missedPickup' && <MissedPickupFlow key={siteId} onDone={close} onExtraPickup={() => setKind('extraPickup')} />}
          {active.kind === 'quote' && <QuoteRequestFlow key={accountId} onDone={close} />}
        </section>
      )}

      <OpenItems accountId={accountId} />
    </div>
  );
}
