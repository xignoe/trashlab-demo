// The office manager's accounts table at /office/account: every account as one row, filling the viewport.
// Rows are windowed (only the visible slice plus an overscan is in the DOM), so thousands of accounts scroll smoothly.
// Search, the status filter, and the sort run over the flat rows from buildAccountRows. A row opens the account's own
// page at /office/account/:accountId, where the four actions live.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type UIEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { CYCLE_LABEL, PARTY_KIND_LABEL, STATUS_LABEL, fmtDate, money } from '../components/format';
import { ROUTE_DAY_LONG, useAccountRows, type AccountRow } from '../selectors';
import type { BillingAccount } from '../../../types';
import { CycleBanner } from '../../billing/components/CycleBanner';
import { CycleButton } from '../components/CycleButton';
import { AddAccountDrawer } from '../components/AddAccountDrawer';
import { Toast, type ToastMessage } from '../components/Toast';
import { useReviewCounts } from '../../billing/components/useBillingData';

const ROW_HEIGHT = 40;
const OVERSCAN = 12;

type SortKey = 'reviewCount' | 'name' | 'id' | 'kind' | 'address' | 'routeDay' | 'serviceCount' | 'cycle' | 'autopay' | 'status' | 'openItems' | 'lastPaymentAt' | 'monthlyRevenueCents' | 'daysLate' | 'pastDueCents' | 'balanceCents';
type SortDir = 'asc' | 'desc';
/** The status chips: the four BillingAccount statuses plus Closed, which is suspended with every line ended. */
type StatusFilter = 'all' | BillingAccount['status'] | 'closed';
/** An account row plus its charges waiting on a decision in the current billing cycle. */
type Row = AccountRow & { reviewCount: number };

interface Column {
  key: SortKey;
  label: string;
  /** Fixed pixel width; the two text columns without one share what is left. */
  width?: string;
  /** Header tooltip, for a column whose label needs a definition. */
  title?: string;
  numeric?: boolean;
  /** First click sorts this way; money and counts start with the largest. */
  firstDir?: SortDir;
  render: (row: Row) => ReactNode;
}

const DAY_ORDER: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5 };
const STATUS_ORDER: Record<BillingAccount['status'], number> = { pastDue: 0, suspended: 1, hold: 2, active: 3 };
const STATUS_FILTERS: StatusFilter[] = ['all', 'pastDue', 'suspended', 'hold', 'closed', 'active'];
const FILTER_LABEL = (s: StatusFilter): string => (s === 'all' ? 'All' : s === 'closed' ? 'Closed' : STATUS_LABEL[s]);
/** Which chip a row is counted under: a closed account is Closed, not Suspended. */
const filterOf = (row: Row): Exclude<StatusFilter, 'all'> => (row.isClosed ? 'closed' : row.status);

