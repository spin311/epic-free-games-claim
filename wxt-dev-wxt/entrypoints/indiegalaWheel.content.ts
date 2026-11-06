import { oncePerPageRun } from "@/entrypoints/utils/oncePerPageRun.ts";
import { browser } from "wxt/browser";
import { MessageRequest } from "@/entrypoints/types/messageRequest.ts";
import { setStorageItem } from "@/entrypoints/hooks/useStorage.ts";
import { closeCurrentTab } from "@/entrypoints/utils/contentMessaging.ts";
import { findSpinButton, isWheelResultShown, parseWheelPrize, StoredWheelPrize, WheelPrize } from "@/entrypoints/utils/indieGalaWheel.ts";
import { getRndInteger, realClick, wait, waitForPageLoad } from "@/entrypoints/utils/helpers.ts";
import { runtimeContentScriptOptions } from "@/entrypoints/utils/runtimeContentScripts.ts";
import { detectAndRecordLoginState } from "@/entrypoints/utils/loginState.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";
import { findPasscodeInput, findRevealButton, giftKeyContainers, GiftKey, readGiftKeys } from "@/entrypoints/utils/indieGalaGifts.ts";

const { matches, runAt, allFrames, registration } = runtimeContentScriptOptions('indiegalaWheel');

// Separate from indiegala.content.ts (freebies.indiegala.com): the daily wheel
// lives on the main site, is a distinct mechanic (galasilver/coupons, not
// games), and is driven by its own "spinWheel" message rather than the
// getFreeGames/claimGames pair every other store content script answers.
export default defineContentScript({
    matches, runAt, allFrames, registration,
    main(_: any) {
        if (!oncePerPageRun('_myIndieGalaWheelContentScriptInjected' as keyof Window)) {
            return;
        }
        // This is the extension's only script on www.indiegala.com, where the
        // popup's "Log in" link lands, so it also records the session there
        // (see readIndieGalaLoginState). Never awaited: the spin doesn't wait.
        void detectAndRecordLoginState(Platforms.IndieGala);

        browser.runtime.onMessage.addListener((request: MessageRequest) => {
            if (request.target !== "content") return;
            if (request.action === "spinWheel") {
                void spinWheel();
            } else if (request.action === "revealGiftKey") {
                void revealGiftKeys(typeof request.data?.password === "string" ? request.data.password : null);
            }
        });

        async function spinWheel() {
            await waitForPageLoad();

            // The page injects the widget itself only when today's spin is
            // still available, so the button's absence within this window
            // means "already spun" or "nothing configured" — nothing to do.
            const button = await waitForSpinButton();
            if (!button) {
                await closeCurrentTab();
                return;
            }

            await wait(getRndInteger(100, 500));
            realClick(button);

            // The page's own script owns the redeem call and the (cosmetic)
            // 5s spin animation before it reveals the prize it already chose.
            const prize = await waitForWheelPrize();
            if (!prize) {
                console.error("[indiegala-wheel] spin clicked but no prize appeared in time");
                await closeCurrentTab();
                return;
            }

            const storedPrize: StoredWheelPrize = { ...prize, wonAt: new Date().toISOString() };
            await setStorageItem("indieGalaWheelLastPrize", storedPrize);
            // The page fills the prize in as Spin is clicked, while its redeem
            // call is still on its way: closing now could cut that call off
            // and lose the prize. The result card shows once it's well done.
            await waitForResultShown();
            await sendToBackground("wheelSpun", { label: prize.label });
            await closeCurrentTab();
        }

        // On a G. Giveaway gift page the background opened after a spin (see
        // collectWonSteamKeys): shows any key IndieGala hasn't shown yet with
        // its own button, then hands the keys over. The tab closes either way;
        // the background keeps whatever couldn't be read.
        async function revealGiftKeys(password: string | null) {
            await waitForPageLoad();
            for (const container of giftKeyContainers(document)) {
                if (readGiftKeys(container)[0]?.key) continue;
                const button = findRevealButton(container);
                if (!button) continue;
                const passcode = findPasscodeInput(container);
                if (passcode && password) passcode.value = password;
                await wait(getRndInteger(100, 400));
                realClick(button);
                await waitForKey(container);
            }
            const keys: GiftKey[] = readGiftKeys(document);
            await sendToBackground("giftKeysRead", { giftUrl: location.href, keys });
            await closeCurrentTab();
        }

        async function waitForKey(container: HTMLElement, timeoutMs = 10_000, intervalMs = 250): Promise<void> {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline && !readGiftKeys(container)[0]?.key) {
                await wait(intervalMs);
            }
        }

        async function waitForResultShown(timeoutMs = 10_000, intervalMs = 250): Promise<void> {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline && !isWheelResultShown(document)) {
                await wait(intervalMs);
            }
        }

        // Never throws: the tab must still close after it.
        async function sendToBackground(action: string, data: unknown) {
            try {
                await browser.runtime.sendMessage({ target: "background", action, data });
            } catch (error: unknown) {
                console.error(`[indiegala-wheel] couldn't send ${action}:`, error);
            }
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
