/**
 * Sign in (/login): pick a hauler, then pick a seat at it.
 *
 * This is the front door for the multi-hauler build. Each card is one tenant (src/tenants): who the hauler is, which
 * lines of business it sells, where it runs, and the live site the profile was read from. Choosing a seat calls
 * signIn, which swaps the store's whole Db for that hauler's world and lands on that seat's home screen.
 *
 * There are no passwords. A seat is a demo identity, the way the persona bar is a demo persona: Owner opens the
 * ratebook, Office opens the accounts and the approvals queue, and a customer seat opens that customer's portal. The
 * "onboard a new customer" links open the storefront at the right starting screen for each line of business, which is
 * where a hauler's own customer would begin.
 */
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { LINE_LABEL, TENANTS, type TenantProfile } from '../tenants';
import type { TenantSession } from '../tenants/types';

/** Where each seat lands. A customer goes to their portal; the storefront is one click away from there. */
const HOME: Record<TenantSession['role'], string> = {
  owner: '/owner/pricing',
  office: '/office/account',
  customer: '/customer/portal',
};

/** Where a new customer of each line of business starts in the storefront. */
const ONBOARD_PATH: Record<string, string> = {
  residential: '/customer/store',
  frontload: '/customer/store/commercial',
  rolloff: '/customer/store/commercial',
};

function Pill({ children, tone = 'quiet' }: { children: React.ReactNode; tone?: 'quiet' | 'brand' }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
      style={
        tone === 'brand'
          ? { background: 'var(--tl-cyan)', color: 'var(--tl-brand-deep)' }
          : { background: '#00000014', color: 'inherit' }
      }
    >
      {children}
    </span>
  );
}

function TenantCard({ tenant }: { tenant: TenantProfile }) {
  const navigate = useNavigate();
  const signIn = useStore(s => s.signIn);

  function enter(session: TenantSession) {
    signIn(session);
    navigate(HOME[session.role]);
  }

  function onboard(lob: string) {
    // The office opens the storefront, because onboarding a customer is what a hauler's own staff walks through here.
    signIn({ tenantId: tenant.id, role: 'office', name: `${tenant.shortName} office` });
    navigate(ONBOARD_PATH[lob] ?? '/customer/store');
  }

  return (
    <section
      className="flex flex-col overflow-hidden rounded-2xl border shadow-sm"
      style={
        {
          borderColor: '#E2E8F0',
          background: '#FFFFFF',
        } as React.CSSProperties
      }
      aria-labelledby={`tenant-${tenant.id}`}
      data-testid={`tenant-card-${tenant.id}`}
    >
      <header className="p-6" style={{ background: 'var(--tl-brand)', color: 'var(--tl-on-brand)' }}>
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-lg bg-white">
            <span className="block h-3.5 w-3.5 rounded-[3px]" style={{ background: 'var(--tl-cyan)' }} />
          </span>
          <h2 id={`tenant-${tenant.id}`} className="text-lg font-bold">
            {tenant.name}
          </h2>
        </div>
        <p className="mt-3 text-sm opacity-90">{tenant.tagline}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {tenant.lines.map(lob => (
            <Pill key={lob} tone="brand">
              {LINE_LABEL[lob]}
            </Pill>
          ))}
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-5 p-6">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-gray-600">
          <dt className="font-medium text-gray-900">Yard</dt>
          <dd>
            {tenant.address ? `${tenant.address}, ` : ''}
            {tenant.city}, {tenant.state}
          </dd>
          <dt className="font-medium text-gray-900">Area</dt>
          <dd>{tenant.serviceArea.slice(0, 4).join(', ')}</dd>
          <dt className="font-medium text-gray-900">Phone</dt>
          <dd>{tenant.phone}</dd>
          {tenant.email ? (
            <>
              <dt className="font-medium text-gray-900">Email</dt>
              <dd>{tenant.email}</dd>
            </>
          ) : null}
        </dl>

        {tenant.promo ? (
          <p className="rounded-lg px-3 py-2 text-sm font-semibold" style={{ background: 'color-mix(in srgb, var(--tl-cyan) 20%, transparent)', color: 'var(--tl-brand-deep)' }}>
            {tenant.promo}
          </p>
        ) : null}

        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">Sign in as a customer</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {tenant.logins.map(login => (
              <li key={login.accountId}>
                <button
                  type="button"
                  className="w-full rounded-lg border border-gray-200 p-3 text-left transition hover:border-gray-400 hover:bg-gray-50"
                  onClick={() => enter({ tenantId: tenant.id, role: 'customer', accountId: login.accountId, name: login.name })}
                  data-testid={`login-${tenant.id}-${login.accountId}`}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-gray-900">{login.name}</span>
                    <Pill>{LINE_LABEL[login.lob]}</Pill>
                  </span>
                  <span className="mt-1 block text-sm text-gray-600">{login.blurb}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">Onboard a new customer</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {tenant.lines.map(lob => (
              <button
                key={lob}
                type="button"
                className="rounded-full px-3 py-1.5 text-sm font-semibold text-white transition hover:opacity-90"
                style={{ background: 'var(--tl-brand)' }}
                onClick={() => onboard(lob)}
                data-testid={`onboard-${tenant.id}-${lob}`}
              >
                {LINE_LABEL[lob]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">Sign in as staff</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-900 hover:bg-gray-50"
              onClick={() => enter({ tenantId: tenant.id, role: 'owner', name: `${tenant.shortName} owner` })}
              data-testid={`owner-${tenant.id}`}
            >
              Owner, ratebook
            </button>
            <button
              type="button"
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-900 hover:bg-gray-50"
              onClick={() => enter({ tenantId: tenant.id, role: 'office', name: `${tenant.shortName} office` })}
              data-testid={`office-${tenant.id}`}
            >
              Office, accounts
            </button>
          </div>
        </div>

        <p className="mt-auto border-t border-gray-100 pt-4 text-xs leading-relaxed text-gray-500">
          {tenant.note}{' '}
          <a href={tenant.source} className="underline" target="_blank" rel="noreferrer">
            {tenant.source.replace(/^https?:\/\//, '')}
          </a>
        </p>
      </div>
    </section>
  );
}

export function SignIn() {
  return (
    <main className="mx-auto w-full max-w-[1200px] px-6 py-10">
      <h1 className="text-2xl font-bold text-gray-900">Sign in to TrashLab</h1>
      <p className="mt-2 max-w-[720px] text-gray-600">
        One build, four haulers. Each runs its own rate card, routes, zones, and customers, so signing in to one shows
        that hauler's world and nothing else. Pick a customer to open their portal, or onboard a new one to walk the
        signup the way their own office would.
      </p>
      <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {TENANTS.map(tenant => (
          <TenantCard key={tenant.id} tenant={tenant} />
        ))}
      </div>
    </main>
  );
}
