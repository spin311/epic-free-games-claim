// @vitest-environment node
// Lives under entrypoints/tests/ (not entrypoints/ root) so WXT doesn't treat it
// as a duplicate "background" entrypoint. Node env avoids the esbuild/jsdom clash
// from importing background.ts (which pulls in `#imports`).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { background } from '../background';
import { areDatesDifferent } from '../utils/scheduling';
import { Platforms } from '../enums/platforms';
import { getStorageItem, setStorageItem } from '../hooks/useStorage';
import { INDIEGALA_WHEEL_URL } from '../utils/indieGalaWheel';
import { ExternalPlatform, PRIME_GAMING_HOME_URL } from '../utils/primeGamingGiveaway';
import { GOG_HOME_URL } from '../utils/gogGiveaway';
import { AccessGroup } from '../utils/optionalAccess';

// fake-browser implements neither `permissions` nor `scripting`. Every optional
// host reads as granted by default, so the suites below run with the full
// access those hosts had while they were still required; the access-specific
// tests narrow it per runner via readGrantedAccess.
beforeEach(() => {
  vi.spyOn(fakeBrowser.permissions, 'contains').mockResolvedValue(true as never);
});

function withAccess(runner: { readGrantedAccess: () => Promise<ReadonlySet<AccessGroup>> }, groups: AccessGroup[]) {
  runner.readGrantedAccess = async () => new Set(groups);
}

