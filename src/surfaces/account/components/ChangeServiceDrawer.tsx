// "Change service" drawer (invariant 3). Opened from a service row (replace that item), a site header (add a line),
// or the side column button (replace the first active line at the first site). The preview is computed purely from
// buildServiceChangePreview on the live state: the WorkOrder dispatch will get, old versus new price with sources,
// the no-proration note for a mid-cycle change, and the next invoice before and after from previewNextRun on a
// shadow copy. Confirm calls changeServiceItem, which ends the old item (never deletes it), adds the new one, creates
// the WorkOrder, and files the phone request as a scheduled Request the portal shows (box 3.6).
import { useMemo, useState, type FormEvent } from 'react';
import { today } from '../lib/clock';
import { FREQUENCY_LABEL } from '../lib/engine';
import type { ServiceChangeArgs, ServiceChangePlan } from '../lib/types';
import {
  defaultChangeDate,
  useAccountData,
  buildServiceChangePreview,
  catalogForSite,
  priceableFrequencies,
  type ChangeLineView,
  type ServiceChangePreview,
} from '../selectors';
import { useStore } from '../../../store/useStore';
import type { Db } from '../../../store/db';
import type { Charge, Frequency, ServiceItem, Site } from '../../../types';
import { Drawer } from './Drawer';
import { RULE_LABEL, RULE_PILL, WO_KIND_LABEL, capitalize, fmtDate, fmtPeriod, money } from './format';

export interface ChangeServiceTarget {
  accountId: string;
  siteId: string;
  /** Present when opened from a service row: the item being replaced. Absent: add a line. */
  replaceItemId?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function signedMoney(cents: number): string {
  if (cents === 0) return '$0.00';
  return cents > 0 ? `+${money(cents)}` : money(cents);
}

function itemLabel(item: ServiceItem, state: Db): string {
  const catalog = state.catalog.find((c) => c.id === item.catalogId);
  const serials = item.containerIds.map((id) => state.containers.find((c) => c.id === id)?.serial).filter(Boolean).join(', ');
  return `${catalog?.name ?? item.catalogId}${item.qty > 1 ? ` x${item.qty}` : ''}, ${FREQUENCY_LABEL[item.frequency]}${serials ? ` (${serials})` : ''}`;
}

/** Keep the preferred frequency when it has a price, else the first one that does. */
function pickFrequency(options: Frequency[], ...preferred: (Frequency | undefined)[]): Frequency {
  for (const f of preferred) if (f && options.includes(f)) return f;
  return options[0] ?? preferred.find(Boolean) ?? 'weekly';
}

function LineCell({ line, empty }: { line?: ChangeLineView; empty: string }) {
  if (!line) return <span className="muted">{empty}</span>;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="status-text">{line.catalog.name}{line.qty > 1 ? ` x${line.qty}` : ''}</div>
      <div className="meta">{capitalize(FREQUENCY_LABEL[line.frequency])}</div>
      {line.price && line.lineCents !== undefined ? (
        <>
          <div className="mono">{money(line.lineCents)} <span className="meta">per {line.per}</span></div>
          <div className="cluster">
            <span className={`pill ${RULE_PILL[line.price.ruleWon]}`}>{RULE_LABEL[line.price.ruleWon]}</span>
            <code className="code">{line.price.contractId ?? line.price.rateVersionId}</code>
          </div>
        </>
      ) : (
        <div className="danger-text meta">{line.priceError ?? 'No price'}</div>
      )}
    </div>
  );
}

function lineDiff(before: Charge[], after: Charge[]) {
  const key = (c: Charge) => `${c.source.type}|${c.source.id}`;
  const beforeKeys = new Set(before.map(key));
  const afterKeys = new Set(after.map(key));
  return { dropped: before.filter((c) => !afterKeys.has(key(c))), added: after.filter((c) => !beforeKeys.has(key(c))) };
}