const COLUMNS: Column[] = [
  { key: 'name', label: 'Account', render: (r) => <span className="acct-name" title={r.name}>{r.name}</span> },
  { key: 'id', label: 'Id', width: '118px', render: (r) => <span className="serial">{r.id}</span> },
  { key: 'kind', label: 'Type', width: '92px', render: (r) => (r.kind ? PARTY_KIND_LABEL[r.kind] : '') },
  {
    key: 'address',
    label: 'Address',
    render: (r) => (
      <span title={r.address}>
        {r.address ?? <span className="muted">No site</span>}
        {r.siteCount > 1 && <span className="muted"> +{r.siteCount - 1}</span>}
      </span>
    ),
  },
  { key: 'routeDay', label: 'Route', width: '64px', render: (r) => (r.routeDay ? <span title={`${ROUTE_DAY_LONG[r.routeDay]} route`}>{r.routeDay}</span> : <span className="muted">None</span>) },
  { key: 'serviceCount', label: 'Services', width: '88px', numeric: true, firstDir: 'desc', render: (r) => r.serviceCount },
  { key: 'cycle', label: 'Cycle', width: '76px', render: (r) => CYCLE_LABEL[r.cycle] },
  { key: 'autopay', label: 'Autopay', width: '80px', render: (r) => (r.autopay ? 'On' : <span className="muted">Off</span>) },
  {
    key: 'status',
    label: 'Status',
    width: '108px',
    render: (r) => (r.isClosed ? <span className="pill" title="Suspended with every service line ended">Closed</span> : <span className={`pill pill-${r.status}`}>{STATUS_LABEL[r.status]}</span>),
  },
  {
    key: 'reviewCount',
    label: 'Review',
    width: '76px',
    numeric: true,
    firstDir: 'desc',
    title: 'Charges from the current billing cycle waiting on a decision. Open the account to approve, edit, or waive them.',
    render: (r) => (r.reviewCount ? <span className="pill pill-hold">{r.reviewCount}</span> : <span className="muted">0</span>),
  },
  { key: 'openItems', label: 'Open', width: '60px', numeric: true, firstDir: 'desc', render: (r) => (r.openItems ? r.openItems : <span className="muted">0</span>) },
  { key: 'lastPaymentAt', label: 'Last paid', width: '92px', firstDir: 'desc', render: (r) => (r.lastPaymentAt ? fmtDate(r.lastPaymentAt) : <span className="muted">Never</span>) },
  {
    key: 'monthlyRevenueCents',
    label: 'Revenue / mo',
    width: '120px',
    numeric: true,
    firstDir: 'desc',
    title: 'Monthly recurring revenue: active service lines at today\'s price x quantity, before fees and tax. Suspended accounts and on-call roll-off hauls count as $0.',
    render: (r) =>
      r.unpricedLines > 0 ? (
        <span title={`${r.unpricedLines} ${r.unpricedLines === 1 ? 'line has' : 'lines have'} no published price and ${r.unpricedLines === 1 ? 'is' : 'are'} not counted`}>
          {money(r.monthlyRevenueCents)}<span className="danger-text">*</span>
        </span>
      ) : r.monthlyRevenueCents > 0 ? (
        money(r.monthlyRevenueCents)
      ) : (
        <span className="muted">{money(0)}</span>
      ),
  },
  { key: 'daysLate', label: 'Days late', width: '96px', numeric: true, firstDir: 'desc', render: (r) => (r.daysLate ? <span className="danger-text">{r.daysLate}</span> : <span className="muted">0</span>) },
  { key: 'pastDueCents', label: 'Past due', width: '92px', numeric: true, firstDir: 'desc', render: (r) => (r.pastDueCents > 0 ? <span className="danger-text">{money(r.pastDueCents)}</span> : <span className="muted">{money(r.pastDueCents)}</span>) },
  { key: 'balanceCents', label: 'Balance', width: '96px', numeric: true, firstDir: 'desc', render: (r) => money(r.balanceCents) },
];

function sortValue(row: Row, key: SortKey): string | number {
  switch (key) {
    case 'routeDay': return row.routeDay ? DAY_ORDER[row.routeDay] : 99;
    case 'status': return row.isClosed ? 4 : STATUS_ORDER[row.status];
    case 'autopay': return row.autopay ? 1 : 0;
    case 'kind': return row.kind ? PARTY_KIND_LABEL[row.kind] : '';
    case 'address': return row.address ?? '';
    case 'lastPaymentAt': return row.lastPaymentAt ?? '';
    default: return row[key];
  }
}

function compareRows(key: SortKey, dir: SortDir) {
  const sign = dir === 'asc' ? 1 : -1;
  return (a: Row, b: Row) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
    // Name breaks ties so equal values keep a stable, readable order.
    return c !== 0 ? c * sign : a.name.localeCompare(b.name);
  };
}

/**
 * Scale testing: /office/account?sample=5000 pads the table with that many sample rows cloned from the real ones.
 * They are labelled, never linked, and never written to the store.
 */
function withSampleRows(rows: Row[], count: number): Row[] {
  if (!count || rows.length === 0) return rows;
  const out = rows.slice();
  for (let i = 0; i < count; i += 1) {
    const base = rows[i % rows.length];
    const n = String(i + 1).padStart(5, '0');
    const id = `sample_${n}`;
    out.push({ ...base, id, name: `${base.name} ${n}`, haystack: `${base.name} ${n} ${id} ${base.address ?? ''}`.toLowerCase() });
  }
  return out;
}

