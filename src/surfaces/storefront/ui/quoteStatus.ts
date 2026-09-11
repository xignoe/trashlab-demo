// Status pill label and tone for a Quote, shared by the customer status screen and the office list.
// Kept out of the component files so Vite Fast Refresh can hot-swap them.
import type { Quote } from '../../../types';
import type { PillTone } from './components';

const STATUS_PILL: Record<string, { label: string; tone: PillTone }> = {
  held: { label: 'Held for review', tone: 'warning' },
  accepted: { label: 'Approved', tone: 'success' },
  declined: { label: 'Declined', tone: 'danger' },
  draft: { label: 'Request received', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
};

export function statusPill(status: Quote['status']): { label: string; tone: PillTone } {
  return STATUS_PILL[status] ?? { label: status, tone: 'neutral' };
}