function PreviewPanel({ preview }: { preview: ServiceChangePreview }) {
  const { plan, account, hauler, currentCycle, before, after, oldLine, newLine } = preview;
  if (!plan || !after) return null;
  const wo = plan.workOrder;
  const haulerName = hauler?.name ?? 'The hauler';
  const noProration = hauler?.policy.proration === 'none';
  const cycleDate = before.cycleDate;
  const { dropped, added } = lineDiff(before.recurring, after.recurring);
  const startsAfterNextRun = Boolean(cycleDate && preview.firstBilledOn && preview.firstBilledOn > cycleDate);
  const suspended = account.status === 'suspended';

  return (
    <>
      <section className="inset" aria-label="Dispatch effect">
        <div className="eyebrow">Dispatch effect</div>
        <div className="row-title">
          <span>{WO_KIND_LABEL[wo.kind]} work order</span>
          <code className="code">{wo.id}</code>
          <span className="pill pill-info">Open</span>
        </div>
        <dl className="dl">
          <dt>Scheduled for</dt>
          <dd>{fmtDate(wo.scheduledFor)}</dd>
          <dt>Site</dt>
          <dd>{preview.site.address}</dd>
          <dt>Pull</dt>
          <dd>
            {wo.kind === 'swap' && preview.pull.length
              ? preview.pull.map((c) => (
                  <span key={c.id} className="cluster">
                    {oldLine?.catalog.name} <code className="code">{c.serial}</code>
                  </span>
                ))
              : <span className="muted">nothing, this adds a line</span>}
          </dd>
          <dt>Drop</dt>
          <dd className="cluster">
            {newLine?.catalog.name} <code className="code">{plan.container.serial}</code> <span className="meta">new container</span>
          </dd>
        </dl>
        <div className="meta">The dispatch chip goes stale until this work order is scheduled on the {preview.site.routeId ? 'route' : 'board'}.</div>
      </section>

      <section className="inset" aria-label="Billing effect">
        <div className="eyebrow">Billing effect</div>
        <div className="change-compare">
          <div>
            <div className="meta">Before</div>
            <LineCell line={oldLine} empty="No line (adding)" />
          </div>
          <div aria-hidden="true" className="change-arrow">to</div>
          <div>
            <div className="meta">After</div>
            <LineCell line={newLine} empty="" />
          </div>
        </div>
        {oldLine?.lineCents !== undefined && newLine?.lineCents !== undefined && oldLine.per === newLine.per && (
          <div className="meta">
            Rate change {signedMoney(newLine.lineCents - oldLine.lineCents)} per {newLine.per}, priced on {fmtDate(plan.newItem.effectiveFrom)}.
          </div>
        )}

        {currentCycle && (
          <p className="change-note">
            {currentCycle.midCycle ? (
              <>
                <strong>Current cycle ({fmtPeriod(currentCycle.period)}): no adjustment{noProration ? `, ${haulerName} does not prorate` : ''}.</strong>{' '}
                {oldLine
                  ? `The ${oldLine.catalog.name} stays billed through ${fmtDate(currentCycle.period.end)}${currentCycle.invoice ? ` as posted on ${currentCycle.invoice.number}` : ''}; no credit is issued for the days after ${fmtDate(plan.newItem.effectiveFrom)}.`
                  : `The new line is not billed for the rest of this cycle.`}
              </>
            ) : (
              <strong>Takes effect on the cycle date {fmtDate(currentCycle.period.start)}, so there is no partial period to settle.</strong>
            )}
          </p>
        )}

        {suspended ? (
          <p className="change-note">Suspended: no charges will be generated, so the next run stays at $0.00 until the account is reinstated.</p>
        ) : cycleDate ? (
          <>
            <div className="kv change-kv">
              <div className="kv-item">
                <div className="eyebrow">Next invoice before</div>
                <div className="kv-value mono">{money(before.totalCents)}</div>
              </div>
              <div className="kv-item">
                <div className="eyebrow">After</div>
                <div className="kv-value mono">{money(after.totalCents)}</div>
              </div>
              <div className="kv-item">
                <div className="eyebrow">Change</div>
                <div className={`kv-value mono${preview.deltaCents < 0 ? ' delta-down' : preview.deltaCents > 0 ? ' delta-up' : ''}`}>{signedMoney(preview.deltaCents)}</div>
                <div className="meta">{preview.deltaCents} cents; base {signedMoney(preview.baseDeltaCents)} before fees and tax</div>
              </div>
            </div>
            <div className="meta">
              Next run {fmtDate(cycleDate)}.{' '}
              {startsAfterNextRun
                ? `The new line first bills on the ${fmtDate(preview.firstBilledOn)} run, after the next one, so the next invoice ${preview.deltaCents === 0 ? 'does not change' : 'changes only by the ended line'}.`
                : preview.firstBilledOn
                  ? `The new line first bills on the ${fmtDate(preview.firstBilledOn)} run.`
                  : ''}
            </div>
            {(dropped.length > 0 || added.length > 0) && (
              <table className="table table-dense" aria-label="Next run lines that change">
                <tbody>
                  {dropped.map((c) => (
                    <tr key={c.id}>
                      <td><span className="pill pill-danger">Drops</span></td>
                      <td>{c.description}</td>
                      <td className="money">{money(-c.totalCents)}</td>
                    </tr>
                  ))}
                  {added.map((c) => (
                    <tr key={c.id}>
                      <td><span className="pill pill-ok">Adds</span></td>
                      <td>{c.description}</td>
                      <td className="money">{signedMoney(c.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : (
          <p className="change-note">Billed per job: a service change does not add a recurring line. Hauls bill as they happen.</p>
        )}
      </section>
    </>
  );
}

export function ChangeServiceDrawer({
  target,
  onClose,
  onDone,
}: {
  target: ChangeServiceTarget;
  onClose: () => void;
  onDone: (plan: ServiceChangePlan) => void;
}) {
  const { db: state } = useAccountData();
  const changeServiceItem = useStore((s) => s.changeServiceItem);
  const TODAY = today();
  const DEFAULT_CHANGE_DATE = useMemo(() => defaultChangeDate(), []);

  const sites = useMemo(() => state.sites.filter((s) => s.accountId === target.accountId), [state.sites, target.accountId]);
  const [siteId, setSiteId] = useState(target.siteId);
  const site: Site | undefined = state.sites.find((r) => r.id === siteId);
  const activeItems = useMemo(
    () => state.serviceItems.filter((si) => si.siteId === siteId && si.status !== 'ended'),
    [state.serviceItems, siteId],
  );
  const catalog = useMemo(() => (site ? catalogForSite(site, state) : []), [site, state]);

  const initialItem = target.replaceItemId ? state.serviceItems.find((r) => r.id === target.replaceItemId) : undefined;
  const [replaceItemId, setReplaceItemId] = useState(target.replaceItemId ?? '');
  const [catalogId, setCatalogId] = useState(initialItem?.catalogId ?? catalog[0]?.id ?? '');
  const [qtyText, setQtyText] = useState(String(initialItem?.qty ?? 1));
  const [effectiveFrom, setEffectiveFrom] = useState(DEFAULT_CHANGE_DATE);
  const priceDate = ISO_DATE.test(effectiveFrom) ? effectiveFrom : TODAY;
  const frequencyOptions = useMemo(
    () => (site && catalogId ? priceableFrequencies(catalogId, site, priceDate, state) : []),
    [site, catalogId, priceDate, state],
  );
  const [frequency, setFrequency] = useState<Frequency>(() =>
    site && catalogId ? pickFrequency(priceableFrequencies(catalogId, site, priceDate, state), initialItem?.frequency) : 'weekly',
  );
  const [submitError, setSubmitError] = useState<string>();

  const qty = Number(qtyText);
  const qtyError = !Number.isInteger(qty) || qty < 1 ? 'Quantity must be a whole number of at least 1' : undefined;
  const dateError = !ISO_DATE.test(effectiveFrom)
    ? 'Pick an effective date'
    : effectiveFrom < TODAY
      ? `Effective date cannot be before today, ${fmtDate(TODAY)}`
      : undefined;

  const args: ServiceChangeArgs = { siteId, replaceItemId: replaceItemId || undefined, catalogId, qty, frequency, effectiveFrom, createdVia: 'phone' };
  const preview = useMemo(
    () => (qtyError || dateError || !catalogId ? undefined : buildServiceChangePreview(args, state)),
    // args is rebuilt each render from these fields, so the fields are the dependencies, not the object.
    [state, siteId, replaceItemId, catalogId, qty, frequency, effectiveFrom, qtyError, dateError],
  );

  const chooseSite = (id: string) => {
    const next = state.sites.find((r) => r.id === id);
    setSiteId(id);
    setReplaceItemId('');
    const options = next ? catalogForSite(next, state) : [];
    const cat = options[0]?.id ?? '';
    setCatalogId(cat);
    setQtyText('1');
    if (next && cat) setFrequency(pickFrequency(priceableFrequencies(cat, next, priceDate, state)));
    setSubmitError(undefined);
  };
  const chooseReplace = (id: string) => {
    setReplaceItemId(id);
    const item = id ? state.serviceItems.find((r) => r.id === id) : undefined;
    if (item) {
      setCatalogId(item.catalogId);
      setQtyText(String(item.qty));
      setFrequency(item.frequency);
    }
    setSubmitError(undefined);
  };
  const chooseCatalog = (id: string) => {
    setCatalogId(id);
    const replaced = replaceItemId ? state.serviceItems.find((r) => r.id === replaceItemId) : undefined;
    if (site) setFrequency(pickFrequency(priceableFrequencies(id, site, priceDate, state), frequency, replaced?.frequency));
    setSubmitError(undefined);
  };

  const canConfirm = Boolean(preview?.plan) && !qtyError && !dateError;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canConfirm) return;
    try {
      const plan = changeServiceItem(args);
      onDone(plan);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  };

  const replacing = Boolean(replaceItemId);
  const frequencyChoices = frequencyOptions.includes(frequency) ? frequencyOptions : [...frequencyOptions, frequency];

  return (
    <Drawer
      eyebrow="Change service"
      title={replacing ? 'Change a service line' : 'Add a service line'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="change-service-form" className="btn btn-primary" disabled={!canConfirm}>
            {preview?.plan ? `Confirm and create ${WO_KIND_LABEL[preview.plan.workOrder.kind].toLowerCase()}` : 'Confirm change'}
          </button>
        </>
      }
    >
      <form id="change-service-form" className="drawer-form" onSubmit={submit} noValidate>
        {sites.length > 1 ? (
          <label className="field">
            <span className="eyebrow">Site</span>
            <select className="select" value={siteId} onChange={(e) => chooseSite(e.target.value)}>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.address}{s.poNumber ? ` (PO ${s.poNumber})` : ''}</option>
              ))}
            </select>
          </label>
        ) : (
          <div className="field">
            <span className="eyebrow">Site</span>
            <div className="kv-value">{site?.address}</div>
          </div>
        )}

        <label className="field">
          <span className="eyebrow">Replaces</span>
          <select className="select" value={replaceItemId} onChange={(e) => chooseReplace(e.target.value)}>
            <option value="">Nothing, add a new line</option>
            {activeItems.map((si) => (
              <option key={si.id} value={si.id}>{itemLabel(si, state)}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="eyebrow">New service</span>
          <select className="select" value={catalogId} onChange={(e) => chooseCatalog(e.target.value)}>
            {catalog.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {site && <span className="meta">Showing {catalog[0]?.lob ?? ''} services for this site's route.</span>}
        </label>

        <div className="field-row">
          <label className="field">
            <span className="eyebrow">Qty</span>
            <input
              className="input input-mono"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={qtyText}
              onChange={(e) => setQtyText(e.target.value)}
              aria-invalid={qtyError ? true : undefined}
            />
          </label>
          <label className="field">
            <span className="eyebrow">Frequency</span>
            <select className="select" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
              {frequencyChoices.map((f) => (
                <option key={f} value={f}>{capitalize(FREQUENCY_LABEL[f])}{frequencyOptions.includes(f) ? '' : ' (no published price)'}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span className="eyebrow">Effective from</span>
          <input
            className="input input-mono"
            type="date"
            min={TODAY}
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            aria-invalid={dateError ? true : undefined}
          />
          <span className="meta">Defaults to next Monday, {fmtDate(DEFAULT_CHANGE_DATE)}. The old line ends and the new one starts on this date.</span>
        </label>

        {(qtyError || dateError) && <div className="form-error" role="alert">{qtyError ?? dateError}</div>}
        {submitError && <div className="form-error" role="alert">{submitError}</div>}

        <div className="eyebrow drawer-section-label">Preview before confirm</div>
        {!preview ? null : preview.noop ? (
          <p className="change-note">This is the line as it is today. Pick a different service, quantity, or frequency to see the dispatch and billing effect.</p>
        ) : preview.error ? (
          <div className="form-error" role="alert">{preview.error}</div>
        ) : (
          <PreviewPanel preview={preview} />
        )}
      </form>
    </Drawer>
  );
}
