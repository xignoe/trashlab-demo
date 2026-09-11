import { useMemo, useState, type ReactNode } from 'react'
import type { PricingDimension, RateVersion, ServiceCatalog, Zone } from '../../../types'
import type { Db } from '../../../store/db'
import { useStore } from '../../../store/useStore'
import {
  LOB_NAME, PRICE_UNIT_LABEL, PRICE_UNIT_SHORT, categoryOf, dimensionLabel, priceUnitOf, pricedByOf, rateFieldsOf, valueLabel, valuesOf,
} from '../lib/config'
import { FREQUENCY_LABEL } from '../lib/engine'
import { formatCents, formatPct } from '../lib/money'
import { explainMiss, feeAmountText, ruleState, testPrice, whenText, type PriceTestInput, type PriceTestResult } from '../lib/rules'
import { rolloffMatrix } from '../lib/rolloff'
import { exampleInput, keyFieldsFor, PREVIEW_RATE_ID, previewWorld, rateScope, widenedPricedBy, type KeyStep } from '../lib/newRate'
import { AudienceField, EffectiveDate, serviceOptions, useRateDraft } from '../components/RateTools'
import { BUTTON_LINK, BUTTON_PRIMARY, BUTTON_SECONDARY, Card, Checkbox, Field, MoneyInput, NumberInput, Problems, SectionHeader, Select, attempt } from '../components/form'
import Pill from '../components/Pill'
import { AdjustmentForm } from './AdjustmentForm'
import { TaxForm } from './TaxesSection'
import { ZoneDrawer } from './ZonesSection'
import { ServiceDrawer } from './ServiceForms'
import { DimensionDrawer } from './DimensionForms'
import { CellDrawer, HandlingPill, MaterialDrawer, TermsDrawer, sizeName, tiersText, tonsText } from './RolloffForms'

/** One step per part of the Ratebook a rate touches, in the order a line is priced, then the review. */
const STEPS = [
  { id: 'service', title: 'Service', text: 'What the rate prices' },
  { id: 'fields', title: 'Fields', text: 'Your own fields: tier, size, anything you track' },
  { id: 'zoneTypes', title: 'Zone type', text: 'Open market, boundary, franchise; distance and density' },
  { id: 'zones', title: 'Zone', text: 'An area drawn on the map' },
  { id: 'cycles', title: 'Frequency and cycle', text: 'How often, the billing cycle, the day' },
  { id: 'rolloff', title: 'Roll-off', text: 'Box terms and materials' },
  { id: 'price', title: 'Price', text: 'The price, who pays it, and from when' },
  { id: 'adjustments', title: 'Adjustments', text: 'Fees, surcharges, discounts on the line' },
  { id: 'taxes', title: 'Taxes', text: 'Tax layers on the line' },
  { id: 'review', title: 'Review', text: 'The total, then save or publish' },
] as const
type StepId = (typeof STEPS)[number]['id']
const PRICE_STEP = STEPS.findIndex(s => s.id === 'price')

const SERVICEABILITY: Record<Zone['serviceability'], string> = { open: 'Open market', boundary: 'Boundary', franchise: 'Franchise', notServed: 'Not served' }

