/**
 * Runtime ids for rows the account surface creates (addendum C12): every id carries the `ac` infix (wo_ac_0004,
 * si_ac_0097, pay_ac_0808, chg_ac_0827), so it can never collide with another surface's runtime ids (billing's
 * chg_bl_, storefront's _sf_, portal's _p).
 *
 * The prototype kept a module counter per prefix seeded from its own seed file. Here the id is derived from the rows
 * it will join: one above the highest trailing number of any id in that table with the prefix. That makes a preview
 * and its confirm agree by construction (both read the same rows), keeps ids above every seed row and every row
 * another surface has written since, and needs no reset when the store resets.
 */
import type { Container, ServiceCatalog } from '../../../types'

export const RUNTIME_ID_INFIX = 'ac'

/** Highest trailing number on any id shaped `${prefix}_...N` (wo_hale_haul_3 counts as 3 for `wo`); 0 when none. */
export function highestSuffix(prefix: string, ids: Iterable<string>): number {
  let max = 0
  for (const id of ids) {
    if (!id.startsWith(`${prefix}_`)) continue
    const m = /(\d+)$/.exec(id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max
}

/** The next runtime id for a prefix, given every id already in the table it joins. offset reserves several at once. */
export function nextId(prefix: string, ids: Iterable<string>, offset = 0): string {
  return `${prefix}_${RUNTIME_ID_INFIX}_${String(highestSuffix(prefix, ids) + 1 + offset).padStart(4, '0')}`
}

/**
 * Serials for containers created at runtime, in the merged seed's patterns (C96-10231 carts, FL-451 front load,
 * RO20-2001 roll-off) with a 9xxx block the seed never uses: C64-9001, FL-9001, RO20-9001.
 */
export function serialPrefix(catalog: ServiceCatalog): string {
  const size = /\d+/.exec(catalog.sizeLabel || catalog.name)?.[0] ?? ''
  if (catalog.unit === 'cart') return `C${size}`
  if (catalog.unit === 'box') return `RO${size}`
  return 'FL'
}

export function nextSerial(catalog: ServiceCatalog, containers: Container[]): string {
  let max = 9000
  for (const c of containers) {
    const m = /-(9\d{3})$/.exec(c.serial)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${serialPrefix(catalog)}-${max + 1}`
}
