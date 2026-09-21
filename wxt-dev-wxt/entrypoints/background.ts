import {MessageRequest} from "@/entrypoints/types/messageRequest.ts";
import {getStorageItem, getStorageItems, setStorageItem} from "@/entrypoints/hooks/useStorage.ts";
import {FreeGame} from "@/entrypoints/types/freeGame.ts";
import {Platforms} from "@/entrypoints/enums/platforms.ts";
import {ClaimFrequency, ClaimFrequencyMinutes} from "@/entrypoints/enums/claimFrequency.ts";
import {parse} from 'node-html-parser';
import {GOG_HOME_URL, fetchGiveaway} from "@/entrypoints/utils/gogGiveaway.ts";
import {fetchFreebies, INDIEGALA_FREEBIES_URL} from "@/entrypoints/utils/indieGalaGiveaway.ts";
import {INDIEGALA_WHEEL_URL} from "@/entrypoints/utils/indieGalaWheel.ts";
import {PRIME_GAMING_HOME_URL} from "@/entrypoints/utils/primeGamingGiveaway.ts";
import {LoginState} from "@/entrypoints/utils/loginState.ts";
import {
  setBadgeBackgroundColor as setActionBadgeBackgroundColor,
  setBadgeText as setActionBadgeText,
} from "@/entrypoints/utils/badge.ts";
import {shouldClaimSteamGame} from "@/entrypoints/utils/steamReviews.ts";
import {browser, type Browser} from "wxt/browser";
import {EpicElement, EpicKeyImage, EpicSearchResponse} from "@/entrypoints/types/epicGame.ts";

const EPIC_API_URL = "https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=en-US";
const EPIC_GAMES_URL =
    "https://store.epicgames.com/";
// Product pages are built on store.epicgames.com rather than
// www.epicgames.com/store/...: the www form is a redirect, and Epic bounces
// some slugs onto /site/... paths that 404 *and* fall outside the Epic content
// script's match patterns, so the claim tab ends up with no script injected.
const EPIC_PRODUCT_BASE = "https://store.epicgames.com/en-US";
export const EPIC_FREE_GAMES_URL = "https://store.epicgames.com/en-US/free-games";
const STEAM_GAMES_URL =
    "https://store.steampowered.com/search/?sort_by=Price_ASC&maxprice=free&category1=998&specials=1&ndl=1";

const ALARM_NAME = "checkFreeGames";
let isChecking = false;
// Distinct from the green claimed-count badge (see handleInstall) so "still
// working" never reads as "N games claimed".
const CLAIMING_BADGE_COLOR = "#f0ad4e";

// --- Pure helpers (module-level and exported so they're unit-testable) ---

export function areDatesDifferent(date1: string, date2: string): boolean {
  return !!date1 && new Date(date1).toDateString() !== new Date(date2).toDateString();
}

export function didEnoughTimePass(lastOpened: string, requiredMinutes: number): boolean {
  const lastDate = new Date(lastOpened);
  const now = new Date();
  const minutesElapsed = (now.getTime() - lastDate.getTime()) / (1000 * 60);
  return minutesElapsed >= requiredMinutes;
}

// `active` defaults to enabled (see OnButton's useStorage default) — unset
// storage (nothing persisted yet, e.g. before the popup has ever rendered)
// must read as active, not inactive. The same asymmetric-default class of bug
// already fixed for the platform toggles in resolvePlatformToggles: without
// this, a fresh install's alarm never gets created and its first scheduled
// check never runs, since nothing writes `active` to storage until OnButton
// itself mounts.
export function isActive(active: unknown): boolean {
  return active !== false;
}

