import { browser } from "wxt/browser";
import { MessageRequest } from "@/entrypoints/types/messageRequest.ts";

// Both store content scripts (Epic, Steam) respond to the same two background
// actions. Centralize the target/action routing here so each store script only
// supplies its own scrape (`getFreeGames`) and claim (`claimGames`) logic.
export function onClaimMessage(handlers: {
    getFreeGames: () => void | Promise<void>;
    claimGames: () => void | Promise<void>;
}): void {
    browser.runtime.onMessage.addListener((request: MessageRequest) => {
        if (request.target !== "content") return;
        if (request.action === "getFreeGames") {
            void handlers.getFreeGames();
        } else if (request.action === "claimGames") {
            void handlers.claimGames();
        }
    });
}