describe('handleInstall', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  // Regression (3.0 report: "says 0 games claimed ... nothing happened"):
  // a fresh install claimed nothing until the next browser restart, or a day
  // later on the default frequency.
  it('checks right away on a fresh install', async () => {
    const runner = Object.create(background);
    let calls = 0;
    runner.getFreeGamesAndSetOpenedFlag = async () => { calls++; };

    await runner.handleInstall({ reason: 'install' });

    expect(calls).toBe(1);
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

describe('power button', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  function powerRunner() {
    const runner = Object.create(background);
    runner.initializeAlarms = async () => {};
    let checks = 0;
    runner.getFreeGamesAndSetOpenedFlag = async () => { checks++; };
    return { runner, checks: () => checks };
  }

  it('checks right away when switched on', async () => {
    await setStorageItem('active', true);
    const { runner, checks } = powerRunner();

    await runner.handleMessage({ target: 'background', action: 'updateActive' });

    expect(checks()).toBe(1);
  });

  it('does not check when switched off', async () => {
    await setStorageItem('active', false);
    const { runner, checks } = powerRunner();

    await runner.handleMessage({ target: 'background', action: 'updateActive' });

    expect(checks()).toBe(0);
  });

  it('still respects the frequency when switched on again the same day', async () => {
    await setStorageItem('active', true);
    await setStorageItem('lastOpened', new Date().toISOString());
    const { runner, checks } = powerRunner();

    await runner.handleMessage({ target: 'background', action: 'updateActive' });

    expect(checks()).toBe(0);
  });
});

// The background lookup opens no tab; these stand in for it.
const apiFails = async () => { throw new Error('Luna GraphQL responded 403'); };

function primeOffer(title: string, isClaimed: boolean | null, externalPlatform: ExternalPlatform | null) {
  return {
    game: { title, platform: Platforms.PrimeGaming, link: `https://luna.amazon.com/claims/${title}/dp/x`, img: '' },
    isClaimed,
    isLive: true,
    canClaim: null,
    externalPlatform,
  };
}

const okLookup = async () => ({ status: 'ok' as const, offers: [] });

describe('checkPrimeGaming', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  // The whole point of the API lookup: like Epic/Steam, a check opens no tab
  // at all unless something is actually claimable.
  it('checks via the background lookup without opening the claims page', async () => {
    const runner = Object.create(background);
    let lookups = 0;
    runner.loadPrimeLookup = okLookup;
    runner.claimPrimeOffers = async () => { lookups++; };
    const opened: string[] = [];
    runner.openTabAndSendActionToContent = async (url: string) => { opened.push(url); };

    await runner.checkPrimeGaming(true);

    expect(lookups).toBe(1);
    expect(opened).toEqual([]);
  });

  // A tab-free lookup costs two requests, so the Thu/Fri throttle (which
  // exists to limit opened tabs) doesn't apply to it.
  it('runs the background lookup even on a day the claims-page fallback would skip', async () => {
    await setStorageItem('primeGamingLastCheck', new Date('2026-09-18T12:00:00Z').toISOString()); // Friday
    const runner = Object.create(background);
    let lookups = 0;
    runner.loadPrimeLookup = okLookup;
    runner.claimPrimeOffers = async () => { lookups++; };

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-19T12:00:00Z')); // Saturday
    try {
      await runner.checkPrimeGaming(true);
    } finally {
      vi.useRealTimers();
    }

    expect(lookups).toBe(1);
  });

  // Only a failed *lookup* means "use the claims page instead"; a failure
  // after claim tabs may already have opened must not open another one.
  it('does not fall back to the claims page when claiming fails after a successful lookup', async () => {
    const runner = Object.create(background);
    runner.loadPrimeLookup = okLookup;
    runner.claimPrimeOffers = async () => { throw new Error('storage quota'); };
    const opened: string[] = [];
    runner.openTabAndSendActionToContent = async (url: string) => { opened.push(url); };

    await expect(runner.checkPrimeGaming(true)).rejects.toThrow('storage quota');
    expect(opened).toEqual([]);
  });

  it('passes force through so a manual claim skips the retry cooldown', async () => {
    const runner = Object.create(background);
    runner.loadPrimeLookup = okLookup;
    const forced: boolean[] = [];
    runner.claimPrimeOffers = async (_offers: unknown, force: boolean) => { forced.push(force); };

    await runner.checkPrimeGaming(true, true);
    await runner.checkPrimeGaming(true);

    expect(forced).toEqual([true, false]);
  });

  // Confirmed live: signed out, Luna says so directly — no claims-page tab
  // is needed to find out, on any day or even for a manual claim.
  it('records a signed-out account without opening any tab', async () => {
    const runner = Object.create(background);
    runner.loadPrimeLookup = async () => ({ status: 'signed-out' });
    runner.claimPrimeOffers = async () => { throw new Error('must not claim'); };
    const opened: string[] = [];
    runner.openTabAndSendActionToContent = async (url: string) => { opened.push(url); };

    await runner.checkPrimeGaming(true);

    expect(opened).toEqual([]);
    expect(await getStorageItem<boolean>('primeGamingLoggedIn')).toBe(false);
  });

  // The worker's cookie jar can differ from the tabs' (e.g. first-party
  // isolation), so an explicit user action still gets the page's verdict.
  it('still checks the claims page for a signed-out answer on a manual claim', async () => {
    const runner = Object.create(background);
    runner.loadPrimeLookup = async () => ({ status: 'signed-out' });
    const opened: string[] = [];
    runner.openTabAndSendActionToContent = async (url: string) => { opened.push(url); };

    await runner.checkPrimeGaming(true, true);

    expect(opened).toEqual([PRIME_GAMING_HOME_URL]);
  });

  // "Get game" on a non-Prime account only leads to Prime sign-up, so no
  // claim tab may open — and neither may the claims-page fallback.
  it('claims nothing and opens no tab for a signed-in account without Prime', async () => {
    const runner = Object.create(background);
    runner.loadPrimeLookup = async () => ({ status: 'no-prime' });
    runner.claimPrimeOffers = async () => { throw new Error('must not claim'); };
    const opened: string[] = [];
    runner.openTabAndSendActionToContent = async (url: string) => { opened.push(url); };

    await runner.checkPrimeGaming(true, true);

    expect(opened).toEqual([]);
    expect(await getStorageItem<boolean>('primeGamingLoggedIn')).toBe(true);
    // Signed in alone would read "Logged in" in the popup, as if all were fine.
    expect(await getStorageItem<boolean>('primeGamingHasPrime')).toBe(false);
  });

  // A different account may sign in next; its membership isn't known yet.
  it('forgets the Prime membership once signed out', async () => {
    await setStorageItem('primeGamingHasPrime', false);
    const runner = Object.create(background);
    runner.loadPrimeLookup = async () => ({ status: 'signed-out' });

    await runner.checkPrimeGaming(true, false);

    expect(await getStorageItem<boolean>('primeGamingHasPrime')).toBeNull();
  });

  it('records Prime membership once the lookup returns per-user offers', async () => {
    await setStorageItem('primeGamingHasPrime', false);
    const runner = Object.create(background);
    runner.loadPrimeLookup = async () => ({ status: 'ok', offers: [primeOffer('Hue', true, 'Epic')] });
    runner.claimGames = async () => {};

    await runner.checkPrimeGaming(true, true);

    expect(await getStorageItem<boolean>('primeGamingHasPrime')).toBe(true);
  });
});

describe('claimPrimeOffers', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('claims only offers Amazon reports as not yet claimed, on enabled platforms', async () => {
    await setStorageItem('primeGamingClaimGog', true);
    await setStorageItem('primeGamingClaimEpic', false);
    await setStorageItem('primeGamingClaimAmazonGames', false);
    const runner = Object.create(background);
    const claimed: string[][] = [];
    runner.claimGames = async (games: { title: string }[]) => { claimed.push(games.map((g) => g.title)); };

    await runner.claimPrimeOffers([
      primeOffer('DOOM', true, 'GOG'),
      primeOffer('Zoria', false, 'GOG'),
      primeOffer('Hue', false, 'Epic'),
      primeOffer('Wall World 2', false, 'AmazonGames'),
      primeOffer('Mystery', false, null),
    ]);

    expect(claimed).toEqual([['Zoria']]);
  });

  it('claims Amazon Games App offers on a fresh install, with no toggle stored', async () => {
    const runner = Object.create(background);
    const claimed: string[][] = [];
    runner.claimGames = async (games: { title: string }[]) => { claimed.push(games.map((g) => g.title)); };

    await runner.claimPrimeOffers([
      primeOffer('Caravan SandWitch', false, 'AmazonGames'),
      primeOffer('WarBreeds', false, 'GOG'),
    ]);

    expect(claimed).toEqual([['Caravan SandWitch']]);
  });

  it('claims Amazon Games App and Legacy Games offers once their toggles are on', async () => {
    await setStorageItem('primeGamingClaimAmazonGames', true);
    await setStorageItem('primeGamingClaimLegacy', true);
    const runner = Object.create(background);
    const claimed: string[][] = [];
    runner.claimGames = async (games: { title: string }[]) => { claimed.push(games.map((g) => g.title)); };

    await runner.claimPrimeOffers([
      primeOffer('Wall World 2', false, 'AmazonGames'),
      primeOffer('Havendock', true, 'AmazonGames'),
      primeOffer('The Da Vinci Cryptex', false, 'Legacy'),
    ]);

    expect(claimed).toEqual([['Wall World 2', 'The Da Vinci Cryptex']]);
  });

  it('opens nothing when every listed offer is already claimed', async () => {
    await setStorageItem('primeGamingClaimGog', true);
    const runner = Object.create(background);
    let claimCalls = 0;
    runner.claimGames = async () => { claimCalls++; };

    await runner.claimPrimeOffers([primeOffer('DOOM', true, 'GOG'), primeOffer('Weakless', true, 'GOG')]);

    expect(claimCalls).toBe(0);
  });

  it('stores every listed offer for the popup and records the signed-in state', async () => {
    const runner = Object.create(background);
    runner.claimGames = async () => {};

    await runner.claimPrimeOffers([primeOffer('DOOM', true, 'GOG'), primeOffer('Zoria', false, 'GOG')]);

    const stored = await getStorageItem<{ title: string }[]>('primeGamingGames');
    expect(stored?.map((g) => g.title)).toEqual(['DOOM', 'Zoria']);
    expect(await getStorageItem<boolean>('primeGamingLoggedIn')).toBe(true);
  });

  // Regression guard: Amazon keeps an offer "unclaimed" while its claim
  // can't finish (e.g. Epic not linked) — an hourly schedule must not
  // reopen its tab every hour.
  it('does not retry the same unclaimed offer within a day on scheduled runs', async () => {
    await setStorageItem('primeGamingClaimGog', true);
    const runner = Object.create(background);
    const claimed: string[][] = [];
    runner.claimGames = async (games: { title: string }[]) => { claimed.push(games.map((g) => g.title)); };
    const offers = [primeOffer('Zoria', false, 'GOG')];

    await runner.claimPrimeOffers(offers);
    await runner.claimPrimeOffers(offers);

    expect(claimed).toEqual([['Zoria']]);
  });

  it('a manual claim (force) retries it anyway', async () => {
    await setStorageItem('primeGamingClaimGog', true);
    const runner = Object.create(background);
    const claimed: string[][] = [];
    runner.claimGames = async (games: { title: string }[]) => { claimed.push(games.map((g) => g.title)); };
    const offers = [primeOffer('Zoria', false, 'GOG')];

    await runner.claimPrimeOffers(offers);
    await runner.claimPrimeOffers(offers, true);

    expect(claimed).toEqual([['Zoria'], ['Zoria']]);
  });
});

