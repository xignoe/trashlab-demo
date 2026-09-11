import { useStore } from '../store/useStore';
import { sitesForAccount } from '../store/selectors';

/** Shown only when the signed-in account has more than one site. Lists each address with its PO number. */
export function SiteSwitcher() {
  const state = useStore();
  const { accountId, siteId } = state.session;
  const sites = sitesForAccount(state, accountId);
  if (sites.length <= 1) return null;

  return (
    <div className="tl-card flex items-center gap-3 mb-4">
      <span className="text-sm text-ink-2">Site</span>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Site">
        {sites.map((site) => {
          const active = site.id === siteId;
          return (
            <button
              key={site.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => state.setSite(site.id)}
              className={`tl-button ${active ? '' : 'tl-button--secondary'}`}
              style={{ height: 32 }}
            >
              <span>{site.address}</span>
              {site.poNumber && (
                <span className={`font-mono text-xs ${active ? 'opacity-80' : 'text-ink-3'}`}>{site.poNumber}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
