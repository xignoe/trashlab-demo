// Two screens are reachable from the URL hash so a link can be saved and opened again:
//   #office            the office approvals screen
//   #store             the store inspector (the Store tab beside office approvals)
//   #status/<quoteId>  the customer status screen for one quote
// This is a hash listener, not a router library; every other screen stays a plain `screen` value.
// The store is in memory, so a status link for a quote created this session only resolves until reload;
// the seed quote_held_ridge always resolves.
import { useEffect } from 'react';
import { useUi, type UiState } from '../store/ui';

const STATUS_PREFIX = '#status/';

export function statusHash(quoteId: string): string {
  return `${STATUS_PREFIX}${encodeURIComponent(quoteId)}`;
}

/** The full link a buyer can save to reopen a status, from the current page's origin. */
export function statusUrl(quoteId: string): string {
  if (typeof window === 'undefined') return statusHash(quoteId);
  return `${window.location.origin}${window.location.pathname}${statusHash(quoteId)}`;
}

function hashFor(s: Pick<UiState, 'screen' | 'statusQuoteId'>): string {
  if (s.screen === 'office') return '#office';
  if (s.screen === 'store') return '#store';
  if (s.screen === 'held' && s.statusQuoteId) return statusHash(s.statusQuoteId);
  return '';
}

function applyHash(hash: string) {
  const ui = useUi.getState();
  if (hash === '#office') {
    if (ui.screen !== 'office') ui.go('office');
  } else if (hash === '#store') {
    if (ui.screen !== 'store') ui.go('store');
  } else if (hash.startsWith(STATUS_PREFIX)) {
    const id = decodeURIComponent(hash.slice(STATUS_PREFIX.length));
    if (id && (ui.screen !== 'held' || ui.statusQuoteId !== id)) ui.showStatus(id);
  }
}

/** Reads the hash on load and on hashchange, and keeps it in step with the screen (replaceState, no history spam). */
export function useHashRoute() {
  useEffect(() => {
    applyHash(window.location.hash);
    const onHash = () => applyHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    const unsubscribe = useUi.subscribe((s) => {
      const want = hashFor(s);
      if (window.location.hash !== want) window.history.replaceState(null, '', want || `${window.location.pathname}${window.location.search}`);
    });
    return () => {
      window.removeEventListener('hashchange', onHash);
      unsubscribe();
    };
  }, []);
}
