// Invariant 1: publishing a RateVersion never changes a posted Invoice.
// inv_res_maple_0001 and its charges are seed constants (total 8745, fixed under earlier rules, see
// DECISIONS.md 17). The proof is that a publish leaves them deep equal to a snapshot taken before, while the
// same account's next invoice preview is higher, and the superseded RateVersion object is untouched.
import { beforeEach, describe, expect, it } from 'vitest';
import { previewInvoice } from './preview';
import { useStore } from './store';

const invoiceSnapshot = () => {
  const s = useStore.getState();
  const invoice = s.invoices.find((i) => i.id === 'inv_res_maple_0001')!;
  const charges = invoice.chargeIds.map((id) => s.charges.find((c) => c.id === id)!);
  return { invoice, charges };
};

describe('invariant 1: publishing a RateVersion never changes a posted Invoice', () => {
  beforeEach(() => useStore.getState().reset());

  it('inv_res_maple_0001 and its charges survive a 4 percent residential increase unchanged', () => {
    const snapshot = structuredClone(invoiceSnapshot());
    expect(snapshot.invoice.totalCents).toBe(8745);
    expect(snapshot.invoice.locked).toBe(true);
    expect(snapshot.charges).toHaveLength(3);

    const supersededBefore = useStore.getState().rateVersions.find((rv) => rv.id === 'rv_res_96_open_weekly')!;
    const supersededClone = structuredClone(supersededBefore);
    const allBefore = useStore.getState().rateVersions;

    const before = previewInvoice({ accountId: 'acct_res_maple', onDate: '2026-10-01' });
    expect(before.totalCents).toBe(18074);

    const drafts = useStore.getState().createBulkIncreaseDrafts({ lob: 'residential', pct: 4, effectiveFrom: '2026-10-01' });
    expect(drafts).toHaveLength(8);
    expect(drafts.every((d) => d.status === 'draft')).toBe(true);
    const draft96 = drafts.find((d) => d.supersedesId === 'rv_res_96_open_weekly')!;
    expect(draft96.priceCents).toBe(3016);

    // Drafts do not change anything until published.
    expect(previewInvoice({ accountId: 'acct_res_maple', onDate: '2026-10-01' }).totalCents).toBe(before.totalCents);

    const published = useStore.getState().publishRateVersions({ draftIds: drafts.map((d) => d.id), publishedAt: '2026-09-10T15:00:00' });
    expect(published).toHaveLength(8);
    expect(published.every((p) => p.status === 'published' && p.publishedAt === '2026-09-10T15:00:00')).toBe(true);
    expect(published.find((p) => p.id === draft96.id)!.supersedesId).toBe('rv_res_96_open_weekly');

    // The posted invoice and its charges are exactly what they were.
    const afterSnapshot = invoiceSnapshot();
    expect(afterSnapshot.invoice).toEqual(snapshot.invoice);
    expect(afterSnapshot.charges).toEqual(snapshot.charges);
    expect(afterSnapshot.invoice.totalCents).toBe(8745);
    expect(afterSnapshot.charges.map((c) => c.pricing.rateVersionId)).toEqual([
      'rv_res_96_open_weekly',
      'rv_res_extra_open_weekly',
      'rv_res_recycling_open_eow',
    ]);

    // The superseded version is the same object, with the same status, price, and effectiveFrom.
    const supersededAfter = useStore.getState().rateVersions.find((rv) => rv.id === 'rv_res_96_open_weekly')!;
    expect(supersededAfter).toBe(supersededBefore);
    expect(supersededAfter).toEqual(supersededClone);
    expect(supersededAfter).toMatchObject({ status: 'published', priceCents: 2900, effectiveFrom: '2025-01-01' });
    for (const rv of allBefore) {
      const now = useStore.getState().rateVersions.find((r) => r.id === rv.id);
      if (rv.status === 'published') expect(now).toBe(rv);
    }

    // The next invoice for the same account is higher, and points at the new versions.
    const after = previewInvoice({ accountId: 'acct_res_maple', onDate: '2026-10-01' });
    expect(after.totalCents).toBeGreaterThan(before.totalCents);
    expect(after.subtotalCents).toBe((3016 + 936 + 1248) * 3);
    expect(after.lines.map((l) => l.pricing.rateVersionId)).toEqual([draft96.id, expect.stringContaining('rv_res_extra_cart_open_weekly'), expect.stringContaining('rv_res_recycling_open_eow')]);
    expect(after.lines.every((l) => l.pricing.ruleWon === 'zoneRate')).toBe(true);

    // A quarter of the price published before this one still resolves for dates before the new effectiveFrom.
    expect(previewInvoice({ accountId: 'acct_res_maple', onDate: '2026-09-30' }).totalCents).toBe(before.totalCents);
  });

  it('every posted invoice in the seed is unchanged by a bulk increase across all three lobs', () => {
    const s = useStore.getState();
    const invoices = structuredClone(s.invoices);
    const charges = structuredClone(s.charges);
    const ids: string[] = [];
    for (const lob of ['residential', 'frontload', 'rolloff'] as const) {
      ids.push(...s.createBulkIncreaseDrafts({ lob, pct: 4, effectiveFrom: '2026-10-01' }).map((d) => d.id));
    }
    useStore.getState().publishRateVersions({ draftIds: ids, publishedAt: '2026-09-10T15:00:00' });
    expect(useStore.getState().invoices).toEqual(invoices);
    expect(useStore.getState().charges).toEqual(charges);
    expect(useStore.getState().invoices.every((i) => i.locked)).toBe(true);
  });
});
