import { MessageRequest } from "@/entrypoints/types/messageRequest.ts";
import { getStorageItems, setStorageItem } from "@/entrypoints/hooks/useStorage.ts";
import { FreeGame } from "@/entrypoints/types/freeGame.ts";

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
    const result = await getStorageItems(["active", "lastOpened", "day"]);
    if (!result.active) return;
    this.checkAndClaimIfDue(result.lastOpened, result.day);
  },

  checkAndClaimIfDue(lastOpened: string, day: string) {
    const today = new Date().toLocaleDateString();
    const currentDayName = new Date().toLocaleDateString(undefined, { weekday: "long" });
    if (lastOpened !== today && (day === currentDayName || day === "Everyday")) {
      this.getFreeGamesList();
      void setStorageItem("lastOpened", today);
    }
  },

  async getFreeGamesList() {
    await setStorageItem("freeGames", []);
    const { steamCheck, epicCheck } = await getStorageItems(["steamCheck", "epicCheck"]);
    if (epicCheck) await this.openTabAndSendActionToContent(EPIC_GAMES_URL, "getFreeGames");
    if (steamCheck) await this.openTabAndSendActionToContent(STEAM_GAMES_URL, "getFreeGames");
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
      void browser.action.setBadgeText({ text: "NEW" });
    }
  }
});
