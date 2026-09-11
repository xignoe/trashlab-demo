/**
 * The drawers of the Services section (DECISIONS.md entry 65): add or edit a service, and add or edit a category.
 * Every save goes through the pricing slice (saveService, saveServiceCategory); a refused save shows its problems.
 */
import { useState, type ReactNode } from 'react'
import type { LOB, ServiceCatalog, ServiceCategory } from '../../../types'
import { useStore } from '../../../store/useStore'
import { ALL_LOBS, LOB_NAME, PRICE_UNITS, PRICE_UNIT_LABEL, dimensionLabel, dimensions, numberFields, priceUnitOf, pricedByOf, type PriceUnit } from '../lib/config'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, ChipPicker, Drawer, Field, FormSection, MoneyInput, NumberInput, Problems, Select, TextInput, Toggle, attempt } from '../components/form'

/** One sentence per LOB on how billing treats the services in it. */
export const LOB_HELP: Record<LOB, string> = {
  residential: 'Recurring carts on routes, billed every cycle at a monthly price by zone and frequency.',
  frontload: 'Recurring commercial containers on a set schedule, billed every cycle by size and pickups per week.',
  rolloff: 'Boxes billed per haul; each haul includes tons and rental days, and extra tons and days bill on top.',
}

export const UNIT_LABEL: Record<ServiceCatalog['unit'], string> = { cart: 'Cart', container: 'Container', box: 'Roll-off box' }
const UNITS: ServiceCatalog['unit'][] = ['cart', 'container', 'box']
const DEFAULT_UNIT: Record<LOB, ServiceCatalog['unit']> = { residential: 'cart', frontload: 'container', rolloff: 'box' }

