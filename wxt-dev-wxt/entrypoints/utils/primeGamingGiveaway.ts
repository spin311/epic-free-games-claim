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

// Amazon's card grid lazy-loads images (src is blank/placeholder until a card
// scrolls into view, the real URL living on a data-* attribute instead — the
// same pattern Steam's scraper already handles), and cards only ever carry a
// path-relative or protocol-relative src. Unlike the `link` field, which was
// already resolved against baseUrl, `img` was read raw and used as-is, which
// rendered incorrectly inside the extension popup's own origin.
function readOfferImage(card: Element, baseUrl: string): string {
  const img = card.querySelector('img.tw-image');
  const raw =
      img?.getAttribute('src')?.trim() ||
      img?.getAttribute('data-src')?.trim() ||
      img?.getAttribute('data-lazy')?.trim() ||
      '';
  return raw ? new URL(raw, baseUrl).toString() : '/icon/128.png';
}

export function parseOfferCard(card: Element, baseUrl: string): FreeGame | null {
  const title = card.querySelector('.item-card-details__body__primary')?.textContent?.trim();
  const href = card.querySelector('a')?.getAttribute('href');
  if (!title || !href) return null;

  return {
    title,
    platform: Platforms.PrimeGaming,
    // All internal claims live on the same home page (no per-game claim page
    // exists) — background.ts's claim loop dedupes by this shared link so it
    // opens exactly one tab per claim run, and the content script claims every
    // unclaimed internal offer it finds in that one visit.
    link: PRIME_GAMING_HOME_URL,
    img: readOfferImage(card, baseUrl),
  };
}

