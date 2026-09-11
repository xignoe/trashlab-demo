// "Hold or suspend" drawer (invariant 4). On an active or past due account the office chooses a vacation hold (with a
// resume date) or a suspension (non-payment or customer request), effective TODAY by default. On a held or suspended
// account the same drawer opens as "Resume" or "Reinstate". The preview is pure (buildHoldPreview on a shadow state):
// the status and item flips, a route stub per site whose projected stops flip between completed and skipped, the next
// billing run before and after, and for a reinstated suspension the proposed reinstatement fee through computeCharge.
// Confirm calls setAccountStatus (hold or suspend) or reinstateAccount (resume or reinstate).
import { useMemo, useState, type FormEvent } from 'react';
import { TODAY, addDays } from '../store/clock';
import { FREQUENCY_LABEL } from '../store/engine';
import { ROUTE_DAY_LONG, buildHoldPreview, type HoldDraft, type HoldMode, type HoldPreview, type RouteStubSite } from '../store/selectors';
import { entities, useStore, type SuspensionReason } from '../store/useStore';
import type { SyncStatus } from '../store/selectors';
import { Drawer } from './Drawer';
import type { DrawerResult } from './PaymentDrawer';
import {
  STATUS_LABEL,
  STUB_OUTCOME_LABEL,
  STUB_OUTCOME_PILL,
  SUSPENSION_REASON_LABEL,
  fmtDate,
  fmtDay,
  money,
  plural,
} from './format';

function StatusPill({ status }: { status: keyof typeof STATUS_LABEL }) {
  return <span className={`pill pill-${status}`}>{STATUS_LABEL[status]}</span>;
}

function BillingChip({ status }: { status: SyncStatus }) {
  const stale = status.state === 'stale';
  return (
    <span className={`chip${stale ? ' chip-stale' : ''}`} title={status.reason}>
      Billing {stale ? 'stale' : 'in sync'}
    </span>
  );
}

