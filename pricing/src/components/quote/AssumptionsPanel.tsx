import type { Frequency } from '../../types';
import {
  ACCESS_FLAGS, MATERIALS, MATERIAL_LABEL, changedAssumptions, type AccessFlags, type CostAssumptions, type LiftsPerDaySource, type Material,
} from '../../store/costToServe';
import { FREQUENCY_LABEL } from '../../store/engine';
import { FREQUENCY_ORDER } from '../../lib/quote';
import NumberField from './NumberField';

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line pt-2 first:border-t-0 first:pt-0">
      <p className="mb-0.5 text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">{title}</p>
      {children}
    </div>
  );
}

/** Every cost-to-serve assumption as an editable field. Any valid edit recomputes the waterfall and the
 *  target price at once; the dot marks the values the current quote uses. */
export default function AssumptionsPanel({
  assumptions, onChange, onReset, resetKey, material, frequency, access, liftsBasis,
}: {
  assumptions: CostAssumptions;
  onChange: (next: CostAssumptions) => void;
  onReset: () => void;
  resetKey: number;
  material: Material;
  frequency: Frequency;
  access: AccessFlags;
  /** Which lifts-per-day assumption the current item is costed at. */
  liftsBasis: LiftsPerDaySource;
}) {
  const changed = new Set(changedAssumptions(assumptions));
  const a = assumptions;
  const field = (path: string) => ({ changed: changed.has(path) });

  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card" aria-label="Assumptions">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-h2 font-bold">Assumptions</h2>
          <p className="mt-0.5 text-small text-muted">{changed.size === 0 ? 'Defaults. Edit any value to reprice.' : `${changed.size} edited from defaults`}</p>
        </div>
        <button
          type="button"
          onClick={onReset}
          disabled={changed.size === 0}
          className="rounded-md border border-line bg-surface px-3 py-1.5 text-small font-semibold text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          Reset to defaults
        </button>
      </div>

      <div className="mt-3 space-y-2">
        <Group title="Truck">
          <NumberField key={`${resetKey}-truckDayCostCents`} {...field('truckDayCostCents')} label="Truck day cost" unit="$ / day" scale={100} minExclusive value={a.truckDayCostCents} inUse onCommit={(v) => onChange({ ...a, truckDayCostCents: v })} />
          <NumberField key={`${resetKey}-truckHoursPerDay`} {...field('truckHoursPerDay')} label="Truck hours per day" unit="hours" minExclusive value={a.truckHoursPerDay} inUse onCommit={(v) => onChange({ ...a, truckHoursPerDay: v })} />
          <NumberField key={`${resetKey}-baseLiftsPerDay`} {...field('baseLiftsPerDay')} label="Base lifts per day" unit="lifts" minExclusive value={a.baseLiftsPerDay} inUse={liftsBasis === 'baseLiftsPerDay'} onCommit={(v) => onChange({ ...a, baseLiftsPerDay: v })} />
          <NumberField key={`${resetKey}-residentialStopsPerDay`} {...field('residentialStopsPerDay')} label="Residential stops per day" unit="stops" minExclusive value={a.residentialStopsPerDay} inUse={liftsBasis === 'residentialStopsPerDay'} onCommit={(v) => onChange({ ...a, residentialStopsPerDay: v })} />
          <NumberField key={`${resetKey}-rolloffHaulsPerDay`} {...field('rolloffHaulsPerDay')} label="Rolloff hauls per day" unit="hauls" minExclusive value={a.rolloffHaulsPerDay} inUse={liftsBasis === 'rolloffHaulsPerDay'} onCommit={(v) => onChange({ ...a, rolloffHaulsPerDay: v })} />
        </Group>

        <Group title="Access, extra minutes per lift">
          {ACCESS_FLAGS.map((f) => (
            <NumberField
              key={`${resetKey}-extraMinutes.${f}`}
              {...field(`extraMinutes.${f}`)}
              label={f[0].toUpperCase() + f.slice(1)}
              unit="min"
              value={a.extraMinutes[f]}
              inUse={access[f]}
              onCommit={(v) => onChange({ ...a, extraMinutes: { ...a.extraMinutes, [f]: v } })}
            />
          ))}
        </Group>

        <Group title="Disposal">
          <NumberField key={`${resetKey}-tipFeeCentsPerTon`} {...field('tipFeeCentsPerTon')} label="Tip fee" unit="$ / ton" scale={100} value={a.tipFeeCentsPerTon} inUse onCommit={(v) => onChange({ ...a, tipFeeCentsPerTon: v })} />
          {MATERIALS.map((m) => (
            <NumberField
              key={`${resetKey}-lbPerYard.${m}`}
              {...field(`lbPerYard.${m}`)}
              label={MATERIAL_LABEL[m]}
              unit="lb / yd"
              value={a.lbPerYard[m]}
              inUse={m === material}
              onCommit={(v) => onChange({ ...a, lbPerYard: { ...a.lbPerYard, [m]: v } })}
            />
          ))}
        </Group>

        <Group title="Overhead and margin">
          <NumberField key={`${resetKey}-indirectPct`} {...field('indirectPct')} label="Indirect" unit="% direct" value={a.indirectPct} inUse onCommit={(v) => onChange({ ...a, indirectPct: v })} />
          <NumberField key={`${resetKey}-targetMarginPct`} {...field('targetMarginPct')} label="Target margin" unit="% price" max={100} value={a.targetMarginPct} inUse onCommit={(v) => onChange({ ...a, targetMarginPct: v })} />
        </Group>

        <Group title="Lifts per month">
          {FREQUENCY_ORDER.map((f) => (
            <NumberField
              key={`${resetKey}-liftsPerMonth.${f}`}
              {...field(`liftsPerMonth.${f}`)}
              label={FREQUENCY_LABEL[f]}
              unit="lifts"
              value={a.liftsPerMonth[f]}
              inUse={f === frequency}
              onCommit={(v) => onChange({ ...a, liftsPerMonth: { ...a.liftsPerMonth, [f]: v } })}
            />
          ))}
        </Group>
      </div>
    </section>
  );
}
