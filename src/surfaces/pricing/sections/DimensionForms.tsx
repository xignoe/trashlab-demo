/**
 * The drawers of the Fields section (DECISIONS.md entries 65 and 68): rename a built-in field, add or edit a custom
 * field (its type, where it is set, and its values, bands, or default), and set the value of an account, site, or
 * service line field on each target. Every write goes through the pricing slice (saveDimension, assignDimensionValue);
 * a refused write shows its problems.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PricingDimension } from '../../../types'
import { useStore } from '../../../store/useStore'
import { fieldValueId } from '../../../store/engine'
import {
  CUSTOM_SOURCES, CYCLE_LABEL, FIELD_TYPES, FIELD_TYPE_HINT, FIELD_TYPE_LABEL, SOURCE_LABEL, bandText, dimensionUsage, dimensionValues, fieldTypeOf,
  slugify, type FieldType,
} from '../lib/config'
import { BUTTON_LINK, BUTTON_PRIMARY, BUTTON_SECONDARY, Drawer, Field, INPUT, NumberInput, Problems, Select, TextInput, attempt } from '../components/form'
import Pill from '../components/Pill'
import { Group } from './ServiceForms'

/** An example of each custom source, as the owner would read it on a line. */
export const SOURCE_HELP: Record<string, string> = {
  account: 'For example, Customer tier: VIP',
  site: 'For example, Site access: walk-out',
  serviceLine: 'For example, Collections per month: 12',
  input: 'For example, Service speed: same day',
}

/** What the set-on noun is called in copy. */
export const TARGET_NOUN: Record<string, string> = { account: 'account', site: 'site', serviceLine: 'service line' }

/** Rename a built-in field. Its values come from the line, so only the name and description change. */
export function BuiltInDrawer({ dimension, onClose, onSaved }: { dimension: PricingDimension; onClose: () => void; onSaved: (d: PricingDimension) => void }) {
  const saveDimension = useStore(s => s.saveDimension)
  const [name, setName] = useState(dimension.name)
  const [description, setDescription] = useState(dimension.description ?? '')
  const [problems, setProblems] = useState<string[]>([])
  const save = () => {
    const result = attempt(() => saveDimension({ id: dimension.id, name, ...(description.trim() ? { description } : {}) }))
    if (!result.ok) return setProblems(result.problems)
    onSaved(result.value)
  }
  return (
    <Drawer
      title={`Rename ${dimension.name}`}
      eyebrow="Built-in field"
      subtitle={`${SOURCE_LABEL[dimension.source]}. Its values come from there, so only the name changes.`}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button type="button" className={BUTTON_SECONDARY} onClick={onClose}>Cancel</button>
          <button type="button" className={BUTTON_PRIMARY} onClick={save}>Save field</button>
        </>
      }
    >
      <Problems problems={problems} />
      <Field label="Name"><TextInput value={name} onChange={setName} ariaLabel="Field name" /></Field>
      <Field label="Description"><TextInput value={description} onChange={setDescription} ariaLabel="Field description" placeholder="Optional" /></Field>
    </Drawer>
  )
}

interface Row {
  key: string
  id?: string
  label: string
}

interface BandRow extends Row {
  min?: number
  max?: number
}