export function parseInternalOffers(offerList: Element, baseUrl: string): FreeGame[] {
  const cards = Array.from(offerList.querySelectorAll('.item-card__action'));
  const games: FreeGame[] = [];
  for (const card of cards) {
    if (!isInternalOfferCard(card)) continue;
    const game = parseOfferCard(card, baseUrl);
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

// Confirmed live: cards carry no icon, alt text, title, or aria-label naming
// the redeem platform anywhere on them — the only signal is the claim slug
// itself, which Amazon suffixes with the platform: .../claims/drop-duchy-epic/
// dp/..., .../claims/weakless-gog/dp/..., .../claims/doom-eternal-microsoft/
// dp/.... Also seen: "-aga" (Amazon's own native launcher app), which isn't
// one of the three platforms this extension supports and is deliberately
// left unmatched.
const EXTERNAL_PLATFORM_SLUG_SUFFIXES: [ExternalPlatform, string][] = [
  ["Epic", "-epic"],
  ["GOG", "-gog"],
  ["Windows", "-microsoft"],
];

export function detectExternalPlatform(href: string): ExternalPlatform | null {
  const slug = href.split('/claims/')[1]?.split('/dp/')[0]?.split('?')[0] ?? '';
  for (const [platform, suffix] of EXTERNAL_PLATFORM_SLUG_SUFFIXES) {
    if (slug.endsWith(suffix)) return platform;
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
  if (!title || !href) return null;

  return {
    title,
    // Still tagged PrimeGaming (the source), not the redeem platform — keeps
    // it out of the popup's actual Epic-Store-freebies list, which is a
    // different mechanism entirely.
    platform: Platforms.PrimeGaming,
    link: new URL(href, baseUrl).toString(),
    img: readOfferImage(card, baseUrl),
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
    const href = card.querySelector('a')?.getAttribute('href');
    const platform = href ? detectExternalPlatform(href) : null;
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
// card shows a <p> containing "Collected" text — checked BEFORE clicking so a
// card claimed on a previous run is reported "already-claimed" and left alone,
// rather than clicked again and miscounted as freshly "claimed" every run.
// Polls briefly after a real click because the DOM update isn't necessarily
// synchronous with the click event.
export async function claimOfferCard(
    card: Element,
    clickFn: (el: HTMLElement) => void,
    waitFn: (ms: number) => Promise<void>,
    timeoutMs = 5000,
    pollIntervalMs = 250
): Promise<ClaimOutcome> {
  const button = card.querySelector<HTMLButtonElement>('button[data-a-target="FGWPOffer"]');
  if (!button) return "failed";

  const isCollected = () => Array.from(card.querySelectorAll('p')).some(
      (p) => (p.textContent ?? '').trim().toLowerCase() === 'collected'
  );

  if (isCollected()) return "already-claimed";

  clickFn(button);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isCollected()) return "claimed";
    await waitFn(pollIntervalMs);
  }
  return "failed";
}

// Mirrors the "newGames" filter Epic/Steam/GOG/IndieGala apply in background.ts
// before claiming. Prime Gaming has no background-reachable listing endpoint —
// its offer list only exists after an authenticated page render — so this is
// applied in the content script instead, against whatever the previous run
// persisted, rather than sending every currently-listed offer (including ones
// already claimed on a prior run) off to be claimed again.
export function filterNewOffers(games: FreeGame[], previouslySeen: FreeGame[]): FreeGame[] {
  return games.filter((game) => !previouslySeen.some((seen) => seen?.title === game.title));
}

// Confirmed live: GOG and Windows/Xbox codes use two different shapes, so
// this matches either. A GOG code is a single contiguous uppercase
// alphanumeric string with no separators (e.g. "YRXG7D62AF07ADCE5B", 19
// chars) — requiring both a letter and a digit (via lookaheads) rules out
// plain all-caps words and pure numbers; requiring uppercase rules out the
// lowercase-hex Luna item id that's also present on every details page.
// Length is a guess bounded around the one confirmed example — may need
// widening if other games' codes turn out shorter or longer. A Windows/Xbox
// code is always five uppercase-alphanumeric groups of five separated by
// hyphens (e.g. "DF3FX-WWG3M-WXJKR-94Q6K-H2RMZ") — Microsoft's own redeem
// page confirms this shape ("Enter 25-character code" /
// "xxxxx-xxxxx-xxxxx-xxxxx-xxxxx") — and isn't required to mix letters and
// digits per group, since a real group can be all-letters. No trailing \b:
// confirmed live, Amazon's details page runs the code's text node directly
// into the adjacent "Copy code" button's text with no whitespace between
// them ("...H2RMZCopy code"), and \b can't detect a boundary between two
// word characters ("Z" and "C") — the fixed-width groups already bound the
// match correctly without it.
const REDEEM_CODE_PATTERN = /\b[A-Z0-9]{5}(?:-[A-Z0-9]{5}){4}|\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*[0-9])[A-Z0-9]{12,24}\b/;

export function extractRedeemCode(root: Document | HTMLElement): string | null {
  // Document.textContent is spec'd to return null (only Elements have it) —
  // callers pass `document` itself, so this must fall back to .body. Duck-typed
  // rather than `instanceof Document` to stay realm-agnostic in tests.
  const node = 'body' in root && root.body ? root.body : (root as HTMLElement);
  // Confirmed live: the post-claim /details page shows the code only as a
  // readonly <input>'s value, which textContent never includes. Hidden inputs
  // are skipped — the page also carries a base64 csrf-key one.
  const inputValues = Array.from(node.querySelectorAll<HTMLInputElement>('input:not([type="hidden"])'))
      .map((input) => input.value);
  for (const text of [...inputValues, node.textContent ?? '']) {
    const match = REDEEM_CODE_PATTERN.exec(text);
    if (match) return match[0];
  }
  return null;
}

export type ExternalClaimOutcome = "claimed" | "already-claimed" | "link-required" | "failed";

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
//
// Confirmed live (Oct 2026): a successful claim routes to the offer's own
// ".../dp/{itemId}/details" sub-page ("Success, ..."), so a URL change alone
// no longer implies being sent off to account linking.
//
// Confirmed live: the button renders ~300ms AFTER the header's login signal
// (which is what the caller waits on), so it's polled for rather than looked
// up once — a single lookup always missed it and every offer silently
// "failed". An already-collected offer renders the same button, disabled.
export async function claimExternalOfferPage(
    findGetGameButton: () => HTMLButtonElement | null,
    clickFn: (el: HTMLElement) => void,
    waitFn: (ms: number) => Promise<void>,
    getUrl: () => string,
    timeoutMs = 8000,
    pollIntervalMs = 250
): Promise<ExternalClaimOutcome> {
  const button = await pollFor(findGetGameButton, waitFn, timeoutMs, pollIntervalMs);
  if (!button) return "failed";
  if (button.disabled) return "already-claimed";

  const startUrl = getUrl();
  clickFn(button);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const currentUrl = getUrl();
    if (currentUrl !== startUrl) {
      return isClaimSuccessUrl(startUrl, currentUrl) ? "claimed" : "link-required";
    }
    if (!findGetGameButton()) return "claimed";
    await waitFn(pollIntervalMs);
  }
  return "failed";
}

// Attempt-counted rather than wall-clock-bounded so an injected no-op waitFn
// (tests) still terminates promptly instead of spinning until the deadline.
export async function pollFor<T>(
    find: () => T | null,
    waitFn: (ms: number) => Promise<void>,
    timeoutMs: number,
    pollIntervalMs: number
): Promise<T | null> {
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs));
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const found = find();
    if (found) return found;
    await waitFn(pollIntervalMs);
  }
  return find();
}

function isClaimSuccessUrl(startUrl: string, currentUrl: string): boolean {
  const startPath = new URL(startUrl).pathname.replace(/\/$/, '');
  return new URL(currentUrl).pathname.replace(/\/$/, '') === `${startPath}/details`;
}
