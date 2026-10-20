import {MessageRequest} from "@/entrypoints/types/messageRequest.ts";
import {getStorageItem, getStorageItems, setStorageItem} from "@/entrypoints/hooks/useStorage.ts";
import {FreeGame} from "@/entrypoints/types/freeGame.ts";
import {Platforms} from "@/entrypoints/enums/platforms.ts";
import {ClaimFrequency, ClaimFrequencyMinutes} from "@/entrypoints/enums/claimFrequency.ts";
import {addToCartInMainWorld, parseSteamFreeGames, STEAM_GAMES_URL} from "@/entrypoints/utils/steamGames.ts";
import {GOG_HOME_URL, fetchGiveaway} from "@/entrypoints/utils/gogGiveaway.ts";
import {fetchFreebies, INDIEGALA_FREEBIES_URL} from "@/entrypoints/utils/indieGalaGiveaway.ts";
import {INDIEGALA_WHEEL_URL} from "@/entrypoints/utils/indieGalaWheel.ts";
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
  PrimeLookup,
  PrimeOffer,
  selectClaimableOffers,
  updateClaimAttempts,
} from "@/entrypoints/utils/primeGamingApi.ts";
import {LoginState, recordLoginState} from "@/entrypoints/utils/loginState.ts";
import {
  setBadgeBackgroundColor as setActionBadgeBackgroundColor,
  setBadgeText as setActionBadgeText,
} from "@/entrypoints/utils/badge.ts";
import {shouldClaimSteamGame} from "@/entrypoints/utils/steamReviews.ts";
import {browser, type Browser} from "wxt/browser";
import {EpicElement, EpicSearchResponse} from "@/entrypoints/types/epicGame.ts";
import {
  EPIC_API_URL,
  EPIC_GAMES_URL,
  formatEpicFreeGame,
  partitionEpicPromotions,
  withEpicEnglishLocale,
} from "@/entrypoints/utils/epicGames.ts";
import {areDatesDifferent, didEnoughTimePass, isActive, shouldCheckPrimeGamingToday} from "@/entrypoints/utils/scheduling.ts";
import {PLATFORM_ACCESS_TOGGLES, resolvePlatformToggles} from "@/entrypoints/utils/platformToggles.ts";
import {
  AccessGroup,
  hasAccessFor,
  PENDING_ACCESS_REQUEST_KEY,
  readGrantedAccessGroups,
  toggleToCompleteAfterGrant,
  TOGGLES_ENABLED_WITH,
} from "@/entrypoints/utils/optionalAccess.ts";
import {syncRuntimeContentScripts} from "@/entrypoints/utils/runtimeContentScripts.ts";

