// "Why this charge": walks one Charge's provenance top to bottom in the order the money was built.
//   1. Where it came from (service item, field event, scale ticket, or hauler policy)
//   2. The price rule that set the base
//   3. Each fee rule and the cents it produced
//   4. The tax rule and what was taxable
//   5. The total, shown as an equation
// Everything shown is read from the stored Charge and the rule tables. Nothing is recomputed, so the drawer
// always agrees with the invoice, even after a rate version is published later (invariant 1).

import type { ReactNode } from 'react';
import { usePortal } from '../../store';
import { frequencyLabel } from '../../lib/engine';
import { formatDate, formatDateTime, parseISO } from '../../lib/clock';
import { resolvePhoto } from '../../../../seed';
import { money } from '../../lib/money';
import { Drawer } from '../../components/Drawer';
import { OutcomePill } from '../../components/StatusPill';
import type { Charge, Invoice } from '../../../../types';

const LINE_TYPE_LABEL: Record<Charge['lineType'], string> = {
  recurring: 'Recurring service',
  event: 'Field event',
  fee: 'Fee',
  lateFee: 'Late fee',
};

const RULE_WON_LABEL: Record<Charge['pricing']['ruleWon'], string> = {
  contractOverride: 'Your contract price',
  zoneRate: 'Published rate for your zone',
  standardRate: 'Standard published rate',
  manualException: 'Manual exception approved by the office',
};

function monthsBetween(period: { start: string; end: string }): number {
  const a = parseISO(period.start);
  const b = parseISO(period.end);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + 1;
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="flex gap-3">
      <div
        className="shrink-0 flex items-center justify-center rounded-full text-xs font-semibold"
        style={{ width: 24, height: 24, background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}
        aria-hidden="true"
      >
        {n}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold mb-1">{title}</h3>
        <div className="text-sm text-ink-2 flex flex-col gap-1">{children}</div>
      </div>
    </section>
  );
}

function Fact({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-ink-3 shrink-0" style={{ width: 120 }}>{label}</span>
      <span className={`min-w-0 ${mono ? 'font-mono text-xs' : ''}`}>{children}</span>
    </div>
  );
}

function Row({ label, cents, sign, strong }: { label: ReactNode; cents: number; sign?: '+' | '='; strong?: boolean }) {
  return (
    <div className={`flex items-baseline gap-2 ${strong ? 'font-semibold text-ink' : ''}`}>
      <span className="w-4 text-right text-ink-3 font-mono">{sign ?? ''}</span>
      <span className="flex-1 min-w-0">{label}</span>
      <span className="tl-money">{money(cents)}</span>
    </div>
  );
}

