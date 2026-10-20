// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resolvePlatformToggles } from './platformToggles';

describe('resolvePlatformToggles', () => {
  // Regression: a fresh install has never written any of these keys, so
  // getStorageItems returns undefined/null for all five — this must not be
  // read as "enabled" for the two platforms that default off on install, and
  // (a real bug this caught) must still resolve to "enabled" for Steam/Epic
  // despite getEpicGamesList/getSteamGamesList's own `= true` default params
  // never actually firing for a raw `null` argument.
  it('treats Steam, Epic, and GOG as enabled by default (unset) but IndieGala and Prime Gaming as disabled', () => {
    expect(resolvePlatformToggles({})).toEqual({
      claimSteam: true,
      claimEpic: true,
      claimGog: true,
      claimIndieGala: false,
      claimPrimeGaming: false,
    });
  });

  it('respects an explicit false for Steam, Epic, and GOG', () => {
    const result = resolvePlatformToggles({ steamCheck: false, epicCheck: false, gogCheck: false });
    expect(result.claimSteam).toBe(false);
    expect(result.claimEpic).toBe(false);
    expect(result.claimGog).toBe(false);
  });

  it('respects an explicit true for IndieGala and Prime Gaming', () => {
    const result = resolvePlatformToggles({ indieGalaCheck: true, primeGamingCheck: true });
    expect(result.claimIndieGala).toBe(true);
    expect(result.claimPrimeGaming).toBe(true);
  });

  it('respects an explicit false for IndieGala and Prime Gaming', () => {
    const result = resolvePlatformToggles({ indieGalaCheck: false, primeGamingCheck: false });
    expect(result.claimIndieGala).toBe(false);
    expect(result.claimPrimeGaming).toBe(false);
  });
});
