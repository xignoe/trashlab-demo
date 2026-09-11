import { useStore } from '../store/useStore';
import { TODAY, formatDate } from '../store/clock';

/** The two portal logins. Any other seeded account can be reached by a test through switchAccount. */
export const LOGINS = ['acct_res_maple', 'acct_pm_oakridge'] as const;

export function TopBar() {
  const hauler = useStore((s) => s.hauler);
  const accounts = useStore((s) => s.accounts);
  const parties = useStore((s) => s.parties);
  const accountId = useStore((s) => s.session.accountId);
  const switchAccount = useStore((s) => s.switchAccount);

  const options = LOGINS.map((id) => {
    const account = accounts.find((a) => a.id === id);
    const party = parties.find((p) => p.id === account?.payerPartyId);
    return { id, label: party?.name ?? id };
  });
  // If a test has switched the session to a non-login account, show it so the switcher is never blank.
  if (!options.some((o) => o.id === accountId)) {
    const account = accounts.find((a) => a.id === accountId);
    const party = parties.find((p) => p.id === account?.payerPartyId);
    options.push({ id: accountId as (typeof LOGINS)[number], label: party?.name ?? accountId });
  }

  return (
    <header
      className="bg-surface border-b border-border flex items-center gap-4 px-6 sticky top-0 z-10"
      style={{ height: 'var(--topbar-height)' }}
    >
      <span className="font-semibold text-lg">{hauler.name}</span>
      <span className="tl-pill tl-pill--info">Customer portal</span>
      <span className="ml-auto text-sm text-ink-3">Today is {formatDate(TODAY)}</span>
      <label className="flex items-center gap-2 text-sm text-ink-2">
        <span>Signed in as</span>
        <select
          className="tl-field"
          style={{ width: 'auto', height: 32 }}
          value={accountId}
          onChange={(e) => switchAccount(e.target.value)}
          aria-label="Signed in as"
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </header>
  );
}
