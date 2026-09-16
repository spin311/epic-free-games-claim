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
