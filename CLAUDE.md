# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A cross-browser (Chrome + Firefox) **WebExtension** that automatically claims free
games from the Epic Games Store and surfaces free Steam games. Built with
**WXT** (Web Extension Toolkit), **React 19**, and **TypeScript**.

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
| Package zip | `npm run zip` / `npm run zip:firefox` |

**Verification gates (all must stay green):** `npm run compile` (type-check), `npm test`
(Vitest), and `npm run build` (`wxt build`). No linter is configured.

Tests use WXT's Vitest integration (`WxtVitest`), which mocks `#imports`/`browser`/`storage`.
DOM-dependent suites run under `jsdom`; storage suites use `// @vitest-environment node` to
avoid an esbuild/jsdom `TextEncoder` clash. Test files live next to sources as `*.test.ts`.

> Note: both `package-lock.json` and `pnpm-lock.yaml` are present. The README documents
> npm; prefer `npm` unless told otherwise, and don't add a second lockfile's worth of churn.

## Project structure (`wxt-dev-wxt/entrypoints/`)

- `background.ts` — service worker: Epic/Steam fetching, alarms-based scheduling, claim logic
- `epic.content.ts` / `steam.content.ts` — content scripts injected on store pages
- `popup/` — React popup UI (`App.tsx`, `main.tsx`)
- `components/` — React components (Settings, GamesList, GameCard, FrequencySelect, …)
- `hooks/useStorage.ts` — typed wrapper over `browser.storage`
- `types/` — shared TypeScript types
- `enums/` — `claimFrequency`, `platforms`, `activeTabs`, `storageValues`
- `utils/` — `helpers.ts`, `oncePerPageRun.ts`
- `wxt.config.ts` — manifest, permissions, browser targets. `@/*` aliases the project root.

## Conventions

- **Path alias:** import via `@/entrypoints/...` (mapped to `wxt-dev-wxt/`).
- **Immutability:** create new objects/state rather than mutating in place.
- **Commits:** prefer Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).
  History is mixed (many bare subjects), but new work should follow the convention.
- **PR workflow:** feature branches (e.g. `feat/<topic>`) merged via PR with **merge commits**
  (history is not squashed).
- **Browser APIs:** use the `browser` namespace from `wxt/browser` (not raw `chrome`).
- Extension `permissions`/`host_permissions` live in `wxt.config.ts` — keep them minimal.
