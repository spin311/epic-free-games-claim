import {MessageRequest} from "@/entrypoints/types/messageRequest.ts"
import {getStorageItems, setStorageItem} from "@/entrypoints/hooks/useStorage.ts";
import {FreeGame} from "@/entrypoints/types/freeGame.ts";
const EPIC_GAMES_URL = "https://store.epicgames.com/";
const STEAM_GAMES_URL = "https://store.steampowered.com/search/?sort_by=Price_ASC&maxprice=free&category1=998&specials=1&ndl=1";

export default defineBackground({
  async main() {
    browser.runtime.onStartup.addListener(() => this.handleStartup());
    browser.runtime.onMessage.addListener((request: MessageRequest) => this.handleMessage(request));
  },

  async handleStartup() {
    const result =await getStorageItems(["active", "lastOpened", "day"]);
    if (!result.active) return;
    this.checkAndClaimIfDue(result.lastOpened, result.day);
  },

  checkAndClaimIfDue(lastOpened: string, day: string) {
    const today = new Date().toLocaleDateString();
    const currentDayName = new Date().toLocaleDateString(undefined, { weekday: 'long' });
    if (lastOpened !== today && day === currentDayName) {
      this.getFreeGamesList();
      void setStorageItem(lastOpened, today);
    }
  },

  incrementCounter() {
  },

  async getFreeGamesList() {
    await setStorageItem("freeGames", []);
    const { steamCheck, epicCheck } = await getStorageItems(["steamCheck", "epicCheck"]);
    if (epicCheck) await this.openTabAndSendActionToContent(EPIC_GAMES_URL, "getFreeGames");
    if (steamCheck) await this.openTabAndSendActionToContent(STEAM_GAMES_URL, "getFreeGames");
  },

  async claimGames(games: FreeGame[]) {
    for (const game of games) {
      await this.openTabAndSendActionToContent(game.link, 'claimGames');
      await this.wait(10000);
    }
  },

  async openTabAndSendActionToContent(url: string, action: string) {
    const tab = await browser.tabs.create({url});
    if (!tab || !tab.id) return;
    await this.waitForTabToLoad(tab.id);
    await browser.tabs.sendMessage(tab.id, { target: "content", action });
  },

  handleMessage(request: MessageRequest) {
    if (request.target !== 'background') return;
    if (request.action === 'claim') {
      this.getFreeGamesList();
    } else if (request.action === 'claimFreeGames') {
      const games: FreeGame[] = request.data;
      this.claimGames(games);
    }
  },
  wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
},
  sendMessage(target, action) {
    browser.runtime.sendMessage({target, action});
  },
  async waitForTabToLoad(tabId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      async function checkTab() {
        try {
          const tab = await browser.tabs.get(tabId);
          if (!tab) reject(new Error("tab not found"));
          if (tab.status === 'complete') {
            resolve();
          } else {
            setTimeout(checkTab, 100);
          }
        } catch (error) {
          reject(error);
        }
      }
      checkTab();
    });
  }
});