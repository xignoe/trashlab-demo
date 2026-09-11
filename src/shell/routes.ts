/**
 * The persona map: which screens sit under each persona and where they live. The persona bar renders from this list
 * and routes.test.tsx walks it, so a screen added here is linked and tested in one place.
 */
import type { OpenItemKey } from './openItems'

export type PersonaId = 'owner' | 'office' | 'customer'

export interface Screen {
  /** Hand-offs waiting on this screen, counted live in the persona bar (box 3.7). A persona's badge sums its screens. */
  openItems?: OpenItemKey[]
  label: string
  /** Where the link goes. */
  to: string
  /** Path prefix that marks this screen active (defaults to `to`). */
  match?: string
  /** Active only on an exact match, not on sub-paths under `to`. */
  end?: boolean
  /** The wrapper class the screen's surface mounts inside. */
  surface: 'account' | 'billing' | 'pricing' | 'portal' | 'storefront'
}

export interface Persona {
  id: PersonaId
  label: string
  /** The persona tab's link: its first screen. */
  home: string
  screens: Screen[]
}

/** The account the Office persona opens by default: Ruth Maple, the account every runbook starts from. */
export const DEFAULT_ACCOUNT_ID = 'acct_res_maple'

export const PERSONAS: Persona[] = [
  {
    id: 'owner',
    label: 'Owner',
    home: '/owner/pricing',
    screens: [
      { label: 'Ratebook', to: '/owner/pricing', surface: 'pricing', openItems: ['pricingDrafts'] },
    ],
  },
  {
    id: 'office',
    label: 'Office',
    home: '/office/account',
    screens: [
      // Accounts carries the billing cycle: its banner posts invoices and each account decides its own charges.
      { label: 'Accounts', to: '/office/account', match: '/office/account', surface: 'account', openItems: ['openRequests', 'proposedCharges'] },
      // Customers billed together: each group's cadence, bill dates, terms, and how members get their invoices.
      { label: 'Billing groups', to: '/office/groups', surface: 'account' },
      { label: 'Payments', to: '/office/payments', surface: 'billing' },
      // The storefront's held-signup approval screen is office work (box 3.7d), so it sits here, not under Customer.
      { label: 'Approvals', to: '/office/approvals', surface: 'storefront', openItems: ['heldSignups'] },
    ],
  },
  {
    id: 'customer',
    label: 'Customer',
    home: '/customer/store',
    screens: [
      { label: 'Storefront', to: '/customer/store', surface: 'storefront' },
      { label: 'Portal', to: '/customer/portal', surface: 'portal' },
    ],
  },
]

/** The persona a path belongs to, from its first segment. Persona lives in the URL only. */
export function personaFor(pathname: string): Persona | undefined {
  const first = pathname.split('/').filter(Boolean)[0]
  return PERSONAS.find(p => p.id === first)
}

/** Whether a screen is the one showing at pathname. */
export function isScreenActive(screen: Screen, pathname: string): boolean {
  const prefix = screen.match ?? screen.to
  if (screen.end) return pathname === prefix || pathname === `${prefix}/`
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}
