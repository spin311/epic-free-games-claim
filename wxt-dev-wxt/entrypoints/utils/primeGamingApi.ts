import { FreeGame } from "@/entrypoints/types/freeGame.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";
import { detectExternalPlatform, ExternalPlatform } from "@/entrypoints/utils/primeGamingGiveaway.ts";
import type { Browser } from "wxt/browser";

// Background-only Prime Gaming lookup, so a check opens no tab unless there's
// something to claim — the same fetch-first shape as Epic/Steam. Everything
// here was confirmed live (Oct 2026) against the Luna claims page's own
// traffic: it loads its offer list from one GraphQL query, authenticated by
// the session cookies plus a csrf token embedded in the page's HTML.

export const LUNA_CLAIMS_URL = "https://luna.amazon.com/claims/home";
export const LUNA_GRAPHQL_URL = "https://luna.amazon.com/graphql";
const LUNA_ORIGIN = "https://luna.amazon.com";
const LUNA_CLAIM_BASE = "https://luna.amazon.com/claims";
const REQUEST_TIMEOUT_MS = 15_000;

// Confirmed live: these exact selections return per-user eligibility.
// Trimmed variants (e.g. a literal pageSize, no operation name) came back
// with every eligibility null, so treat this as known-good and change it only
// with a live re-check.
const FREE_GAMES_QUERY = `query PrimeFreeGames($pageSize: Int) {
  games: items(collectionType: FREE_GAMES, pageSize: $pageSize) {
    items {
      id isFGWP isDirectEntitlement
      assets { title externalClaimLink cardMedia { defaultMedia { src1x } } }
      offers { id endTime offerSelfConnection { eligibility { offerState isClaimed } } }
    }
  }
}`;

export type PrimeOffer = {
  game: FreeGame;
  // null = Amazon returned no per-user eligibility, so the state is unknown.
  isClaimed: boolean | null;
  isLive: boolean;
  externalPlatform: ExternalPlatform | null;
};

