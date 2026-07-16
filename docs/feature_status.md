# Feature Status, Technical Debt & Roadmap

> Consolidated ECC doc. Covers feature status, known issues / technical debt, and roadmap.

## Feature status

| Feature | Status | Notes |
|---------|--------|-------|
| Epic auto-claim | ✅ Implemented | API fetch + content-script claim flow with iframe payment confirm. |
| Steam auto-claim | ✅ Implemented | HTML scrape + add-to-account, MAIN-world `addToCart` fallback. |
| Configurable frequency | ✅ Implemented | Browser-start / hourly / 6h / 12h / daily via `browser.alarms`. |
| Manual claim | ✅ Implemented | Popup button → background `action: "claim"`. |
| Platform toggle (Steam/Epic) | ✅ Implemented | `steamCheck` / `epicCheck` storage flags. |
| Free-games list UI | ✅ Implemented | React popup "Free Games" tab. |
| Claim counter | ✅ Implemented | `incrementCounter()` → `counter` storage. |
| Upcoming free games | 🟡 Partial | Epic `futureGames` are stored but surfacing in UI is unconfirmed. **Needs Verification**. |
| Automated tests | 🟡 Partial | Vitest suite (19 tests) covers storage helpers, `helpers.ts`, and `claimFrequency`. Background/content-script logic still uncovered. |

## Technical debt & known issues (prioritized by impact)

### RESOLVED (this session)
1. ✅ **`waitForPageLoad()` never waits** (`utils/helpers.ts`) — fixed to `if (!isDocumentReady())`;
   covered by a regression test that fails on the old code.
2. ✅ **Unguarded null in Epic diff** (`background.ts`) — now `getStorageItem("epicGames") || []`.
3. ✅ **`tsc --noEmit` was red (47 errors)** — now **0**. Fixed by extracting the `defineBackground`
   object to a `const` (restores `this` typing), using the `Browser` type namespace, and branding
   the `useStorage` keys as `StorageItemKey`.
4. 🟡 **No tests** — Vitest harness added with 19 tests; background/content-script logic still uncovered.

### HIGH
- **Content-script logic remains untested.** The money-adjacent claim flows (purchase/add-to-cart
  clicking) have no coverage. Background methods aren't exported, so testing them needs a small
  refactor (extract pure helpers like `formatEpicFreeGame`, `areDatesDifferent`).

### MEDIUM
5. **Two lockfiles committed** (`package-lock.json` + `pnpm-lock.yaml`). Ambiguous package
   manager → drift risk. Pick one, delete the other.
5. **`console.log` in production** (`steam.content.ts:53`) — violates the no-console rule and
   leaks scrape data to the page console.
6. **Duplicated logic across content scripts.** Epic and Steam scripts share near-identical
   message-handling and free-game-extraction shapes; extract shared helpers.
7. **Fragile CSS-hash selectors** (`epic.content.ts:37-38`, e.g. `section.css-2u323`,
   `a.css-g3jcms`). Epic's generated class names change frequently and will silently break
   scraping. Consider more stable selectors / attribute-based queries.
8. **Duplicated `steamAddToCart` fallback logic** between `background.ts` and the injected MAIN
   world function; and duplicated `wait`/`getRndInteger` between background and helpers.

### LOW
9. **Nested-project layout** (`wxt-dev-wxt/`) is unusual and easy to trip over; consider
   flattening or documenting why (done in `CLAUDE.md`).
10. **`any` usage** in several signatures (`sendMessage`, content `main(_: any)`) — tighten types.
11. **Stub root `package.json`** with mismatched deps vs. the real one — remove or clarify.

## Security & safety notes

- The extension **automates purchase/claim UI** and injects into `MAIN` world on Steam. This is
  intentional but inherently sensitive: a selector/logic bug could interact with paid items.
  Free-game gating relies on `discountPrice === 0` / `-100%` checks — verify these stay correct.
- Relies on the user's **existing logged-in sessions**; it stores no credentials. Good.
- No secrets in the codebase (confirmed — no `.env`, no API keys).
- Randomized delays + synthetic events resemble anti-bot evasion; acceptable for a personal
  claiming tool the user installs for themselves, but worth a conscious stance. **Needs Verification**.

## Roadmap (suggested, not committed)

- **Short term:** fix the two HIGH bugs; add a minimal test harness (Vitest) around pure logic
  (`formatEpicFreeGame`, frequency/date math, storage helpers).
- **Medium term:** resilience for Epic selector drift; consolidate content-script duplication;
  single package manager; remove `console.log`.
- **Long term:** consider an E2E smoke test (Playwright) against fixture pages; evaluate whether
  Steam scraping can move fully to the content-script path to reduce fragility.
