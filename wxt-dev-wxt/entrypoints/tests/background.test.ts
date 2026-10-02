// @vitest-environment node
// Lives under entrypoints/tests/ (not entrypoints/ root) so WXT doesn't treat it
// as a duplicate "background" entrypoint. Node env avoids the esbuild/jsdom clash
// from importing background.ts (which pulls in `#imports`).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
  areDatesDifferent,
  background,
  didEnoughTimePass,
  EPIC_FREE_GAMES_URL,
  formatEpicFreeGame,
  isActive,
  partitionEpicPromotions,
  resolveEpicSlug,
  resolvePlatformToggles,
  shouldCheckPrimeGamingToday,
  withEpicEnglishLocale,
} from '../background';
import { Platforms } from '../enums/platforms';
import { getStorageItem, setStorageItem } from '../hooks/useStorage';
import { INDIEGALA_WHEEL_URL } from '../utils/indieGalaWheel';
import { PRIME_GAMING_HOME_URL } from '../utils/primeGamingGiveaway';
import { GOG_HOME_URL } from '../utils/gogGiveaway';

describe('areDatesDifferent', () => {
  it('is true for different calendar days', () => {
    expect(areDatesDifferent('2026-01-01T12:00:00Z', '2026-06-15T12:00:00Z')).toBe(true);
  });

  it('is false for the same instant', () => {
    expect(areDatesDifferent('2026-01-01T12:00:00Z', '2026-01-01T12:00:00Z')).toBe(false);
  });

  it('is false when the first date is empty (never claimed)', () => {
    expect(areDatesDifferent('', '2026-06-15T12:00:00Z')).toBe(false);
  });
});

describe('didEnoughTimePass', () => {
  it('is true when more than the required minutes elapsed', () => {
    const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000).toISOString();
    expect(didEnoughTimePass(twoHoursAgo, 60)).toBe(true);
  });

  it('is false when not enough time has passed', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(didEnoughTimePass(fiveMinAgo, 60)).toBe(false);
  });
});

describe('isActive', () => {
  // Regression: `active` isn't persisted to storage until OnButton's
  // useStorage effect first mounts, so a fresh install (or any raw storage
  // read before the popup has ever opened) must not treat "unset" as "off".
  it('is true when unset (fresh install, never persisted)', () => {
    expect(isActive(undefined)).toBe(true);
    expect(isActive(null)).toBe(true);
  });

  it('is true when explicitly enabled', () => {
    expect(isActive(true)).toBe(true);
  });

  it('is false only when explicitly disabled', () => {
    expect(isActive(false)).toBe(false);
  });
});

describe('handleInstall', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  // Claiming must never be a side effect of installing — only a browser
  // restart or a due claimFrequency interval may trigger it.
  it('does nothing on a fresh install', async () => {
    const runner = Object.create(background);
    let calls = 0;
    runner.getFreeGamesAndSetOpenedFlag = async () => { calls++; };

    runner.handleInstall({ reason: 'install' });
    await new Promise(process.nextTick);

    expect(calls).toBe(0);
  });

  it('only sets the update badge on an update, never triggers a check', async () => {
    // fake-browser doesn't implement action.setBadgeText/setBadgeBackgroundColor
    // (the update branch's own, pre-existing behavior, unrelated to this test).
    vi.spyOn(fakeBrowser.action, 'setBadgeText').mockResolvedValue(undefined as never);
    vi.spyOn(fakeBrowser.action, 'setBadgeBackgroundColor').mockResolvedValue(undefined as never);

    const runner = Object.create(background);
    let calls = 0;
    runner.getFreeGamesAndSetOpenedFlag = async () => { calls++; };

    runner.handleInstall({ reason: 'update' });
    await new Promise(process.nextTick);

    expect(calls).toBe(0);
  });
});

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

