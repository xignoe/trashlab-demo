// Commercial request ("Business" on, then any address): the buyer lists their containers and asks for a written quote.
// Business buyers never see a price here (Kevin, 2026-09-11); residential keeps its prices on the offer screen.
// Sending saves a draft commercialRequest Quote. The store still fills in rate-card prices where they exist so the
// office starts from them in the quote workbench; a person sends the written quote.
import { useState, type FormEvent } from 'react';
import { useStore } from '../../../store/useStore';
import type { Frequency } from '../../../types';
import { formatDay, nextBusinessDay, today } from '../lib/clock';
import {
  BUSINESS_TYPES,
  COMMERCIAL_EXTRAS,
  COMMERCIAL_MATERIALS,
  containersFor,
  DEFAULT_COMMERCIAL_LINE,
  frequenciesFor,
  FRONTLOAD_CONTAINER_IDS,
  MAX_COMMERCIAL_LINES,
  MAX_LINE_QTY,
  ROLLOFF_CONTAINER_IDS,
  SERVICE_TERMS,
  type CommercialLine,
  type ServiceTerm,
} from '../lib/commercial';
import { frequencyLabel } from '../lib/offer';
import { matchAddress } from '../lib/serviceability';
import { buyerError } from './buyerError';
import { cleanContact, ContactFields, contactProblem } from './ContactFields';
import {
  Container,
  ErrorNote,
  Eyebrow,
  Field,
  LinkButton,
  Panel,
  Pill,
  PrimaryButton,
  RadioCard,
  SecondaryButton,
  Select,
  TextArea,
  TextInput,
} from './components';
import { useStartOver, useUi, useView } from './hooks';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function receiptSentence(quoteId: string, replyBy: string): string {
  return `Request ${quoteId} received. A person will send your written quote by ${formatDay(replyBy)}.`;
}

/** A text row that wraps (and breaks a long email) instead of pushing past a narrow screen. */
function SentRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 break-words text-right text-ink [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

function Receipt() {
  const receipt = useUi((s) => s.commercialReceipt)!;
  const startOver = useStartOver();
  const view = useView();
  const quote = view.quotes[receipt.quoteId];
  const intake = view.quoteIntake[receipt.quoteId];
  const catalog = view.catalog;

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 pb-12 pt-12 md:pt-[96px]">
      <Pill tone="success">Request received</Pill>
      <h1 className="mt-4 text-title font-bold text-ink" data-testid="commercial-receipt">
        {receiptSentence(receipt.quoteId, receipt.replyBy)}
      </h1>
      <p className="mt-4 text-body text-ink-muted">Nothing is charged until you accept the written quote.</p>

      {quote && intake ? (
        <Panel className="mt-8 flex flex-col gap-2" aria-label="What you sent">
          <h2 className="text-heading font-bold text-ink">What you sent</h2>
          <dl className="flex flex-col gap-2 text-body">
            <SentRow label="Address" value={quote.address} />
            {intake.businessType ? <SentRow label="Business" value={intake.businessType} /> : null}
            {quote.lines.map((line, i) => (
              <SentRow
                key={i}
                label={quote.lines.length > 1 ? `Container ${i + 1}` : 'Container'}
                value={`${line.qty} x ${catalog[line.catalogId]?.name ?? line.catalogId}, ${intake.lineMaterials?.[i] ?? intake.material ?? ''}, ${frequencyLabel(line.frequency)}`}
              />
            ))}
            {intake.startDate ? <SentRow label="Preferred start" value={formatDay(intake.startDate)} /> : null}
            {intake.extras?.length ? (
              <SentRow label="Extras" value={intake.extras.map((id) => COMMERCIAL_EXTRAS.find((x) => x.id === id)?.label ?? id).join(', ')} />
            ) : null}
            <SentRow label="Access notes" value={intake.accessNotes || 'None'} />
            <SentRow label="Contact" value={[intake.contact.name, intake.contact.email, intake.contact.phone].filter(Boolean).join(', ')} />
          </dl>
        </Panel>
      ) : null}
      <PrimaryButton className="mt-8" onClick={startOver}>
        Start over
      </PrimaryButton>
    </main>
  );
}

export function CommercialScreen() {
  const receipt = useUi((s) => s.commercialReceipt);
  if (receipt) return <Receipt />;
  return <CommercialForm />;
}

