import {MessageRequest} from "@/entrypoints/types/messageRequest.ts";
import {getStorageItem, getStorageItems, setStorageItem} from "@/entrypoints/hooks/useStorage.ts";
import {FreeGame} from "@/entrypoints/types/freeGame.ts";
import {Platforms} from "@/entrypoints/enums/platforms.ts";
import {ClaimFrequency, ClaimFrequencyMinutes} from "@/entrypoints/enums/claimFrequency.ts";
import {
  addToCartInMainWorld,
  hasSteamResultList,
  parseSteamFreeGames,
  parseSteamLoginState,
  STEAM_GAMES_URL,
} from "@/entrypoints/utils/steamGames.ts";
import {GOG_HOME_URL, fetchGiveaway} from "@/entrypoints/utils/gogGiveaway.ts";
import {markSteamOwned, parseSteamOwnedApps, STEAM_USERDATA_URL} from "@/entrypoints/utils/steamOwnership.ts";
import {fetchFreebiesPage, INDIEGALA_FREEBIES_URL} from "@/entrypoints/utils/indieGalaGiveaway.ts";
import {INDIEGALA_WHEEL_URL} from "@/entrypoints/utils/indieGalaWheel.ts";
import {registerKeyInMainWorld, STEAM_ACTIVATION_PAGE} from "@/entrypoints/utils/steamKeyActivation.ts";
import {
  collectWonSteamKeys,
  handleGiftKeys,
  isIndieGalaGiftUrl,
  KeyFlowDeps,
  parseGiftKeys,
  parseSteamKeyReport,
  recordSteamKeyResult,
  snapshotGifts,
} from "@/entrypoints/utils/steamKeyFlow.ts";
import {
  EXTERNAL_PLATFORM_STORAGE_KEYS,
  PRIME_GAMING_HOME_URL,
  primeGameAccessToggle,
  readAllowedExternalPlatforms,
} from "@/entrypoints/utils/primeGamingGiveaway.ts";
import {
  ClaimAttempts,
  ensureLunaOriginRule,
  excludeRecentlyAttempted,
  fetchPrimeLookup,
  isLunaRedirecting,
  LUNA_CLAIMS_URL,
  LUNA_ORIGIN,
  onLunaSite,
  LUNA_REGION_CHECK_INTERVAL_MS,
  LUNA_REGION_CHECKED_AT_KEY,
  lunaRegionalHostOf,
  PRIME_REGIONAL_HOST_KEY,
  PrimeLookup,
  PrimeOffer,
  selectClaimableOffers,
  updateClaimAttempts,
} from "@/entrypoints/utils/primeGamingApi.ts";
import {
  LOGIN_STATE_KEYS,
  LoginState,
  PRIME_MEMBERSHIP_KEY,
  recordLoginState,
  recordPrimeMembership,
} from "@/entrypoints/utils/loginState.ts";
import {
  setBadgeBackgroundColor as setActionBadgeBackgroundColor,
  setBadgeText as setActionBadgeText,
} from "@/entrypoints/utils/badge.ts";
import {shouldClaimSteamGame} from "@/entrypoints/utils/steamReviews.ts";
import {browser, type Browser} from "wxt/browser";
import {EpicElement, EpicSearchResponse} from "@/entrypoints/types/epicGame.ts";
import {
  EPIC_API_URL,
  EPIC_CLAIMED_KEY,
  epicProductKey,
  formatEpicFreeGame,
  partitionEpicPromotions,
  withEpicEnglishLocale,
} from "@/entrypoints/utils/epicGames.ts";
import {
  areDatesDifferent,
  didEnoughTimePass,
  isActive,
  isDailyClaimDue,
  nextHourStart,
  shouldCheckPrimeGamingToday,
} from "@/entrypoints/utils/scheduling.ts";
import {PLATFORM_ACCESS_TOGGLES, resolvePlatformToggles} from "@/entrypoints/utils/platformToggles.ts";
import {
  AccessGroup,
  hasAccessFor,
  PENDING_ACCESS_REQUEST_KEY,
  isLunaRegionalHost,
  LunaRegionalHost,
  readGrantedAccessGroups,
  toggleToCompleteAfterGrant,
  TOGGLES_ENABLED_WITH,
} from "@/entrypoints/utils/optionalAccess.ts";
import {syncRuntimeContentScripts} from "@/entrypoints/utils/runtimeContentScripts.ts";
import {
  assertStoreOk,
  fetchWithRetry,
  SignedOutError,
  StoreChangedError,
} from "@/entrypoints/utils/network.ts";
import {classifyFailure, HealthProblem, recordHealthError, recordHealthOk} from "@/entrypoints/utils/health.ts";

const ALARM_NAME = "checkFreeGames";
// One-off: a run where no store could be reached (offline, e.g. right after
// browser start) is tried again this soon instead of at the next due check.
const OFFLINE_RETRY_ALARM = "retryAfterOffline";
const OFFLINE_RETRY_MINUTES = 15;
// How long a claim tab may take to load its page before it's given up on,
// so one page that never loads can't stall the rest of a claim run.
const TAB_LOAD_TIMEOUT_MS = 60_000;
const TAB_LOAD_POLL_MS = 100;
const HOURLY_CHECK_MINUTES = 60;
let isChecking = false;

// Stored as 0-23, or null for "any time".
function readClaimHour(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23 ? value : null;
}
// Distinct from the green claimed-count badge (see handleInstall) so "still
// working" never reads as "N games claimed".
const CLAIMING_BADGE_COLOR = "#f0ad4e";
// "!" on the toolbar: a store check failed (see health.ts); the popup says which.
const PROBLEM_BADGE_COLOR = "#d9534f";
// Chains every syncContentScripts call: main() and a permissions event can
// start one at the same moment (a grant wakes the worker), and two overlapping
// syncs would both try to register the same script id.
let contentScriptSync: Promise<void> = Promise.resolve();

