// Checkout: contact, the mock tokenized card widget (brand, last 4, expiry only; there is no card
// number field anywhere), autopay consent, the order summary, and the pay button. A declined token
// shows the decline and leaves the Db untouched.
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../../store/useStore';
import { dayBefore, formatDay } from '../lib/clock';
import { formatCents } from '../lib/money';
import { frequencyLabel } from '../lib/offer';
import { pathFor } from '../lib/paths';
import { CardDeclinedError } from '../lib/payments';
import { CardWidget, EMPTY_CARD, type CardInput } from './CardWidget';
import { Container, ErrorNote, Field, LinkButton, MoneyRow, Panel, PrimaryButton, SECTION_LABEL, StatBlock, TextInput } from './components';
import { buyerError } from './buyerError';
import { useGo, useOfferView, useUi } from './hooks';

export const CARD_WIDGET_LABEL = 'Hosted by the payment provider, card number never touches this site';

export function CheckoutScreen() {
  const { match, offer, error: offerError } = useOfferView();
  const contact = useUi((s) => s.contact);
  const setContact = useUi((s) => s.setContact);
  const autopay = useUi((s) => s.autopay);
  const setAutopay = useUi((s) => s.setAutopay);
  const go = useGo();
  const navigate = useNavigate();

  const [card, setCard] = useState<CardInput>(EMPTY_CARD);
  const last4 = card.last4;
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  if (!match?.address || !offer) {
    return (
      <main className="mx-auto w-full max-w-[560px] px-4 pt-12">
        <ErrorNote>{offerError ?? 'Pick an address first.'}</ErrorNote>
      </main>
    );
  }
  const address = match.address;
  const dueToday = formatCents(offer.dueTodayCents);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!offer) return;
    setError(undefined);
    if (!contact.name.trim()) return setError('Enter your full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim())) return setError('Enter a valid email address.');
    if (!/^\d{4}$/.test(last4)) return setError('Enter the last 4 digits of your card.');
    setBusy(true);
    try {
      const store = useStore.getState();
      const { tokenId } = store.sfTokenizeCard(card);
      store.sfCompleteInstantSignup({
        offer,
        contact: { name: contact.name.trim(), email: contact.email.trim(), phone: contact.phone?.trim() || undefined },
        addressId: address.id,
        consent: { autopay },
        tokenId,
      });
      navigate(pathFor('success'));
    } catch (err) {
      if (err instanceof CardDeclinedError) {
        setError(`Your card ending in ${last4} was declined by the payment provider. Nothing was charged and no account was created. Try a different card.`);
      } else {
        setError(buyerError(err, 'Something went wrong on our side. Nothing was charged. Try again in a moment.'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="pb-16 pt-8 md:pt-16">
      <Container>
        <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,1fr)_440px] md:gap-12">
          <section className="flex flex-col gap-6" aria-label="Checkout">
            <div className="flex flex-col gap-3">
              <h1 className="text-title font-bold text-ink">Checkout</h1>
              <p className="text-body text-ink-muted">
                Two minutes. We email your receipt and text you the day before the cart arrives at {address.line1}.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <p className={SECTION_LABEL}>Contact</p>
              <Field label="Full name" htmlFor="name">
                <TextInput id="name" name="name" autoComplete="name" value={contact.name} onChange={(e) => setContact({ name: e.target.value })} required />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Email" htmlFor="email">
                  <TextInput id="email" name="email" type="email" autoComplete="email" value={contact.email} onChange={(e) => setContact({ email: e.target.value })} required />
                </Field>
                <Field label="Mobile" htmlFor="phone" hint="For the day-before text">
                  <TextInput id="phone" name="phone" type="tel" autoComplete="tel" value={contact.phone ?? ''} onChange={(e) => setContact({ phone: e.target.value })} />
                </Field>
              </div>
            </div>

            <CardWidget label={CARD_WIDGET_LABEL} value={card} onChange={setCard} />

            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={autopay}
                onChange={(e) => setAutopay(e.target.checked)}
                className="mt-1 h-5 w-5 shrink-0 rounded border-line accent-accent"
              />
              <span className="text-body text-ink">Charge this card automatically each quarter (autopay). You can turn this off any time.</span>
            </label>

            {error ? <ErrorNote>{error}</ErrorNote> : null}
          </section>

          <Panel className="flex flex-col gap-4 md:self-start" aria-label="Order summary">
            <h2 className="text-heading font-bold text-ink">Order summary</h2>
            <div className="flex flex-col gap-2">
              {offer.lines.map((line) => (
                <MoneyRow key={line.catalogId} label={`${line.name}, ${frequencyLabel(line.frequency)}`} value={`${formatCents(line.monthlyCents)}/mo`} />
              ))}
              <MoneyRow label="Cart arrives" value={formatDay(dayBefore(offer.startDate))} />
              <MoneyRow label="First pickup" value={formatDay(offer.startDate)} />
            </div>
            <StatBlock label="Due today" amount={dueToday}>
              <span>
                Then every quarter <span className="font-semibold tabular-nums text-on-brand">{formatCents(offer.recurringQuarterlyCents)}</span>
              </span>
            </StatBlock>
            <PrimaryButton type="submit" disabled={busy} className="w-full">
              Pay {dueToday} and start service
            </PrimaryButton>
            <p className="text-small text-ink-muted">
              Your card is charged once now for the first quarter and delivery. Cancel any time; no contract.
            </p>
            <LinkButton onClick={() => go('offer')} className="self-start">
              Change my cart or start date
            </LinkButton>
          </Panel>
        </form>
      </Container>
    </main>
  );
}
