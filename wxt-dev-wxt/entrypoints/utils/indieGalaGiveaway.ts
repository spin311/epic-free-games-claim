import { parse } from 'node-html-parser';
import { FreeGame } from "@/entrypoints/types/freeGame.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";

export const INDIEGALA_FREEBIES_URL = "https://freebies.indiegala.com/";

const PRODUCT_ID_RE = /\/imgs\/devs\/freebies\/products\/([0-9a-f-]{36})\//i;

export type IndieGalaFreebie = {
  productId: string;
  slug: string;
  game: FreeGame;
};

// The CDN image URL always embeds the product UUID at this path segment,
// whether we're looking at the freebies index page (per-card thumbnail) or an
// individual product page (hero image, og:image meta tag, etc.) — one regex
// covers both call sites.
export function extractProductId(source: string): string | null {
  const match = PRODUCT_ID_RE.exec(source);
  return match ? match[1] : null;
}

function slugFromHref(href: string): string {
  try {
    const url = new URL(href);
    return url.pathname.replace(/^\/+|\/+$/g, '');
  } catch {
    return '';
  }
}

export function parseFreebiesList(html: string): IndieGalaFreebie[] {
  const root = parse(html);
  const cards = root.querySelectorAll('.products-col-inner');
  const results: IndieGalaFreebie[] = [];

  for (const card of cards) {
    const href = card.querySelector('a.fit-click')?.getAttribute('href') ?? '';
    const slug = slugFromHref(href);
    const title = card.querySelector('.product-title')?.text?.trim() ?? '';
    const img = card.querySelector('img')?.getAttribute('data-img-src') ?? '';
    const productId = img ? extractProductId(img) : null;

    if (!slug || !title || !productId) continue;

    results.push({
      productId,
      slug,
      game: {
        title,
        platform: Platforms.IndieGala,
        link: href,
        img,
      },
    });
  }

  return results;
}

export type ClaimOutcome = "claimed" | "already-claimed" | "unauthorized" | "failed";

// Confirmed live against the real endpoint: a fresh claim returns
// {"status":"ok","code":""}; an already-owned freebie returns
// {"status":"added","code":"e300"}. The endpoint is a Django AJAX view protected by
// the standard double-submit CSRF cookie — the caller reads the csrftoken from the
// page's own csrfmiddlewaretoken hidden input and echoes it back in both header
// spellings the site's own frontend JS sends.
export async function claimFreebie(
    productId: string,
    slug: string,
    csrfToken: string,
    fetchImpl: typeof fetch = fetch
): Promise<ClaimOutcome> {
  const url = `https://freebies.indiegala.com/developers/ajax/add-to-library/${productId}/${slug}/freebies`;

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": csrfToken,
        "X-CSRF-Token": csrfToken,
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    if (response.status === 401 || response.status === 403) return "unauthorized";
    if (!response.ok) return "failed";

    const body = (await response.json().catch(() => null)) as { status?: string } | null;
    if (body?.status === "ok") return "claimed";
    if (body?.status === "added") return "already-claimed";

    console.warn(`[indiegala] unexpected claim response: ${JSON.stringify(body)}`);
    return "failed";
  } catch (error: unknown) {
    console.error("[indiegala] claim request failed:", error);
    return "failed";
  }
}

// The freebies listing is public — no session required to see what's currently
// free — so this can run from the background service worker directly, unlike
// GOG's status check. Throws on a non-ok HTTP response so getFreeGamesList's
// existing per-platform catch block falls back to a real tab.
export async function fetchFreebies(fetchImpl: typeof fetch = fetch): Promise<IndieGalaFreebie[]> {
  const response = await fetchImpl(INDIEGALA_FREEBIES_URL);
  if (!response.ok) {
    throw new Error(`IndieGala freebies page responded ${response.status}`);
  }
  const html = await response.text();
  return parseFreebiesList(html);
}
