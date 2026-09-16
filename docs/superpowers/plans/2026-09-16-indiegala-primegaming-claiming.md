# IndieGala + Prime Gaming Claiming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic free-game claiming for IndieGala's weekly freebies and Amazon
Prime Gaming's monthly internal (keep-forever) claims, following the exact module
pattern already established for GOG (content script + testable util module + shared
background/popup wiring).

**Architecture:** Two independent, parallel modules. IndieGala talks directly to a
discovered JSON endpoint (like GOG) — no DOM scraping needed for claiming. Prime
Gaming has no public API and must scrape/click a client-rendered React page (like
Epic/Steam), scoped to internal (in-store) offers only. Both plug into the existing
`background.ts` fan-out/claim loop, `loginState.ts`, and the popup's Settings/GamesList
components without changing their shape.

**Tech Stack:** WXT (WebExtension Toolkit), React 19, TypeScript, Vitest, node-html-parser.

**Spec:** `docs/superpowers/specs/2026-09-16-indiegala-primegaming-claiming-design.md`

## Global Constraints

- Branch base: `origin/feat/gog-and-login-status` (PR #25) — this plan's types
  (`LoginState`, `LOGIN_STATE_KEYS`), components (`LoginStatus.tsx`), and
  `background.ts` shape all assume that branch's code exists. If PR #25 has merged to
  `main` by the time this plan executes, branch from `main` instead; the referenced
  file shapes are identical either way.
- All verification gates from `CLAUDE.md` must stay green after every task:
  `npm run compile` (0 errors), `npm test`, `npm run build` and `npm run build:firefox`.
- Follow existing immutability convention: no in-place mutation of storage arrays or
  objects — always build new arrays (see `getGogGamesList`'s `[...gogGames]`-free,
  replace-not-mutate style).
- IndieGala's freebies listing is **public** (no auth needed to see current offers);
  claiming requires an authenticated session. Prime Gaming requires an authenticated
  session for both listing and claiming (no public API/page exists at all).
- Scope is locked per the spec: IndieGala freebies only (not the coin-based
  giveaways/lottery system); Prime Gaming internal claims only (not external-linked
  games, not in-game loot/DLC).

---

## Phase 1: IndieGala

### Task 1: IndieGala freebies parsing

**Files:**
- Create: `wxt-dev-wxt/entrypoints/utils/indieGalaGiveaway.ts`
- Test: `wxt-dev-wxt/entrypoints/utils/indieGalaGiveaway.test.ts`

**Interfaces:**
- Produces: `INDIEGALA_FREEBIES_URL: string`, `type IndieGalaFreebie = { productId: string; slug: string; game: FreeGame }`, `parseFreebiesList(html: string): IndieGalaFreebie[]`, `extractProductId(source: string): string | null`

- [ ] **Step 1: Write the failing tests**

```typescript
// wxt-dev-wxt/entrypoints/utils/indieGalaGiveaway.test.ts
import { describe, it, expect } from 'vitest';
import { extractProductId, parseFreebiesList } from './indieGalaGiveaway';
import { Platforms } from '@/entrypoints/enums/platforms.ts';

const CARD_HTML = (slug: string, uuid: string, title: string) => `
<div class="col-3 products-col">
  <div class="products-col-inner box-shadow-1 relative">
    <a class="fit-click" href="https://freebies.indiegala.com/${slug}" title="Go to ${title} page"></a>
    <figure class="product-img">
      <img alt="${title} product image" class="display-none async-img-load" data-img-src="https://www.indiegalacdn.com/imgs/devs/freebies/products/${uuid}/prodmain/1759920499.png"/>
    </figure>
    <figcaption class="overflow-auto product-title-cont">
      <div class="left product-title">${title}</div>
      <div class="right product-get-btn">get</div>
    </figcaption>
  </div>
</div>`;

describe('extractProductId', () => {
  it('extracts the UUID from an indiegalacdn product image URL', () => {
    const uuid = 'a1db8f5b-f9c3-4004-84fc-ce90d0bb5872';
    const src = `https://www.indiegalacdn.com/imgs/devs/freebies/products/${uuid}/prodmain/1759920499.png`;
    expect(extractProductId(src)).toBe(uuid);
  });

  it('finds the UUID even inside a full HTML document', () => {
    const uuid = 'a1db8f5b-f9c3-4004-84fc-ce90d0bb5872';
    const html = `<meta content="https://www.indiegalacdn.com/imgs/devs/freebies/products/${uuid}/prodmain/1.png?v=1" property="og:image"/>`;
    expect(extractProductId(html)).toBe(uuid);
  });

  it('returns null when no product image URL is present', () => {
    expect(extractProductId('<div>nothing here</div>')).toBeNull();
  });
});