describe('shouldCheckPrimeGamingToday', () => {
  it('is true when Prime Gaming has never been checked before', () => {
    // 2026-09-19 is a Saturday — not a check day — proving "never checked"
    // overrides the day-of-week restriction entirely.
    expect(shouldCheckPrimeGamingToday(null, new Date('2026-09-19T12:00:00Z'))).toBe(true);
  });

  it('is false when already checked earlier the same calendar day, even on a Thursday', () => {
    const lastCheck = '2026-09-17T08:00:00Z';
    const now = new Date('2026-09-17T18:00:00Z');
    expect(shouldCheckPrimeGamingToday(lastCheck, now)).toBe(false);
  });

  it('is true on a Thursday once the calendar day has changed', () => {
    const lastCheck = '2026-09-16T12:00:00Z'; // Wednesday
    const now = new Date('2026-09-17T12:00:00Z'); // Thursday
    expect(shouldCheckPrimeGamingToday(lastCheck, now)).toBe(true);
  });

  it('is true on a Friday once the calendar day has changed', () => {
    const lastCheck = '2026-09-17T12:00:00Z'; // Thursday
    const now = new Date('2026-09-18T12:00:00Z'); // Friday
    expect(shouldCheckPrimeGamingToday(lastCheck, now)).toBe(true);
  });

  it('is false on a non-Thu/Fri day within the catch-up window', () => {
    const lastCheck = '2026-09-18T12:00:00Z'; // Friday
    const now = new Date('2026-09-19T12:00:00Z'); // Saturday, 1 day later
    expect(shouldCheckPrimeGamingToday(lastCheck, now)).toBe(false);
  });

  it('is true on a non-Thu/Fri day once the catch-up interval is exceeded', () => {
    const lastCheck = '2026-09-13T12:00:00Z'; // Sunday
    const now = new Date('2026-09-19T12:00:00Z'); // Saturday, 6 days later
    expect(shouldCheckPrimeGamingToday(lastCheck, now)).toBe(true);
  });
});

describe('checkPrimeGaming', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('does nothing when disabled', async () => {
    const opened: string[] = [];
    const runner = Object.create(background);
    runner.openTabAndSendActionToContent = async (url: string) => {
      opened.push(url);
    };

    await runner.checkPrimeGaming(false);

    expect(opened).toEqual([]);
  });

  it('opens the tab when enabled and never checked before', async () => {
    const opened: { url: string; action: string }[] = [];
    const runner = Object.create(background);
    runner.openTabAndSendActionToContent = async (url: string, action: string) => {
      opened.push({ url, action });
    };

    await runner.checkPrimeGaming(true);

    expect(opened).toEqual([{ url: PRIME_GAMING_HOME_URL, action: 'getFreeGames' }]);
  });

  it('does not re-open the tab twice on the same calendar day', async () => {
    const opened: string[] = [];
    const runner = Object.create(background);
    runner.openTabAndSendActionToContent = async (url: string) => {
      opened.push(url);
    };

    await runner.checkPrimeGaming(true);
    await runner.checkPrimeGaming(true);

    expect(opened).toHaveLength(1);
  });

  // Regression: the tab used to open on every check regardless of day, even
  // though new Prime Gaming titles only ever land on Thursdays/Fridays.
  it('skips the tab on a day that is neither a check day nor past the catch-up window', async () => {
    await setStorageItem('primeGamingLastCheck', new Date('2026-09-18T12:00:00Z').toISOString()); // Friday

    const opened: string[] = [];
    const runner = Object.create(background);
    runner.openTabAndSendActionToContent = async (url: string) => {
      opened.push(url);
    };

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-19T12:00:00Z')); // Saturday, 1 day later
    try {
      await runner.checkPrimeGaming(true);
    } finally {
      vi.useRealTimers();
    }

    expect(opened).toEqual([]);
  });

  it('does not record the last-check date when opening the tab fails, so the next due call retries', async () => {
    const runner = Object.create(background);
    runner.openTabAndSendActionToContent = async () => {
      throw new Error('Could not establish connection');
    };

    await expect(runner.checkPrimeGaming(true)).rejects.toThrow();
    expect(await getStorageItem<string>('primeGamingLastCheck')).toBeNull();

    const opened: string[] = [];
    runner.openTabAndSendActionToContent = async (url: string) => {
      opened.push(url);
    };
    await runner.checkPrimeGaming(true);
    expect(opened).toEqual([PRIME_GAMING_HOME_URL]);
  });

  it('bypasses the day-of-week gate when forced (explicit user action)', async () => {
    await setStorageItem('primeGamingLastCheck', new Date('2026-09-18T12:00:00Z').toISOString()); // Friday

    const opened: string[] = [];
    const runner = Object.create(background);
    runner.openTabAndSendActionToContent = async (url: string) => {
      opened.push(url);
    };

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-19T12:00:00Z')); // Saturday, not a check day
    try {
      await runner.checkPrimeGaming(true, true);
    } finally {
      vi.useRealTimers();
    }

    expect(opened).toEqual([PRIME_GAMING_HOME_URL]);
  });
});