// Confirmed (against Prime Gaming's own reference scraper and third-party
// lineup trackers): new titles land almost exclusively on Thursdays — a larger
// batch on the month's first Thursday, then a weekly trickle — with only rare
// off-cycle bonus adds. Unlike Epic/Steam/GOG/IndieGala, Prime has no
// background-reachable listing endpoint (see checkPrimeGaming), so opening a
// real tab on every claimFrequency tick (which can be as often as hourly)
// finds nothing new on 5 of 7 days. Restricting the check to Thu/Fri (a
// one-day buffer for late/timezone drops) cuts that overhead without missing
// drops; the interval catch-up guarantees an off-cycle title or a missed
// Thu/Fri window is never more than PRIME_GAMING_MAX_CHECK_INTERVAL_DAYS stale.
export const PRIME_GAMING_CHECK_DAYS_OF_WEEK = [4, 5]; // Date#getDay(): Thu, Fri
export const PRIME_GAMING_MAX_CHECK_INTERVAL_DAYS = 6;

// GOG defaults ON for existing behavior; IndieGala and Prime Gaming default
// OFF on a fresh install — so an unset ("never stored") value must resolve
// opposite ways for the two groups. This is a pure, testable extraction of
// that asymmetry: getStorageItems returns raw storage, not the useStorage
// hook's own defaultValue, and the popup's default only lands in storage once
// the popup has actually been opened — this alarm-driven (and install-time)
// path can run first.
//
// Steam/Epic are included too even though they default ON like GOG: passing
// a raw `null` straight into getEpicGamesList(shouldClaim: boolean = true)
// does NOT fall back to the default — JS default parameters only trigger for
// `undefined`, and getStorageItems resolves an unset key to `null`. Without
// resolving it here first, the very first (install-time) run silently never
// claims or detects login state for Steam/Epic on a fresh install.
export function resolvePlatformToggles(flags: {
  steamCheck?: boolean | null;
  epicCheck?: boolean | null;
  gogCheck?: boolean | null;
  indieGalaCheck?: boolean | null;
  primeGamingCheck?: boolean | null;
}): {
  claimSteam: boolean;
  claimEpic: boolean;
  claimGog: boolean;
  claimIndieGala: boolean;
  claimPrimeGaming: boolean;
} {
  return {
    claimSteam: flags.steamCheck !== false,
    claimEpic: flags.epicCheck !== false,
    claimGog: flags.gogCheck !== false,
    claimIndieGala: flags.indieGalaCheck === true,
    claimPrimeGaming: flags.primeGamingCheck === true,
  };
}

export function shouldCheckPrimeGamingToday(lastCheck: string | null, now: Date): boolean {
  if (!lastCheck) return true;
  if (!areDatesDifferent(lastCheck, now.toISOString())) return false;

  const daysSinceLastCheck = (now.getTime() - new Date(lastCheck).getTime()) / (24 * 60 * 60 * 1000);
  if (daysSinceLastCheck >= PRIME_GAMING_MAX_CHECK_INTERVAL_DAYS) return true;

  return PRIME_GAMING_CHECK_DAYS_OF_WEEK.includes(now.getDay());
}

// Force Epic claim pages into English (?lang=en-US) so the content script can match
// confirmation buttons ("Add to library", etc.) by text regardless of the user's
// account language. Non-Epic URLs (e.g. Steam) are returned unchanged.
export function withEpicEnglishLocale(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith("epicgames.com")) {
      parsed.searchParams.set("lang", "en-US");
      return parsed.toString();
    }
  } catch {
    // Not an absolute URL — leave it as-is.
  }
  return url;
}

// Epic exposes the same product under several slug fields and they are not
// interchangeable. `productSlug` is a legacy *path* that often carries a
// "/home" suffix (e.g. "cardpocalypse/home"), which produces a 404 product URL;
// the page-mapping tables carry the bare slug ("cardpocalypse"). Prefer those,
// and normalise whatever we get so a stray path segment can never leak into the
// URL again.
export function resolveEpicSlug(game: EpicElement): string {
  const candidates = [
    ...(game.catalogNs?.mappings ?? []).map((m) => m?.pageSlug),
    ...(game.offerMappings ?? []).map((m) => m?.pageSlug),
    game.productSlug,
  ];

  for (const candidate of candidates) {
    const slug = normalizeEpicSlug(candidate);
    if (slug) return slug;
  }
  return "";
}

