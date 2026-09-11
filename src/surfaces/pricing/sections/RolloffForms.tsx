/**
 * The forms behind the Roll-off section (DECISIONS.md entry 65): the matrix cell drawer, the material drawer, the
 * rental and weight terms drawer, and the hauler policy card. Every save goes through a pricing slice action and shows
 * the problems it refused with.
 */
import { useState } from 'react'
import type { OverageTier, RolloffMaterial, RolloffPolicy, RolloffRate, ServiceCatalog } from '../../../types'
import { useStore } from '../../../store/useStore'
import { roundTons } from '../../../store/engine'
import type { MatrixCell } from '../lib/rolloff'
import { formatCents } from '../lib/money'
import { firstOfNextMonth } from '../lib/dates'
import { uniqueId } from '../lib/config'
import Pill, { type PillTone } from '../components/Pill'
import {
  BUTTON_LINK, BUTTON_PRIMARY, BUTTON_SECONDARY, Card, Checkbox, Drawer, Field, FormSection, INPUT, MoneyInput, NumberInput, Problems, Select,
  TextInput, Toggle, attempt,
} from '../components/form'

/** "20 yd", "30 yd compactor": the short name of a size for column heads and labels. */
export function sizeName(size: ServiceCatalog): string {
  return size.name.replace(/\s+roll-?off box$/i, '')
}

/** 3 -> "3", 1.2000001 -> "1.2". */
export function tonsText(t: number): string {
  return Number.isInteger(t) ? String(t) : String(Number(t.toFixed(2)))
}

/** "past 3 t over, $90.00/t" for each tier. */
export function tiersText(tiers: readonly OverageTier[] | undefined): string {
  return (tiers ?? []).map(t => `past ${tonsText(t.aboveTons)} t over, ${formatCents(t.centsPerTon)}/t`).join('; ')
}

const HANDLING_TONE: Record<RolloffMaterial['handling'], PillTone> = { standard: 'accent', accepted: 'success', restricted: 'warning', prohibited: 'danger' }
export const HANDLING_LABEL: Record<RolloffMaterial['handling'], string> = { standard: 'Standard', accepted: 'Accepted', restricted: 'Restricted', prohibited: 'Prohibited' }

/** The handling of a material as a toned pill. */
export function HandlingPill({ handling }: { handling: RolloffMaterial['handling'] }) {
  return <Pill tone={HANDLING_TONE[handling]}>{HANDLING_LABEL[handling]}</Pill>
}

let draftKey = 0
const nextKey = () => `k${++draftKey}`

interface TierDraft {
  key: string
  aboveTons: number | undefined
  centsPerTon: number | undefined
}

const tierDrafts = (tiers?: readonly OverageTier[]): TierDraft[] => (tiers ?? []).map(t => ({ key: nextKey(), aboveTons: t.aboveTons, centsPerTon: t.centsPerTon }))

function tiersFrom(drafts: TierDraft[]): { tiers: OverageTier[]; problem?: string } {
  if (drafts.some(d => d.aboveTons === undefined || d.centsPerTon === undefined)) return { tiers: [], problem: 'Complete or remove each tier' }
  const tiers = drafts.map(d => ({ aboveTons: d.aboveTons as number, centsPerTon: d.centsPerTon as number })).sort((a, b) => a.aboveTons - b.aboveTons)
  if (new Set(tiers.map(t => t.aboveTons)).size !== tiers.length) return { tiers, problem: 'Two tiers start at the same tons' }
  return { tiers }
}

