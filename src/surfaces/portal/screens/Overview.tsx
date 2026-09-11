import { usePortal } from '../store';
import {
  accountBalance, eventsForSite, holdsForSite, openItemsForAccount, pendingChangesForSite, routeForSite,
  serviceItemsInPeriod, sitesForAccount,
} from '../lib/selectors';
import {
  PREVIEW_CHARGE_ID, computeCharge, frequencyLabel, monthsInCycle, nextCycleStart, nextInvoicePeriod, resolvePrice,
} from '../lib/engine';
import { today, addDays, formatDate, formatDateTime, formatDayLong, nextRouteDay } from '../lib/clock';
import { resolvePhoto } from '../../../seed';
import { money } from '../lib/money';
import { AccountStatusPill, OutcomePill, ServiceItemStatusPill } from '../components/StatusPill';
import type { Charge } from '../../../types';
import { InvariantsPanel } from '../components/InvariantsPanel';

const RECENT_DAYS = 28;

function eventWhen(date: string): string {
  // Events with no service time are seeded at T00:00:00; show the day alone rather than a fake midnight.
  return date.length > 10 && date.slice(11, 16) !== '00:00' ? formatDateTime(date) : formatDayLong(date);
}

export function Overview() {
  const state = usePortal();
  const { accountId, siteId } = state.session;
  const account = state.accounts.find((a) => a.id === accountId)!;
  const party = state.parties.find((p) => p.id === account.payerPartyId);
  const site = state.sites.find((s) => s.id === siteId)!;
  const siteCount = sitesForAccount(state, accountId).length;
  const route = routeForSite(state, siteId);
  const balance = accountBalance(state, accountId);
  const openItems = openItemsForAccount(state, accountId);
  const nextPickup = route ? nextRouteDay(route.day, today()) : undefined;

  const period = nextInvoicePeriod(account, today(), state.billingGroups);
  const items = serviceItemsInPeriod(state, siteId, period);
  const holds = holdsForSite(state, siteId).filter((h) => h.end >= today());
  const hold = holds.length ? holds.reduce((a, b) => (a.start <= b.start ? a : b)) : undefined;
  const resumes = hold && route ? nextRouteDay(route.day, hold.end) : hold ? addDays(hold.end, 1) : undefined;
  const pending = pendingChangesForSite(state, siteId);
  const months = monthsInCycle(account, state.billingGroups);
  const issuedOn = nextCycleStart(account, today(), state.billingGroups);

  const lines = items.map((item) => {
    // A pending cart change (proposeCartChange) bills the new size once it is effective for the estimated period.
    const change = pending.find((p) => p.serviceItemId === item.id && p.effectiveFrom <= period.start);
    const catalogId = change?.toCatalogId ?? item.catalogId;
    const catalog = state.catalog.find((c) => c.id === catalogId);
    const serials = item.containerIds
      .map((id) => state.containers.find((c) => c.id === id)?.serial)
      .filter((s): s is string => Boolean(s));
    let price: ReturnType<typeof resolvePrice> | undefined;
    let estimate: Charge | undefined;
    let error: string | undefined;
    try {
      price = resolvePrice({
        catalogId, frequency: item.frequency, zoneId: site.zoneId, accountId, onDate: period.start,
      });
      if (item.status === 'active' && months > 0) {
        estimate = computeCharge({
          id: PREVIEW_CHARGE_ID, accountId, siteId, lineType: 'recurring', baseCents: price.priceCents * months * item.qty,
          period, source: { type: 'serviceItem', id: item.id }, catalogId, frequency: item.frequency,
        });
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    return { item, catalog, change, serials, price, estimate, error };
  });

  const estimateTotals = lines.reduce(
    (acc, l) => {
      if (!l.estimate) return acc;
      acc.base += l.estimate.baseCents;
      acc.fees += l.estimate.fees.reduce((s, f) => s + f.cents, 0);
      acc.tax += l.estimate.taxCents;
      acc.total += l.estimate.totalCents;
      return acc;
    },
    { base: 0, fees: 0, tax: 0, total: 0 },
  );

  const since = addDays(today(), -RECENT_DAYS);
  const events = eventsForSite(state, siteId).filter((e) => e.date.slice(0, 10) >= since);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Overview</h1>
        <p className="text-ink-2 text-sm">
          {party?.name}
          {siteCount > 1 ? ` at ${site.address}${site.poNumber ? ` (${site.poNumber})` : ''}` : `, ${site.address}`}
        </p>
      </div>

      <section className="grid gap-3" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        <div className="tl-panel">
          <div className="tl-label">Account status</div>
          <AccountStatusPill status={account.status} />
          {account.autopay && <div className="text-xs text-ink-3 mt-2">Autopay on</div>}
        </div>
        <div className="tl-panel">
          <div className="tl-label">Balance due</div>
          <div className="text-xl font-semibold tl-money" style={{ color: balance > 0 ? 'var(--color-danger)' : 'var(--color-ink)' }}>
            {money(balance)}
          </div>
          <div className="text-xs text-ink-3 mt-1">{balance > 0 ? 'Across open invoices' : 'Nothing due'}</div>
        </div>
        <div className="tl-panel">
          <div className="tl-label">Next pickup</div>
          {hold && resumes ? (
            <>
              <div className="text-lg font-medium" data-testid="hold-range">On hold {formatDate(hold.start)} to {formatDate(hold.end)}</div>
              <div className="text-xs text-ink-3 mt-1">Pickups resume {formatDayLong(resumes)}</div>
            </>
          ) : route && nextPickup ? (
            <>
              <div className="text-lg font-medium">{formatDayLong(nextPickup)}</div>
              <div className="text-xs text-ink-3 mt-1">Every {route.day === 'Mon' ? 'Monday' : route.day === 'Tue' ? 'Tuesday' : route.day === 'Wed' ? 'Wednesday' : route.day === 'Thu' ? 'Thursday' : 'Friday'}, route {route.id}</div>
            </>
          ) : (
            <div className="text-sm text-ink-3">No route assigned to this site</div>
          )}
        </div>
        <div className="tl-panel">
          <div className="tl-label">Open items</div>
          <div className="text-xl font-semibold">{openItems.length}</div>
          <div className="text-xs text-ink-3 mt-1">
            {openItems.length === 0 ? 'No open requests' : `${openItems.filter((r) => r.status === 'open').length} open, ${openItems.filter((r) => r.status === 'scheduled').length} scheduled`}
          </div>
        </div>
      </section>

      {pending.length > 0 && (
        <section className="tl-card flex flex-col gap-1" data-testid="pending-change" style={{ background: 'var(--color-info-soft)', borderColor: 'transparent' }}>
          <div className="text-sm font-medium">Pending change</div>
          {pending.map((p) => {
            const wo = state.workOrders.find((w) => w.id === p.workOrderId);
            const name = (id: string) => state.catalog.find((c) => c.id === id)?.name ?? id;
            return (
              <div key={p.id} className="text-sm text-ink-2" data-pending={p.id}>
                {name(p.fromCatalogId)} becomes {name(p.toCatalogId)} starting {formatDate(p.effectiveFrom)}
                {wo ? `, cart ${wo.kind} scheduled ${formatDayLong(wo.scheduledFor)} (${wo.id})` : ''}
              </div>
            );
          })}
        </section>
      )}

      <section className="tl-panel">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-medium">Services at this site</h2>
          <span className="text-xs text-ink-3">
            Next invoice issued {formatDate(issuedOn)} covers {formatDate(period.start)} to {formatDate(period.end)}
          </span>
        </div>
        {lines.length === 0 ? (
          <p className="text-sm text-ink-3">No services at this site.</p>
        ) : (
          <table className="tl-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Frequency</th>
                <th>Container</th>
                <th>Status</th>
                <th className="num">Monthly</th>
                <th className="num">Next invoice estimate</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(({ item, catalog, change, serials, price, estimate, error }) => (
                <tr key={item.id}>
                  <td>
                    <div>{catalog?.name ?? item.catalogId}</div>
                    {change && <div className="text-xs text-ink-3">Changes from {state.catalog.find((c) => c.id === change.fromCatalogId)?.name} on {formatDate(change.effectiveFrom)}</div>}
                    {item.qty > 1 && <div className="text-xs text-ink-3">qty {item.qty}</div>}
                  </td>
                  <td>{frequencyLabel(item.frequency)}</td>
                  <td className="font-mono text-xs">{serials.length ? serials.join(', ') : 'none assigned'}</td>
                  <td><ServiceItemStatusPill status={item.status} /></td>
                  <td className="num tl-money">
                    {price ? money(price.priceCents) : <span className="text-danger text-xs">{error}</span>}
                  </td>
                  <td className="num tl-money">
                    {estimate ? (
                      <>
                        <div>{money(estimate.totalCents)}</div>
                        <div className="text-xs text-ink-3">
                          {money(estimate.baseCents)} + fees {money(estimate.fees.reduce((s, f) => s + f.cents, 0))} + tax {money(estimate.taxCents)}
                        </div>
                      </>
                    ) : item.status === 'held' ? (
                      <span className="text-xs text-ink-3">Not billed while held</span>
                    ) : (
                      <span className="text-xs text-ink-3">n/a</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {estimateTotals.total > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={5} className="text-right text-sm font-medium">
                    Estimated total for this site, {formatDate(period.start)} to {formatDate(period.end)}
                  </td>
                  <td className="num tl-money font-semibold">
                    <div>{money(estimateTotals.total)}</div>
                    <div className="text-xs text-ink-3 font-normal">
                      {money(estimateTotals.base)} + fees {money(estimateTotals.fees)} + tax {money(estimateTotals.tax)}
                    </div>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
        <p className="text-xs text-ink-3 mt-2">
          Estimate uses the {account.cycle === 'net30' ? 'net 30' : account.cycle} cycle
          {account.billedInAdvance ? ', billed in advance' : ', billed in arrears'}, and the rates published for the period. Fees and tax are fixed when the charge is created.
        </p>
      </section>

      <section className="tl-panel">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-medium">Recent field events</h2>
          <span className="text-xs text-ink-3">Last {RECENT_DAYS} days at {site.address}</span>
        </div>
        {events.length === 0 ? (
          <p className="text-sm text-ink-3">No field events in the last {RECENT_DAYS} days.</p>
        ) : (
          <table className="tl-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Outcome</th>
                <th>Note</th>
                <th>Driver</th>
                <th>Photo</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const photo = resolvePhoto(e.photoUrl);
                return (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{eventWhen(e.date)}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <OutcomePill outcome={e.outcome} />
                        {e.exception && <span className="tl-pill">{e.exception}</span>}
                      </div>
                    </td>
                    <td className="text-sm text-ink-2">{e.note ?? ''}</td>
                    <td className="whitespace-nowrap">{e.driver}</td>
                    <td>
                      {photo ? (
                        <img
                          src={photo}
                          alt={`${e.outcome} at ${site.address} on ${e.date.slice(0, 10)}`}
                          className="rounded-sm border border-border"
                          style={{ width: 72, height: 48, objectFit: 'cover' }}
                        />
                      ) : (
                        <span className="text-xs text-ink-3">no photo</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <InvariantsPanel />
    </div>
  );
}
