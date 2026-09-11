// Shared end state for any request flow that fails a check. Renders the handoff sentence and, when the flow
// asks for it, creates one Request with status open and note = reason so the office sees it in the queue.

import { useEffect, useRef, useState } from 'react';
import { handoff, handoffSentence } from '../lib/handoff';
import { usePortal } from '../store';
import { formatDateTime } from '../lib/clock';
import type { Request } from '../../../types';

export interface HandoffCardProps {
  reason: string;
  /** Short line above the sentence, for example "Extra pickup". */
  title?: string;
  /** When present the card creates a Request of this kind with status open and note = reason, once. */
  createRequest?: { kind: Request['kind']; accountId: string; siteId: string };
  /** Called with the created request so the flow can show its id or move on. */
  onCreated?: (request: Request) => void;
  children?: React.ReactNode;
}

export function HandoffCard({ reason, title, createRequest, onCreated, children }: HandoffCardProps) {
  const addRequest = usePortal((s) => s.addRequest);
  const h = handoff(reason);
  const [created, setCreated] = useState<Request | null>(null);
  // The ref holds the one Request this card creates. StrictMode runs the effect twice in development; the second
  // run finds the ref filled, writes nothing, and still shows the id, so exactly one Request exists per card.
  const createdRef = useRef<Request | null>(null);

  useEffect(() => {
    if (!createRequest) return;
    if (!createdRef.current) {
      createdRef.current = addRequest({
        accountId: createRequest.accountId, siteId: createRequest.siteId, kind: createRequest.kind,
        status: 'open', createdVia: 'portal', note: reason,
      });
      onCreated?.(createdRef.current);
    }
    setCreated(createdRef.current);
    // Runs once per mounted card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="tl-card flex flex-col gap-2"
      role="status"
      style={{ background: 'var(--color-warn-soft)', borderColor: 'var(--color-warn)' }}
      data-testid="handoff-card"
    >
      <div className="flex items-center gap-2">
        <span className="tl-pill tl-pill--warn">Handed to a person</span>
        {title && <span className="text-sm font-medium">{title}</span>}
      </div>
      <p className="text-sm">{handoffSentence(h)}</p>
      <dl className="text-xs grid gap-x-3 gap-y-1" style={{ gridTemplateColumns: 'auto 1fr' }}>
        <dt className="text-ink-3">Reason</dt><dd>{reason}</dd>
        <dt className="text-ink-3">Follow up by</dt><dd>{formatDateTime(h.followUpBy)}</dd>
        {created && (
          <>
            <dt className="text-ink-3">Request</dt>
            <dd><span className="font-mono">{created.id}</span> is open in your items list</dd>
          </>
        )}
      </dl>
      {children}
    </div>
  );
}
