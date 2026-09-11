// Landing, drawn as trashlab.com's hero (Paper ER-0): the indigo band continues from the header with a cyan
// eyebrow, a 48/60 white headline, the required sentence, and the address field as a white pill with the
// "Check my address" pill inside it. A typeahead of the seed addresses opens below the field as the buyer
// types; pick with the mouse or with the arrow keys and Enter. Enter with no match checks the typed text
// anyway, which lands on the "outside service area" screen. Three feature cards sit below the band.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { SeedAddress } from '../seed';
import { formatAddress, searchAddresses } from '../store/serviceability';
import { useStore } from '../store/store';
import { useUi } from '../store/ui';
import { Container, cx, Eyebrow, PrimaryButton } from './components';

export const LANDING_SENTENCE = 'Enter your address to confirm service, see your complete price, and get your earliest start date.';

/** The proof row copy, exactly as ER-0 draws it (docs/trashlab-design-language.md). Each card's icon tile is
 *  ER-0's 40px lavender-tint square with a 14px lavender dot; ER-0 carries no other icon art. */
export const PROOF_CARDS: { title: string; body: string }[] = [
  { title: 'Complete price', body: 'Delivery, fuel, the environmental fee, and tax shown before you pay.' },
  { title: 'Start next week', body: "Pick one of your route's next two pickup days. The cart arrives the day before." },
  { title: 'No phone call', body: 'Finish online in about two minutes, any time of day.' },
];

function MapPin() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" className="flex-shrink-0 text-lavender">
      <path d="M10 18s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10Z" />
      <circle cx="10" cy="8" r="2.2" />
    </svg>
  );
}

export function Landing() {
  const query = useUi((s) => s.query);
  const setQuery = useUi((s) => s.setQuery);
  const submitAddress = useUi((s) => s.submitAddress);
  const business = useUi((s) => s.business);
  const addresses = useStore((s) => s.addresses);

  const matches = useMemo(() => searchAddresses(query, useStore.getState()), [query, addresses]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const listOpen = open && query.trim().length > 0 && matches.length > 0;
  const activeIndex = Math.min(active, Math.max(matches.length - 1, 0));

  function pick(address: SeedAddress) {
    setOpen(false);
    submitAddress(address.id);
  }

  function submit() {
    if (matches.length > 0) pick(matches[activeIndex]);
    else if (query.trim()) submitAddress(query.trim());
    else inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && matches.length) {
      e.preventDefault();
      setOpen(true);
      setActive((activeIndex + 1) % matches.length);
    } else if (e.key === 'ArrowUp' && matches.length) {
      e.preventDefault();
      setOpen(true);
      setActive((activeIndex - 1 + matches.length) % matches.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <main>
      <section className="bg-accent pb-16 pt-12 md:pb-[88px] md:pt-20" aria-labelledby="landing-headline">
        <Container>
          <Eyebrow>{business ? 'Business waste service' : 'Residential trash pickup'}</Eyebrow>
          <h1 id="landing-headline" className="mt-4 max-w-[720px] text-display font-bold text-on-brand md:mt-6">
            {business ? 'Container service for your business, on your schedule.' : 'Weekly pickup for your home, priced before you talk to anyone.'}
          </h1>
          <p className="mt-4 max-w-[600px] text-lede text-on-brand-85 md:mt-6">{LANDING_SENTENCE}</p>

          <form
            className="mt-6 max-w-[640px] md:mt-8"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label htmlFor="address" className="sr-only">
              Your address
            </label>
            <div className="relative">
              {/* The white pill: map pin, the input, and the brand pill inset 8px. Under 640px the button drops
                  below the input inside the same white shape so the typed address keeps its width. */}
              <div className="flex flex-col gap-2 rounded-xl bg-surface p-2 focus-within:ring-2 focus-within:ring-on-brand focus-within:ring-offset-2 focus-within:ring-offset-accent sm:flex-row sm:items-center sm:rounded-pill">
                <div className="flex min-w-0 flex-1 items-center gap-3 pl-3">
                  <MapPin />
                  <input
                    ref={inputRef}
                    id="address"
                    name="address"
                    type="text"
                    autoComplete="off"
                    placeholder="Start typing your street address"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setOpen(true);
                      setActive(0);
                    }}
                    onFocus={() => setOpen(true)}
                    onBlur={() => setTimeout(() => setOpen(false), 120)}
                    onKeyDown={onKeyDown}
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={listOpen}
                    aria-controls="address-matches"
                    aria-activedescendant={listOpen ? `address-match-${matches[activeIndex].id}` : undefined}
                    className="h-button min-w-0 flex-1 bg-transparent text-body text-ink placeholder:text-gray-400 focus:outline-none"
                  />
                </div>
                <PrimaryButton type="submit" className="w-full sm:w-auto">
                  Check my address
                </PrimaryButton>
              </div>

              {listOpen ? (
                <ul
                  id="address-matches"
                  role="listbox"
                  aria-label="Matching addresses"
                  className="absolute left-0 right-0 z-10 mt-2 flex flex-col gap-[2px] rounded-lg border border-line bg-surface p-2 shadow-lg"
                >
                  {matches.map((a, i) => (
                    <li
                      key={a.id}
                      id={`address-match-${a.id}`}
                      role="option"
                      aria-selected={i === activeIndex}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(a)}
                      className={cx(
                        'flex cursor-pointer items-center justify-between gap-3 rounded-sm px-3 py-3',
                        i === activeIndex ? 'bg-accent-soft' : 'hover:bg-gray-50',
                      )}
                    >
                      <span className={cx('text-body', i === activeIndex ? 'font-medium text-ink' : 'text-ink')}>{formatAddress(a)}</span>
                      {i === activeIndex ? <span className="flex-shrink-0 text-small text-ink-muted">Enter</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <p className="mt-3 text-label text-on-brand-80">Matches appear as you type. Pick one, or press Enter to check what you typed.</p>
          </form>
        </Container>
      </section>

      <section className="bg-bg pb-12 pt-10 md:pb-16 md:pt-14" aria-label="Why sign up here">
        <Container>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-6">
            {PROOF_CARDS.map((f) => (
              <li key={f.title} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-6">
                <span aria-hidden="true" className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-gray-100">
                  <span className="block h-[14px] w-[14px] rounded-pill bg-lavender" />
                </span>
                <h2 className="text-heading font-bold text-ink">{f.title}</h2>
                <p className="text-body text-ink-muted">{f.body}</p>
              </li>
            ))}
          </ul>
        </Container>
      </section>
    </main>
  );
}
