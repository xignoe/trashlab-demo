import { useEffect } from 'react'

/** Small bottom-right toast. Auto-dismisses after a few seconds; the close control dismisses it sooner. Stacks above
 *  the persona bar (z-30) and the pricing overlays (z-40). */
export default function Toast({ message, detail, onClose, ttlMs = 8000 }: { message: string | null; detail?: string; onClose: () => void; ttlMs?: number }) {
  useEffect(() => {
    if (!message) return
    const t = window.setTimeout(onClose, ttlMs)
    return () => window.clearTimeout(t)
  }, [message, onClose, ttlMs])

  if (!message) return null
  return (
    <div role="status" aria-live="polite" className="fixed right-6 bottom-6 z-50 flex max-w-[420px] items-start gap-3 rounded-card border border-line bg-accent-strong px-4 py-3 text-surface shadow-raised">
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-pill bg-success" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-body font-bold">{message}</p>
        {detail && <p className="mt-0.5 text-small text-accent-soft">{detail}</p>}
      </div>
      <button type="button" onClick={onClose} aria-label="Dismiss" className="ml-2 rounded-md px-1.5 text-small font-semibold text-accent-soft hover:text-surface">
        Close
      </button>
    </div>
  )
}
