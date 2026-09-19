import { FreeGame } from "@/entrypoints/types/freeGame.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";

export const PRIME_GAMING_HOME_URL = "https://gaming.amazon.com/home";

// Internal (in-store, claim-and-keep-forever) offers expose their claim control
// as a <button data-a-target="FGWPOffer">; external (linked-store) offers expose
// it as an <a data-a-target="FGWPOffer"> that navigates to a redeem/link-account
// flow on another site. Only internal offers are in scope (see spec) — this is
// the exact discriminator vogler/free-games-claimer's prime-gaming.js uses to
// split the two lists.
export function isInternalOfferCard(card: Element): boolean {
  return card.querySelector('button[data-a-target="FGWPOffer"]') !== null;
}

export function parseOfferCard(card: Element): FreeGame | null {
  const title = card.querySelector('.item-card-details__body__primary')?.textContent?.trim();
  const href = card.querySelector('a')?.getAttribute('href');
  const img = card.querySelector('img.tw-image')?.getAttribute('src');
  if (!title || !href) return null;

  return {
    title,
    platform: Platforms.PrimeGaming,
    // All internal claims live on the same home page (no per-game claim page
    // exists) — background.ts's claim loop dedupes by this shared link so it
    // opens exactly one tab per claim run, and the content script claims every
    // unclaimed internal offer it finds in that one visit.
    link: PRIME_GAMING_HOME_URL,
    img: img ?? "/icon/128.png",
  };
}

export function parseInternalOffers(offerList: Element): FreeGame[] {
  const cards = Array.from(offerList.querySelectorAll('.item-card__action'));
  const games: FreeGame[] = [];
  for (const card of cards) {
    if (!isInternalOfferCard(card)) continue;
    const game = parseOfferCard(card);
    if (game) games.push(game);
  }
  return games;
}

// External offers are opt-in per platform (see EXTERNAL_PLATFORM_STORAGE_KEYS)
// since claiming them means navigating to that store's own account and, if
// unlinked, its linking flow — a bigger step than an internal in-place claim.
export type ExternalPlatform = "Epic" | "GOG" | "Windows";

export const EXTERNAL_PLATFORM_STORAGE_KEYS: Record<ExternalPlatform, string> = {
  Epic: "primeGamingClaimEpic",
  GOG: "primeGamingClaimGog",
  Windows: "primeGamingClaimWindows",
};

const EXTERNAL_PLATFORM_PATTERNS: [ExternalPlatform, RegExp][] = [
  ["Epic", /epic\s*games/i],
  ["GOG", /\bgog\b/i],
  ["Windows", /windows|microsoft\s*store/i],
];

// The redeem-platform badge isn't a selector we can pin down without a live
// session, so this matches accessible text (alt/title/aria-label) plus the
// card's own text against known platform names — generic on purpose, so a
// markup tweak to the badge itself doesn't silently stop detection.
export function detectExternalPlatform(card: Element): ExternalPlatform | null {
  const haystack = [
    card.textContent ?? '',
    ...Array.from(card.querySelectorAll('img')).map((img) => img.getAttribute('alt') ?? ''),
    ...Array.from(card.querySelectorAll('[title]')).map((el) => el.getAttribute('title') ?? ''),
    ...Array.from(card.querySelectorAll('[aria-label]')).map((el) => el.getAttribute('aria-label') ?? ''),
  ].join(' ');

  for (const [platform, pattern] of EXTERNAL_PLATFORM_PATTERNS) {
    if (pattern.test(haystack)) return platform;
  }
  return null;
}

// Unlike internal offers, every external offer has its own distinct claims-page
// link (confirmed live: /claims/{slug}/dp/{itemId}?ingress=amzn), so — unlike
// parseOfferCard — the href is actually used, resolved against baseUrl since
// the card only carries a path-relative one.
export function parseExternalOfferCard(card: Element, baseUrl: string): FreeGame | null {
  const title = card.querySelector('.item-card-details__body__primary')?.textContent?.trim();
  const href = card.querySelector('a')?.getAttribute('href');
  const img = card.querySelector('img.tw-image')?.getAttribute('src');
  if (!title || !href) return null;

  return {
    title,
    // Still tagged PrimeGaming (the source), not the redeem platform — keeps
    // it out of the popup's actual Epic-Store-freebies list, which is a
    // different mechanism entirely.
    platform: Platforms.PrimeGaming,
    link: new URL(href, baseUrl).toString(),
    img: img ?? "/icon/128.png",
  };
}

