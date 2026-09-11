// Commercial request ("For a business" on, then any address): a structured form with no price anywhere.
// Saves a Quote of kind commercialRequest; a person replies with a written price.
import { useState, type FormEvent } from 'react';
import { formatDay, nextBusinessDay, TODAY } from '../store/clock';
import {
  COMMERCIAL_CONTAINER_IDS,
  COMMERCIAL_FREQUENCIES,
  COMMERCIAL_MATERIALS,
  COMMERCIAL_NO_PRICE_REASON,
  createCommercialRequest,
} from '../store/commercial';
import { frequencyLabel } from '../store/offer';
import { matchAddress } from '../store/serviceability';
import { useStore } from '../store/store';
import { useUi } from '../store/ui';
import type { Frequency } from '../types';
import { buyerError } from './buyerError';
import { cleanContact, ContactFields, contactProblem } from './ContactFields';
import { Container, ErrorNote, Eyebrow, Field, Panel, Pill, PrimaryButton, RadioCard, SecondaryButton, TextArea, TextInput } from './components';

export const CONTAINER_OPTIONS = COMMERCIAL_CONTAINER_IDS;
const CONTAINER_BLURB: Record<string, string> = {
  cat_fl_2yd: 'Offices and small shops',
  cat_fl_3yd: 'Restaurants and busy retail',
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function receiptSentence(quoteId: string, replyBy: string): string {
  return `Request ${quoteId} received. A person will reply by ${formatDay(replyBy)} with a written price.`;
}

/** A text row that wraps (and breaks a long email) instead of pushing past a narrow screen. */
function SentRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 break-words text-ink [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

function Receipt() {
  const receipt = useUi((s) => s.commercialReceipt)!;
  const startOver = useUi((s) => s.startOver);
  const quote = useStore((s) => s.quotes[receipt.quoteId]);
  const intake = useStore((s) => s.quoteIntake[receipt.quoteId]);
  const catalog = useStore((s) => s.catalog);
  const line = quote?.lines[0];

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 pb-12 pt-12 md:pt-[96px]">
      <Pill tone="success">Request received</Pill>
      <h1 className="mt-4 text-title font-bold text-ink" data-testid="commercial-receipt">
        {receiptSentence(receipt.quoteId, receipt.replyBy)}
      </h1>
      <p className="mt-4 text-body text-ink-muted">{COMMERCIAL_NO_PRICE_REASON} Nothing is charged until you accept a written price.</p>
      {quote && intake ? (
        <Panel className="mt-8 flex flex-col gap-2" aria-label="What you sent">
          <h2 className="text-heading font-bold text-ink">What you sent</h2>
          <dl className="flex flex-col gap-2 text-body">
            <SentRow label="Address" value={quote.address} />
            <SentRow label="Container" value={line ? catalog[line.catalogId]?.name ?? line.catalogId : ''} />
            <SentRow label="Material" value={cap(intake.material ?? '')} />
            <SentRow label="Pickups" value={line ? cap(frequencyLabel(line.frequency)) : ''} />
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

function CommercialForm() {
  const draft = useUi((s) => s.commercialDraft);
  const setDraft = useUi((s) => s.setCommercialDraft);
  const contact = useUi((s) => s.contact);
  const setContact = useUi((s) => s.setContact);
  const setCommercialReceipt = useUi((s) => s.setCommercialReceipt);
  const startOver = useUi((s) => s.startOver);
  const catalog = useStore((s) => s.catalog);

  // The answers live in the ui store (commercialDraft) so the agent drawer can echo them live.
  const { address, containerCatalogId, material, frequency, accessNotes } = draft;
  const [error, setError] = useState<string | undefined>();

  const matched = address.trim() ? matchAddress(address) : undefined;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (!address.trim()) return setError('Enter the business address.');
    const problem = contactProblem(contact);
    if (problem) return setError(problem);
    try {
      setCommercialReceipt(
        createCommercialRequest({ address, containerCatalogId, material, frequency, accessNotes, contact: cleanContact(contact) }),
      );
    } catch (err) {
      setError(buyerError(err, 'Something went wrong on our side. Your request was not sent. Try again in a moment.'));
    }
  }

  return (
    <main className="pb-16 pt-8 md:pt-16">
      <Container>
      <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,1fr)_440px] md:gap-12">
        <section className="flex flex-col gap-6" aria-label="Commercial request">
          <div className="flex flex-col gap-3">
            <Eyebrow>Business service</Eyebrow>
            <h1 className="text-title font-bold text-ink">Tell us what your business needs.</h1>
            <p className="rounded-lg border border-line bg-accent-soft px-4 py-3 text-body text-ink" data-testid="commercial-reason">
              {COMMERCIAL_NO_PRICE_REASON}
            </p>
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

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-3 text-label font-semibold text-ink">Container size</legend>
            <div className="flex flex-col gap-3 sm:flex-row">
              {CONTAINER_OPTIONS.map((id) => (
                <RadioCard
                  key={id}
                  name="container"
                  value={id}
                  checked={containerCatalogId === id}
                  onChange={(v) => setDraft({ containerCatalogId: v })}
                  title={catalog[id]?.name ?? id}
                  description={CONTAINER_BLURB[id]}
                />
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-3 text-label font-semibold text-ink">Material</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {COMMERCIAL_MATERIALS.map((m) => (
                <RadioCard key={m} name="material" value={m} checked={material === m} onChange={(v) => setDraft({ material: v })} title={cap(m)} />
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-3 text-label font-semibold text-ink">Pickups</legend>
            <div className="flex flex-col gap-3 sm:flex-row">
              {COMMERCIAL_FREQUENCIES.map((f) => (
                <RadioCard key={f} name="frequency" value={f} checked={frequency === f} onChange={(v) => setDraft({ frequency: v as Frequency })} title={cap(frequencyLabel(f))} />
              ))}
            </div>
          </fieldset>

          <Field label="Access notes" htmlFor="access-notes" hint="Where the container sits, gate codes, hours the truck can get in.">
            <TextArea id="access-notes" value={accessNotes} onChange={(e) => setDraft({ accessNotes: e.target.value })} placeholder="Enclosure behind the loading dock, gate code 4471, open from 6 AM." />
          </Field>

          <ContactFields contact={contact} onChange={setContact} phoneLabel="Mobile (optional)" />

          {error ? <ErrorNote>{error}</ErrorNote> : null}
        </section>

        <Panel className="flex flex-col gap-4 md:self-start" aria-label="What happens next">
          <h2 className="text-heading font-bold text-ink">What happens next</h2>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-body text-ink">
            <li>A person reads your request today.</li>
            <li>You get a written price by email by {formatDay(nextBusinessDay(TODAY))}.</li>
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
