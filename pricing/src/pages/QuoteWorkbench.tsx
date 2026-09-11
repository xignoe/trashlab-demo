import { useMemo, useState } from 'react';
import type { Frequency } from '../types';
import { useStore } from '../store/store';
import { FREQUENCY_LABEL, toEngineState } from '../store/engine';
import { TODAY, yyyymmdd } from '../store/dates';
import {
  ACCESS_FLAGS, DEFAULT_ASSUMPTIONS, MATERIALS, MATERIAL_LABEL, NO_ACCESS_FLAGS, costToServe, liftsBasisFor, type AccessFlags, type CostAssumptions, type Material,
} from '../store/costToServe';
import {
  addressSuggestions, containerOptions, defaultMaterial, exceptionSummary, frequenciesFor, lastOverrideFor, lineDefaultsFor, listPriceFor, matchAddress, planSave, qtyFor,
  type AddressSuggestion, type ExceptionReason, type QuoteState,
} from '../lib/quote';
import { formatCents } from '../lib/money';
import { dollarsToCents } from '../components/NewDraftForm';
import AddressField from '../components/quote/AddressField';
import ZoneMatchCard from '../components/quote/ZoneMatchCard';
import ListPriceCard from '../components/quote/ListPriceCard';
import CostWaterfallCard, { type PricePoint } from '../components/quote/CostWaterfallCard';
import AssumptionsPanel from '../components/quote/AssumptionsPanel';
import QuotedPriceCard from '../components/quote/QuotedPriceCard';
import SaveConfirmation, { type SavedQuote } from '../components/quote/SaveConfirmation';
import Pill from '../components/Pill';
import FearStrip from '../components/FearStrip';

const SELECT = 'mt-1 h-10 w-full rounded-sm border border-line bg-surface px-2.5 text-body text-ink outline-none focus:border-accent disabled:opacity-50';
const LOB_LABEL = { residential: 'Residential', frontload: 'Frontload', rolloff: 'Rolloff' } as const;
const centsText = (c: number): string => (c / 100).toFixed(2);

/** A value that belongs to one pricing context (address, item, frequency) and falls back to a default
 *  when the context changes, so the quoted price and reason reset without an effect. */
interface Keyed<T> {
  key: string;
  value: T;
}

