import { useMemo } from 'react'
import type { BillingAccount, Site } from '../../../types'
import type { Db } from '../../../store/db'
import { computeCharge } from '../../../store/engine'
import { formatCents, formatPct } from '../lib/money'

const EXAMPLE_BASE_CENTS = 2900
const EXAMPLE_ZONE = 'zone_open'
const EXAMPLE_ACCOUNT: BillingAccount = {
  id: 'acct_pr_example', payerPartyId: 'party_pr_example', cycle: 'monthly', billedInAdvance: true, autopay: false, status: 'active', deliveryMethod: 'email', taxExempt: false,
}
const EXAMPLE_SITE: Site = { id: 'site_pr_example', accountId: EXAMPLE_ACCOUNT.id, address: 'Example', zoneId: EXAMPLE_ZONE }

/** The canonical computeCharge on a $29.00 recurring line in zone_open. The account and site are synthetic (a non
 *  exempt account at a zone_open site) and exist only in the copy of the db handed to the engine, so the strip
 *  depends only on the fee and tax rules, and every number on it is read off the returned Charge, not typed in. */
export default function WorkedExample({ db, today }: { db: Db; today: string }) {
  const charge = useMemo(
    () =>
      computeCharge(
        {
          id: 'chg_pr_worked_example',
          accountId: EXAMPLE_ACCOUNT.id,
          siteId: EXAMPLE_SITE.id,
          lineType: 'recurring',
          baseCents: EXAMPLE_BASE_CENTS,
          servicedOn: today,
          source: { type: 'manual', id: 'worked_example' },
          description: 'Worked example',
          pricing: { ruleWon: 'manualException' },
        },
        { ...db, accounts: [...db.accounts, EXAMPLE_ACCOUNT], sites: [...db.sites, EXAMPLE_SITE] },
      ),
    [db, today],
  )

  const taxRule = db.taxRules.find(t => t.zoneId === EXAMPLE_ZONE && t.appliesTo.includes('recurring'))
  const taxableBase = charge.baseCents + charge.fees.filter(f => db.feeRules.find(r => r.id === f.feeRuleId)?.taxable).reduce((sum, f) => sum + f.cents, 0)

  const rows: [string, number][] = [
    ['Base', charge.baseCents],
    ...charge.fees.map((f): [string, number] => {
      const rule = db.feeRules.find(r => r.id === f.feeRuleId)
      const how = rule?.kind === 'percent' ? ` (${formatPct(rule.value)} of base)` : ''
      return [`${rule?.name ?? f.feeRuleId}${how}`, f.cents]
    }),
    [`Tax${taxRule ? ` (${formatPct(taxRule.ratePct)} of ${formatCents(taxableBase)})` : ''}`, charge.taxCents],
  ]

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
  )
}