/** One container row: size, count, material, pickups. */
function LineEditor({
  index,
  line,
  term,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number;
  line: CommercialLine;
  term: ServiceTerm;
  canRemove: boolean;
  onChange(patch: Partial<CommercialLine>): void;
  onRemove(): void;
}) {
  const catalog = useView().catalog;
  const allowed = containersFor(term);
  const frequencies = frequenciesFor(catalog[line.catalogId]);
  const id = (field: string) => `line-${index}-${field}`;
  // Only sizes this hauler actually stocks. The id tables above are the same for every hauler, so a hauler that does
  // not carry a size simply has no catalog row for it and it must not appear as an option (src/tenants).
  const group = (ids: readonly string[]) => ids.filter((c) => allowed.includes(c) && Boolean(catalog[c]));

  function setContainer(catalogId: string) {
    const next = frequenciesFor(catalog[catalogId]);
    onChange({ catalogId, frequency: next.includes(line.frequency) ? line.frequency : next.includes('weekly') ? 'weekly' : next[0] });
  }

  return (
    <li className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5" data-testid={`commercial-line-${index}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-body font-bold text-ink">Container {index + 1}</h3>
        {canRemove ? (
          <LinkButton type="button" onClick={onRemove} aria-label={`Remove container ${index + 1}`}>
            Remove
          </LinkButton>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Field label="Size" htmlFor={id('size')} hint={catalog[line.catalogId]?.description}>
          <Select id={id('size')} value={line.catalogId} onChange={(e) => setContainer(e.target.value)}>
            {group(FRONTLOAD_CONTAINER_IDS).length ? (
              <optgroup label="Front load, emptied on a schedule">
                {group(FRONTLOAD_CONTAINER_IDS).map((c) => (
                  <option key={c} value={c}>
                    {catalog[c]?.name ?? c}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {group(ROLLOFF_CONTAINER_IDS).length ? (
              <optgroup label="Rolloff, hauled when you call">
                {group(ROLLOFF_CONTAINER_IDS).map((c) => (
                  <option key={c} value={c}>
                    {catalog[c]?.name ?? c}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </Select>
        </Field>
        <Field label="How many" htmlFor={id('qty')}>
          <Select id={id('qty')} value={line.qty} onChange={(e) => onChange({ qty: Number(e.target.value) })}>
            {Array.from({ length: MAX_LINE_QTY }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="What goes in it" htmlFor={id('material')}>
          <Select id={id('material')} value={line.material} onChange={(e) => onChange({ material: e.target.value })}>
            {COMMERCIAL_MATERIALS.map((m) => (
              <option key={m} value={m}>
                {cap(m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Pickups" htmlFor={id('frequency')}>
          <Select id={id('frequency')} value={line.frequency} onChange={(e) => onChange({ frequency: e.target.value as Frequency })}>
            {frequencies.map((f) => (
              <option key={f} value={f}>
                {cap(frequencyLabel(f))}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </li>
  );
}

function CommercialForm() {
  const draft = useUi((s) => s.commercialDraft);
  const setDraft = useUi((s) => s.setCommercialDraft);
  const contact = useUi((s) => s.contact);
  const setContact = useUi((s) => s.setContact);
  const startOver = useStartOver();
  const view = useView();

  // The answers live in the slice (sfUi.commercialDraft) so Reset seed clears them with everything else.
  const { address, businessType, term, lines, extras, startDate, accessNotes } = draft;
  const [error, setError] = useState<string | undefined>();

  const matched = address.trim() ? matchAddress(address, view) : undefined;
  const replyBy = formatDay(nextBusinessDay(today()));

  const setLine = (i: number, patch: Partial<CommercialLine>) => setDraft({ lines: lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const removeLine = (i: number) => setDraft({ lines: lines.filter((_, j) => j !== i) });
  const addLine = () => {
    const last = lines[lines.length - 1] ?? DEFAULT_COMMERCIAL_LINE;
    setDraft({ lines: [...lines, { ...last, qty: 1, material: last.material === 'trash' ? 'cardboard' : 'trash' }] });
  };
  function setTerm(next: ServiceTerm) {
    const allowed = containersFor(next);
    const fallback: CommercialLine = { catalogId: 'cat_ro_20yd', qty: 1, material: 'construction debris', frequency: 'onCall' };
    setDraft({ term: next, lines: lines.map((l) => (allowed.includes(l.catalogId) ? l : { ...fallback, qty: l.qty })) });
  }
  const toggleExtra = (id: string) => setDraft({ extras: extras.includes(id) ? extras.filter((x) => x !== id) : [...extras, id] });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (!address.trim()) return setError('Enter the business address.');
    const problem = contactProblem(contact);
    if (problem) return setError(problem);
    try {
      useStore.getState().sfCreateCommercialRequest({
        address,
        lines,
        ...(businessType ? { businessType } : {}),
        term,
        ...(startDate ? { startDate } : {}),
        extras,
        accessNotes,
        contact: cleanContact(contact),
      });
    } catch (err) {
      setError(buyerError(err, 'Something went wrong on our side. Your request was not sent. Try again in a moment.'));
    }
  }

  return (
    <main className="pb-16 pt-8 md:pt-16">
      <Container>
        <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,1fr)_400px] md:gap-12">
          <section className="flex flex-col gap-6" aria-label="Commercial request">
            <div className="flex flex-col gap-3">
              <Eyebrow>Business service</Eyebrow>
              <h1 className="text-title font-bold text-ink">Tell us what your business needs.</h1>
              <p className="text-body text-ink-muted">Add each container you need. A person prices it for your site and sends you a written quote.</p>
            </div>

            <Field
              label="Business address"
              htmlFor="business-address"
              hint={
                matched?.branch === 'notServed'
                  ? 'We could not match this to a route yet. A person will confirm whether we can serve it.'
                  : matched?.address
                    ? `Matched: ${matched.zone.name}.`
                    : undefined
              }
            >
              <TextInput id="business-address" value={address} onChange={(e) => setDraft({ address: e.target.value })} autoComplete="street-address" />
            </Field>

            <Field label="Type of business" htmlFor="business-type">
              <Select id="business-type" value={businessType} onChange={(e) => setDraft({ businessType: e.target.value })}>
                <option value="">Choose one</option>
                {BUSINESS_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-3 text-label font-semibold text-ink">How long do you need service?</legend>
              <div className="flex flex-col gap-3 sm:flex-row">
                {SERVICE_TERMS.map((t) => (
                  <RadioCard key={t.id} name="term" value={t.id} checked={term === t.id} onChange={(v) => setTerm(v as ServiceTerm)} title={t.label} description={t.description} />
                ))}
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-3 text-label font-semibold text-ink">Containers</legend>
              <ul className="flex flex-col gap-3">
                {lines.map((line, i) => (
                  <LineEditor
                    key={i}
                    index={i}
                    line={line}
                    term={term}
                    canRemove={lines.length > 1}
                    onChange={(patch) => setLine(i, patch)}
                    onRemove={() => removeLine(i)}
                  />
                ))}
              </ul>
              {lines.length < MAX_COMMERCIAL_LINES ? (
                <SecondaryButton type="button" size="compact" onClick={addLine} className="self-start">
                  Add another container
                </SecondaryButton>
              ) : null}
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-3 text-label font-semibold text-ink">Extras</legend>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-6">
                {COMMERCIAL_EXTRAS.map((x) => (
                  <label key={x.id} className="flex cursor-pointer items-center gap-2 text-body text-ink">
                    <input type="checkbox" checked={extras.includes(x.id)} onChange={() => toggleExtra(x.id)} className="h-4 w-4 accent-accent" />
                    {x.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <Field label="Preferred start date (optional)" htmlFor="start-date">
              <TextInput id="start-date" type="date" min={today()} value={startDate} onChange={(e) => setDraft({ startDate: e.target.value })} className="sm:max-w-[240px]" />
            </Field>

            <Field label="Access notes" htmlFor="access-notes" hint="Where the container sits, gate codes, hours the truck can get in.">
              <TextArea id="access-notes" value={accessNotes} onChange={(e) => setDraft({ accessNotes: e.target.value })} placeholder="Enclosure behind the loading dock, gate code 4471, open from 6 AM." />
            </Field>

            <ContactFields contact={contact} onChange={setContact} phoneLabel="Mobile (optional)" />

            {error ? <ErrorNote>{error}</ErrorNote> : null}
          </section>

          <Panel className="flex flex-col gap-4 md:sticky md:top-6 md:self-start" aria-label="Get a quote" data-testid="commercial-quote">
            <h2 className="text-heading font-bold text-ink">Get a written quote</h2>
            <p className="text-body text-ink-muted">Business pricing depends on your site, so a person prices every request.</p>
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-small text-ink-muted">
              <li>Send us what you need.</li>
              <li>A person sends your written quote by {replyBy}.</li>
              <li>Nothing is charged until you accept it.</li>
            </ol>
            <PrimaryButton type="submit" className="w-full">
              Send my request
            </PrimaryButton>
            <SecondaryButton onClick={startOver} className="self-start">
              Check a different address
            </SecondaryButton>
          </Panel>
        </form>
      </Container>
    </main>
  );
}
