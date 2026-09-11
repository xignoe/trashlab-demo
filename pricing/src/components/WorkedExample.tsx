import { useMemo } from 'react';
import { useStore } from '../store/store';
import { computeCharge, toEngineState, type EngineState } from '../store/engine';
import { TODAY } from '../store/dates';
import { formatCents, formatPct } from '../lib/money';

const EXAMPLE_BASE_CENTS = 2900;
const EXAMPLE_ZONE = 'zone_open';

/** computeCharge on a $29.00 recurring line in zone_open. The account and site are synthetic (a non exempt
 *  account at a zone_open site) so the strip depends only on the fee and tax rules, and every number on
 *  it is read off the returned Charge, not typed in. */
export default function WorkedExample() {
  const feeRules = useStore((s) => s.feeRules);
  const taxRules = useStore((s) => s.taxRules);
  const zones = useStore((s) => s.zones);

  const charge = useMemo(() => {
    const state: EngineState = {
      ...toEngineState(useStore.getState()),
      accounts: [{ id: 'acct_example', payerPartyId: 'party_example', cycle: 'monthly', billedInAdvance: true, autopay: false, status: 'active', deliveryMethod: 'email', taxExempt: false }],
      sites: [{ id: 'site_example', accountId: 'acct_example', address: 'Example', zoneId: EXAMPLE_ZONE }],
      feeRules,
      taxRules,
      zones,
    };
    return computeCharge(
      { accountId: 'acct_example', siteId: 'site_example', lineType: 'recurring', baseCents: EXAMPLE_BASE_CENTS, servicedOn: TODAY, source: { type: 'manual', id: 'worked_example' }, description: 'Worked example' },
      state,
    );
  }, [feeRules, taxRules, zones]);

  const taxRule = taxRules.find((t) => t.zoneId === EXAMPLE_ZONE && t.appliesTo.includes('recurring'));
  const taxableBase = charge.baseCents + charge.fees.filter((f) => feeRules.find((r) => r.id === f.feeRuleId)?.taxable).reduce((sum, f) => sum + f.cents, 0);

  const rows: [string, number][] = [
    ['Base', charge.baseCents],
    ...charge.fees.map((f): [string, number] => {
      const rule = feeRules.find((r) => r.id === f.feeRuleId);
      const how = rule?.kind === 'percent' ? ` (${formatPct(rule.value)} of base)` : '';
      return [`${rule?.name ?? f.feeRuleId}${how}`, f.cents];
    }),
    [`Tax${taxRule ? ` (${formatPct(taxRule.ratePct)} of ${formatCents(taxableBase)})` : ''}`, charge.taxCents],
  ];

  return (
    <section className="rounded-card border-l-[3px] border-accent bg-surface-muted px-5 py-4" aria-label="Worked example">
      <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-accent">Worked example</p>
      <p className="mt-1 text-small text-muted">
        computeCharge, {formatCents(EXAMPLE_BASE_CENTS)} recurring line in {EXAMPLE_ZONE}
      </p>
      <dl className="mt-2 space-y-1">
        {rows.map(([label, cents]) => (
          <div key={label} className="flex items-baseline justify-between gap-4">
            <dt className="text-mono text-ink">{label}</dt>
            <dd className="font-mono text-mono text-ink">{formatCents(cents)}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4 border-t border-line pt-2">
          <dt className="text-body font-bold">Total</dt>
          <dd className="font-mono text-body font-bold">{formatCents(charge.totalCents)}</dd>
        </div>
      </dl>
    </section>
  );
}