// Confirmed live: <input type='hidden' name='csrf-key' value='...' />.
export function extractCsrfToken(html: string): string | null {
  const input = html.match(/<input[^>]*name=["']csrf-key["'][^>]*>/i)?.[0];
  return input?.match(/value=["']([^"']+)["']/i)?.[1] ?? null;
}

// Only an eligibility with a real boolean isClaimed counts as known: a
// partial schema change must read as "unknown", never as "unclaimed".
type KnownEligibility = { isLive: boolean; isClaimed: boolean };

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function readKnownEligibilities(item: Record<string, unknown>): KnownEligibility[] {
  const offers = Array.isArray(item.offers) ? item.offers : [];
  const known: KnownEligibility[] = [];
  for (const offer of offers) {
    const eligibility = asObject(asObject(asObject(offer)?.offerSelfConnection)?.eligibility);
    if (typeof eligibility?.isClaimed !== "boolean") continue;
    known.push({ isLive: eligibility.offerState === "LIVE", isClaimed: eligibility.isClaimed });
  }
  return known;
}

// externalClaimLink is gaming.amazon.com/{slug}/dp/{itemId}?ref_=...; the
// claim page the content script handles is luna.amazon.com/claims/{slug}/dp/{itemId}.
function toLunaClaimLink(externalClaimLink: string): string | null {
  try {
    const path = new URL(externalClaimLink).pathname.replace(/^\/claims/, "").replace(/\/$/, "");
    return /^\/[^/]+\/dp\/[^/]+$/.test(path) ? `${LUNA_CLAIM_BASE}${path}` : null;
  } catch {
    return null;
  }
}

function parseItem(raw: unknown): PrimeOffer | null {
  const item = asObject(raw);
  const assets = asObject(item?.assets);
  const title = typeof assets?.title === "string" ? assets.title.trim() : "";
  if (!item || !title) return null;

  // No usable claim link: still listed for the popup, but with no page to
  // claim it on it stays unclaimable (externalPlatform null).
  const claimLink = typeof assets?.externalClaimLink === "string" ? toLunaClaimLink(assets.externalClaimLink) : null;
  const img = asObject(asObject(assets?.cardMedia)?.defaultMedia)?.src1x;
  const known = readKnownEligibilities(item);
  // An item can carry an old (claimed) offer next to the live one — the live
  // one is what a claim would act on.
  const live = known.filter((e) => e.isLive);
  const relevant = live.length > 0 ? live : known;

  return {
    game: {
      title,
      platform: Platforms.PrimeGaming,
      link: claimLink ?? LUNA_CLAIMS_URL,
      img: typeof img === "string" && img ? img : "/icon/128.png",
    },
    isClaimed: relevant.length === 0 ? null : relevant.some((e) => e.isClaimed),
    isLive: live.length > 0,
    externalPlatform: claimLink ? detectExternalPlatform(claimLink) : null,
  };
}

// Throws on an unexpected shape (an error response, a schema change) rather
// than returning [] — "no offers" must stay distinguishable from "couldn't
// read the offers", so the caller can fall back to the claims page instead.
export function parsePrimeOffers(payload: unknown): PrimeOffer[] {
  const items = asObject(asObject(asObject(payload)?.data)?.games)?.items;
  if (!Array.isArray(items)) throw new Error("Prime Gaming offers response had an unexpected shape");
  return items.map(parseItem).filter((offer): offer is PrimeOffer => offer !== null);
}

// Amazon's own isClaimed is the source of truth — unlike Epic/Steam's
// "not in last run's list", an offer whose claim failed last time is retried
// until Amazon reports it claimed.
export function selectClaimableOffers(
    offers: PrimeOffer[],
    allowedPlatforms: ReadonlySet<ExternalPlatform>
): FreeGame[] {
  return offers
      .filter((offer) => offer.isClaimed === false && offer.isLive)
      .filter((offer) => offer.externalPlatform !== null && allowedPlatforms.has(offer.externalPlatform))
      .map((offer) => offer.game);
}

// Amazon's isClaimed is retried until true, so an offer whose claim can't
// finish (e.g. an unlinked Epic account, where the tab is left on Amazon's
// linking page) would otherwise reopen on every scheduled run — hourly, at
// the shortest setting. Automatic runs retry an offer at most this often.
export const CLAIM_RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type ClaimAttempts = Record<string, string>;

export function excludeRecentlyAttempted(
    games: FreeGame[],
    attempts: Readonly<ClaimAttempts>,
    now: Date,
    intervalMs = CLAIM_RETRY_INTERVAL_MS
): FreeGame[] {
  return games.filter((game) => {
    const last = attempts[game.link];
    return !last || now.getTime() - new Date(last).getTime() >= intervalMs;
  });
}

// Returns a new record: attempted links stamped with `now`, entries for
// offers no longer listed dropped so the record can't grow forever.
export function updateClaimAttempts(
    attempts: Readonly<ClaimAttempts>,
    attempted: FreeGame[],
    listed: FreeGame[],
    now: Date
): ClaimAttempts {
  const listedLinks = new Set(listed.map((game) => game.link));
  const kept = Object.entries(attempts).filter(([link]) => listedLinks.has(link));
  return {
    ...Object.fromEntries(kept),
    ...Object.fromEntries(attempted.map((game) => [game.link, now.toISOString()])),
  };
}

// Throws on any failure (signed out, markup/API change, transport error) so
// the background can fall back to the old open-the-claims-page check.
export async function fetchPrimeOffers(fetchImpl: typeof fetch = fetch): Promise<PrimeOffer[]> {
  const page = await fetchImpl(LUNA_CLAIMS_URL, { credentials: "include", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!page.ok) throw new Error(`Luna claims page responded ${page.status}`);
  const csrfToken = extractCsrfToken(await page.text());
  if (!csrfToken) throw new Error("Luna claims page had no csrf token");

  const response = await fetchImpl(LUNA_GRAPHQL_URL, {
    method: "POST",
    credentials: "include",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      "content-type": "application/json",
      "csrf-token": csrfToken,
      "client-id": "CarboniteApp",
      "prime-gaming-language": "en-US",
    },
    body: JSON.stringify({ operationName: "PrimeFreeGames", variables: { pageSize: 999 }, query: FREE_GAMES_QUERY }),
  });
  if (!response.ok) throw new Error(`Luna GraphQL responded ${response.status}`);

  // At least one known claim state is the evidence this is a signed-in,
  // trustworthy answer; an empty list or all-unknown can't be told apart from
  // a signed-out/odd response and must not wipe the popup's list.
  const offers = parsePrimeOffers(JSON.parse(await response.text()));
  if (!offers.some((offer) => offer.isClaimed !== null)) {
    throw new Error("Prime Gaming offers carried no per-user claim state (signed out?)");
  }
  return offers;
}

export const LUNA_ORIGIN_RULE_ID = 1;

type SessionRulesApi = {
  updateSessionRules(options: Browser.declarativeNetRequest.UpdateRuleOptions): Promise<void>;
};

// Confirmed live: Luna's GraphQL rejects any foreign Origin with 403 "Invalid
// CORS request", and a fetch can't set Origin itself. This rewrites it — for
// this extension's own requests only (initiatorDomains), never for any
// website's, so it can't widen what other pages can do against Luna. Session
// rules don't survive a browser restart, so this is (re)installed before
// every lookup; replacing the rule by id keeps that idempotent.
export async function ensureLunaOriginRule(
    dnr: SessionRulesApi | undefined,
    extensionHost: string
): Promise<void> {
  if (!dnr?.updateSessionRules) throw new Error("declarativeNetRequest is unavailable in this browser");
  // The values are the spec's wire strings; WXT's generated typings model
  // them as ambient enums that can't be referenced as values, hence the cast.
  const rule = {
    id: LUNA_ORIGIN_RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "origin", operation: "set", value: LUNA_ORIGIN }],
    },
    condition: {
      urlFilter: `|${LUNA_GRAPHQL_URL}|`,
      initiatorDomains: [extensionHost],
      resourceTypes: ["xmlhttprequest"],
      requestMethods: ["post"],
    },
  } as unknown as Browser.declarativeNetRequest.Rule;
  await dnr.updateSessionRules({ removeRuleIds: [LUNA_ORIGIN_RULE_ID], addRules: [rule] });
}
