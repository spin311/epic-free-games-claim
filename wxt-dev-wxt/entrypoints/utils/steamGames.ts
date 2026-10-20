import {parse} from 'node-html-parser';
import {FreeGame} from "@/entrypoints/types/freeGame.ts";
import {Platforms} from "@/entrypoints/enums/platforms.ts";

export const STEAM_GAMES_URL =
    "https://store.steampowered.com/search/?sort_by=Price_ASC&maxprice=free&category1=998&specials=1&ndl=1";

// Parses the free-games search page; null when the result container has no rows
// (the page layout changed or the search returned nothing).
export function parseSteamFreeGames(html: string): FreeGame[] | null {
  const root = parse(html);

  const resolveUrl = (u: string) =>
      u ? new URL(u, 'https://store.steampowered.com').toString() : '';

  const container = root.querySelector('div#search_result_container');
  const freeGameNodes = container
      ? container.querySelectorAll('a.search_result_row')
      : [];
  if (freeGameNodes.length === 0) return null;

  const gamesArr: FreeGame[] = [];

  for (const node of freeGameNodes) {
    const href = node.getAttribute('href') ?? '';
    const title = node.querySelector('span.title')?.text?.trim() ?? '';

    const imgEl = node.querySelector('img');
    const imgRaw =
        imgEl?.getAttribute('src')?.trim() ||
        imgEl?.getAttribute('data-src')?.trim() ||
        imgEl?.getAttribute('data-lazy')?.trim() ||
        '';

    if (href && title) {
      gamesArr.push({
        link: resolveUrl(href),
        img: imgRaw ? resolveUrl(imgRaw) : '',
        title,
        platform: Platforms.Steam,
      });
    }
    }

  return gamesArr;
}

// Runs in the page's MAIN world via scripting.executeScript, so it is
// serialised and must stay self-contained (no references to module scope).
export function addToCartInMainWorld(appId: number): boolean {
    const fn =
        (window as any).addToCart ||
        (window as any).AddToCart ||
        (window as any).g_cartAddToCart ||
        (window as any).g_AddToCart;

    if (typeof fn === "function") {
      try {
        fn(appId);
        return true;
      } catch (e) {
        console.error("addToCart call failed:", e);
        return false;
      }
    }

    // fallback: simulate click in MAIN world
    const el = document.querySelector(
        `div.btn_addtocart a[href^="javascript:addToCart(${appId})"]`
    );
    if (el) {
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return true;
    }

    console.warn("No addToCart function or button found for", appId);
    return false;
}