describe('manual claim', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  // Regression (found live): pressing "Claim now" a second time the same day
  // silently skipped Prime Gaming, because only the "Log in" recheck bypassed
  // its day-of-week gate.
  it('forces the Prime Gaming check past its day-of-week gate', async () => {
    const runner = Object.create(background);
    runner.clearGamesList = async () => {};
    const forcedArgs: boolean[] = [];
    runner.runFreeGamesChecks = async (force: boolean) => { forcedArgs.push(force); };

    await runner.handleMessage({ target: 'background', action: 'claim' });

    expect(forcedArgs).toEqual([true]);
  });

  it('runFreeGamesChecks forwards force to checkPrimeGaming', async () => {
    await setStorageItem('primeGamingCheck', true);
    const runner = Object.create(background);
    runner.getEpicGamesList = async () => {};
    runner.getSteamGamesList = async () => {};
    runner.getGogGamesList = async () => {};
    runner.checkIndieGalaWheel = async () => {};
    runner.getIndieGalaGamesList = async () => {};
    const primeArgs: [boolean, boolean][] = [];
    runner.checkPrimeGaming = async (shouldCheck: boolean, force: boolean) => { primeArgs.push([shouldCheck, force]); };

    await runner.runFreeGamesChecks(true);
    await runner.runFreeGamesChecks();

    expect(primeArgs).toEqual([[true, true], [true, false]]);
  });
});

describe('checkPlatformLogin', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('checks Steam via getSteamGamesList', async () => {
    const runner = Object.create(background);
    let calls = 0;
    runner.getSteamGamesList = async (shouldClaim: boolean) => { calls++; expect(shouldClaim).toBe(true); };

    await runner.checkPlatformLogin(Platforms.Steam);

    expect(calls).toBe(1);
  });

  it('checks Prime Gaming via checkPrimeGaming, forced regardless of day', async () => {
    const runner = Object.create(background);
    let forcedArg: boolean | undefined;
    runner.checkPrimeGaming = async (_shouldCheck: boolean, force: boolean) => { forcedArg = force; };

    await runner.checkPlatformLogin(Platforms.PrimeGaming);

    expect(forcedArg).toBe(true);
  });

  // Regression: getGogGamesList throws on an ambiguous 401 rather than
  // recording a definitive logged-out state (see its own comment) — without
  // falling back to a real tab here the same way runFreeGamesChecks does,
  // clicking "Log in" for GOG while unauthorized would silently do nothing.
  it('falls back to opening a real tab when the fast path throws', async () => {
    const runner = Object.create(background);
    runner.getGogGamesList = async () => { throw new Error('GOG giveaway status requires a signed-in session'); };
    const opened: { url: string; action: string }[] = [];
    runner.openTabAndSendActionToContent = async (url: string, action: string) => {
      opened.push({ url, action });
    };

    await runner.checkPlatformLogin(Platforms.GOG);

    expect(opened).toEqual([{ url: GOG_HOME_URL, action: 'getFreeGames' }]);
  });
});

