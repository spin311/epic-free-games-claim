import {MessageRequest} from "@/entrypoints/types/messageRequest.ts"
import {getStorageItems, setStorageItem} from "@/entrypoints/hooks/useStorage.ts";

export default defineBackground({
  async main() {
    browser.runtime.onStartup.addListener(() => this.handleStartup());
    browser.runtime.onMessage.addListener((request) => this.handleMessage(request));
  },

  async handleStartup() {

    const result =await getStorageItems(["active", "lastOpened", "day"]);
    console.log(result);
    if (!result.active) return;
    this.checkLastOpened(result.lastOpened, result.day);
  },

  checkLastOpened(lastOpened: string, day: string) {
    console.log("lastOpened", lastOpened, day);
    const today = new Date().toLocaleDateString();
    const currentDayName = new Date().toLocaleDateString(undefined, { weekday: 'long' });
    if (lastOpened !== today && day === currentDayName) {
      this.claimGames();
      setStorageItem(lastOpened, today);
    }
  },

  incrementCounter() {
    // Implementation here
  },

  claimGames() {
    console.log("claiming games...");
    browser.tabs.create({ url: "https://www.epicgames.com" });
    // Implementation here
  },

  handleMessage(request: MessageRequest) {
    if (request.action === 'claim') {
      this.claimGames();
    }
  }
});