import type { InvoiceStatus } from '../../store/selectors';

const TONE: Record<InvoiceStatus, [string, string]> = {
  paid: ['tl-pill tl-pill--ok', 'Paid'],
  open: ['tl-pill tl-pill--info', 'Open'],
  pastDue: ['tl-pill tl-pill--danger', 'Past due'],
};

export function InvoiceStatusPill({ status }: { status: InvoiceStatus }) {
  const [cls, label] = TONE[status];
  return <span className={cls}>{label}</span>;
}
