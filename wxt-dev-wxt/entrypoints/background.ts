import {MessageRequest} from "@/entrypoints/types/messageRequest.ts"
import {getStorageItem, getStorageItems, setStorageItem} from "@/entrypoints/hooks/useStorage.ts";

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
    browser.tabs.create({ url: "https://store.epicgames.com/" });
  },

  handleMessage(request: MessageRequest) {
    if (request.action === 'claim') {
      this.claimGames();
    }
  }
});