// Store inspector (the "Store" tab beside Office approvals, also #store). The proof view: every record this
// session created (id not in seed), table by table, each row expandable to its raw JSON, plus seed records
// a transaction changed (a held quote approved, a route that gained a stop). "Reset to seed" puts the
// data store back and clears the session's receipts. Everything shown is read from the live store.
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { formatCents } from '../store/money';
import { buildSeedTables, SEED_IDS, useStore, type Keyed, type StoreTables } from '../store/store';
import { useUi } from '../store/ui';
import type { BillingAccount, Charge, Party, Payment, Quote, ServiceItem, Site, WorkOrder } from '../types';
import { cx, DangerButton, Pill, SecondaryButton } from './components';

/** One column: a header and how to render a row's cell. */
interface Column<T> {
  label: string;
  cell(row: T): ReactNode;
  /** Right-align numbers. */
  num?: boolean;
}

interface TableSpec<T> {
  key: keyof StoreTables;
  title: string;
  /** What the table proves, in one line. */
  blurb: string;
  columns: Column<T>[];
}

const code = (s: string | undefined) => (s ? <span className="break-all">{s}</span> : <span className="text-ink-muted">none</span>);
const cents = (n: number) => <span className="tabular-nums">{formatCents(n)}</span>;

const PARTIES: TableSpec<Party> = {
  key: 'parties',
  title: 'Parties',
  blurb: 'The person who pays, one per signup.',
  columns: [
    { label: 'id', cell: (r) => code(r.id) },
    { label: 'kind', cell: (r) => r.kind },
    { label: 'name', cell: (r) => r.name },
  ],
};

const ACCOUNTS: TableSpec<BillingAccount> = {
  key: 'accounts',
  title: 'Billing accounts',
  blurb: 'Quarterly, billed in advance, card on file.',
  columns: [
    { label: 'id', cell: (r) => code(r.id) },
    { label: 'payer', cell: (r) => code(r.payerPartyId) },
    { label: 'cycle', cell: (r) => `${r.cycle}${r.billedInAdvance ? ', in advance' : ''}` },
    { label: 'autopay', cell: (r) => (r.autopay ? 'on' : 'off') },
    { label: 'method', cell: (r) => r.paymentMethodOnFile ?? 'none' },
    { label: 'status', cell: (r) => r.status },
  ],
};

const SITES: TableSpec<Site> = {
  key: 'sites',
  title: 'Sites',
  blurb: 'Where the cart goes, on a zone and a route.',
  columns: [
    { label: 'id', cell: (r) => code(r.id) },
    { label: 'account', cell: (r) => code(r.accountId) },
    { label: 'address', cell: (r) => r.address },
    { label: 'zone', cell: (r) => code(r.zoneId) },
    { label: 'route', cell: (r) => code(r.routeId) },
  ],
};

const SERVICE_ITEMS: TableSpec<ServiceItem> = {
  key: 'serviceItems',
  title: 'Service items',
  blurb: 'One per selected line: cart, extra cart, recycling.',
  columns: [
    { label: 'id', cell: (r) => code(r.id) },
    { label: 'site', cell: (r) => code(r.siteId) },
    { label: 'catalog', cell: (r) => code(r.catalogId) },
    { label: 'frequency', cell: (r) => r.frequency },
    { label: 'from', cell: (r) => r.effectiveFrom },
    { label: 'status', cell: (r) => r.status },
  ],
};

const WORK_ORDERS: TableSpec<WorkOrder> = {
  key: 'workOrders',
  title: 'Work orders',
  blurb: 'One cart delivery per service item, the day before the first pickup.',
  columns: [
    { label: 'id', cell: (r) => code(r.id) },
    { label: 'kind', cell: (r) => r.kind },
    { label: 'site', cell: (r) => code(r.siteId) },
    { label: 'service item', cell: (r) => code(r.serviceItemId) },
    { label: 'scheduled for', cell: (r) => r.scheduledFor },
    { label: 'status', cell: (r) => r.status },
  ],
};

const QUOTES: TableSpec<Quote> = {
  key: 'quotes',
  title: 'Quotes',
  blurb: 'Held boundary signups and commercial requests.',
  columns: [
    { label: 'id', cell: (r) => code(r.id) },
    { label: 'kind', cell: (r) => r.kind },
    { label: 'status', cell: (r) => r.status },
    { label: 'zone', cell: (r) => code(r.zoneId) },
    { label: 'due today', cell: (r) => cents(r.dueTodayCents), num: true },
    { label: 'recurring', cell: (r) => cents(r.recurringCents), num: true },
    { label: 'hold deadline', cell: (r) => r.holdDeadline ?? 'none' },
  ],
};