function normalizeEpicSlug(raw: string | undefined | null): string {
  const trimmed = (raw ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "";
  // "cardpocalypse/home" -> "cardpocalypse". Any other multi-segment slug is
  // reduced to its first segment for the same reason: /p/ takes one segment.
  return trimmed.split("/")[0] ?? "";
}

// Splits an Epic search payload into the games that are free right now and the
// ones announced as free next. A game must appear in exactly one bucket — Epic
// can report both a current and an upcoming free offer for the same title
// during the weekly changeover, and listing it twice made the popup show
// duplicates.
export function partitionEpicPromotions(games: EpicElement[]): {
  current: EpicElement[];
  future: EpicElement[];
} {
  const current = games.filter((game) =>
      game.price?.totalPrice?.discountPrice === 0 &&
      (game.promotions?.promotionalOffers?.length ?? 0) > 0
  );
  const currentTitles = new Set(current.map((game) => game.title));

  const future = games.filter((game) =>
      !currentTitles.has(game.title) &&
      game.promotions?.upcomingPromotionalOffers?.[0]?.promotionalOffers?.[0]
          ?.discountSetting?.discountPercentage === 0
  );

  return { current, future };
}

export function formatEpicFreeGame(game: EpicElement, future: boolean): FreeGame {
  const slug = resolveEpicSlug(game);

  const isEpicBundle =
      Array.isArray(game.categories) &&
      game.categories.some((c) => c?.path === "bundles");

  const path = isEpicBundle ? "bundle" : "p";

  const promo =
      (future
          ? game.promotions?.upcomingPromotionalOffers?.[0]?.promotionalOffers?.[0]
          : game.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0]) ?? {};

  return {
    title: game.title ?? "",
    platform: Platforms.Epic,
    // No resolvable slug would mean a bare "/p/" 404, so fall back to the
    // free-games hub: still claimable, and the content script runs there.
    link: slug ? `${EPIC_PRODUCT_BASE}/${path}/${slug}` : EPIC_FREE_GAMES_URL,
    img:
        game.keyImages?.find((img: EpicKeyImage) => img.type === "Thumbnail")?.url ||
        game.keyImages?.[0]?.url ||
        "/icon/128.png",
    description: game.description ?? "",
    startDate: new Date(promo.startDate ?? 0).toISOString(),
    endDate: new Date(promo.endDate ?? 0).toISOString(),
    future,
  };
}

