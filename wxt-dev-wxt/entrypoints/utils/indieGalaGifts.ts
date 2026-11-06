import { parse } from "node-html-parser";
import { assertStoreOk } from "@/entrypoints/utils/network.ts";

// A Steam key won on the daily wheel lands in the library's "G. Giveaway"
// tab as a gift link plus a short password (the wheel's own prize text says
// so). The gift's page shows the key. Markup confirmed live, Nov 2026.
export const INDIEGALA_LIBRARY_URL = "https://www.indiegala.com/library";
const INDIEGALA_ORIGIN = "https://www.indiegala.com";

export type IndieGalaGift = {
  url: string;
  password: string | null;
};

// Null when the page has no G. Giveaway tab at all (signed out, or the page
// changed), so a failed read is never taken for "no gift".
export function parseGameplayGifts(html: string): IndieGalaGift[] | null {
  const tab = parse(html).querySelector(".profile-private-page-library-tab-gameplay");
  if (!tab) return null;

  const gifts: IndieGalaGift[] = [];
  for (const item of tab.querySelectorAll(".profile-private-page-library-gift-item")) {
    const href = item.querySelector('a[href*="/gift-bundle/"]')?.getAttribute("href");
    if (!href) continue;
    const passwordCell = item
        .querySelectorAll(".profile-private-page-library-gift-title-item")
        .find((cell) => cell.querySelector(".fa-unlock"));
    const password = passwordCell?.querySelector("span")?.text.trim() || null;
    gifts.push({ url: new URL(href, INDIEGALA_ORIGIN).toString(), password });
  }
  return gifts;
}

// A plain GET the library page answers for the signed-in user, so the
// worker reads it directly; null when the gifts can't be read.
export async function fetchGameplayGifts(fetchImpl: typeof fetch = fetch): Promise<IndieGalaGift[] | null> {
  const response = assertStoreOk(
      await fetchImpl(INDIEGALA_LIBRARY_URL, { credentials: "include" }),
      "IndieGala's library"
  );
  return parseGameplayGifts(await response.text());
}

export type GiftKey = {
  title: string;
  key: string | null;
  isSteam: boolean;
};

const KEY_CONTAINER = ".profile-private-page-library-key-cont";

export function giftKeyContainers(root: Document | HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(KEY_CONTAINER));
}

// One entry per product on the gift page. A key IndieGala hasn't shown yet
// reads as null; its Steam icon is what says the key is for Steam.
export function readGiftKeys(root: Document | HTMLElement): GiftKey[] {
  return giftKeyContainers(root).map((container) => {
    const titleEl = container.querySelector<HTMLElement>(".profile-private-page-library-title-row-full");
    const title = (titleEl?.getAttribute("title") || titleEl?.textContent || "").trim();
    const key = container.querySelector<HTMLInputElement>("input.profile-private-page-library-key-serial")?.value.trim() || null;
    return { title, key, isSteam: container.querySelector(".fa-steam") !== null };
  });
}

// IndieGala's own "get key" control: it calls the page's getSerialKey, which
// fetches the key and shows it in place.
export function findRevealButton(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[onclick*="getSerialKey"]');
}

// getSerialKey reads the gift's password from this field when it needs one.
export function findPasscodeInput(container: HTMLElement): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>("input.profile-private-page-library-passcode");
}

// The wheel's top prize reads "🤩 ✨ Steam key". Only a hint, used to keep a
// pointer to the library when the gift itself can't be found.
export function isSteamKeyPrize(label: string): boolean {
  return /steam\s*key/i.test(label);
}
