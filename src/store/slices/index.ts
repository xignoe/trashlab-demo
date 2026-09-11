/**
 * Slice registry. The root store spreads every creator listed here into one flat state (src/store/useStore.ts).
 *
 * billing is real (Phase 1). account, pricing, portal, and storefront are empty placeholders that Phase 2 fills,
 * each only in its own file. This file does not change in Phase 2: a slice's interface can grow without touching it.
 */
import { createAccountSlice, type AccountSlice } from './account'
import { createBillingSlice, type BillingSlice } from './billing'
import { createPortalSlice, type PortalSlice } from './portal'
import { createPricingSlice, type PricingSlice } from './pricing'
import { createStorefrontSlice, type StorefrontSlice } from './storefront'
import type { SliceCreator } from './types'

export interface SliceMap {
  billing: BillingSlice
  account: AccountSlice
  pricing: PricingSlice
  portal: PortalSlice
  storefront: StorefrontSlice
}

export type SliceName = keyof SliceMap

/** Every slice's fields and actions, intersected. RootState is CoreState & SlicesState. */
export type SlicesState = BillingSlice & AccountSlice & PricingSlice & PortalSlice & StorefrontSlice

export const sliceRegistry: { [K in SliceName]: SliceCreator<SliceMap[K]> } = {
  billing: createBillingSlice,
  account: createAccountSlice,
  pricing: createPricingSlice,
  portal: createPortalSlice,
  storefront: createStorefrontSlice,
}

export const SLICE_NAMES = Object.keys(sliceRegistry) as SliceName[]

export type { AccountSlice, BillingSlice, PortalSlice, PricingSlice, StorefrontSlice }
export type { CoreState, RootState, SliceCreator } from './types'
