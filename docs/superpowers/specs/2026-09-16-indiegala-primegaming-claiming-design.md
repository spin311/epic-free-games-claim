# IndieGala + Prime Gaming Claiming — Design

Status: approved, ready for implementation planning
Date: 2026-09-16
Related: PR #25 (`feat/gog-and-login-status`) — GOG claiming, login-status badges, and
the Steam review gate, revived from an unmerged August branch and merged as a
prerequisite to this work. Not otherwise part of this spec.

## Goal

Extend the extension's existing one-click free-game claiming (currently Epic, Steam,
and — once PR #25 merges — GOG) to two more sources: **IndieGala** and **Amazon Prime
Gaming**. Both offer free games on a predictable enough cadence to be worth automating,
and both fit the extension's core guarantee: a click now gets you a game you keep.

## Context: why these two, and why this shape

The user asked to "add free games claiming for amazon prime, gog games and indie
gala." GOG turned out to already be built (August, `feat/gog-giveaway`, never merged)
and is handled by PR #25. This spec covers the two genuinely new integrations.

Research (2026-09-16) confirmed both platforms offer free games regularly enough to
justify automation:

- **Prime Gaming**: new batches drop weekly (Thursdays), 5–10 games/month, confirmed
  ongoing into 2026 ([Gamerant](https://gamerant.com/prime-gaming-free-games-august-2026-list/),
  [TroveGG](https://trovegg.com/guides/prime-gaming-free-games)).
- **IndieGala freebies**: a new DRM-free free game weekly at `freebies.indiegala.com`
  (confirmed live: 7 titles listed as of this writing).

Both integrations follow the architecture pattern already established by
`gog.content.ts` / `utils/gogGiveaway.ts` / `loginState.ts`: a content script matched
to the platform's own domain (so the session cookie is guaranteed attached), a pure
and unit-testable util module for fetch/parse/claim, and wiring into
`background.ts`'s existing alarm-driven fan-out and the shared `claimGames` loop
(which already isolates per-game failures, so one platform breaking never blocks the
others).

## Scope decisions

Both platforms turned out to bundle a second, unrelated mechanic under the same
umbrella. Both are explicitly **out of scope** for this work — see rationale below.

### IndieGala: freebies only, not giveaways

| | In scope | Out of scope |
|---|---|---|
| `freebies.indiegala.com` | ✅ Weekly, guaranteed, DRM-free, one click adds it to your library | |
| `indiegala.com/giveaways` | | ❌ Spend earned "coins" on a ticket for a *chance* to win a Steam key |

The giveaways system is a lottery (confirmed via the `new_entry` endpoint used by
[Revadike/giveaway-joiner](https://github.com/Revadike/giveaway-joiner/blob/master/js/services/indiegala.js)) — entering doesn't guarantee a game, which breaks the
"claim = you own it" guarantee every other platform in this extension provides.
Coins also have to be earned through site activity the extension doesn't track.

### Prime Gaming: internal claims only, not external or loot

| | In scope | Out of scope |
|---|---|---|
| Internal "FGWP_FULL" games (Amazon Games / partner launchers) | ✅ Single click, keep forever | |
| External store-linked games (Epic/Origin/GOG/Xbox) | | ❌ Needs account-linking (OAuth-style) or a redeem code entered on a *different* site |
| In-game loot / DLC | | ❌ Same account-linking problem, and not a "game" |

Confirmed via the most-starred reference implementation,
[vogler/free-games-claimer](https://github.com/vogler/free-games-claimer/blob/main/prime-gaming.js)
(4.2k★): internal claims are a single in-page button click; external claims route
through account-linking or produce a code that must be redeemed elsewhere (their code
explicitly special-cases gog.com, Xbox, and Legacy Games redemption, including running
into GOG's captcha-protected redeem endpoint). That's a different, riskier feature —
not a fit for this extension's one-click model.

## Architecture (shared by both modules)

Following the GOG template exactly:

- **`entrypoints/<platform>.content.ts`** — WXT content script, `matches` on the
  platform's own domain(s) so the session cookie is guaranteed attached (background
  service-worker fetches can't promise that — see `gogGiveaway.ts`'s existing comment
  on this). Registers `onClaimMessage({ getFreeGames, claimGames })` from
  `utils/contentMessaging.ts`.
- **`entrypoints/utils/<platform>Giveaway.ts`** — pure, unit-testable functions:
  fetch/scrape the current offer(s), parse into `FreeGame[]`, and claim. No DOM
  access at the module level where avoidable, so logic is testable without jsdom.
- **`entrypoints/utils/loginState.ts`** — extend `LOGIN_STATE_KEYS` and the
  `readLoginState` switch (or, like GOG, have the content script call
  `recordLoginState` directly if the platform gives an authoritative signal outside
  the DOM).
- **`entrypoints/enums/platforms.ts`** — add `IndieGala` and `PrimeGaming` members.
- **`entrypoints/background.ts`** — add `get<Platform>GamesList`, wire into the
  existing `checkAndClaimIfDue` fan-out (parallel to `getEpicGamesList` /
  `getSteamGamesList` / `getGogGamesList`) and into the shared `claimGames` loop
  (already platform-agnostic and already isolates per-game failures — no changes
  needed there beyond the URL-building step picking up the new platform's games).
- **`wxt.config.ts`** — add `host_permissions` for the new domains.
- **Popup** — `Settings.tsx` gains a checkbox row per platform, `LoginStatus.tsx`
  already renders generically per platform, `GamesList.tsx` already renders any
  `FreeGame[]` — no changes needed beyond passing the new storage keys through.

## Phase 1: IndieGala (`freebies.indiegala.com`)

Build first — lower risk than Prime Gaming (single domain, no split claim types, no
heavyweight JS framework to scrape against).

**What's confirmed:** the freebies index lists current offers, each with its own
detail page. The claim control (`developer-product-download-button-login` class,
"ADD TO LIBRARY" text) redirects to login when signed out
(`onclick="loginRedirectAnchor(this, event, 'loginBeforeAddToLibrary')"`) — confirmed
by fetching a live product page.

**What's not confirmed, and can't be without a live session:** the authenticated
request the button fires (its class name drops the `-login` suffix when signed in,
implying a different handler, but the exact request — AJAX POST vs. plain link
navigation, payload shape, response shape — is unknown). This is the same situation
GOG was in during its build: the successful-claim shape "could not be observed
directly" and had to be inferred defensively. **Before or during implementation, the
user needs to capture one real claim** (DevTools Network tab → export HAR, or just
describe what happens) so the util module is built against the real shape instead of
a guess.

**Login detection:** IndieGala's DOM structure for a signed-in user menu hasn't been
captured yet — needs the same live-session pass as the claim endpoint. Likely follows
Steam's pattern (a DOM element only present when signed in) rather than GOG's
(authoritative signal from an API status code), since IndieGala is a server-rendered
site, not an SPA.

**Cadence:** weekly, checked on the same `alarms`-based schedule already driving
Epic/Steam/GOG — no new scheduling logic needed.

## Phase 2: Prime Gaming (`gaming.amazon.com`)

**What's confirmed:** no public JSON API; the reference tool drives the DOM directly.
The offer list lives at `div[data-a-target="offer-list-FGWP_FULL"]`; internal-claim
cards are `.item-card__action:has(button[data-a-target="FGWPOffer"])` (a `<button>`,
not an `<a>` — this is exactly the mechanical signal that separates in-scope internal
claims from out-of-scope external ones); each card's "Claim" button is
`.tw-button:has-text("Claim")`.

**Login detection:** presence of `button:has-text("Sign in")` vs.
`[data-a-target="user-dropdown-first-name-text"]` — both confirmed live by the
reference tool.

**Non-Prime accounts:** must detect the `Try Prime` button state and treat it as "no
offers to claim," not as an error — a signed-in non-Prime account is a valid,
expected state, not a failure.

**Why this is lower-risk for us than for a standalone bot:** the reference tool needs
Playwright + a stealth plugin + OTP/MFA handling because it automates a *fresh login*
from an automated browser profile — that's what triggers Amazon's bot defenses. Our
content script never touches the login page; it runs inside the user's own
already-authenticated browser, identical in kind to how the Epic and Steam modules
already work today. The risk that remains is the same one Epic/Steam already carry:
brittle, markup-dependent selectors (here, Twitch web-component classes/attributes
rather than Epic's or Steam's own markup) that can break on a redesign.

## Data flow / error handling

Unchanged shape from the existing platforms: content script posts a
`FreeGamesResponse` to the background → background stores it under a per-platform
storage key (`indieGalaGames`, `primeGamingGames`) → the claimed-count badge only
increments on a genuine new claim, never on an "already claimed" outcome (matches
GOG's `ClaimOutcome` distinction) → the existing per-game try/catch in `claimGames`
already ensures one platform's failure can't cancel another's.

## Testing

- Per-module unit tests mirroring `gogGiveaway.test.ts` / `steamReviews.test.ts`:
  parse/format functions tested against fixture HTML/JSON captured from a real,
  logged-in session (not synthetic guesses — GOG's tests were built the same way).
- `loginState.test.ts` extended for both new platforms.
- `background.test.ts` fan-out and claim-loop tests extended to cover the two new
  platforms alongside existing coverage.
- Manual verification against live accounts before merge: the user has active Amazon
  Prime and IndieGala accounts and will verify each module's real claim flow, same
  gate applied to the GOG PR (#25) — automated checks (types, tests, both builds,
  unauthenticated endpoint/page shape) get us most of the way; a real authenticated
  claim can only be confirmed by the user.

## Sequencing

1. **IndieGala** — simpler, single claim type, lower risk. Ship first.
2. **Prime Gaming** — higher value (5–10 games/month vs. 1/week) but higher risk
   (DOM scraping against a heavier JS framework, split claim types to filter
   correctly). Ship second, informed by whatever comes out of IndieGala.

Each phase is independently shippable as its own branch/PR, following this repo's
existing convention (feature branches merged via PR with merge commits, per
`CLAUDE.md`).

## Open questions requiring a live session (blocking implementation, not blocking this spec)

1. IndieGala: exact authenticated claim request (method, payload, response shape).
2. IndieGala: DOM signal for signed-in state.
3. Both: current exact selectors/markup, captured fresh at implementation time rather
   than trusted from research — both platforms are third-party UIs that can change
   without notice, same caveat that already applies to Epic/Steam in this codebase.

## Out of scope (explicit)

- IndieGala's coin-based giveaway/lottery system.
- Prime Gaming external-store-linked claims, redeem codes, and in-game loot/DLC.
- Any change to the already-merged GOG/login-status/Steam-review-gate work (PR #25).