export const background = {
  // Set by claimGames() during a run so getFreeGamesList's finally block
  // knows whether to leave the badge's claimed-count alone or clear it.
  claimedSomethingThisRun: false,
  // Set by recordStoreFailure during a run, for the same finally block.
  storeFailedThisRun: false,
  // How many store checks ran this run, and how many couldn't reach their
  // store (see getFreeGamesAndSetOpenedFlag).
  storeChecksThisRun: 0,
  unreachableStoresThisRun: 0,

  async main() {
    browser.runtime.onStartup.addListener(() => this.checkIfActiveAndDue());

    browser.runtime.onMessage.addListener((request: MessageRequest, sender: Browser.runtime.MessageSender) =>
        this.handleMessage(request, sender)
    );

    browser.runtime.onInstalled.addListener((r: Browser.runtime.InstalledDetails) => this.handleInstall(r));

    browser.alarms.onAlarm.addListener((alarm: Browser.alarms.Alarm) => {
      if (alarm.name === ALARM_NAME || alarm.name === OFFLINE_RETRY_ALARM) {
        void this.checkIfActiveAndDue();
      }
    });

    // A grant from the popup, or a revoke from the browser's own extension
    // settings, changes which runtime content scripts may run.
    browser.permissions.onAdded.addListener(() => {
      void this.syncContentScripts();
      void this.completePendingAccessRequest();
    });
    browser.permissions.onRemoved.addListener(() => void this.syncContentScripts());

    // Runtime registrations don't outlive the browser session, so every start
    // re-syncs. Started before the alarm setup so a claim run, which waits for
    // it (see runFreeGamesChecks), can't get ahead of it.
    const contentScriptsSynced = this.syncContentScripts();

    // Initialize alarms on startup
    await this.initializeAlarms();
    await contentScriptsSynced;
  },

  // Separate so tests can stand in for the permissions API.
  readGrantedAccess(): Promise<ReadonlySet<AccessGroup>> {
    return readGrantedAccessGroups(browser.permissions);
  },

  // Never rejects: a failed sync is logged and the next start or permission
  // change retries it, rather than breaking background start-up.
  syncContentScripts(): Promise<void> {
    contentScriptSync = contentScriptSync
        .then(async () => syncRuntimeContentScripts(browser.scripting, await this.readGrantedAccess()))
        .catch((e) => console.error("syncContentScripts failed:", e));
    return contentScriptSync;
  },

  // The popup turns a toggle on itself once its request is granted, but it
  // may have closed while the prompt was open (Firefox closes it), leaving
  // nobody to — see toggleWithAccess.
  async completePendingAccessRequest() {
    try {
      const pending = await getStorageItem(PENDING_ACCESS_REQUEST_KEY);
      const toggle = toggleToCompleteAfterGrant(pending, await this.readGrantedAccess(), new Date());
      if (!toggle) return;
      for (const enabled of [toggle, ...(TOGGLES_ENABLED_WITH[toggle] ?? [])]) {
        await setStorageItem(enabled, true);
      }
      await setStorageItem(PENDING_ACCESS_REQUEST_KEY, null);
    } catch (e) {
      console.error("completePendingAccessRequest failed:", e);
    }
  },

  // Browser start, the alarm, a fresh install and switching the power button
  // on all ask the same thing: if active, check now when claimFrequency says
  // a check is due (checkAndClaimIfDue). Nothing has run yet on a fresh
  // install, so that one always checks.
  async checkIfActiveAndDue() {
    const result = await getStorageItems(["active", "claimFrequency", "claimHour"]);
    if (!isActive(result?.active)) return;

    const frequency = result.claimFrequency || ClaimFrequency.DAILY;
    await this.checkAndClaimIfDue(frequency, readClaimHour(result.claimHour));
  },

  async checkAndClaimIfDue(frequency: ClaimFrequency, claimHour: number | null = null) {
    if (isChecking) return;
    isChecking = true;
    try {
      const today = new Date().toISOString();
      const lastOpened = await getStorageItem("lastOpened");
      if (!lastOpened) {
        await this.getFreeGamesAndSetOpenedFlag(today);
        return;
      }
      if (frequency === ClaimFrequency.DAILY) {
        if (isDailyClaimDue(lastOpened, new Date(), claimHour)) {
          await this.getFreeGamesAndSetOpenedFlag(today);
        }
      } else if (frequency === ClaimFrequency.BROWSER_START) {
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
    // Not stamped when no store could be reached: on the daily or
    // browser-start setting that would skip the rest of the day.
    if (this.storeChecksThisRun > 0 && this.unreachableStoresThisRun === this.storeChecksThisRun) {
      await browser.alarms.create(OFFLINE_RETRY_ALARM, { delayInMinutes: OFFLINE_RETRY_MINUTES });
      return;
    }
    await setStorageItem("lastOpened", opened);
  },

  async initializeAlarms() {
    const result = await getStorageItems(["active", "claimFrequency", "claimHour"]);
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

    // Once Daily at a chosen hour checks on every hour, on the hour, so the
    // hour is caught on time (isDailyClaimDue claims once that day).
    const hasClaimHour = frequency === ClaimFrequency.DAILY && readClaimHour(result.claimHour) !== null;
    const minutes = hasClaimHour ? HOURLY_CHECK_MINUTES : ClaimFrequencyMinutes[frequency as ClaimFrequency];
    if (minutes > 0) {
      // Check if alarm already exists with correct period
      try {
        const existingAlarm = await browser.alarms.get(ALARM_NAME);
        const isOnTheHour = !hasClaimHour || (existingAlarm && new Date(existingAlarm.scheduledTime).getMinutes() === 0);
        if (existingAlarm && existingAlarm.periodInMinutes === minutes && isOnTheHour) {
          // Alarm already set correctly, no need to update
          return;
        }
      } catch (e) {
        // Alarm doesn't exist, will create it
      }

      // Create or update alarm
      await browser.alarms.create(ALARM_NAME, hasClaimHour
          ? { when: nextHourStart(new Date()).getTime(), periodInMinutes: minutes }
          : { periodInMinutes: minutes });
    }
  },

  // Wraps the whole check/claim run with a visible "in progress" signal — the
  // popup (via the isClaiming storage flag) and the toolbar badge both need
  // to know a run that can open many tabs and take a while is happening,
  // rather than giving no feedback until (or unless) it finishes.
  // `force` is set only for the popup's manual "Claim now" (see handleMessage):
  // an explicit request to check now should skip Prime Gaming's automatic
  // throttles (the fallback's day gate and the per-offer retry cooldown).
  async getFreeGamesList(force: boolean = false) {
    this.claimedSomethingThisRun = false;
    this.storeFailedThisRun = false;
    this.storeChecksThisRun = 0;
    this.unreachableStoresThisRun = 0;
    await setStorageItem("isClaiming", true);
    await this.setBadgeText("…");
    await setActionBadgeBackgroundColor(CLAIMING_BADGE_COLOR);
    try {
      await this.runFreeGamesChecks(force);
    } finally {
      await setStorageItem("isClaiming", false);
      // Leave the count claimGames() already set alone; otherwise replace the
      // "in progress" placeholder with "!" if a store check failed.
      if (!this.claimedSomethingThisRun) {
        if (this.storeFailedThisRun) await this.showProblemBadge();
        else await this.setBadgeText("");
      }
    }
  },

  async runFreeGamesChecks(force: boolean = false) {
    const { steamCheck, epicCheck, gogCheck, indieGalaCheck, primeGamingCheck, indieGalaWheelCheck } = await getStorageItems([
      "steamCheck", "epicCheck", "gogCheck", "indieGalaCheck", "primeGamingCheck", "indieGalaWheelCheck",
    ]);
    const toggles = resolvePlatformToggles({ steamCheck, epicCheck, gogCheck, indieGalaCheck, primeGamingCheck });
    // Flag AND granted hosts (see hasAccessFor): a flag left on while its
    // hosts aren't granted (e.g. revoked, or set before an update) is off.
    const granted = await this.readGrantedAccess();
    const { claimSteam, claimEpic } = toggles;
    const claimGog = toggles.claimGog && hasAccessFor("gogCheck", granted);
    const canReachIndieGala = hasAccessFor("indieGalaCheck", granted);
    const claimIndieGala = toggles.claimIndieGala && canReachIndieGala;
    const spinWheel = claimIndieGala && indieGalaWheelCheck === true && hasAccessFor("indieGalaWheelCheck", granted);
    const claimPrimeGaming = toggles.claimPrimeGaming && hasAccessFor("primeGamingCheck", granted);
    // A claim tab opened before its content script is registered would just
    // sit there unclaimed.
    await contentScriptSync;
    // No fallback tab for Epic: the store page it used to scrape lost those
    // selectors in Epic's 2026 redesign, and the API rarely fails for long.
    await this.runStoreCheck(Platforms.Epic, claimEpic, () => this.getEpicGamesList(claimEpic, force));
    await this.runStoreCheck(Platforms.Steam, claimSteam, () => this.getSteamGamesList(claimSteam), STEAM_GAMES_URL);
    // Skipped entirely (not just un-claimed) when disabled — unlike the other
    // platforms' public/no-auth APIs, GOG's status endpoint needs the user's
    // session and has genuine failure modes (signed out, transport errors)
    // worth avoiding altogether when the user doesn't want GOG at all.
    if (claimGog) {
      try {
        await this.checkGog(force);
      } catch (e) {
        console.error("checkGog failed:", e);
      }
    }
    // Wheel spun before the regular freebie claim, per spec — the two are
    // independent (different storage keys, different tab targets), so the
    // order is purely a preference, not a correctness requirement.
    try {
      await this.checkIndieGalaWheel(spinWheel);
    } catch (e) {
      console.error("checkIndieGalaWheel failed:", e);
    }
    // Listing only (no claim) still needs the host: without it the browser
    // blocks the cross-origin fetch, which would just fail every run.
    if (canReachIndieGala) {
      await this.runStoreCheck(
          Platforms.IndieGala, claimIndieGala, () => this.getIndieGalaGamesList(claimIndieGala), INDIEGALA_FREEBIES_URL
      );
    }
    try {
      await this.checkPrimeGaming(claimPrimeGaming, force);
    } catch (e) {
      if (claimPrimeGaming) await this.recordStoreFailure(Platforms.PrimeGaming, e);
      else console.error("checkPrimeGaming failed:", e);
    }
  },

  // One store's check, recorded for the popup's health status (see
  // health.ts), but only while the store is switched on: the popup shows
  // nothing for one that's off. A fallback tab, if any, is a last attempt
  // through a real page and must not abort the other stores' checks.
  async runStoreCheck(platform: Platforms, isEnabled: boolean, check: () => Promise<void>, fallbackUrl?: string) {
    try {
      await check();
      if (isEnabled) await this.recordStoreOk(platform);
    } catch (e) {
      if (!isEnabled) {
        console.error(`${platform} check failed:`, e);
        return;
      }
      await this.recordStoreFailure(platform, e);
      // A page that can't load offline would only add a dead tab.
      if (!fallbackUrl || classifyFailure(e) === "network") return;
      try {
        await this.openTabAndSendActionToContent(fallbackUrl, "getFreeGames");
      } catch (fallbackError) {
        console.error(`${platform} fallback tab failed:`, fallbackError);
      }
    }
  },

  async recordStoreOk(platform: Platforms) {
    this.storeChecksThisRun++;
    await recordHealthOk(platform);
  },

  async recordStoreFailure(platform: Platforms, error: unknown) {
    console.error(`${platform} check failed:`, error);
    const problem = classifyFailure(error);
    // Signed out: the store answered, which is all health tracks.
    if (!problem) return this.recordStoreOk(platform);
    this.storeChecksThisRun++;
    if (problem === "network") this.unreachableStoresThisRun++;
    await recordHealthError(platform, problem, error instanceof Error ? error.message : String(error));
    this.storeFailedThisRun = true;
  },

  async showProblemBadge() {
    await setActionBadgeBackgroundColor(PROBLEM_BADGE_COLOR);
    await this.setBadgeText("!");
  },

  // Every store request from the background goes through here: retried while
  // the network is down or the store is overloaded (see fetchWithRetry).
  // Separate so tests can skip the retry delays.
  fetchStore(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return fetchWithRetry(input, init);
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

  // A Steam key won on IndieGala's wheel (see steamKeyFlow.ts).
  keyFlowDeps(): KeyFlowDeps {
    return {
      openTab: (url, action, data) => this.openTabAndSendActionToContent(url, action, data),
      fetchImpl: (input, init) => this.fetchStore(input, init),
      wait: (ms) => this.wait(ms),
    };
  },

  async steamRegisterKey(tabId: number): Promise<boolean> {
    const [injection] = await browser.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: registerKeyInMainWorld,
    });
    return injection?.result === true;
  },

  steamAddToCart(tabId: number, appId: number) {
    return browser.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [appId],
      func: addToCartInMainWorld,
    });
  },

  // Background tabs so a claim run never steals focus from whatever the user
  // is actually doing — content scripts don't need the tab visible to work.
  // A tab whose page never loads, or whose script never takes the message,
  // has nothing driving it, so it's closed rather than left sitting there.
  async openTabAndSendActionToContent(url: string, action: string, data?: unknown) {
    const tab = await browser.tabs.create({ url, active: false });
    if (!tab || !tab.id) return;
    try {
      await this.waitForTabToLoad(tab.id);
      if (url.includes("amazon.")) await this.noteLunaSite(tab.id);
      await this.sendMessageWithRetry(tab.id, data === undefined ? { target: "content", action } : { target: "content", action, data });
    } catch (e) {
      await browser.tabs.remove(tab.id).catch(() => {
        // Already closed (e.g. by the user).
      });
      throw e;
    }
  },

  // Any tab that lands on a regional Luna site (a claims page Amazon
  // redirected) tells which site is the user's, for free. Never throws.
  async noteLunaSite(tabId: number) {
    try {
      const host = lunaRegionalHostOf((await browser.tabs.get(tabId)).url);
      if (host) await setStorageItem(PRIME_REGIONAL_HOST_KEY, host);
    } catch (e) {
      console.warn("Reading a tab's Luna site failed:", e);
    }
  },

  // The content script registers its onMessage listener at document_idle, which
  // can land slightly after tab status reaches "complete". Retry until the
  // receiver is ready rather than losing the claim on the first
  // "Could not establish connection" rejection.
  async sendMessageWithRetry(
      tabId: number,
      message: MessageRequest,
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
      await this.getFreeGamesList(true);
    } else if (request.action === "claimFreeGames") {
      if (request.data?.loggedIn === false) return;
      const games: FreeGame[] = request.data.freeGames;
      await this.claimGames(await this.filterAccessibleGames(games));
    } else if (request.action === "steamAddToCart") {
      const appId = Number(request.data?.appId ?? request.data?.appid);
      const tabId = sender?.tab?.id;
      if (tabId != null && Number.isFinite(appId)) {
        return this.steamAddToCart(tabId, appId);
      } else {
        console.warn("Missing tabId or appId", { tabId, appId, sender });
      }
    } else if (request.action === "updateFrequency") {
      await this.initializeAlarms();
    } else if (request.action === "updateActive") {
      await this.initializeAlarms();
      // Switching it on checks now if a check is due, not only from the next
      // alarm or browser start on.
      await this.checkIfActiveAndDue();
    } else if (request.action === "checkPlatformLogin") {
      const platform = request.data?.platform as Platforms | undefined;
      if (platform) await this.checkPlatformLogin(platform);
    } else if (request.action === "reportHealth") {
      // A claim tab's outcome (see epic.content.ts); no problem means it worked.
      const platform = request.data?.platform as Platforms | undefined;
      if (!platform) return;
      const problem = request.data?.problem as HealthProblem | undefined;
      if (!problem) {
        await recordHealthOk(platform, new Date(), "claim");
        return;
      }
      await recordHealthError(platform, problem, String(request.data?.detail ?? ""), new Date(), "claim");
      // Over a claimed count, if one is showing: a claim that needs the user
      // matters more than how many tabs opened.
      await this.showProblemBadge();
    } else if (request.action === "bringTabToFront") {
      const tab = sender?.tab;
      if (tab?.id != null) await this.bringTabToFront(tab.id, tab.windowId);
    } else if (request.action === "wheelSignedOut") {
      // The day's spin is still to come: the next run retries once a check
      // sees the session again (see checkIndieGalaWheel).
      await setStorageItem("indieGalaWheelLastCheck", null);
      await recordLoginState(Platforms.IndieGala, false);
    } else if (request.action === "wheelSpun") {
      const outcome = await collectWonSteamKeys(String(request.data?.label ?? ""), this.keyFlowDeps());
      if (outcome === "pending") await this.showProblemBadge();
    } else if (request.action === "giftKeysRead") {
      // The page's address comes from the browser, not the message.
      const giftUrl = sender?.url;
      if (!isIndieGalaGiftUrl(giftUrl)) return;
      if (await handleGiftKeys(giftUrl!, parseGiftKeys(request.data?.keys), this.keyFlowDeps())) await this.showProblemBadge();
    } else if (request.action === "steamRegisterKey") {
      const tabId = sender?.tab?.id;
      if (tabId != null && sender?.url?.startsWith(STEAM_ACTIVATION_PAGE)) return this.steamRegisterKey(tabId);
    } else if (request.action === "steamKeyResult") {
      const report = parseSteamKeyReport(request.data);
      if (report && await recordSteamKeyResult(report) === "pending") await this.showProblemBadge();
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

  // For a tab only the user can finish (a captcha), opened in the background:
  // selected in its window, and the window flagged (dock bounce, taskbar
  // flash) rather than raised over whatever the user is doing. Needs no
  // permission, unlike a desktop notification.
  async bringTabToFront(tabId: number, windowId?: number) {
    try {
      await browser.tabs.update(tabId, { active: true });
      if (windowId != null) await browser.windows.update(windowId, { drawAttention: true });
    } catch (e) {
      // The tab may already be closed (e.g. the user closed it).
      console.warn("bringTabToFront failed:", e);
    }
  },

  // Content scripts can't read permissions, so the claims-page fallback reports
  // every offer the toggles allow; one whose redeem store lacks access is
  // dropped here, for the same reason as in claimPrimeOffers.
  async filterAccessibleGames(games: FreeGame[]): Promise<FreeGame[]> {
    const granted = await this.readGrantedAccess();
    return games.filter((game) =>
        game.platform !== Platforms.PrimeGaming || hasAccessFor(primeGameAccessToggle(game.link), granted)
    );
  },

  wait(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  },

  // A new tab starts on about:blank, and Firefox reports that as "complete"
  // before the real page has even started loading (confirmed live), so only
  // a complete page of the tab's own counts as loaded.
  async waitForTabToLoad(tabId: number, timeoutMs: number = TAB_LOAD_TIMEOUT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const tab = await browser.tabs.get(tabId);
      if (!tab) throw new Error("tab not found");
      if (tab.status === "complete" && tab.url !== "about:blank") return;
      if (Date.now() >= deadline) {
        throw new Error(`tab ${tabId} didn't load its page within ${timeoutMs / 1000}s`);
      }
      await new Promise((resolve) => setTimeout(resolve, TAB_LOAD_POLL_MS));
    }
  },

  // A fresh install checks right away: otherwise nothing happened until the
  // next browser restart, or a day later on the default frequency, and the
  // popup just sat at "0 games claimed". An update only badges.
  async handleInstall(r: Browser.runtime.InstalledDetails) {
    if (r.reason === "update") {
      void setActionBadgeBackgroundColor("#50ca26");
      void this.setBadgeText("New");
    } else if (r.reason === "install") {
      await this.checkIfActiveAndDue();
    }
  },
  async getEpicGamesList(shouldClaim: boolean = true, force: boolean = false) {
    const response = assertStoreOk(await this.fetchStore(EPIC_API_URL), "Epic's free-games API");
    const data = (await response.json()) as EpicSearchResponse;

    const games: EpicElement[] | undefined = data?.data?.Catalog?.searchStore?.elements;
    if (!Array.isArray(games)) {
      throw new StoreChangedError("Epic's free-games API answered without a game list");
    }

    const { current: freeGames, future: futureFreeGames } = partitionEpicPromotions(games);
    const listed = freeGames.map(g => formatEpicFreeGame(g, false));

    // Both lists are persisted before any claiming happens, and both are written
    // unconditionally. Claiming used to sit between the two writes, so a failed
    // claim aborted the futureGames refresh and left last week's "upcoming"
    // entry next to this week's free entry in the popup.
    await setStorageItem("epicGames", listed);
    await setStorageItem("futureGames", futureFreeGames.map(g => formatEpicFreeGame(g, true)));

    if (shouldClaim) await this.claimEpicGames(listed, force);
  },

  // A game is done only once its claim tab confirmed it, as claimed or already
  // owned (EPIC_CLAIMED_KEY). It used to be done as soon as it was listed, so
  // one failed tab meant no retry that week. Any other listed game is retried
  // at most once a day (the same throttle as Prime Gaming's offers) and not
  // while Epic reports the account signed out, since every tab would only land
  // on Epic's login page. `force` (manual claim) skips both.
  async claimEpicGames(listed: FreeGame[], force: boolean) {
    const listedKeys = new Set(listed.map((game) => epicProductKey(game.link)));
    // Pruned to what's still free, so the record can't grow forever.
    const claimedKeys = ((await getStorageItem<string[]>(EPIC_CLAIMED_KEY)) ?? [])
        .filter((key) => listedKeys.has(key));
    await setStorageItem(EPIC_CLAIMED_KEY, claimedKeys);

    if (!force && (await getStorageItem<LoginState>(LOGIN_STATE_KEYS[Platforms.Epic])) === false) return;

    // A game whose claim tab is still open (left for the user on a captcha)
    // is theirs to finish; another tab would only pile up next to it.
    const openKeys = await this.openEpicProductKeys();
    const pending = listed.filter((game) => {
      const key = epicProductKey(game.link) ?? "";
      return !claimedKeys.includes(key) && !openKeys.has(key);
    });
    const now = new Date();
    const attempts = (await getStorageItem<ClaimAttempts>("epicClaimAttempts")) ?? {};
    const toClaim = force ? pending : excludeRecentlyAttempted(pending, attempts, now);
    // Recorded before claiming, so even a run that dies mid-claim still
    // counts as an attempt and can't turn into a reopen-every-run loop.
    await setStorageItem("epicClaimAttempts", updateClaimAttempts(attempts, toClaim, listed, now));
    if (toClaim.length > 0) await this.claimGames(toClaim);
  },

  // Separate so tests can stand in for the tabs API.
  async openEpicProductKeys(): Promise<Set<string>> {
    const tabs = await browser.tabs.query({ url: "https://store.epicgames.com/*" });
    return new Set(tabs.map((tab) => epicProductKey(tab.url ?? "")).filter((key): key is string => key !== null));
  },

  async getSteamGamesList(shouldClaim: boolean = true) {
    // Credentialed so the page carries the user's own header — an anonymous
    // request could never show a session.
    const response = assertStoreOk(await this.fetchStore(STEAM_GAMES_URL, { credentials: "include" }), "Steam's search page");
    const html = await response.text();
    // "No free game" and "no result list at all" both parse to null below;
    // only the second means the page changed.
    if (!hasSteamResultList(html)) throw new StoreChangedError("Steam's search page has no result list");

    // Read before the games: Steam rarely lists a free one, and no claim tab
    // (the only other place this gets recorded) opens without one. Only a
    // signed-in header counts — same reasoning as GOG's 401: the worker's
    // request is the one that may lack the cookie, so a signed-out page from
    // here isn't proof. A real Steam tab records that.
    if (parseSteamLoginState(html) === true) await recordLoginState(Platforms.Steam, true);

    const parsed = parseSteamFreeGames(html);
    // The result list is there but empty: nothing is free now, so the last
    // giveaway is over and leaves the popup.
    if (!parsed) {
      await setStorageItem("steamGames", []);
      return;
    }
    const currFreeGames: FreeGame[] = await getStorageItem("steamGames") || [];
    const owned = await this.loadSteamOwnedApps();
    // Without an answer the last known marks stand, rather than every game
    // reading as not owned until the next run.
    const gamesArr = owned
        ? markSteamOwned(parsed, owned)
        : parsed.map((game) => currFreeGames.some((g) => g?.link === game.link && g.claimed) ? { ...game, claimed: true } : game);

    // A game already on the account gets no claim tab: there's nothing to add.
    const newGames: FreeGame[] = gamesArr.filter(game =>
        !game.claimed && !currFreeGames.some(g => g?.title === game?.title)
    );

    if (shouldClaim && newGames.length > 0) await this.claimGames(newGames);
    // The whole current list, so the popup's in-library marks stay current
    // on runs that find nothing new.
    await setStorageItem('steamGames', gamesArr);
  },

  // Never throws: ownership only adds the in-library marks and spares a claim
  // tab, so a failed lookup costs neither the listing nor the claim.
  async loadSteamOwnedApps(): Promise<Set<number> | null> {
    try {
      const response = assertStoreOk(
          await this.fetchStore(STEAM_USERDATA_URL, { credentials: "include" }),
          "Steam's ownership lookup"
      );
      const owned = parseSteamOwnedApps(await response.json());
      if (!owned) console.warn("Steam's ownership lookup answered in an unexpected shape");
      return owned;
    } catch (e) {
      console.warn("Steam's ownership lookup failed:", e);
      return null;
    }
  },

  // GOG runs one giveaway at a time and only exposes it to a signed-in session.
  // A 401 here is ambiguous — the service worker may simply not have attached
  // the cookie — so it is thrown rather than recorded as "signed out", letting
  // getFreeGamesList retry the whole lookup from a real gog.com tab.
  async getGogGamesList(shouldClaim: boolean = true) {
    const lookup = await fetchGiveaway((input, init) => this.fetchStore(input, init));
    if (lookup.unauthorized) {
      throw new SignedOutError("GOG giveaway status requires a signed-in session");
    }
    // Confirmed live: a signed-out request gets a 401 whether or not a
    // giveaway is running, so any other answer means the session went along.
    await recordLoginState(Platforms.GOG, true);
    const game = lookup.game;
    // No giveaway running, so the last one is over and leaves the popup.
    if (!game) {
      await setStorageItem("gogGames", []);
      return;
    }

    const currFreeGames: FreeGame[] = await getStorageItem("gogGames") || [];
    if (currFreeGames.some((g) => g?.title === game.title)) return;

    await setStorageItem("gogGames", [game]);
    if (shouldClaim) await this.claimGames([game]);
  },

  // getGogGamesList's ambiguous 401 is settled by a real gog.com tab, but not
  // on every run (hourly at the shortest setting): at most once a day, and not
  // at all once a gog.com page has already said "signed out" — reopening it
  // would only repeat that. Signing in ends it either way: the worker's own
  // check then gets through. `force` (manual claim, "Log in" click) skips both.
  async checkGog(force: boolean = false) {
    try {
      await this.getGogGamesList(true);
      await this.recordStoreOk(Platforms.GOG);
      return;
    } catch (e) {
      await this.recordStoreFailure(Platforms.GOG, e);
    }

    const now = new Date().toISOString();
    if (!force) {
      if ((await getStorageItem<LoginState>(LOGIN_STATE_KEYS[Platforms.GOG])) === false) return;
      const lastCheck = await getStorageItem<string>("gogLastTabCheck");
      if (lastCheck && !areDatesDifferent(lastCheck, now)) return;
    }

    // Flag set only after the tab/message actually goes out (mirrors
    // checkIndieGalaWheel), so a failed attempt is retried on the next run.
    await this.openTabAndSendActionToContent(GOG_HOME_URL, "getFreeGames");
    await setStorageItem("gogLastTabCheck", now);
  },

  // Freebies listing is public, so unlike GOG this practically never throws for
  // an auth reason — only network/HTTP failures reach the catch block in
  // getFreeGamesList, which falls back to a real tab.
  async getIndieGalaGamesList(shouldClaim: boolean = true) {
    const { freebies, loginState } = await fetchFreebiesPage((input, init) => this.fetchStore(input, init));
    // Read before the freebies and the claim gate below: no claim tab (the
    // only other place a session showed up) opens once "signed out" is stored,
    // so signing in never cleared it. Only a signed-in header counts, for the
    // same reason as Steam's: the worker's request may be the one lacking the
    // cookie. A real IndieGala page records "signed out".
    if (loginState === true) await recordLoginState(Platforms.IndieGala, true);
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
    // A signed-out account has no wheel: no tab until a check sees the
    // session again (the freebies check right after this one does).
    if ((await getStorageItem<LoginState>(LOGIN_STATE_KEYS[Platforms.IndieGala])) === false) return;

    // The gifts there before the spin, so a Steam key it wins can be told
    // apart afterwards (see collectWonSteamKeys).
    await snapshotGifts((input, init) => this.fetchStore(input, init));
    // Flag set only after the tab/message actually goes out (mirrors
    // getFreeGamesAndSetOpenedFlag): if this throws, today's attempt never
    // happened, so the next check must still retry rather than silently
    // skipping the wheel for the rest of the day.
    await this.openTabAndSendActionToContent(INDIEGALA_WHEEL_URL, "spinWheel");
    await setStorageItem("indieGalaWheelLastCheck", today);
  },

  // Fetch-first, like Epic/Steam: the background lookup (loadPrimeLookup)
  // opens no tab unless something is actually claimable, so it isn't
  // day-gated. A signed-out or non-Prime account is a definitive answer too
  // (recorded, no tab). Only if the lookup itself fails (no
  // declarativeNetRequest, API change, ...) does this fall back to opening
  // the claims page, which is gated by shouldCheckPrimeGamingToday.
  // `force` skips the automatic throttles (that day gate and the per-offer
  // retry cooldown) — used only by an explicit user action (clicking "Log in"
  // for Prime Gaming, see checkPlatformLogin; or the popup's manual "Claim
  // now", see getFreeGamesList), never by the automatic startup/alarm path.
  async checkPrimeGaming(shouldCheck: boolean, force: boolean = false) {
    if (!shouldCheck) return;

    const lunaOrigin = await this.lunaSiteOrigin();
    let lookup: PrimeLookup | null = null;
    try {
      lookup = await this.loadPrimeLookup(lunaOrigin);
      await this.recordStoreOk(Platforms.PrimeGaming);
    } catch (e) {
      // Not the store failing: the user's own access is missing, and the
      // claims page would land on that same regional site, where no script
      // of ours runs. The popup asks for that site instead.
      const regionalHost = await this.missingLunaRegionalHost(e);
      if (regionalHost) {
        console.warn(`Prime Gaming: Amazon redirects to ${regionalHost}, which this extension has no access to`);
        // Amazon answered (with the redirect), which is all health tracks; it
        // also clears an older "can't reach" that would contradict the notice.
        await this.recordStoreOk(Platforms.PrimeGaming);
        await setStorageItem(PRIME_REGIONAL_HOST_KEY, regionalHost);
        this.storeFailedThisRun = true;
        return;
      }
      // Recorded even though the claims page below may still work: the
      // lookup is what the extension relies on, so its breaking is news.
      console.warn("Prime Gaming background lookup failed; falling back to the claims page");
      await this.recordStoreFailure(Platforms.PrimeGaming, e);
    }
    // Answered by luna.amazon.com while the user's own site is known but not
    // granted. Signed out is .com not seeing a session on e.g. amazon.de
    // (Amazon's redirect is inconsistent), so it's no verdict; signed in shows
    // the session works here (e.g. back from a VPN), so that site isn't needed.
    const ungrantedSite = lookup && lunaOrigin === LUNA_ORIGIN ? await this.ungrantedLunaSite() : null;
    if (ungrantedSite && lookup?.status === "signed-out") {
      this.storeFailedThisRun = true;
      return;
    }
    if (ungrantedSite) await setStorageItem(PRIME_REGIONAL_HOST_KEY, null);
    if (lookup?.status === "signed-out") {
      await recordLoginState(Platforms.PrimeGaming, false);
      // Whoever signs in next may be a different account.
      await setStorageItem(PRIME_MEMBERSHIP_KEY, null);
      // An explicit user action still gets the page's own verdict below: the
      // worker's cookie jar can differ from the tabs' (e.g. first-party
      // isolation), and this way that never locks Prime Gaming out for good.
      if (!force) return;
    }
    if (lookup?.status === "no-prime") {
      console.warn("Prime Gaming: signed in without a Prime membership; nothing to claim");
      await recordLoginState(Platforms.PrimeGaming, true);
      await recordPrimeMembership(false);
      return;
    }
    // Outside the try on purpose: a failure here may come after claim tabs
    // already opened, and must not also open the claims page.
    if (lookup?.status === "ok") {
      await this.claimPrimeOffers(lookup.offers, force, lunaOrigin);
      return;
    }

    const now = new Date();
    const lastCheck = await getStorageItem<string>("primeGamingLastCheck");
    if (!force && !shouldCheckPrimeGamingToday(lastCheck, now)) return;

    // Flag set only after the tab/message actually goes out (mirrors
    // checkIndieGalaWheel): if this throws, today's attempt never happened, so
    // the next due check must still retry rather than silently skipping ahead.
    const claimsPage = lunaOrigin === LUNA_ORIGIN ? PRIME_GAMING_HOME_URL : `${lunaOrigin}/claims/home`;
    await this.openTabAndSendActionToContent(claimsPage, "getFreeGames");
    await setStorageItem("primeGamingLastCheck", now.toISOString());
  },

  // The user's own regional Luna site once it's known and granted, else
  // luna.amazon.com. Amazon's redirect from .com to it is inconsistent, and a
  // .com answer can't see a session on e.g. amazon.de, so a known site is
  // used directly for the lookup, the claim pages and the claims tab.
  async ungrantedLunaSite(): Promise<LunaRegionalHost | null> {
    const host = await getStorageItem<string>(PRIME_REGIONAL_HOST_KEY);
    return isLunaRegionalHost(host) && !(await this.readGrantedAccess()).has(host) ? host : null;
  },

  async lunaSiteOrigin(): Promise<string> {
    const host = await getStorageItem<string>(PRIME_REGIONAL_HOST_KEY);
    return isLunaRegionalHost(host) && (await this.readGrantedAccess()).has(host) ? `https://${host}` : LUNA_ORIGIN;
  },

  // The regional Luna site a failed lookup was redirected to, while the
  // extension has no access to it (null otherwise). Such a redirect fails like
  // a dropped connection, so only that kind of failure is worth checking.
  // Never throws: it only decides what the popup offers.
  async missingLunaRegionalHost(error: unknown): Promise<LunaRegionalHost | null> {
    if (classifyFailure(error) !== "network") return null;
    try {
      const granted = await this.readGrantedAccess();
      const isMissing = (host: unknown): host is LunaRegionalHost => isLunaRegionalHost(host) && !granted.has(host);
      const known = await getStorageItem<string>(PRIME_REGIONAL_HOST_KEY);
      // Throws when Amazon can't be reached at all: a real network failure,
      // which no known site explains.
      const isRedirecting = await this.isRedirectedToRegionalLuna();
      // Already found and waiting for the user's grant. Amazon's redirect is
      // inconsistent, so a check that happens to see none proves nothing.
      if (isMissing(known)) return known;
      if (!isRedirecting) return null;
      const checkedAt = await getStorageItem<string>(LUNA_REGION_CHECKED_AT_KEY);
      if (checkedAt !== null && Date.now() - new Date(checkedAt).getTime() < LUNA_REGION_CHECK_INTERVAL_MS) return null;
      // Stamped first, so a lookup that fails doesn't retry every run either.
      await setStorageItem(LUNA_REGION_CHECKED_AT_KEY, new Date().toISOString());
      const found = await this.findLunaRedirectHost();
      return isMissing(found) ? found : null;
    } catch (e) {
      console.warn("Prime Gaming: finding the regional Luna site failed:", e);
      return null;
    }
  },

  // Where luna.amazon.com sends this user. Only a page shows it: a fetch hides
  // a redirect's target, while the `tabs` permission reads a tab's URL on any
  // site. The tab is closed again; our Prime Gaming script, if it runs there,
  // only acts on a message, and none is sent.
  async findLunaRedirectHost(): Promise<LunaRegionalHost | null> {
    const tab = await browser.tabs.create({ url: LUNA_CLAIMS_URL, active: false });
    if (!tab?.id) return null;
    try {
      await this.waitForTabToLoad(tab.id);
      return lunaRegionalHostOf((await browser.tabs.get(tab.id)).url);
    } finally {
      await browser.tabs.remove(tab.id).catch(() => undefined);
    }
  },

  // Separate so tests can stand in for the network.
  isRedirectedToRegionalLuna(): Promise<boolean> {
    return isLunaRedirecting((input, init) => this.fetchStore(input, init));
  },

  // Separate from claimPrimeOffers so tests can stand in for the network +
  // declarativeNetRequest side. Throws when the answer can't be trusted (see
  // fetchPrimeLookup).
  async loadPrimeLookup(lunaOrigin: string = LUNA_ORIGIN): Promise<PrimeLookup> {
    // The extension's own request origin as the browser reports it (the
    // extension id on Chrome, an internal UUID on Firefox).
    const extensionHost = new URL(browser.runtime.getURL("/")).host;
    await ensureLunaOriginRule(browser.declarativeNetRequest, extensionHost);
    return fetchPrimeLookup((input, init) => this.fetchStore(input, init), lunaOrigin);
  },

  async claimPrimeOffers(offerList: PrimeOffer[], force: boolean = false, lunaOrigin: string = LUNA_ORIGIN) {
    // Claim pages (and the popup's links) on the user's own site, where their
    // session is.
    const offers = offerList.map((offer) => ({ ...offer, game: { ...offer.game, link: onLunaSite(offer.game.link, lunaOrigin) } }));
    const listed = offers.map((offer) => offer.game);
    // Same as Epic/Steam: persisted regardless, so the popup lists what's live.
    await setStorageItem("primeGamingGames", listed);
    // loadPrimeOffers only succeeds with per-user claim state, which only a
    // signed-in session gets; and an "ok" lookup is never a no-Prime one.
    await recordLoginState(Platforms.PrimeGaming, true);
    await recordPrimeMembership(true);

    const stored = await getStorageItems(Object.values(EXTERNAL_PLATFORM_STORAGE_KEYS));
    // Flag AND access: claiming a GOG-linked offer without gog access would
    // reveal its Amazon code, then lose it on a gog.com page with no script.
    const granted = await this.readGrantedAccess();
    const accessible = [...readAllowedExternalPlatforms(stored)]
        .filter((platform) => hasAccessFor(EXTERNAL_PLATFORM_STORAGE_KEYS[platform], granted));
    const unclaimed = selectClaimableOffers(offers, new Set(accessible));
    const now = new Date();
    const attempts = (await getStorageItem<ClaimAttempts>("primeGamingClaimAttempts")) ?? {};
    const toClaim = force ? unclaimed : excludeRecentlyAttempted(unclaimed, attempts, now);
    // Recorded before claiming, so even a run that dies mid-claim still
    // counts as an attempt and can't turn into a reopen-every-run loop.
    await setStorageItem("primeGamingClaimAttempts", updateClaimAttempts(attempts, toClaim, listed, now));
    if (toClaim.length > 0) await this.claimGames(toClaim);
  },

  // Triggered by clicking a platform's "Log in" link in the popup (see
  // LoginStatus) — a deliberate, explicit user action, so unlike the
  // startup/alarm path this always runs regardless of claimFrequency or (for
  // Prime Gaming) the day-of-week gate, and isn't wrapped in the
  // isClaiming/badge "in progress" indicator that a full multi-platform run
  // gets, since the popup that triggered this has already closed by the time
  // the click's target="_blank" tab opens.
  async checkPlatformLogin(platform: Platforms) {
    // The popup only offers "Log in" for an effective platform, but access
    // can be revoked while it's open.
    const toggle = PLATFORM_ACCESS_TOGGLES[platform];
    if (toggle && !hasAccessFor(toggle, await this.readGrantedAccess())) return;
    // Same as runFreeGamesChecks: a "Log in" click right after a grant must
    // not open its tab before the content script is registered.
    await contentScriptSync;

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
          await this.checkGog(true);
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
        // Its store-page scrape lost its selectors in Epic's 2026 redesign.
        [Platforms.Epic]: undefined,
        // checkGog already fell back to its own tab.
        [Platforms.GOG]: undefined,
        [Platforms.IndieGala]: INDIEGALA_FREEBIES_URL,
        [Platforms.PrimeGaming]: undefined,
      }[platform];
      if (!fallbackUrl) return;
      try {
        await this.openTabAndSendActionToContent(fallbackUrl, "getFreeGames");
      } catch (fallbackError) {
        console.error(`checkPlatformLogin fallback tab failed for ${platform}:`, fallbackError);
      }
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