describe('formatEpicFreeGame', () => {
  it('maps an Epic API element to a FreeGame', () => {
    const el = {
      title: 'Test Game',
      productSlug: 'test-game',
      description: 'desc',
      keyImages: [{ type: 'Thumbnail', url: 'https://img/thumb.jpg' }],
      promotions: {
        promotionalOffers: [
          { promotionalOffers: [{ startDate: '2026-01-01T00:00:00Z', endDate: '2026-01-08T00:00:00Z' }] },
        ],
      },
    } as any;

    const game = formatEpicFreeGame(el, false);
    expect(game.title).toBe('Test Game');
    expect(game.platform).toBe(Platforms.Epic);
    expect(game.link).toBe('https://store.epicgames.com/en-US/p/test-game');
    expect(game.img).toBe('https://img/thumb.jpg');
    expect(game.future).toBe(false);
    expect(game.endDate).toBe('2026-01-08T00:00:00.000Z');
  });

  it('uses the /bundle/ path for bundle products', () => {
    const el = { title: 'B', productSlug: 'b', categories: [{ path: 'bundles' }] } as any;
    expect(formatEpicFreeGame(el, false).link).toContain('/bundle/');
  });

  it('falls back to the default icon when no image is present', () => {
    const el = { title: 'X', productSlug: 'x' } as any;
    expect(formatEpicFreeGame(el, false).img).toBe('/icon/128.png');
  });
});

describe('withEpicEnglishLocale', () => {
  it('forces lang=en-US on an epicgames.com URL with no lang', () => {
    expect(withEpicEnglishLocale('https://www.epicgames.com/store/de/p/x'))
      .toBe('https://www.epicgames.com/store/de/p/x?lang=en-US');
  });

  it('overrides a non-English lang param', () => {
    expect(withEpicEnglishLocale('https://store.epicgames.com/p/x?lang=de'))
      .toBe('https://store.epicgames.com/p/x?lang=en-US');
  });

  it('leaves non-Epic URLs unchanged', () => {
    const steam = 'https://store.steampowered.com/app/1/';
    expect(withEpicEnglishLocale(steam)).toBe(steam);
  });
});

describe('resolveEpicSlug', () => {
  it('prefers the catalogNs pageSlug over a productSlug carrying a /home suffix', () => {
    const el = {
      productSlug: 'cardpocalypse/home',
      catalogNs: { mappings: [{ pageSlug: 'cardpocalypse' }] },
    } as any;
    expect(resolveEpicSlug(el)).toBe('cardpocalypse');
  });

  it('strips a trailing /home segment when only productSlug is present', () => {
    expect(resolveEpicSlug({ productSlug: 'cardpocalypse/home' } as any)).toBe('cardpocalypse');
  });

  it('strips surrounding slashes', () => {
    expect(resolveEpicSlug({ productSlug: '/some-game/' } as any)).toBe('some-game');
  });

  it('falls back to offerMappings when catalogNs has no usable slug', () => {
    const el = {
      catalogNs: { mappings: [{}] },
      offerMappings: [{ pageSlug: 'from-offer' }],
    } as any;
    expect(resolveEpicSlug(el)).toBe('from-offer');
  });

  it('returns an empty string when no slug is available', () => {
    expect(resolveEpicSlug({ title: 'X' } as any)).toBe('');
  });
});

describe('formatEpicFreeGame link building', () => {
  it('builds a store.epicgames.com product URL for the real Cardpocalypse payload', () => {
    const el = {
      title: 'Cardpocalypse Standard Edition',
      productSlug: 'cardpocalypse/home',
      urlSlug: 'cardpocalypsegeneralaudience',
      catalogNs: { mappings: [{ pageSlug: 'cardpocalypse' }] },
      offerMappings: [{ pageSlug: 'cardpocalypse' }],
      categories: [{ path: 'freegames' }, { path: 'games' }],
    } as any;
    expect(formatEpicFreeGame(el, false).link).toBe('https://store.epicgames.com/en-US/p/cardpocalypse');
  });

  it('never emits a link with an empty slug', () => {
    const link = formatEpicFreeGame({ title: 'X' } as any, false).link;
    expect(link).not.toMatch(/\/p\/?$/);
    expect(link).toBe(EPIC_FREE_GAMES_URL);
  });
});

