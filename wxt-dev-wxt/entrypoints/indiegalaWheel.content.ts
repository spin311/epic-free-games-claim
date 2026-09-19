import { oncePerPageRun } from "@/entrypoints/utils/oncePerPageRun.ts";
import { browser } from "wxt/browser";
import { MessageRequest } from "@/entrypoints/types/messageRequest.ts";
import { setStorageItem } from "@/entrypoints/hooks/useStorage.ts";
import { findSpinButton, parseWheelPrize, StoredWheelPrize, WheelPrize } from "@/entrypoints/utils/indieGalaWheel.ts";
import { getRndInteger, realClick, wait, waitForPageLoad } from "@/entrypoints/utils/helpers.ts";

// Separate from indiegala.content.ts (freebies.indiegala.com): the daily wheel
// lives on the main site, is a distinct mechanic (galasilver/coupons, not
// games), and is driven by its own "spinWheel" message rather than the
// getFreeGames/claimGames pair every other store content script answers.
export default defineContentScript({
    matches: ['https://www.indiegala.com/*'],
    main(_: any) {
        if (!oncePerPageRun('_myIndieGalaWheelContentScriptInjected' as keyof Window)) {
            return;
        }

        browser.runtime.onMessage.addListener((request: MessageRequest) => {
            if (request.target !== "content") return;
            if (request.action === "spinWheel") {
                void spinWheel();
            }
        });

        async function spinWheel() {
            await waitForPageLoad();

            // The page injects the widget itself only when today's spin is
            // still available, so the button's absence within this window
            // means "already spun" or "nothing configured" — nothing to do.
            const button = await waitForSpinButton();
            if (!button) return;

            await wait(getRndInteger(100, 500));
            realClick(button);

            // The page's own script owns the redeem call and the (cosmetic)
            // 5s spin animation before it reveals the prize it already chose.
            const prize = await waitForWheelPrize();
            if (!prize) {
                console.error("[indiegala-wheel] spin clicked but no prize appeared in time");
                return;
            }

            const storedPrize: StoredWheelPrize = { ...prize, wonAt: new Date().toISOString() };
            await setStorageItem("indieGalaWheelLastPrize", storedPrize);
        }

        async function waitForSpinButton(timeoutMs = 10_000, intervalMs = 250): Promise<HTMLButtonElement | null> {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                const button = findSpinButton(document);
                if (button) return button;
                await wait(intervalMs);
            }
            return null;
        }

        async function waitForWheelPrize(timeoutMs = 8_000, intervalMs = 250): Promise<WheelPrize | null> {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                const prize = parseWheelPrize(document);
                if (prize) return prize;
                await wait(intervalMs);
            }
            return null;
        }
    },
});
