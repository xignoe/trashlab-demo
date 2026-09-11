import { useId, useState, type KeyboardEvent } from 'react';
import type { AddressSuggestion } from '../../lib/quote';

/** Address combobox. Suggestions come from seed Sites (and open commercial requests with no Site yet);
 *  choosing one sets the site, account, and zone. Free text is allowed: an unknown address still quotes,
 *  it just matches no account. */
export default function AddressField({
  value, suggestions, onText, onSelect,
}: {
  value: string;
  suggestions: AddressSuggestion[];
  onText: (text: string) => void;
  onSelect: (s: AddressSuggestion) => void;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const show = open && suggestions.length > 0;

  const choose = (s: AddressSuggestion) => {
    onSelect(s);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && show) {
      e.preventDefault();
      const s = suggestions[active];
      if (s) choose(s);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <label htmlFor={id} className="text-small font-semibold text-muted">
        Service address
      </label>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={show ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder="Start typing, for example 88 Commerce Way"
        value={value}
        onChange={(e) => {
          onText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="mt-1 h-10 w-full rounded-sm border border-line bg-surface px-3 text-body text-ink outline-none placeholder:text-muted focus:border-accent"
      />
      {show && (
        <ul id={listId} role="listbox" className="absolute top-full right-0 left-0 z-20 mt-1 max-h-[320px] overflow-auto rounded-card border border-line bg-surface py-1 shadow-raised">
          {suggestions.map((s, i) => (
            <li
              key={s.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s);
              }}
              onMouseEnter={() => setActive(i)}
              className={['cursor-pointer px-3 py-2', i === active ? 'bg-accent-soft' : ''].join(' ')}
            >
              <p className="text-body font-semibold text-ink">{s.address}</p>
              <p className="text-small text-muted">
                {s.accountName ?? 'No account yet'}
                {s.zoneId ? `, ${s.zoneId}` : ''}
                {s.requestId ? `, pricing request ${s.requestId}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
