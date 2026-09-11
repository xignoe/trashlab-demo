import { useMemo, useState } from 'react'
import type { PricingDimension, RateVersion } from '../../../types'
import type { Db } from '../../../store/db'
import { useStore } from '../../../store/useStore'
import { fieldValueId } from '../../../store/engine'
import { FIELD_TYPE_LABEL, SOURCE_LABEL, bandText, dimensionUsage, dimensionValues, dimensions, fieldTypeOf, rawValueText } from '../lib/config'
import { ruleState } from '../lib/rules'
import { BUTTON_LINK, BUTTON_PRIMARY, BUTTON_SECONDARY, Card, SectionHeader } from '../components/form'
import Pill from '../components/Pill'
import { AssignDrawer, BuiltInDrawer, DimensionDrawer, TARGET_NOUN } from './DimensionForms'

type Editing = { kind: 'edit'; dimension?: PricingDimension } | { kind: 'assign'; dimensionId: string }

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const SAMPLE = 4

interface ValueUse {
  assigned: number
  rules: number
  endedRules: number
  rates: number
}

/** The ids of the targets a field is set on: accounts, sites, or active service lines. */
function targetIds(db: Db, dim: PricingDimension): string[] {
  if (dim.source === 'account') return db.accounts.map(a => a.id)
  if (dim.source === 'site') return db.sites.map(s => s.id)
  if (dim.source === 'serviceLine') return db.serviceItems.filter(si => si.status === 'active').map(si => si.id)
  return []
}

/**
 * dimensionUsage gives one total per value; the cards show where it comes from. A number field's assignments are
 * numbers, so each counts under the band it falls in. Rules that ended before today still count, because the store
 * refuses to drop a value any of them names.
 */
function usageByValue(db: Db, dim: PricingDimension, drafts: RateVersion[], today: string): Map<string, ValueUse> {
  const out = new Map<string, ValueUse>()
  const at = (v: string) => {
    if (!out.has(v)) out.set(v, { assigned: 0, rules: 0, endedRules: 0, rates: 0 })
    return out.get(v)!
  }
  const number = fieldTypeOf(dim) === 'number'
  for (const v of Object.values(dim.assignments ?? {})) {
    const key = number ? fieldValueId(dim, v) : v
    if (key) at(key).assigned += 1
  }
  for (const r of [...db.feeRules, ...db.taxRules]) {
    for (const v of r.when?.[dim.id] ?? []) {
      if (ruleState(r, today) === 'ended') at(v).endedRules += 1
      else at(v).rules += 1
    }
  }
  for (const rv of [...db.rateVersions, ...drafts]) if (rv.dims?.[dim.id]) at(rv.dims[dim.id]).rates += 1
  return out
}

/**
 * The Fields section of the Ratebook (DECISIONS.md entries 65 and 68): everything a price can depend on. Built-in
 * fields read their value from the line and can only be renamed; the owner's own fields have a type (choice, number,
 * yes or no, text) and are set on each account, site, or service line, or asked when quoting. Each custom card shows
 * its type, where it is set, its values or bands, the default, and how much it is used; account, site, and service line
 * fields open an Assign drawer.
 */
