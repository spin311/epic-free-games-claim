import { MessageRequest } from "@/entrypoints/types/messageRequest.ts";
import {getStorageItem, getStorageItems, mergeIntoStorageItem, setStorageItem} from "@/entrypoints/hooks/useStorage.ts";
import { FreeGame } from "@/entrypoints/types/freeGame.ts";
import {Platforms} from "@/entrypoints/enums/platforms.ts";
import { parse } from 'node-html-parser';

const EPIC_API_URL = "https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=en-US";
const EPIC_GAMES_URL =
    "https://store.epicgames.com/";
const STEAM_GAMES_URL =
    "https://store.steampowered.com/search/?sort_by=Price_ASC&maxprice=free&category1=998&specials=1&ndl=1";

export default defineBackground({
  async main() {
    browser.runtime.onStartup.addListener(() => this.handleStartup());

    browser.runtime.onMessage.addListener((request: MessageRequest, sender) =>
        this.handleMessage(request, sender)
    );

    browser.runtime.onInstalled.addListener((r) => this.handleInstall(r));
  },

  async handleStartup() {
    const result = await getStorageItems(["active", "lastOpened"]);
    if (!result?.active) return;
    this.checkAndClaimIfDue(result.lastOpened);
  },

  checkAndClaimIfDue(lastOpened: string) {
    const today = new Date().toLocaleDateString();
    if (lastOpened !== today) {
      this.getFreeGamesList();
      void setStorageItem("lastOpened", today);
    }
  },

  async getFreeGamesList() {
    const { steamCheck, epicCheck } = await getStorageItems(["steamCheck", "epicCheck"]);
    try {
      if (epicCheck) void this.getEpicGamesList();
    } catch (e) {
      console.error("getEpicGamesList failed:", e);
      await this.openTabAndSendActionToContent(EPIC_GAMES_URL, "getFreeGames");
    }
    try {
      if (steamCheck) void this.getSteamGamesList();
    } catch (e) {
      console.error("openTabAndSendActionToContent failed:", e);
      await this.openTabAndSendActionToContent(STEAM_GAMES_URL, "getFreeGames");
    }
  },

  async claimGames(games: FreeGame[]) {
    for (const game of games) {
      await this.openTabAndSendActionToContent(game.link, "claimGames");
      await this.wait(10_000);
    }
  },

  steamAddToCart(tabId: number, appId: number) {
    return browser.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [appId],
      func: (appId) => {
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
    await browser.tabs.sendMessage(tab.id, { target: "content", action });
  },

  async handleMessage(request: MessageRequest, sender?: browser.runtime.MessageSender) {
    if (request.target !== "background") return;

    if (request.action === "claim") {
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
    } else if (request.action === "getEpicGamesList") {
        await this.getSteamGamesList();
    }
  },

  wait(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  },

  sendMessage(target, action) {
    browser.runtime.sendMessage({ target, action });
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

  handleInstall(r: browser.runtime.InstalledDetails) {
    if (r.reason === "update") {
      browser.action.setBadgeBackgroundColor({ color: "#50ca26" });
      void browser.action.setBadgeText({ text: "New" });
    }
  },
  async getEpicGamesList() {
    const response = await fetch(EPIC_API_URL);
    if (!response.ok) {
      console.error("Failed to fetch Epic Games data:", response.statusText);
      return;
    }

    const data = await response.json();
    const games = data?.data?.Catalog?.searchStore?.elements || [];
    const freeGames = games.filter(game =>
        game.price.totalPrice.discountPrice === 0 &&
        game.promotions?.promotionalOffers?.length > 0
    );
    const futureFreeGames = games.filter(game =>
        game.promotions?.upcomingPromotionalOffers?.[0]?.promotionalOffers?.[0]?.discountSetting?.discountPercentage === 0
    );

    const currFreeGames: FreeGame[] = await getStorageItem("epicGames");
    const newGames = freeGames.filter(game =>
        !currFreeGames.some(g => g?.title === game?.title)
    );

    if (newGames.length > 0) {
      const formattedNewGames: FreeGame[] = newGames.map(game => ({
        title: game.title,
        platform: Platforms.Epic,
        link: `https://www.epicgames.com/store/en-US/p/${game.catalogNs?.mappings?.[0]?.pageSlug || game.offerMappings?.[0]?.pageSlug}`,
        img: game.keyImages.find(img => img.type === "Thumbnail")?.url || "",
        description:game.description,
        startDate: new Date(game.promotions.promotionalOffers?.[0].promotionalOffers?.[0].startDate).toISOString(),
        endDate: new Date(game.promotions.promotionalOffers?.[0].promotionalOffers?.[0].endDate).toISOString(),
        future: false
      }));
      void setStorageItem("epicGames", [...currFreeGames, ...formattedNewGames]);
      this.claimGames(formattedNewGames);
    }

    if (futureFreeGames.length > 0) {
      const formattedFutureGames = futureFreeGames.map(game => ({
        title: game.title,
        link: `https://www.epicgames.com/store/en-US/p/${game.catalogNs?.mappings?.[0]?.pageSlug || game.offerMappings?.[0]?.pageSlug}`,
        img: game.keyImages.find(img => img.type === "Thumbnail")?.url || "",
        platform: Platforms.Epic,
        description:game.description,
        startDate: new Date(game.promotions.upcomingPromotionalOffers?.[0].promotionalOffers?.[0].startDate).toISOString(),
        endDate: new Date(game.promotions.upcomingPromotionalOffers?.[0].promotionalOffers?.[0].endDate).toISOString(),
        future: true
      }));
      await setStorageItem("futureGames", formattedFutureGames);
    }
  },

  async getSteamGamesList() {
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

    const currFreeGames: FreeGame[] = await getStorageItem("steamGames");
    const newGames: FreeGame[] = gamesArr.filter(game =>
        !currFreeGames.some(g => g?.title === game?.title)
    );
    if (newGames.length === 0) return;

    this.claimGames(newGames);
    await setStorageItem('steamGames', newGames);
  }
});
