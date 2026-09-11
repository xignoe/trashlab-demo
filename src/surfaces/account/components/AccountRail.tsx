// Left rail: the five focus accounts pinned, plus a search over every account by name, id, address, or PO.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccountSearch, usePinnedAccounts, type AccountSummary } from '../selectors';
import { STATUS_LABEL } from './format';

function RailItem({ summary, active }: { summary: AccountSummary; active: boolean }) {
  const { account, payer, address } = summary;
  return (
    <Link to={`/office/account/${account.id}`} className={`rail-item${active ? ' rail-item-active' : ''}`} aria-current={active ? 'page' : undefined}>
      <span className="rail-item-text">
        <span className="rail-item-name">{payer?.name ?? account.id}</span>
        <span className="rail-item-sub" title={address ?? account.id}>{address ?? account.id}</span>
      </span>
      <span className={`rail-dot rail-dot-${account.status}`} title={STATUS_LABEL[account.status]} aria-label={STATUS_LABEL[account.status]} />
    </Link>
  );
}

export function AccountRail({ activeId }: { activeId: string }) {
  const [query, setQuery] = useState('');
  const pinned = usePinnedAccounts();
  const results = useAccountSearch(query);
  const searching = query.trim().length > 0;

  return (
    <aside className="rail" aria-label="Accounts">
      <Link to="/office/account" className="rail-back">← All accounts</Link>
      <div className="field">
        <label className="eyebrow" htmlFor="account-search">Find an account</label>
        <input
          id="account-search"
          className="input"
          type="search"
          placeholder="Search accounts"
          title="Search by name, id, address, or PO"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </div>
      {searching ? (
        <div className="stack">
          <div className="eyebrow">{results.length ? `${results.length} ${results.length === 1 ? 'match' : 'matches'}` : 'No matches'}</div>
          <div className="rail-list">
            {results.map((s) => (
              <RailItem key={s.account.id} summary={s} active={s.account.id === activeId} />
            ))}
          </div>
        </div>
      ) : (
        <div className="stack">
          <div className="eyebrow">Pinned</div>
          <div className="rail-list">
            {pinned.map((s) => (
              <RailItem key={s.account.id} summary={s} active={s.account.id === activeId} />
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
