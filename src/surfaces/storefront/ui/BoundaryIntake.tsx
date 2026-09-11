// Boundary intake: contact, delivery notes, an optional driveway photo (only the file name is kept),
// and the card widget, which saves a token without charging it. Submitting creates a held Quote and
// opens its status screen. Nothing is charged here.
import { useState, type FormEvent } from 'react';
import { useStore } from '../../../store/useStore';
import { dayBefore, formatDay } from '../lib/clock';
import { HOLD_HOURS } from '../lib/held';
import { formatCents } from '../lib/money';
import { frequencyLabel } from '../lib/offer';
import { CardWidget, EMPTY_CARD, type CardInput } from './CardWidget';
import { cleanContact, ContactFields, contactProblem } from './ContactFields';
import { Container, ErrorNote, Eyebrow, Field, LinkButton, MoneyRow, Panel, Pill, PrimaryButton, StatBlock, TextArea } from './components';
import { buyerError } from './buyerError';
import { useGo, useOfferView, useShowStatus, useStartOver, useUi } from './hooks';

export const SAVED_CARD_LABEL = 'Your card is saved, not charged';
export const HOLD_BUTTON = 'Hold my price and submit for review';

export function BoundaryIntakeScreen() {
  const { match, offer, error: offerError } = useOfferView();
  const contact = useUi((s) => s.contact);
  const setContact = useUi((s) => s.setContact);
  const showStatus = useShowStatus();
  const go = useGo();
  const startOver = useStartOver();

  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [photoName, setPhotoName] = useState<string | undefined>();
  const [card, setCard] = useState<CardInput>(EMPTY_CARD);
  const [error, setError] = useState<string | undefined>();

  if (!match?.address || !offer || !offer.provisional) {
    return (
      <main className="mx-auto w-full max-w-[560px] px-4 pt-12">
        <ErrorNote>{offerError ?? 'This step is for addresses we need to review first. Start with your address.'}</ErrorNote>
        <LinkButton className="mt-4" onClick={startOver}>
          Back to the address
        </LinkButton>
      </main>
    );
  }
  const address = match.address;
  const due = formatCents(offer.dueTodayCents);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!offer) return;
    setError(undefined);
    const problem = contactProblem(contact, { phoneRequired: true });
    if (problem) return setError(problem);
    if (!/^\d{4}$/.test(card.last4)) return setError('Enter the last 4 digits of your card.');
    try {
      const store = useStore.getState();
      const { tokenId } = store.sfTokenizeCard(card);
      const { quoteId } = store.sfCreateHeldQuote({ offer, contact: cleanContact(contact), deliveryNotes, photoName, tokenId, addressId: address.id });
      showStatus(quoteId);
    } catch (err) {
      setError(`${buyerError(err, 'Something went wrong on our side.')} Nothing was saved or charged.`);
    }
  }

  return (
    <main className="pb-16 pt-8 md:pt-16">
      <Container>
      <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,1fr)_440px] md:gap-12">
        <section className="flex flex-col gap-6" aria-label="Hold my price">
          <div className="flex flex-col gap-3">
            <Eyebrow>Provisional price</Eyebrow>
            <h1 className="text-title font-bold text-ink">Hold your price for {address.line1}</h1>
            <p className="text-body text-ink-muted">
              A person checks the address, then texts you. If we can serve it, your cart and first pickup are booked with no
              second conversation. Nothing is charged today.
            </p>
          </div>

          <ContactFields contact={contact} onChange={setContact} phoneHint="We text you the decision here" />

          <Field label="Delivery notes" htmlFor="delivery-notes" hint="Gate codes, where the road forks, where the cart should go.">
            <TextArea
              id="delivery-notes"
              value={deliveryNotes}
              onChange={(e) => setDeliveryNotes(e.target.value)}
              placeholder="Gravel drive past the mailbox cluster, leave the cart by the second gate."
            />
          </Field>

          <Field label="Driveway photo (optional)" htmlFor="photo" hint="Helps us check truck access. Only the file name is kept.">
            <input
              id="photo"
              type="file"
              accept="image/*"
              onChange={(e) => setPhotoName(e.target.files?.[0]?.name || undefined)}
              className="block w-full min-w-0 text-small text-ink-muted file:mr-3 file:h-button-compact file:cursor-pointer file:rounded-pill file:border file:border-solid file:border-line file:bg-surface file:px-5 file:text-label file:font-semibold file:text-ink hover:file:bg-gray-50"
            />
          </Field>
          {photoName ? <p className="-mt-4 break-all text-small text-ink">Attached: {photoName}</p> : null}

          <CardWidget label={SAVED_CARD_LABEL} value={card} onChange={setCard} />

          {error ? <ErrorNote>{error}</ErrorNote> : null}
        </section>

        <Panel className="flex flex-col gap-4 md:self-start" aria-label="Your held price">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-heading font-bold text-ink">Your held price</h2>
            <Pill tone="warning">Provisional price</Pill>
          </div>
          <div className="flex flex-col gap-2">
            {offer.lines.map((line) => (
              <MoneyRow key={line.catalogId} label={`${line.name}, ${frequencyLabel(line.frequency)}`} value={`${formatCents(line.monthlyCents)}/mo`} />
            ))}
            <MoneyRow label="Cart arrives, if approved" value={formatDay(dayBefore(offer.startDate))} />
            <MoneyRow label="First pickup, if approved" value={formatDay(offer.startDate)} />
            <MoneyRow label="Then every quarter" value={formatCents(offer.recurringQuarterlyCents)} />
          </div>
          <StatBlock label="Due when approved" amount={due} />
          <PrimaryButton type="submit" className="w-full">
            {HOLD_BUTTON}
          </PrimaryButton>
          <p className="text-small text-ink-muted">
            Nothing is charged today. Your price is held for {HOLD_HOURS} hours while we review. We charge {due} only if we
            approve the address; if we can't serve it, your card is never charged.
          </p>
          <LinkButton onClick={() => go('boundary')} className="self-start">
            Change my cart or start date
          </LinkButton>
        </Panel>
      </form>
      </Container>
    </main>
  );
}
