# Architecture

> Consolidated ECC architecture doc. Covers overall architecture, module responsibilities,
> data flow, state management, networking, and persistence.

## Overall shape

A standard **WXT / Manifest V3 WebExtension** with three runtime surfaces that communicate
via `browser.runtime` message passing. There is **no server** — all logic is client-side.

```
┌─────────────────┐   messages    ┌──────────────────────┐   messages   ┌──────────────────┐
│  Popup (React)  │◀────────────▶│  Background (SW)      │◀───────────▶│  Content scripts  │
│  Settings/List  │   target:     │  scheduler + claim    │   target:    │  epic / steam     │
│                 │   background   │  orchestrator         │  content     │  DOM automation   │
└────────┬────────┘               └──────────┬───────────┘              └────────┬─────────┘
         │                                    │                                   │
         └──────────── browser.storage.local (shared state) ───────────────────┘
```

## Major modules & responsibilities

| Module | File | Responsibility |
|--------|------|----------------|
| **Background** | `entrypoints/background.ts` (400 LOC) | Core orchestrator. Alarm scheduling, frequency logic, Epic API fetch, Steam HTML fetch, diffing new games, opening claim tabs, badge text, Steam MAIN-world `addToCart` injection. |
| **Epic content** | `entrypoints/epic.content.ts` | Runs on `store.epicgames.com/*`. Scrapes free-game cards, detects login state, drives the purchase-CTA + iframe payment-confirm flow. |
| **Steam content** | `entrypoints/steam.content.ts` | Runs on `store.steampowered.com/*`. Scrapes `-100%` free games, drives add-to-account (special-cases Steam's `javascript:addToCart()` URL via a background message). |
| **Popup UI** | `entrypoints/popup/` + `components/` | React 19 popup: `Settings`, `GamesList`/`GameCard`, `FrequencySelect`, `OnButton`, `ManualClaimBtn`, `Footer`. |
| **Storage layer** | `entrypoints/hooks/useStorage.ts` | `useStorage` React hook + `get/set/merge` helpers over WXT `storage`. Namespaces keys as `local:<key>`. |
| **Helpers** | `entrypoints/utils/helpers.ts` | DOM polling (`waitForElement`), randomized `realClick`, iframe clicking, `incrementCounter`. |
| **Types / enums** | `entrypoints/types/`, `entrypoints/enums/` | Shared models (`FreeGame`, `EpicSearchResponse`, …) and enums (`ClaimFrequency`, `Platforms`, `StorageValues`, `ActiveTabs`). |

## Data flow — a claim cycle

1. **Trigger:** `browser.alarms` fires (`checkFreeGames`) or `onStartup`, or the user clicks
   "Manually claim" (popup → background `action: "claim"`).
2. **Due check:** `checkAndClaimIfDue()` compares `lastOpened` against the frequency
   (`ClaimFrequencyMinutes`) using an `isChecking` re-entrancy guard.
3. **Fetch:**
   - **Epic:** `fetch(EPIC_API_URL)` → JSON → filter `discountPrice === 0` + active promo.
   - **Steam:** `fetch(STEAM_GAMES_URL)` → HTML → `node-html-parser` → scrape result rows.
   - On fetch failure, falls back to **opening the store page + content-script scrape**.
4. **Diff:** new games = those whose `title` isn't already in stored `epicGames`/`steamGames`.
5. **Claim:** for each new game, `openTabAndSendActionToContent(link, "claimGames")` opens a
   tab, waits for load, and messages the content script to click through the claim UI.
   A 10s spacer separates claims. Badge text shows the count.
6. **Counter:** content scripts call `incrementCounter()` → `merge` into `counter` storage.

## State management & persistence

- **Single source of truth:** `browser.storage.local`, keyed `local:<name>`.
- **Keys:** `active`, `claimFrequency`, `steamCheck`, `epicCheck`, `lastOpened`, `epicGames`,
  `steamGames`, `futureGames`, `counter`, `activeTab`.
- **Popup ↔ storage:** the `useStorage<T>` hook mirrors a storage key into React state and
  writes back on change (after an init guard to avoid clobbering on first mount).
- **Background ↔ storage:** direct `get/setStorageItem(s)` calls.
- No external DB, no auth of its own — it **relies on the user's existing logged-in browser
  sessions** on Epic/Steam.

## Networking & external dependencies

- **Epic:** `store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions` (public JSON).
- **Steam:** `store.steampowered.com/search/...` (HTML, scraped).
- **Host permissions** (`wxt.config.ts`): the Steam store + the Epic backend host.
- **Manifest permissions:** `storage`, `tabs`, `scripting`, `alarms`.

## Notable design decisions (observed)

- **Dual acquisition strategy** per platform: fast path = direct fetch/scrape from background;
  fallback = open the real store page and let the content script scrape. Resilient to API/DOM drift.
- **Randomized delays + synthetic mouse events** in claim flows — mimics human interaction to
  survive store anti-bot heuristics. **Needs Verification** that this is the explicit intent.
- **MAIN-world injection** for Steam `addToCart` to call the page's own cart function, working
  around CSP restrictions on `javascript:` URLs.
