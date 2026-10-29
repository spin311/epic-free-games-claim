// Live, signed-out checks of what the extension relies on at each store: the
// APIs it reads and the page markup its content scripts match, using the
// extension's own parsers. A failure means a store changed and the extension
// likely needs an update (as with Epic's 2026 redesign). Run daily by
// .github/workflows/canary.yml, or by hand with `npm run canary`. Kept out of
// `npm test`: it needs the network and a browser.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { Window } from 'happy-dom';
import { EpicSearchResponse } from '@/entrypoints/types/epicGame';
import {
  EPIC_API_URL,
  epicProductKey,
  formatEpicFreeGame,
  partitionEpicPromotions,
  withEpicEnglishLocale,
} from '@/entrypoints/utils/epicGames';
import { findEpicGetButton, isEpicGameOwned } from '@/entrypoints/utils/helpers';
import { readEpicLoginState } from '@/entrypoints/utils/loginState';
import {
  hasSteamResultList,
  parseSteamFreeGames,
  parseSteamLoginState,
  STEAM_GAMES_URL,
} from '@/entrypoints/utils/steamGames';
import { GOG_STATUS_URL } from '@/entrypoints/utils/gogGiveaway';
import { fetchFreebies, INDIEGALA_FREEBIES_URL } from '@/entrypoints/utils/indieGalaGiveaway';
import { fetchPrimeLookup, LUNA_CLAIMS_URL } from '@/entrypoints/utils/primeGamingApi';
import { fetchWithRetry } from '@/entrypoints/utils/network';

const PAGE_HYDRATION_TIMEOUT_MS = 45_000;
// Same result-row markup as STEAM_GAMES_URL, but always with results (free
// to play rather than free to keep), so the row parser is actually exercised.
const STEAM_FREE_TO_PLAY_URL = "https://store.steampowered.com/search/?maxprice=free&category1=998&ndl=1";

// Same retries as the extension's own requests.
function storeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetchWithRetry(input, init);
}

// The fetched HTML parsed the way a page would be, so the content scripts'
// own DOM helpers can run on it.
const domWindow = new Window();

function parseHtml(html: string): Document {
  return new domWindow.DOMParser().parseFromString(html, 'text/html') as unknown as Document;
}

// A store that refuses the canary's browser outright (bot protection, e.g.
// on a data centre IP) says nothing about whether the extension still works
// for a user, so that's a skip, not a failure.
function isBlockedPage(status: number | undefined, title: string): boolean {
  return status === 403 || status === 429 || /just a moment|access denied|attention required/i.test(title);
}

// Shown as a warning on the GitHub Actions run, so a check that keeps being
// skipped doesn't go unnoticed.
function warnSkipped(message: string): void {
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message);
}

// One real browser for the stores that only answer browsers. Headed:
// confirmed Oct 2026, Epic's store answers any headless Chromium (old or new
// mode) with 403, even from a home connection. CI provides a virtual display
// (xvfb-run, see .github/workflows/canary.yml).
let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch({ headless: false });
});

afterAll(async () => {
  await browser?.close();
  await domWindow.happyDOM.close();
});

// A store answering 403/429 to a plain request is refusing the CI machine,
// not saying it changed (see isBlockedPage).
function skipIfBlocked(response: Response, store: string, skip: () => void): void {
  if (response.status !== 403 && response.status !== 429) return;
  warnSkipped(`${store} refused the canary (${response.status}); its check was skipped`);
  skip();
}

let epicFreeGameLinks: Promise<string[]> | null = null;

function loadEpicFreeGameLinks(): Promise<string[]> {
  epicFreeGameLinks ??= (async () => {
    const response = await storeFetch(EPIC_API_URL);
    expect(response.status, "Epic's free-games API status").toBe(200);
    const data = (await response.json()) as EpicSearchResponse;
    const elements = data?.data?.Catalog?.searchStore?.elements;
    expect(Array.isArray(elements), "Epic's free-games API has a game list").toBe(true);
    return partitionEpicPromotions(elements!).current.map((game) => formatEpicFreeGame(game, false).link);
  })();
  return epicFreeGameLinks;
}

