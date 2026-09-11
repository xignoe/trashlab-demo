// Offer screen for an open or boundary zone, drawn as Paper ES-0: a cyan eyebrow and a 40/50 title, then the
// configurator on the left and the live price card on the right (stacked at 390px). Every option shows its
// own resolved price. On a boundary zone the eyebrow reads "Provisional price", the hold sentence shows,
// and the screen continues to the boundary intake instead of checkout.
import { dayBefore, dayName, formatDay } from '../lib/clock';
import { HOLD_HOURS, holdReasonFor } from '../lib/held';
import { CART_CATALOG_IDS, EXTRA_CART_CATALOG_ID, RECYCLING_CATALOG_ID } from '../lib/offer';
import { Container, ErrorNote, Eyebrow, PrimaryButton, RadioCard, SECTION_LABEL, SecondaryButton, Toggle, ToggleList } from './components';
import { perMonth, useGo, useMenuPrices, useOfferView, useStartOver, useUi, useView } from './hooks';
import { PricePanel } from './PricePanel';

const CART_BLURB: Record<string, string> = {
  cat_res_96: 'Weekly, fits about 4 bags',
  cat_res_64: 'Weekly, fits about 3 bags',
};

/** The boundary hold sentence. `holdReason` reads "confirm private road access". */
export function provisionalSentence(holdReason: string): string {
  return `We can probably serve this address but need to ${holdReason} before we start. Your price is held for ${HOLD_HOURS} hours.`;
}

export function OfferScreen() {
  const { match, offer, error } = useOfferView();
  const selections = useUi((s) => s.selections);
  const setSelections = useUi((s) => s.setSelections);
  const go = useGo();
  const startOver = useStartOver();
  const catalog = useView().catalog;
  const prices = useMenuPrices(offer);

  if (!match?.address || !offer) {
    return (
      <main className="mx-auto w-full max-w-[560px] px-4 pt-12">
        <ErrorNote>{error ?? 'Pick an address first.'}</ErrorNote>
        <SecondaryButton className="mt-4" onClick={startOver}>
          Back to the address
        </SecondaryButton>
      </main>
    );
  }

  const address = match.address;
  const routeDayName = dayName(offer.routeDay);
  const provisional = offer.provisional;

  return (
    <main className="pb-16 pt-8 md:pt-16">
      <Container className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,1fr)_440px] md:gap-x-12 md:gap-y-6">
        <section className="flex flex-col gap-6" aria-label="Configure your service">
          <div className="flex flex-col gap-3">
            <Eyebrow>{provisional ? 'Provisional price' : 'Address confirmed'}</Eyebrow>
            <h1 className="text-title font-bold text-ink">
              {provisional
                ? `We can probably serve ${address.line1}. Pickup would be every ${routeDayName}.`
                : `We serve ${address.line1}. Pickup is every ${routeDayName}.`}
            </h1>
            {provisional ? (
              <p className="rounded-lg border border-warning bg-warning-soft px-4 py-3 text-body text-ink" data-testid="provisional-note">
                {provisionalSentence(holdReasonFor(address))}
              </p>
            ) : null}
            <p className="text-body text-ink-muted">
              {offer.zoneName} zone. Choose your cart and start date; the price updates as you go.
            </p>
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className={`mb-3 ${SECTION_LABEL}`}>Cart size</legend>
            <div className="flex flex-col gap-3 sm:flex-row">
              {CART_CATALOG_IDS.map((id) => (
                <RadioCard
                  key={id}
                  name="cart"
                  value={id}
                  checked={selections.cartCatalogId === id}
                  onChange={(v) => setSelections({ cartCatalogId: v })}
                  title={catalog[id]?.name ?? id}
                  description={CART_BLURB[id]}
                  trailing={perMonth(prices[id])}
                />
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-3">
            <p className={SECTION_LABEL} id="addons-label">
              Add-ons
            </p>
            <ToggleList aria-labelledby="addons-label" role="group">
              <Toggle
                inList
                id="extra-cart"
                checked={selections.extraCart}
                onChange={(v) => setSelections({ extraCart: v })}
                label="Extra cart"
                description="A second 96 gal cart, weekly"
                trailing={perMonth(prices[EXTRA_CART_CATALOG_ID])}
              />
              <Toggle
                inList
                id="recycling"
                checked={selections.recycling}
                onChange={(v) => setSelections({ recycling: v })}
                label="Recycling"
                description="Every other week"
                trailing={perMonth(prices[RECYCLING_CATALOG_ID])}
              />
            </ToggleList>
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className={`mb-3 ${SECTION_LABEL}`}>First pickup</legend>
            <div className="flex flex-col gap-3 sm:flex-row">
              {offer.startDateOptions.map((d) => (
                <RadioCard
                  key={d}
                  name="start"
                  value={d}
                  checked={offer.startDate === d}
                  onChange={(v) => setSelections({ startDate: v })}
                  title={formatDay(d)}
                  description={`Cart arrives ${formatDay(dayBefore(d))}`}
                />
              ))}
            </div>
          </fieldset>
        </section>

        <PricePanel offer={offer} className="md:row-span-2 md:self-start" />

        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <PrimaryButton onClick={() => go(provisional ? 'boundaryIntake' : 'checkout')}>
            {provisional ? 'Continue to hold my price' : 'Continue to checkout'}
          </PrimaryButton>
          <SecondaryButton onClick={startOver}>Check a different address</SecondaryButton>
        </div>
      </Container>
    </main>
  );
}
