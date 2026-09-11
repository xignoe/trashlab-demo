/**
 * Form and layout primitives for the Ratebook's configuration sections (DECISIONS.md entry 65). Pricing's tokens only:
 * text-body, text-small, text-mono, text-eyebrow, text-h1, text-h2, bg-surface, bg-surface-muted, border-line, text-ink,
 * text-muted, text-accent, bg-accent, bg-accent-soft, rounded-card, rounded-pill, shadow-card.
 */
import { useEffect, useId, useState, type ReactNode } from 'react'
import { dollarsToCents } from '../lib/money'

export const INPUT = 'h-9 w-full rounded-sm border border-line bg-surface px-2.5 text-body text-ink outline-none focus:border-accent disabled:opacity-50'
export const BUTTON_PRIMARY = 'rounded-md bg-accent px-3.5 py-2 text-body font-semibold text-surface hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50'
export const BUTTON_SECONDARY = 'rounded-md border border-line bg-surface px-3.5 py-2 text-body font-semibold text-ink hover:bg-surface-muted disabled:opacity-50'
export const BUTTON_LINK = 'rounded-md px-2 py-1 text-mono font-semibold text-accent hover:bg-accent-soft disabled:opacity-50'

/**
 * A large centered modal for a form (every Ratebook edit opens in one). Escape and the backdrop close it; the body
 * scrolls and the footer holds the actions. Named Drawer because it began as a side panel.
 */
