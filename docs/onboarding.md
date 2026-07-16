# Onboarding

> Consolidated ECC onboarding doc. Covers **vision**, **purpose**, and **getting started**.
> Generated from source analysis. Items that could not be confirmed are marked **Needs Verification**.

## Purpose & vision

A cross-browser (Chrome + Firefox) WebExtension that **automatically discovers and claims
free games** from the Epic Games Store and Steam, so users never miss a free title.

- **Value proposition:** set-and-forget free-game claiming with configurable frequency.
- **Users:** individual gamers who own Epic/Steam accounts and stay logged in.
- **Non-goals (inferred):** no backend, no accounts of its own, no telemetry/analytics.
  Everything runs client-side in the browser. **Needs Verification** (no explicit product doc exists).

## Getting started

⚠️ The project lives in the **`wxt-dev-wxt/`** subdirectory, not the repo root.

```bash
cd wxt-dev-wxt
npm install
npm run dev            # Chrome dev build + hot reload
npm run dev:firefox    # Firefox dev build
npm run build          # production build → dist/
npm run compile        # type-check (tsc --noEmit) — the only verification gate
```

Load the built `dist/` (or a `npm run zip` artifact) via your browser's
extension developer page.

## How it works (30-second version)

1. A **background service worker** schedules checks using `browser.alarms` (or on browser
   startup), based on a user-chosen frequency.
2. On each check it fetches free-game data — Epic via a **JSON API**, Steam via **HTML
   scraping** — and diffs against what's already stored.
3. For new free games it **opens a store tab** and injects a **content script** that clicks
   through the claim/add-to-account flow.
4. A **React popup** lets the user configure platforms + frequency and view the games list
   and a claim counter.

See [architecture.md](./architecture.md) for the full model and [feature_status.md](./feature_status.md)
for what works, known issues, and roadmap.

## Coding standards

This repo has no local lint/format config. Standards come from the globally-installed ECC
rules (`~/.claude/rules/ecc/typescript/*`) plus the repo's `CLAUDE.md`. Key points:
Conventional Commits, immutability, `@/entrypoints/...` path alias, `browser` namespace from
`wxt/browser`, no `console.log` in production. See [tech_stack.md](./tech_stack.md#conventions).
