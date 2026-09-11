// Landing, drawn as trashlab.com's hero (Paper ER-0): the indigo band continues from the header with a 48/60 white
// headline, the required sentence, and the address field as a white pill with the
// "Check my address" pill inside it. A typeahead of the six addresses in src/seed/addresses.json opens below the
// field as the buyer types; pick with the mouse or with the arrow keys and Enter. Enter with no match checks the typed
// text anyway, which lands on the "outside service area" screen.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SeedAddress } from '../../../seed';
import { useStore } from '../../../store/useStore';
import { pathFor } from '../lib/paths';
import { formatAddress, searchAddresses } from '../lib/serviceability';
import { ADDRESS_BOOK } from '../lib/view';
import { Container, cx, PrimaryButton } from './components';
import { useUi } from './hooks';

export const LANDING_SENTENCE = 'Enter your address to confirm service, see your complete price, and get your earliest start date.';

function MapPin() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" className="shrink-0 text-lavender">
      <path d="M10 18s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10Z" />
      <circle cx="10" cy="8" r="2.2" />
    </svg>
  );
}

export function Landing() {
  const query = useUi((s) => s.query);
  const setQuery = useUi((s) => s.setQuery);
  const business = useUi((s) => s.business);
  const navigate = useNavigate();

  const matches = useMemo(() => searchAddresses(query, { addresses: ADDRESS_BOOK }), [query]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const listOpen = open && query.trim().length > 0 && matches.length > 0;
  const activeIndex = Math.min(active, Math.max(matches.length - 1, 0));

  function submitAddress(queryOrId: string) {
    const { screen } = useStore.getState().sfSubmitAddress(queryOrId);
    navigate(pathFor(screen));
  }

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
          <h1 id="landing-headline" className="max-w-[720px] text-display font-bold text-on-brand">
            {business ? 'For a business' : 'Residential trash pickup'}
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
                    className="h-button min-w-0 flex-1 bg-transparent text-body text-ink placeholder:text-gray-400 focus:outline-hidden"
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
                      {i === activeIndex ? <span className="shrink-0 text-small text-ink-muted">Enter</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </form>
        </Container>
      </section>
    </main>
  );
}