/** The steps left to right; a step already reached can be clicked to go back to it. */
function StepStrip({ step, reached, onStep }: { step: number; reached: number; onStep: (i: number) => void }) {
  return (
    <ol aria-label="Steps to add a rate" className="flex flex-wrap items-stretch gap-2">
      {STEPS.map((s, i) => {
        const active = i === step
        const done = i < step
        return (
          <li key={s.id} className="flex items-center gap-2">
            <button
              type="button"
              aria-current={active ? 'step' : undefined}
              disabled={i > reached}
              onClick={() => onStep(i)}
              className={[
                'h-full w-[172px] rounded-card border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed',
                active ? 'border-accent bg-accent-soft' : 'border-line bg-surface enabled:hover:bg-surface-muted',
              ].join(' ')}
            >
              <span className="block text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">
                Step {i + 1}{done ? ', done' : ''}
              </span>
              <span className={['block text-body font-semibold', active ? 'text-accent' : i > reached ? 'text-muted' : 'text-ink'].join(' ')}>{s.title}</span>
              <span className="block text-small text-muted">{s.text}</span>
            </button>
            {i < STEPS.length - 1 && (
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" className="shrink-0 text-muted">
                <path d="M5 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </li>
        )
      })}
    </ol>
  )
}

type Done = { kind: 'draft' | 'published'; rate: RateVersion; saved: string[] }

/**
 * New rate: adds a rate to the ratebook from scratch, one step a page, through every part of the Ratebook the rate
 * touches. Service (pick one or add one); a value or Any for your own fields, the zone type, the drawn zone, and the
 * frequency, cycle, and day; roll-off terms and materials for a box; the price, who pays it, and the date; the
 * adjustments and tax layers an example line gets with the new rate in place (and new ones scoped to this rate); and a
 * review with the total. A field the service's rates are not keyed by yet becomes a new rate column when the rate is
 * saved. Services, fields, zone types, roll-off terms and cells, adjustments, and tax layers added along the way save
 * as they do on their own tabs; the rate is a draft (or, for new service only, published) on the last step.
 */
export default function NewRateSection({ today, onOpenSection }: { today: string; onOpenSection: (id: 'rates' | 'geozones') => void }) {
  const [run, setRun] = useState(0)
  const [done, setDone] = useState<Done | null>(null)

  if (done) {
    return (
      <div className="space-y-5">
        <SectionHeader title="New rate" description="Add a rate to the ratebook from scratch, one step at a time." />
        <Card label="Rate saved" className="p-5">
          <div role="status" data-testid="new-rate-done">
            <h3 className="text-h2 font-bold">{done.kind === 'published' ? `Published ${done.rate.id}` : `Draft ${done.rate.id} saved`}</h3>
            <p className="mt-1 text-body text-muted">
              {done.kind === 'published'
                ? `In force for new service from ${done.rate.effectiveFrom}. Current customers keep their price.`
                : 'Not in force until you preview and publish it from the drafts tray on Rates.'}
            </p>
            {done.saved.length > 0 && <SavedAlong items={done.saved} />}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={BUTTON_PRIMARY} onClick={() => onOpenSection('rates')}>Go to rates</button>
            <button
              type="button"
              className={BUTTON_SECONDARY}
              onClick={() => {
                setDone(null)
                setRun(n => n + 1)
              }}
            >
              Add another rate
            </button>
          </div>
        </Card>
      </div>
    )
  }
  return <Wizard key={run} today={today} onOpenSection={onOpenSection} onDone={setDone} />
}

function SavedAlong({ items }: { items: string[] }) {
  return (
    <div className="mt-3" data-testid="saved-along">
      <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">Saved along the way</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-small text-ink">
        {items.map(t => <li key={t}>{t}</li>)}
      </ul>
    </div>
  )
}

type Opened =
  | { kind: 'service' }
  | { kind: 'field' }
  | { kind: 'zone'; zone?: Zone }
  | { kind: 'terms' }
  | { kind: 'material' }
  | { kind: 'cell'; materialId: string }
  | { kind: 'adjustment' }
  | { kind: 'tax' }

const safeTest = (world: Db, input: PriceTestInput): PriceTestResult => {
  try {
    return testPrice(world, input)
  } catch (e) {
    return { dims: {}, candidates: [], feeRows: [], taxRows: [], taxableCents: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

function Wizard({ today, onOpenSection, onDone }: { today: string; onOpenSection: (id: 'rates' | 'geozones') => void; onDone: (d: Done) => void }) {
  const r = useRateDraft({ today, anyField: true })
  const { db, item, unit, chosen, catalogId, values, priceCents, audience, forNew, effectiveFrom, dateHint, problems, effect } = r
  const saveService = useStore(s => s.saveService)
  const [step, setStep] = useState(0)
  const [reached, setReached] = useState(0)
  const [opened, setOpened] = useState<Opened | null>(null)
  const [saved, setSaved] = useState<string[]>([])
  const [exampleZone, setExampleZone] = useState(() => db.zones.find(z => z.serviceability !== 'notServed')?.id ?? db.zones[0]?.id ?? '')
  const [miles, setMiles] = useState<number | undefined>(undefined)
  const [stops, setStops] = useState<number | undefined>(undefined)
  const [quantity, setQuantity] = useState<number | undefined>(undefined)
  const [taxExempt, setTaxExempt] = useState(false)
  const options = useMemo(() => serviceOptions(db), [db])
  const note = (t: string) => setSaved(s => [...s, t])
  const close = () => setOpened(null)

  const id: StepId = STEPS[step].id
  const zoneId = chosen.zone ?? exampleZone
  const zone = db.zones.find(z => z.id === zoneId)
  const pricedBy = item ? pricedByOf(item) : []
  const widened = item ? widenedPricedBy(item, chosen) : null
  const onDate = /^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) && effectiveFrom >= today ? effectiveFrom : today
  const chosenKey = JSON.stringify(chosen)

  // The example line, priced by the engine with the new rate in place once it has a price.
  const example = useMemo(() => {
    if (!item || !zoneId) return null
    const input = exampleInput(db, item, chosen, { zoneId, milesFromYard: miles, neighborStops: stops, quantity, taxExempt }, onDate)
    const world = priceCents && priceCents > 0 ? previewWorld(db, { catalogId: item.id, ...rateFieldsOf(chosen), priceCents, effectiveFrom: onDate }) : db
    return { input, result: safeTest(world, input) }
    // chosen is rebuilt every render; chosenKey stands for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, item, chosenKey, zoneId, miles, stops, quantity, taxExempt, onDate, priceCents])

  const goTo = (i: number) => {
    r.setProblems([])
    setStep(i)
    setReached(n => Math.max(n, i))
  }
  const next = () => {
    if (id === 'service' && !item) return r.setProblems(['Pick a service, or add one'])
    if (id === 'price') {
      const p = r.problemFor()
      if (p) return r.setProblems([p])
    }
    goTo(step + 1)
  }
  const pickService = (v: string) => {
    r.pickService(v)
    // A different service has different columns, a different unit, and maybe roll-off terms: start the steps after it again.
    setReached(0)
  }

  const save = (publish: boolean) => {
    const p = r.problemFor()
    if (p) return r.setProblems([p])
    if (item && widened) {
      const s = attempt(() => saveService({
        id: item.id, name: item.name, categoryId: item.categoryId ?? '', sizeLabel: item.sizeLabel, unit: item.unit, priceUnit: priceUnitOf(item),
        pricedBy: widened, public: item.public,
        ...(item.description ? { description: item.description } : {}),
        ...(item.rolloff ? { rolloff: item.rolloff } : {}),
        ...(item.quantityField ? { quantityField: item.quantityField } : {}),
      }))
      if (!s.ok) return r.setProblems(s.problems)
    }
    const result = r.save(publish)
    if (result.kind === 'refused') return
    onDone({ ...result, saved: widened && item ? [...saved, `${item.name} rates are now keyed by ${widened.slice(pricedBy.length).map(d => dimensionLabel(db, d)).join(', ')} too`] : saved })
  }

  const keyFields = (step: KeyStep) => (
    <KeyFields db={db} dims={keyFieldsFor(db, step)} pricedBy={pricedBy} values={values} onChange={r.setValue} />
  )
  const scope = item ? rateScope(item.id, chosen) : {}

  return (
    <div className="space-y-5">
      <SectionHeader
        title="New rate"
        description="Add a rate to the ratebook from scratch, one step at a time, through every part of the ratebook it touches. The rate bills nobody until it is published."
      />
      <StepStrip step={step} reached={reached} onStep={goTo} />

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,760px)_minmax(0,1fr)]">
        <Card label={`Step ${step + 1}: ${STEPS[step].title}`} className="space-y-5 p-5">
          <header>
            <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-accent">Step {step + 1} of {STEPS.length}</p>
            <h3 className="mt-0.5 text-h2 font-bold">{STEPS[step].title}</h3>
          </header>

          {id === 'service' && (
            <>
              <Field label="Service" hint="Grouped by category. The unit in brackets is what one price buys.">
                <Select value={catalogId} onChange={pickService} options={options} ariaLabel="Service" placeholder="Pick a service" />
              </Field>
              <p className="text-small text-muted">
                Not listed? <button type="button" className={BUTTON_LINK} onClick={() => setOpened({ kind: 'service' })}>Add a service</button>
              </p>
              {item && <ServiceFacts db={db} item={item} />}
            </>
          )}

          {id === 'fields' && item && (
            <>
              <p className="text-small text-muted">
                Fields you track on the account, the site, the service line, or the quote. Leave one at Any to price every value of it; the more you pick,
                the more specific the rate, and the more specific rate wins.
              </p>
              {keyFieldsFor(db, 'fields').length ? keyFields('fields') : <p className="text-body text-muted">No fields of your own yet.</p>}
              {item.quantityField && (
                <Field label={`Example ${dimensionLabel(db, item.quantityField).toLowerCase()}`} hint={`${item.name} is multiplied by this number. Used for the example total.`}>
                  <NumberInput value={quantity} onChange={setQuantity} min={0} ariaLabel={`Example ${dimensionLabel(db, item.quantityField).toLowerCase()}`} placeholder="none" />
                </Field>
              )}
              <button type="button" className={BUTTON_SECONDARY} onClick={() => setOpened({ kind: 'field' })}>Add a field</button>
            </>
          )}

          {id === 'zoneTypes' && (
            <>
              {keyFields('zoneTypes')}
              {!chosen.zone && (
                <Field label="Example zone type" hint="The rate covers every zone type. The example line on the later steps is priced in this one.">
                  <Select value={exampleZone} onChange={setExampleZone} options={db.zones.map(z => ({ value: z.id, label: z.name }))} ariaLabel="Example zone type" />
                </Field>
              )}
              {zone && <ZoneFacts db={db} zone={zone} today={today} />}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Miles from the yard" hint="For the example line: distance adjustments read it">
                  <NumberInput value={miles} onChange={setMiles} min={0} suffix="mi" ariaLabel="Miles from the yard" placeholder="none" />
                </Field>
                <Field label="Stops within 1/4 mi" hint="For the example line: density adjustments read it">
                  <NumberInput value={stops} onChange={setStops} min={0} step="1" ariaLabel="Stops within a quarter mile" placeholder="none" />
                </Field>
              </div>
              <div className="flex flex-wrap gap-2">
                {zone && <button type="button" className={BUTTON_SECONDARY} onClick={() => setOpened({ kind: 'zone', zone })}>Edit {zone.name}</button>}
                <button type="button" className={BUTTON_SECONDARY} onClick={() => setOpened({ kind: 'zone' })}>Add a zone type</button>
              </div>
            </>
          )}

          {id === 'zones' && (
            <>
              <p className="text-small text-muted">
                Areas drawn on the map, around a city or a stretch of county. A site is in the first zone, in list order, whose area contains it. Leave at
                Any to price every site wherever it is.
              </p>
              {(db.geoZones ?? []).length ? keyFields('zones') : <p className="text-body text-muted">No zones drawn yet.</p>}
              <p className="text-small text-muted">
                A new zone is drawn on the map.{' '}
                <button type="button" className={BUTTON_LINK} onClick={() => onOpenSection('geozones')}>Open Zones</button> (this form starts over when you leave it).
              </p>
            </>
          )}

          {id === 'cycles' && item && (
            <>
              <p className="text-small text-muted">
                {item.lob === 'rolloff' ? 'A roll-off haul is on call; leave frequency at Any unless this size has a scheduled service. ' : ''}
                Leave any of these at Any to price every value of it.
              </p>
              {keyFields('cycles')}
              <CyclePricing db={db} today={today} />
            </>
          )}

          {id === 'rolloff' && item && (
            item.lob !== 'rolloff' ? (
              <p className="text-body text-muted" data-testid="rolloff-not-applicable">
                {item.name} is not a roll-off service, so there are no box terms or materials to set. Roll-off sizes carry rental days, included tons,
                and a material matrix.
              </p>
            ) : (
              <RolloffStep db={db} item={item} zoneId={zoneId} onDate={onDate} onEditTerms={() => setOpened({ kind: 'terms' })} onAddMaterial={() => setOpened({ kind: 'material' })} onEditCell={materialId => setOpened({ kind: 'cell', materialId })} />
            )
          )}

          {id === 'price' && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={`Price ${PRICE_UNIT_LABEL[unit]}`} hint={item?.quantityField ? `Multiplied by ${dimensionLabel(db, item.quantityField).toLowerCase()} on a recurring line.` : undefined}>
                  <MoneyInput cents={priceCents} onChange={r.setPriceCents} ariaLabel={`Price ${PRICE_UNIT_LABEL[unit]}`} />
                </Field>
                <EffectiveDate value={effectiveFrom} onChange={r.setEffectiveFrom} today={today} {...(dateHint ? { hint: dateHint } : {})} />
              </div>
              <AudienceField value={audience} onChange={r.chooseAudience} name="new-rate-audience" />
            </>
          )}

          {id === 'adjustments' && item && example && (
            <>
              <ExampleLine db={db} input={example.input} />
              <AdjustmentRows db={db} result={example.result} />
              <div>
                <button type="button" className={BUTTON_SECONDARY} onClick={() => setOpened({ kind: 'adjustment' })}>Add an adjustment for this rate</button>
                <p className="mt-1 text-small text-muted">Starts with conditions that match this rate&apos;s lines and its date. It saves as it does on the Adjustments tab.</p>
              </div>
            </>
          )}

          {id === 'taxes' && item && example && (
            <>
              <ExampleLine db={db} input={example.input} />
              <Checkbox checked={taxExempt} onChange={setTaxExempt} label="Tax exempt example" hint="An exempt account pays no tax on any line." />
              <TaxRows db={db} result={example.result} zone={zone} today={onDate} taxExempt={taxExempt} />
              <div>
                <button type="button" className={BUTTON_SECONDARY} onClick={() => setOpened({ kind: 'tax' })}>Add a tax layer for this rate</button>
                <p className="mt-1 text-small text-muted">A layer on {zone?.name ?? 'the zone type'} with conditions that match this rate&apos;s lines. It saves as it does on the Taxes tab.</p>
              </div>
            </>
          )}

          {id === 'review' && item && (
            <>
              <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-body" data-testid="new-rate-summary">
                <Row k="Service" v={`${item.name} (${item.id})`} />
                {[...new Set([...pricedBy, ...Object.keys(chosen)])].map(d => (
                  <Row key={d} k={dimensionLabel(db, d)} v={chosen[d] ? valueLabel(db, d, chosen[d]) : `Any ${dimensionLabel(db, d).toLowerCase()}`} />
                ))}
                <Row k="Price" v={priceCents === undefined ? 'None' : `${formatCents(priceCents)}${PRICE_UNIT_SHORT[unit]}`} />
                <Row k="Who pays" v={forNew ? 'New service only' : 'Everyone on this line'} />
                <Row k="Effective from" v={effectiveFrom} />
              </dl>
              {widened && (
                <p className="text-small text-ink">
                  Saving adds {widened.slice(pricedBy.length).map(d => dimensionLabel(db, d)).join(', ')} to {item.name}&apos;s rate columns. Its other rates show Any there.
                </p>
              )}
              {example && <Totals db={db} input={example.input} result={example.result} unit={unit} />}
              <section aria-label="What this does" data-testid="rate-effect" className="rounded-card border border-line bg-surface-muted px-4 py-3">
                <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">What this does</p>
                <ul className="mt-1.5 list-disc space-y-1 pl-5 text-small text-ink">
                  {effect.map(line => <li key={line}>{line}</li>)}
                </ul>
              </section>
              {saved.length > 0 && <SavedAlong items={saved} />}
            </>
          )}

          <Problems problems={problems} />

          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
            <button type="button" className={BUTTON_SECONDARY} disabled={step === 0} onClick={() => goTo(step - 1)}>Back</button>
            {id !== 'review' ? (
              <button type="button" className={BUTTON_PRIMARY} onClick={next}>Next</button>
            ) : (
              <span className="flex flex-wrap gap-2">
                {forNew ? (
                  <>
                    <button type="button" className={BUTTON_SECONDARY} onClick={() => save(false)}>Save draft</button>
                    <button type="button" className={BUTTON_PRIMARY} onClick={() => save(true)}>Publish now</button>
                  </>
                ) : (
                  <button type="button" className={BUTTON_PRIMARY} onClick={() => save(false)}>Save draft</button>
                )}
              </span>
            )}
          </footer>
        </Card>

        {item && step > 0 && (
          <Card label="This rate so far" className="p-5">
            <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">This rate so far</p>
            <p className="mt-1 text-body font-semibold text-ink">{item.name}</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {Object.keys(chosen).length === 0 && <li className="text-small text-muted">Any line of this service</li>}
              {Object.entries(chosen).map(([d, v]) => (
                <li key={d}><Pill tone="muted">{dimensionLabel(db, d)}: {valueLabel(db, d, v)}</Pill></li>
              ))}
            </ul>
            {step > PRICE_STEP && priceCents !== undefined && (
              <p className="mt-2 font-mono text-h2 font-bold text-ink">{formatCents(priceCents)}<span className="text-body text-muted">{PRICE_UNIT_SHORT[unit]}</span></p>
            )}
            {step > PRICE_STEP && example?.result.charge && (
              <p className="mt-1 text-small text-muted">Example line total {formatCents(example.result.charge.totalCents)} with adjustments and tax.</p>
            )}
          </Card>
        )}
      </div>

      {opened?.kind === 'service' && (
        <ServiceDrawer
          onClose={close}
          onSaved={s => {
            close()
            note(`Service ${s.name} (${s.id})`)
            pickService(s.id)
          }}
        />
      )}
      {opened?.kind === 'field' && (
        <DimensionDrawer
          onClose={close}
          onSaved={d => {
            close()
            note(`Field ${d.name}`)
          }}
        />
      )}
      {opened?.kind === 'zone' && (
        <ZoneDrawer
          {...(opened.zone ? { zone: opened.zone } : {})}
          taxPctToday={opened.zone ? zoneTaxPct(db, opened.zone.id, today) : 0}
          today={today}
          onClose={close}
          onSaved={z => note(`Zone type ${z.name}`)}
        />
      )}
      {opened?.kind === 'terms' && item && (
        <TermsDrawer
          size={item}
          onClose={close}
          onSaved={() => {
            close()
            note(`${sizeName(item)} terms`)
          }}
        />
      )}
      {opened?.kind === 'material' && (
        <MaterialDrawer
          onClose={close}
          onSaved={m => {
            close()
            note(`Material ${m.name}`)
          }}
        />
      )}
      {opened?.kind === 'cell' && item && (() => {
        const cell = rolloffMatrix(db, zoneId, onDate).rows.find(row => row.material.id === opened.materialId)?.cells.find(c => c.catalogId === item.id)
        return cell ? (
          <CellDrawer
            cell={cell}
            size={item}
            today={today}
            onClose={close}
            onSaved={row => {
              close()
              note(`${cell.material.name} in the ${sizeName(item)} (${row.id}) from ${row.effectiveFrom}`)
            }}
          />
        ) : null
      })()}
      {opened?.kind === 'adjustment' && item && (
        <AdjustmentForm
          today={today}
          initialWhen={scope}
          initialAppliesTo={[example?.input.lineType ?? 'recurring']}
          initialEffectiveFrom={onDate}
          onClose={close}
          onSaved={rule => {
            close()
            note(`Adjustment ${rule.name} (${rule.id}), ${feeAmountText(rule)} from ${rule.effectiveFrom}`)
          }}
        />
      )}
      {opened?.kind === 'tax' && item && (
        <TaxForm
          today={today}
          zoneId={zoneId}
          initialWhen={scope}
          initialEffectiveFrom={onDate}
          onClose={close}
          onSaved={rule => {
            close()
            note(`Tax layer ${rule.name ?? rule.id}, ${formatPct(rule.ratePct)} on ${db.zones.find(z => z.id === rule.zoneId)?.name ?? rule.zoneId} from ${rule.effectiveFrom}`)
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step pieces
// ---------------------------------------------------------------------------

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted">{k}</dt>
      <dd className="font-semibold text-ink">{v}</dd>
    </div>
  )
}

/** A value or Any for each field; one the service's rates are not keyed by yet says so. */
function KeyFields({ db, dims, pricedBy, values, onChange }: { db: Db; dims: PricingDimension[]; pricedBy: string[]; values: Record<string, string>; onChange: (d: string, v: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {dims.map(d => (
        <Field key={d.id} label={d.name} hint={pricedBy.includes(d.id) ? undefined : 'Not a rate column yet; a value adds it'}>
          <Select
            value={values[d.id] ?? ''}
            onChange={v => onChange(d.id, v)}
            options={valuesOf(db, d.id).map(v => ({ value: v.id, label: v.label }))}
            ariaLabel={d.name}
            placeholder={`Any ${d.name.toLowerCase()}`}
          />
        </Field>
      ))}
    </div>
  )
}

function ServiceFacts({ db, item }: { db: Db; item: ServiceCatalog }) {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1 rounded-card border border-line bg-surface-muted px-4 py-3 text-small" data-testid="service-facts">
      <Row k="Category" v={categoryOf(db, item)?.name ?? 'None'} />
      <Row k="Bills as" v={LOB_NAME[item.lob]} />
      <Row k="Price is" v={PRICE_UNIT_LABEL[priceUnitOf(item)]} />
      <Row k="Rates keyed by" v={pricedByOf(item).map(d => dimensionLabel(db, d)).join(', ')} />
      {item.quantityField && <Row k="Multiplied by" v={dimensionLabel(db, item.quantityField)} />}
    </dl>
  )
}

function zoneTaxPct(db: Db, zoneId: string, day: string): number {
  return Number(db.taxRules.filter(t => t.zoneId === zoneId && ruleState(t, day) === 'active' && !t.when).reduce((s, t) => s + t.ratePct, 0).toFixed(4))
}

function ZoneFacts({ db, zone, today }: { db: Db; zone: Zone; today: string }) {
  return (
    <div className="rounded-card border border-line bg-surface-muted px-4 py-3" data-testid="zone-facts">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body font-semibold text-ink">{zone.name}</span>
        <Pill tone={zone.serviceability === 'notServed' ? 'warning' : 'muted'}>{SERVICEABILITY[zone.serviceability]}</Pill>
      </div>
      <p className="mt-1 text-small text-muted">
        Delivery fee {formatCents(zone.deliveryFeeCents)}, franchise fee {formatPct(zone.franchiseFeePct)}, tax {formatPct(zoneTaxPct(db, zone.id, today))} today,
        {zone.publicPricing ? ' prices shown publicly.' : ' prices not shown publicly.'}
      </p>
      {zone.serviceability === 'notServed' && <p className="mt-1 text-small font-semibold text-warning">Not served: quotes here are refused, so this rate would bill nobody in it.</p>}
    </div>
  )
}

/** The adjustments priced by billing cycle, the cycle pricing the Billing cycles tab lists. */
function CyclePricing({ db, today }: { db: Db; today: string }) {
  const rules = db.feeRules.filter(r => (r.when?.cycle?.length ?? 0) > 0 && ruleState(r, today) !== 'ended')
  return (
    <div data-testid="cycle-pricing">
      <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">Cycle pricing</p>
      {rules.length === 0 ? (
        <p className="mt-1 text-small text-muted">No adjustment is priced by billing cycle.</p>
      ) : (
        <ul className="mt-1 divide-y divide-line">
          {rules.map(r => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-small">
              <span className="font-semibold text-ink">{r.name}</span>
              <span className="text-muted">{feeAmountText(r)}, {whenText(db, r.when).join('; ')}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-small text-muted">These apply to this rate&apos;s lines on those cycles; the Adjustments step shows the example line.</p>
    </div>
  )
}

function RolloffStep({ db, item, zoneId, onDate, onEditTerms, onAddMaterial, onEditCell }: {
  db: Db; item: ServiceCatalog; zoneId: string; onDate: string; onEditTerms: () => void; onAddMaterial: () => void; onEditCell: (materialId: string) => void
}) {
  const t = item.rolloff
  const rows = rolloffMatrix(db, zoneId, onDate).rows.map(row => ({ material: row.material, cell: row.cells.find(c => c.catalogId === item.id) }))
  return (
    <>
      <section aria-label="Box terms" className="rounded-card border border-line bg-surface-muted px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">{sizeName(item)} terms</p>
          <button type="button" className={BUTTON_LINK} onClick={onEditTerms}>Edit terms</button>
        </div>
        {t ? (
          <dl className="mt-1 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1 text-small">
            <Row k="Included days" v={`${t.includedDays}${t.graceDays ? `, then ${t.graceDays} grace` : ''}`} />
            <Row k="Extra day" v={formatCents(t.extraDayCents)} />
            <Row k="Included tons" v={tonsText(t.includedTons)} />
            <Row k="Overage per ton" v={`${formatCents(t.overageCentsPerTon)}${t.overageTiers?.length ? `; ${tiersText(t.overageTiers)}` : ''}`} />
            {t.minBilledTons ? <Row k="Minimum billed" v={tonsText(t.minBilledTons)} /> : null}
            {t.maxRentalDays ? <Row k="Max rental" v={`${t.maxRentalDays} days`} /> : null}
          </dl>
        ) : <p className="mt-1 text-small text-muted">No terms yet.</p>}
      </section>
      <div className="overflow-x-auto rounded-card border border-line">
        <table className="w-full min-w-[560px] text-left text-body" data-testid="rolloff-materials">
          <thead className="bg-surface-muted text-small text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">Material</th>
              <th className="px-3 py-2 font-semibold">Taken</th>
              <th className="px-3 py-2 text-right font-semibold">Haul</th>
              <th className="px-3 py-2 text-right font-semibold">Included</th>
              <th className="px-3 py-2 text-right font-semibold">Overage</th>
              <th className="px-3 py-2"><span className="sr-only">Edit</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ material, cell }) => (
              <tr key={material.id} className="border-t border-line">
                <td className="px-3 py-2"><span className="mr-2 font-semibold text-ink">{material.name}</span><HandlingPill handling={material.handling} /></td>
                <td className="px-3 py-2 text-small">{cell?.status === 'priced' ? 'Yes' : cell?.status === 'noHaulRate' ? 'No haul rate yet' : 'No'}</td>
                <td className="px-3 py-2 text-right font-mono">{cell?.haulCents !== undefined ? formatCents(cell.haulCents) : 'None'}</td>
                <td className="px-3 py-2 text-right font-mono">{cell ? tonsText(cell.terms.includedTons) : ''}</td>
                <td className="px-3 py-2 text-right font-mono">{cell ? `${formatCents(cell.terms.overageCentsPerTon)}/t` : ''}</td>
                <td className="px-3 py-2 text-right">
                  {cell && material.handling !== 'prohibited' && <button type="button" className={BUTTON_LINK} aria-label={`Edit ${material.name}`} onClick={() => onEditCell(material.id)}>Edit</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className={BUTTON_SECONDARY} onClick={onAddMaterial}>Add a material</button>
    </>
  )
}

function ExampleLine({ db, input }: { db: Db; input: PriceTestInput }) {
  const parts = [
    valueLabel(db, 'zone', input.zoneId),
    FREQUENCY_LABEL[input.frequency],
    input.lineType === 'recurring' ? 'recurring' : 'event or haul',
    ...(input.cycle ? [`${valueLabel(db, 'cycle', input.cycle)} cycle`] : []),
    ...Object.entries(input.values).map(([d, v]) => `${dimensionLabel(db, d)} ${valueLabel(db, d, v)}`),
    ...(input.milesFromYard !== undefined ? [`${input.milesFromYard} mi from the yard`] : []),
    ...(input.neighborStops !== undefined ? [`${input.neighborStops} stops nearby`] : []),
  ]
  return (
    <p className="rounded-md bg-surface-muted px-3 py-2 text-small text-ink" data-testid="example-line">
      Example line: {parts.join(', ')}, on {input.onDate}.
    </p>
  )
}

function AdjustmentRows({ db, result }: { db: Db; result: PriceTestResult }) {
  if (result.error) return <p role="alert" className="text-small font-semibold text-danger">{result.error}</p>
  const applied = result.feeRows.filter(r => r.cents !== undefined)
  const lost = result.feeRows.filter(r => r.lostStack)
  const missed = result.feeRows.filter(r => r.miss !== null)
  return (
    <div className="space-y-3">
      <div data-testid="new-rate-applied">
        <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">Applies ({applied.length})</p>
        {applied.length === 0 ? <p className="mt-1 text-small text-muted">No adjustment applies to this line.</p> : (
          <ul className="mt-1 divide-y divide-line">
            {applied.map(r => (
              <li key={r.rule.id} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{r.rule.name}</span>
                  <span className="block font-mono text-small text-muted">{feeAmountText(r.rule)}{r.rule.taxable ? ', taxable' : ', not taxed'}</span>
                </span>
                <span className={`font-mono ${(r.cents ?? 0) < 0 ? 'text-success' : 'text-ink'}`}>{(r.cents ?? 0) > 0 ? '+' : ''}{formatCents(r.cents ?? 0)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {lost.length > 0 && (
        <div>
          <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">Applies, but outbid ({lost.length})</p>
          <ul className="mt-1 divide-y divide-line">
            {lost.map(r => (
              <li key={r.rule.id} className="py-1.5 text-small">
                <span className="font-semibold text-ink">{r.rule.name}</span>
                <span className="text-muted">: a larger rule in &quot;{r.rule.stackGroup}&quot; won; only the largest in a group is taken.</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <details data-testid="new-rate-not-applied">
        <summary className="cursor-pointer text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">Does not apply ({missed.length})</summary>
        <ul className="mt-1 divide-y divide-line">
          {missed.map(r => (
            <li key={r.rule.id} className="flex flex-wrap items-center justify-between gap-x-3 py-1.5 text-small">
              <span className="font-semibold text-ink">{r.rule.name}</span>
              <span className="text-muted">{explainMiss(db, r.miss ?? '')}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}

function TaxRows({ db, result, zone, today, taxExempt }: { db: Db; result: PriceTestResult; zone: Zone | undefined; today: string; taxExempt: boolean }) {
  if (result.error) return <p role="alert" className="text-small font-semibold text-danger">{result.error}</p>
  const appliedIds = new Set(result.taxRows.map(t => t.rule.id))
  const others = zone ? db.taxRules.filter(t => t.zoneId === zone.id && !appliedIds.has(t.id) && ruleState(t, today) !== 'ended') : []
  return (
    <div className="space-y-3" data-testid="new-rate-tax">
      {taxExempt ? <p className="text-small text-muted">Tax exempt: no tax.</p> : result.taxRows.length === 0 ? (
        <p className="text-small text-muted">No tax layer applies in {zone?.name ?? 'this zone type'} on this date.</p>
      ) : (
        <>
          <p className="text-small text-muted">Taxable base {formatCents(result.taxableCents)}: the line plus its taxable adjustments.</p>
          <ul className="divide-y divide-line">
            {result.taxRows.map(({ rule, cents }) => (
              <li key={rule.id} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{rule.name ?? 'Tax'}</span>
                  <span className="block font-mono text-small text-muted">{formatPct(rule.ratePct)}{rule.jurisdiction ? `, ${rule.jurisdiction}` : ''}</span>
                </span>
                <span className="font-mono text-ink">{formatCents(cents)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {others.length > 0 && (
        <div>
          <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">Other layers on {zone?.name}</p>
          <ul className="mt-1 divide-y divide-line">
            {others.map(t => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-3 py-1.5 text-small">
                <span className="font-semibold text-ink">{t.name ?? t.id} {formatPct(t.ratePct)}</span>
                <span className="text-muted">{ruleState(t, today) === 'scheduled' ? `starts ${t.effectiveFrom}` : t.when ? `only when ${whenText(db, t.when).join('; ')}` : 'not on this kind of line'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** The example line's base, adjustments, tax, and total, and which rate priced it. */
function Totals({ db, input, result, unit }: { db: Db; input: PriceTestInput; result: PriceTestResult; unit: keyof typeof PRICE_UNIT_SHORT }) {
  if (result.error || !result.charge) {
    return <p role="alert" className="text-small font-semibold text-danger">No example total: {result.error ?? 'the line could not be priced'}.</p>
  }
  const c = result.charge
  const fees = c.fees.reduce((s, f) => s + f.cents, 0)
  const wonId = result.price?.rateVersionId
  const other = wonId && wonId !== PREVIEW_RATE_ID ? wonId : null
  const rows: [string, number][] = [['Base', c.baseCents], ['Adjustments', fees], ['Tax', c.taxCents], ['Total', c.totalCents]]
  return (
    <section aria-label="Example total" data-testid="new-rate-totals" className="rounded-card border border-line px-4 py-3">
      <p className="text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">Example total, {input.lineType === 'recurring' ? 'per month' : PRICE_UNIT_LABEL[unit]}</p>
      <ExampleLine db={db} input={input} />
      <table className="mt-2 w-full text-body">
        <tbody>
          {rows.map(([label, cents]) => (
            <tr key={label} className={label === 'Total' ? 'font-bold' : 'border-b border-line'}>
              <td className="py-1.5">{label}</td>
              <td className="py-1.5 text-right font-mono">{formatCents(cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {other && <p className="mt-2 text-small text-warning">A more specific rate, {other}, prices this example line instead of this one.</p>}
    </section>
  )
}