describe('checkPrimeGaming fallback (API lookup failed)', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('does nothing when disabled', async () => {
    const opened: string[] = [];
    const runner = Object.create(background);
    runner.loadPrimeLookup = apiFails;
    runner.openTabAndSendActionToContent = async (url: string) => {
      opened.push(url);
    };

    await runner.checkPrimeGaming(false);

    expect(opened).toEqual([]);
  });

  it('opens the tab when enabled and never checked before', async () => {
    const opened: { url: string; action: string }[] = [];
    const runner = Object.create(background);
    runner.loadPrimeLookup = apiFails;
    runner.openTabAndSendActionToContent = async (url: string, action: string) => {
      opened.push({ url, action });
    };

    await runner.checkPrimeGaming(true);

    expect(opened).toEqual([{ url: PRIME_GAMING_HOME_URL, action: 'getFreeGames' }]);
  });

  it('does not re-open the tab twice on the same calendar day', async () => {
    const opened: string[] = [];
    const runner = Object.create(background);
    runner.loadPrimeLookup = apiFails;
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
    runner.loadPrimeLookup = apiFails;
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
    runner.loadPrimeLookup = apiFails;
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
    runner.loadPrimeLookup = apiFails;
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

  it('runFreeGamesChecks forwards force to getEpicGamesList', async () => {
    const runner = Object.create(background);
    const epicArgs: [boolean, boolean][] = [];
    runner.getEpicGamesList = async (shouldClaim: boolean, force: boolean) => { epicArgs.push([shouldClaim, force]); };
    runner.getSteamGamesList = async () => {};
    runner.checkGog = async () => {};
    runner.checkIndieGalaWheel = async () => {};
    runner.getIndieGalaGamesList = async () => {};
    runner.checkPrimeGaming = async () => {};

    await runner.runFreeGamesChecks(true);
    await runner.runFreeGamesChecks();

    expect(epicArgs).toEqual([[true, true], [true, false]]);
  });

  it('runFreeGamesChecks forwards force to checkGog', async () => {
    await setStorageItem('gogCheck', true);
    const runner = Object.create(background);
    runner.getEpicGamesList = async () => {};
    runner.getSteamGamesList = async () => {};
    runner.checkIndieGalaWheel = async () => {};
    runner.getIndieGalaGamesList = async () => {};
    runner.checkPrimeGaming = async () => {};
    const gogArgs: boolean[] = [];
    runner.checkGog = async (force: boolean) => { gogArgs.push(force); };

    await runner.runFreeGamesChecks(true);
    await runner.runFreeGamesChecks();

    expect(gogArgs).toEqual([true, false]);
  });
});

// Only status and body are read from these.
function respondWith(status: number, body: string) {
  return vi.fn(async () => new Response(body, { status }));
}

describe('login state from the background checks', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Regression (3.0 reports: "won't log in even though I'm logged in"): the
  // worker's own checks reached the signed-in account, but only a store tab
  // ever recorded the session, and no tab opens while nothing is claimable.
  it('records a signed-in GOG session once the worker\'s status check gets through', async () => {
    vi.stubGlobal('fetch', respondWith(404, '{"message":"No active giveaway"}'));
    const runner = Object.create(background);

    await runner.getGogGamesList(true);

    expect(await getStorageItem('gogLoggedIn')).toBe(true);
  });

  it('leaves the GOG login state alone on the worker\'s ambiguous 401', async () => {
    vi.stubGlobal('fetch', respondWith(401, '{"message":"Unauthorized"}'));
    const runner = Object.create(background);

    await expect(runner.getGogGamesList(true)).rejects.toThrow();

    expect(await getStorageItem('gogLoggedIn')).toBeNull();
  });

  it('records a signed-in Steam session from the fetched page, even with no free game', async () => {
    const fetchMock = respondWith(200, '<div id="global_actions"><div id="account_pulldown"></div></div>');
    vi.stubGlobal('fetch', fetchMock);
    const runner = Object.create(background);

    await runner.getSteamGamesList(true);

    expect(await getStorageItem('steamLoggedIn')).toBe(true);
    // An uncredentialed request is anonymous and could never show a session.
    expect(fetchMock.mock.calls[0]).toEqual([expect.any(String), expect.objectContaining({ credentials: 'include' })]);
  });

  // Same reasoning as GOG's 401: the worker's request is the one that may
  // lack the cookie, so only a real Steam tab may record "signed out".
  it('does not record a signed-out Steam session from the worker\'s fetch', async () => {
    vi.stubGlobal('fetch', respondWith(200, '<div id="global_actions"><a>sign in</a></div>'));
    const runner = Object.create(background);

    await runner.getSteamGamesList(true);

    expect(await getStorageItem('steamLoggedIn')).toBeNull();
  });
});

