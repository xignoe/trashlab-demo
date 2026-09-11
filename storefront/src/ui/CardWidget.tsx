// The mock tokenized card widget, shared by checkout ("Hosted by the payment provider...") and the
// boundary intake ("Your card is saved, not charged"). It takes brand, last 4, and expiry only; there
// is no card number field anywhere in the DOM and nothing to paste a number into.
import { TODAY } from '../store/clock';
import { Field, Select, TextInput } from './components';

export interface CardInput {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

const BRANDS = [
  { value: 'visa', label: 'Visa' },
  { value: 'mastercard', label: 'Mastercard' },
  { value: 'amex', label: 'American Express' },
  { value: 'discover', label: 'Discover' },
];

const TODAY_YEAR = Number(TODAY.slice(0, 4));
const YEARS = Array.from({ length: 10 }, (_, i) => TODAY_YEAR + i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export const EMPTY_CARD: CardInput = { brand: 'visa', last4: '', expMonth: 12, expYear: TODAY_YEAR + 3 };

/** "Visa ending 4242" for a stored token or the widget's value. */
export function cardLabel(card: { brand: string; last4: string } | undefined): string {
  if (!card) return 'the saved card';
  const brand = BRANDS.find((b) => b.value === card.brand)?.label ?? card.brand.charAt(0).toUpperCase() + card.brand.slice(1);
  return `${brand} ending ${card.last4}`;
}

export function CardWidget({ label, value, onChange }: { label: string; value: CardInput; onChange(next: CardInput): void }) {
  const set = (patch: Partial<CardInput>) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-gray-100 p-4" aria-label="Payment card">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-label font-semibold text-ink">Payment card</p>
        <p className="text-small text-ink-muted">{label}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Brand" htmlFor="brand">
          <Select id="brand" value={value.brand} onChange={(e) => set({ brand: e.target.value })}>
            {BRANDS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Last 4 digits" htmlFor="last4">
          <TextInput
            id="last4"
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            placeholder="4242"
            value={value.last4}
            onChange={(e) => set({ last4: e.target.value.replace(/\D/g, '').slice(0, 4) })}
            required
          />
        </Field>
        <Field label="Expiry" htmlFor="exp-month">
          <div className="flex gap-2">
            <Select id="exp-month" aria-label="Expiry month" value={value.expMonth} onChange={(e) => set({ expMonth: Number(e.target.value) })}>
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {String(m).padStart(2, '0')}
                </option>
              ))}
            </Select>
            <Select aria-label="Expiry year" value={value.expYear} onChange={(e) => set({ expYear: Number(e.target.value) })}>
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </div>
        </Field>
      </div>
    </div>
  );
}
