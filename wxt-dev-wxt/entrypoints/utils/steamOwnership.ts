import { FreeGame } from "@/entrypoints/types/freeGame.ts";

// What Steam's own store reads to mark games "In Library" (confirmed live,
// Nov 2026): rgOwnedApps lists the signed-in account's app ids. A request
// without the session answers with empty lists, which marks nothing.
export const STEAM_USERDATA_URL = "https://store.steampowered.com/dynamicstore/userdata/";

const APP_ID_RE = /\/app\/(\d+)/;

export function steamAppId(link: string): number | null {
  try {
    const match = new URL(link).pathname.match(APP_ID_RE);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

// Null for anything but a list of app ids: an unexpected answer must not be
// read as "owns nothing" or "owns everything".
export function parseSteamOwnedApps(data: unknown): Set<number> | null {
  const owned = (data as { rgOwnedApps?: unknown } | null)?.rgOwnedApps;
  if (!Array.isArray(owned) || !owned.every((id) => typeof id === "number")) return null;
  return new Set(owned);
}

export function markSteamOwned(games: FreeGame[], owned: ReadonlySet<number> | null): FreeGame[] {
  if (!owned) return games;
  return games.map((game) => {
    const appId = steamAppId(game.link);
    return appId !== null && owned.has(appId) ? { ...game, claimed: true } : game;
  });
}