describe('checkGog', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  const unauthorized = async () => { throw new Error('GOG giveaway status requires a signed-in session'); };

  function gogRunner(lookup: () => Promise<void>) {
    const runner = Object.create(background);
    runner.getGogGamesList = lookup;
    const opened: { url: string; action: string }[] = [];
    runner.openTabAndSendActionToContent = async (url: string, action: string) => {
      opened.push({ url, action });
    };
    return { runner, opened };
  }

  it('opens no tab when the worker\'s own check succeeds', async () => {
    const { runner, opened } = gogRunner(async () => {});

    await runner.checkGog();

    expect(opened).toEqual([]);
  });

  it('falls back to a real gog.com tab when the worker\'s check is unauthorized', async () => {
    const { runner, opened } = gogRunner(unauthorized);

    await runner.checkGog();

    expect(opened).toEqual([{ url: GOG_HOME_URL, action: 'getFreeGames' }]);
  });

  // Regression (3.0): gog.com opened on every scheduled run, hourly at the
  // shortest setting, with nothing to claim.
  it('does not reopen the fallback tab on the same calendar day', async () => {
    const { runner, opened } = gogRunner(unauthorized);

    await runner.checkGog();
    await runner.checkGog();

    expect(opened).toHaveLength(1);
  });

  it('opens no fallback tab once a gog.com page has reported the account signed out', async () => {
    await setStorageItem('gogLoggedIn', false);
    const { runner, opened } = gogRunner(unauthorized);

    await runner.checkGog();

    expect(opened).toEqual([]);
  });

  it('opens the fallback tab regardless when forced (manual claim or a "Log in" click)', async () => {
    await setStorageItem('gogLoggedIn', false);
    const { runner, opened } = gogRunner(unauthorized);

    await runner.checkGog();
    await runner.checkGog(true);
    await runner.checkGog(true);

    expect(opened).toHaveLength(2);
  });

  it('does not record the fallback date when opening the tab fails, so the next run retries', async () => {
    const { runner } = gogRunner(unauthorized);
    runner.openTabAndSendActionToContent = async () => { throw new Error('tab never loaded'); };

    await expect(runner.checkGog()).rejects.toThrow();

    expect(await getStorageItem('gogLastTabCheck')).toBeNull();
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

  it('opens a single gog.com tab even when that tab itself fails', async () => {
    const runner = Object.create(background);
    runner.getGogGamesList = async () => { throw new Error('GOG giveaway status requires a signed-in session'); };
    const opened: string[] = [];
    runner.openTabAndSendActionToContent = async (url: string) => {
      opened.push(url);
      throw new Error('tab never loaded');
    };

    await runner.checkPlatformLogin(Platforms.GOG);

    expect(opened).toEqual([GOG_HOME_URL]);
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

// A feature is effective only when its flag is on AND its optional hosts are
// granted. Updating from a release without these hosts leaves every flag as it
// was but grants nothing, so the flag alone must never be enough.
describe('optional host access', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  function checksRunner() {
    const runner = Object.create(background);
    runner.getEpicGamesList = async () => {};
    runner.getSteamGamesList = async () => {};
    const calls: Record<string, unknown[]> = { gog: [], wheel: [], indieGala: [], prime: [] };
    runner.getGogGamesList = async (shouldClaim: boolean) => { calls.gog.push(shouldClaim); };
    runner.checkIndieGalaWheel = async (shouldSpin: boolean) => { calls.wheel.push(shouldSpin); };
    runner.getIndieGalaGamesList = async (shouldClaim: boolean) => { calls.indieGala.push(shouldClaim); };
    runner.checkPrimeGaming = async (shouldCheck: boolean) => { calls.prime.push(shouldCheck); };
    const opened: string[] = [];
    runner.openTabAndSendActionToContent = async (url: string) => { opened.push(url); };
    return { runner, calls, opened };
  }

  it('runFreeGamesChecks skips GOG without gog access, even though its toggle defaults on', async () => {
    const { runner, calls, opened } = checksRunner();
    withAccess(runner, []);

    await runner.runFreeGamesChecks();

    expect(calls.gog).toEqual([]);
    expect(opened).toEqual([]);
  });

  it('runFreeGamesChecks neither spins, lists nor claims IndieGala without indieGala access', async () => {
    await setStorageItem('indieGalaCheck', true);
    await setStorageItem('indieGalaWheelCheck', true);
    const { runner, calls, opened } = checksRunner();
    withAccess(runner, ['gog', 'primeGaming']);

    await runner.runFreeGamesChecks();

    expect(calls.wheel).toEqual([false]);
    expect(calls.indieGala).toEqual([]);
    expect(opened).toEqual([]);
  });

  it('runFreeGamesChecks does not check Prime Gaming without primeGaming access', async () => {
    await setStorageItem('primeGamingCheck', true);
    const { runner, calls } = checksRunner();
    withAccess(runner, ['gog', 'indieGala']);

    await runner.runFreeGamesChecks();

    expect(calls.prime).toEqual([false]);
  });

  it('runFreeGamesChecks runs every enabled platform once its access is granted', async () => {
    await setStorageItem('gogCheck', true);
    await setStorageItem('indieGalaCheck', true);
    await setStorageItem('indieGalaWheelCheck', true);
    await setStorageItem('primeGamingCheck', true);
    const { runner, calls } = checksRunner();
    withAccess(runner, ['gog', 'indieGala', 'primeGaming']);

    await runner.runFreeGamesChecks();

    expect(calls).toEqual({ gog: [true], wheel: [true], indieGala: [true], prime: [true] });
  });

  // Claiming reveals the Amazon code; without gog access there is no script on
  // gog.com to redeem it, so the code would be spent and lost.
  it('claimPrimeOffers skips store-linked offers whose redeem store lacks access', async () => {
    await setStorageItem('primeGamingClaimGog', true);
    await setStorageItem('primeGamingClaimWindows', true);
    await setStorageItem('primeGamingClaimLegacy', true);
    await setStorageItem('primeGamingClaimEpic', true);
    const runner = Object.create(background);
    withAccess(runner, ['primeGaming', 'legacyGames']);
    const claimed: string[][] = [];
    runner.claimGames = async (games: { title: string }[]) => { claimed.push(games.map((g) => g.title)); };

    await runner.claimPrimeOffers([
      primeOffer('Zoria', false, 'GOG'),
      primeOffer('Halo', false, 'Windows'),
      primeOffer('Cryptex', false, 'Legacy'),
      primeOffer('Hue', false, 'Epic'),
      primeOffer('Wall World 2', false, 'AmazonGames'),
    ]);

    expect(claimed).toEqual([['Cryptex', 'Hue', 'Wall World 2']]);
  });

  it('claimFreeGames drops claims-page Prime offers whose redeem store lacks access', async () => {
    const runner = Object.create(background);
    withAccess(runner, ['primeGaming']);
    const claimed: string[][] = [];
    runner.claimGames = async (games: { title: string }[]) => { claimed.push(games.map((g) => g.title)); };
    const game = (title: string, platform: Platforms, link: string) => ({ title, platform, link, img: '' });

    await runner.handleMessage({
      target: 'background',
      action: 'claimFreeGames',
      data: {
        loggedIn: true,
        freeGames: [
          game('Internal', Platforms.PrimeGaming, PRIME_GAMING_HOME_URL),
          game('Zoria', Platforms.PrimeGaming, 'https://luna.amazon.com/claims/zoria-gog/dp/abc?ingress=amzn'),
          game('Hue', Platforms.PrimeGaming, 'https://luna.amazon.com/claims/hue-epic/dp/def'),
          game('Doom', Platforms.Epic, 'https://store.epicgames.com/en-US/p/doom'),
        ],
      },
    });

    expect(claimed).toEqual([['Internal', 'Hue', 'Doom']]);
  });

  it('claimFreeGames claims nothing from Prime Gaming once its own access is gone', async () => {
    const runner = Object.create(background);
    withAccess(runner, []);
    const claimed: string[][] = [];
    runner.claimGames = async (games: { title: string }[]) => { claimed.push(games.map((g) => g.title)); };

    await runner.handleMessage({
      target: 'background',
      action: 'claimFreeGames',
      data: { loggedIn: true, freeGames: [{ title: 'Internal', platform: Platforms.PrimeGaming, link: PRIME_GAMING_HOME_URL, img: '' }] },
    });

    expect(claimed.flat()).toEqual([]);
  });

  it('checkPlatformLogin does nothing for a platform without access', async () => {
    const runner = Object.create(background);
    withAccess(runner, []);
    runner.getGogGamesList = async () => { throw new Error('must not check'); };
    runner.checkPrimeGaming = async () => { throw new Error('must not check'); };
    const opened: string[] = [];
    runner.openTabAndSendActionToContent = async (url: string) => { opened.push(url); };

    await runner.checkPlatformLogin(Platforms.GOG);
    await runner.checkPlatformLogin(Platforms.PrimeGaming);

    expect(opened).toEqual([]);
  });

  it('checkPlatformLogin still checks Steam and Epic, which need no optional access', async () => {
    const runner = Object.create(background);
    withAccess(runner, []);
    let calls = 0;
    runner.getSteamGamesList = async () => { calls++; };

    await runner.checkPlatformLogin(Platforms.Steam);

    expect(calls).toBe(1);
  });
});

describe('syncContentScripts', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  function stubScripting(registered: { id: string }[] = []) {
    const registeredIds: string[][] = [];
    vi.spyOn(fakeBrowser.scripting, 'getRegisteredContentScripts').mockResolvedValue(registered as never);
    vi.spyOn(fakeBrowser.scripting, 'registerContentScripts').mockImplementation((async (scripts: { id: string }[]) => {
      registeredIds.push(scripts.map((script) => script.id));
    }) as never);
    vi.spyOn(fakeBrowser.scripting, 'unregisterContentScripts').mockResolvedValue(undefined as never);
    return registeredIds;
  }

  it('registers the runtime content scripts of the granted groups', async () => {
    const registeredIds = stubScripting();
    const runner = Object.create(background);
    withAccess(runner, ['gog', 'microsoft']);

    await runner.syncContentScripts();

    expect(registeredIds).toEqual([['gog', 'microsoft']]);
  });

  // Called from main() and from permissions.onAdded at once when a grant wakes
  // the worker: overlapping syncs would both register the same id and fail.
  it('serializes overlapping syncs so a script is never registered twice', async () => {
    const registeredIds = stubScripting();
    const runner = Object.create(background);
    withAccess(runner, ['gog']);
    let registered: { id: string }[] = [];
    vi.mocked(fakeBrowser.scripting.getRegisteredContentScripts).mockImplementation((async () => registered) as never);
    vi.mocked(fakeBrowser.scripting.registerContentScripts).mockImplementation((async (scripts: { id: string }[]) => {
      registeredIds.push(scripts.map((script) => script.id));
      registered = [...registered, ...scripts];
    }) as never);

    await Promise.all([runner.syncContentScripts(), runner.syncContentScripts()]);

    expect(registeredIds).toEqual([['gog']]);
  });

  it('logs a failing sync instead of rejecting, so background start-up carries on', async () => {
    vi.spyOn(fakeBrowser.scripting, 'getRegisteredContentScripts').mockRejectedValue(new Error('scripting unavailable') as never);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const runner = Object.create(background);
    withAccess(runner, ['gog']);

    await expect(runner.syncContentScripts()).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('completePendingAccessRequest', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  // The popup may close while its prompt is open (Firefox does), so nothing
  // there is left to turn the flag on when the grant lands.
  it('turns on the toggle whose request the grant answered, and forgets the request', async () => {
    await setStorageItem('pendingAccessRequest', { toggle: 'primeGamingClaimGog', requestedAt: new Date().toISOString() });
    const runner = Object.create(background);
    withAccess(runner, ['primeGaming', 'gog']);

    await runner.completePendingAccessRequest();

    expect(await getStorageItem<boolean>('primeGamingClaimGog')).toBe(true);
    expect(await getStorageItem('pendingAccessRequest')).toBeNull();
  });

  it('leaves the toggle alone while its hosts are still not all granted', async () => {
    await setStorageItem('pendingAccessRequest', { toggle: 'primeGamingClaimGog', requestedAt: new Date().toISOString() });
    const runner = Object.create(background);
    withAccess(runner, ['gog']);

    await runner.completePendingAccessRequest();

    expect(await getStorageItem<boolean>('primeGamingClaimGog')).toBeNull();
  });

  // The popup turns the wheel on with IndieGala; a request finished by the
  // background must do the same.
  it('also turns on the toggles enabled together with the requested one', async () => {
    await setStorageItem('pendingAccessRequest', { toggle: 'indieGalaCheck', requestedAt: new Date().toISOString() });
    const runner = Object.create(background);
    withAccess(runner, ['indieGala']);

    await runner.completePendingAccessRequest();

    expect(await getStorageItem<boolean>('indieGalaCheck')).toBe(true);
    expect(await getStorageItem<boolean>('indieGalaWheelCheck')).toBe(true);
  });

  it('does nothing without a pending request', async () => {
    const runner = Object.create(background);
    withAccess(runner, ['primeGaming', 'gog']);

    await runner.completePendingAccessRequest();

    expect(await getStorageItem<boolean>('primeGamingClaimGog')).toBeNull();
  });
});

// A minimal freeGamesPromotions payload: each title free right now.
function epicPromotions(...slugs: string[]) {
  const elements = slugs.map((slug) => ({
    title: slug,
    catalogNs: { mappings: [{ pageSlug: slug }] },
    price: { totalPrice: { discountPrice: 0 } },
    promotions: {
      promotionalOffers: [{ promotionalOffers: [{ startDate: '2026-10-29T15:00:00Z', endDate: '2026-11-05T15:00:00Z' }] }],
    },
  }));
  return respondWith(200, JSON.stringify({ data: { Catalog: { searchStore: { elements } } } }));
}

const epicLink = (slug: string) => `https://store.epicgames.com/en-US/p/${slug}`;

describe('getEpicGamesList claiming', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function epicRunner(openKeys: string[] = []) {
    const runner = Object.create(background);
    const claimed: string[][] = [];
    runner.claimGames = async (games: { link: string }[]) => { claimed.push(games.map((g) => g.link)); };
    runner.openEpicProductKeys = async () => new Set(openKeys);
    return { runner, claimed };
  }

  // Regression (3.0 report: "0 games claimed"): a game counted as done as soon
  // as it was listed, so one failed claim tab (e.g. Epic's redesigned buy
  // button) meant it was never tried again that week.
  it('claims a game that was listed before but never confirmed claimed', async () => {
    vi.stubGlobal('fetch', epicPromotions('home-19212a'));
    await setStorageItem('epicGames', [{ title: 'home-19212a', link: epicLink('home-19212a') }]);
    const { runner, claimed } = epicRunner();

    await runner.getEpicGamesList(true);

    expect(claimed).toEqual([[epicLink('home-19212a')]]);
  });

  it('skips games a claim tab confirmed as claimed or already owned', async () => {
    vi.stubGlobal('fetch', epicPromotions('home-19212a', 'sker-ritual-aac702'));
    await setStorageItem('epicClaimed', ['p/home-19212a']);
    const { runner, claimed } = epicRunner();

    await runner.getEpicGamesList(true);

    expect(claimed).toEqual([[epicLink('sker-ritual-aac702')]]);
  });

  it('retries an unconfirmed game at most once a day on automatic runs', async () => {
    vi.stubGlobal('fetch', epicPromotions('home-19212a'));
    const { runner, claimed } = epicRunner();

    await runner.getEpicGamesList(true);
    await runner.getEpicGamesList(true);

    expect(claimed).toHaveLength(1);
  });

  it('a manual claim (force) retries it anyway', async () => {
    vi.stubGlobal('fetch', epicPromotions('home-19212a'));
    const { runner, claimed } = epicRunner();

    await runner.getEpicGamesList(true);
    await runner.getEpicGamesList(true, true);

    expect(claimed).toHaveLength(2);
  });

  // Each claim tab would only land on Epic's login page.
  it('claims nothing automatically while Epic reports the account signed out', async () => {
    vi.stubGlobal('fetch', epicPromotions('home-19212a'));
    await setStorageItem('epicLoggedIn', false);
    const { runner, claimed } = epicRunner();

    await runner.getEpicGamesList(true);
    expect(claimed).toEqual([]);

    await runner.getEpicGamesList(true, true);
    expect(claimed).toHaveLength(1);
  });

  it('still lists the free games for the popup when nothing is claimed', async () => {
    vi.stubGlobal('fetch', epicPromotions('home-19212a'));
    const { runner, claimed } = epicRunner();

    await runner.getEpicGamesList(false);

    expect(claimed).toEqual([]);
    expect((await getStorageItem<{ link: string }[]>('epicGames'))?.map((g) => g.link)).toEqual([epicLink('home-19212a')]);
  });

  // A tab left open on a captcha is still the user's to finish; another one
  // for the same game would only pile up next to it.
  it('does not open another tab for a game whose claim tab is still open, even when forced', async () => {
    vi.stubGlobal('fetch', epicPromotions('home-19212a', 'sker-ritual-aac702'));
    const { runner, claimed } = epicRunner(['p/home-19212a']);

    await runner.getEpicGamesList(true, true);

    expect(claimed).toEqual([[epicLink('sker-ritual-aac702')]]);
  });

  it('forgets confirmed games once Epic stops listing them', async () => {
    vi.stubGlobal('fetch', epicPromotions('home-19212a'));
    await setStorageItem('epicClaimed', ['p/last-weeks-game', 'p/home-19212a']);
    const { runner } = epicRunner();

    await runner.getEpicGamesList(true);

    expect(await getStorageItem('epicClaimed')).toEqual(['p/home-19212a']);
  });
});
