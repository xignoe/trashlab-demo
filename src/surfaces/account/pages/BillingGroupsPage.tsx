// Billing groups at /office/groups (addenda P and Q), for an office manager with anywhere from a few to hundreds of
// groups. The list view is two tables: every group (search, sort by any column, paged), and under it the customers
// not in a group, each with a quick "add to group". Clicking a group opens its page (?group=<id>) in three numbered
// sections:
//   1. How they get invoices: printed mail, email, text, or portal; whether customers may choose; payment terms.
//   2. How often they're billed: daily, weekly, monthly, or quarterly, every N, from a start date, with the next bill
//      dates and what each bill covers shown as you edit.
//   3. Who's in it: the members, and "Add accounts" by zone, customer type, service, route, and current group.
// Sections 1 and 2 are a draft until Save; the save bar says what saving will do (accounts moving to new dates, bridge
// charges, delivery switches) before anything changes. Adding and taking out members happens right away. The group's
// page also runs its part of the current bill run, and removes the group after its members move elsewhere.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../../store/useStore';
import { queueItems } from '../../../store/selectors';
import { groupCadence, periodLabel, scheduleText } from '../../../store/cycles';
import type { BillingFrequency, BillingGroup, InvoiceDelivery } from '../../../types';
import {
  CUSTOMER_TYPES, DELIVERY_HINT, DELIVERY_NAME, EMPTY_FILTER, FREQUENCIES, INVOICE_DELIVERIES, SERVICE_TYPES, TERMS_CHOICES,
  accountFacts, deliveryMix, groupPeriod, matchAccounts, membersOf, nextBillDates, planGroupSave, type BillingGroupDraft, type MemberFilter,
} from '../lib/billingGroups';
import { CYCLE_LABEL, STATUS_LABEL, fmtDay, money, plural } from '../components/format';

const UNGROUPED_PAGE = 25;

const NEW = 'new';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Nothing was changed.';
}

function draftOf(g: BillingGroup): BillingGroupDraft {
  return { name: g.name, schedule: { ...g.schedule }, termsDays: g.termsDays, delivery: g.delivery, customerChoice: g.customerChoice, note: g.note ?? '' };
}

function sameDraft(a: BillingGroupDraft, b: BillingGroupDraft): boolean {
  return JSON.stringify({ ...a, note: a.note ?? '' }) === JSON.stringify({ ...b, note: b.note ?? '' });
}

// ---------------------------------------------------------------------------------------------
// The list view: all groups, then the customers not in a group
// ---------------------------------------------------------------------------------------------

type GroupSort = 'name' | 'schedule' | 'next' | 'members' | 'delivery' | 'terms';
const PAGE_SIZE = 25;