export const background = {
  // Set by claimGames() during a run so getFreeGamesList's finally block
  // knows whether to leave the badge's claimed-count alone or clear it.
  claimedSomethingThisRun: false,

  async main() {
    browser.runtime.onStartup.addListener(() => this.handleStartup());

    browser.runtime.onMessage.addListener((request: MessageRequest, sender: Browser.runtime.MessageSender) =>
        this.handleMessage(request, sender)
    );

    browser.runtime.onInstalled.addListener((r: Browser.runtime.InstalledDetails) => this.handleInstall(r));

    browser.alarms.onAlarm.addListener((alarm: Browser.alarms.Alarm) => {
      if (alarm.name === ALARM_NAME) {
        void this.handleAlarmTriggered();
      }
    });

    // Initialize alarms on startup
    await this.initializeAlarms();

  },

  async handleStartup() {
    const result = await getStorageItems(["active", "claimFrequency"]);
    if (!isActive(result?.active)) return;

    const frequency = result.claimFrequency || ClaimFrequency.DAILY;
    
    // Always check on startup, regardless of frequency setting
    // The checkAndClaimIfDue method handles the frequency-specific logic
    await this.checkAndClaimIfDue(frequency);
  },

  async handleAlarmTriggered() {
    const result = await getStorageItems(["active", "claimFrequency"]);
    if (!isActive(result?.active)) return;

    const frequency = result.claimFrequency || ClaimFrequency.DAILY;
    await this.checkAndClaimIfDue(frequency);
  },

  async checkAndClaimIfDue(frequency: ClaimFrequency) {
    if (isChecking) return;
    isChecking = true;
    try {
      const today = new Date().toISOString();
      const lastOpened = await getStorageItem("lastOpened");
      if (!lastOpened) {
        await this.getFreeGamesAndSetOpenedFlag(today);
        return;
      }
      if (frequency === ClaimFrequency.DAILY || frequency === ClaimFrequency.BROWSER_START) {
        if (areDatesDifferent(lastOpened, today)) {
          await this.getFreeGamesAndSetOpenedFlag(today);
        }
      } else {
        const requiredMinutes = ClaimFrequencyMinutes[frequency];
          if (didEnoughTimePass(lastOpened, requiredMinutes)) {
            await this.getFreeGamesAndSetOpenedFlag(today);
          }
      }
    } finally {
      isChecking = false;
    }

  },

  async getFreeGamesAndSetOpenedFlag(opened: string) {
    await this.getFreeGamesList();
    await setStorageItem("lastOpened", opened);
  },

  async initializeAlarms() {
    const result = await getStorageItems(["active", "claimFrequency"]);
    if (!isActive(result?.active)) {
      try {
        await browser.alarms.clear(ALARM_NAME);
      } catch (e) {
        // Alarm might not exist, ignore error
      }
      return;
    }

    const frequency = result.claimFrequency || ClaimFrequency.DAILY;
    
    if (frequency === ClaimFrequency.BROWSER_START) {
      try {
        await browser.alarms.clear(ALARM_NAME);
      } catch (e) {
        // Alarm might not exist, ignore error
      }
      return;
    }

    const minutes = ClaimFrequencyMinutes[frequency as ClaimFrequency];
    if (minutes > 0) {
      // Check if alarm already exists with correct period
      try {
        const existingAlarm = await browser.alarms.get(ALARM_NAME);
        if (existingAlarm && existingAlarm.periodInMinutes === minutes) {
          // Alarm already set correctly, no need to update
          return;
        }
      } catch (e) {
        // Alarm doesn't exist, will create it
      }

      // Create or update alarm
      await browser.alarms.create(ALARM_NAME, {
        periodInMinutes: minutes
      });
    }
  },

  // Wraps the whole check/claim run with a visible "in progress" signal — the
  // popup (via the isClaiming storage flag) and the toolbar badge both need
  // to know a run that can open many tabs and take a while is happening,
  // rather than giving no feedback until (or unless) it finishes.
  async getFreeGamesList() {
    this.claimedSomethingThisRun = false;
    await setStorageItem("isClaiming", true);
    await this.setBadgeText("…");
    await setActionBadgeBackgroundColor(CLAIMING_BADGE_COLOR);
    try {
      await this.runFreeGamesChecks();
    } finally {
      await setStorageItem("isClaiming", false);
      // Leave the count claimGames() already set alone; only clear the "in
      // progress" placeholder if nothing this run ever replaced it.
      if (!this.claimedSomethingThisRun) await this.setBadgeText("");
    }
  },

  async runFreeGamesChecks() {
    const { steamCheck, epicCheck, gogCheck, indieGalaCheck, primeGamingCheck, indieGalaWheelCheck } = await getStorageItems([
      "steamCheck", "epicCheck", "gogCheck", "indieGalaCheck", "primeGamingCheck", "indieGalaWheelCheck",
    ]);
    const { claimSteam, claimEpic, claimGog, claimIndieGala, claimPrimeGaming } =
        resolvePlatformToggles({ steamCheck, epicCheck, gogCheck, indieGalaCheck, primeGamingCheck });
    try {
      await this.getEpicGamesList(claimEpic);
    } catch (e) {
      console.error("getEpicGamesList failed:", e);
      if (claimEpic) await this.openTabAndSendActionToContent(EPIC_GAMES_URL, "getFreeGames");
    }
    try {
      await this.getSteamGamesList(claimSteam);
    } catch (e) {
      console.error("getSteamGamesList failed:", e);
      if (claimSteam) await this.openTabAndSendActionToContent(STEAM_GAMES_URL, "getFreeGames");
    }
    // Skipped entirely (not just un-claimed) when disabled — unlike the other
    // platforms' public/no-auth APIs, GOG's status endpoint needs the user's
    // session and has genuine failure modes (signed out, transport errors)
    // worth avoiding altogether when the user doesn't want GOG at all.
    if (claimGog) {
      try {
        await this.getGogGamesList(claimGog);
      } catch (e) {
        console.error("getGogGamesList failed:", e);
        await this.openTabAndSendActionToContent(GOG_HOME_URL, "getFreeGames");
      }
    }
    // Wheel spun before the regular freebie claim, per spec — the two are
    // independent (different storage keys, different tab targets), so the
    // order is purely a preference, not a correctness requirement.
    try {
      await this.checkIndieGalaWheel(claimIndieGala && indieGalaWheelCheck === true);
    } catch (e) {
      console.error("checkIndieGalaWheel failed:", e);
    }
    try {
      await this.getIndieGalaGamesList(claimIndieGala);
    } catch (e) {
      console.error("getIndieGalaGamesList failed:", e);
      if (claimIndieGala) await this.openTabAndSendActionToContent(INDIEGALA_FREEBIES_URL, "getFreeGames");
    }
    try {
      await this.checkPrimeGaming(claimPrimeGaming);
    } catch (e) {
      console.error("checkPrimeGaming failed:", e);
    }
  },

  async claimGames(games: FreeGame[]) {
    // Filter BEFORE the badge and the tab loop: each game costs a tab plus a
    // spacing wait, and the badge must count what we actually claim.
    const claimable = await this.filterByReviewThreshold(games);
    if (claimable.length === 0) return;

    // Prime Gaming's internal offers all share one claim page — the content
    // script claims every unclaimed offer it finds in a single visit, so opening
    // a separate tab per game (all pointing at the same URL) would just be
    // wasted spacing waits. Epic's slug-less fallback link is the one other case
    // where links can collide; collapsing those to one hub visit is also correct
    // (that fallback was already non-functional for claiming — see
    // epic.content.ts's purchase-button lookup, which needs a real product page).
    const uniqueByLink = Array.from(new Map(claimable.map((g) => [g.link, g])).values());

    this.claimedSomethingThisRun = true;
    void this.setBadgeText(claimable.length.toString());
    for (let i = 0; i < uniqueByLink.length; i++) {
      const game = uniqueByLink[i];
      // One unreachable tab (404 product page, content script never injected,
      // navigation error) must not cancel the remaining claims.
      try {
        await this.openTabAndSendActionToContent(withEpicEnglishLocale(game.link), "claimGames");
      } catch (e) {
        console.error(`claimGames: failed to claim "${game.title}" (${game.link})`, e);
      }
      // Tabs close themselves once their content script is done (see
      // closeCurrentTab), so this is just spacing between opens, not a wait
      // for completion — kept short, and skipped entirely after the last
      // game since there's nothing left to space out.
      if (i < uniqueByLink.length - 1) await this.wait(3_000);
    }
  },

  // Applies the optional Steam positive-review gate. Epic games are never
  // filtered — the setting is Steam-only — and a blank setting is a no-op.
  async filterByReviewThreshold(games: FreeGame[]): Promise<FreeGame[]> {
    const threshold = await getStorageItem<number>("steamMinPositivePercent");
    if (threshold == null) return games;

    const verdicts = await Promise.all(
        games.map((game) =>
            game.platform === Platforms.Steam
                ? shouldClaimSteamGame(game.link, threshold)
                : Promise.resolve(true)
        )
    );
    return games.filter((_, index) => verdicts[index]);
  },

  steamAddToCart(tabId: number, appId: number) {
    return browser.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [appId],
      func: (appId: number) => {
        const fn =
            (window as any).addToCart ||
            (window as any).AddToCart ||
            (window as any).g_cartAddToCart ||
            (window as any).g_AddToCart;

        if (typeof fn === "function") {
          try {
            fn(appId);
            return true;
          } catch (e) {
            console.error("addToCart call failed:", e);
            return false;
          }
        }

        // fallback: simulate click in MAIN world
        const el = document.querySelector(
            `div.btn_addtocart a[href^="javascript:addToCart(${appId})"]`
        );
        if (el) {
          el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
          el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
          el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          return true;
        }

        console.warn("No addToCart function or button found for", appId);
        return false;
      },
    });
  },

  // Background tabs so a claim run never steals focus from whatever the user
  // is actually doing — content scripts don't need the tab visible to work.
  async openTabAndSendActionToContent(url: string, action: string) {
    const tab = await browser.tabs.create({ url, active: false });
    if (!tab || !tab.id) return;
    await this.waitForTabToLoad(tab.id);
    await this.sendMessageWithRetry(tab.id, { target: "content", action });
  },

  // The content script registers its onMessage listener at document_idle, which
  // can land slightly after tab status reaches "complete". Retry until the
  // receiver is ready rather than losing the claim on the first
  // "Could not establish connection" rejection.
  async sendMessageWithRetry(
      tabId: number,
      message: { target: string; action: string },
      maxRetries = 10,
      delayMs = 300
  ) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await browser.tabs.sendMessage(tabId, message);
      } catch (e) {
        if (attempt === maxRetries - 1) {
          console.error(`sendMessageWithRetry: content script unreachable in tab ${tabId}`, e);
          throw e;
        }
        await this.wait(delayMs);
      }
    }
  },

  async handleMessage(request: MessageRequest, sender?: Browser.runtime.MessageSender) {
    if (request.target !== "background") return;

    if (request.action === "claim") {
      await this.clearGamesList();
      await this.getFreeGamesList();
    } else if (request.action === "claimFreeGames") {
      if (request.data?.loggedIn === false) return;
      const games: FreeGame[] = request.data.freeGames;
      await this.claimGames(games);
    } else if (request.action === "steamAddToCart") {
      const appId = Number(request.data?.appId ?? request.data?.appid);
      const tabId = sender?.tab?.id;
      if (tabId != null && Number.isFinite(appId)) {
        return this.steamAddToCart(tabId, appId);
      } else {
        console.warn("Missing tabId or appId", { tabId, appId, sender });
      }
    } else if (request.action === "updateFrequency" || request.action === "updateActive") {
      await this.initializeAlarms();
    } else if (request.action === "checkPlatformLogin") {
      const platform = request.data?.platform as Platforms | undefined;
      if (platform) await this.checkPlatformLogin(platform);
    } else if (request.action === "closeTab") {
      const tabId = sender?.tab?.id;
      if (tabId != null) {
        try {
          await browser.tabs.remove(tabId);
        } catch (e) {
          // Tab may already be closed (e.g. the user closed it manually).
        }
      }
    }
  },

  wait(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  },

  async waitForTabToLoad(tabId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      async function checkTab() {
        try {
          const tab = await browser.tabs.get(tabId);
          if (!tab) return reject(new Error("tab not found"));
          if (tab.status === "complete") {
            resolve();
          } else {
            setTimeout(checkTab, 100);
          }
        } catch (error) {
          reject(error);
        }
      }
      void checkTab();
    });
  },

  // Deliberately does nothing on a fresh install — claiming only ever
  // happens on a browser restart (handleStartup) or once the configured
  // claimFrequency interval is actually due (handleAlarmTriggered), never
  // as a side effect of installing or of flipping a setting. LoginStatus
  // shows a "Log in" prompt by default (see LoginStatus.tsx) so the popup
  // still has something useful to show before either of those has run.
  handleInstall(r: Browser.runtime.InstalledDetails) {
    if (r.reason === "update") {
      void setActionBadgeBackgroundColor("#50ca26");
      void this.setBadgeText("New");
    }
  },
  async getEpicGamesList(shouldClaim: boolean = true) {
    const response = await fetch(EPIC_API_URL);
    if (!response.ok) {
      console.error("Failed to fetch Epic Games data:", response.statusText);
      return;
    }

    const data = (await response.json()) as EpicSearchResponse;

    const games: EpicElement[] = data?.data?.Catalog?.searchStore?.elements ?? [];

    const { current: freeGames, future: futureFreeGames } = partitionEpicPromotions(games);

    const currFreeGames: FreeGame[] = await getStorageItem("epicGames") || [];
    const newGames = freeGames.filter((game) =>
        !currFreeGames.some((g) => g?.title === game?.title)
    );

    // Both lists are persisted before any claiming happens, and both are written
    // unconditionally. Claiming used to sit between the two writes, so a failed
    // claim aborted the futureGames refresh and left last week's "upcoming"
    // entry next to this week's free entry in the popup.
    await setStorageItem("epicGames", freeGames.map(g => formatEpicFreeGame(g, false)));
    await setStorageItem("futureGames", futureFreeGames.map(g => formatEpicFreeGame(g, true)));

    if (shouldClaim && newGames.length > 0) {
      await this.claimGames(newGames.map(g => formatEpicFreeGame(g, false)));
    }
  },

  async getSteamGamesList(shouldClaim: boolean = true) {
    const html = await fetch(STEAM_GAMES_URL).then(r => r.text());

    const root = parse(html);

    const resolveUrl = (u: string) =>
        u ? new URL(u, 'https://store.steampowered.com').toString() : '';

    const container = root.querySelector('div#search_result_container');
    const freeGameNodes = container
        ? container.querySelectorAll('a.search_result_row')
        : [];
    if (freeGameNodes.length === 0) return;

    const gamesArr: FreeGame[] = [];

    for (const node of freeGameNodes) {
      const href = node.getAttribute('href') ?? '';
      const title = node.querySelector('span.title')?.text?.trim() ?? '';

      const imgEl = node.querySelector('img');
      const imgRaw =
          imgEl?.getAttribute('src')?.trim() ||
          imgEl?.getAttribute('data-src')?.trim() ||
          imgEl?.getAttribute('data-lazy')?.trim() ||
          '';

      if (href && title) {
        gamesArr.push({
          link: resolveUrl(href),
          img: imgRaw ? resolveUrl(imgRaw) : '',
          title,
          platform: Platforms.Steam,
        });
      }
    }

    const currFreeGames: FreeGame[] = await getStorageItem("steamGames") || [];
    const newGames: FreeGame[] = gamesArr.filter(game =>
        !currFreeGames.some(g => g?.title === game?.title)
    );
    if (newGames.length === 0) return;

    if (shouldClaim) await this.claimGames(newGames);
    await setStorageItem('steamGames', newGames);
  },

  // GOG runs one giveaway at a time and only exposes it to a signed-in session.
  // A 401 here is ambiguous — the service worker may simply not have attached
  // the cookie — so it is thrown rather than recorded as "signed out", letting
  // getFreeGamesList retry the whole lookup from a real gog.com tab.
  async getGogGamesList(shouldClaim: boolean = true) {
    const lookup = await fetchGiveaway();
    if (lookup.unauthorized) {
      throw new Error("GOG giveaway status requires a signed-in session");
    }
    const game = lookup.game;
    if (!game) return;

    const currFreeGames: FreeGame[] = await getStorageItem("gogGames") || [];
    if (currFreeGames.some((g) => g?.title === game.title)) return;

    await setStorageItem("gogGames", [game]);
    if (shouldClaim) await this.claimGames([game]);
  },

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

    // Persisted regardless of login state so the popup can still show what's
    // available. Only the claim itself is gated: IndieGala's index page lists
    // ~7 simultaneous freebies (unlike GOG's 1), so a logged-out run would
    // otherwise burn the whole list into "already seen" storage in one go with
    // 7 wasted tabs and 7 failed claims that never retry automatically.
    await setStorageItem("indieGalaGames", gamesArr);
    const loggedIn = await getStorageItem<LoginState>("indieGalaLoggedIn");
    if (shouldClaim && loggedIn !== false && newGames.length > 0) {
      await this.claimGames(newGames);
    }
  },

  // The daily wheel resets once per calendar day server-side regardless of how
  // often getFreeGamesList runs, so this self-gates on its own last-check date
  // instead of reusing claimFrequency — an hourly game-claim cadence must not
  // reopen an IndieGala tab every hour just to find no spin available.
  // Unlike the other platforms, the wheel has no fast background-fetch path:
  // reading it requires a CSRF cookie only a real page can supply, so this
  // always opens a tab when due, same as Prime Gaming.
  async checkIndieGalaWheel(shouldSpin: boolean) {
    if (!shouldSpin) return;

    const today = new Date().toISOString();
    const lastCheck = await getStorageItem<string>("indieGalaWheelLastCheck");
    if (lastCheck && !areDatesDifferent(lastCheck, today)) return;

    // Flag set only after the tab/message actually goes out (mirrors
    // getFreeGamesAndSetOpenedFlag): if this throws, today's attempt never
    // happened, so the next check must still retry rather than silently
    // skipping the wheel for the rest of the day.
    await this.openTabAndSendActionToContent(INDIEGALA_WHEEL_URL, "spinWheel");
    await setStorageItem("indieGalaWheelLastCheck", today);
  },

  // See shouldCheckPrimeGamingToday: Prime has no background-reachable listing
  // endpoint (gaming.amazon.com/home is a client-rendered SPA that only exists
  // after an authenticated page load, unlike Epic/Steam/GOG/IndieGala's
  // fetch-first paths), so checking still means opening a real tab — this just
  // restricts *how often* that tab opens to the days it can actually find
  // something new.
  // `force` bypasses the day-of-week/catch-up gate above — used only by an
  // explicit user action (clicking "Log in" for Prime Gaming; see
  // checkPlatformLogin), never by the automatic startup/alarm path, since the
  // whole point of a manual trigger is to ignore automatic throttling.
  async checkPrimeGaming(shouldCheck: boolean, force: boolean = false) {
    if (!shouldCheck) return;

    const now = new Date();
    const lastCheck = await getStorageItem<string>("primeGamingLastCheck");
    if (!force && !shouldCheckPrimeGamingToday(lastCheck, now)) return;

    // Flag set only after the tab/message actually goes out (mirrors
    // checkIndieGalaWheel): if this throws, today's attempt never happened, so
    // the next due check must still retry rather than silently skipping ahead.
    await this.openTabAndSendActionToContent(PRIME_GAMING_HOME_URL, "getFreeGames");
    await setStorageItem("primeGamingLastCheck", now.toISOString());
  },

  // Triggered by clicking a platform's "Log in" link in the popup (see
  // LoginStatus) — a deliberate, explicit user action, so unlike the
  // startup/alarm path this always runs regardless of claimFrequency or (for
  // Prime Gaming) the day-of-week gate, and isn't wrapped in the
  // isClaiming/badge "in progress" indicator that a full multi-platform run
  // gets, since the popup that triggered this has already closed by the time
  // the click's target="_blank" tab opens.
  async checkPlatformLogin(platform: Platforms) {
    // Mirrors runFreeGamesChecks's per-platform fallback: Epic/Steam/GOG/
    // IndieGala's fast background-fetch path can fail for reasons (including
    // an ambiguous 401) that a real page visit resolves, so a failure here
    // falls back to opening one, same as the automatic path does.
    try {
      switch (platform) {
        case Platforms.Steam:
          await this.getSteamGamesList(true);
          break;
        case Platforms.Epic:
          await this.getEpicGamesList(true);
          break;
        case Platforms.GOG:
          await this.getGogGamesList(true);
          break;
        case Platforms.IndieGala:
          await this.getIndieGalaGamesList(true);
          break;
        case Platforms.PrimeGaming:
          await this.checkPrimeGaming(true, true);
          break;
      }
    } catch (e) {
      console.error(`checkPlatformLogin failed for ${platform}:`, e);
      const fallbackUrl = {
        [Platforms.Steam]: STEAM_GAMES_URL,
        [Platforms.Epic]: EPIC_GAMES_URL,
        [Platforms.GOG]: GOG_HOME_URL,
        [Platforms.IndieGala]: INDIEGALA_FREEBIES_URL,
        [Platforms.PrimeGaming]: undefined,
      }[platform];
      if (fallbackUrl) await this.openTabAndSendActionToContent(fallbackUrl, "getFreeGames");
    }
  },

  async clearGamesList() {
    await setStorageItem("epicGames", []);
    await setStorageItem("futureGames", []);
    await setStorageItem("steamGames", []);
    await setStorageItem("gogGames", []);
    await setStorageItem("indieGalaGames", []);
    await setStorageItem("primeGamingGames", []);
  },

  async setBadgeText(text: string) {
    await setActionBadgeText(text);
  }
};

export default defineBackground(background);
