import {MessageRequest} from "@/entrypoints/types/messageRequest.ts"
import {getStorageItems, setStorageItem} from "@/entrypoints/hooks/useStorage.ts";

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
      this.claimGames();
      void setStorageItem(lastOpened, today);
    }
  },

  incrementCounter() {
  },

  async claimGames() {
    const tab = await browser.tabs.create({ url: "https://store.epicgames.com/" });
    if (!tab || !tab.id) return;
    await this.waitForTabToLoad(tab.id);
    await browser.tabs.sendMessage(tab.id, { target: "content", action: "claim" });
  },

  handleMessage(request: MessageRequest) {
    if (request.target !== 'background') return;
    if (request.action === 'claim') {
      this.claimGames();
    }
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