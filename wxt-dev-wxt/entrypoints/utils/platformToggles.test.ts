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
  // GOG is opt-in like the other optional-access platforms: defaulting it on
  // meant that granting gog.com for GOG-linked Prime offers also switched on
  // GOG giveaway claiming as a side effect.
  it('treats Steam and Epic as enabled by default (unset) but GOG, IndieGala and Prime Gaming as disabled', () => {
    expect(resolvePlatformToggles({})).toEqual({
      claimSteam: true,
      claimEpic: true,
      claimGog: false,
      claimIndieGala: false,
      claimPrimeGaming: false,
    });
  });

  it('respects an explicit false for Steam and Epic', () => {
    const result = resolvePlatformToggles({ steamCheck: false, epicCheck: false });
    expect(result.claimSteam).toBe(false);
    expect(result.claimEpic).toBe(false);
  });

  it('respects an explicit true for GOG, IndieGala and Prime Gaming', () => {
    const result = resolvePlatformToggles({ gogCheck: true, indieGalaCheck: true, primeGamingCheck: true });
    expect(result.claimGog).toBe(true);
    expect(result.claimIndieGala).toBe(true);
    expect(result.claimPrimeGaming).toBe(true);
  });

  it('respects an explicit false for IndieGala and Prime Gaming', () => {
    const result = resolvePlatformToggles({ indieGalaCheck: false, primeGamingCheck: false });
    expect(result.claimIndieGala).toBe(false);
    expect(result.claimPrimeGaming).toBe(false);
  });
});
