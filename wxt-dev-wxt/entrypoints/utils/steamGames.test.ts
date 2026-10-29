import { describe, it, expect } from 'vitest';
import { parseSteamFreeGames, parseSteamLoginState } from './steamGames';

// Trimmed-down copies of the search page's server-rendered header (signed-out
// form confirmed live, Oct 2026) around an empty result list — Steam usually
// has no free-to-keep game, and the header must still be read then.
const page = (actions: string) => `
  <div id="global_header"><div id="global_actions">${actions}</div></div>
  <div id="search_result_container"><div id="search_resultsRows"></div></div>`;
const SIGNED_IN = page('<div id="account_pulldown" class="global_action_link">someone</div>');
const SIGNED_OUT = page('<a class="global_action_link" href="https://store.steampowered.com/login/">sign in</a>');

describe('parseSteamLoginState', () => {
  it('is true when the header has the account menu', () => {
    expect(parseSteamLoginState(SIGNED_IN)).toBe(true);
  });

  it('is false when the header only offers "sign in"', () => {
    expect(parseSteamLoginState(SIGNED_OUT)).toBe(false);
  });

  it('is null for a page without the store header (e.g. an error page)', () => {
    expect(parseSteamLoginState('<html><body>Access denied</body></html>')).toBeNull();
  });

  it('reads the header even when there is no free game listed', () => {
    expect(parseSteamFreeGames(SIGNED_IN)).toBeNull();
    expect(parseSteamLoginState(SIGNED_IN)).toBe(true);
  });
});
