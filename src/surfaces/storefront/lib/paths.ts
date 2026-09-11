// The storefront's screens as nested routes under /customer/store (the prototype's `screen` value and hash links).
// App.tsx mounts the surface at customer/store/*; src/surfaces/storefront/routes.tsx declares the children.
import type { Screen } from './ui';

export const STOREFRONT_BASE = '/customer/store';

/** Path segment under STOREFRONT_BASE for each screen. The held status screen takes a quote id. */
export const SCREEN_SEGMENT: Record<Exclude<Screen, 'held'>, string> = {
  landing: '',
  offer: 'offer',
  boundary: 'boundary',
  boundaryIntake: 'boundary/hold',
  checkout: 'checkout',
  success: 'success',
  franchise: 'franchise',
  notServed: 'not-served',
  commercial: 'commercial',
  office: 'office',
};

/** The old Store inspector path, removed; it redirects to office approvals. */
export const OLD_STORE_SEGMENT = 'office/store';

export const STATUS_SEGMENT = 'status';

/**
 * Held-signup approval is office work (box 3.7d, storefront request R7): the Office screen mounts at
 * /office/approvals under the Office persona (src/surfaces/storefront/office.tsx). The old storefront paths
 * (SCREEN_SEGMENT.office and OLD_STORE_SEGMENT) redirect there.
 */
export const OFFICE_APPROVALS_BASE = '/office/approvals';
const OFFICE_PATH: Partial<Record<Exclude<Screen, 'held'>, string>> = {
  office: OFFICE_APPROVALS_BASE,
};

/** Absolute path of a screen. */
export function pathFor(screen: Exclude<Screen, 'held'>): string {
  const office = OFFICE_PATH[screen];
  if (office) return office;
  const seg = SCREEN_SEGMENT[screen];
  return seg ? `${STOREFRONT_BASE}/${seg}` : STOREFRONT_BASE;
}

/** Absolute path of the customer status screen for one quote. */
export function statusPath(quoteId: string): string {
  return `${STOREFRONT_BASE}/${STATUS_SEGMENT}/${encodeURIComponent(quoteId)}`;
}

/** The full link a buyer can save to reopen a status, from the current page's origin. */
export function statusUrl(quoteId: string): string {
  if (typeof window === 'undefined') return statusPath(quoteId);
  const base = (import.meta.env?.BASE_URL ?? '/').replace(/\/$/, '');
  return `${window.location.origin}${base}${statusPath(quoteId)}`;
}

/** Which screen a pathname shows, and the quote id on the status screen. Unknown paths read as landing. */
export function screenForPath(pathname: string): { screen: Screen; quoteId?: string } {
  if (pathname === OFFICE_APPROVALS_BASE || pathname.startsWith(`${OFFICE_APPROVALS_BASE}/`)) {
    return { screen: 'office' };
  }
  const rest = pathname.startsWith(STOREFRONT_BASE) ? pathname.slice(STOREFRONT_BASE.length).replace(/^\/+|\/+$/g, '') : '';
  if (rest.startsWith(`${STATUS_SEGMENT}/`)) {
    return { screen: 'held', quoteId: decodeURIComponent(rest.slice(STATUS_SEGMENT.length + 1)) };
  }
  const hit = (Object.entries(SCREEN_SEGMENT) as [Exclude<Screen, 'held'>, string][]).find(([, seg]) => seg === rest);
  return { screen: hit ? hit[0] : 'landing' };
}
