// Stand-in for a processor's hosted payment field. In production this is an iframe the processor owns, so
// card numbers, expiry dates, CVCs, and bank account numbers never reach the portal. The stub keeps that
// boundary: it renders no text inputs at all and returns only a token id and a last four.

import { useState } from 'react';
import { tokenizeMockMethod, type PaymentMethodKind, type PaymentToken } from '../../lib/paymentToken';

export function HostedField({ token, onToken }: { token: PaymentToken | null; onToken: (t: PaymentToken) => void }) {
  const [kind, setKind] = useState<PaymentMethodKind>('card');

  return (
    <div className="tl-card flex flex-col gap-3" style={{ borderStyle: 'dashed' }}>
      <div className="flex items-center justify-between">
        <span className="tl-label" style={{ margin: 0 }}>Secure payment field</span>
        <span className="tl-pill">Hosted by the processor</span>
      </div>
      <div className="flex gap-2" role="radiogroup" aria-label="Method type">
        {(['card', 'ach'] as PaymentMethodKind[]).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            className={`tl-button ${kind === k ? '' : 'tl-button--secondary'}`}
            style={{ height: 32 }}
            onClick={() => setKind(k)}
            disabled={token !== null}
          >
            {k === 'card' ? 'Card' : 'Bank account (ACH)'}
          </button>
        ))}
      </div>
      {token ? (
        <div className="text-sm">
          <div className="font-medium">
            {token.brand} ending in {token.last4}
          </div>
          <div className="text-xs text-ink-3">
            Token <span className="font-mono">{token.tokenId}</span>. Only this token and the last four are stored.
          </div>
        </div>
      ) : (
        <>
          <div
            className="rounded-md text-xs text-ink-3 flex items-center justify-center"
            style={{ height: 44, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
          >
            {kind === 'card' ? 'Card number, expiry, and CVC are entered in the processor frame, not here' : 'Routing and account numbers are entered in the processor frame, not here'}
          </div>
          <button type="button" className="tl-button tl-button--secondary" onClick={() => onToken(tokenizeMockMethod(kind))}>
            Use a test {kind === 'card' ? 'card' : 'bank account'}
          </button>
        </>
      )}
    </div>
  );
}