export function WhyThisChargeDrawer({ charge, invoice, onClose }: { charge: Charge; invoice: Invoice; onClose: () => void }) {
  const state = usePortal();
  const hauler = state.hauler[0];
  const site = state.sites.find((s) => s.id === charge.siteId);
  const zone = state.zones.find((z) => z.id === site?.zoneId);
  const account = state.accounts.find((a) => a.id === charge.accountId);
  const catalog = charge.catalogId ? state.catalog.find((c) => c.id === charge.catalogId) : undefined;
  const taxRule = state.taxRules.find((t) => t.zoneId === site?.zoneId);
  const rateVersion = charge.pricing.rateVersionId ? state.rateVersions.find((r) => r.id === charge.pricing.rateVersionId) : undefined;
  const contract = charge.pricing.contractId ? state.contracts.find((c) => c.id === charge.pricing.contractId) : undefined;
  const isLateFee = charge.lineType === 'lateFee';

  // Step 1: the source row.
  const serviceItem = charge.source.type === 'serviceItem' ? state.serviceItems.find((i) => i.id === charge.source.id) : undefined;
  const serviceEvent = charge.source.type === 'serviceEvent' ? state.serviceEvents.find((e) => e.id === charge.source.id) : undefined;
  const scaleTicket = charge.source.type === 'scaleTicket' ? state.scaleTickets.find((t) => t.id === charge.source.id) : undefined;
  const serials = (serviceItem?.containerIds ?? [])
    .map((id) => state.containers.find((c) => c.id === id)?.serial)
    .filter((s): s is string => Boolean(s));
  const override = contract?.overrides.find(
    (o) => o.catalogId === charge.catalogId && (o.frequency === undefined || o.frequency === serviceItem?.frequency),
  );

  // Step 2: how the base was built from the unit price.
  const unitPrice = override?.priceCents ?? rateVersion?.priceCents;
  const months = charge.period ? monthsBetween(charge.period) : 1;
  const qty = serviceItem?.qty ?? 1;
  const baseExplained = unitPrice !== undefined && unitPrice * months * qty === charge.baseCents;

  // Step 3 and 4: fees and what was taxable.
  const fees = charge.fees.map((f) => ({ ...f, rule: state.feeRules.find((r) => r.id === f.feeRuleId) }));
  const feeTotal = fees.reduce((s, f) => s + f.cents, 0);
  const baseTaxable = Boolean(taxRule?.appliesTo.includes(charge.lineType)) && !isLateFee;
  const taxableFees = fees.filter((f) => f.rule?.taxable && taxRule?.appliesTo.includes('fee'));
  const taxableCents = (baseTaxable ? charge.baseCents : 0) + taxableFees.reduce((s, f) => s + f.cents, 0);
  const taxSkipped = account?.taxExempt ? 'Your account is tax exempt, so no tax is applied.' : isLateFee ? null : !taxRule ? 'No tax rule applies to this zone.' : null;

  const when = charge.period
    ? `${formatDate(charge.period.start)} to ${formatDate(charge.period.end)}`
    : charge.servicedOn
      ? formatDate(charge.servicedOn)
      : '';

  return (
    <Drawer title={charge.description} eyebrow={`Why this charge, invoice ${invoice.number}`} onClose={onClose} width={480}>
      <div className="tl-card flex items-center gap-3 text-sm" style={{ background: 'var(--color-surface-2)' }}>
        <span className="tl-pill tl-pill--info">{LINE_TYPE_LABEL[charge.lineType]}</span>
        <span className="text-ink-2">{when}</span>
        <span className="ml-auto font-semibold tl-money">{money(charge.totalCents)}</span>
      </div>

      <Step n={1} title="Where this line came from">
        {serviceItem && (
          <>
            <p>
              Your {catalog?.name ?? charge.catalogId} service, picked up {frequencyLabel(serviceItem.frequency)}
              {serviceItem.qty > 1 ? `, ${serviceItem.qty} of them` : ''}.
            </p>
            <Fact label="Service">{catalog?.name ?? charge.catalogId}{catalog ? ` (${catalog.sizeLabel} ${catalog.unit})` : ''}</Fact>
            <Fact label="Frequency">{frequencyLabel(serviceItem.frequency)}</Fact>
            <Fact label="Container" mono>{serials.length ? serials.join(', ') : 'none assigned'}</Fact>
            <Fact label="Site">{site?.address}{site?.poNumber ? `, ${site.poNumber}` : ''}</Fact>
            {charge.period && <Fact label="Billing period">{formatDate(charge.period.start)} to {formatDate(charge.period.end)}</Fact>}
            <Fact label="Service item" mono>{serviceItem.id}</Fact>
          </>
        )}
        {serviceEvent && (
          <>
            <p>Our driver recorded this on a route stop at your site.</p>
            <Fact label="When">{formatDateTime(serviceEvent.date)}</Fact>
            <Fact label="Outcome"><OutcomePill outcome={serviceEvent.outcome} /></Fact>
            {serviceEvent.exception && <Fact label="Exception">{serviceEvent.exception}</Fact>}
            <Fact label="Driver">{serviceEvent.driver}</Fact>
            {serviceEvent.note && <Fact label="Driver note">{serviceEvent.note}</Fact>}
            <Fact label="Site">{site?.address}{site?.poNumber ? `, ${site.poNumber}` : ''}</Fact>
            {serviceEvent.photoUrl && (
              <img
                src={resolvePhoto(serviceEvent.photoUrl)}
                alt={`${serviceEvent.outcome} at ${site?.address ?? 'site'} on ${serviceEvent.date.slice(0, 10)}`}
                className="rounded-md border border-border mt-1"
                style={{ width: '100%', maxHeight: 180, objectFit: 'cover' }}
              />
            )}
            <Fact label="Event" mono>{serviceEvent.id}</Fact>
          </>
        )}
        {scaleTicket && (
          <>
            <p>The disposal facility weighed this box when it was dumped.</p>
            <Fact label="Facility">{scaleTicket.facility}</Fact>
            <Fact label="Material">{scaleTicket.material}</Fact>
            <Fact label="Weighed">{formatDateTime(scaleTicket.ticketedAt)}</Fact>
            <Fact label="Net weight">{scaleTicket.netLbs.toLocaleString('en-US')} lb ({(scaleTicket.netLbs / 2000).toFixed(2)} tons)</Fact>
            <Fact label="Ticket" mono>{scaleTicket.id}</Fact>
          </>
        )}
        {charge.source.type === 'manual' && isLateFee && (
          <>
            <p>
              This is a late fee under {hauler.name}'s payment policy, not a service. It was added because a balance on this
              account was still unpaid {hauler.policy.lateFeeDay} days after its due date.
            </p>
            <Fact label="Policy">Late fee of {money(hauler.policy.lateFeeCents)} on day {hauler.policy.lateFeeDay} after the due date</Fact>
            {charge.servicedOn && <Fact label="Assessed">{formatDate(charge.servicedOn)}</Fact>}
            <Fact label="Set by" mono>{charge.source.id}</Fact>
          </>
        )}
        {charge.source.type === 'manual' && !isLateFee && (
          <>
            <p>This line was entered by the office.</p>
            <Fact label="Reference" mono>{charge.source.id}</Fact>
          </>
        )}
        {!serviceItem && !serviceEvent && !scaleTicket && charge.source.type !== 'manual' && (
          <Fact label="Source" mono>{charge.source.type} {charge.source.id}</Fact>
        )}
      </Step>

      <Step n={2} title="The price rule that set the base">
        {isLateFee ? (
          <>
            <p>
              Late fees are a flat amount from hauler policy. No rate card or contract is involved, so the base is the
              policy amount itself.
            </p>
            <Fact label="Rule">{hauler.name} policy, lateFeeCents</Fact>
            <Fact label="Amount">{money(hauler.policy.lateFeeCents)}</Fact>
          </>
        ) : (
          <>
            <p>{RULE_WON_LABEL[charge.pricing.ruleWon]}.</p>
            <Fact label="Rule won" mono>{charge.pricing.ruleWon}</Fact>
            {contract && (
              <>
                <Fact label="Contract" mono>{contract.id}</Fact>
                <Fact label="Term">{formatDate(contract.termStart)} to {formatDate(contract.termEnd)}</Fact>
                {override && (
                  <>
                    <Fact label="Contract price">{money(override.priceCents)} per month</Fact>
                    {override.reason && <Fact label="Reason">{override.reason}</Fact>}
                    {override.pctBelowRateCard !== undefined && <Fact label="Discount">{override.pctBelowRateCard}% below the rate card</Fact>}
                  </>
                )}
              </>
            )}
            {rateVersion && (
              <>
                <Fact label="Rate version" mono>{rateVersion.id}</Fact>
                <Fact label="Effective from">{formatDate(rateVersion.effectiveFrom)}</Fact>
                <Fact label="Price">{money(rateVersion.priceCents)} per month{rateVersion.frequency ? `, ${frequencyLabel(rateVersion.frequency)}` : ''}</Fact>
                {rateVersion.zoneId && <Fact label="Zone">{state.zones.find((z) => z.id === rateVersion.zoneId)?.name ?? rateVersion.zoneId}</Fact>}
              </>
            )}
            {!contract && !rateVersion && <Fact label="Reference">No rate version or contract recorded on this line</Fact>}
          </>
        )}
        <div className="tl-card mt-1 text-sm" style={{ background: 'var(--color-surface-2)' }}>
          {baseExplained && unitPrice !== undefined ? (
            <div className="flex items-baseline gap-2">
              <span className="flex-1">
                {money(unitPrice)} per month x {months} month{months === 1 ? '' : 's'}{qty > 1 ? ` x ${qty}` : ''}
              </span>
              <span className="tl-money font-semibold">= {money(charge.baseCents)}</span>
            </div>
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="flex-1">Base amount</span>
              <span className="tl-money font-semibold">{money(charge.baseCents)}</span>
            </div>
          )}
        </div>
      </Step>

      <Step n={3} title="Fees added on top of the base">
        {isLateFee ? (
          <p>
            <strong className="text-ink">Late fees carry no fuel fee and no environmental fee.</strong> {hauler.name}'s fee
            rules apply to service lines only; a late fee is a policy charge ({money(hauler.policy.lateFeeCents)} on day {hauler.policy.lateFeeDay}),
            so nothing is added here.
          </p>
        ) : fees.length === 0 ? (
          <p>No fee rule applies to a {LINE_TYPE_LABEL[charge.lineType].toLowerCase()} line.</p>
        ) : (
          fees.map((f) => (
            <div key={f.feeRuleId} className="tl-card text-sm" style={{ padding: '8px 12px' }}>
              <div className="flex items-baseline gap-2">
                <span className="flex-1 font-medium text-ink">{f.rule?.name ?? f.feeRuleId}</span>
                <span className="tl-money font-semibold">{money(f.cents)}</span>
              </div>
              {f.rule && (
                <div className="text-xs text-ink-3 mt-1">
                  {f.rule.kind === 'percent'
                    ? `${f.rule.value}% of the ${f.rule.base === 'serviceLines' ? 'service base' : 'whole line'} (${money(charge.baseCents)})`
                    : `Flat ${money(f.rule.value)} per ${f.rule.base === 'serviceLines' ? 'service line' : 'line'}`}
                  {f.rule.taxable ? ', taxable' : ', not taxable'}
                  <span className="font-mono"> {f.rule.id}</span>
                </div>
              )}
            </div>
          ))
        )}
      </Step>

      <Step n={4} title="Sales tax">
        {isLateFee ? (
          <p>
            <strong className="text-ink">Late fees are never taxed.</strong> The tax rule for {zone?.name ?? 'your zone'} applies to
            service and fee lines, and hauler policy keeps late fees outside it.
          </p>
        ) : taxSkipped ? (
          <p>{taxSkipped}</p>
        ) : taxRule ? (
          <>
            <p>{zone?.name ?? taxRule.zoneId} charges {taxRule.ratePct}% on the service base plus any taxable fees.</p>
            <Fact label="Zone">{zone?.name ?? taxRule.zoneId}</Fact>
            <Fact label="Rate">{taxRule.ratePct}%</Fact>
            <Fact label="Tax rule" mono>{taxRule.id}</Fact>
            <div className="tl-card mt-1 text-sm flex flex-col gap-1" style={{ background: 'var(--color-surface-2)' }}>
              {baseTaxable && <Row label="Base" cents={charge.baseCents} />}
              {taxableFees.map((f) => (
                <Row key={f.feeRuleId} label={`${f.rule?.name ?? f.feeRuleId} (taxable)`} cents={f.cents} sign="+" />
              ))}
              {fees.filter((f) => !taxableFees.includes(f)).map((f) => (
                <div key={f.feeRuleId} className="text-xs text-ink-3 pl-6">{f.rule?.name ?? f.feeRuleId} is not taxable, so it is left out</div>
              ))}
              <Row label="Taxable amount" cents={taxableCents} sign="=" strong />
              <Row label={`${taxRule.ratePct}% tax, rounded to the cent`} cents={charge.taxCents} strong />
            </div>
          </>
        ) : null}
      </Step>

      <Step n={5} title="The total">
        <div className="tl-card flex flex-col gap-1 text-sm" style={{ background: 'var(--color-surface-2)' }}>
          <Row label="Base" cents={charge.baseCents} />
          {fees.map((f) => (
            <Row key={f.feeRuleId} label={f.rule?.name ?? f.feeRuleId} cents={f.cents} sign="+" />
          ))}
          <Row label="Tax" cents={charge.taxCents} sign="+" />
          <div className="border-t border-border my-1" />
          <Row label="Total for this line" cents={charge.totalCents} sign="=" strong />
        </div>
        <p className="text-xs text-ink-3">
          {money(charge.baseCents)}{fees.map((f) => ` + ${money(f.cents)}`).join('')} + {money(charge.taxCents)} = {money(charge.totalCents)}.
          {feeTotal + charge.taxCents + charge.baseCents === charge.totalCents ? ' Every part adds up to the line total.' : ' These parts do not add up; contact the office.'}
        </p>
        <p className="text-xs text-ink-3">
          Fees and tax were fixed when this charge was created{charge.status === 'posted' ? ' and the invoice is posted' : ''}. A rate change published later never changes this line.
        </p>
      </Step>
    </Drawer>
  );
}