export default function DimensionsSection({ today }: { today: string }) {
  const db = useStore(s => s.db)
  const drafts = useStore(s => s.pricingDrafts)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const all = dimensions(db)
  const builtIn = all.filter(d => d.builtIn)
  const custom = all.filter(d => !d.builtIn)
  const close = () => setEditing(null)
  const saved = (d: PricingDimension) => {
    setEditing(null)
    setNote(`Saved ${d.name}.`)
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Fields"
        description="Fields: anything a price can depend on. Built-in fields are read from the line; your own fields are set on the account, the site, the service line, or asked when quoting."
        actions={<button type="button" className={BUTTON_PRIMARY} onClick={() => setEditing({ kind: 'edit' })}>Add field</button>}
      />

      {note && (
        <div role="status" className="flex items-center justify-between gap-2 rounded-card border border-success/40 bg-success-soft px-4 py-3">
          <p className="text-body font-semibold text-success">{note}</p>
          <button type="button" className={BUTTON_LINK} onClick={() => setNote(null)}>Dismiss</button>
        </div>
      )}

      <Card label="Built in">
        <header className="border-b border-line px-5 py-4">
          <h3 className="text-h2 font-bold">Built in</h3>
          <p className="mt-0.5 text-body text-muted">Read from the line itself. Their values come from your zones, services, categories, and accounts.</p>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-body">
            <thead>
              <tr className="border-b border-line text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">
                <th className="px-5 py-2 font-bold">Name</th>
                <th className="px-3 py-2 font-bold">Where the value comes from</th>
                <th className="px-3 py-2 font-bold">Values</th>
                <th className="px-3 py-2 font-bold">For example</th>
                <th className="px-5 py-2 font-bold"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {builtIn.map(d => {
                const values = dimensionValues(db, d)
                const rest = values.length - SAMPLE
                return (
                  <tr key={d.id} data-dimension={d.id} className="border-b border-line last:border-b-0">
                    <td className="px-5 py-2.5">
                      <span className="block font-semibold text-ink">{d.name}</span>
                      <span className="block font-mono text-mono text-muted">{d.id}</span>
                    </td>
                    <td className="px-3 py-2.5 text-muted">{SOURCE_LABEL[d.source]}</td>
                    <td className="px-3 py-2.5 font-mono text-mono">{values.length}</td>
                    <td className="px-3 py-2.5 text-small text-muted">
                      {values.slice(0, SAMPLE).map(v => v.label).join(', ')}
                      {rest > 0 ? `, and ${rest} more` : ''}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <button type="button" className={BUTTON_LINK} aria-label={`Rename ${d.name}`} onClick={() => setEditing({ kind: 'edit', dimension: d })}>Rename</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="space-y-3">
        <div>
          <h3 className="text-h2 font-bold">Yours</h3>
          <p className="text-body text-muted">Fields you define: a choice, a number, a yes or no, or text, set on each account, site, or service line, or asked when quoting.</p>
        </div>
        {custom.length === 0 && (
          <Card className="p-5"><p className="text-body text-muted">No fields of your own yet. Add one for customer tiers, collections per month, equipment rental, and the like.</p></Card>
        )}
        {custom.map(d => (
          <CustomCard
            key={d.id}
            dim={d}
            db={db}
            drafts={drafts}
            today={today}
            onEdit={() => setEditing({ kind: 'edit', dimension: d })}
            onAssign={() => setEditing({ kind: 'assign', dimensionId: d.id })}
          />
        ))}
      </div>

      {editing?.kind === 'edit' && editing.dimension?.builtIn && <BuiltInDrawer dimension={editing.dimension} onClose={close} onSaved={saved} />}
      {editing?.kind === 'edit' && !editing.dimension?.builtIn && <DimensionDrawer {...(editing.dimension ? { dimension: editing.dimension } : {})} onClose={close} onSaved={saved} />}
      {editing?.kind === 'assign' && <AssignDrawer dimensionId={editing.dimensionId} onClose={close} />}
    </div>
  )
}

/** A custom field: its type, where it is set, its values or bands with the default, and where it is used. */
function CustomCard({ dim, db, drafts, today, onEdit, onAssign }: { dim: PricingDimension; db: Db; drafts: RateVersion[]; today: string; onEdit: () => void; onAssign: () => void }) {
  const totals = useMemo(() => dimensionUsage(db, dim.id, drafts), [db, dim.id, drafts])
  const byValue = useMemo(() => usageByValue(db, dim, drafts, today), [db, dim, drafts, today])
  const kind = fieldTypeOf(dim)
  const noun = TARGET_NOUN[dim.source]
  const assignable = !!noun
  const targets = useMemo(() => targetIds(db, dim), [db, dim])
  const assignedCount = targets.filter(id => dim.assignments?.[id] !== undefined).length
  const pricedBy = totals.get('__pricedBy') ?? 0
  const multiplies = db.catalog.filter(c => c.quantityField === dim.id)
  let rates = 0
  let rules = 0
  for (const use of byValue.values()) {
    rates += use.rates
    rules += use.rules + use.endedRules
  }
  const defaultText = dim.defaultValueId ? rawValueText(dim, dim.defaultValueId) : ''
  const bandRows = kind === 'number' || kind === 'choice' || kind === 'yesNo'
  const showTable = bandRows && dim.values.length > 0

  const usage = [
    pricedBy ? `${plural(pricedBy, 'service')} priced by it` : null,
    `${plural(rates, 'rate')} keyed by it`,
    `${plural(rules, 'rule')} conditioned on it`,
    kind === 'number' ? (multiplies.length ? `${plural(multiplies.length, 'service')} multiplied by it (${multiplies.map(c => c.name).join(', ')})` : 'no service multiplied by it') : null,
    assignable ? `${assignedCount} of ${plural(targets.length, noun)} set${kind === 'text' ? '' : dim.defaultValueId ? ', the rest have the default' : ''}` : null,
  ].filter((s): s is string => !!s)

  return (
    <Card label={dim.name}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-h2 font-bold">{dim.name}</h4>
            <Pill tone="accent">{FIELD_TYPE_LABEL[kind]}</Pill>
            <Pill>{SOURCE_LABEL[dim.source]}</Pill>
            <span className="font-mono text-mono text-muted">{dim.id}</span>
          </div>
          {dim.description && <p className="mt-0.5 text-body text-muted">{dim.description}</p>}
          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-small">
            {kind === 'number' && (
              <div className="flex gap-1"><dt className="text-muted">Unit:</dt><dd className="text-ink">{dim.unit ?? 'none'}</dd></div>
            )}
            {kind !== 'text' && (
              <div className="flex gap-1"><dt className="text-muted">Default:</dt><dd className="text-ink">{defaultText || 'none'}</dd></div>
            )}
          </dl>
          <p className="mt-0.5 text-small text-muted" data-testid={`usage-${dim.id}`}>{usage.join('; ')}.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {assignable && <button type="button" className={BUTTON_SECONDARY} aria-label={`Assign ${dim.name}`} onClick={onAssign}>Assign</button>}
          <button type="button" className={BUTTON_SECONDARY} aria-label={`Edit ${dim.name}`} onClick={onEdit}>Edit</button>
        </div>
      </header>
      {kind === 'text' && <p className="px-5 py-3 text-small text-muted">Kept for reference. A text field never changes a price.</p>}
      {kind === 'number' && dim.values.length === 0 && (
        <p className="px-5 py-3 text-small text-muted">No bands. The number is used as it is, for example to multiply a price.</p>
      )}
      {showTable && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-body">
            <thead>
              <tr className="border-b border-line text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">
                <th className="px-5 py-2 font-bold">{kind === 'number' ? 'Band' : 'Value'}</th>
                {kind === 'number' && <th className="px-3 py-2 font-bold">Range</th>}
                {assignable && <th className="px-3 py-2 font-bold">Set</th>}
                <th className="px-3 py-2 font-bold">Rules</th>
                <th className="px-3 py-2 font-bold">Rates</th>
                <th className="px-5 py-2 font-bold">In use</th>
              </tr>
            </thead>
            <tbody>
              {dim.values.map(v => {
                const use = byValue.get(v.id) ?? { assigned: 0, rules: 0, endedRules: 0, rates: 0 }
                const isDefault = kind === 'number' ? !!dim.defaultValueId && fieldValueId(dim, dim.defaultValueId) === v.id : v.id === dim.defaultValueId
                const total = use.assigned + use.rules + use.endedRules + use.rates
                return (
                  <tr key={v.id} data-value={v.id} className="border-b border-line last:border-b-0">
                    <td className="px-5 py-2.5">
                      <span className="font-semibold text-ink">{v.label}</span>
                      {isDefault && <span className="ml-2"><Pill tone="muted">{kind === 'number' ? 'Default falls here' : 'Default'}</Pill></span>}
                    </td>
                    {kind === 'number' && <td className="px-3 py-2.5 text-small text-muted">{bandText(v, dim.unit)}</td>}
                    {assignable && (
                      <td className="px-3 py-2.5 font-mono text-mono">
                        {use.assigned}
                        {isDefault && <span className="ml-1 font-sans text-small text-muted">plus {targets.length - assignedCount} with nothing set</span>}
                      </td>
                    )}
                    <td className="px-3 py-2.5 font-mono text-mono">
                      {use.rules}
                      {use.endedRules > 0 && <span className="ml-1 font-sans text-small text-muted">plus {use.endedRules} ended</span>}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-mono">{use.rates}</td>
                    <td className="px-5 py-2.5 text-small text-muted">{total ? plural(total, 'use') : 'Not used, safe to remove'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