export function AccountsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<ToastMessage | undefined>();
  const toastSeq = useRef(0);
  const showToast = (title: string, detail?: string) => {
    toastSeq.current += 1;
    setToast({ key: toastSeq.current, title, detail });
  };
  // A delete on an account's own page sends its confirmation here, since that page is gone.
  const handedOver = (location.state as { toast?: { title: string; detail: string } } | null)?.toast;
  useEffect(() => {
    if (!handedOver) return;
    showToast(handedOver.title, handedOver.detail);
    navigate(location.pathname + location.search, { replace: true, state: null });
    // The handed-over toast is shown once, when it arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handedOver]);
  const sample = Math.min(50000, Math.max(0, Number(params.get('sample')) || 0));
  const accountRows = useAccountRows();
  const reviewCounts = useReviewCounts();
  const realRows = useMemo<Row[]>(() => accountRows.map((r) => ({ ...r, reviewCount: reviewCounts.get(r.id) ?? 0 })), [accountRows, reviewCounts]);
  const allRows = useMemo(() => withSampleRows(realRows, sample), [realRows, sample]);

  const query = params.get('q') ?? '';
  const status = (params.get('status') as StatusFilter | null) ?? 'all';
  const reviewOnly = params.get('review') === '1';
  const sortKey = (params.get('sort') as SortKey | null) ?? 'name';
  const sortDir = (params.get('dir') as SortDir | null) ?? 'asc';

  // Filters live in the URL so the back button from an account returns to the same slice.
  const setParam = (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined || v === '') next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  // Each chip counts what clicking it would show given the other filters: the status chips count within To review and
  // the search, and To review counts within the chosen status and the search.
  const { statusCounts, toReview, anyToReview } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const counts: Record<StatusFilter, number> = { all: 0, active: 0, pastDue: 0, suspended: 0, hold: 0, closed: 0 };
    let review = 0;
    let anyReview = false;
    for (const r of allRows) {
      if (r.reviewCount > 0) anyReview = true;
      if (q && !r.haystack.includes(q)) continue;
      if (!reviewOnly || r.reviewCount > 0) {
        counts.all += 1;
        counts[filterOf(r)] += 1;
      }
      if (r.reviewCount > 0 && (status === 'all' || filterOf(r) === status)) review += 1;
    }
    return { statusCounts: counts, toReview: review, anyToReview: anyReview };
  }, [allRows, query, status, reviewOnly]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = allRows.filter((r) => (status === 'all' || filterOf(r) === status) && (!reviewOnly || r.reviewCount > 0) && (!q || r.haystack.includes(q)));
    return filtered.sort(compareRows(sortKey, sortDir));
  }, [allRows, query, status, reviewOnly, sortKey, sortDir]);

  const totals = useMemo(() => {
    let balance = 0;
    let pastDue = 0;
    let revenue = 0;
    for (const r of rows) {
      balance += r.balanceCents;
      pastDue += r.pastDueCents;
      revenue += r.monthlyRevenueCents;
    }
    return { balance, pastDue, revenue };
  }, [rows]);

  // Windowing: the scroller's height and scroll position decide which slice of rows is in the DOM.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(800);
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight || 800);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // A new filter or sort starts at the top.
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [query, status, reviewOnly, sortKey, sortDir]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);
  const visible = rows.slice(first, last);

  const onSort = (col: Column) => {
    if (col.key === sortKey) setParam({ dir: sortDir === 'asc' ? 'desc' : 'asc' });
    else setParam({ sort: col.key, dir: col.firstDir ?? 'asc' });
  };

  const open = (row: Row) => {
    if (!row.id.startsWith('sample_')) navigate(`/office/account/${row.id}`);
  };
  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, row: Row) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open(row);
    }
  };

  return (
    <div className="accounts-page">
      <div className="accounts-head">
        <div className="stack">
          <div className="eyebrow">Office · Accounts</div>
          <div className="accounts-title-row">
            <h1 className="page-title">Accounts</h1>
            <CycleButton
              onRan={() => setParam({ review: '1', sort: 'reviewCount', dir: 'desc' })}
              onCancelled={() => setParam({ review: undefined, sort: undefined, dir: undefined })}
            />
          </div>
        </div>
        <div className="accounts-tools">
          {(anyToReview || reviewOnly) && (
            <button
              type="button"
              className={`filter-chip${reviewOnly ? ' filter-chip-on' : ''}`}
              aria-pressed={reviewOnly}
              title="Accounts with charges from the current billing cycle waiting on a decision"
              onClick={() => setParam({ review: reviewOnly ? undefined : '1' })}
            >
              To review
              <span className="filter-chip-count">{toReview.toLocaleString('en-US')}</span>
            </button>
          )}
          <div className="accounts-filters" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                className={`filter-chip${status === s ? ' filter-chip-on' : ''}`}
                aria-pressed={status === s}
                onClick={() => setParam({ status: s === 'all' ? undefined : s })}
              >
                {FILTER_LABEL(s)}
                <span className="filter-chip-count">{statusCounts[s].toLocaleString('en-US')}</span>
              </button>
            ))}
          </div>
          <input
            className="input accounts-search"
            type="search"
            placeholder="Search name, id, address, or PO"
            aria-label="Search accounts"
            value={query}
            onChange={(e) => setParam({ q: e.target.value })}
            autoComplete="off"
          />
        </div>
      </div>

      <CycleBanner reviewHref="/office/account?review=1&sort=reviewCount&dir=desc" />

      {sample > 0 && (
        <div className="accounts-sample-note">
          Includes {sample.toLocaleString('en-US')} sample rows for scale testing. Sample rows do not open. Remove <code className="code">?sample</code> from the address to hide them.
        </div>
      )}

      <div className="accounts-card">
        <div
          className="accounts-scroller"
          ref={scrollerRef}
          onScroll={(e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <table className="table accounts-table" aria-rowcount={rows.length + 1}>
            <colgroup>
              {COLUMNS.map((c) => (
                <col key={c.key} style={c.width ? { width: c.width } : undefined} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {COLUMNS.map((c) => {
                  const active = c.key === sortKey;
                  return (
                    <th
                      key={c.key}
                      className={c.numeric ? 'money' : undefined}
                      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      title={c.title}
                    >
                      <button type="button" className={`sort-btn${active ? ' sort-btn-on' : ''}`} onClick={() => onSort(c)}>
                        {c.label}
                        {active && <span className="sort-arrow" aria-hidden="true">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {first > 0 && (
                <tr className="spacer" aria-hidden="true">
                  <td colSpan={COLUMNS.length} style={{ height: first * ROW_HEIGHT }} />
                </tr>
              )}
              {visible.map((row, i) => (
                <tr
                  key={row.id}
                  className={`accounts-row${row.id.startsWith('sample_') ? ' accounts-row-sample' : ''}`}
                  tabIndex={0}
                  aria-rowindex={first + i + 2}
                  onClick={() => open(row)}
                  onKeyDown={(e) => onRowKey(e, row)}
                >
                  {COLUMNS.map((c) => (
                    <td key={c.key} className={c.numeric ? 'money' : undefined}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
              {last < rows.length && (
                <tr className="spacer" aria-hidden="true">
                  <td colSpan={COLUMNS.length} style={{ height: (rows.length - last) * ROW_HEIGHT }} />
                </tr>
              )}
            </tbody>
          </table>
          {rows.length === 0 && <div className="card-empty accounts-empty">No accounts match.</div>}
        </div>
        <div className="accounts-foot">
          <span className="accounts-foot-left">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)} aria-haspopup="dialog">Add account</button>
            <span>
              {rows.length === allRows.length
                ? `${rows.length.toLocaleString('en-US')} accounts`
                : `${rows.length.toLocaleString('en-US')} of ${allRows.length.toLocaleString('en-US')} accounts`}
            </span>
          </span>
          <span className="accounts-foot-totals">
            <span>Revenue / mo <span className="mono">{money(totals.revenue)}</span></span>
            <span>Past due <span className={`mono${totals.pastDue > 0 ? ' danger-text' : ''}`}>{money(totals.pastDue)}</span></span>
            <span>Balance <span className="mono">{money(totals.balance)}</span></span>
          </span>
        </div>
      </div>
      <div id="drawer-root" className="drawer-root" />
      {adding && (
        <AddAccountDrawer
          onClose={() => setAdding(false)}
          onDone={(result) => {
            setAdding(false);
            // The new account's own page opens straight away, and shows the confirmation there.
            navigate(`/office/account/${result.accountId}`, { state: { toast: { title: result.title, detail: result.detail } } });
          }}
        />
      )}
      <Toast toast={toast} onDismiss={() => setToast(undefined)} />
    </div>
  );
}

export default AccountsPage;
