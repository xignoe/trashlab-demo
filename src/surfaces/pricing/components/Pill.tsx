import type { ReactNode } from 'react'

export type PillTone = 'accent' | 'success' | 'warning' | 'danger' | 'muted'

const TONE: Record<PillTone, string> = {
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  muted: 'bg-surface-muted text-muted',
}

/** Status pill from the Paper "Decide by" pattern: soft ground, small semibold label, optional leading dot. */
export default function Pill({ tone = 'muted', dot = false, children, title }: { tone?: PillTone; dot?: boolean; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2 py-0.5 text-eyebrow font-semibold leading-4 ${TONE[tone]}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-pill bg-current" aria-hidden="true" />}
      {children}
    </span>
  )
}
