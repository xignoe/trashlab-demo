// The storefront's pattern library: panel, pill, eyebrow, pill buttons, field, toggle, radio card, stat block.
// Every color, radius, and size comes from a Tailwind utility backed by a token in tokens.css.
// Phase 7 follows trashlab.com (docs/trashlab-design-language.md): pill buttons, white 16px cards on the
// light section ground (bg-bg), a cyan sparkle eyebrow, and an indigo stat block for the amount due.
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** The 1200px centered content container trashlab.com uses for every section. */
export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="w-full px-4 md:px-8">
      <div className={cx('mx-auto w-full max-w-page', className)}>{children}</div>
    </div>
  );
}

/** A white card: 16px radius, 1px line border. Used for the order summary, success cards, office rows. */
export function Panel({ children, className, ...rest }: { children: ReactNode; className?: string } & Omit<HTMLAttributes<HTMLElement>, 'children'>) {
  return (
    <section className={cx('rounded-lg border border-line bg-surface p-5 md:p-6', className)} {...rest}>
      {children}
    </section>
  );
}

/** trashlab.com's four-point sparkle, drawn in currentColor. Decorative only. */
export function Sparkle({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 20 20" width="20" height="20" className={cx('flex-shrink-0', className)}>
      <path d="M10 1.5L12.1 7.9L18.5 10L12.1 12.1L10 18.5L7.9 12.1L1.5 10L7.9 7.9L10 1.5Z" fill="currentColor" />
    </svg>
  );
}

/** The kicker line above a headline: a cyan sparkle beside 18/27 medium cyan text. */
export function Eyebrow({ children, className, ...rest }: { children: ReactNode; className?: string } & Omit<HTMLAttributes<HTMLParagraphElement>, 'children'>) {
  return (
    <p className={cx('flex items-center gap-2 text-eyebrow font-medium text-cyan', className)} {...rest}>
      <Sparkle />
      <span>{children}</span>
    </p>
  );
}

export type PillTone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral';

/** Paper's pill (TrashLab file, D3-0): a soft tone fill, ink text, and a dot in the tone color. The text stays
 *  ink on every tone because the warning color is too light to read as text (DECISIONS.md, Phase 6). */
const PILL_TONES: Record<PillTone, { fill: string; dot: string }> = {
  accent: { fill: 'bg-accent-soft', dot: 'bg-accent' },
  success: { fill: 'bg-success-soft', dot: 'bg-success' },
  warning: { fill: 'bg-warning-soft', dot: 'bg-warning' },
  danger: { fill: 'bg-danger-soft', dot: 'bg-danger' },
  neutral: { fill: 'bg-gray-100', dot: 'bg-gray-400' },
};

export function Pill({ tone = 'neutral', children }: { tone?: PillTone; children: ReactNode }) {
  const t = PILL_TONES[tone];
  return (
    <span className={cx('inline-flex items-center gap-[6px] rounded-pill px-[10px] py-1 text-small font-semibold text-ink', t.fill)}>
      <span aria-hidden="true" className={cx('block h-[6px] w-[6px] flex-shrink-0 rounded-full', t.dot)} />
      {children}
    </span>
  );
}

export const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg';
/** The same ring for controls that sit on the indigo band: white, offset by the brand color. */
export const FOCUS_RING_ON_BRAND = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-on-brand focus-visible:ring-offset-2 focus-visible:ring-offset-accent';

export type ButtonSize = 'default' | 'compact';

/** trashlab.com pill: 50px tall, 28px side padding, 16px semibold. Compact is 44px, 20px padding, 14px semibold. */
const BUTTON_SIZE: Record<ButtonSize, string> = {
  default: 'h-button px-7 text-body',
  compact: 'h-button-compact px-5 text-label',
};

type PillButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { size?: ButtonSize };

function pillBase(size: ButtonSize) {
  return cx('inline-flex flex-shrink-0 items-center justify-center whitespace-nowrap rounded-pill font-semibold transition-colors', BUTTON_SIZE[size]);
}