export default function QuoteWorkbench() {
  const sites = useStore((s) => s.sites);
  const accounts = useStore((s) => s.accounts);
  const parties = useStore((s) => s.parties);
  const quotes = useStore((s) => s.quotes);
  const catalog = useStore((s) => s.catalog);
  const rateVersions = useStore((s) => s.rateVersions);
  const contracts = useStore((s) => s.contracts);
  const serviceItems = useStore((s) => s.serviceItems);
  const zones = useStore((s) => s.zones);
  const feeRules = useStore((s) => s.feeRules);
  const taxRules = useStore((s) => s.taxRules);
  const priceCommercialRequest = useStore((s) => s.priceCommercialRequest);
  const saveContractOverride = useStore((s) => s.saveContractOverride);

  const state: QuoteState = useMemo(
    () => ({ ...toEngineState(useStore.getState()), quotes }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sites, accounts, parties, quotes, catalog, rateVersions, contracts, serviceItems, zones, feeRules, taxRules],
  );

  const [addressText, setAddressText] = useState('');
  const [siteId, setSiteId] = useState<string | undefined>(undefined);
  const [catalogId, setCatalogId] = useState('cat_fl_2yd');
  const [material, setMaterial] = useState<Material>('msw');
  const [frequencyChoice, setFrequencyChoice] = useState<Frequency>('weekly');
  const [qty, setQty] = useState(1);
  const [access, setAccess] = useState<AccessFlags>(NO_ACCESS_FLAGS);
  const [assumptions, setAssumptions] = useState<CostAssumptions>(DEFAULT_ASSUMPTIONS);
  const [resetKey, setResetKey] = useState(0);
  const [quoted, setQuoted] = useState<Keyed<string> | null>(null);
  const [reason, setReason] = useState<Keyed<{ reason: ExceptionReason | ''; note: string }> | null>(null);
  const [saved, setSaved] = useState<SavedQuote | null>(null);
  const [savedSig, setSavedSig] = useState<string | null>(null);

  const match = useMemo(() => matchAddress(state, addressText, siteId), [state, addressText, siteId]);
  const suggestions = useMemo(() => addressSuggestions(state, addressText), [state, addressText]);
  const item = catalog.find((c) => c.id === catalogId);
  const groups = useMemo(() => containerOptions(catalog), [catalog]);
  const freqs = useMemo(() => frequenciesFor(rateVersions, catalogId), [rateVersions, catalogId]);
  const frequency: Frequency = freqs.includes(frequencyChoice) ? frequencyChoice : (freqs[0] ?? frequencyChoice);
  const zone = zones.find((z) => z.id === match.zoneId);

  /** Selecting or typing an address that resolves to a site or request preselects what it already has. */
  const applyAddress = (text: string, nextSiteId: string | undefined) => {
    const prev = match.site?.id ?? match.request?.id;
    const next = matchAddress(state, text, nextSiteId);
    setAddressText(text);
    setSiteId(nextSiteId);
    const ident = next.site?.id ?? next.request?.id;
    if (!ident || ident === prev) return;
    const d = lineDefaultsFor(state, next);
    if (d.catalogId) {
      setCatalogId(d.catalogId);
      setMaterial(defaultMaterial(catalog.find((c) => c.id === d.catalogId)));
    }
    if (d.frequency) setFrequencyChoice(d.frequency);
    setQty(d.qty ?? 1);
    setAccess(NO_ACCESS_FLAGS);
  };

  const changeCatalog = (id: string) => {
    setCatalogId(id);
    setMaterial(defaultMaterial(catalog.find((c) => c.id === id)));
    const available = frequenciesFor(rateVersions, id);
    const f = available.includes(frequencyChoice) ? frequencyChoice : (available[0] ?? frequencyChoice);
    setFrequencyChoice(f);
    setQty(qtyFor(state, match, id, f));
  };

  const changeFrequency = (f: Frequency) => {
    setFrequencyChoice(f);
    setQty(qtyFor(state, match, catalogId, f));
  };

  const price = useMemo(
    () => listPriceFor(state, { catalogId, frequency, zoneId: match.zoneId, accountId: match.account?.id, onDate: TODAY }),
    [state, catalogId, frequency, match.zoneId, match.account?.id],
  );
  const listCents = price.list.ok ? price.list.result.priceCents : null;
  const ratebookCents = price.ratebook.ok ? price.ratebook.result.priceCents : null;

  const cost = useMemo(() => (item ? costToServe({ item, material, frequency, access, assumptions }) : undefined), [item, material, frequency, access, assumptions]);

  const contextKey = `${match.site?.id ?? match.request?.id ?? match.zoneId}|${match.account?.id ?? ''}|${catalogId}|${frequency}`;
  const quotedText = quoted?.key === contextKey ? quoted.value : listCents !== null ? centsText(listCents) : ratebookCents !== null ? centsText(ratebookCents) : '';
  const quotedCents = dollarsToCents(quotedText);
  const reasonState = reason?.key === contextKey ? reason.value : { reason: '' as const, note: '' };
  const summary = ratebookCents !== null && quotedCents !== null && quotedCents > 0 ? exceptionSummary(ratebookCents, quotedCents, qty) : undefined;

  const plan = planSave({
    state,
    match,
    catalogId,
    frequency,
    qty,
    quotedCents,
    ratebookCents,
    reason: reasonState.reason,
    note: reasonState.note,
    onDate: TODAY,
    newContractId: match.account ? `contract_${match.account.id}_${yyyymmdd(TODAY)}` : '',
  });
  const sig = JSON.stringify([plan.priceRequest, plan.override]);

  const pricePoints: PricePoint[] = [
    ...(ratebookCents !== null ? [{ label: 'Ratebook', cents: ratebookCents }] : []),
    ...(listCents !== null && listCents !== ratebookCents ? [{ label: 'Contract', cents: listCents }] : []),
    ...(quotedCents !== null && quotedCents > 0 ? [{ label: 'Quoted', cents: quotedCents }] : []),
  ];

  const onSave = () => {
    if (!plan.canSave) return;
    const quote = plan.priceRequest ? priceCommercialRequest({ quoteId: plan.priceRequest.quoteId, lines: [plan.priceRequest.line] }) : undefined;
    let contract;
    let createdContract = false;
    if (plan.override) {
      const before = useStore.getState().contracts.length;
      contract = saveContractOverride(plan.override);
      createdContract = useStore.getState().contracts.length > before;
    }
    const override = contract ? lastOverrideFor(contract, catalogId, frequency) : undefined;
    setSaved({
      catalogName: item?.name ?? catalogId,
      catalogId,
      frequency,
      quote,
      contract,
      override,
      createdContract,
      overrideCount: contract ? contract.overrides.filter((o) => o.catalogId === catalogId && o.frequency === frequency).length : 0,
    });
    setSavedSig(sig);
  };

  const noAccount = !match.account;
  const siteNote = match.site?.accessNotes;

  return (
    <div className="mx-auto max-w-[1360px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-accent">Pricing</p>
          <h1 className="mt-1 text-display font-bold tracking-tight">Quote workbench</h1>
          <p className="mt-1 text-body text-muted">Price a container from cost to serve. A price below the ratebook is saved as a dated contract override with a reason.</p>
          <FearStrip items={['prices the truck cannot serve profitably', 'exceptions that hide from the ratebook']} />
        </div>
        <Pill tone="muted">as of {TODAY}</Pill>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[340px_minmax(0,1fr)_330px]">
        {/* Inputs */}
        <section className="h-fit space-y-4 rounded-card border border-line bg-surface p-5 shadow-card" aria-label="Request">
          <h2 className="text-h2 font-bold">Request</h2>
          <AddressField value={addressText} suggestions={suggestions} onText={(t) => applyAddress(t, undefined)} onSelect={(s: AddressSuggestion) => applyAddress(s.address, s.siteId)} />

          <div className="rounded-sm bg-surface-muted px-3 py-2" data-testid="account-match">
            {match.account ? (
              <>
                <p className="flex flex-wrap items-center gap-2 text-body font-bold text-ink">
                  {match.accountName}
                  <Pill tone={match.account.status === 'active' ? 'success' : 'warning'}>{match.account.status}</Pill>
                </p>
                <p className="font-mono text-mono text-muted">
                  {match.account.id}, {match.site?.id}, {match.zoneId}
                </p>
                {match.account.contractId && <p className="text-small text-muted">Contract on file: {match.account.contractId}</p>}
              </>
            ) : (
              <>
                <p className="flex items-center gap-2 text-body font-bold text-ink">
                  No account matched <Pill tone="warning">save disabled</Pill>
                </p>
                <p className="text-small text-muted">{addressText.trim() ? `Priced in ${match.zoneId} (${match.zoneSource === 'addressText' ? 'from the address text' : 'default'}).` : 'Type an address or pick a seed site.'}</p>
              </>
            )}
          </div>

          {match.request && (
            <div className="rounded-sm border-l-[3px] border-accent bg-accent-soft px-3 py-2" data-testid="pricing-request">
              <p className="text-body font-bold text-accent">Pricing request {match.request.id}</p>
              <p className="text-small text-ink">
                {match.request.kind}, {match.request.status}, from {match.request.createdVia}, expires {match.request.expiresAt.slice(0, 10)}
              </p>
              <ul className="mt-1 font-mono text-mono text-ink">
                {match.request.lines.map((l) => (
                  <li key={`${l.catalogId}-${l.frequency}`}>
                    {l.qty} x {l.catalogId}, {FREQUENCY_LABEL[l.frequency]}, {formatCents(l.priceCents)}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-small text-muted">Save writes the priced line onto this request. The workbench never creates a Quote.</p>
            </div>
          )}

          <label className="block">
            <span className="text-small font-semibold text-muted">Container</span>
            <select value={catalogId} onChange={(e) => changeCatalog(e.target.value)} className={SELECT} aria-label="Container">
              {groups.map((g) => (
                <optgroup key={g.lob} label={LOB_LABEL[g.lob]}>
                  {g.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <span className="mt-1 block font-mono text-eyebrow text-muted">
              {catalogId}
              {item?.rolloff ? `, includes ${item.rolloff.includedTons} tons and ${item.rolloff.includedDays} days` : ''}
            </span>
          </label>

          <label className="block">
            <span className="text-small font-semibold text-muted">Material</span>
            <select value={material} onChange={(e) => setMaterial(e.target.value as Material)} className={SELECT} aria-label="Material">
              {MATERIALS.map((m) => (
                <option key={m} value={m}>
                  {MATERIAL_LABEL[m]}, {assumptions.lbPerYard[m]} lb/yd
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-[minmax(0,1fr)_90px] gap-3">
            <label className="block">
              <span className="text-small font-semibold text-muted">Frequency</span>
              <select value={frequency} onChange={(e) => changeFrequency(e.target.value as Frequency)} disabled={freqs.length === 0} className={SELECT} aria-label="Frequency">
                {freqs.length === 0 && <option value={frequency}>No published rate</option>}
                {freqs.map((f) => (
                  <option key={f} value={f}>
                    {FREQUENCY_LABEL[f]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-small font-semibold text-muted">Qty</span>
              <input
                type="number"
                min={1}
                step={1}
                value={qty}
                onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                className={`${SELECT} font-mono`}
                aria-label="Quantity"
              />
            </label>
          </div>
          <p className="-mt-2 text-eyebrow text-muted">Only frequencies with a published rate for this container.</p>

          <fieldset>
            <legend className="text-small font-semibold text-muted">Access</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {ACCESS_FLAGS.map((f) => (
                <label key={f} className={['flex cursor-pointer items-center gap-2 rounded-pill border px-3 py-1.5 text-small font-semibold', access[f] ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink'].join(' ')}>
                  <input type="checkbox" checked={access[f]} onChange={(e) => setAccess({ ...access, [f]: e.target.checked })} className="accent-[var(--tl-accent)]" />
                  {f[0].toUpperCase() + f.slice(1)}
                  <span className="font-normal text-muted">+{assumptions.extraMinutes[f]} min</span>
                </label>
              ))}
            </div>
            {siteNote && <p className="mt-2 text-small text-muted">Site note: {siteNote}. Flags are not set from notes; check what applies.</p>}
          </fieldset>
        </section>

        {/* Results */}
        <div className="min-w-0 space-y-5">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <ZoneMatchCard zone={zone} match={match} />
            <ListPriceCard price={price} accountName={match.accountName} />
          </div>
          {cost && item && <CostWaterfallCard cost={cost} material={material} frequency={frequency} truckDayCostCents={assumptions.truckDayCostCents} pricePoints={pricePoints} />}
          <QuotedPriceCard
            quotedText={quotedText}
            onQuotedText={(t) => setQuoted({ key: contextKey, value: t })}
            qty={qty}
            summary={summary}
            ratebookCents={ratebookCents}
            listCents={listCents}
            reason={reasonState.reason}
            onReason={(r) => setReason({ key: contextKey, value: { ...reasonState, reason: r } })}
            note={reasonState.note}
            onNote={(n) => setReason({ key: contextKey, value: { ...reasonState, note: n } })}
            plan={plan}
            onSave={onSave}
            alreadySaved={savedSig === sig && saved !== null}
          />
          {saved && <SaveConfirmation saved={saved} onDismiss={() => setSaved(null)} />}
          {noAccount && !match.request && addressText.trim() !== '' && (
            <p className="text-small text-muted">Unknown address: the numbers above are a what-if. Nothing can be saved until the address matches an account or a pricing request.</p>
          )}
        </div>

        {/* Assumptions */}
        <aside className="h-fit">
          <AssumptionsPanel
            assumptions={assumptions}
            onChange={setAssumptions}
            onReset={() => {
              setAssumptions(DEFAULT_ASSUMPTIONS);
              setResetKey((k) => k + 1);
            }}
            resetKey={resetKey}
            material={material}
            frequency={frequency}
            access={access}
            liftsBasis={item ? liftsBasisFor(item) : 'baseLiftsPerDay'}
          />
        </aside>
      </div>
    </div>
  );
}
