import { useEffect, type ReactNode } from 'react';

/**
 * Right-hand drawer built on .tl-drawer, with a backdrop, an Escape handler, and a fixed header.
 * Used for "Why this charge", the payment sheet, and the saved method sheet so they all sit the same way.
 * In the merged app the drawer and its backdrop start below the persona bar (PORT_DECISIONS.md entry 13), so the
 * persona tabs stay visible and clickable while a sheet is open.
 */
export function Drawer({
  title, eyebrow, onClose, children, width,
}: { title: string; eyebrow?: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-x-0 bottom-0 z-20"
        style={{ top: 'var(--pb-height)', background: 'rgba(22, 32, 42, 0.32)' }}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="tl-drawer z-30 flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ padding: 0, width: width ? `${width}px` : undefined }}
      >
        <div className="flex items-start gap-3 px-6 py-4 border-b border-border sticky top-0 bg-surface">
          <div className="min-w-0 flex-1">
            {eyebrow && <div className="tl-label" style={{ marginBottom: 2 }}>{eyebrow}</div>}
            <h2 className="text-lg font-semibold leading-tight">{title}</h2>
          </div>
          <button type="button" className="tl-button tl-button--ghost" style={{ height: 32, padding: '0 10px' }} onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        <div className="px-6 py-4 flex flex-col gap-4">{children}</div>
      </aside>
    </>
  );
}
