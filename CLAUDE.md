# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A cross-browser (Chrome + Firefox) **WebExtension** that automatically claims free
games from Epic Games Store, GOG, IndieGala, and Prime Gaming, and surfaces free Steam
games. Built with **WXT** (Web Extension Toolkit), **React 19**, and **TypeScript**.

## Where the code lives

⚠️ The actual project is in the **`wxt-dev-wxt/`** subdirectory, not the repo root.
Run all commands from there:

```bash
cd wxt-dev-wxt
```

The repo root only holds the README, images, and a stub `package.json`.

## Commands (run inside `wxt-dev-wxt/`)

| Task | Command |
|------|---------|
| Install deps | `npm install` |
| Dev (Chrome) | `npm run dev` |
| Dev (Firefox) | `npm run dev:firefox` |
| Build (Chrome) | `npm run build` |
| Build (Firefox) | `npm run build:firefox` |
| Type-check | `npm run compile` (`tsc --noEmit`) — **clean, 0 errors** |
| Test | `npm test` (Vitest, `test:watch` for watch mode) |
| Live store canary | `npm run canary` (needs network + `npx playwright install chromium`; opens a visible browser) |
| Package zip | `npm run zip` / `npm run zip:firefox` |

**Verification gates (all must stay green):** `npm run compile` (type-check), `npm test`
(Vitest), and `npm run build` (`wxt build`). No linter is configured.

Tests use WXT's Vitest integration (`WxtVitest`), which mocks `#imports`/`browser`/`storage`.
DOM-dependent suites run under `jsdom`; storage suites use `// @vitest-environment node` to
avoid an esbuild/jsdom `TextEncoder` clash. Test files live next to sources as `*.test.ts`.

**Store canary:** `canary/stores.canary.ts` checks, signed out and against the live stores, what
the extension depends on (Epic's API and product-page "Get" button, Steam's search page, GOG's 401
contract, IndieGala's freebies, Prime Gaming's lookup), using the extension's own parsers. It runs
daily in `.github/workflows/canary.yml` (headed Chromium under `xvfb-run`: Epic answers headless
browsers with 403). A failure means a store changed; a check a store blocks from CI is skipped with
a warning annotation. When a store's markup or API changes, update the canary along with the code.

> Note: both `package-lock.json` and `pnpm-lock.yaml` are present. The README documents
> npm; prefer `npm` unless told otherwise, and don't add a second lockfile's worth of churn.

## Project structure (`wxt-dev-wxt/entrypoints/`)

- `background.ts` — service worker: Epic/Steam/GOG/IndieGala/Prime Gaming fetching,
  alarms-based scheduling, claim logic
- `epic.content.ts` / `steam.content.ts` / `gog.content.ts` / `indiegala.content.ts` /
  `primegaming.content.ts` — content scripts injected on store pages
- `microsoft.content.ts` / `legacygames.content.ts` — redeem a Prime Gaming code on that
  store's own page (GOG's lives in `gog.content.ts`); anything that doesn't confirm lands in
  the popup's pending-redemptions list
- `popup/` — React popup UI (`App.tsx`, `main.tsx`)
- `components/` — React components (Settings, GamesList, GameCard, FrequencySelect, …)
- `hooks/useStorage.ts` — typed wrapper over `browser.storage`; `hooks/useOptionalAccess.ts` — granted
  optional-host groups, live, plus the request-on-enable toggle helper
- `types/` — shared TypeScript types
- `enums/` — `claimFrequency`, `platforms`, `activeTabs`, `storageValues`
- `utils/` — `helpers.ts`, `oncePerPageRun.ts`, `contentMessaging.ts`, `badge.ts`,
  `loginState.ts`, `steamReviews.ts`, `gogGiveaway.ts`, `indieGalaGiveaway.ts`,
  `primeGamingGiveaway.ts`, `primeGamingApi.ts` (background Luna GraphQL lookup: Prime Gaming is
  checked without opening a tab, signed-out / no-Prime accounts included; the claims-page tab
  is only a fallback), `legacyGamesRedeem.ts` (Legacy Games promo-form helpers),
  `optionalAccess.ts` / `runtimeContentScripts.ts` (optional host access — see `wxt.config.ts` below),
  `network.ts` (`fetchWithRetry`: every background store request goes through `background.fetchStore`),
  `health.ts` (per-store last-check health shown in the popup's `HealthStatus` and as a red "!" badge:
  "network", "changed" — a store no longer matches the extension — or "captcha"; throw
  `StoreChangedError` where a response has an unexpected shape, never fail silently)
- `wxt.config.ts` — manifest, permissions, browser targets. `@/*` aliases the project root.
  `declarativeNetRequestWithHostAccess` exists only so the background lookup can send Luna's
  Origin on its own GraphQL request (Luna rejects the extension origin with 403); it carries no
  install warning, so it stays required.
  **Optional host access:** `host_permissions` holds only the two hosts 2.6.1 shipped with (Steam,
  Epic's API) — any new install-time host makes Chrome disable the extension on update until the
  user approves it. Every other host is an optional group in `utils/optionalAccess.ts`
  (`ACCESS_GROUP_ORIGINS`; `TOGGLE_ACCESS_GROUPS` maps each storage toggle to the groups it needs),
  requested from the popup (`hooks/useOptionalAccess.ts`) when the user turns that toggle on — any
  Prime Gaming toggle requests every Prime-related group in one prompt (`requestOrigins`). A
  feature is effective only when its flag is on **and** its groups are granted — background and
  popup both apply that rule; never gate on the flag alone. The gog / indiegala / indiegalaWheel /
  primegaming / microsoft / legacygames content scripts are `registration: "runtime"` (options in
  `utils/runtimeContentScripts.ts`); the background registers each while its group is granted
  (`syncContentScripts`, on every start and on `permissions.onAdded`/`onRemoved`). A
  `build:manifestGenerated` hook strips the optional origins and runtime matches from
  `host_permissions` and declares them as `optional_host_permissions` (MV3) or
  `optional_permissions` (MV2/Firefox). New hosts go in a group, not `host_permissions`; check
  `dist/chrome-mv3/manifest.json` after a build.

## Conventions

- **Path alias:** import via `@/entrypoints/...` (mapped to `wxt-dev-wxt/`).
- **Immutability:** create new objects/state rather than mutating in place.
- **Commits:** prefer Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).
  History is mixed (many bare subjects), but new work should follow the convention.
- **PR workflow:** feature branches (e.g. `feat/<topic>`) merged via PR with **merge commits**
  (history is not squashed).
- **Browser APIs:** use the `browser` namespace from `wxt/browser` (not raw `chrome`).
- Extension `permissions`/`host_permissions` live in `wxt.config.ts` — keep them minimal; new
  hosts are optional (see the `wxt.config.ts` bullet above).
