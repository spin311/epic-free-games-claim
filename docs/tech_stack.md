# Tech Stack

> Consolidated ECC doc. Covers technology stack, build/tooling, and coding standards.

## Stack

| Layer | Choice | Version | Notes |
|-------|--------|---------|-------|
| Language | TypeScript | ^5.8.3 | `strict` inherited from WXT's generated tsconfig. **Needs Verification** of exact flags. |
| Extension framework | WXT | ^0.20.x | Web Extension Toolkit — entrypoint conventions, `browser` polyfill, storage, MV3 build. |
| UI | React | ^19.1.0 | Popup only, via `@wxt-dev/module-react`. |
| HTML parsing | node-html-parser | ^7.0.1 | Server-side Steam HTML scraping in the background worker. |
| Build / dev | WXT CLI (`wxt`) | | `dev`, `build`, `zip`, per-browser (`-b firefox`). |
| Package manager | npm (README) | | ⚠️ Both `package-lock.json` **and** `pnpm-lock.yaml` are committed — see tech debt. |

## Build & tooling

- **Verification gates (all green):** `npm run compile` (`tsc --noEmit`, **0 errors**), `npm test` (Vitest), and `npm run build` (`wxt build`).
- **Tests:** Vitest via WXT's `WxtVitest` plugin (mocks `#imports`/`browser`/`storage`). Suites live beside sources as `*.test.ts`; DOM suites use `jsdom`, storage suites pin `// @vitest-environment node`.
- **Build:** `npm run build` (Chrome) / `build:firefox`. Output → `wxt-dev-wxt/dist/`.
- **Package:** `npm run zip` / `zip:firefox` for store submission.
- **No linter, no formatter, no test runner** are configured.
- **Targets:** Chrome (MV3) and Firefox (`browser_specific_settings.gecko`, min v109).

## Repository layout

```
epic-free-games-claim/          # git root — README, imgs/, stub package.json, CLAUDE.md, docs/
└── wxt-dev-wxt/                # ← the actual project
    ├── wxt.config.ts           # manifest, permissions, browser targets
    ├── tsconfig.json           # extends .wxt/tsconfig.json; @/* → project root
    └── entrypoints/
        ├── background.ts       # service worker (orchestrator)
        ├── epic.content.ts     # content script (Epic)
        ├── steam.content.ts    # content script (Steam)
        ├── popup/              # React popup (App, main, html/css)
        ├── components/         # React components
        ├── hooks/useStorage.ts # storage abstraction
        ├── utils/              # helpers, oncePerPageRun
        ├── types/              # shared TS models
        └── enums/              # ClaimFrequency, Platforms, StorageValues, ActiveTabs
```

## Conventions

- **Imports:** absolute via `@/entrypoints/...` (alias `@` → `wxt-dev-wxt/`). Note: imports
  include the `.ts` extension (`allowImportingTsExtensions`).
- **Browser APIs:** import `browser` from `wxt/browser`; storage via `#imports`.
- **Immutability:** prefer new objects/state over in-place mutation (per ECC coding-style).
- **Commits:** Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).
- **No `console.log`** in production code (one currently violates this — see tech debt).
- Global ECC TypeScript rules apply: `~/.claude/rules/ecc/typescript/{coding-style,testing,security}.md`.