const PAYMENTS: TableSpec<Payment> = {
  key: 'payments',
  title: 'Payments',
  blurb: 'Settled card payments for due today. A declined card writes none.',
  columns: [
    { label: 'id', cell: (r) => code(r.id) },
    { label: 'account', cell: (r) => code(r.accountId) },
    { label: 'method', cell: (r) => r.method },
    { label: 'status', cell: (r) => r.status },
    { label: 'cents', cell: (r) => cents(r.cents), num: true },
    { label: 'received', cell: (r) => r.receivedAt },
  ],
};

/** Invariant 2: every charge carries its base, fees, tax, total, source, and the pricing rule that won. */
const CHARGES: TableSpec<Charge> = {
  key: 'charges',
  title: 'Charges',
  blurb: 'First-quarter lines and cart delivery, approved, not posted. Each shows how it was priced.',
  columns: [
    { label: 'id', cell: (r) => code(r.id) },
    { label: 'lineType', cell: (r) => r.lineType },
    { label: 'baseCents', cell: (r) => cents(r.baseCents), num: true },
    {
      label: 'fees',
      cell: (r) =>
        r.fees.length ? (
          <span className="flex flex-col">
            {r.fees.map((f) => (
              <span key={f.feeRuleId} className="whitespace-nowrap">
                {f.feeRuleId} {formatCents(f.cents)}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-ink-muted">none</span>
        ),
    },
    { label: 'taxCents', cell: (r) => cents(r.taxCents), num: true },
    { label: 'totalCents', cell: (r) => <strong className="font-semibold tabular-nums">{formatCents(r.totalCents)}</strong>, num: true },
    { label: 'source', cell: (r) => code(`${r.source.type}:${r.source.id}`) },
    {
      label: 'pricing.ruleWon',
      cell: (r) => (
        <span className="flex flex-col">
          <span>{r.pricing.ruleWon}</span>
          {r.pricing.rateVersionId || r.pricing.contractId ? (
            <span className="break-all text-ink-muted">{r.pricing.rateVersionId ?? r.pricing.contractId}</span>
          ) : null}
        </span>
      ),
    },
    { label: 'status', cell: (r) => r.status },
  ],
};

// The eight tables the proof asks for, in the order a signup writes them.
const TABLES = [PARTIES, ACCOUNTS, SITES, SERVICE_ITEMS, WORK_ORDERS, QUOTES, PAYMENTS, CHARGES] as TableSpec<{ id: string }>[];

/** Seed tables a storefront transaction can modify in place (approve or decline a quote, add a route stop). */
const WATCHED_SEED_TABLES: (keyof StoreTables)[] = ['quotes', 'quoteIntake', 'routes', 'accounts', 'sites'];

const SEED_SNAPSHOT = buildSeedTables();

function createdThisSession<T>(table: Keyed<T>): [string, T][] {
  return Object.entries(table).filter(([id]) => !SEED_IDS.has(id));
}

function RawJson({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[360px] overflow-auto rounded bg-gray-100 p-3 text-small leading-[18px] text-ink">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function RecordTable<T extends { id: string }>({ spec, rows }: { spec: TableSpec<T>; rows: T[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const colSpan = spec.columns.length + 1;

  return (
    <section className="flex flex-col gap-2" aria-labelledby={`store-${spec.key}`} data-testid={`store-table-${spec.key}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={`store-${spec.key}`} className="text-body font-semibold text-ink">
          {spec.title} <span className="font-regular text-ink-muted">({rows.length})</span>
        </h2>
        <p className="text-small text-ink-muted">{spec.blurb}</p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded border border-line bg-surface px-4 py-3 text-small text-ink-muted">None created this session.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full border-collapse text-left text-small">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="w-[72px] px-3 py-2 font-semibold text-ink-muted">
                  <span className="sr-only">Raw JSON</span>
                </th>
                {spec.columns.map((c) => (
                  <th key={c.label} scope="col" className={cx('whitespace-nowrap px-3 py-2 font-semibold text-ink-muted', c.num && 'text-right')}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.id}>
                  <tr className="border-b border-gray-100 align-top last:border-b-0">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => toggle(row.id)}
                        aria-expanded={!!open[row.id]}
                        aria-label={`${open[row.id] ? 'Hide' : 'Show'} raw JSON for ${row.id}`}
                        className="rounded px-2 py-[2px] font-medium text-accent underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {open[row.id] ? 'Hide' : 'JSON'}
                      </button>
                    </td>
                    {spec.columns.map((c) => (
                      <td key={c.label} className={cx('px-3 py-2 text-ink', c.num && 'text-right')}>
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                  {open[row.id] ? (
                    <tr className="border-b border-gray-100 last:border-b-0">
                      <td colSpan={colSpan} className="px-3 pb-3">
                        <RawJson value={row} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

interface SeedChange {
  table: string;
  id: string;
  fields: string[];
  before: unknown;
  after: unknown;
}

function changedSeedRecords(tables: StoreTables): SeedChange[] {
  const out: SeedChange[] = [];
  for (const key of WATCHED_SEED_TABLES) {
    const seedTable = SEED_SNAPSHOT[key] as unknown as Keyed<Record<string, unknown>>;
    const liveTable = tables[key] as unknown as Keyed<Record<string, unknown>>;
    for (const [id, before] of Object.entries(seedTable)) {
      const after = liveTable[id];
      if (!after || JSON.stringify(before) === JSON.stringify(after)) continue;
      const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
        (f) => JSON.stringify(before[f]) !== JSON.stringify(after[f]),
      );
      out.push({ table: key, id, fields, before, after });
    }
  }
  return out;
}

function SeedChanges({ changes }: { changes: SeedChange[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <section className="flex flex-col gap-2" aria-labelledby="store-seed-changes" data-testid="store-seed-changes">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="store-seed-changes" className="text-body font-semibold text-ink">
          Seed records changed <span className="font-regular text-ink-muted">({changes.length})</span>
        </h2>
        <p className="text-small text-ink-muted">A seed quote approved or declined, a route that gained a stop.</p>
      </div>
      {changes.length === 0 ? (
        <p className="rounded border border-line bg-surface px-4 py-3 text-small text-ink-muted">No seed record has changed.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {changes.map((c) => {
            const k = `${c.table}:${c.id}`;
            return (
              <li key={k} className="rounded-lg border border-line bg-surface px-3 py-2 text-small">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-ink">
                    <span className="text-ink-muted">{c.table}</span> <span className="break-all font-semibold">{c.id}</span>: {c.fields.join(', ')}
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpen((o) => ({ ...o, [k]: !o[k] }))}
                    aria-expanded={!!open[k]}
                    className="rounded px-2 py-[2px] font-medium text-accent underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {open[k] ? 'Hide' : 'Before and after'}
                  </button>
                </div>
                {open[k] ? (
                  <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                    <div>
                      <p className="mb-1 text-ink-muted">Seed</p>
                      <RawJson value={Object.fromEntries(c.fields.map((f) => [f, (c.before as Record<string, unknown>)[f]]))} />
                    </div>
                    <div>
                      <p className="mb-1 text-ink-muted">Now</p>
                      <RawJson value={Object.fromEntries(c.fields.map((f) => [f, (c.after as Record<string, unknown>)[f]]))} />
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function StoreInspector() {
  const tables = useStore();
  const clearSession = useUi((s) => s.clearSession);
  const [confirming, setConfirming] = useState(false);

  const rowsByTable = useMemo(
    () => TABLES.map((spec) => ({ spec, rows: createdThisSession(tables[spec.key] as Keyed<{ id: string }>).map(([, r]) => r) })),
    [tables],
  );
  const changes = useMemo(() => changedSeedRecords(tables), [tables]);
  const created = rowsByTable.reduce((n, t) => n + t.rows.length, 0);
  const tokens = createdThisSession(tables.paymentTokens).length;
  const intakes = createdThisSession(tables.quoteIntake).length;

  function reset() {
    tables.reset();
    clearSession();
    setConfirming(false);
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={created ? 'accent' : 'neutral'}>{created} records created this session</Pill>
            {changes.length ? <Pill tone="warning">{changes.length} seed records changed</Pill> : null}
          </div>
          <p className="text-small text-ink-muted">
            Created records have ids with <code className="rounded bg-gray-100 px-1">_sf_</code> in them. Also stored this session:{' '}
            {intakes} intake {intakes === 1 ? 'row' : 'rows'} and {tokens} card {tokens === 1 ? 'token' : 'tokens'} (brand, last 4, and expiry only).
            The store lives in this tab's memory, so a reload also returns to seed.
          </p>
        </div>
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-small text-ink">Remove every record made this session?</span>
            <DangerButton size="compact" onClick={reset}>Reset to seed</DangerButton>
            <SecondaryButton size="compact" onClick={() => setConfirming(false)}>
              Cancel
            </SecondaryButton>
          </div>
        ) : (
          <SecondaryButton size="compact" onClick={() => setConfirming(true)}>
            Reset to seed
          </SecondaryButton>
        )}
      </div>

      <SeedChanges changes={changes} />

      {rowsByTable.map(({ spec, rows }) => (
        <RecordTable key={spec.key} spec={spec} rows={rows} />
      ))}
    </div>
  );
}
