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

// Tabs are opened in the background (see openTabAndSendActionToContent) so
// they never steal focus, but they still accumulate as clutter unless closed
// once a content script is actually done with one. Callers must only call
// this when nothing further needs the tab — never after redirecting to a
// page the user still has to act on (e.g. GOG's redeem-code page, or an
// account-linking redirect).
export async function closeCurrentTab(): Promise<void> {
    await browser.runtime.sendMessage({ target: "background", action: "closeTab" });
}