function RouteStub({ stub }: { stub: RouteStubSite }) {
  const { site, route, otherStops, stops } = stub;
  const flips = stops.filter((s) => s.now !== s.after).length;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row-title">
        <span>{site.address}</span>
        {route ? <code className="code">{route.id}</code> : <span className="meta">no route</span>}
      </div>
      {!route ? (
        <p className="change-note">This site is not on a route; it is served on call, so there are no route stops to skip.</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table table-dense" aria-label={`Route stops for ${site.address}`}>
              <thead>
                <tr>
                  <th>Stop</th>
                  <th>Source</th>
                  <th>Now</th>
                  <th>After confirm</th>
                </tr>
              </thead>
              <tbody>
                {stops.map((s) => (
                  <tr key={`${s.kind}|${s.date}|${s.event?.id ?? ''}`}>
                    <td className="nowrap">{fmtDay(s.date)}</td>
                    <td className="meta">{s.kind === 'recorded' ? `Recorded${s.event?.driver ? `, ${s.event.driver}` : ''}` : 'Projected'}</td>
                    <td><span className={`pill ${STUB_OUTCOME_PILL[s.now]}`}>{STUB_OUTCOME_LABEL[s.now]}</span></td>
                    <td>
                      <span className={`pill ${STUB_OUTCOME_PILL[s.after]}`}>{STUB_OUTCOME_LABEL[s.after]}</span>
                      {s.after !== s.now && <span className="status-text"> flips</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="meta">
            {ROUTE_DAY_LONG[route.day]} route, {plural(otherStops, 'other stop')} still run{otherStops === 1 ? 's' : ''} every {ROUTE_DAY_LONG[route.day]}.
            {' '}{flips ? `${plural(flips, 'projected stop')} change${flips === 1 ? 's' : ''} for this site.` : 'No projected stop changes for this site.'}
          </div>
        </>
      )}
    </div>
  );
}

function BillingEffect({ preview, hauler }: { preview: HoldPreview; hauler: string }) {
  const { draft, statusBefore } = preview;
  const cycle = preview.cycleDate ? fmtDate(preview.cycleDate) : 'the next job';
  let lead: string;
  let detail: string;
  if (draft.mode === 'suspend') {
    lead = 'Next billing run: no charges (suspended)';
    detail = `A suspended account produces no recurring or event charges (invariant 4). The ${money(preview.reinstatementFeeCents)} reinstatement fee from ${hauler} policy is due on reinstatement.`;
  } else if (draft.mode === 'hold') {
    lead = `Next invoice unchanged: ${money(preview.nextRunAfterCents)}`;
    detail = `Recurring charges continue during a vacation hold: ${hauler} does not prorate, so skipped pickups are not credited and the ${cycle} run bills the full period.`;
  } else if (statusBefore === 'suspended') {
    lead = `Charges resume on the ${cycle} run, plus a ${money(preview.reinstatementFeeCents)} reinstatement fee`;
    detail = 'The fee is proposed, not billed: billing owns the Charge table, so it waits in the account\'s proposed charges until billing takes it.';
  } else {
    lead = `Next invoice unchanged: ${money(preview.nextRunAfterCents)}`;
    detail = 'A hold never stopped billing, so resuming service changes no charge. No reinstatement fee applies to a hold.';
  }
  return (
    <>
      <div className="row-title"><span>{lead}</span></div>
      <p className="change-note">{detail}</p>
      <table className="table table-dense" aria-label="Next billing run before and after">
        <thead>
          <tr>
            <th />
            <th className="money">Before</th>
            <th className="money">After</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Next billing run{preview.cycleDate ? `, ${fmtDay(preview.cycleDate)}` : ''}</td>
            <td className="money">{money(preview.nextRunBeforeCents)}</td>
            <td className={`money${preview.nextRunAfterCents !== preview.nextRunBeforeCents ? ' status-text' : ''}`}>{money(preview.nextRunAfterCents)}</td>
          </tr>
        </tbody>
      </table>
      {preview.fee && (
        <div className="inset" style={{ marginTop: 8 }}>
          <div className="eyebrow">Proposed fee charge</div>
          <div className="row-title">
            <span>{preview.fee.description}</span>
            <span className="pill pill-warn">Proposed</span>
          </div>
          <div className="meta">
            Fee line, source manual <code className="code">{preview.fee.source.id}</code>, dated {fmtDate(preview.fee.servicedOn)}. Base {money(preview.fee.baseCents)}, fees {money(preview.fee.fees.reduce((s, f) => s + f.cents, 0))}, tax {money(preview.fee.taxCents)}, total <strong className="mono">{money(preview.fee.totalCents)}</strong>.
          </div>
        </div>
      )}
      <div className="cluster" style={{ marginTop: 8 }}>
        <BillingChip status={preview.billingBefore} />
        <span className="change-arrow" aria-hidden="true">to</span>
        <BillingChip status={preview.billingAfter} />
      </div>
    </>
  );
}

export function HoldDrawer({ accountId, onClose, onDone }: { accountId: string; onClose: () => void; onDone: (result: DrawerResult) => void }) {
  const store = useStore();
  const state = useMemo(() => entities(store), [store]);
  const { proposedCharges, statusChanges, setAccountStatus, reinstateAccount } = store;
  const account = state.billingAccounts.byId[accountId];
  const inForce = account?.status === 'suspended' || account?.status === 'hold';
  const hauler = state.haulers.byId[state.haulers.ids[0]]?.name ?? 'The hauler';

  const [choice, setChoice] = useState<Exclude<HoldMode, 'reinstate'>>(account?.status === 'pastDue' ? 'suspend' : 'hold');
  const [effectiveFrom, setEffectiveFrom] = useState(TODAY);
  const [resumeOn, setResumeOn] = useState(addDays(TODAY, 14));
  const [reason, setReason] = useState<SuspensionReason>(account?.status === 'pastDue' ? 'nonPayment' : 'customerRequest');
  const [note, setNote] = useState('');
  const [submitError, setSubmitError] = useState<string>();

  const mode: HoldMode = inForce ? 'reinstate' : choice;
  const draft: HoldDraft = {
    accountId,
    mode,
    effectiveFrom: mode === 'reinstate' ? TODAY : effectiveFrom,
    resumeOn: mode === 'hold' ? resumeOn : undefined,
    reason: mode === 'suspend' ? reason : undefined,
  };
  const preview = useMemo(
    () => (account ? buildHoldPreview(draft, state, { proposedCharges, statusChanges }) : undefined),
    // draft is rebuilt every render; its fields are the real dependencies.
    [accountId, mode, draft.effectiveFrom, draft.resumeOn, draft.reason, state, proposedCharges, statusChanges],
  );
  if (!account || !preview) return null;

  const lastChange = [...statusChanges].reverse().find((c) => c.accountId === accountId);
  const canConfirm = !preview.error;
  const flippedItems = preview.items.filter((i) => i.before !== i.after).length;
  const title = mode === 'reinstate' ? (account.status === 'suspended' ? 'Reinstate account' : 'Resume service') : 'Hold or suspend';
  const confirmLabel =
    mode === 'hold' ? 'Place vacation hold' : mode === 'suspend' ? 'Suspend account' : account.status === 'suspended' ? 'Reinstate account' : 'Resume service';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canConfirm) return;
    try {
      if (mode === 'reinstate') {
        const { account: next, fee } = reinstateAccount(accountId, { note: note.trim() || undefined });
        onDone({
          title: account.status === 'suspended' ? `${accountId} reinstated` : `Service resumed on ${accountId}`,
          detail: `Status ${STATUS_LABEL[next.status]}, ${plural(flippedItems, 'service line')} active again.${
            fee ? ` Reinstatement fee ${fee.id} proposed at ${money(fee.totalCents)}; billing chip stale until billing takes it.` : ''
          }`,
        });
      } else {
        const next = setAccountStatus(accountId, mode === 'hold' ? 'hold' : 'suspended', {
          effectiveFrom,
          resumeOn: mode === 'hold' ? resumeOn : undefined,
          reason: mode === 'suspend' ? reason : undefined,
          note: note.trim() || undefined,
        });
        onDone({
          title: mode === 'hold' ? `Vacation hold placed on ${accountId}` : `${accountId} suspended`,
          detail:
            mode === 'hold'
              ? `From ${fmtDate(effectiveFrom)}, resume ${fmtDate(resumeOn)}. ${plural(flippedItems, 'service line')} held; billing continues, no proration.`
              : `${SUSPENSION_REASON_LABEL[reason]}, from ${fmtDate(effectiveFrom)}. Status ${STATUS_LABEL[next.status]}, ${plural(flippedItems, 'service line')} held; no charges will be generated.`,
        });
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Drawer
      eyebrow={mode === 'reinstate' ? 'Hold or suspend' : 'Account status'}
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="hold-form" className={`btn ${mode === 'suspend' ? 'btn-danger' : 'btn-primary'}`} disabled={!canConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <form id="hold-form" className="drawer-form" onSubmit={submit} noValidate>
        {mode === 'reinstate' ? (
          <section className="inset" aria-label="Current status">
            <div className="eyebrow">Now</div>
            <div className="row-title">
              <StatusPill status={account.status} />
              <span>{account.status === 'suspended' ? 'Service suspended' : 'Vacation hold in place'}</span>
            </div>
            <div className="meta">
              {lastChange && (lastChange.kind === 'hold' || lastChange.kind === 'suspend')
                ? `${lastChange.kind === 'hold' ? 'Hold' : 'Suspended'} ${fmtDate(lastChange.effectiveFrom)}${lastChange.reason ? `, ${SUSPENSION_REASON_LABEL[lastChange.reason].toLowerCase()}` : ''}${lastChange.resumeOn ? `, resume ${fmtDate(lastChange.resumeOn)}` : ''} (${lastChange.id}).`
                : account.status === 'suspended'
                  ? 'Suspended before this session; the route has been skipping this account.'
                  : 'On hold before this session.'}
              {' '}{account.status === 'suspended' ? 'Reinstating' : 'Resuming'} takes effect today, {fmtDate(TODAY)}.
            </div>
          </section>
        ) : (
          <>
            <div className="field">
              <span className="eyebrow" id="hold-choice-label">Action</span>
              <div className="cluster" role="radiogroup" aria-labelledby="hold-choice-label">
                {(['hold', 'suspend'] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={choice === c}
                    className={`btn btn-sm ${choice === c ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => { setChoice(c); setSubmitError(undefined); }}
                  >
                    {c === 'hold' ? 'Vacation hold' : 'Suspension'}
                  </button>
                ))}
              </div>
              <span className="meta">
                {choice === 'hold'
                  ? 'Pickups pause until the resume date. Billing continues: no proration.'
                  : 'Pickups stop and no charges are generated until the account is reinstated.'}
              </span>
            </div>
            <div className="field-row field-row-even">
              <label className="field">
                <span className="eyebrow">Effective</span>
                <input className="input" type="date" min={TODAY} value={effectiveFrom} onChange={(e) => { setEffectiveFrom(e.target.value); setSubmitError(undefined); }} />
              </label>
              {choice === 'hold' ? (
                <label className="field">
                  <span className="eyebrow">Resume on</span>
                  <input className="input" type="date" min={addDays(effectiveFrom || TODAY, 1)} value={resumeOn} onChange={(e) => { setResumeOn(e.target.value); setSubmitError(undefined); }} />
                </label>
              ) : (
                <label className="field">
                  <span className="eyebrow">Reason</span>
                  <select className="select" value={reason} onChange={(e) => { setReason(e.target.value as SuspensionReason); setSubmitError(undefined); }}>
                    <option value="nonPayment">{SUSPENSION_REASON_LABEL.nonPayment}</option>
                    <option value="customerRequest">{SUSPENSION_REASON_LABEL.customerRequest}</option>
                  </select>
                </label>
              )}
            </div>
          </>
        )}

        <label className="field">
          <span className="eyebrow">Note (optional)</span>
          <textarea className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === 'hold' ? 'For example, away visiting family' : 'What the customer said'} />
          <span className="meta">{mode === 'hold' ? 'Saved on the vacation hold office note.' : 'Saved on the status change.'}</span>
        </label>

        {preview.error && <div className="form-error" role="alert">{preview.error}</div>}
        {submitError && <div className="form-error" role="alert">{submitError}</div>}

        <div className="eyebrow drawer-section-label">Preview before confirm</div>
        <section className="inset" aria-label="Status and service lines">
          <div className="eyebrow">Writes</div>
          <div className="cluster">
            <span>Account</span>
            <StatusPill status={preview.statusBefore} />
            <span className="change-arrow" aria-hidden="true">to</span>
            <StatusPill status={preview.statusAfter} />
          </div>
          {preview.items.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 6 }}>
              <table className="table table-dense" aria-label="Service lines before and after">
                <thead>
                  <tr>
                    <th>Service line</th>
                    <th>Before</th>
                    <th>After</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.items.map(({ item, catalog, site, before, after }) => (
                    <tr key={item.id}>
                      <td>
                        <div>{catalog?.name ?? item.catalogId}{item.qty > 1 ? ` x${item.qty}` : ''}, {FREQUENCY_LABEL[item.frequency]}</div>
                        <div className="meta">{site.address} · <code className="code">{item.id}</code></div>
                      </td>
                      <td>{before}</td>
                      <td className={after !== before ? 'status-text' : undefined}>{after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="meta">Effective dates stay as they are; held lines are not ended. {mode === 'hold' ? 'The vacation hold is recorded as an office note (Portal owns Requests).' : ''}</div>
        </section>

        <section className="inset" aria-label="Route stub">
          <div className="eyebrow">Route stub</div>
          {preview.routeStub.length === 0 ? (
            <p className="change-note">No sites on this account.</p>
          ) : (
            preview.routeStub.map((stub) => <RouteStub key={stub.site.id} stub={stub} />)
          )}
        </section>

        <section className="inset" aria-label="Billing effect">
          <div className="eyebrow">Billing effect</div>
          <BillingEffect preview={preview} hauler={hauler} />
        </section>
      </form>
    </Drawer>
  );
}
