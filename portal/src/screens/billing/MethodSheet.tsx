// Save or replace the account's method on file through the hosted field stub.

import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { Drawer } from '../../components/Drawer';
import { HostedField } from './HostedField';
import type { PaymentToken } from '../../lib/paymentToken';

export function MethodSheet({
  accountId, reason, onSaved, onClose,
}: { accountId: string; reason?: string; onSaved: () => void; onClose: () => void }) {
  const savePaymentMethod = useStore((s) => s.savePaymentMethod);
  const existing = useStore((s) => s.paymentMethods.find((m) => m.accountId === accountId));
  const [token, setToken] = useState<PaymentToken | null>(null);

  const save = () => {
    if (!token) return;
    savePaymentMethod({ accountId, kind: token.kind, last4: token.last4, tokenId: token.tokenId, brand: token.brand });
    onSaved();
  };

  return (
    <Drawer title={existing ? 'Replace your saved method' : 'Save a payment method'} eyebrow="Method on file" onClose={onClose}>
      {reason && <p className="text-sm text-ink-2">{reason}</p>}
      {existing && (
        <p className="text-sm text-ink-3">
          Currently {existing.brand} ending in {existing.last4}. Saving a new method replaces it.
        </p>
      )}
      <HostedField token={token} onToken={setToken} />
      <div className="flex gap-2 justify-end">
        <button type="button" className="tl-button tl-button--secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="tl-button" disabled={!token} onClick={save}>
          {existing ? 'Replace method' : 'Save method'}
        </button>
      </div>
    </Drawer>
  );
}
