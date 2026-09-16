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
