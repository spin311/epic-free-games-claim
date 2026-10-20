import {EpicElement, EpicKeyImage} from "@/entrypoints/types/epicGame.ts";
import {FreeGame} from "@/entrypoints/types/freeGame.ts";
import {Platforms} from "@/entrypoints/enums/platforms.ts";

export const EPIC_API_URL = "https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=en-US";
export const EPIC_GAMES_URL =
    "https://store.epicgames.com/";
// Product pages are built on store.epicgames.com rather than
// www.epicgames.com/store/...: the www form is a redirect, and Epic bounces
// some slugs onto /site/... paths that 404 *and* fall outside the Epic content
// script's match patterns, so the claim tab ends up with no script injected.
export const EPIC_PRODUCT_BASE = "https://store.epicgames.com/en-US";
export const EPIC_FREE_GAMES_URL = "https://store.epicgames.com/en-US/free-games";

// Force Epic claim pages into English (?lang=en-US) so the content script can match
// confirmation buttons ("Add to library", etc.) by text regardless of the user's
// account language. Non-Epic URLs (e.g. Steam) are returned unchanged.
export function withEpicEnglishLocale(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith("epicgames.com")) {
      parsed.searchParams.set("lang", "en-US");
      return parsed.toString();
    }
  } catch {
    // Not an absolute URL — leave it as-is.
  }
  return url;
}

// Epic exposes the same product under several slug fields and they are not
// interchangeable. `productSlug` is a legacy *path* that often carries a
// "/home" suffix (e.g. "cardpocalypse/home"), which produces a 404 product URL;
// the page-mapping tables carry the bare slug ("cardpocalypse"). Prefer those,
// and normalise whatever we get so a stray path segment can never leak into the
// URL again.
export function resolveEpicSlug(game: EpicElement): string {
  const candidates = [
    ...(game.catalogNs?.mappings ?? []).map((m) => m?.pageSlug),
    ...(game.offerMappings ?? []).map((m) => m?.pageSlug),
    game.productSlug,
  ];

  for (const candidate of candidates) {
    const slug = normalizeEpicSlug(candidate);
    if (slug) return slug;
  }
  return "";
}

function normalizeEpicSlug(raw: string | undefined | null): string {
  const trimmed = (raw ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "";
  // "cardpocalypse/home" -> "cardpocalypse". Any other multi-segment slug is
  // reduced to its first segment for the same reason: /p/ takes one segment.
  return trimmed.split("/")[0] ?? "";
}

// Splits an Epic search payload into the games that are free right now and the
// ones announced as free next. A game must appear in exactly one bucket — Epic
// can report both a current and an upcoming free offer for the same title
// during the weekly changeover, and listing it twice made the popup show
// duplicates.
export function partitionEpicPromotions(games: EpicElement[]): {
  current: EpicElement[];
  future: EpicElement[];
} {
  const current = games.filter((game) =>
      game.price?.totalPrice?.discountPrice === 0 &&
      (game.promotions?.promotionalOffers?.length ?? 0) > 0
  );
  const currentTitles = new Set(current.map((game) => game.title));

  const future = games.filter((game) =>
      !currentTitles.has(game.title) &&
      game.promotions?.upcomingPromotionalOffers?.[0]?.promotionalOffers?.[0]
          ?.discountSetting?.discountPercentage === 0
  );

  return { current, future };
}

export function formatEpicFreeGame(game: EpicElement, future: boolean): FreeGame {
  const slug = resolveEpicSlug(game);

  const isEpicBundle =
      Array.isArray(game.categories) &&
      game.categories.some((c) => c?.path === "bundles");

  const path = isEpicBundle ? "bundle" : "p";

  const promo =
      (future
          ? game.promotions?.upcomingPromotionalOffers?.[0]?.promotionalOffers?.[0]
          : game.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0]) ?? {};

  return {
    title: game.title ?? "",
    platform: Platforms.Epic,
    // No resolvable slug would mean a bare "/p/" 404, so fall back to the
    // free-games hub: still claimable, and the content script runs there.
    link: slug ? `${EPIC_PRODUCT_BASE}/${path}/${slug}` : EPIC_FREE_GAMES_URL,
    img:
        game.keyImages?.find((img: EpicKeyImage) => img.type === "Thumbnail")?.url ||
        game.keyImages?.[0]?.url ||
        "/icon/128.png",
    description: game.description ?? "",
    startDate: new Date(promo.startDate ?? 0).toISOString(),
    endDate: new Date(promo.endDate ?? 0).toISOString(),
    future,
  };
}