export function parseExternalOffers(
  offerList: Element,
  allowedPlatforms: ReadonlySet<ExternalPlatform>,
  baseUrl: string
): FreeGame[] {
  if (allowedPlatforms.size === 0) return [];

  const cards = Array.from(offerList.querySelectorAll('.item-card__action'));
  const games: FreeGame[] = [];
  for (const card of cards) {
    if (isInternalOfferCard(card)) continue;
    const platform = detectExternalPlatform(card);
    if (!platform || !allowedPlatforms.has(platform)) continue;
    const game = parseExternalOfferCard(card, baseUrl);
    if (game) games.push(game);
  }
  return games;
}

// Confirmed live: an external offer's link opens a /claims/{slug}/dp/{itemId}
// details page, distinct from the /claims/home list page.
export function isOfferDetailsPage(pathname: string): boolean {
  return /\/claims\/[^/]+\/dp\//.test(pathname);
}

// A signed-in non-Prime account is a valid, expected state — not a failure — so
// callers must check this before treating an empty offer list as "nothing to
// claim right now" versus "can't claim anything, ever, on this account."
export function hasPrimeMembership(doc: Document): boolean {
  return !Array.from(doc.querySelectorAll('button')).some(
      (btn) => (btn.textContent ?? '').trim().toLowerCase() === 'try prime'
  );
}

export type ClaimOutcome = "claimed" | "already-claimed" | "failed";

// Confirmed by vogler/free-games-claimer's prime-gaming.js: an already-claimed
// card shows a <p> containing "Collected" text. Polls briefly after the click
// because the DOM update isn't necessarily synchronous with the click event.
export async function claimOfferCard(
    card: Element,
    clickFn: (el: HTMLElement) => void,
    waitFn: (ms: number) => Promise<void>,
    timeoutMs = 5000,
    pollIntervalMs = 250
): Promise<ClaimOutcome> {
  const button = card.querySelector<HTMLButtonElement>('button[data-a-target="FGWPOffer"]');
  if (!button) return "failed";

  clickFn(button);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const collected = Array.from(card.querySelectorAll('p')).some(
        (p) => (p.textContent ?? '').trim().toLowerCase() === 'collected'
    );
    if (collected) return "claimed";
    await waitFn(pollIntervalMs);
  }
  return "failed";
}

// GOG's redeem codes are uppercase, hyphen-separated groups — unverified
// against a live page (no way to see one without actually redeeming), but
// deliberately case-sensitive so it can never match the lowercase-hex Luna
// item id that's also hyphen-separated and present on every details page.
const REDEEM_CODE_PATTERN = /\b[A-Z0-9]{4,8}(?:-[A-Z0-9]{4,8}){2,5}\b/;

export function extractRedeemCode(root: Document | HTMLElement): string | null {
  // Document.textContent is spec'd to return null (only Elements have it) —
  // callers pass `document` itself, so this must fall back to .body. Duck-typed
  // rather than `instanceof Document` to stay realm-agnostic in tests.
  const node = 'body' in root && root.body ? root.body : (root as HTMLElement);
  const match = REDEEM_CODE_PATTERN.exec(node.textContent ?? '');
  return match ? match[0] : null;
}

export type ExternalClaimOutcome = "claimed" | "link-required" | "failed";

// "Get game" on an external offer's details page either claims in place
// (account already linked to that store) or navigates to Amazon's
// account-linking flow — confirmed live, but that flow's own markup/copy
// isn't something confirmable without going through it on a real account, so
// detection is generic: a URL change away from this details page means we
// got redirected somewhere else (treated as "link-required" regardless of
// where — account linking, an external site, anything), while the "Get game"
// button disappearing on the SAME page means it claimed in place. Neither
// non-"claimed" outcome may ever throw — the caller must be able to skip an
// unlinked platform and keep claiming the rest of the run.
export async function claimExternalOfferPage(
    findGetGameButton: () => HTMLElement | null,
    clickFn: (el: HTMLElement) => void,
    waitFn: (ms: number) => Promise<void>,
    getUrl: () => string,
    timeoutMs = 8000,
    pollIntervalMs = 250
): Promise<ExternalClaimOutcome> {
  const button = findGetGameButton();
  if (!button) return "failed";

  const startUrl = getUrl();
  clickFn(button);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (getUrl() !== startUrl) return "link-required";
    if (!findGetGameButton()) return "claimed";
    await waitFn(pollIntervalMs);
  }
  return "failed";
}