/** Rows of "past N t over, $X per ton" with add and remove. Tons over the allowance past N bill at that row's rate. */
function TiersEditor({ tiers, onChange }: { tiers: TierDraft[]; onChange: (next: TierDraft[]) => void }) {
  const set = (key: string, patch: Partial<TierDraft>) => onChange(tiers.map(t => (t.key === key ? { ...t, ...patch } : t)))
  return (
    <FormSection title="Overage tiers" hint="Tons over the allowance past a tier's start bill at its rate instead of the base overage rate.">
      {tiers.length === 0 && <p className="text-small text-muted">No tiers: every ton over bills at the base rate.</p>}
      {tiers.map((t, i) => (
        <div key={t.key} className="flex flex-wrap items-center gap-2" data-tier={i}>
          <span className="text-small text-muted">Past</span>
          <span className="block w-24">
            <NumberInput value={t.aboveTons} onChange={v => set(t.key, { aboveTons: v })} min={0} suffix="t" ariaLabel={`Tier ${i + 1} starts past tons over`} />
          </span>
          <span className="text-small text-muted">over,</span>
          <span className="block w-32">
            <MoneyInput cents={t.centsPerTon} onChange={v => set(t.key, { centsPerTon: v })} ariaLabel={`Tier ${i + 1} rate per ton`} />
          </span>
          <span className="text-small text-muted">per ton</span>
          <button type="button" className={`${BUTTON_LINK} ml-auto`} aria-label={`Remove tier ${i + 1}`} onClick={() => onChange(tiers.filter(x => x.key !== t.key))}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className={BUTTON_SECONDARY} onClick={() => onChange([...tiers, { key: nextKey(), aboveTons: undefined, centsPerTon: undefined }])}>
        Add tier
      </button>
    </FormSection>
  )
}

function DateInput({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }) {
  return <input type="date" value={value} aria-label={ariaLabel} onChange={e => onChange(e.target.value)} className={INPUT} />
}

/** Overage per ton against what the landfill charges the hauler per ton for the material. */
function MarginHint({ overage, disposal }: { overage: number | undefined; disposal: number | undefined }) {
  if (disposal === undefined) return <p className="text-small text-muted">No disposal cost on file for this material, so there is no margin to compare.</p>
  if (overage === undefined) return null
  const diff = overage - disposal
  return (
    <p data-testid="margin-hint" className={`text-small font-semibold ${diff >= 0 ? 'text-success' : 'text-danger'}`}>
      {diff >= 0
        ? `Each ton over earns ${formatCents(diff)} above the ${formatCents(disposal)}/t disposal cost.`
        : `Each ton over loses ${formatCents(-diff)}: disposal costs ${formatCents(disposal)}/t.`}
    </p>
  )
}

/**
 * Edits one cell of the material by size matrix. A save is a new RolloffRate from its effective date that supersedes
 * the cell in force then; the old row is kept. The standard material's haul price is the size's published rate, so its
 * haul delta is fixed at 0 and its cell only replaces the catalog's weight terms from its date.
 */
export function CellDrawer({ cell, size, today, onClose, onSaved }: { cell: MatrixCell; size: ServiceCatalog; today: string; onClose: () => void; onSaved: (row: RolloffRate) => void }) {
  const saveRolloffRate = useStore(s => s.saveRolloffRate)
  const { material, terms } = cell
  const standard = material.handling === 'standard'
  const [available, setAvailable] = useState(terms.available)
  const [haulDelta, setHaulDelta] = useState<number | undefined>(terms.haulDeltaCents)
  const [includedTons, setIncludedTons] = useState<number | undefined>(terms.includedTons)
  const [overage, setOverage] = useState<number | undefined>(terms.overageCentsPerTon)
  const [tiers, setTiers] = useState(() => tierDrafts(terms.overageTiers))
  const [minBilled, setMinBilled] = useState<number | undefined>(terms.minBilledTons)
  const [effectiveFrom, setEffectiveFrom] = useState(firstOfNextMonth(today))
  const [problems, setProblems] = useState<string[]>([])
  const sizeHaul = cell.haulCents !== undefined ? cell.haulCents - terms.haulDeltaCents : undefined

  const save = () => {
    const local: string[] = []
    if (!standard && haulDelta === undefined) local.push('Enter the haul delta, 0.00 for none')
    if (includedTons === undefined) local.push('Enter the included tons')
    if (overage === undefined) local.push('Enter the overage per ton')
    const t = tiersFrom(tiers)
    if (t.problem) local.push(t.problem)
    if (local.length) {
      setProblems(local)
      return
    }
    const result = attempt(() =>
      saveRolloffRate({
        catalogId: cell.catalogId,
        materialId: material.id,
        effectiveFrom,
        today,
        cell: {
          available,
          haulDeltaCents: standard ? 0 : (haulDelta as number),
          includedTons: includedTons as number,
          overageCentsPerTon: overage as number,
          ...(t.tiers.length ? { overageTiers: t.tiers } : {}),
          ...(minBilled ? { minBilledTons: minBilled } : {}),
        },
      }),
    )
    if (!result.ok) setProblems(result.problems)
    else onSaved(result.value)
  }

  const inForce = cell.cell ? `In force: ${cell.cell.id}, from ${cell.cell.effectiveFrom}` : standard ? 'In force: the catalog terms for this size' : 'No cell yet, so it is not taken in this size'
  return (
    <Drawer
      title={`${material.name}, ${sizeName(size)}`}
      eyebrow="Roll-off cell"
      subtitle={inForce}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={BUTTON_SECONDARY} onClick={onClose}>Cancel</button>
          <button type="button" className={BUTTON_PRIMARY} onClick={save}>Save cell</button>
        </>
      }
    >
      <Problems problems={problems} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-body font-semibold text-ink">Available in this size</p>
          <p className="text-small text-muted">{standard ? 'The standard material is taken in every size.' : 'Off: the material is not taken in this size and a quote refuses it.'}</p>
        </div>
        <Toggle on={standard || available} onChange={setAvailable} label="Available" disabled={standard} />
      </div>
      <Field
        label="Haul delta"
        hint={standard
          ? `The standard material's haul price is the size's published rate${sizeHaul !== undefined ? ` (${formatCents(sizeHaul)} in this zone)` : ''}; change it under Rates.`
          : `Added to the size's haul rate${sizeHaul !== undefined ? ` (${formatCents(sizeHaul)} in this zone)` : ''}. Negative for a discount.`}
      >
        <MoneyInput cents={standard ? 0 : haulDelta} onChange={setHaulDelta} signed disabled={standard} ariaLabel="Haul delta" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Included tons" hint="Tons a haul includes before overage">
          <NumberInput value={includedTons} onChange={setIncludedTons} min={0} suffix="t" ariaLabel="Included tons" />
        </Field>
        <Field label="Overage per ton" hint="Each ton over the allowance">
          <MoneyInput cents={overage} onChange={setOverage} ariaLabel="Overage per ton" />
        </Field>
      </div>
      <MarginHint overage={overage} disposal={material.disposalCentsPerTon} />
      <TiersEditor tiers={tiers} onChange={setTiers} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Minimum billed tons" hint="A light load still bills this many. Blank for none.">
          <NumberInput value={minBilled} onChange={setMinBilled} min={0} suffix="t" ariaLabel="Minimum billed tons" />
        </Field>
        <Field label="Effective from" hint="The cell in force before it is kept.">
          <DateInput value={effectiveFrom} onChange={setEffectiveFrom} ariaLabel="Effective from" />
        </Field>
      </div>
    </Drawer>
  )
}

const HANDLING_OPTIONS = [
  { value: 'accepted', label: 'Accepted: priced by its own cells' },
  { value: 'restricted', label: 'Restricted: taken with conditions' },
  { value: 'prohibited', label: 'Prohibited: refused in every box' },
]

/**
 * Adds or edits a roll-off material: its name, the scale ticket codes that map to it, handling, the heavy flag and
 * fill limit, disposal cost per ton, and a note. The standard material stays standard; a new one is never standard.
 */
export function MaterialDrawer({ material, onClose, onSaved }: { material?: RolloffMaterial; onClose: () => void; onSaved: (m: RolloffMaterial) => void }) {
  const saveRolloffMaterial = useStore(s => s.saveRolloffMaterial)
  const others = useStore(s => (s.db.rolloffMaterials ?? []).filter(m => m.id !== material?.id))
  const standard = material?.handling === 'standard'
  const [name, setName] = useState(material?.name ?? '')
  const [codes, setCodes] = useState((material?.ticketCodes ?? []).join(', '))
  const [handling, setHandling] = useState<RolloffMaterial['handling']>(material?.handling ?? 'accepted')
  const [heavy, setHeavy] = useState(!!material?.heavy)
  const [fill, setFill] = useState<number | undefined>(material?.maxFillPct)
  const [disposal, setDisposal] = useState<number | undefined>(material?.disposalCentsPerTon)
  const [note, setNote] = useState(material?.note ?? '')
  const [problems, setProblems] = useState<string[]>([])

  const save = () => {
    const ticketCodes = codes.split(',').map(c => c.trim()).filter(Boolean)
    const local: string[] = []
    if (fill !== undefined && (fill <= 0 || fill > 100)) local.push('The fill limit is a percent from 1 to 100')
    for (const code of ticketCodes) {
      const clash = others.find(m => m.ticketCodes.some(c => c.toLowerCase() === code.toLowerCase()))
      if (clash) local.push(`Ticket code ${code} already maps to ${clash.name}`)
    }
    if (local.length) {
      setProblems(local)
      return
    }
    const result = attempt(() =>
      saveRolloffMaterial({
        ...(material ? { id: material.id } : {}),
        name: name.trim(),
        ticketCodes,
        handling,
        ...(heavy ? { heavy: true } : {}),
        ...(fill !== undefined ? { maxFillPct: fill } : {}),
        ...(disposal !== undefined ? { disposalCentsPerTon: disposal } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    )
    if (!result.ok) setProblems(result.problems)
    else onSaved(result.value)
  }

  return (
    <Drawer
      title={material ? material.name : 'Add a material'}
      eyebrow="Roll-off material"
      subtitle={material ? material.id : 'A new material is not taken in any size until you open its cells in the matrix.'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={BUTTON_SECONDARY} onClick={onClose}>Cancel</button>
          <button type="button" className={BUTTON_PRIMARY} onClick={save}>{material ? 'Save material' : 'Add material'}</button>
        </>
      }
    >
      <Problems problems={problems} />
      <Field label="Name">
        <TextInput value={name} onChange={setName} ariaLabel="Material name" placeholder="Drywall scrap" />
      </Field>
      <Field label="Ticket codes" hint="Comma separated. A scale ticket with one of these material codes bills as this material.">
        <TextInput value={codes} onChange={setCodes} ariaLabel="Ticket codes" placeholder="Drywall, Gypsum" />
      </Field>
      <Field label="Handling" hint={standard ? 'The standard material is priced by the haul rate and the catalog terms. It stays standard.' : undefined}>
        {standard
          ? <Select value="standard" onChange={() => {}} options={[{ value: 'standard', label: 'Standard: priced by the haul rate' }]} ariaLabel="Handling" disabled />
          : <Select value={handling} onChange={v => setHandling(v as RolloffMaterial['handling'])} options={HANDLING_OPTIONS} ariaLabel="Handling" />}
      </Field>
      <Checkbox checked={heavy} onChange={setHeavy} label="Heavy material" hint="Heavy loads are limited to a share of the box." />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Fill limit" hint="Blank for a full box">
          <NumberInput value={fill} onChange={setFill} min={0} suffix="%" ariaLabel="Fill limit" />
        </Field>
        <Field label="Disposal cost per ton" hint="What the facility charges you">
          <MoneyInput cents={disposal} onChange={setDisposal} ariaLabel="Disposal cost per ton" />
        </Field>
      </div>
      <Field label="Note">
        <TextInput value={note} onChange={setNote} ariaLabel="Note" />
      </Field>
    </Drawer>
  )
}

/**
 * Edits a size's rental and weight terms (catalog.rolloff). They price extra days and every scale ticket billed from
 * now on; a posted invoice never changes. The weight terms are the standard material's.
 */
export function TermsDrawer({ size, onClose, onSaved }: { size: ServiceCatalog; onClose: () => void; onSaved: (item: ServiceCatalog) => void }) {
  const updateRolloffTerms = useStore(s => s.updateRolloffTerms)
  const r = size.rolloff
  const [includedDays, setIncludedDays] = useState<number | undefined>(r?.includedDays)
  const [extraDay, setExtraDay] = useState<number | undefined>(r?.extraDayCents)
  const [grace, setGrace] = useState<number | undefined>(r?.graceDays)
  const [maxRental, setMaxRental] = useState<number | undefined>(r?.maxRentalDays)
  const [includedTons, setIncludedTons] = useState<number | undefined>(r?.includedTons)
  const [overage, setOverage] = useState<number | undefined>(r?.overageCentsPerTon)
  const [tiers, setTiers] = useState(() => tierDrafts(r?.overageTiers))
  const [minBilled, setMinBilled] = useState<number | undefined>(r?.minBilledTons)
  const [problems, setProblems] = useState<string[]>([])

  const save = () => {
    const local: string[] = []
    if (includedDays === undefined) local.push('Enter the included days')
    if (extraDay === undefined) local.push('Enter the extra day charge')
    if (includedTons === undefined) local.push('Enter the included tons')
    if (overage === undefined) local.push('Enter the overage per ton')
    if ([includedDays, grace, maxRental].some(d => d !== undefined && !Number.isInteger(d))) local.push('Days are whole numbers')
    const t = tiersFrom(tiers)
    if (t.problem) local.push(t.problem)
    if (local.length) {
      setProblems(local)
      return
    }
    const result = attempt(() =>
      updateRolloffTerms({
        catalogId: size.id,
        patch: {
          includedDays, extraDayCents: extraDay, includedTons, overageCentsPerTon: overage,
          graceDays: grace || undefined,
          maxRentalDays: maxRental || undefined,
          minBilledTons: minBilled || undefined,
          overageTiers: t.tiers.length ? t.tiers : undefined,
        },
      }),
    )
    if (!result.ok) setProblems(result.problems)
    else onSaved(result.value)
  }

  return (
    <Drawer
      title={`${sizeName(size)} terms`}
      eyebrow="Roll-off rental and weight"
      subtitle="These terms price extra days and scale tickets billed from now on. A posted invoice never changes."
      onClose={onClose}
      footer={
        <>
          <button type="button" className={BUTTON_SECONDARY} onClick={onClose}>Cancel</button>
          <button type="button" className={BUTTON_PRIMARY} onClick={save}>Save terms</button>
        </>
      }
    >
      <Problems problems={problems} />
      <FormSection title="Rental">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Included days">
            <NumberInput value={includedDays} onChange={setIncludedDays} min={0} step="1" suffix="days" ariaLabel="Included days" />
          </Field>
          <Field label="Extra day charge" hint="Each day past included and grace">
            <MoneyInput cents={extraDay} onChange={setExtraDay} ariaLabel="Extra day charge" />
          </Field>
          <Field label="Grace days" hint="Free days before extra days bill">
            <NumberInput value={grace} onChange={setGrace} min={0} step="1" suffix="days" ariaLabel="Grace days" />
          </Field>
          <Field label="Max rental days" hint="Swap or pull after this. Nothing bills it.">
            <NumberInput value={maxRental} onChange={setMaxRental} min={0} step="1" suffix="days" ariaLabel="Max rental days" />
          </Field>
        </div>
      </FormSection>
      <FormSection title="Weight" hint="The standard material's terms. Another material's cell in the matrix sets its own.">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Included tons">
            <NumberInput value={includedTons} onChange={setIncludedTons} min={0} suffix="t" ariaLabel="Included tons" />
          </Field>
          <Field label="Overage per ton">
            <MoneyInput cents={overage} onChange={setOverage} ariaLabel="Overage per ton" />
          </Field>
          <Field label="Minimum billed tons" hint="Blank for none">
            <NumberInput value={minBilled} onChange={setMinBilled} min={0} suffix="t" ariaLabel="Minimum billed tons" />
          </Field>
        </div>
      </FormSection>
      <TiersEditor tiers={tiers} onChange={setTiers} />
    </Drawer>
  )
}

const ROUNDING_OPTIONS: { value: RolloffPolicy['tonRounding']; label: string }[] = [
  { value: 'exact', label: 'Exact, no rounding' },
  { value: 'tenth', label: 'Up to the tenth of a ton' },
  { value: 'quarter', label: 'Up to the quarter ton' },
  { value: 'half', label: 'Up to the half ton' },
  { value: 'whole', label: 'Up to the whole ton' },
]

interface ItemDraft {
  key: string
  id?: string
  name: string
  cents: number | undefined
}

/**
 * The hauler-wide roll-off rules: ton rounding (with a worked example), the trip charge past the free radius, dump and
 * return, relocation, dry run, and the prices of prohibited items found in a box. One Save writes them all.
 */
export function PolicyCard({ policy }: { policy: RolloffPolicy | undefined }) {
  return (
    <Card label="Hauler policy" className="p-5">
      <h3 className="text-h2 font-bold tracking-tight">Hauler policy</h3>
      <p className="mt-0.5 text-body text-muted">Rules for every roll-off haul. Tons are rounded up before the allowance comes off.</p>
      {policy ? <PolicyForm policy={policy} /> : <p className="mt-4 text-body text-muted">No roll-off policy on file.</p>}
    </Card>
  )
}

function PolicyForm({ policy }: { policy: RolloffPolicy }) {
  const updateRolloffPolicy = useStore(s => s.updateRolloffPolicy)
  const [rounding, setRounding] = useState(policy.tonRounding)
  const [freeRadius, setFreeRadius] = useState<number | undefined>(policy.freeRadiusMiles)
  const [trip, setTrip] = useState<number | undefined>(policy.tripCentsPerMile)
  const [swap, setSwap] = useState<number | undefined>(policy.swapCents)
  const [relocation, setRelocation] = useState<number | undefined>(policy.relocationCents)
  const [dryRun, setDryRun] = useState<number | undefined>(policy.dryRunCents)
  const [items, setItems] = useState<ItemDraft[]>(() => policy.prohibitedItems.map(i => ({ key: nextKey(), id: i.id, name: i.name, cents: i.cents })))
  const [problems, setProblems] = useState<string[]>([])
  const [saved, setSaved] = useState(false)

  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setSaved(false)
  }
  const setItem = (key: string, patch: Partial<ItemDraft>) => {
    setItems(list => list.map(i => (i.key === key ? { ...i, ...patch } : i)))
    setSaved(false)
  }

  const save = () => {
    const local: string[] = []
    if (freeRadius === undefined) local.push('Enter the free radius')
    if (trip === undefined) local.push('Enter the trip charge per mile')
    if (swap === undefined) local.push('Enter the dump and return price')
    if (relocation === undefined) local.push('Enter the relocation price')
    if (dryRun === undefined) local.push('Enter the dry run price')
    if (items.some(i => !i.name.trim() || i.cents === undefined)) local.push('Give each prohibited item a name and a price')
    if (local.length) {
      setProblems(local)
      return
    }
    const taken = new Set(items.map(i => i.id).filter((id): id is string => !!id))
    const prohibitedItems = items.map(i => {
      const id = i.id ?? uniqueId('item', i.name, taken)
      taken.add(id)
      return { id, name: i.name.trim(), cents: i.cents as number }
    })
    const result = attempt(() =>
      updateRolloffPolicy({
        patch: {
          tonRounding: rounding, freeRadiusMiles: freeRadius as number, tripCentsPerMile: trip as number, swapCents: swap as number,
          relocationCents: relocation as number, dryRunCents: dryRun as number, prohibitedItems,
        },
      }),
    )
    if (!result.ok) {
      setProblems(result.problems)
      return
    }
    setProblems([])
    setItems(prohibitedItems.map(i => ({ key: nextKey(), ...i })))
    setSaved(true)
  }

  const example = roundTons(4.23, rounding)
  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Ton rounding" hint={`A 4.23 t ticket bills as ${tonsText(example)} t`}>
          <Select value={rounding} onChange={edit(v => setRounding(v as RolloffPolicy['tonRounding']))} options={ROUNDING_OPTIONS} ariaLabel="Ton rounding" />
        </Field>
        <Field label="Free radius" hint="No trip charge inside it">
          <NumberInput value={freeRadius} onChange={edit(setFreeRadius)} min={0} suffix="mi" ariaLabel="Free radius" />
        </Field>
        <Field
          label="Trip charge per mile"
          hint={freeRadius !== undefined && trip !== undefined ? `A site ${tonsText(freeRadius + 5)} mi out pays ${formatCents(5 * trip)} a trip` : 'Per mile past the free radius'}
        >
          <MoneyInput cents={trip} onChange={edit(setTrip)} ariaLabel="Trip charge per mile" />
        </Field>
        <Field label="Dump and return" hint="Haul the box and set it back">
          <MoneyInput cents={swap} onChange={edit(setSwap)} ariaLabel="Dump and return" />
        </Field>
        <Field label="Relocation" hint="Move the box on the same site">
          <MoneyInput cents={relocation} onChange={edit(setRelocation)} ariaLabel="Relocation" />
        </Field>
        <Field label="Dry run" hint="Box blocked or not ready">
          <MoneyInput cents={dryRun} onChange={edit(setDryRun)} ariaLabel="Dry run" />
        </Field>
      </div>
      <FormSection title="Prohibited items found in the box" hint="Each one found bills this price on the haul.">
        {items.length === 0 && <p className="text-small text-muted">No item fees.</p>}
        {items.map((item, i) => (
          <div key={item.key} className="flex items-center gap-2" data-item={item.id ?? 'new'}>
            <span className="block min-w-0 flex-1">
              <TextInput value={item.name} onChange={v => setItem(item.key, { name: v })} ariaLabel={`Item ${i + 1} name`} placeholder="Propane tank" />
            </span>
            <span className="block w-32">
              <MoneyInput cents={item.cents} onChange={v => setItem(item.key, { cents: v })} ariaLabel={`Item ${i + 1} price`} />
            </span>
            <button
              type="button"
              className={BUTTON_LINK}
              aria-label={`Remove item ${i + 1}`}
              onClick={() => {
                setItems(list => list.filter(x => x.key !== item.key))
                setSaved(false)
              }}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className={BUTTON_SECONDARY}
          onClick={() => {
            setItems(list => [...list, { key: nextKey(), name: '', cents: undefined }])
            setSaved(false)
          }}
        >
          Add item
        </button>
      </FormSection>
      <Problems problems={problems} />
      <div className="flex items-center justify-end gap-3">
        {saved && <p role="status" className="text-small font-semibold text-success">Policy saved. Hauls priced from now on use it.</p>}
        <button type="button" className={BUTTON_PRIMARY} onClick={save}>Save policy</button>
      </div>
    </div>
  )
}
