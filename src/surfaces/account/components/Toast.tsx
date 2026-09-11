// One transient confirmation at a time, announced politely to screen readers. Dismisses itself after 8 seconds.
import { useEffect, useRef } from 'react';

export interface ToastMessage {
  /** Changes on every new toast so the timer restarts. */
  key: number;
  title: string;
  detail?: string;
}

export function Toast({ toast, onDismiss }: { toast?: ToastMessage; onDismiss: () => void }) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => dismissRef.current(), 8000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div className="toast" key={toast.key}>
          <div className="stack" style={{ gap: 2 }}>
            <div className="toast-title">{toast.title}</div>
            {toast.detail && <div className="toast-detail">{toast.detail}</div>}
          </div>
          <button type="button" className="toast-close" onClick={() => dismissRef.current()} aria-label="Dismiss">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
