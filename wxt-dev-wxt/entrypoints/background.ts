import {MessageRequest} from "@/entrypoints/types/messageRequest.ts";
import {getStorageItem, getStorageItems, setStorageItem} from "@/entrypoints/hooks/useStorage.ts";
import {FreeGame} from "@/entrypoints/types/freeGame.ts";
import {Platforms} from "@/entrypoints/enums/platforms.ts";
import {ClaimFrequency, ClaimFrequencyMinutes} from "@/entrypoints/enums/claimFrequency.ts";
import {parse} from 'node-html-parser';
import {browser, type Browser} from "wxt/browser";
import {EpicElement, EpicKeyImage, EpicSearchResponse} from "@/entrypoints/types/epicGame.ts";

const EPIC_API_URL = "https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=en-US";
const EPIC_GAMES_URL =
    "https://store.epicgames.com/";
const STEAM_GAMES_URL =
    "https://store.steampowered.com/search/?sort_by=Price_ASC&maxprice=free&category1=998&specials=1&ndl=1";

const ALARM_NAME = "checkFreeGames";
let isChecking = false;

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

export function formatEpicFreeGame(game: EpicElement, future: boolean): FreeGame {
  const epicSlug =
      game.productSlug ||
      game.catalogNs?.mappings?.[0]?.pageSlug ||
      game.offerMappings?.[0]?.pageSlug ||
      "";

  const isEpicBundle =
      Array.isArray(game.categories) &&
      game.categories.some((c) => c?.path === "bundles");

  const slug = epicSlug;
  const path = isEpicBundle ? "bundle" : "p";

  const promo =
      (future
          ? game.promotions?.upcomingPromotionalOffers?.[0]?.promotionalOffers?.[0]
          : game.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0]) ?? {};

  return {
    title: game.title ?? "",
    platform: Platforms.Epic,
    link: `https://www.epicgames.com/store/en-US/${path}/${slug}`,
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

const background = {
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
    if (!result?.active) return;

    const frequency = result.claimFrequency || ClaimFrequency.DAILY;
    
    // Always check on startup, regardless of frequency setting
    // The checkAndClaimIfDue method handles the frequency-specific logic
    await this.checkAndClaimIfDue(frequency);
  },

  async handleAlarmTriggered() {
    const result = await getStorageItems(["active", "claimFrequency"]);
    if (!result?.active) return;

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
    if (!result?.active) {
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

  async getFreeGamesList() {
    const { steamCheck, epicCheck } = await getStorageItems(["steamCheck", "epicCheck"]);
    try {
      await this.getEpicGamesList(epicCheck);
    } catch (e) {
      console.error("getEpicGamesList failed:", e);
      if (epicCheck) await this.openTabAndSendActionToContent(EPIC_GAMES_URL, "getFreeGames");
    }
    try {
      await this.getSteamGamesList(steamCheck);
    } catch (e) {
      console.error("getSteamGamesList failed:", e);
      if (steamCheck) await this.openTabAndSendActionToContent(STEAM_GAMES_URL, "getFreeGames");
    }
  },

  async claimGames(games: FreeGame[]) {
    void this.setBadgeText(games.length.toString());
    for (const game of games) {
      await this.openTabAndSendActionToContent(withEpicEnglishLocale(game.link), "claimGames");
      await this.wait(10_000);
    }
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

  async openTabAndSendActionToContent(url: string, action: string) {
    const tab = await browser.tabs.create({ url });
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

  handleInstall(r: Browser.runtime.InstalledDetails) {
    if (r.reason === "update") {
      browser.action.setBadgeBackgroundColor({ color: "#50ca26" });
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

    const freeGames = games.filter((game) =>
        game.price?.totalPrice?.discountPrice === 0 &&
        (game.promotions?.promotionalOffers?.length ?? 0) > 0
    );

    const futureFreeGames = games.filter((game) =>
        game.promotions?.upcomingPromotionalOffers?.[0]?.promotionalOffers?.[0]?.discountSetting?.discountPercentage === 0
    );

    const currFreeGames: FreeGame[] = await getStorageItem("epicGames") || [];
    const newGames = freeGames.filter((game) =>
        !currFreeGames.some((g) => g?.title === game?.title)
    );

    if (newGames.length > 0) {
      const formattedNewGames = newGames.map(g => formatEpicFreeGame(g, false));

      await setStorageItem("epicGames", formattedNewGames);
      if (shouldClaim) await this.claimGames(formattedNewGames);
    }

    if (futureFreeGames.length > 0) {
      const formattedFutureGames = futureFreeGames.map(g => formatEpicFreeGame(g, true));

      await setStorageItem("futureGames", formattedFutureGames);
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

  async clearGamesList() {
    await setStorageItem("epicGames", []);
    await setStorageItem("futureGames", []);
    await setStorageItem("steamGames", []);
  },

  async setBadgeText(text: string) {
    await browser.action.setBadgeText({ text });
  }
};

export default defineBackground(background);