describe('Epic', () => {
  it("free-games API lists this week's games with product links", async () => {
    const links = await loadEpicFreeGameLinks();

    expect(links.length, 'free games listed right now').toBeGreaterThan(0);
    for (const link of links) expect(epicProductKey(link), `product key of ${link}`).not.toBeNull();
  });

  it('a free game\'s page has the "Get" button and login marker the claim script reads', async (ctx) => {
    const [link] = await loadEpicFreeGameLinks();
    if (!link) ctx.skip();
    const page = await browser.newPage();
    try {
      const response = await page.goto(withEpicEnglishLocale(link), { waitUntil: 'domcontentloaded' });
      let doc = parseHtml(await page.content());
      const deadline = Date.now() + PAGE_HYDRATION_TIMEOUT_MS;
      // The nav's login marker hydrates separately from the buy button.
      const isSettled = () => (findEpicGetButton(doc) || isEpicGameOwned(doc)) && readEpicLoginState(doc) !== null;
      while (!isSettled() && Date.now() < deadline) {
        if (isBlockedPage(response?.status(), await page.title())) {
          warnSkipped(`Epic blocked the canary's browser (${response?.status()}, "${await page.title()}"); its page check was skipped`);
          ctx.skip();
        }
        await page.waitForTimeout(1_000);
        doc = parseHtml(await page.content());
      }

      // Signed out, a free game always offers "Get".
      expect(findEpicGetButton(doc), `"Get" button on ${link}`).not.toBeNull();
      expect(readEpicLoginState(doc), 'egs-navigation isloggedin marker').toBe(false);
    } finally {
      await page.close();
    }
  });
});

describe('Steam', () => {
  it('search page has its result list and the header the login check reads', async (ctx) => {
    const response = await storeFetch(STEAM_GAMES_URL);
    skipIfBlocked(response, 'Steam', ctx.skip);
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(hasSteamResultList(html), 'result list').toBe(true);
    expect(parseSteamLoginState(html), 'signed-out header').toBe(false);
  });

  it('result rows still parse into games', async (ctx) => {
    const response = await storeFetch(STEAM_FREE_TO_PLAY_URL);
    skipIfBlocked(response, 'Steam', ctx.skip);
    expect(response.status).toBe(200);

    const games = parseSteamFreeGames(await response.text()) ?? [];

    expect(games.length, 'parsed rows').toBeGreaterThan(0);
    expect(games.every((game) => game.title && game.link.startsWith('https://store.steampowered.com/')), 'title and link per row').toBe(true);
  });
});

describe('GOG', () => {
  // Exactly 401: the extension reads any other answer as "signed in" (see
  // getGogGamesList), and a 403 here would be the CI machine being refused.
  it('giveaway status answers a signed-out request with 401', async (ctx) => {
    const response = await storeFetch(GOG_STATUS_URL, { headers: { Accept: 'application/json' } });
    skipIfBlocked(response, 'GOG', ctx.skip);

    expect(response.status).toBe(401);
  });
});

describe('IndieGala', () => {
  // Can false-alarm on a week with no freebies at all, which hasn't been seen.
  it('freebies page lists freebies the parser recognises', async (ctx) => {
    const response = await storeFetch(INDIEGALA_FREEBIES_URL);
    skipIfBlocked(response, 'IndieGala', ctx.skip);

    const freebies = await fetchFreebies(async () => response);

    expect(freebies.length).toBeGreaterThan(0);
  });
});

describe('Prime Gaming', () => {
  // Amazon answers a non-browser client with 418, so the extension's own
  // lookup code runs with its requests sent from a luna.amazon.com page: a
  // real browser, with the same Origin the extension's request carries.
  function fetchFromPage(page: Page) {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const { signal: _signal, ...plainInit } = init ?? {};
      const result = await page.evaluate(async ([url, requestInit]) => {
        const response = await fetch(url, requestInit as RequestInit);
        return { status: response.status, body: await response.text() };
      }, [String(input), plainInit] as const);
      return new Response(result.body, { status: result.status });
    };
  }

  it('claims lookup answers a signed-out request', async (ctx) => {
    const page = await browser.newPage();
    try {
      const response = await page.goto(LUNA_CLAIMS_URL, { waitUntil: 'domcontentloaded' });
      if (isBlockedPage(response?.status(), await page.title())) {
        warnSkipped(`Amazon blocked the canary's browser (${response?.status()}); the Prime Gaming check was skipped`);
        ctx.skip();
      }

      const lookup = await fetchPrimeLookup(fetchFromPage(page));

      expect(lookup.status).toBe('signed-out');
    } finally {
      await page.close();
    }
  });
});
