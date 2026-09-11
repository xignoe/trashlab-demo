// Requests a person handles end to end: a damaged or missing container, a bulky item, adding a cart, stopping or
// moving service, a billing question, and anything else. None of these can finish on their own (each needs a person
// to price, schedule, or answer), so the flow files one open Request whose note carries what the customer picked and
// wrote, then shows when a person will follow up. Nothing is charged or scheduled here.

import { useState } from 'react';
import { usePortal } from '../../store';
import { handoff } from '../../lib/handoff';
import { formatDate, formatDateTime, today } from '../../lib/clock';
import type { Request } from '../../../../types';

export type GeneralKind = 'damagedCart' | 'bulkyItem' | 'addCart' | 'stopService' | 'billingQuestion' | 'other';

interface Spec {
  intro: string;
  /** Heading for the reason list. The list is absent for "other", where the text is the whole request. */
  choiceLabel?: string;
  choices?: string[];
  /** When present the form asks for a date under this label. */
  dateLabel?: string;
  notePlaceholder: string;
  /** The text box must be filled in before the request can be sent. */
  noteRequired?: boolean;
}

export const GENERAL_SPECS: Record<GeneralKind, Spec> = {
  damagedCart: {
    intro: 'Tell us what is wrong with the cart or container at this site. A person checks the service record and schedules a repair or replacement.',
    choiceLabel: 'What happened',
    choices: ['Broken lid or wheel', 'Cracked or leaking', 'Missing or stolen', 'Wrong size delivered'],
    notePlaceholder: 'Which cart or container, and anything the driver should know',
  },
  bulkyItem: {
    intro: 'Large items do not fit in the cart. A person prices the pickup from what you list and confirms the day before anything is charged.',
    choiceLabel: 'What needs to go',
    choices: ['Furniture', 'Mattress or box spring', 'Appliance', 'Electronics', 'Yard debris or lumber', 'Something else'],
    dateLabel: 'Preferred day',
    notePlaceholder: 'How many items and roughly how big, for example: one couch and two chairs',
  },
  addCart: {
    intro: 'Add a cart to your service here. A person confirms the monthly price and the delivery day with you before anything changes.',
    choiceLabel: 'Which cart',
    choices: ['Recycling cart', 'Yard waste cart', 'Second trash cart'],
    notePlaceholder: 'Where to leave it, gate codes, anything else',
  },
  stopService: {
    intro: 'Stop service at this site, or move it to a new address. A person confirms the last pickup, collecting the containers, and your final bill.',
    choiceLabel: 'Why',
    choices: ['Moving out', 'Selling the property', 'Closing this location', 'Switching providers', 'Something else'],
    dateLabel: 'Last pickup on',
    notePlaceholder: 'Forwarding address for the final bill, or the new address if you want service there',
  },
  billingQuestion: {
    intro: 'Ask about a charge, an invoice, or a payment. The Billing tab also shows why each charge is on your bill.',
    choiceLabel: 'About',
    choices: ['A charge I do not recognize', 'A payment that is not showing', 'Update billing contact or address', 'Something else'],
    notePlaceholder: 'The invoice or charge, and what looks wrong',
    noteRequired: true,
  },
  other: {
    intro: 'Not listed above? Describe what you need in your own words and a person will pick it up.',
    notePlaceholder: 'Tell us what you need',
    noteRequired: true,
  },
};

export function isGeneralKind(kind: Request['kind']): kind is GeneralKind {
  return kind in GENERAL_SPECS;
}

export function GeneralRequestFlow({ kind, onDone }: { kind: GeneralKind; onDone: () => void }) {
  const state = usePortal();
  const { accountId, siteId } = state.session;
  const site = state.sites.find((s) => s.id === siteId);
  const spec = GENERAL_SPECS[kind];

  const [choice, setChoice] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [text, setText] = useState('');
  const [filed, setFiled] = useState<Request | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = (!spec.choices || choice !== null) && (!spec.noteRequired || text.trim() !== '');

  const submit = () => {
    if (!ready) return;
    setError(null);
    const note = [choice, date && spec.dateLabel ? `${spec.dateLabel} ${formatDate(date)}` : null, text.trim() || null]
      .filter(Boolean)
      .join('; ');
    try {
      setFiled(state.addRequest({ accountId, siteId, kind, status: 'open', createdVia: 'portal', note }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (filed) {
    return (
      <div className="flex flex-col gap-3" data-testid="general-request-sent">
        <div className="tl-card flex flex-col gap-2" style={{ background: 'var(--color-info-soft)', borderColor: 'transparent' }}>
          <div className="flex items-center gap-2">
            <span className="tl-pill tl-pill--info">open</span>
            <span className="font-medium">Request {filed.id} sent</span>
          </div>
          <p className="text-sm text-ink-2">A person will follow up by {formatDateTime(handoff(filed.note ?? '').followUpBy)}.</p>
        </div>
        <dl className="text-sm grid gap-x-3 gap-y-1" style={{ gridTemplateColumns: 'auto 1fr' }}>
          <dt className="text-ink-3">Site</dt><dd>{site?.address}{site?.poNumber ? ` (${site.poNumber})` : ''}</dd>
          <dt className="text-ink-3">Details</dt><dd>{filed.note}</dd>
        </dl>
        <div><button type="button" className="tl-button" onClick={onDone}>Back to requests</button></div>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }} data-testid="general-request-form">
      <p className="text-sm text-ink-2">{spec.intro}</p>

      <div className="flex flex-col gap-3" style={{ maxWidth: 640 }}>
        {spec.choices && (
          <fieldset>
            <legend className="tl-label">{spec.choiceLabel}</legend>
            <div className="flex flex-wrap gap-2">
              {spec.choices.map((c) => (
                <label
                  key={c}
                  className="tl-card text-sm flex items-center gap-2"
                  style={{ padding: '6px 10px', cursor: 'pointer', borderColor: choice === c ? 'var(--color-accent)' : undefined, background: choice === c ? 'var(--color-accent-soft)' : undefined }}
                >
                  <input type="radio" name={`${kind}-choice`} value={c} checked={choice === c} onChange={() => setChoice(c)} />
                  {c}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {spec.dateLabel && (
          <div>
            <label className="tl-label" htmlFor={`${kind}-date`}>{spec.dateLabel} <span className="text-ink-3">(optional)</span></label>
            <input id={`${kind}-date`} type="date" className="tl-field" style={{ maxWidth: 220 }} value={date} min={today()} onChange={(e) => setDate(e.target.value)} />
          </div>
        )}

        <div>
          <label className="tl-label" htmlFor={`${kind}-note`}>
            {spec.choices ? 'Details' : 'Your request'}{spec.noteRequired ? '' : <span className="text-ink-3"> (optional)</span>}
          </label>
          <textarea
            id={`${kind}-note`} className="tl-field" rows={3} style={{ height: 'auto', padding: 8 }}
            value={text} onChange={(e) => setText(e.target.value)} placeholder={spec.notePlaceholder}
          />
        </div>
      </div>

      <p className="text-xs text-ink-3">A person handles this. Nothing is charged or scheduled until they confirm it with you.</p>
      {error && <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="tl-button" disabled={!ready}>Send request</button>
        <button type="button" className="tl-button tl-button--secondary" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}