describe('parseFreebiesList', () => {
  it('parses a single freebie card into title, link, image, and product id', () => {
    const uuid = 'a1db8f5b-f9c3-4004-84fc-ce90d0bb5872';
    const html = CARD_HTML('leaper', uuid, 'Leaper');

    const freebies = parseFreebiesList(html);

    expect(freebies).toHaveLength(1);
    expect(freebies[0]).toEqual({
      productId: uuid,
      slug: 'leaper',
      game: {
        title: 'Leaper',
        platform: Platforms.IndieGala,
        link: 'https://freebies.indiegala.com/leaper',
        img: `https://www.indiegalacdn.com/imgs/devs/freebies/products/${uuid}/prodmain/1759920499.png`,
      },
    });
  });

  it('parses multiple cards on the same page', () => {
    const html = [
      CARD_HTML('battle-ram', '25bb9ba0-56e4-4c68-92b1-55bf43db7a52', 'Battle Ram'),
      CARD_HTML('leaper', 'a1db8f5b-f9c3-4004-84fc-ce90d0bb5872', 'Leaper'),
    ].join('\n');

    const freebies = parseFreebiesList(html);

    expect(freebies.map((f) => f.slug)).toEqual(['battle-ram', 'leaper']);
  });

  it('returns an empty array when no cards are present', () => {
    expect(parseFreebiesList('<div>no freebies today</div>')).toEqual([]);
  });

  it('skips a card missing a title or product id rather than throwing', () => {
    const html = `
      <div class="products-col-inner">
        <a class="fit-click" href="https://freebies.indiegala.com/broken"></a>
        <figure class="product-img"><img data-img-src="https://www.indiegalacdn.com/imgs/broken.png"/></figure>
        <figcaption><div class="left product-title"></div></figcaption>
      </div>`;
    expect(parseFreebiesList(html)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd wxt-dev-wxt && npx vitest run entrypoints/utils/indieGalaGiveaway.test.ts`
Expected: FAIL — `Cannot find module './indieGalaGiveaway'`

- [ ] **Step 3: Write the implementation**

```typescript
// wxt-dev-wxt/entrypoints/utils/indieGalaGiveaway.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd wxt-dev-wxt && npx vitest run entrypoints/utils/indieGalaGiveaway.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add wxt-dev-wxt/entrypoints/utils/indieGalaGiveaway.ts wxt-dev-wxt/entrypoints/utils/indieGalaGiveaway.test.ts
git commit -m "feat: parse IndieGala freebies listing"
```

---

### Task 2: IndieGala claim request

**Files:**
- Modify: `wxt-dev-wxt/entrypoints/utils/indieGalaGiveaway.ts`
- Modify: `wxt-dev-wxt/entrypoints/utils/indieGalaGiveaway.test.ts`

**Interfaces:**
- Consumes: nothing new from other tasks
- Produces: `type ClaimOutcome = "claimed" | "already-claimed" | "unauthorized" | "failed"`, `claimFreebie(productId: string, slug: string, csrfToken: string, fetchImpl?: typeof fetch): Promise<ClaimOutcome>`, `fetchFreebies(fetchImpl?: typeof fetch): Promise<IndieGalaFreebie[]>`

This task implements the claim request captured live against the real endpoint:
`POST https://freebies.indiegala.com/developers/ajax/add-to-library/<productId>/<slug>/freebies`
with `X-CSRFToken`/`X-CSRF-Token` headers, empty body. Confirmed responses:
`{"status":"ok","code":""}` on a fresh claim, `{"status":"added","code":"e300"}` when
already owned.

- [ ] **Step 1: Write the failing tests**

Append to `indieGalaGiveaway.test.ts`:

```typescript
import { claimFreebie, fetchFreebies } from './indieGalaGiveaway';

// Builds a minimal Response-like stub; the helpers only touch these members.
function response(status: number, body: unknown, ok = status >= 200 && status < 300) {
  return {
    ok,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    json: () => Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body),
  } as Response;
}

describe('claimFreebie', () => {
  const CLAIM_URL = 'https://freebies.indiegala.com/developers/ajax/add-to-library/a1db8f5b-f9c3-4004-84fc-ce90d0bb5872/leaper/freebies';

  it('reports a fresh claim as "claimed"', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { status: 'ok', code: '' }));
    const outcome = await claimFreebie('a1db8f5b-f9c3-4004-84fc-ce90d0bb5872', 'leaper', 'tok123', fetchImpl);
    expect(outcome).toBe('claimed');
    expect(fetchImpl).toHaveBeenCalledWith(CLAIM_URL, expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      headers: expect.objectContaining({ 'X-CSRFToken': 'tok123', 'X-CSRF-Token': 'tok123' }),
    }));
  });

  it('reports an already-owned freebie as "already-claimed"', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { status: 'added', code: 'e300' }));
    const outcome = await claimFreebie('a1db8f5b-f9c3-4004-84fc-ce90d0bb5872', 'leaper', 'tok123', fetchImpl);
    expect(outcome).toBe('already-claimed');
  });

  it('reports 401/403 as "unauthorized"', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(401, { detail: 'not signed in' }, false));
    expect(await claimFreebie('id', 'slug', 'tok', fetchImpl)).toBe('unauthorized');
  });

  it('reports any other non-ok status as "failed"', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(500, 'server error', false));
    expect(await claimFreebie('id', 'slug', 'tok', fetchImpl)).toBe('failed');
  });

  it('reports an unrecognized status body as "failed" rather than throwing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { status: 'weird' }));
    expect(await claimFreebie('id', 'slug', 'tok', fetchImpl)).toBe('failed');
  });

  it('never throws — a network error is reported as "failed"', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    expect(await claimFreebie('id', 'slug', 'tok', fetchImpl)).toBe('failed');
  });
});

describe('fetchFreebies', () => {
  it('parses the freebies page into a list', async () => {
    const html = `<div class="products-col-inner">
      <a class="fit-click" href="https://freebies.indiegala.com/leaper"></a>
      <figure><img data-img-src="https://www.indiegalacdn.com/imgs/devs/freebies/products/a1db8f5b-f9c3-4004-84fc-ce90d0bb5872/prodmain/1.png"/></figure>
      <figcaption><div class="product-title">Leaper</div></figcaption>
    </div>`;
    const fetchImpl = vi.fn().mockResolvedValue(response(200, html));
    const freebies = await fetchFreebies(fetchImpl);
    expect(freebies).toHaveLength(1);
    expect(freebies[0].slug).toBe('leaper');
  });

  it('throws on a non-ok HTTP response so the caller can fall back to a tab', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(503, 'down', false));
    await expect(fetchFreebies(fetchImpl)).rejects.toThrow('503');
  });
});
```

Add `vi` to the existing `import { describe, it, expect } from 'vitest';` line (becomes
`import { describe, it, expect, vi } from 'vitest';`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd wxt-dev-wxt && npx vitest run entrypoints/utils/indieGalaGiveaway.test.ts`
Expected: FAIL — `claimFreebie`/`fetchFreebies` not exported

- [ ] **Step 3: Write the implementation**

Append to `indieGalaGiveaway.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd wxt-dev-wxt && npx vitest run entrypoints/utils/indieGalaGiveaway.test.ts`
Expected: PASS (all tests, ~15 total)

- [ ] **Step 5: Commit**

```bash
git add wxt-dev-wxt/entrypoints/utils/indieGalaGiveaway.ts wxt-dev-wxt/entrypoints/utils/indieGalaGiveaway.test.ts
git commit -m "feat: add IndieGala claim request"
```

---

### Task 3: IndieGala platform + login state

**Files:**
- Modify: `wxt-dev-wxt/entrypoints/enums/platforms.ts`
- Modify: `wxt-dev-wxt/entrypoints/utils/loginState.ts`
- Modify: `wxt-dev-wxt/entrypoints/utils/loginState.test.ts`

**Interfaces:**
- Consumes: `Platforms` enum (adding a member)
- Produces: `Platforms.IndieGala`, `readIndieGalaLoginState(doc: Document): LoginState`, `LOGIN_STATE_KEYS[Platforms.IndieGala]`

The login signal is confirmed live (unauthenticated capture): the header always
renders `<div class="header-top-user">`, and when signed out it contains a child
`<div class="header-top-notlogged">`. This checks only for that known signed-out
marker's absence, so it works regardless of what the signed-in markup looks like.

- [ ] **Step 1: Write the failing tests**

Append to `loginState.test.ts` (inside the existing file, following the
`readSteamLoginState` describe block's pattern):

```typescript
import { readIndieGalaLoginState } from './loginState';

describe('readIndieGalaLoginState', () => {
  it('is false when the signed-out marker is present', () => {
    const doc = docFrom('<div class="header-top-user"><div class="header-top-notlogged">Login</div></div>');
    expect(readIndieGalaLoginState(doc)).toBe(false);
  });

  it('is true when the container is present without the signed-out marker', () => {
    const doc = docFrom('<div class="header-top-user"><div class="header-top-logged">Me</div></div>');
    expect(readIndieGalaLoginState(doc)).toBe(true);
  });

  it('is null when the header has not rendered yet', () => {
    const doc = docFrom('<div>no header here</div>');
    expect(readIndieGalaLoginState(doc)).toBeNull();
  });
});
```

Also add a case to the existing `readLoginState` describe block:

```typescript
  it('dispatches to the IndieGala reader', () => {
    const doc = docFrom('<div class="header-top-user"><div class="header-top-logged">Me</div></div>');
    expect(readLoginState(Platforms.IndieGala, doc)).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd wxt-dev-wxt && npx vitest run entrypoints/utils/loginState.test.ts`
Expected: FAIL — `Platforms.IndieGala` is undefined, `readIndieGalaLoginState` not exported

- [ ] **Step 3: Write the implementation**

In `platforms.ts`:

```typescript
export enum Platforms {
    Steam = "Steam",
    Epic = "Epic Games",
    GOG = "GOG",
    IndieGala = "IndieGala"
}
```

In `loginState.ts`, add to `LOGIN_STATE_KEYS`:

```typescript
export const LOGIN_STATE_KEYS: Record<Platforms, string> = {
    [Platforms.Epic]: "epicLoggedIn",
    [Platforms.Steam]: "steamLoggedIn",
    [Platforms.GOG]: "gogLoggedIn",
    [Platforms.IndieGala]: "indieGalaLoggedIn",
};
```

Add the reader function (near `readSteamLoginState`):

```typescript
// The header container is present on every page; when signed out it wraps a
// child .header-top-notlogged element (confirmed live, unauthenticated). Only
// that known signed-out signal is checked, so this doesn't depend on knowing
// what the signed-in markup looks like.
export function readIndieGalaLoginState(doc: Document): LoginState {
  const userCont = doc.querySelector('.header-top-user');
  if (!userCont) return null;
  return !userCont.querySelector('.header-top-notlogged');
}
```

Update `readLoginState`'s switch:

```typescript
export function readLoginState(platform: Platforms, doc: Document): LoginState {
    switch (platform) {
        case Platforms.Epic:
            return readEpicLoginState(doc);
        case Platforms.Steam:
            return readSteamLoginState(doc);
        case Platforms.IndieGala:
            return readIndieGalaLoginState(doc);
        default:
            return null;
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd wxt-dev-wxt && npx vitest run entrypoints/utils/loginState.test.ts`
Expected: PASS

- [ ] **Step 5: Run full type-check to confirm the new enum member doesn't break existing exhaustive switches**

Run: `cd wxt-dev-wxt && npm run compile`
Expected: 0 errors. (If `LOGIN_STATE_KEYS` or any other `Record<Platforms, ...>` is
missing the new member, TypeScript will fail here — fix by adding the missing entry.)

- [ ] **Step 6: Commit**

```bash
git add wxt-dev-wxt/entrypoints/enums/platforms.ts wxt-dev-wxt/entrypoints/utils/loginState.ts wxt-dev-wxt/entrypoints/utils/loginState.test.ts
git commit -m "feat: add IndieGala platform and login-state detection"
```

---

### Task 4: IndieGala content script

**Files:**
- Create: `wxt-dev-wxt/entrypoints/indiegala.content.ts`

**Interfaces:**
- Consumes: `onClaimMessage` (`contentMessaging.ts`), `detectAndRecordLoginState` (`loginState.ts`), `claimFreebie`, `extractProductId`, `fetchFreebies` (`indieGalaGiveaway.ts`), `incrementCounter`, `waitForPageLoad` (`helpers.ts`)
- Produces: nothing consumed by later tasks (registered via WXT's content-script matching, invoked by `background.ts` through `openTabAndSendActionToContent`)

Content scripts in this codebase aren't unit tested directly (see `epic.content.ts`,
`gog.content.ts` — no corresponding `.content.test.ts` files); their logic is either
pure-and-extracted-to-a-tested-util (done in Tasks 1–3) or orchestration verified
manually against the live site (Task 7). This task is a single implementation step.

- [ ] **Step 1: Write the content script**

```typescript
// wxt-dev-wxt/entrypoints/indiegala.content.ts
import { oncePerPageRun } from "@/entrypoints/utils/oncePerPageRun.ts";
import { browser } from "wxt/browser";
import { FreeGamesResponse } from "@/entrypoints/types/freeGamesResponse.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";
import { setStorageItem } from "@/entrypoints/hooks/useStorage.ts";
import { onClaimMessage } from "@/entrypoints/utils/contentMessaging.ts";
import { detectAndRecordLoginState } from "@/entrypoints/utils/loginState.ts";
import { claimFreebie, extractProductId, fetchFreebies } from "@/entrypoints/utils/indieGalaGiveaway.ts";
import { incrementCounter, waitForPageLoad } from "@/entrypoints/utils/helpers.ts";

// Listing is public and normally satisfied by background.ts's direct fetch; this
// script exists as the fallback path (guaranteed cookies for claiming, and a
// backup listing path if the background fetch ever fails) — the same role
// gog.content.ts plays for GOG.
export default defineContentScript({
    matches: ['https://freebies.indiegala.com/*'],
    main(_: any) {
        if (!oncePerPageRun('_myIndieGalaContentScriptInjected' as keyof Window)) {
            return;
        }
        onClaimMessage({ getFreeGames: getFreeGamesList, claimGames: claimCurrentFreebie });

        async function getFreeGamesList() {
            await waitForPageLoad();
            const loginState = await detectAndRecordLoginState(Platforms.IndieGala);

            let freebies;
            try {
                freebies = await fetchFreebies();
            } catch (error: unknown) {
                console.error("[indiegala] freebies list fetch failed:", error);
                return;
            }
            if (freebies.length === 0) return;

            const gamesArr = freebies.map((f) => f.game);
            await setStorageItem("indieGalaGames", gamesArr);

            const freeGamesResponse: FreeGamesResponse = {
                freeGames: gamesArr,
                loggedIn: loginState !== false,
            };
            await browser.runtime.sendMessage({
                target: 'background',
                action: 'claimFreeGames',
                data: freeGamesResponse,
            });
        }

        // Runs on the individual product page background.ts opened (game.link),
        // so the product id and CSRF token are read straight from the live DOM —
        // no extra fetch needed.
        async function claimCurrentFreebie() {
            await waitForPageLoad();
            void detectAndRecordLoginState(Platforms.IndieGala);

            const csrfToken = document.querySelector('input[name="csrfmiddlewaretoken"]')?.getAttribute('value');
            const productId = extractProductId(document.documentElement.outerHTML);
            const slug = location.pathname.replace(/^\/+|\/+$/g, '');

            if (!csrfToken || !productId || !slug) {
                console.error("[indiegala] could not determine product identity from the current page");
                return;
            }

            const outcome = await claimFreebie(productId, slug, csrfToken);
            if (outcome === "claimed") await incrementCounter();
        }
    },
});
```

- [ ] **Step 2: Type-check**

Run: `cd wxt-dev-wxt && npm run compile`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add wxt-dev-wxt/entrypoints/indiegala.content.ts
git commit -m "feat: add IndieGala content script"
```

---

### Task 5: Wire IndieGala into background.ts and manifest

**Files:**
- Modify: `wxt-dev-wxt/entrypoints/background.ts`
- Modify: `wxt-dev-wxt/wxt.config.ts`

**Interfaces:**
- Consumes: `fetchFreebies`, `INDIEGALA_FREEBIES_URL` (`indieGalaGiveaway.ts`)
- Produces: `background.getIndieGalaGamesList(shouldClaim?: boolean): Promise<void>` (mirrors `getGogGamesList`'s shape, used only internally by `getFreeGamesList`)

- [ ] **Step 1: Add the import**

In `background.ts`, add alongside the existing `gogGiveaway.ts` import:

```typescript
import {fetchFreebies, INDIEGALA_FREEBIES_URL} from "@/entrypoints/utils/indieGalaGiveaway.ts";
```

- [ ] **Step 2: Add `getIndieGalaGamesList`**

Add this method to the `background` object, directly after `getGogGamesList`:

```typescript
  // Freebies listing is public, so unlike GOG this practically never throws for
  // an auth reason — only network/HTTP failures reach the catch block in
  // getFreeGamesList, which falls back to a real tab.
  async getIndieGalaGamesList(shouldClaim: boolean = true) {
    const freebies = await fetchFreebies();
    if (freebies.length === 0) return;

    const gamesArr: FreeGame[] = freebies.map((f) => f.game);
    const currFreeGames: FreeGame[] = await getStorageItem("indieGalaGames") || [];
    const newGames = gamesArr.filter((game) =>
        !currFreeGames.some((g) => g?.title === game.title)
    );

    await setStorageItem("indieGalaGames", gamesArr);
    if (shouldClaim && newGames.length > 0) {
      await this.claimGames(newGames);
    }
  },
```

- [ ] **Step 3: Wire it into `getFreeGamesList`**

Modify `getFreeGamesList` to destructure `indieGalaCheck` and add the fan-out block,
following the exact GOG precedent:

```typescript
  async getFreeGamesList() {
    const { steamCheck, epicCheck, gogCheck, indieGalaCheck } = await getStorageItems([
      "steamCheck", "epicCheck", "gogCheck", "indieGalaCheck",
    ]);
    const claimGog = gogCheck !== false;
    const claimIndieGala = indieGalaCheck !== false;
    try {
      await this.getEpicGamesList(epicCheck);
    } catch (e) {
      console.error("getEpicGamesList failed:", e);
      if (epicCheck) await this.openTabAndSendActionToContent(EPIC_GAMES_URL, "getFreeGames");
    }
    try {
      await this.getSteamGamesList(steamCheck);
    } catch (e) {
      console.error("getSteamGamesList failed:", e);
      if (steamCheck) await this.openTabAndSendActionToContent(STEAM_GAMES_URL, "getFreeGames");
    }
    try {
      await this.getGogGamesList(claimGog);
    } catch (e) {
      console.error("getGogGamesList failed:", e);
      if (claimGog) await this.openTabAndSendActionToContent(GOG_HOME_URL, "getFreeGames");
    }
    try {
      await this.getIndieGalaGamesList(claimIndieGala);
    } catch (e) {
      console.error("getIndieGalaGamesList failed:", e);
      if (claimIndieGala) await this.openTabAndSendActionToContent(INDIEGALA_FREEBIES_URL, "getFreeGames");
    }
  },
```

- [ ] **Step 4: Add to `clearGamesList`**

```typescript
  async clearGamesList() {
    await setStorageItem("epicGames", []);
    await setStorageItem("futureGames", []);
    await setStorageItem("steamGames", []);
    await setStorageItem("gogGames", []);
    await setStorageItem("indieGalaGames", []);
  },
```

- [ ] **Step 5: Add the host permission**

In `wxt.config.ts`, add to `host_permissions`:

```typescript
    host_permissions: [
      'https://store.steampowered.com/*',
      "https://store-site-backend-static-ipv4.ak.epicgames.com/*",
      "https://www.gog.com/*",
      "https://freebies.indiegala.com/*"
    ],
```

- [ ] **Step 6: Type-check, then run the full test suite**

Run: `cd wxt-dev-wxt && npm run compile && npm test`
Expected: 0 type errors; all existing tests still pass (this task adds no new tests —
`getIndieGalaGamesList` is effectful orchestration, matching `getGogGamesList`'s own
untested-directly status; its correctness is covered by Task 2's `fetchFreebies` unit
tests plus Task 7's manual verification)

- [ ] **Step 7: Commit**

```bash
git add wxt-dev-wxt/entrypoints/background.ts wxt-dev-wxt/wxt.config.ts
git commit -m "feat: wire IndieGala into the claim fan-out and manifest"
```

---

### Task 6: IndieGala popup UI

**Files:**
- Modify: `wxt-dev-wxt/entrypoints/components/Settings.tsx`
- Modify: `wxt-dev-wxt/entrypoints/components/GamesList.tsx`

**Interfaces:**
- Consumes: `LOGIN_STATE_KEYS[Platforms.IndieGala]`, `LoginState` (`loginState.ts`), `Checkbox`, `LoginStatus` components (unchanged props)

- [ ] **Step 1: Add the checkbox row and login badge to Settings.tsx**

```typescript
    const [indieGalaCheck, setIndieGalaCheck] = useStorage<boolean>("indieGalaCheck", true);
    // ...alongside the other useStorage<LoginState> lines:
    const [indieGalaLoggedIn] = useStorage<LoginState>(LOGIN_STATE_KEYS[Platforms.IndieGala], null);
```

Add the link and checkbox to the JSX:

```typescript
                <span>Log in on <a href="https://store.steampowered.com/login/" target="_blank">Steam</a>, <a
                    href="https://www.epicgames.com/id/login"
                    target="_blank">Epic games</a>, <a href="https://www.gog.com/en"
                    target="_blank">GOG</a> and <a href="https://www.indiegala.com/login"
                    target="_blank">IndieGala</a> to get free games</span>
```

```typescript
                    <Checkbox name="IndieGala" checked={indieGalaCheck} onChange={e => setIndieGalaCheck(e.target.checked)}
                              trailing={<LoginStatus state={indieGalaLoggedIn}/>}/>
```

(Placed after the GOG checkbox row, inside the existing `.checkboxes` div.)

- [ ] **Step 2: Add IndieGala games to the popup's game list**

In `GamesList.tsx`:

```typescript
    const [indieGalaGames] = useStorage<FreeGame[]>("indieGalaGames", []);
    const freeGames = [...steamGames, ...EpicGames, ...gogGames, ...indieGalaGames];
```

- [ ] **Step 3: Type-check and build**

Run: `cd wxt-dev-wxt && npm run compile && npm run build`
Expected: 0 errors, build succeeds

- [ ] **Step 4: Commit**

```bash
git add wxt-dev-wxt/entrypoints/components/Settings.tsx wxt-dev-wxt/entrypoints/components/GamesList.tsx
git commit -m "feat: add IndieGala row to popup settings and games list"
```

---

### Task 7: IndieGala verification gate

**Files:** none (verification only)

- [ ] **Step 1: Full automated gate**

```bash
cd wxt-dev-wxt && npm run compile && npm test && npm run build && npm run build:firefox
```

Expected: all four green.

- [ ] **Step 2: Manual live verification (cannot be automated — requires your IndieGala session)**

Load the built extension (Chrome and/or Firefox), log into IndieGala, and confirm:
- The IndieGala checkbox shows a "Logged in" badge.
- This week's freebie(s) appear in the popup's Free Games tab.
- Triggering a manual claim actually adds the game to your IndieGala library
  (check `https://www.indiegala.com/library`).
- Re-running the claim on an already-owned freebie does not increment the claimed
  counter (the `already-claimed` outcome path).

- [ ] **Step 3: If manual verification finds a mismatch, fix before proceeding to Phase 2**

Any drift between the captured request/response shapes and live behavior should be
fixed here with a regression test added to `indieGalaGiveaway.test.ts`, then re-run
Step 1.

---

## Phase 2: Prime Gaming

### Task 8: Prime Gaming offer parsing

**Files:**
- Create: `wxt-dev-wxt/entrypoints/utils/primeGamingGiveaway.ts`
- Test: `wxt-dev-wxt/entrypoints/utils/primeGamingGiveaway.test.ts`

**Interfaces:**
- Produces: `PRIME_GAMING_HOME_URL: string`, `isInternalOfferCard(card: Element): boolean`, `parseOfferCard(card: Element): FreeGame | null`, `parseInternalOffers(offerList: Element): FreeGame[]`, `hasPrimeMembership(doc: Document): boolean`

Selectors are sourced from `vogler/free-games-claimer`'s `prime-gaming.js` (the
4.2k-star reference implementation for this exact flow — see the design spec for the
full citation) and must be re-verified against the live page in Task 11's manual
gate, same caveat already accepted for Epic/Steam's own selectors in this codebase.

- [ ] **Step 1: Write the failing tests**

```typescript
// wxt-dev-wxt/entrypoints/utils/primeGamingGiveaway.test.ts
import { describe, it, expect } from 'vitest';
import { hasPrimeMembership, isInternalOfferCard, parseInternalOffers, parseOfferCard, PRIME_GAMING_HOME_URL } from './primeGamingGiveaway';
import { Platforms } from '@/entrypoints/enums/platforms.ts';

function elFrom(html: string): Element {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return doc.body.firstElementChild as Element;
}

function docFrom(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
}

const INTERNAL_CARD = `
<div class="item-card__action">
  <a href="/some-game-fgwp/dp/amzn1.pg.item.abc?ingress=amzn">
    <img class="tw-image" src="https://images/game.png"/>
  </a>
  <div class="item-card-details__body__primary">Some Game</div>
  <button data-a-target="FGWPOffer" class="tw-button">Claim</button>
</div>`;

const EXTERNAL_CARD = `
<div class="item-card__action">
  <a data-a-target="FGWPOffer" href="/other-game-fgwp/dp/amzn1.pg.item.def?ingress=amzn">
    <img class="tw-image" src="https://images/other.png"/>
  </a>
  <div class="item-card-details__body__primary">Other Game</div>
</div>`;

describe('isInternalOfferCard', () => {
  it('is true when the card has a claim <button> (in-store claim)', () => {
    expect(isInternalOfferCard(elFrom(INTERNAL_CARD))).toBe(true);
  });

  it('is false when the card only has an <a> claim link (external store)', () => {
    expect(isInternalOfferCard(elFrom(EXTERNAL_CARD))).toBe(false);
  });
});

describe('parseOfferCard', () => {
  it('extracts title, link, and image from an internal card', () => {
    const game = parseOfferCard(elFrom(INTERNAL_CARD));
    expect(game).toEqual({
      title: 'Some Game',
      platform: Platforms.PrimeGaming,
      link: PRIME_GAMING_HOME_URL,
      img: 'https://images/game.png',
    });
  });

  it('returns null when the card has no title', () => {
    const card = elFrom(`<div class="item-card__action"><a href="/x"></a></div>`);
    expect(parseOfferCard(card)).toBeNull();
  });

  it('falls back to the default icon when no image is present', () => {
    const card = elFrom(`<div class="item-card__action"><a href="/x"></a><div class="item-card-details__body__primary">T</div></div>`);
    expect(parseOfferCard(card)?.img).toBe('/icon/128.png');
  });
});

describe('parseInternalOffers', () => {
  it('returns only internal cards, skipping external ones', () => {
    const list = elFrom(`<div>${INTERNAL_CARD}${EXTERNAL_CARD}</div>`);
    const games = parseInternalOffers(list);
    expect(games).toHaveLength(1);
    expect(games[0].title).toBe('Some Game');
  });

  it('returns an empty array when there are no offer cards', () => {
    expect(parseInternalOffers(elFrom('<div></div>'))).toEqual([]);
  });
});

describe('hasPrimeMembership', () => {
  it('is true when there is no "Try Prime" button', () => {
    const doc = docFrom('<button>Sign out</button>');
    expect(hasPrimeMembership(doc)).toBe(true);
  });

  it('is false when a "Try Prime" button is present', () => {
    const doc = docFrom('<button>Try Prime</button>');
    expect(hasPrimeMembership(doc)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd wxt-dev-wxt && npx vitest run entrypoints/utils/primeGamingGiveaway.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// wxt-dev-wxt/entrypoints/utils/primeGamingGiveaway.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd wxt-dev-wxt && npx vitest run entrypoints/utils/primeGamingGiveaway.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add wxt-dev-wxt/entrypoints/utils/primeGamingGiveaway.ts wxt-dev-wxt/entrypoints/utils/primeGamingGiveaway.test.ts
git commit -m "feat: parse Prime Gaming internal offer cards"
```

---

### Task 9: Prime Gaming platform + login state

**Files:**
- Modify: `wxt-dev-wxt/entrypoints/enums/platforms.ts` (already modified by Task 3 to add `IndieGala` — build on that state)
- Modify: `wxt-dev-wxt/entrypoints/utils/loginState.ts` (already modified by Task 3)
- Modify: `wxt-dev-wxt/entrypoints/utils/loginState.test.ts` (already modified by Task 3)

**Interfaces:**
- Produces: `Platforms.PrimeGaming`, `readPrimeGamingLoginState(doc: Document): LoginState`, `LOGIN_STATE_KEYS[Platforms.PrimeGaming]`

Selectors confirmed live by the reference tool: `[data-a-target="user-dropdown-first-name-text"]`
present ⇒ signed in; a `button` whose text is exactly "Sign in" ⇒ signed out.

- [ ] **Step 1: Write the failing tests**

Append to `loginState.test.ts`:

```typescript
import { readPrimeGamingLoginState } from './loginState';

describe('readPrimeGamingLoginState', () => {
  it('is true when the user dropdown is present', () => {
    const doc = docFrom('<span data-a-target="user-dropdown-first-name-text">Jane</span>');
    expect(readPrimeGamingLoginState(doc)).toBe(true);
  });

  it('is false when a "Sign in" button is present', () => {
    const doc = docFrom('<button>Sign in</button>');
    expect(readPrimeGamingLoginState(doc)).toBe(false);
  });

  it('is null when neither signal has rendered yet', () => {
    const doc = docFrom('<div>loading…</div>');
    expect(readPrimeGamingLoginState(doc)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd wxt-dev-wxt && npx vitest run entrypoints/utils/loginState.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

In `platforms.ts`:

```typescript
export enum Platforms {
    Steam = "Steam",
    Epic = "Epic Games",
    GOG = "GOG",
    IndieGala = "IndieGala",
    PrimeGaming = "Prime Gaming"
}
```

In `loginState.ts`:

```typescript
export const LOGIN_STATE_KEYS: Record<Platforms, string> = {
    [Platforms.Epic]: "epicLoggedIn",
    [Platforms.Steam]: "steamLoggedIn",
    [Platforms.GOG]: "gogLoggedIn",
    [Platforms.IndieGala]: "indieGalaLoggedIn",
    [Platforms.PrimeGaming]: "primeGamingLoggedIn",
};

// Confirmed live by vogler/free-games-claimer's prime-gaming.js: the user
// dropdown only renders once signed in; a "Sign in" button renders only when
// signed out. Neither present yet means the page hasn't hydrated.
export function readPrimeGamingLoginState(doc: Document): LoginState {
  if (doc.querySelector('[data-a-target="user-dropdown-first-name-text"]')) return true;
  const hasSignIn = Array.from(doc.querySelectorAll('button')).some(
      (btn) => (btn.textContent ?? '').trim().toLowerCase() === 'sign in'
  );
  if (hasSignIn) return false;
  return null;
}
```

Update `readLoginState`:

```typescript
export function readLoginState(platform: Platforms, doc: Document): LoginState {
    switch (platform) {
        case Platforms.Epic:
            return readEpicLoginState(doc);
        case Platforms.Steam:
            return readSteamLoginState(doc);
        case Platforms.IndieGala:
            return readIndieGalaLoginState(doc);
        case Platforms.PrimeGaming:
            return readPrimeGamingLoginState(doc);
        default:
            return null;
    }
}
```

- [ ] **Step 4: Run tests, then type-check**

Run: `cd wxt-dev-wxt && npx vitest run entrypoints/utils/loginState.test.ts && npm run compile`
Expected: all PASS, 0 type errors

- [ ] **Step 5: Commit**

```bash
git add wxt-dev-wxt/entrypoints/enums/platforms.ts wxt-dev-wxt/entrypoints/utils/loginState.ts wxt-dev-wxt/entrypoints/utils/loginState.test.ts
git commit -m "feat: add Prime Gaming platform and login-state detection"
```

---

### Task 10: Prime Gaming content script

**Files:**
- Create: `wxt-dev-wxt/entrypoints/primegaming.content.ts`

**Interfaces:**
- Consumes: `onClaimMessage`, `detectAndRecordLoginState`, `hasPrimeMembership`, `parseInternalOffers`, `PRIME_GAMING_HOME_URL`, `getRndInteger`, `incrementCounter`, `wait`, `waitForElement`, `waitForPageLoad`
- Produces: nothing consumed by later tasks (registered via WXT content-script matching)

- [ ] **Step 1: Write the content script**

```typescript
// wxt-dev-wxt/entrypoints/primegaming.content.ts
import { oncePerPageRun } from "@/entrypoints/utils/oncePerPageRun.ts";
import { browser } from "wxt/browser";
import { FreeGamesResponse } from "@/entrypoints/types/freeGamesResponse.ts";
import { FreeGame } from "@/entrypoints/types/freeGame.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";
import { setStorageItem } from "@/entrypoints/hooks/useStorage.ts";
import { onClaimMessage } from "@/entrypoints/utils/contentMessaging.ts";
import { detectAndRecordLoginState } from "@/entrypoints/utils/loginState.ts";
import { hasPrimeMembership, parseInternalOffers } from "@/entrypoints/utils/primeGamingGiveaway.ts";
import { getRndInteger, incrementCounter, wait, waitForElement, waitForPageLoad } from "@/entrypoints/utils/helpers.ts";

export default defineContentScript({
    matches: ['https://gaming.amazon.com/*'],
    main(_: any) {
        if (!oncePerPageRun('_myPrimeGamingContentScriptInjected' as keyof Window)) {
            return;
        }
        onClaimMessage({ getFreeGames: getFreeGamesList, claimGames: claimCurrentGames });

        // The "Games" tab must be selected before the offer list renders; it's
        // the default tab on most loads but not guaranteed (e.g. deep links).
        async function openGamesTabAndGetOfferList(): Promise<Element | null> {
            const gameTab = await waitForElement(document, 'button[data-type="Game"]');
            if (gameTab) gameTab.click();
            return waitForElement(document, 'div[data-a-target="offer-list-FGWP_FULL"]', 500, 20);
        }

        async function getFreeGamesList() {
            await waitForPageLoad();
            const loginState = await detectAndRecordLoginState(Platforms.PrimeGaming);
            if (loginState === false) return;
            if (!hasPrimeMembership(document)) return;

            const offerList = await openGamesTabAndGetOfferList();
            if (!offerList) return;

            const gamesArr: FreeGame[] = parseInternalOffers(offerList);
            if (gamesArr.length === 0) return;

            await setStorageItem("primeGamingGames", gamesArr);

            const freeGamesResponse: FreeGamesResponse = {
                freeGames: gamesArr,
                loggedIn: true,
            };
            await browser.runtime.sendMessage({
                target: 'background',
                action: 'claimFreeGames',
                data: freeGamesResponse,
            });
        }

        // All internal offers share one claim page, so this claims every
        // currently-unclaimed internal card found in a single visit rather than
        // being told which one game to claim.
        async function claimCurrentGames() {
            await waitForPageLoad();
            void detectAndRecordLoginState(Platforms.PrimeGaming);

            const offerList = await openGamesTabAndGetOfferList();
            if (!offerList) return;

            const buttons = Array.from(
                offerList.querySelectorAll<HTMLButtonElement>('.item-card__action button[data-a-target="FGWPOffer"]')
            );

            for (const button of buttons) {
                await wait(getRndInteger(300, 700));
                button.click();
                await incrementCounter();
                await wait(getRndInteger(800, 1500));
            }
        }
    },
});
```

- [ ] **Step 2: Type-check**

Run: `cd wxt-dev-wxt && npm run compile`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add wxt-dev-wxt/entrypoints/primegaming.content.ts
git commit -m "feat: add Prime Gaming content script"
```

---

### Task 11: Wire Prime Gaming into background.ts and manifest

**Files:**
- Modify: `wxt-dev-wxt/entrypoints/background.ts` (already modified by Task 5 to add IndieGala — build on that state)
- Modify: `wxt-dev-wxt/wxt.config.ts` (already modified by Task 5)

**Interfaces:**
- Consumes: `PRIME_GAMING_HOME_URL` (`primeGamingGiveaway.ts`)
- Produces: `background.getPrimeGamingGamesList(): Promise<never>`, modifies `background.claimGames` to dedupe by `link` before opening tabs

- [ ] **Step 1: Add the import**

```typescript
import {PRIME_GAMING_HOME_URL} from "@/entrypoints/utils/primeGamingGiveaway.ts";
```

- [ ] **Step 2: Add `getPrimeGamingGamesList`**

Add after `getIndieGalaGamesList`:

```typescript
  // No public API and no server-rendered offer data exist — gaming.amazon.com/home
  // is a client-rendered SPA whose offer list only exists after a real,
  // authenticated page load. This always throws so getFreeGamesList's existing
  // catch block falls back to a real tab, exactly like Epic and Steam's own
  // fallback path — there is no "try a fast path first" option here.
  async getPrimeGamingGamesList(): Promise<never> {
    throw new Error("Prime Gaming requires a live page render; no background API available");
  },
```

- [ ] **Step 3: Wire it into `getFreeGamesList`**

Replace the whole method (this is the complete function, not a delta — Task 5 left
it ending after the IndieGala block):

```typescript
  async getFreeGamesList() {
    const { steamCheck, epicCheck, gogCheck, indieGalaCheck, primeGamingCheck } = await getStorageItems([
      "steamCheck", "epicCheck", "gogCheck", "indieGalaCheck", "primeGamingCheck",
    ]);
    const claimGog = gogCheck !== false;
    const claimIndieGala = indieGalaCheck !== false;
    const claimPrimeGaming = primeGamingCheck !== false;
    try {
      await this.getEpicGamesList(epicCheck);
    } catch (e) {
      console.error("getEpicGamesList failed:", e);
      if (epicCheck) await this.openTabAndSendActionToContent(EPIC_GAMES_URL, "getFreeGames");
    }
    try {
      await this.getSteamGamesList(steamCheck);
    } catch (e) {
      console.error("getSteamGamesList failed:", e);
      if (steamCheck) await this.openTabAndSendActionToContent(STEAM_GAMES_URL, "getFreeGames");
    }
    try {
      await this.getGogGamesList(claimGog);
    } catch (e) {
      console.error("getGogGamesList failed:", e);
      if (claimGog) await this.openTabAndSendActionToContent(GOG_HOME_URL, "getFreeGames");
    }
    try {
      await this.getIndieGalaGamesList(claimIndieGala);
    } catch (e) {
      console.error("getIndieGalaGamesList failed:", e);
      if (claimIndieGala) await this.openTabAndSendActionToContent(INDIEGALA_FREEBIES_URL, "getFreeGames");
    }
    try {
      await this.getPrimeGamingGamesList();
    } catch (e) {
      console.error("getPrimeGamingGamesList failed:", e);
      if (claimPrimeGaming) await this.openTabAndSendActionToContent(PRIME_GAMING_HOME_URL, "getFreeGames");
    }
  },
```

- [ ] **Step 4: Dedupe `claimGames` by link**

```typescript
  async claimGames(games: FreeGame[]) {
    const claimable = await this.filterByReviewThreshold(games);
    if (claimable.length === 0) return;

    // Prime Gaming's internal offers all share one claim page — the content
    // script claims every unclaimed offer it finds in a single visit, so opening
    // a separate tab per game (all pointing at the same URL) would just be
    // wasted 10s waits. Every other platform already has a unique link per
    // game, so this dedupe is a no-op for them.
    const uniqueByLink = Array.from(new Map(claimable.map((g) => [g.link, g])).values());

    void this.setBadgeText(claimable.length.toString());
    for (const game of uniqueByLink) {
      try {
        await this.openTabAndSendActionToContent(withEpicEnglishLocale(game.link), "claimGames");
      } catch (e) {
        console.error(`claimGames: failed to claim "${game.title}" (${game.link})`, e);
      }
      await this.wait(10_000);
    }
  },
```

- [ ] **Step 5: Add to `clearGamesList`**

```typescript
  async clearGamesList() {
    await setStorageItem("epicGames", []);
    await setStorageItem("futureGames", []);
    await setStorageItem("steamGames", []);
    await setStorageItem("gogGames", []);
    await setStorageItem("indieGalaGames", []);
    await setStorageItem("primeGamingGames", []);
  },
```

- [ ] **Step 6: Add the host permission**

```typescript
    host_permissions: [
      'https://store.steampowered.com/*',
      "https://store-site-backend-static-ipv4.ak.epicgames.com/*",
      "https://www.gog.com/*",
      "https://freebies.indiegala.com/*",
      "https://gaming.amazon.com/*"
    ],
```

- [ ] **Step 7: Type-check and run the full test suite**

Run: `cd wxt-dev-wxt && npm run compile && npm test`
Expected: 0 type errors; all existing tests pass. If prior tests directly constructed
a `FreeGame[]` fixture and asserted tab-open counts against `claimGames`'s previous
one-tab-per-game behavior, update those fixtures to use distinct `link` values (the
dedupe only changes behavior for *shared* links, which no existing platform produces).

- [ ] **Step 8: Commit**

```bash
git add wxt-dev-wxt/entrypoints/background.ts wxt-dev-wxt/wxt.config.ts
git commit -m "feat: wire Prime Gaming into the claim fan-out and manifest"
```

---

### Task 12: Prime Gaming popup UI

**Files:**
- Modify: `wxt-dev-wxt/entrypoints/components/Settings.tsx` (already modified by Task 6 — build on that state, not the pre-Task-6 original)
- Modify: `wxt-dev-wxt/entrypoints/components/GamesList.tsx` (already modified by Task 6)

**Interfaces:**
- Consumes: `LOGIN_STATE_KEYS[Platforms.PrimeGaming]`, `LoginState` (`loginState.ts`), `Checkbox`, `LoginStatus` components (unchanged props)

- [ ] **Step 1: Add the checkbox row and login badge to Settings.tsx**

```typescript
    const [primeGamingCheck, setPrimeGamingCheck] = useStorage<boolean>("primeGamingCheck", true);
    const [primeGamingLoggedIn] = useStorage<LoginState>(LOGIN_STATE_KEYS[Platforms.PrimeGaming], null);
```

```typescript
                <span>Log in on <a href="https://store.steampowered.com/login/" target="_blank">Steam</a>, <a
                    href="https://www.epicgames.com/id/login"
                    target="_blank">Epic games</a>, <a href="https://www.gog.com/en"
                    target="_blank">GOG</a>, <a href="https://www.indiegala.com/login"
                    target="_blank">IndieGala</a> and <a href="https://www.amazon.com/ap/signin"
                    target="_blank">Amazon</a> to get free games</span>
```

```typescript
                    <Checkbox name="Prime Gaming" checked={primeGamingCheck} onChange={e => setPrimeGamingCheck(e.target.checked)}
                              trailing={<LoginStatus state={primeGamingLoggedIn}/>}/>
```

- [ ] **Step 2: Add Prime Gaming games to the popup's game list**

```typescript
    const [primeGamingGames] = useStorage<FreeGame[]>("primeGamingGames", []);
    const freeGames = [...steamGames, ...EpicGames, ...gogGames, ...indieGalaGames, ...primeGamingGames];
```

- [ ] **Step 3: Type-check and build**

Run: `cd wxt-dev-wxt && npm run compile && npm run build && npm run build:firefox`
Expected: 0 errors, both builds succeed

- [ ] **Step 4: Commit**

```bash
git add wxt-dev-wxt/entrypoints/components/Settings.tsx wxt-dev-wxt/entrypoints/components/GamesList.tsx
git commit -m "feat: add Prime Gaming row to popup settings and games list"
```

---

### Task 13: Prime Gaming verification gate

**Files:** none (verification only)

- [ ] **Step 1: Full automated gate**

```bash
cd wxt-dev-wxt && npm run compile && npm test && npm run build && npm run build:firefox
```

Expected: all four green.

- [ ] **Step 2: Manual live verification (cannot be automated — requires your Amazon Prime session)**

Load the built extension, log into `gaming.amazon.com` with your Prime account, and
confirm:
- The Prime Gaming checkbox shows a "Logged in" badge.
- Current internal (in-store) offers appear in the popup's Free Games tab.
- A manual claim run actually claims them (check `gaming.amazon.com/home` — claimed
  cards should show "Collected").
- External (linked-store) offers are correctly *not* claimed or listed.
- If you ever test against a non-Prime account: confirm the extension no-ops
  cleanly (no error, no claim attempt) rather than treating it as a failure.

- [ ] **Step 3: If selectors have drifted from what vogler's reference tool captured, fix here**

Update `primeGamingGiveaway.ts` (and its tests) to match what you actually observe,
then re-run Step 1. This is the expected place for that drift to surface — it was
flagged as a risk in the design spec.

---

## Final Integration Check

- [ ] **Step 1: Confirm both phases coexist correctly**

Run the full gate one more time after both phases are merged into the same branch:

```bash
cd wxt-dev-wxt && npm run compile && npm test && npm run build && npm run build:firefox
```

- [ ] **Step 2: Confirm all five platforms claim independently**

With all five platform checkboxes enabled and at least IndieGala/Prime Gaming logged
in, trigger a manual claim run and confirm one platform's failure (e.g., temporarily
log out of one) doesn't block the others — this is already guaranteed by the
existing per-platform try/catch in `getFreeGamesList` and the per-game try/catch in
`claimGames`, but worth a final live sanity check given two new platforms just
joined the fan-out.

- [ ] **Step 3: Update version and CLAUDE.md**

Bump the version in `wxt-dev-wxt/package.json` following this repo's existing
convention (see `git log` for prior `chore: bump version to X.Y.Z` commits), and
update `wxt-dev-wxt/wxt.config.ts`'s `manifest.name` and `CLAUDE.md`'s "What this is"
section to mention IndieGala and Prime Gaming alongside Steam/Epic/GOG.

- [ ] **Step 4: Commit**

```bash
git add wxt-dev-wxt/package.json wxt-dev-wxt/wxt.config.ts CLAUDE.md
git commit -m "chore: bump version for IndieGala and Prime Gaming support"
```