const ALARM_NAME = "checkFreeGames";
let isChecking = false;
// Distinct from the green claimed-count badge (see handleInstall) so "still
// working" never reads as "N games claimed".
const CLAIMING_BADGE_COLOR = "#f0ad4e";
// Chains every syncContentScripts call: main() and a permissions event can
// start one at the same moment (a grant wakes the worker), and two overlapping
// syncs would both try to register the same script id.
let contentScriptSync: Promise<void> = Promise.resolve();

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
  // `force` is set only for the popup's manual "Claim now" (see handleMessage):
  // an explicit request to check now should skip Prime Gaming's automatic
  // throttles (the fallback's day gate and the per-offer retry cooldown).
  async getFreeGamesList(force: boolean = false) {
    this.claimedSomethingThisRun = false;
    await setStorageItem("isClaiming", true);
    await this.setBadgeText("…");
    await setActionBadgeBackgroundColor(CLAIMING_BADGE_COLOR);
    try {
      await this.runFreeGamesChecks(force);
    } finally {
      await setStorageItem("isClaiming", false);
      // Leave the count claimGames() already set alone; only clear the "in
      // progress" placeholder if nothing this run ever replaced it.
      if (!this.claimedSomethingThisRun) await this.setBadgeText("");
    }
  },

  async runFreeGamesChecks(force: boolean = false) {
    const { steamCheck, epicCheck, gogCheck, indieGalaCheck, primeGamingCheck, indieGalaWheelCheck } = await getStorageItems([
      "steamCheck", "epicCheck", "gogCheck", "indieGalaCheck", "primeGamingCheck", "indieGalaWheelCheck",
    ]);
    const toggles = resolvePlatformToggles({ steamCheck, epicCheck, gogCheck, indieGalaCheck, primeGamingCheck });
    // Flag AND granted hosts (see hasAccessFor): GOG's flag defaults on, but
    // with no gog access it is effectively off.
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
      await this.checkIndieGalaWheel(spinWheel);
    } catch (e) {
      console.error("checkIndieGalaWheel failed:", e);
    }
    // Listing only (no claim) still needs the host: without it the browser
    // blocks the cross-origin fetch, which would just fail every run.
    if (canReachIndieGala) {
      try {
        await this.getIndieGalaGamesList(claimIndieGala);
      } catch (e) {
        console.error("getIndieGalaGamesList failed:", e);
        if (claimIndieGala) await this.openTabAndSendActionToContent(INDIEGALA_FREEBIES_URL, "getFreeGames");
      }
    }
    try {
      await this.checkPrimeGaming(claimPrimeGaming, force);
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
      func: addToCartInMainWorld,
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

    const gamesArr = parseSteamFreeGames(html);
    if (!gamesArr) return;

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

    let lookup: PrimeLookup | null = null;
    try {
      lookup = await this.loadPrimeLookup();
    } catch (e) {
      console.warn("Prime Gaming background lookup failed; falling back to the claims page:", e);
    }
    if (lookup?.status === "signed-out") {
      await recordLoginState(Platforms.PrimeGaming, false);
      // An explicit user action still gets the page's own verdict below: the
      // worker's cookie jar can differ from the tabs' (e.g. first-party
      // isolation), and this way that never locks Prime Gaming out for good.
      if (!force) return;
    }
    if (lookup?.status === "no-prime") {
      console.warn("Prime Gaming: signed in without a Prime membership; nothing to claim");
      await recordLoginState(Platforms.PrimeGaming, true);
      return;
    }
    // Outside the try on purpose: a failure here may come after claim tabs
    // already opened, and must not also open the claims page.
    if (lookup?.status === "ok") {
      await this.claimPrimeOffers(lookup.offers, force);
      return;
    }

    const now = new Date();
    const lastCheck = await getStorageItem<string>("primeGamingLastCheck");
    if (!force && !shouldCheckPrimeGamingToday(lastCheck, now)) return;

    // Flag set only after the tab/message actually goes out (mirrors
    // checkIndieGalaWheel): if this throws, today's attempt never happened, so
    // the next due check must still retry rather than silently skipping ahead.
    await this.openTabAndSendActionToContent(PRIME_GAMING_HOME_URL, "getFreeGames");
    await setStorageItem("primeGamingLastCheck", now.toISOString());
  },

  // Separate from claimPrimeOffers so tests can stand in for the network +
  // declarativeNetRequest side. Throws when the answer can't be trusted (see
  // fetchPrimeLookup).
  async loadPrimeLookup(): Promise<PrimeLookup> {
    // The extension's own request origin as the browser reports it (the
    // extension id on Chrome, an internal UUID on Firefox).
    const extensionHost = new URL(browser.runtime.getURL("/")).host;
    await ensureLunaOriginRule(browser.declarativeNetRequest, extensionHost);
    return fetchPrimeLookup();
  },

  async claimPrimeOffers(offers: PrimeOffer[], force: boolean = false) {
    const listed = offers.map((offer) => offer.game);
    // Same as Epic/Steam: persisted regardless, so the popup lists what's live.
    await setStorageItem("primeGamingGames", listed);
    // loadPrimeOffers only succeeds with per-user claim state, which only a
    // signed-in session gets.
    await recordLoginState(Platforms.PrimeGaming, true);

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
