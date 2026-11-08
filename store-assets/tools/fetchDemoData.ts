// Fetches today's real giveaways with the extension's own parsers and saves them as
// demoData.json, so the store images show what the popup would show. Signed out.
// Run from wxt-dev-wxt/: npx vite-node --config vitest.canary.config.ts ../store-assets/tools/fetchDemoData.ts
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import { EpicSearchResponse } from '@/entrypoints/types/epicGame';
import { EPIC_API_URL, formatEpicFreeGame, partitionEpicPromotions } from '@/entrypoints/utils/epicGames';
import { parseSteamFreeGames, STEAM_GAMES_URL } from '@/entrypoints/utils/steamGames';
import { fetchFreebies } from '@/entrypoints/utils/indieGalaGiveaway';
import { fetchPrimeLookup, LUNA_CLAIMS_URL, parsePrimeOffers } from '@/entrypoints/utils/primeGamingApi';
import { FreeGame } from '@/entrypoints/types/freeGame';

const OUT_FILE = path.join(import.meta.dirname, 'demoData.json');

async function epic(): Promise<{ current: FreeGame[]; future: FreeGame[] }> {
  const payload = (await (await fetch(EPIC_API_URL)).json()) as EpicSearchResponse;
  const { current, future } = partitionEpicPromotions(payload.data.Catalog.searchStore.elements);
  return {
    current: current.map((game) => formatEpicFreeGame(game, false)),
    future: future.map((game) => formatEpicFreeGame(game, true)),
  };
}

async function steam(): Promise<FreeGame[]> {
  const html = await (await fetch(STEAM_GAMES_URL)).text();
  return parseSteamFreeGames(html) ?? [];
}

async function indieGala(): Promise<FreeGame[]> {
  return (await fetchFreebies()).map((freebie) => freebie.game);
}

// Amazon answers non-browser clients with 418, so the lookup runs from a Luna page
// (as the canary does). Signed out, the lookup says "signed-out", but the GraphQL
// payload still lists the offers (with no per-user eligibility, so none reads as live):
// keep that payload and read it with parsePrimeOffers.
async function prime(page: Page): Promise<FreeGame[]> {
  await page.goto(LUNA_CLAIMS_URL, { waitUntil: 'domcontentloaded' });
  let payload: unknown = null;
  await fetchPrimeLookup(async (input, init) => {
    const { signal: _signal, ...plainInit } = init ?? {};
    const result = await page.evaluate(async ([url, requestInit]) => {
      const response = await fetch(url, requestInit as RequestInit);
      return { status: response.status, body: await response.text(), url: response.url };
    }, [String(input), plainInit] as const);
    if (String(input).endsWith('/graphql')) payload = JSON.parse(result.body);
    return new Response(result.body, { status: result.status });
  });
  return payload ? parsePrimeOffers(payload).map((offer) => offer.game) : [];
}

async function settle<T>(name: string, work: Promise<T>, fallback: T): Promise<T> {
  try {
    return await work;
  } catch (error) {
    console.warn(`${name} failed:`, error instanceof Error ? error.message : error);
    return fallback;
  }
}

const browser = await chromium.launch({ headless: false });
try {
  const page = await browser.newPage();
  const [epicGames, steamGames, indieGalaGames, primeGamingGames] = await Promise.all([
    settle('Epic', epic(), { current: [], future: [] }),
    settle('Steam', steam(), []),
    settle('IndieGala', indieGala(), []),
    settle('Prime Gaming', prime(page), []),
  ]);
  const data = {
    fetchedAt: new Date().toISOString(),
    epicGames: epicGames.current,
    futureGames: epicGames.future,
    steamGames,
    indieGalaGames,
    primeGamingGames,
  };
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(data, null, 2)}\n`);
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) console.log(key, value.length, value.slice(0, 4).map((game) => game.title).join(' | '));
  }
} finally {
  await browser.close();
}