describe('partitionEpicPromotions', () => {
  const currentlyFree = {
    title: 'Cardpocalypse Standard Edition',
    price: { totalPrice: { discountPrice: 0 } },
    promotions: {
      promotionalOffers: [{ promotionalOffers: [{ discountSetting: { discountPercentage: 0 } }] }],
    },
  } as any;

  const upcomingFree = {
    title: 'Breathedge',
    price: { totalPrice: { discountPrice: 2499 } },
    promotions: {
      upcomingPromotionalOffers: [{ promotionalOffers: [{ discountSetting: { discountPercentage: 0 } }] }],
    },
  } as any;

  const upcomingDiscount = {
    title: 'Ghostrunner 2',
    price: { totalPrice: { discountPrice: 3999 } },
    promotions: {
      upcomingPromotionalOffers: [{ promotionalOffers: [{ discountSetting: { discountPercentage: 20 } }] }],
    },
  } as any;

  it('splits current and upcoming free games', () => {
    const { current, future } = partitionEpicPromotions([currentlyFree, upcomingFree, upcomingDiscount]);
    expect(current.map((g) => g.title)).toEqual(['Cardpocalypse Standard Edition']);
    expect(future.map((g) => g.title)).toEqual(['Breathedge']);
  });

  it('never lists a currently free game as upcoming', () => {
    const alsoUpcoming = {
      ...currentlyFree,
      promotions: {
        ...currentlyFree.promotions,
        upcomingPromotionalOffers: [{ promotionalOffers: [{ discountSetting: { discountPercentage: 0 } }] }],
      },
    } as any;
    const { current, future } = partitionEpicPromotions([alsoUpcoming]);
    expect(current).toHaveLength(1);
    expect(future).toEqual([]);
  });
});

describe('claimGames resilience', () => {
  it('opens every game even when an earlier claim throws', async () => {
    const opened: string[] = [];
    const runner = Object.create(background);
    runner.openTabAndSendActionToContent = async (url: string) => {
      opened.push(url);
      if (opened.length === 1) throw new Error('Receiving end does not exist');
    };
    runner.wait = async () => {};
    runner.setBadgeText = async () => {};

    await runner.claimGames([
      { title: 'A', platform: Platforms.Epic, link: 'https://store.epicgames.com/en-US/p/a' },
      { title: 'B', platform: Platforms.Epic, link: 'https://store.epicgames.com/en-US/p/b' },
    ] as any);

    expect(opened).toHaveLength(2);
    expect(opened[1]).toContain('/p/b');
  });

  it('dedupes games sharing the same link into a single tab, but badges the pre-dedupe count', async () => {
    const opened: string[] = [];
    const badgeTexts: string[] = [];
    const runner = Object.create(background);
    runner.openTabAndSendActionToContent = async (url: string) => {
      opened.push(url);
    };
    runner.wait = async () => {};
    runner.setBadgeText = async (text: string) => {
      badgeTexts.push(text);
    };

    // Simulates Prime Gaming's shared-URL model: every internal offer points
    // at the same claim page, so the tab-open loop must collapse to one visit
    // while the badge still reports how many games were actually claimable.
    const sharedLink = 'https://gaming.amazon.com/home';
    await runner.claimGames([
      { title: 'Offer A', platform: Platforms.PrimeGaming, link: sharedLink },
      { title: 'Offer B', platform: Platforms.PrimeGaming, link: sharedLink },
    ] as any);

    expect(opened).toEqual([sharedLink]);
    expect(badgeTexts).toEqual(['2']);
  });

  it('does not dedupe games with distinct links (existing one-link-per-game platforms are unaffected)', async () => {
    const opened: string[] = [];
    const badgeTexts: string[] = [];
    const runner = Object.create(background);
    runner.openTabAndSendActionToContent = async (url: string) => {
      opened.push(url);
    };
    runner.wait = async () => {};
    runner.setBadgeText = async (text: string) => {
      badgeTexts.push(text);
    };

    await runner.claimGames([
      { title: 'A', platform: Platforms.Epic, link: 'https://store.epicgames.com/en-US/p/a' },
      { title: 'B', platform: Platforms.Epic, link: 'https://store.epicgames.com/en-US/p/b' },
    ] as any);

    expect(opened).toHaveLength(2);
    expect(badgeTexts).toEqual(['2']);
  });

  it('spaces tab opens with a wait, but skips waiting after the last one', async () => {
    const opened: string[] = [];
    const waits: number[] = [];
    const runner = Object.create(background);
    runner.openTabAndSendActionToContent = async (url: string) => {
      opened.push(url);
    };
    runner.wait = async (ms: number) => {
      waits.push(ms);
    };
    runner.setBadgeText = async () => {};

    await runner.claimGames([
      { title: 'A', platform: Platforms.Epic, link: 'https://store.epicgames.com/en-US/p/a' },
      { title: 'B', platform: Platforms.Epic, link: 'https://store.epicgames.com/en-US/p/b' },
      { title: 'C', platform: Platforms.Epic, link: 'https://store.epicgames.com/en-US/p/c' },
    ] as any);

    expect(opened).toHaveLength(3);
    // One wait between each pair of opens (3 games -> 2 waits), none trailing.
    expect(waits).toHaveLength(2);
  });
});