function SortHeader({ label, k, sort, dir, onSort, numeric }: { label: string; k: GroupSort; sort: GroupSort; dir: 'asc' | 'desc'; onSort: (k: GroupSort) => void; numeric?: boolean }) {
  const on = sort === k;
  return (
    <th className={numeric ? 'money' : undefined} aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="groups-sort" onClick={() => onSort(k)}>
        {label}
        <span aria-hidden="true" className="groups-sort-mark">{on ? (dir === 'asc' ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  );
}

function GroupsTable({ onOpen }: { onOpen: (id: string) => void }) {
  const db = useStore((s) => s.db);
  const cycleDate = useStore((s) => s.cycleDate);
  const [q, setQ] = useState('');
  const [freq, setFreq] = useState<'all' | FrequencyMode>('all');
  const [sort, setSort] = useState<GroupSort>('name');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);

  const rows = useMemo(() => {
    const count = new Map<string, number>();
    for (const a of db.accounts) if (a.billingGroupId) count.set(a.billingGroupId, (count.get(a.billingGroupId) ?? 0) + 1);
    return db.billingGroups.map((g) => ({
      group: g,
      schedule: scheduleText(g.schedule),
      next: nextBillDates(groupCadence(g), cycleDate, 1)[0] ?? '',
      members: count.get(g.id) ?? 0,
    }));
  }, [db, cycleDate]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = rows.filter((r) =>
      (freq === 'all' || modeOf(r.group.schedule) === freq)
      && (!needle || r.group.name.toLowerCase().includes(needle) || (r.group.note ?? '').toLowerCase().includes(needle) || r.schedule.toLowerCase().includes(needle)));
    const key = (r: (typeof rows)[number]): string | number => {
      switch (sort) {
        case 'name': return r.group.name.toLowerCase();
        case 'schedule': return r.schedule;
        case 'next': return r.next;
        case 'members': return r.members;
        case 'delivery': return DELIVERY_NAME[r.group.delivery];
        case 'terms': return r.group.termsDays;
      }
    };
    return [...filtered].sort((a, b) => {
      const x = key(a);
      const y = key(b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return dir === 'asc' ? c : -c;
    });
  }, [rows, q, freq, sort, dir]);

  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const slice = shown.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);
  const onSort = (k: GroupSort) => {
    if (k === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(k);
      setDir(k === 'members' ? 'desc' : 'asc');
    }
  };

  return (
    <section className="panel groups-section" aria-label="All billing groups">
      <div className="card-head">
        <h2 className="card-title">All groups</h2>
        <span className="card-note">{plural(rows.length, 'group')}</span>
      </div>
      <div className="groups-toolbar">
        <input
          className="input"
          type="search"
          placeholder="Search groups by name, note, or schedule"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
          aria-label="Search groups"
        />
        <div className="groups-segments" role="radiogroup" aria-label="Show">
          {(['all', ...MODES.map((m) => m.id)] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={freq === f}
              className={`groups-segment${freq === f ? ' is-on' : ''}`}
              onClick={() => {
                setFreq(f);
                setPage(0);
              }}
            >
              {f === 'all' ? 'All' : MODES.find((x) => x.id === f)!.label}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="card-empty">{rows.length ? 'No group matches.' : 'No groups yet. Create one to bill customers together.'}</div>
      ) : (
        <div className="table-wrap">
          <table className="table groups-grid-table">
            <thead>
              <tr>
                <SortHeader label="Group" k="name" sort={sort} dir={dir} onSort={onSort} />
                <SortHeader label="Bills" k="schedule" sort={sort} dir={dir} onSort={onSort} />
                <SortHeader label="Next bill" k="next" sort={sort} dir={dir} onSort={onSort} />
                <SortHeader label="Members" k="members" sort={sort} dir={dir} onSort={onSort} numeric />
                <SortHeader label="Invoices by" k="delivery" sort={sort} dir={dir} onSort={onSort} />
                <SortHeader label="Due" k="terms" sort={sort} dir={dir} onSort={onSort} numeric />
              </tr>
            </thead>
            <tbody>
              {slice.map((r) => (
                <tr
                  key={r.group.id}
                  className="groups-row"
                  tabIndex={0}
                  onClick={() => onOpen(r.group.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpen(r.group.id);
                    }
                  }}
                  data-testid={`group-row-${r.group.id}`}
                >
                  <td>
                    <span className="acct-name">{r.group.name}</span>
                    {r.group.note ? <div className="meta groups-row-note">{r.group.note}</div> : null}
                  </td>
                  <td>{r.schedule}</td>
                  <td className="nowrap">
                    {r.next ? fmtDay(r.next) : 'None'}
                    {r.next === cycleDate ? <span className="pill pill-info groups-current">Current run</span> : null}
                  </td>
                  <td className="money">{r.members}</td>
                  <td>
                    {DELIVERY_NAME[r.group.delivery]}
                    <div className="meta">{r.group.customerChoice ? 'customers may choose' : 'group decides'}</div>
                  </td>
                  <td className="money">{r.group.termsDays === 0 ? 'On receipt' : `${r.group.termsDays} days`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 ? (
        <div className="groups-pager">
          <span className="meta">
            {current * PAGE_SIZE + 1} to {Math.min(shown.length, (current + 1) * PAGE_SIZE)} of {shown.length}
          </span>
          <span className="cluster">
            <button type="button" className="btn btn-secondary btn-sm" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</button>
          </span>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The group's part of the current cycle
// ---------------------------------------------------------------------------------------------

function GroupCycle({ group }: { group: BillingGroup }) {
  const data = useStore(useShallow((s) => ({ db: s.db, runs: s.runs, cycleDate: s.cycleDate, edits: s.edits })));
  const runCycle = useStore((s) => s.runCycle);
  const bulkApproveClean = useStore((s) => s.bulkApproveClean);
  const post = useStore((s) => s.post);
  const [message, setMessage] = useState<{ error?: string; notice?: string }>({});
  const { cycleDate } = data;
  const cycle = fmtDay(cycleDate);
  const members = useMemo(() => new Set(membersOf(data.db, group.id).map((a) => a.id)), [data.db, group.id]);
  const run = data.runs[cycleDate];
  const next = nextBillDates(groupCadence(group), cycleDate, 1)[0];
  const ran = !!run && (run.ranAll !== false || (run.groupIds ?? []).includes(group.id));

  const stats = useMemo(() => {
    if (!run) return undefined;
    const inRun = new Set(run.chargeIds);
    const charges = data.db.charges.filter((c) => inRun.has(c.id) && members.has(c.accountId) && c.status !== 'waived');
    const queue = queueItems(data);
    const queued = new Set(queue.map((i) => i.chargeId));
    const undecided = queue.filter((i) => !i.decided && members.has(i.accountId));
    const approved = charges.filter((c) => c.status === 'approved');
    const posted = charges.filter((c) => c.status === 'posted');
    return {
      charges: charges.length,
      undecided: undecided.length,
      clean: charges.filter((c) => c.status === 'proposed' && !queued.has(c.id)).length,
      approved: approved.length,
      approvedAccounts: new Set(approved.map((c) => c.accountId)).size,
      posted: posted.length,
      postedAccounts: new Set(posted.map((c) => c.accountId)).size,
      postedCents: posted.reduce((s, c) => s + c.totalCents, 0),
    };
  }, [data, run, members]);

  const act = (fn: () => string) => {
    try {
      setMessage({ notice: fn() });
    } catch (err) {
      setMessage({ error: errorText(err) });
    }
  };

  if (next !== cycleDate) return <p className="meta groups-cycle">Not billing on {cycle}. Next bill {fmtDay(next)}.</p>;

  return (
    <div className="groups-cycle" data-testid={`group-cycle-${group.id}`}>
      <div className="cluster">
        <span className="eyebrow">{cycle} bill run</span>
        {!ran || !stats ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={members.size === 0}
            onClick={() => act(() => {
              runCycle({ groupId: group.id });
              return `${group.name} ran for ${cycle}. Review, then post its invoices here.`;
            })}
          >
            Run {cycle} for this group
          </button>
        ) : (
          <>
            <span className="meta">
              {plural(stats.charges, 'charge')}: {stats.undecided ? `${stats.undecided} to decide, ` : ''}
              {stats.clean ? `${stats.clean} clean, ` : ''}
              {stats.approved} approved, {stats.posted} posted
            </span>
            {stats.undecided > 0 ? (
              <Link to="/office/account?review=1" className="btn btn-secondary btn-sm">
                Decide {plural(stats.undecided, 'charge')}
              </Link>
            ) : null}
            {stats.clean > 0 ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => act(() => {
                const r = bulkApproveClean({ groupId: group.id });
                return `Approved ${plural(r.count, 'clean charge')}, ${money(r.cents)}.`;
              })}>
                Approve {plural(stats.clean, 'clean charge')}
              </button>
            ) : null}
            {stats.approved > 0 ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={stats.undecided > 0}
                title={stats.undecided > 0 ? 'Decide every charge in this group first' : undefined}
                onClick={() => act(() => {
                  const invoices = post({ groupId: group.id });
                  return `Posted ${plural(invoices.length, 'invoice')}, ${money(invoices.reduce((s, i) => s + i.totalCents, 0))}.`;
                })}
              >
                Post {plural(stats.approvedAccounts, 'invoice')}
              </button>
            ) : null}
            {stats.charges > 0 && stats.posted === stats.charges ? (
              <span className="pill pill-active">Posted {plural(stats.postedAccounts, 'invoice')}, {money(stats.postedCents)}</span>
            ) : null}
          </>
        )}
      </div>
      {message.error ? <div className="form-error">{message.error}</div> : null}
      {message.notice ? <p className="meta groups-notice">{message.notice}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Sections 1 and 2
// ---------------------------------------------------------------------------------------------

function DeliverySection({ draft, set, mix }: { draft: BillingGroupDraft; set: (p: Partial<BillingGroupDraft>) => void; mix?: Record<InvoiceDelivery, number> }) {
  return (
    <section className="panel groups-section" aria-labelledby="sec-delivery">
      <div className="groups-section-head">
        <span className="groups-step">1</span>
        <div>
          <h2 id="sec-delivery" className="card-title">Invoice Method</h2>
        </div>
      </div>
      <div className="groups-tiles" role="radiogroup" aria-label="Invoice delivery">
        {INVOICE_DELIVERIES.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={draft.delivery === m}
            className={`groups-tile${draft.delivery === m ? ' is-on' : ''}`}
            onClick={() => set({ delivery: m })}
          >
            <span className="groups-tile-title">{DELIVERY_NAME[m]}</span>
            <span className="meta">{DELIVERY_HINT[m]}</span>
            {mix ? <span className="meta groups-tile-count">{plural(mix[m], 'account')} now</span> : null}
          </button>
        ))}
      </div>
      <label className="groups-check">
        <input type="checkbox" checked={draft.customerChoice} onChange={(e) => set({ customerChoice: e.target.checked })} />
        <span>
          <strong>Let customers choose their own</strong>
          <span className="meta">
            {draft.customerChoice
              ? `New members get ${DELIVERY_NAME[draft.delivery].toLowerCase()}; a customer can switch in the portal or by calling.`
              : `Every member gets ${DELIVERY_NAME[draft.delivery].toLowerCase()}. Saving switches anyone who chose differently.`}
          </span>
        </span>
      </label>
      <label className="field groups-terms">
        <span className="eyebrow">Payment due</span>
        <select className="select" value={draft.termsDays} onChange={(e) => set({ termsDays: Number(e.target.value) })}>
          {TERMS_CHOICES.map((t) => (
            <option key={t} value={t}>
              {t === 0 ? 'On receipt' : `${t} days after the invoice`}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

type FrequencyMode = BillingFrequency | 'custom';
const MODES: { id: FrequencyMode; label: string }[] = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'custom', label: 'Custom' },
];
const CUSTOM_DEFAULT_DAYS = 21;

/** Custom is a daily schedule every N days (21, 45, ...); Daily is every single day. */
function modeOf(schedule: BillingGroupDraft['schedule']): FrequencyMode {
  return schedule.frequency === 'daily' && schedule.every !== 1 ? 'custom' : schedule.frequency;
}

function ScheduleSection({ draft, set, from }: { draft: BillingGroupDraft; set: (p: Partial<BillingGroupDraft>) => void; from: string }) {
  // Kept locally so typing "1" on the way to "14" in Custom does not flip the control to Daily.
  const [mode, setMode] = useState<FrequencyMode>(modeOf(draft.schedule));
  const freq = FREQUENCIES.find((f) => f.id === draft.schedule.frequency)!;
  const setSchedule = (p: Partial<BillingGroupDraft['schedule']>) => set({ schedule: { ...draft.schedule, ...p } });
  const every = draft.schedule.every;
  const valid = Number.isInteger(every) && every >= 1 && every <= freq.maxEvery && /^\d{4}-\d{2}-\d{2}$/.test(draft.schedule.startDate);
  const dates = valid ? nextBillDates({ cycle: draft.schedule.frequency, schedule: draft.schedule }, from, 4) : [];

  const choose = (m: FrequencyMode) => {
    setMode(m);
    if (m === 'daily') setSchedule({ frequency: 'daily', every: 1 });
    else if (m === 'custom') setSchedule({ frequency: 'daily', every: mode === 'custom' ? every : CUSTOM_DEFAULT_DAYS });
    else setSchedule({ frequency: m, every: mode === 'daily' || mode === 'custom' ? 1 : Math.min(Math.max(1, every || 1), FREQUENCIES.find((f) => f.id === m)!.maxEvery) });
  };

  return (
    <section className="panel groups-section" aria-labelledby="sec-schedule">
      <div className="groups-section-head">
        <span className="groups-step">2</span>
        <div>
          <h2 id="sec-schedule" className="card-title">Billing Frequency</h2>
        </div>
      </div>
      <div className="groups-segments" role="radiogroup" aria-label="Frequency">
        {MODES.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={`groups-segment${mode === m.id ? ' is-on' : ''}`} onClick={() => choose(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="groups-schedule-row">
        {mode !== 'daily' ? (
          <label className="field">
            <span className="eyebrow">Every</span>
            <span className="cluster">
              <input
                className="input groups-every"
                type="number"
                min={1}
                max={freq.maxEvery}
                value={Number.isFinite(every) ? every : ''}
                onChange={(e) => setSchedule({ every: Math.floor(Number(e.target.value)) })}
                aria-label={`Bill every how many ${freq.units}`}
              />
              <span>{every === 1 ? freq.unit : freq.units}</span>
            </span>
          </label>
        ) : null}
        <label className="field">
          <span className="eyebrow">First bill date</span>
          <input className="input" type="date" value={draft.schedule.startDate} onChange={(e) => setSchedule({ startDate: e.target.value })} aria-label="First bill date" />
        </label>
      </div>
      <p className="meta">
        {mode === 'weekly'
          ? 'The first bill date sets the weekday.'
          : mode === 'daily'
            ? 'Bills every day from the first bill date.'
            : mode === 'custom'
              ? 'Bills every set number of days, counting from the first bill date, whatever the weekday or month.'
              : "The first bill date sets the day of the month. The 29th to 31st fall back to a short month's last day."}
      </p>
      {valid ? (
        <div className="inset groups-summary" data-testid="schedule-summary">
          <strong>{scheduleText(draft.schedule)}</strong>
          <span className="meta">
            Next bills: {dates.map((d) => fmtDay(d)).join(', ')}. Each bill covers {periodLabel(groupPeriod({ schedule: draft.schedule }, dates[0]))}.
          </span>
          {draft.schedule.frequency === 'weekly' ? <span className="meta">Monthly rates are split: each weekly bill is 12/52 of the month, and flat fees the same way.</span> : null}
          {draft.schedule.frequency === 'daily' ? (
            <span className="meta">
              Monthly rates are split by day: each bill is {every === 1 ? '12/365' : `${every} x 12/365`} of the month, and flat fees the same way.
            </span>
          ) : null}
        </div>
      ) : (
        <div className="form-error">Bill every 1 to {freq.maxEvery} {freq.units}, from a first bill date.</div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Section 3
// ---------------------------------------------------------------------------------------------

function Chips<T extends string>({ label, options, value, onChange }: { label: string; options: { id: T; label: string }[]; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <div className="groups-filter" role="group" aria-label={label}>
      <span className="eyebrow">{label}</span>
      <div className="groups-chips">
        {options.map((o) => {
          const on = value.includes(o.id);
          return (
            <button key={o.id} type="button" aria-pressed={on} className={`groups-chip${on ? ' is-on' : ''}`} onClick={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])}>
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MembersSection({ group }: { group: BillingGroup }) {
  const db = useStore((s) => s.db);
  const addAccountsToBillingGroup = useStore((s) => s.addAccountsToBillingGroup);
  const assignBillingGroup = useStore((s) => s.assignBillingGroup);
  const setInvoiceDelivery = useStore((s) => s.setInvoiceDelivery);
  const [tab, setTab] = useState<'members' | 'add'>('members');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<MemberFilter>({ ...EMPTY_FILTER });
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ error?: string; notice?: string }>({});
  const facts = useMemo(() => accountFacts(db), [db]);
  const zoneName = useMemo(() => new Map(db.zones.map((z) => [z.id, z.name])), [db.zones]);
  const groupName = useMemo(() => new Map(db.billingGroups.map((g) => [g.id, g.name])), [db.billingGroups]);
  const members = matchAccounts(facts, { ...EMPTY_FILTER, inGroup: group.id, search });
  const matches = matchAccounts(facts, filter).filter((f) => f.account.billingGroupId !== group.id);
  const chosen = matches.filter((m) => !unchecked.has(m.account.id));
  const moving = chosen.filter((c) => c.account.billingGroupId).length;
  const locked = !group.customerChoice;
  const kindLabel = (k?: string) => CUSTOMER_TYPES.find((c) => c.id === k)?.label ?? '';
  const setF = (p: Partial<MemberFilter>) => {
    setFilter((f) => ({ ...f, ...p }));
    setUnchecked(new Set());
  };
  const attempt = (fn: () => string | void) => {
    try {
      const notice = fn();
      setMessage(notice ? { notice } : {});
    } catch (err) {
      setMessage({ error: errorText(err) });
    }
  };

  return (
    <section className="panel groups-section" aria-labelledby="sec-members">
      <div className="groups-section-head">
        <span className="groups-step">3</span>
        <div>
          <h2 id="sec-members" className="card-title">Group Members</h2>
        </div>
      </div>
      <div className="groups-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'members'} className={`groups-tab${tab === 'members' ? ' is-on' : ''}`} onClick={() => setTab('members')}>
          Members ({membersOf(db, group.id).length})
        </button>
        <button type="button" role="tab" aria-selected={tab === 'add'} className={`groups-tab${tab === 'add' ? ' is-on' : ''}`} onClick={() => setTab('add')}>
          Add accounts
        </button>
      </div>

      {message.error ? <div className="form-error">{message.error}</div> : null}
      {message.notice ? <p className="meta groups-notice" data-testid="members-notice">{message.notice}</p> : null}

      {tab === 'members' ? (
        <>
          <input className="input" type="search" placeholder="Search members by name or address" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search members" />
          {members.length === 0 ? (
            <div className="card-empty">{search ? 'No member matches.' : 'No members yet. Use Add accounts.'}</div>
          ) : (
            <div className="table-wrap groups-table">
              <table className="table table-dense">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Type</th>
                    <th>Zone</th>
                    <th>Status</th>
                    <th>Invoices by</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.account.id}>
                      <td>
                        <Link to={`/office/account/${m.account.id}`} className="acct-name">{m.name}</Link>
                        <div className="meta">{m.address}</div>
                      </td>
                      <td>{kindLabel(m.kind)}</td>
                      <td>{m.zoneIds.map((z) => zoneName.get(z) ?? z).join(', ')}</td>
                      <td><span className={`pill pill-${m.account.status}`}>{STATUS_LABEL[m.account.status]}</span></td>
                      <td>
                        <select
                          className="select select-sm"
                          aria-label={`How ${m.name} gets invoices`}
                          value={m.account.deliveryMethod}
                          disabled={locked}
                          title={locked ? `${group.name} sends every invoice by ${DELIVERY_NAME[group.delivery].toLowerCase()}` : undefined}
                          onChange={(e) => attempt(() => void setInvoiceDelivery(m.account.id, e.target.value as InvoiceDelivery))}
                        >
                          {INVOICE_DELIVERIES.map((d) => (
                            <option key={d} value={d}>{DELIVERY_NAME[d]}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <button type="button" className="btn btn-tertiary btn-sm" onClick={() => attempt(() => {
                          assignBillingGroup(m.account.id, null);
                          return `${m.name} left ${group.name} and now bills on its own terms.`;
                        })}>
                          Take out
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="groups-filters">
            <Chips label="Zone" options={db.zones.map((z) => ({ id: z.id, label: z.name }))} value={filter.zoneIds} onChange={(zoneIds) => setF({ zoneIds })} />
            <Chips label="Customer type" options={CUSTOMER_TYPES} value={filter.kinds} onChange={(kinds) => setF({ kinds })} />
            <Chips label="Service" options={SERVICE_TYPES} value={filter.lobs} onChange={(lobs) => setF({ lobs })} />
            <Chips
              label="Route"
              options={db.routes.map((r) => ({ id: r.id, label: `${r.day} ${SERVICE_TYPES.find((s) => s.id === r.lob)?.label.toLowerCase() ?? r.lob}` }))}
              value={filter.routeIds}
              onChange={(routeIds) => setF({ routeIds })}
            />
            <div className="groups-filter-row">
              <label className="field">
                <span className="eyebrow">Currently in</span>
                <select className="select" value={filter.inGroup} onChange={(e) => setF({ inGroup: e.target.value })} aria-label="Currently in">
                  <option value="any">Any group or none</option>
                  <option value="none">Not in a group</option>
                  {db.billingGroups.filter((g) => g.id !== group.id).map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="eyebrow">Name or address</span>
                <input className="input" type="search" value={filter.search} onChange={(e) => setF({ search: e.target.value })} placeholder="Search" aria-label="Search accounts to add" />
              </label>
            </div>
          </div>

          <div className="groups-results-head">
            <strong data-testid="match-count">{plural(matches.length, 'account')} match</strong>
            {matches.length ? (
              <span className="cluster">
                <button type="button" className="btn btn-tertiary btn-sm" onClick={() => setUnchecked(new Set())}>Select all</button>
                <button type="button" className="btn btn-tertiary btn-sm" onClick={() => setUnchecked(new Set(matches.map((m) => m.account.id)))}>Select none</button>
              </span>
            ) : null}
          </div>
          {matches.length === 0 ? (
            <div className="card-empty">No account outside this group matches. Loosen a filter.</div>
          ) : (
            <div className="table-wrap groups-table">
              <table className="table table-dense">
                <thead>
                  <tr>
                    <th aria-label="Add" />
                    <th>Account</th>
                    <th>Type</th>
                    <th>Zone</th>
                    <th>Now in</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m) => (
                    <tr key={m.account.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Add ${m.name}`}
                          checked={!unchecked.has(m.account.id)}
                          onChange={() => setUnchecked((u) => {
                            const next = new Set(u);
                            if (next.has(m.account.id)) next.delete(m.account.id);
                            else next.add(m.account.id);
                            return next;
                          })}
                        />
                      </td>
                      <td>
                        {m.name}
                        <div className="meta">{m.address}</div>
                      </td>
                      <td>{kindLabel(m.kind)}</td>
                      <td>{m.zoneIds.map((z) => zoneName.get(z) ?? z).join(', ')}</td>
                      <td>{m.account.billingGroupId ? groupName.get(m.account.billingGroupId) : <span className="muted">No group ({CYCLE_LABEL[m.account.cycle]})</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="cluster">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={chosen.length === 0}
              onClick={() => attempt(() => {
                const r = addAccountsToBillingGroup(group.id, chosen.map((c) => c.account.id));
                setUnchecked(new Set());
                const parts = [`Added ${plural(r.added.length, 'account')} to ${group.name}.`];
                if (r.bridges.length) parts.push(`${plural(r.bridges.length, 'bridge charge')} proposed so no day goes unbilled; the next run lists them.`);
                if (r.skipped.length) parts.push(`${plural(r.skipped.length, 'account')} skipped: ${r.skipped[0].reason}.`);
                return parts.join(' ');
              })}
            >
              Add {plural(chosen.length, 'account')}
            </button>
            {moving ? <span className="meta">{plural(moving, 'account')} will move from another group.</span> : null}
          </div>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The editor: one group, or a new one
// ---------------------------------------------------------------------------------------------

function SaveBar({ draft, group, onSaved, onDiscard }: { draft: BillingGroupDraft; group?: BillingGroup; onSaved: (g: BillingGroup) => void; onDiscard: () => void }) {
  const db = useStore((s) => s.db);
  const saveBillingGroup = useStore((s) => s.saveBillingGroup);
  const [error, setError] = useState<string>();
  const preview = useMemo(() => {
    try {
      return { plan: planGroupSave(db, draft, group?.id) };
    } catch (err) {
      return { problem: errorText(err) };
    }
  }, [db, draft, group?.id]);
  const plan = preview.plan;
  const lines: string[] = [];
  if (plan && group) {
    if (plan.moved) lines.push(`${plural(plan.moved, 'account')} move to the new dates from their next bill.`);
    if (plan.bridges.length) lines.push(`${plural(plan.bridges.length, 'bridge charge')} (${money(plan.bridges.reduce((s, c) => s + c.totalCents, 0))}) proposed for days the move would leave unbilled.`);
    if (plan.deliveryChanged) lines.push(`${plural(plan.deliveryChanged, 'account')} switch to ${DELIVERY_NAME[draft.delivery].toLowerCase()}.`);
    if (plan.blocked.length) lines.push(`${plural(plan.blocked.length, 'member')} still have charges from the current run that are not posted. Post or cancel the run first.`);
  }

  return (
    <div className="groups-savebar" role="region" aria-label="Save changes" data-testid="save-bar">
      <div className="stack">
        <strong>{group ? 'Unsaved changes' : 'New group'}</strong>
        {preview.problem ? <span className="form-error">{preview.problem}</span> : null}
        {lines.map((l) => (
          <span key={l} className="meta">{l}</span>
        ))}
        {error ? <span className="form-error">{error}</span> : null}
      </div>
      <div className="cluster">
        <button type="button" className="btn btn-tertiary btn-sm" onClick={onDiscard}>
          {group ? 'Discard' : 'Cancel'}
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!plan || plan.blocked.length > 0}
          onClick={() => {
            setError(undefined);
            try {
              onSaved(saveBillingGroup(draft, group?.id));
            } catch (err) {
              setError(errorText(err));
            }
          }}
        >
          {group ? 'Save changes' : 'Create group'}
        </button>
      </div>
    </div>
  );
}

function GroupEditor({ group, onSelect, onClose }: { group?: BillingGroup; onSelect: (id: string) => void; onClose: () => void }) {
  const db = useStore((s) => s.db);
  const cycleDate = useStore((s) => s.cycleDate);
  const blank: BillingGroupDraft = { name: '', schedule: { frequency: 'monthly', every: 1, startDate: cycleDate }, termsDays: 15, delivery: 'email', customerChoice: true, note: '' };
  const saved = group ? draftOf(group) : blank;
  const [draft, setDraft] = useState<BillingGroupDraft>(saved);
  const [revision, setRevision] = useState(0);
  const set = (p: Partial<BillingGroupDraft>) => setDraft((d) => ({ ...d, ...p }));
  const dirty = !sameDraft(draft, saved);
  const members = group ? membersOf(db, group.id) : [];

  return (
    <div className="groups-editor">
      <section className="panel groups-header">
        <div className="groups-header-top">
          <div className="stack groups-name">
            <span className="eyebrow">{group ? 'Billing group' : 'New billing group'}</span>
            <input className="input groups-name-input" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Group name, e.g. HOA accounts" aria-label="Group name" />
            <input className="input" value={draft.note ?? ''} onChange={(e) => set({ note: e.target.value })} placeholder="Who belongs here (optional)" aria-label="Note" />
          </div>
          {group ? (
            <div className="groups-header-stats">
              <RemoveGroup group={group} onRemoved={onClose} />
              <div className="kv-item">
                <span className="eyebrow">Members</span>
                <span className="kv-value">{members.length}</span>
              </div>
              <div className="kv-item">
                <span className="eyebrow">Next bill</span>
                <span className="kv-value">{fmtDay(nextBillDates(groupCadence(group), cycleDate, 1)[0])}</span>
              </div>
            </div>
          ) : null}
        </div>
        {group ? <GroupCycle group={group} /> : null}
      </section>

      <DeliverySection draft={draft} set={set} mix={group ? deliveryMix(members) : undefined} />
      <ScheduleSection key={revision} draft={draft} set={set} from={cycleDate} />

      {dirty || !group ? (
        <SaveBar
          draft={draft}
          group={group}
          onDiscard={() => {
            if (!group) return onClose();
            setDraft(saved);
            setRevision((r) => r + 1);
          }}
          onSaved={(g) => {
            if (!group) onSelect(g.id);
            else setDraft(draftOf(g));
          }}
        />
      ) : null}

      {group ? (
        <MembersSection group={group} />
      ) : (
        <section className="panel groups-section groups-disabled">
          <div className="groups-section-head">
            <span className="groups-step">3</span>
            <div>
              <h2 className="card-title">Group Members</h2>
              <p className="meta">Create the group to add members.</p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function UngroupedTable() {
  const db = useStore((s) => s.db);
  const assignBillingGroup = useStore((s) => s.assignBillingGroup);
  const [error, setError] = useState<string>();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const zoneName = useMemo(() => new Map(db.zones.map((z) => [z.id, z.name])), [db.zones]);
  const all = useMemo(() => matchAccounts(accountFacts(db), { ...EMPTY_FILTER, inGroup: 'none' }), [db]);
  const shown = matchAccounts(all, { ...EMPTY_FILTER, search: q });
  const pages = Math.max(1, Math.ceil(shown.length / UNGROUPED_PAGE));
  const current = Math.min(page, pages - 1);
  const slice = shown.slice(current * UNGROUPED_PAGE, (current + 1) * UNGROUPED_PAGE);
  const kindLabel = (k?: string) => CUSTOMER_TYPES.find((c) => c.id === k)?.label ?? '';

  return (
    <section className="panel groups-section" aria-label="Customers not in a group">
      <div className="card-head">
        <h2 className="card-title">Customers not in a group</h2>
        <span className="card-note">{plural(all.length, 'account')}</span>
      </div>
      <p className="meta">These accounts bill on their own terms, such as net 30 contracts and per-job roll-off customers. Add one to a group to bill it with others.</p>
      {all.length > UNGROUPED_PAGE ? (
        <input className="input" type="search" placeholder="Search by name or address" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} aria-label="Search customers not in a group" />
      ) : null}
      {error ? <div className="form-error">{error}</div> : null}
      {shown.length === 0 ? (
        <div className="card-empty">{all.length ? 'No account matches.' : 'Every account is in a group.'}</div>
      ) : (
        <div className="table-wrap">
          <table className="table groups-grid-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Type</th>
                <th>Zone</th>
                <th>Bills</th>
                <th>Invoices by</th>
                <th>Add to a group</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((f) => (
                <tr key={f.account.id}>
                  <td>
                    <Link to={`/office/account/${f.account.id}`} className="acct-name">{f.name}</Link>
                    <div className="meta">{f.address}</div>
                  </td>
                  <td>{kindLabel(f.kind)}</td>
                  <td>{f.zoneIds.map((z) => zoneName.get(z) ?? z).join(', ')}</td>
                  <td>{CYCLE_LABEL[f.account.cycle]}</td>
                  <td>{DELIVERY_NAME[f.account.deliveryMethod]}</td>
                  <td>
                    <select
                      className="select select-sm"
                      aria-label={`Billing group for ${f.name}`}
                      value=""
                      onChange={(e) => {
                        setError(undefined);
                        try {
                          assignBillingGroup(f.account.id, e.target.value);
                        } catch (err) {
                          setError(errorText(err));
                        }
                      }}
                    >
                      <option value="">Choose a group</option>
                      {db.billingGroups.map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 ? (
        <div className="groups-pager">
          <span className="meta">{current * UNGROUPED_PAGE + 1} to {Math.min(shown.length, (current + 1) * UNGROUPED_PAGE)} of {shown.length}</span>
          <span className="cluster">
            <button type="button" className="btn btn-secondary btn-sm" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</button>
          </span>
        </div>
      ) : null}
    </section>
  );
}

/** Remove the group: pick where its members go, confirm, and return to the list. */
function RemoveGroup({ group, onRemoved }: { group: BillingGroup; onRemoved: () => void }) {
  const db = useStore((s) => s.db);
  const deleteBillingGroup = useStore((s) => s.deleteBillingGroup);
  const [open, setOpen] = useState(false);
  const [moveTo, setMoveTo] = useState('');
  const [error, setError] = useState<string>();
  const count = membersOf(db, group.id).length;
  if (!open) {
    return (
      <button type="button" className="btn btn-tertiary btn-sm groups-remove" onClick={() => setOpen(true)}>
        Remove group
      </button>
    );
  }
  return (
    <div className="groups-confirm" role="dialog" aria-label={`Remove ${group.name}`}>
      <strong>Remove {group.name}?</strong>
      {count > 0 ? (
        <label className="field">
          <span className="eyebrow">Move its {plural(count, 'account')} to</span>
          <select className="select" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Move members to">
            <option value="">Not in a group (they keep their cycle)</option>
            {db.billingGroups.filter((g) => g.id !== group.id).map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </label>
      ) : (
        <span className="meta">The group has no members.</span>
      )}
      <span className="meta">No invoice, charge, or payment is removed. A move that leaves days unbilled proposes a bridge charge for review.</span>
      {error ? <div className="form-error">{error}</div> : null}
      <div className="cluster">
        <button
          type="button"
          className="btn btn-danger btn-sm"
          onClick={() => {
            setError(undefined);
            try {
              deleteBillingGroup(group.id, moveTo || null);
              onRemoved();
            } catch (err) {
              setError(errorText(err));
            }
          }}
        >
          Remove group
        </button>
        <button type="button" className="btn btn-tertiary btn-sm" onClick={() => setOpen(false)}>
          Keep it
        </button>
      </div>
    </div>
  );
}

export default function BillingGroupsPage() {
  const groups = useStore((s) => s.db.billingGroups);
  const [params, setParams] = useSearchParams();
  const requested = params.get('group');
  const group = groups.find((g) => g.id === requested);
  const open = (id: string | null) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (id) next.set('group', id);
    else next.delete('group');
    return next;
  });

  if (requested === NEW || group) {
    return (
      <div className="page groups-page">
        <button type="button" className="rail-back groups-back" onClick={() => open(null)}>
          ← All billing groups
        </button>
        <GroupEditor key={requested} group={group} onSelect={(id) => open(id === NEW ? NEW : id)} onClose={() => open(null)} />
      </div>
    );
  }

  return (
    <div className="page groups-page">
      <div className="page-head">
        <div className="stack">
          <div className="eyebrow">Office · Billing groups</div>
          <h1 className="page-title">Billing groups</h1>
          <p className="page-subtitle">Customers billed together: how their invoices go out, how often they&apos;re billed, and who&apos;s in each group. Click a group to manage it.</p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => open(NEW)}>
          New group
        </button>
      </div>
      <GroupsTable onOpen={(id) => open(id)} />
      <UngroupedTable />
    </div>
  );
}