/** A labelled group for controls that must not sit inside a <label> (chips, radios, rows of inputs). */
export function Group({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <span className="block text-small font-semibold text-ink">{label}</span>
      {hint && <span className="block text-small text-muted">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

type Terms = Partial<Omit<NonNullable<ServiceCatalog['rolloff']>, 'overageTiers'>>

const REQUIRED_TERMS: { key: keyof Terms; label: string }[] = [
  { key: 'includedTons', label: 'included tons' },
  { key: 'includedDays', label: 'included days' },
  { key: 'extraDayCents', label: 'extra day charge' },
  { key: 'overageCentsPerTon', label: 'overage per ton' },
]

/**
 * Add or edit a service. The category decides the LOB; when editing, only categories of the same LOB are offered,
 * because a service's LOB never changes. Picking a roll-off category asks for the tons and days included with each
 * haul. "Priced by" lists every dimension but the service itself, in the order picked: those are the columns its
 * rates are keyed by.
 */
export function ServiceDrawer({ service, initialCategoryId, onClose, onSaved }: { service?: ServiceCatalog; initialCategoryId?: string; onClose: () => void; onSaved: (saved: ServiceCatalog) => void }) {
  const db = useStore(s => s.db)
  const saveService = useStore(s => s.saveService)
  const categories = db.serviceCategories ?? []

  const [name, setName] = useState(service?.name ?? '')
  const [categoryId, setCategoryId] = useState(service?.categoryId ?? initialCategoryId ?? '')
  const startLob = categories.find(c => c.id === (service?.categoryId ?? initialCategoryId))?.lob ?? service?.lob
  const [sizeLabel, setSizeLabel] = useState(service?.sizeLabel ?? '')
  const [unit, setUnit] = useState<ServiceCatalog['unit']>(service?.unit ?? (startLob ? DEFAULT_UNIT[startLob] : 'cart'))
  const [priceUnit, setPriceUnit] = useState<PriceUnit>(service ? priceUnitOf(service) : startLob === 'rolloff' ? 'haul' : 'month')
  const [pricedBy, setPricedBy] = useState<string[]>(service ? pricedByOf(service) : startLob === 'rolloff' ? ['zone'] : ['zone', 'frequency'])
  const [quantityField, setQuantityField] = useState(service?.quantityField ?? '')
  const [isPublic, setIsPublic] = useState(service?.public ?? true)
  const [description, setDescription] = useState(service?.description ?? '')
  const [terms, setTerms] = useState<Terms>(() => {
    const { overageTiers: _tiers, ...rest } = service?.rolloff ?? {}
    return rest
  })
  const [problems, setProblems] = useState<string[]>([])

  const lobOf = (id: string): LOB | undefined => categories.find(c => c.id === id)?.lob
  const lob = lobOf(categoryId) ?? service?.lob
  const offered = categories.filter(c => !service || c.lob === service.lob)

  const changeCategory = (id: string) => {
    const prev = lob
    const next = lobOf(id)
    setCategoryId(id)
    // A new service starts from the defaults of the LOB it lands in; an existing one keeps what it has.
    if (service || !next || next === prev) return
    setUnit(DEFAULT_UNIT[next])
    setPriceUnit(next === 'rolloff' ? 'haul' : 'month')
    if (next === 'rolloff' || prev === 'rolloff') setPricedBy(next === 'rolloff' ? ['zone'] : ['zone', 'frequency'])
  }

  const term = (key: keyof Terms) => (v: number | undefined) => setTerms(t => ({ ...t, [key]: v }))

  const save = () => {
    let rolloff: ServiceCatalog['rolloff']
    if (lob === 'rolloff') {
      const missing = REQUIRED_TERMS.filter(t => terms[t.key] === undefined).map(t => t.label)
      const negative = Object.values(terms).some(v => v !== undefined && (!Number.isFinite(v) || v < 0))
      const local = [
        ...(missing.length ? [`Give the ${missing.join(', ')} for each haul`] : []),
        ...(negative ? ['Tons, days, and charges cannot be negative'] : []),
      ]
      if (local.length) return setProblems(local)
      const kept = Object.fromEntries(Object.entries(terms).filter(([, v]) => v !== undefined))
      rolloff = { ...(service?.rolloff?.overageTiers ? { overageTiers: service.rolloff.overageTiers } : {}), ...kept } as NonNullable<ServiceCatalog['rolloff']>
    }
    const result = attempt(() =>
      saveService({
        ...(service ? { id: service.id } : {}),
        name, categoryId, sizeLabel, unit, priceUnit, pricedBy, public: isPublic,
        ...(quantityField ? { quantityField } : {}),
        ...(description.trim() ? { description } : {}),
        ...(rolloff ? { rolloff } : {}),
      }),
    )
    if (!result.ok) return setProblems(result.problems)
    onSaved(result.value)
  }

  const dimOptions = dimensions(db).filter(d => d.id !== 'service').map(d => ({ value: d.id, label: d.name }))

  return (
    <Drawer
      title={service ? `Edit ${service.name}` : 'Add a service'}
      eyebrow="Services"
      subtitle={service ? <span className="font-mono text-mono">{service.id}</span> : 'Anything you sell: a cart, a container, a custom bin, a box.'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={BUTTON_SECONDARY} onClick={onClose}>Cancel</button>
          <button type="button" className={BUTTON_PRIMARY} onClick={save}>Save service</button>
        </>
      }
    >
      <Problems problems={problems} />
      <Field label="Name">
        <TextInput value={name} onChange={setName} ariaLabel="Service name" placeholder="1.5 yd alley bin" />
      </Field>
      <Field label="Category" hint={service ? `A service's line of business never changes, so only ${LOB_NAME[service.lob].toLowerCase()} categories are offered.` : lob ? LOB_HELP[lob] : 'The category decides how billing treats the service.'}>
        <Select
          value={categoryId}
          onChange={changeCategory}
          ariaLabel="Category"
          {...(service ? {} : { placeholder: 'Pick a category' })}
          options={offered.map(c => ({ value: c.id, label: c.name, group: LOB_NAME[c.lob] }))}
        />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Size label" hint="As customers see it: 96 gal, 3 yd, 20 yd.">
          <TextInput value={sizeLabel} onChange={setSizeLabel} ariaLabel="Size label" placeholder="1.5 yd" />
        </Field>
        <Field label="Container type" hint="A custom bin is its own service; containers in inventory point at it.">
          <Select value={unit} onChange={v => setUnit(v as ServiceCatalog['unit'])} ariaLabel="Container type" options={UNITS.map(u => ({ value: u, label: UNIT_LABEL[u] }))} />
        </Field>
      </div>
      <Field label="Price unit" hint="What one unit of the price buys.">
        <Select value={priceUnit} onChange={v => setPriceUnit(v as PriceUnit)} ariaLabel="Price unit" options={PRICE_UNITS.map(u => ({ value: u, label: PRICE_UNIT_LABEL[u] }))} />
      </Field>
      <Field label="Price multiplied by" hint="The bill is the price x this number from the service line, for example $18 per pickup x 12 collections per month.">
        <Select
          value={quantityField}
          onChange={setQuantityField}
          ariaLabel="Price multiplied by"
          options={[
            { value: '', label: 'Nothing (flat per unit)' },
            ...numberFields(db).map(d => ({ value: d.id, label: d.unit ? `${d.name} (${d.unit})` : d.name })),
          ]}
        />
      </Field>
      <Group label="Priced by" hint="Rates for this service can be set per value of each; others still apply through adjustments.">
        <ChipPicker options={dimOptions} value={pricedBy} onChange={setPricedBy} ariaLabel="Priced by dimensions" />
        <p className="mt-1.5 text-small text-muted" data-testid="priced-by-order">
          {pricedBy.length ? `Rate columns, in order: ${pricedBy.map(d => dimensionLabel(db, d)).join(', ')}` : 'No columns: one price for the service, however it is ordered.'}
        </p>
      </Group>
      <div className="flex items-center justify-between gap-3">
        <span>
          <span className="block text-small font-semibold text-ink">Public</span>
          <span className="block text-small text-muted">Shown with its price on the storefront in zones with public pricing.</span>
        </span>
        <Toggle on={isPublic} onChange={setIsPublic} label="Public" />
      </div>
      <Field label="Description">
        <TextInput value={description} onChange={setDescription} ariaLabel="Service description" placeholder="Optional" />
      </Field>
      {lob === 'rolloff' && (
        <FormSection title="Included with each haul" hint="The haul price covers these; extra tons and days bill after the scale ticket and the pull.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Included tons"><NumberInput value={terms.includedTons} onChange={term('includedTons')} ariaLabel="Included tons" min={0} suffix="t" /></Field>
            <Field label="Included days"><NumberInput value={terms.includedDays} onChange={term('includedDays')} ariaLabel="Included days" min={0} step="1" suffix="days" /></Field>
            <Field label="Extra day charge"><MoneyInput cents={terms.extraDayCents} onChange={term('extraDayCents')} ariaLabel="Extra day charge" /></Field>
            <Field label="Overage per ton"><MoneyInput cents={terms.overageCentsPerTon} onChange={term('overageCentsPerTon')} ariaLabel="Overage per ton" /></Field>
            <Field label="Grace days" hint="Before extra days start to bill."><NumberInput value={terms.graceDays} onChange={term('graceDays')} ariaLabel="Grace days" min={0} step="1" suffix="days" /></Field>
            <Field label="Max rental days" hint="Swap or pull after this."><NumberInput value={terms.maxRentalDays} onChange={term('maxRentalDays')} ariaLabel="Max rental days" min={0} step="1" suffix="days" /></Field>
            <Field label="Minimum billed tons" hint="A light load still pays this."><NumberInput value={terms.minBilledTons} onChange={term('minBilledTons')} ariaLabel="Minimum billed tons" min={0} suffix="t" /></Field>
          </div>
        </FormSection>
      )}
    </Drawer>
  )
}

/**
 * Add or edit a category: a name, the LOB that decides how billing treats its services, and a description. A
 * category that already has services keeps its LOB; the store refuses the change, and the other choices are disabled.
 */
export function CategoryDrawer({ category, onClose, onSaved }: { category?: ServiceCategory; onClose: () => void; onSaved: (saved: ServiceCategory) => void }) {
  const db = useStore(s => s.db)
  const saveServiceCategory = useStore(s => s.saveServiceCategory)
  const [name, setName] = useState(category?.name ?? '')
  const [lob, setLob] = useState<LOB | ''>(category?.lob ?? '')
  const [description, setDescription] = useState(category?.description ?? '')
  const [problems, setProblems] = useState<string[]>([])
  const inUse = category ? db.catalog.filter(c => c.categoryId === category.id).length : 0

  const save = () => {
    if (!lob) return setProblems(['Pick how billing treats the services in it'])
    const result = attempt(() => saveServiceCategory({ ...(category ? { id: category.id } : {}), name, lob, ...(description.trim() ? { description } : {}) }))
    if (!result.ok) return setProblems(result.problems)
    onSaved(result.value)
  }

  return (
    <Drawer
      title={category ? `Edit ${category.name}` : 'Add a category'}
      eyebrow="Services"
      subtitle="A group of services. Its line of business decides how billing treats them."
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" className={BUTTON_SECONDARY} onClick={onClose}>Cancel</button>
          <button type="button" className={BUTTON_PRIMARY} onClick={save}>Save category</button>
        </>
      }
    >
      <Problems problems={problems} />
      <Field label="Name">
        <TextInput value={name} onChange={setName} ariaLabel="Category name" placeholder="Specialty bins" />
      </Field>
      <Group label="Line of business" hint={inUse ? `${inUse} service${inUse === 1 ? '' : 's'} bill this way, so it stays as it is.` : undefined}>
        <div className="space-y-2">
          {ALL_LOBS.map(l => (
            <label key={l} className={['flex cursor-pointer items-start gap-2.5 rounded-card border p-3', lob === l ? 'border-accent bg-accent-soft' : 'border-line'].join(' ')}>
              <input type="radio" name="category-lob" value={l} checked={lob === l} disabled={inUse > 0 && category?.lob !== l} onChange={() => setLob(l)} className="mt-1 h-4 w-4 accent-[var(--rt-color-accent)]" />
              <span>
                <span className="block text-body font-semibold text-ink">{LOB_NAME[l]}</span>
                <span className="block text-small text-muted">{LOB_HELP[l]}</span>
              </span>
            </label>
          ))}
        </div>
      </Group>
      <Field label="Description">
        <TextInput value={description} onChange={setDescription} ariaLabel="Category description" placeholder="Optional" />
      </Field>
    </Drawer>
  )
}