describe('checkIndieGalaWheel', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('opens the IndieGala homepage to spin when due and enabled', async () => {
    const opened: { url: string; action: string }[] = [];
    const runner = Object.create(background);
    runner.openTabAndSendActionToContent = async (url: string, action: string) => {
      opened.push({ url, action });
    };

    await runner.checkIndieGalaWheel(true);

    expect(opened).toEqual([{ url: INDIEGALA_WHEEL_URL, action: 'spinWheel' }]);
  });

  it('does nothing when the wheel check is disabled', async () => {
    const opened: string[] = [];
    const runner = Object.create(background);
    runner.openTabAndSendActionToContent = async (url: string) => {
      opened.push(url);
    };

    await runner.checkIndieGalaWheel(false);

    expect(opened).toEqual([]);
  });

  it('does not re-open the tab twice on the same calendar day', async () => {
    const opened: string[] = [];
    const runner = Object.create(background);
    runner.openTabAndSendActionToContent = async (url: string) => {
      opened.push(url);
    };

    await runner.checkIndieGalaWheel(true);
    await runner.checkIndieGalaWheel(true);

    expect(opened).toHaveLength(1);
  });

  it('opens the tab again once the calendar day changes', async () => {
    const opened: string[] = [];
    const runner = Object.create(background);
    runner.openTabAndSendActionToContent = async (url: string) => {
      opened.push(url);
    };
    await setStorageItem('indieGalaWheelLastCheck', new Date('2026-01-01T00:00:00Z').toISOString());

    await runner.checkIndieGalaWheel(true);

    expect(opened).toHaveLength(1);
  });

  it('records the last-check date so the next same-day call is a no-op', async () => {
    const runner = Object.create(background);
    runner.openTabAndSendActionToContent = async () => {};

    await runner.checkIndieGalaWheel(true);

    const lastCheck = await getStorageItem<string>('indieGalaWheelLastCheck');
    expect(lastCheck).not.toBeNull();
    expect(areDatesDifferent(lastCheck!, new Date().toISOString())).toBe(false);
  });

  // Regression: the flag used to be written before the tab/message attempt,
  // so a failed open (tab never loads, content script unreachable) still
  // marked the day as "checked" and silently skipped the wheel until tomorrow.
  it('does not record the last-check date when opening the tab fails, so the next call retries', async () => {
    const runner = Object.create(background);
    runner.openTabAndSendActionToContent = async () => {
      throw new Error('Could not establish connection');
    };

    await expect(runner.checkIndieGalaWheel(true)).rejects.toThrow();
    expect(await getStorageItem<string>('indieGalaWheelLastCheck')).toBeNull();

    const opened: string[] = [];
    runner.openTabAndSendActionToContent = async (url: string) => {
      opened.push(url);
    };
    await runner.checkIndieGalaWheel(true);
    expect(opened).toEqual([INDIEGALA_WHEEL_URL]);
  });
});