/** A radio card: a radio, a bold label, and a line of help under it. Its accessible name starts with the label. */
function RadioCard({ name, value, checked, disabled, onChange, label, help }: { name: string; value: string; checked: boolean; disabled: boolean; onChange: () => void; label: string; help: string }) {
  return (
    <label className={['flex items-start gap-2.5 rounded-card border p-3', checked ? 'border-accent bg-accent-soft' : 'border-line', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'].join(' ')}>
      <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={onChange} className="mt-1 h-4 w-4 accent-[var(--rt-color-accent)]" />
      <span>
        <span className="block text-body font-semibold text-ink">{label}</span>
        <span className="block text-small text-muted">{help}</span>
      </span>
    </label>
  )
}

/**
 * Add or edit a custom field: its name, its type (choice, number, yes or no, text), where a line's value is set
 * (account, site, service line, or asked when quoting), and by type its values with a default, its unit and bands
 * with a default number, or a default yes or no. Type and source are locked once saved. Existing values and bands keep
 * their ids; new ones get one from their label. The store refuses overlapping bands and dropping a value in use.
 */
export function DimensionDrawer({ dimension, onClose, onSaved }: { dimension?: PricingDimension; onClose: () => void; onSaved: (d: PricingDimension) => void }) {
  const db = useStore(s => s.db)
  const drafts = useStore(s => s.pricingDrafts)
  const saveDimension = useStore(s => s.saveDimension)
  const counter = useRef(0)
  const nextKey = () => `new_${(counter.current += 1)}`
  const startType = dimension ? fieldTypeOf(dimension) : 'choice'

  const [name, setName] = useState(dimension?.name ?? '')
  const [type, setType] = useState<FieldType>(startType)
  const [source, setSource] = useState<PricingDimension['source'] | ''>(dimension?.source ?? '')
  const [rows, setRows] = useState<Row[]>(() => (dimension && startType === 'choice' ? dimension.values.map(v => ({ key: v.id, id: v.id, label: v.label })) : [{ key: 'new_a', label: '' }, { key: 'new_b', label: '' }]))
  const [defaultKey, setDefaultKey] = useState<string>(dimension && startType === 'choice' ? dimension.defaultValueId ?? '' : 'new_a')
  const [unit, setUnit] = useState(dimension?.unit ?? '')
  const [bands, setBands] = useState<BandRow[]>(() => (dimension && startType === 'number' ? dimension.values.map(v => ({ key: v.id, id: v.id, label: v.label, ...(v.min !== undefined ? { min: v.min } : {}), ...(v.max !== undefined ? { max: v.max } : {}) })) : []))
  const [defaultNumber, setDefaultNumber] = useState<number | undefined>(dimension && startType === 'number' && dimension.defaultValueId !== undefined ? Number(dimension.defaultValueId) : undefined)
  const [defaultYesNo, setDefaultYesNo] = useState<string>(dimension ? (startType === 'yesNo' ? dimension.defaultValueId ?? '' : '') : 'no')
  const [description, setDescription] = useState(dimension?.description ?? '')
  const [problems, setProblems] = useState<string[]>([])
  const usage = useMemo(() => (dimension ? dimensionUsage(db, dimension.id, drafts) : new Map<string, number>()), [db, dimension, drafts])

  const setLabel = (key: string, label: string) => setRows(rs => rs.map(r => (r.key === key ? { ...r, label } : r)))
  const remove = (key: string) => {
    setRows(rs => rs.filter(r => r.key !== key))
    if (defaultKey === key) setDefaultKey('')
  }
  const setBand = (key: string, patch: Partial<BandRow>) => setBands(bs => bs.map(b => {
    if (b.key !== key) return b
    const next = { ...b, ...patch }
    // A blank end is open: drop it rather than keep undefined.
    if (next.min === undefined) delete next.min
    if (next.max === undefined) delete next.max
    return next
  }))

  const save = () => {
    let values: { id?: string; label: string; min?: number; max?: number }[] | undefined
    let defaultValueId: string | undefined
    if (type === 'choice') {
      values = rows.map(r => ({ ...(r.id ? { id: r.id } : {}), label: r.label }))
      const def = rows.find(r => r.key === defaultKey && r.label.trim())
      // A new value's id is made from its label the same way the store makes it.
      if (def) defaultValueId = def.id ?? slugify(def.label, 20)
    } else if (type === 'number') {
      values = bands.map(b => ({ ...(b.id ? { id: b.id } : {}), label: b.label, ...(b.min !== undefined ? { min: b.min } : {}), ...(b.max !== undefined ? { max: b.max } : {}) }))
      if (defaultNumber !== undefined) defaultValueId = String(defaultNumber)
    } else if (type === 'yesNo') {
      if (defaultYesNo) defaultValueId = defaultYesNo
    }
    const result = attempt(() =>
      saveDimension({
        ...(dimension ? { id: dimension.id } : {}),
        name,
        ...(source ? { source } : {}),
        ...(dimension ? {} : { type }),
        ...(type === 'number' ? { unit } : {}),
        ...(values ? { values } : {}),
        ...(defaultValueId !== undefined ? { defaultValueId } : {}),
        ...(description.trim() ? { description } : {}),
      }),
    )
    if (!result.ok) return setProblems(result.problems)
    onSaved(result.value)
  }

  return (
    <Drawer
      title={dimension ? `Edit ${dimension.name}` : 'Add a field'}
      eyebrow="Fields"
      subtitle="Something a price can depend on. Rates and adjustments can be keyed by its values."
      onClose={onClose}
      footer={
        <>
          <button type="button" className={BUTTON_SECONDARY} onClick={onClose}>Cancel</button>
          <button type="button" className={BUTTON_PRIMARY} onClick={save}>Save field</button>
        </>
      }
    >
      <Problems problems={problems} />
      <Field label="Name"><TextInput value={name} onChange={setName} ariaLabel="Field name" placeholder="Collections per month" /></Field>

      <Group label="Type" hint={dimension ? 'A field keeps its type, because rates, rules, and values were set against it. Add a new field for another type.' : undefined}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {FIELD_TYPES.map(t => (
            <RadioCard key={t} name="field-type" value={t} checked={type === t} disabled={!!dimension && startType !== t} onChange={() => setType(t)} label={FIELD_TYPE_LABEL[t]} help={FIELD_TYPE_HINT[t]} />
          ))}
        </div>
      </Group>

      <Group label="Where it is set" hint={dimension ? 'A field keeps where it is set. Add a new field to read a value from somewhere else.' : undefined}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CUSTOM_SOURCES.map(src => (
            <RadioCard key={src} name="field-source" value={src} checked={source === src} disabled={!!dimension && dimension.source !== src} onChange={() => setSource(src)} label={SOURCE_LABEL[src]} help={SOURCE_HELP[src] ?? ''} />
          ))}
        </div>
      </Group>

      {type === 'choice' && (
        <Group label="Values" hint="Pick the default: the value a line has when nothing sets one.">
          <ul className="space-y-2">
            {rows.map((row, i) => {
              const used = row.id ? usage.get(row.id) ?? 0 : 0
              return (
                <li key={row.key} className="flex items-center gap-2" data-value-row={row.id ?? ''}>
                  <input type="radio" name="field-default" checked={defaultKey === row.key} onChange={() => setDefaultKey(row.key)} aria-label={`Make value ${i + 1} the default`} className="h-4 w-4 shrink-0 accent-[var(--rt-color-accent)]" />
                  <input type="text" value={row.label} onChange={e => setLabel(row.key, e.target.value)} aria-label={`Value ${i + 1}`} placeholder="Label" className={INPUT} />
                  <span className="w-24 shrink-0 text-small text-muted">
                    {defaultKey === row.key ? 'Default' : row.id ? (used ? `Used ${used}x` : 'Not used') : 'New'}
                  </span>
                  <button type="button" className={BUTTON_LINK} aria-label={`Remove value ${i + 1}`} disabled={rows.length === 1} onClick={() => remove(row.key)}>Remove</button>
                </li>
              )
            })}
          </ul>
          <button type="button" className={`${BUTTON_LINK} mt-2`} onClick={() => setRows(rs => [...rs, { key: nextKey(), label: '' }])}>Add value</button>
        </Group>
      )}

      {type === 'number' && (
        <>
          <Field label="Unit" hint="What the number counts, as it reads after the number.">
            <TextInput value={unit} onChange={setUnit} ariaLabel="Unit" placeholder="collections per month, lbs, cubic yards" />
          </Field>
          <Group
            label="Bands"
            hint="Optional. Rates and adjustments are keyed by the band a number falls in. A number field with no bands can still multiply a price. Bands must not overlap; a number in a gap between bands falls in none."
          >
            {bands.length === 0 ? (
              <p className="text-small text-muted">No bands. The number is used as it is.</p>
            ) : (
              <ul className="space-y-3">
                {bands.map((band, i) => {
                  const used = band.id ? usage.get(band.id) ?? 0 : 0
                  return (
                    <li key={band.key} className="rounded-card border border-line p-3" data-band-row={band.id ?? ''}>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                        <Field label="Label">
                          <TextInput value={band.label} onChange={v => setBand(band.key, { label: v })} ariaLabel={`Band ${i + 1} label`} placeholder="20 to 29" />
                        </Field>
                        <Field label="From">
                          <NumberInput value={band.min} onChange={v => setBand(band.key, { min: v })} ariaLabel={`Band ${i + 1} from`} placeholder="open" />
                        </Field>
                        <Field label="Up to but not including">
                          <NumberInput value={band.max} onChange={v => setBand(band.key, { max: v })} ariaLabel={`Band ${i + 1} up to`} placeholder="open" />
                        </Field>
                        <button type="button" className={BUTTON_LINK} aria-label={`Remove band ${i + 1}`} onClick={() => setBands(bs => bs.filter(b => b.key !== band.key))}>Remove</button>
                      </div>
                      <p className="mt-1.5 text-small text-muted" data-testid={`band-${i + 1}-text`}>
                        {band.label.trim() || `Band ${i + 1}`}: {bandText(band, unit.trim() || undefined)}
                        {band.id ? (used ? `. Used ${used}x` : '. Not used') : ''}
                      </p>
                    </li>
                  )
                })}
              </ul>
            )}
            <button type="button" className={`${BUTTON_LINK} mt-2`} onClick={() => setBands(bs => [...bs, { key: nextKey(), label: '' }])}>Add band</button>
          </Group>
          <Field label="Default number" hint="Optional. What a line has when nothing sets a number.">
            <NumberInput value={defaultNumber} onChange={setDefaultNumber} ariaLabel="Default number" placeholder="none" />
          </Field>
        </>
      )}

      {type === 'yesNo' && (
        <Field label="Default" hint="What a line has when nothing sets it.">
          <Select value={defaultYesNo} onChange={setDefaultYesNo} ariaLabel="Default" placeholder="No default" options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
        </Field>
      )}

      {type === 'text' && (
        <p className="rounded-card border border-line bg-surface-muted px-4 py-3 text-small text-muted">
          A text field has no values and no default. It is kept for reference (a PO number, a gate code) and never changes a price.
        </p>
      )}

      <Field label="Description"><TextInput value={description} onChange={setDescription} ariaLabel="Field description" placeholder="Optional" /></Field>
    </Drawer>
  )
}

const PAGE = 25

interface Target {
  id: string
  cells: string[]
  search: string
}

/** A number or text cell that keeps what is typed and writes it on blur or Enter. */
function CommitInput({ value, kind, placeholder, ariaLabel, onCommit }: { value: string; kind: 'number' | 'text'; placeholder?: string; ariaLabel: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const commit = () => {
    if (text.trim() !== value) onCommit(text.trim())
  }
  return (
    <input
      type={kind === 'number' ? 'number' : 'text'}
      {...(kind === 'number' ? { inputMode: 'decimal' as const, step: 'any' } : {})}
      value={text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit()
      }}
      className={`${INPUT} ${kind === 'number' ? 'w-28 font-mono' : ''}`}
    />
  )
}

/**
 * Set an account, site, or service line field on each target, one row per account, site, or active service line, 25
 * to a page with a search. A choice or yes or no field is a select (picking the default clears the value); a number
 * field is a number that writes on blur or Enter and shows the band it falls in; a text field is text written the same
 * way. The counts at the top include everyone with nothing set under the default.
 */
export function AssignDrawer({ dimensionId, onClose }: { dimensionId: string; onClose: () => void }) {
  const db = useStore(s => s.db)
  const assign = useStore(s => s.assignDimensionValue)
  const dim = db.pricingDimensions.find(d => d.id === dimensionId)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [problems, setProblems] = useState<string[]>([])

  const targets = useMemo<Target[]>(() => {
    const party = new Map(db.parties.map(p => [p.id, p.name]))
    const zone = new Map(db.zones.map(z => [z.id, z.name]))
    const payer = new Map(db.accounts.map(a => [a.id, party.get(a.payerPartyId) ?? a.payerPartyId]))
    if (dim?.source === 'serviceLine') {
      const sites = new Map(db.sites.map(s => [s.id, s]))
      const catalog = new Map(db.catalog.map(c => [c.id, c]))
      return db.serviceItems
        .filter(si => si.status === 'active')
        .map(si => {
          const site = sites.get(si.siteId)
          const cat = catalog.get(si.catalogId)
          const cells = [cat?.name ?? si.catalogId, cat?.sizeLabel ?? '', site?.address ?? si.siteId, site ? payer.get(site.accountId) ?? site.accountId : '']
          return { id: si.id, cells, search: `${si.id} ${si.catalogId} ${site?.accountId ?? ''} ${cells.join(' ')}`.toLowerCase() }
        })
    }
    if (dim?.source === 'site') {
      return db.sites.map(s => {
        const cells = [s.address, zone.get(s.zoneId) ?? s.zoneId, `${payer.get(s.accountId) ?? ''} ${s.accountId}`.trim()]
        return { id: s.id, cells, search: `${s.id} ${cells.join(' ')}`.toLowerCase() }
      })
    }
    return db.accounts.map(a => {
      const cells = [payer.get(a.id) ?? '', a.id, CYCLE_LABEL[a.cycle] ?? a.cycle]
      return { id: a.id, cells, search: cells.join(' ').toLowerCase() }
    })
  }, [db, dim?.source])

  if (!dim) return null
  const kind = fieldTypeOf(dim)
  const values = dimensionValues(db, dim)
  const noun = TARGET_NOUN[dim.source] ?? 'account'
  const unitSuffix = dim.unit ? ` ${dim.unit}` : ''
  /** What a target carries: its own value, else the default ('' when neither). */
  const valueOf = (id: string) => dim.assignments?.[id] ?? dim.defaultValueId ?? ''
  /** The key a target counts under at the top: a value or band id, 'none' for a number in no band, '' for nothing set. */
  const countKey = (id: string) => {
    const raw = valueOf(id)
    if (raw === '') return ''
    if (kind === 'number') return fieldValueId(dim, raw) ?? 'none'
    if (kind === 'text') return 'set'
    return raw
  }
  const counts = new Map<string, number>()
  for (const t of targets) counts.set(countKey(t.id), (counts.get(countKey(t.id)) ?? 0) + 1)

  const q = query.trim().toLowerCase()
  const shown = q ? targets.filter(t => t.search.includes(q)) : targets
  const pages = Math.max(1, Math.ceil(shown.length / PAGE))
  const current = Math.min(page, pages - 1)
  const slice = shown.slice(current * PAGE, current * PAGE + PAGE)
  const headers = dim.source === 'serviceLine' ? ['Service', 'Size', 'Site', 'Customer'] : dim.source === 'site' ? ['Address', 'Zone type', 'Account'] : ['Customer', 'Account', 'Cycle']
  const monoColumn = dim.source === 'site' ? 2 : dim.source === 'account' ? 1 : -1
  const options = [
    ...(dim.defaultValueId ? [] : [{ value: '', label: 'Not set' }]),
    ...values.map(v => ({ value: v.id, label: v.id === dim.defaultValueId ? `${v.label} (default)` : v.label })),
  ]
  const placeholder = dim.defaultValueId ? `${dim.defaultValueId} (default)` : 'Not set'

  const change = (targetId: string, raw: string) => {
    const clear = raw === '' || (kind !== 'number' && kind !== 'text' && raw === dim.defaultValueId)
    const result = attempt(() => assign({ dimensionId: dim.id, targetId, valueId: clear ? null : raw }))
    setProblems(result.ok ? [] : result.problems)
  }

  const bandOf = (targetId: string) => {
    const raw = valueOf(targetId)
    if (raw === '' || dim.values.length === 0) return null
    const band = dim.values.find(v => v.id === fieldValueId(dim, raw))
    return band ? <span className="text-small text-ink">{band.label}</span> : <span className="text-small text-muted">no band</span>
  }

  return (
    <Drawer
      title={`Assign ${dim.name}`}
      eyebrow="Fields"
      subtitle={`${SOURCE_LABEL[dim.source]}. A ${noun} with nothing set has the default${dim.defaultValueId ? '' : ' (none yet)'}.`}
      onClose={onClose}
      width={dim.source === 'serviceLine' ? 960 : 820}
      footer={<button type="button" className={BUTTON_PRIMARY} onClick={onClose}>Done</button>}
    >
      <div className="flex flex-wrap gap-2" data-testid="assign-counts">
        {kind === 'text' ? (
          <Pill tone="accent">Set: {counts.get('set') ?? 0}</Pill>
        ) : (
          values.map(v => (
            <Pill key={v.id} tone={kind !== 'number' && v.id === dim.defaultValueId ? 'muted' : 'accent'}>
              {v.label}{kind !== 'number' && v.id === dim.defaultValueId ? ' (default)' : ''}: {counts.get(v.id) ?? 0}
            </Pill>
          ))
        )}
        {kind === 'number' && (dim.values.length === 0 ? (
          <Pill tone="accent">Set: {targets.length - (counts.get('') ?? 0)}</Pill>
        ) : (
          (counts.get('none') ?? 0) > 0 && <Pill tone="warning">In no band: {counts.get('none')}</Pill>
        ))}
        {(counts.get('') ?? 0) > 0 && <Pill tone="warning">Not set: {counts.get('')}</Pill>}
      </div>
      {kind === 'number' && (
        <p className="text-small text-muted">
          Type a number{unitSuffix ? ` in${unitSuffix}` : ''}; it is saved when you leave the box or press Enter. Clear it to go back to the default.
        </p>
      )}
      <Problems problems={problems} />
      <input
        type="search"
        value={query}
        onChange={e => {
          setQuery(e.target.value)
          setPage(0)
        }}
        placeholder={dim.source === 'serviceLine' ? 'Search service, site, or customer' : dim.source === 'site' ? 'Search address, zone, or account' : 'Search customer, account, or cycle'}
        aria-label={`Search ${noun}s`}
        className={INPUT}
      />
      <div className="overflow-x-auto rounded-card border border-line">
        <table className="w-full min-w-[620px] text-left text-body">
          <thead>
            <tr className="border-b border-line text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">
              {headers.map(h => <th key={h} className="px-3 py-2 font-bold">{h}</th>)}
              <th className="px-3 py-2 font-bold">{dim.name}</th>
            </tr>
          </thead>
          <tbody>
            {slice.map(t => (
              <tr key={t.id} data-target={t.id} className="border-b border-line last:border-b-0">
                {t.cells.map((c, i) => <td key={i} className={['px-3 py-2', i === monoColumn ? 'font-mono text-mono text-muted' : ''].join(' ')}>{c}</td>)}
                <td className="w-64 px-3 py-2">
                  {kind === 'number' ? (
                    <div className="flex items-center gap-2">
                      <CommitInput kind="number" value={dim.assignments?.[t.id] ?? ''} placeholder={placeholder} ariaLabel={`${dim.name} for ${t.id}`} onCommit={v => change(t.id, v)} />
                      {bandOf(t.id)}
                    </div>
                  ) : kind === 'text' ? (
                    <CommitInput kind="text" value={dim.assignments?.[t.id] ?? ''} placeholder="Not set" ariaLabel={`${dim.name} for ${t.id}`} onCommit={v => change(t.id, v)} />
                  ) : (
                    <Select value={valueOf(t.id)} onChange={v => change(t.id, v)} ariaLabel={`${dim.name} for ${t.id}`} options={options} />
                  )}
                </td>
              </tr>
            ))}
            {slice.length === 0 && (
              <tr><td colSpan={headers.length + 1} className="px-3 py-4 text-muted">No {noun}s match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-2 text-small text-muted">
        <span>{shown.length ? `Showing ${current * PAGE + 1} to ${current * PAGE + slice.length} of ${shown.length}` : `0 of ${targets.length}`}</span>
        <div className="flex gap-1">
          <button type="button" className={BUTTON_LINK} disabled={current === 0} onClick={() => setPage(current - 1)}>Previous page</button>
          <button type="button" className={BUTTON_LINK} disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next page</button>
        </div>
      </div>
    </Drawer>
  )
}