export function PrimaryButton({ className, children, size = 'default', ...rest }: PillButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        pillBase(size),
        'bg-accent text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-gray-400',
        FOCUS_RING,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** A white pill with a 1px line border. */
export function SecondaryButton({ className, children, size = 'default', ...rest }: PillButtonProps) {
  return (
    <button
      type="button"
      className={cx(pillBase(size), 'border border-line bg-surface text-ink hover:bg-gray-50', FOCUS_RING, className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/** The destructive confirm (office decline, reset to seed). Same pill as the primary button, danger color. */
export function DangerButton({ className, children, size = 'default', ...rest }: PillButtonProps) {
  return (
    <button type="button" className={cx(pillBase(size), 'bg-danger text-white hover:opacity-90', FOCUS_RING, className)} {...rest}>
      {children}
    </button>
  );
}

/** trashlab.com's ghost pill on the indigo band: transparent, white text, a 1px white border at 25%. */
export function GhostButton({ className, children, size = 'compact', ...rest }: PillButtonProps) {
  return (
    <button
      type="button"
      className={cx(pillBase(size), 'border border-on-brand-25 bg-transparent text-on-brand hover:bg-on-brand-18', FOCUS_RING_ON_BRAND, className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/** A text-styled button for navigation ("Start over", "Change my cart"). */
export function LinkButton({ className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx('rounded text-small font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline', FOCUS_RING, className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/** A 14px semibold section label ("Cart size", "Add-ons", "Contact"). */
export const SECTION_LABEL = 'text-label font-semibold text-ink';

/** Label above a control, with optional helper text under it. */
export function Field({ label, hint, htmlFor, children, className }: { label: string; hint?: string; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-small text-ink-muted">
        {label}
      </label>
      {children}
      {hint ? <p className="text-small text-ink-muted">{hint}</p> : null}
    </div>
  );
}

/** Inputs keep an 8px radius (trashlab.com shows no inputs to copy): 1px line border, 2px brand border on focus. */
const CONTROL =
  'h-12 w-full rounded-sm border border-line bg-surface px-4 text-body text-ink placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent';

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(CONTROL, className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(CONTROL, 'appearance-none', className)} {...rest}>
      {children}
    </select>
  );
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cx(
        'min-h-[96px] w-full rounded-sm border border-line bg-surface px-4 py-3 text-body text-ink placeholder:text-gray-400',
        'focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent',
        className,
      )}
      {...rest}
    />
  );
}

/** A 40x24 pill switch. `onBrand` draws it for the indigo header (white 18% track, white when on). */
export function Switch({
  checked,
  onChange,
  id,
  onBrand = false,
  label,
}: {
  checked: boolean;
  onChange(next: boolean): void;
  id?: string;
  onBrand?: boolean;
  label?: string;
}) {
  const track = onBrand ? (checked ? 'bg-on-brand' : 'bg-on-brand-18') : checked ? 'bg-accent' : 'bg-gray-200';
  const knob = onBrand && checked ? 'bg-accent' : 'bg-white';
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative h-6 w-10 flex-shrink-0 rounded-pill p-[3px] transition-colors', track, onBrand ? FOCUS_RING_ON_BRAND : FOCUS_RING)}
    >
      <span className={cx('block h-[18px] w-[18px] rounded-full shadow-sm transition-transform', knob, checked && 'translate-x-4')} />
    </button>
  );
}

/** An on/off row: switch, label and description, an optional trailing value. Standalone rows carry their own
 *  card; inside a ToggleList they are bare rows split by the list's dividers. */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  trailing,
  id,
  inList = false,
}: {
  checked: boolean;
  onChange(next: boolean): void;
  label: string;
  description?: string;
  trailing?: ReactNode;
  id?: string;
  inList?: boolean;
}) {
  return (
    <label
      className={cx(
        'flex cursor-pointer items-center justify-between gap-4 p-5',
        !inList && 'rounded-lg border border-line bg-surface',
      )}
    >
      <span className="flex min-w-0 items-center gap-4">
        <Switch id={id} checked={checked} onChange={onChange} />
        <span className="flex min-w-0 flex-col">
          <span className="text-body font-semibold text-ink">{label}</span>
          {description ? <span className="text-label text-ink-muted">{description}</span> : null}
        </span>
      </span>
      {trailing ? <span className="flex-shrink-0 text-body font-semibold tabular-nums text-ink">{trailing}</span> : null}
    </label>
  );
}

/** One white 16px card holding several toggle rows with 1px dividers (ES-0 add-ons). */
export function ToggleList({ children, className, ...rest }: { children: ReactNode; className?: string } & Omit<HTMLAttributes<HTMLDivElement>, 'children'>) {
  return (
    <div className={cx('flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface', className)} {...rest}>
      {children}
    </div>
  );
}

/** A radio option drawn as a card. The real radio input is visually hidden but keyboard reachable.
 *  Unselected: 1px line border on white. Selected: 2px brand border on the lavender tint (padding drops by
 *  1px so the card does not move). */
export function RadioCard({
  name,
  value,
  checked,
  onChange,
  title,
  description,
  trailing,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange(value: string): void;
  title: string;
  description?: string;
  trailing?: ReactNode;
}) {
  return (
    <label
      className={cx(
        'flex flex-1 cursor-pointer items-center justify-between gap-3 rounded-lg',
        checked ? 'border-2 border-accent bg-gray-100 p-[19px]' : 'border border-line bg-surface p-5 hover:bg-gray-50',
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-bg',
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} className="sr-only" />
      <span className="flex min-w-0 flex-col">
        <span className="text-body font-bold text-ink">{title}</span>
        {description ? <span className="text-label text-ink-muted">{description}</span> : null}
      </span>
      {trailing ? <span className="flex-shrink-0 text-body font-bold tabular-nums text-ink">{trailing}</span> : null}
    </label>
  );
}

/** A labelled money row inside a panel. */
export function MoneyRow({ label, value, muted, className }: { label: ReactNode; value: ReactNode; muted?: boolean; className?: string }) {
  return (
    <div className={cx('flex items-baseline justify-between gap-4', className)}>
      <span className={cx('text-body', muted ? 'text-ink-muted' : 'text-ink')}>{label}</span>
      <span className={cx('text-body tabular-nums', muted ? 'text-ink-muted' : 'text-ink')}>{value}</span>
    </div>
  );
}

/** trashlab.com's stat card on indigo: the amount due as a brand block with a 2px hairline border, 16px radius,
 *  a 14px white-80% label, a 40/48 bold white amount, and 14px white-80% lines under it. */
export function StatBlock({
  label,
  amount,
  amountTestId,
  children,
  className,
  ...rest
}: {
  label: ReactNode;
  amount: ReactNode;
  amountTestId?: string;
  children?: ReactNode;
  className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>) {
  return (
    <div className={cx('flex flex-col gap-1 rounded-lg border-2 border-hairline-on-brand bg-accent px-6 py-5 text-on-brand', className)} {...rest}>
      <span className="text-label font-semibold text-on-brand-80">{label}</span>
      <span className="text-stat font-bold tabular-nums text-on-brand" data-testid={amountTestId}>
        {amount}
      </span>
      {children ? <div className="flex flex-col gap-[2px] text-label text-on-brand-80">{children}</div> : null}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-sm border border-danger bg-danger-soft px-4 py-3 text-body text-danger">
      {children}
    </p>
  );
}