export function Drawer({
  title, eyebrow, subtitle, onClose, children, footer, width = 960,
}: {
  title: string
  eyebrow?: string
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  const titleId = useId()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 sm:p-8" role="presentation">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ maxWidth: width }} className="relative flex max-h-full w-full flex-col overflow-hidden rounded-card bg-surface shadow-raised">
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div className="min-w-0">
            {eyebrow && <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-accent">{eyebrow}</p>}
            <h2 id={titleId} className="mt-1 text-h1 font-bold tracking-tight">{title}</h2>
            {subtitle && <div className="mt-1 text-body text-muted">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-body font-semibold text-muted hover:bg-surface-muted hover:text-ink">
            Close
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-6 py-4">{footer}</footer>}
      </section>
    </div>
  )
}

/** A labelled control with an optional hint under the label and an error under the control. */
export function Field({ label, hint, error, children, className = '' }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-small font-semibold text-ink">{label}</span>
      {hint && <span className="block text-small text-muted">{hint}</span>}
      <span className="mt-1 block">{children}</span>
      {error && <span className="mt-1 block text-small font-semibold text-danger" role="alert">{error}</span>}
    </label>
  )
}

/** A group of fields with a heading, for long forms. */
export function FormSection({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-card border border-line p-4">
      <legend className="px-1 text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">{title}</legend>
      {hint && <p className="-mt-1 text-small text-muted">{hint}</p>}
      {children}
    </fieldset>
  )
}

export function TextInput({ value, onChange, placeholder, ariaLabel, disabled }: { value: string; onChange: (v: string) => void; placeholder?: string; ariaLabel?: string; disabled?: boolean }) {
  return <input type="text" value={value} disabled={disabled} placeholder={placeholder} aria-label={ariaLabel} onChange={e => onChange(e.target.value)} className={INPUT} />
}

/** A number field that keeps what the person typed and reports a number or undefined (blank). */
export function NumberInput({
  value, onChange, ariaLabel, step = 'any', min, suffix, placeholder, disabled,
}: {
  value: number | undefined
  onChange: (v: number | undefined) => void
  ariaLabel?: string
  step?: string
  min?: number
  suffix?: string
  placeholder?: string
  disabled?: boolean
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value))
  useEffect(() => {
    if (value === undefined ? text !== '' : Number(text) !== value) setText(value === undefined ? '' : String(value))
    // Only resync when the value changes from outside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <span className="relative block">
      <input
        type="number"
        inputMode="decimal"
        step={step}
        {...(min !== undefined ? { min } : {})}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={e => {
          setText(e.target.value)
          onChange(e.target.value.trim() === '' ? undefined : Number(e.target.value))
        }}
        className={`${INPUT} font-mono ${suffix ? 'pr-12' : ''}`}
      />
      {suffix && <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-small text-muted">{suffix}</span>}
    </span>
  )
}

/** Dollars in, cents out. Reports undefined while the text is not a dollar amount. Allows a leading minus when signed. */
export function MoneyInput({ cents, onChange, ariaLabel, signed = false, disabled }: { cents: number | undefined; onChange: (c: number | undefined) => void; ariaLabel?: string; signed?: boolean; disabled?: boolean }) {
  const toText = (c: number | undefined) => (c === undefined ? '' : (c / 100).toFixed(2))
  const [text, setText] = useState(toText(cents))
  useEffect(() => {
    const parsed = parseMoney(text, signed)
    if (parsed !== cents) setText(toText(cents))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cents])
  return (
    <span className="relative block">
      <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center font-mono text-mono text-muted">$</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        aria-label={ariaLabel}
        onFocus={e => e.target.select()}
        onChange={e => {
          setText(e.target.value)
          onChange(parseMoney(e.target.value, signed))
        }}
        className={`${INPUT} pl-6 font-mono`}
      />
    </span>
  )
}

function parseMoney(text: string, signed: boolean): number | undefined {
  const t = text.trim()
  const negative = signed && t.startsWith('-')
  const cents = dollarsToCents(negative ? t.slice(1) : t)
  if (cents === null) return undefined
  return negative ? -cents : cents
}

export interface Option {
  value: string
  label: string
  group?: string
}

export function Select({ value, onChange, options, ariaLabel, placeholder, disabled }: { value: string; onChange: (v: string) => void; options: Option[]; ariaLabel?: string; placeholder?: string; disabled?: boolean }) {
  const groups = [...new Set(options.map(o => o.group ?? ''))]
  const render = (list: Option[]) => list.map(o => <option key={o.value} value={o.value}>{o.label}</option>)
  return (
    <select value={value} disabled={disabled} aria-label={ariaLabel} onChange={e => onChange(e.target.value)} className={INPUT}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {groups.length > 1 || groups[0] !== ''
        ? groups.map(g => (
          <optgroup key={g} label={g || 'Other'}>
            {render(options.filter(o => (o.group ?? '') === g))}
          </optgroup>
        ))
        : render(options)}
    </select>
  )
}

/** Toggle chips for picking several values (or one, with single). */
export function ChipPicker({ options, value, onChange, single = false, ariaLabel }: { options: Option[]; value: string[]; onChange: (v: string[]) => void; single?: boolean; ariaLabel?: string }) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {options.map(o => {
        const on = value.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(single ? (on ? [] : [o.value]) : on ? value.filter(v => v !== o.value) : [...value, o.value])}
            className={['rounded-pill border px-2.5 py-1 text-small font-semibold transition-colors', on ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-muted hover:text-ink'].join(' ')}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function Toggle({ on, onChange, label, disabled = false }: { on: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={['relative h-5 w-9 shrink-0 rounded-pill transition-colors', on ? 'bg-accent' : 'bg-line', disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'].join(' ')}
    >
      <span className={['absolute top-0.5 left-0.5 h-4 w-4 rounded-pill bg-surface shadow-card transition-transform', on ? 'translate-x-4' : ''].join(' ')} />
    </button>
  )
}

export function Checkbox({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--rt-color-accent)]" />
      <span>
        <span className="block text-body text-ink">{label}</span>
        {hint && <span className="block text-small text-muted">{hint}</span>}
      </span>
    </label>
  )
}

/** A section's title row: heading, a sentence, and actions on the right. */
export function SectionHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-h1 font-bold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 max-w-[720px] text-body text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ children, className = '', label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <section aria-label={label} className={`rounded-card border border-line bg-surface shadow-card ${className}`}>
      {children}
    </section>
  )
}

/** The problems a save refused with, one per line. */
export function Problems({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null
  return (
    <div role="alert" className="rounded-card border border-danger/40 bg-danger-soft px-4 py-3">
      <p className="text-small font-bold text-danger">Not saved</p>
      <ul className="mt-1 list-disc pl-5 text-small text-danger">
        {problems.map(p => <li key={p}>{p}</li>)}
      </ul>
    </div>
  )
}

/** Runs a store write and turns its thrown message into a list of problems for Problems. */
export function attempt<T>(fn: () => T): { ok: true; value: T } | { ok: false; problems: string[] } {
  try {
    return { ok: true, value: fn() }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, problems: message.split(/\.\s+/).map(s => s.replace(/\.$/, '')).filter(Boolean) }
  }
}
