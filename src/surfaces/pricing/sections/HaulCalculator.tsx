/**
 * A roll-off job priced line by line with the live settings, so the owner sees what a change does before a customer
 * does. Every line is a canonical charge from quoteHaul, with the fees and tax billing would add.
 */
import { useMemo, useState } from 'react'
import { useStore } from '../../../store/useStore'
import { rolloffPolicyOf } from '../../../store/engine'
import { quoteHaul, rolloffMaterials, rolloffSizes } from '../lib/rolloff'
import { dimensionById, valuesOf } from '../lib/config'
import { formatCents } from '../lib/money'
import { Card, Field, NumberInput, Select } from '../components/form'
import { sizeName } from './RolloffForms'

/**
 * The haul calculator: size, material, tons per haul, days on site, miles from the yard, dump and returns, prohibited
 * items found, and service speed when that dimension exists (passed to the engine as context). It recomputes on every
 * change and shows each line's base, adjustments, tax, and total, plus warnings, a refusal, and the totals.
 */
export default function HaulCalculator({ zoneId, today }: { zoneId: string; today: string }) {
  const db = useStore(s => s.db)
  const sizes = useMemo(() => rolloffSizes(db), [db])
  const materials = useMemo(() => rolloffMaterials(db), [db])
  const policy = rolloffPolicyOf(db)
  const speeds = valuesOf(db, 'serviceSpeed')
  const [catalogId, setCatalogId] = useState(() => sizes[0]?.id ?? '')
  const [materialId, setMaterialId] = useState(() => materials.find(m => m.handling === 'standard')?.id ?? materials[0]?.id ?? '')
  const [tons, setTons] = useState<number | undefined>(3)
  const [days, setDays] = useState<number | undefined>(7)
  const [miles, setMiles] = useState<number | undefined>(8)
  const [swaps, setSwaps] = useState<number | undefined>(0)
  const [items, setItems] = useState<Record<string, number | undefined>>({})
  const [speed, setSpeed] = useState(() => dimensionById(db, 'serviceSpeed')?.defaultValueId ?? speeds[0]?.id ?? '')

  const quote = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const [id, n] of Object.entries(items)) if (n) counts[id] = n
    return quoteHaul(db, {
      catalogId, materialId, zoneId, onDate: today,
      tons: tons ?? 0, days: days ?? 0, miles: miles ?? 0, swaps: swaps ?? 0, items: counts,
      ...(speeds.length > 0 && speed ? { context: { serviceSpeed: speed } } : {}),
    })
  }, [db, catalogId, materialId, zoneId, today, tons, days, miles, swaps, items, speeds.length, speed])

  const feeName = (id: string) => db.feeRules.find(r => r.id === id)?.name ?? id
  const zoneName = db.zones.find(z => z.id === zoneId)?.name ?? zoneId

  return (
    <Card label="Haul calculator" className="p-5">
      <h3 className="text-h2 font-bold tracking-tight">Haul calculator</h3>
      <p className="mt-0.5 text-body text-muted">A job priced in {zoneName} on {today} with the settings above, line by line, with the fees and tax billing adds.</p>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="Box size">
          <Select value={catalogId} onChange={setCatalogId} options={sizes.map(s => ({ value: s.id, label: sizeName(s) }))} ariaLabel="Box size" />
        </Field>
        <Field label="Material">
          <Select value={materialId} onChange={setMaterialId} options={materials.map(m => ({ value: m.id, label: m.name }))} ariaLabel="Material" />
        </Field>
        <Field label="Tons per haul">
          <NumberInput value={tons} onChange={setTons} min={0} suffix="t" ariaLabel="Tons per haul" />
        </Field>
        <Field label="Days on site">
          <NumberInput value={days} onChange={setDays} min={0} step="1" suffix="days" ariaLabel="Days on site" />
        </Field>
        <Field label="Miles from yard">
          <NumberInput value={miles} onChange={setMiles} min={0} suffix="mi" ariaLabel="Miles from yard" />
        </Field>
        <Field label="Dump and returns" hint="After the first haul">
          <NumberInput value={swaps} onChange={setSwaps} min={0} step="1" ariaLabel="Dump and returns" />
        </Field>
        {speeds.length > 0 && (
          <Field label="Service speed">
            <Select value={speed} onChange={setSpeed} options={speeds.map(v => ({ value: v.id, label: v.label }))} ariaLabel="Service speed" />
          </Field>
        )}
      </div>
      {policy && policy.prohibitedItems.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {policy.prohibitedItems.map(item => (
            <Field key={item.id} label={item.name} hint={`${formatCents(item.cents)} each`}>
              <NumberInput value={items[item.id]} onChange={v => setItems(prev => ({ ...prev, [item.id]: v }))} min={0} step="1" placeholder="0" ariaLabel={`${item.name} found`} />
            </Field>
          ))}
        </div>
      )}

      {quote.error ? (
        <p role="status" data-testid="haul-error" className="mt-4 rounded-card border border-danger/40 bg-danger-soft px-4 py-3 text-body font-semibold text-danger">{quote.error}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table data-testid="haul-lines" className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-small text-muted">
                <th className="py-2 pr-3 font-semibold">Line</th>
                <th className="py-2 pr-3 text-right font-semibold">Base</th>
                <th className="py-2 pr-3 text-right font-semibold">Adjustments</th>
                <th className="py-2 pr-3 text-right font-semibold">Tax</th>
                <th className="py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map(l => {
                const fees = l.charge.fees.reduce((s, f) => s + f.cents, 0)
                return (
                  <tr key={l.key} data-line={l.key} className="border-b border-line align-top">
                    <td className="py-2 pr-3">
                      <span className="block text-body font-semibold text-ink">{l.label}</span>
                      <span className="block text-small text-muted">{l.detail}</span>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-mono">{formatCents(l.charge.baseCents)}</td>
                    <td className="py-2 pr-3 text-right font-mono text-mono" title={l.charge.fees.map(f => `${feeName(f.feeRuleId)} ${formatCents(f.cents)}`).join(', ')}>
                      {fees ? formatCents(fees) : ''}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-mono">{l.charge.taxCents ? formatCents(l.charge.taxCents) : ''}</td>
                    <td className="py-2 text-right font-mono text-mono font-semibold">{formatCents(l.charge.totalCents)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr data-testid="haul-totals" className="text-body font-bold">
                <td className="py-2 pr-3">Total</td>
                <td className="py-2 pr-3 text-right font-mono">{formatCents(quote.baseCents)}</td>
                <td className="py-2 pr-3 text-right font-mono">{formatCents(quote.feeCents)}</td>
                <td className="py-2 pr-3 text-right font-mono">{formatCents(quote.taxCents)}</td>
                <td className="py-2 text-right font-mono">{formatCents(quote.totalCents)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {quote.warnings.length > 0 && (
        <ul data-testid="haul-warnings" className="mt-3 space-y-1">
          {quote.warnings.map(w => (
            <li key={w} className="rounded-md bg-warning-soft px-3 py-1.5 text-small font-semibold text-warning">{w}</li>
          ))}
        </ul>
      )}
    </Card>
  )
}
