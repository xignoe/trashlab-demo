// Right-hand side drawer shell used by every account action. Portals into #drawer-root (AccountPage), sits over a
// scrim that closes it on click, closes on Escape, focuses its first field on open, and hands focus back to the
// control that opened it on close. Actions put their confirm button in `footer`, which stays pinned at the bottom.
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Drawer({
  title,
  eyebrow,
  onClose,
  children,
  footer,
}: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Keep the latest onClose without re-running the mount effect (which would steal focus on every render).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = panelRef.current?.querySelector<HTMLElement>('input, select, textarea, [data-autofocus]');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  const content = (
    <>
      <div className="drawer-scrim" onClick={() => onCloseRef.current()} aria-hidden="true" />
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" ref={panelRef}>
        <div className="drawer-head">
          <div className="stack" style={{ gap: 4 }}>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h2 id="drawer-title" className="card-title">{title}</h2>
          </div>
          <button type="button" className="btn btn-tertiary btn-sm" onClick={() => onCloseRef.current()} aria-label="Close drawer">
            Close
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </>
  );
  const root = typeof document !== 'undefined' ? document.getElementById('drawer-root') : null;
  return root ? createPortal(content, root) : content;
}
