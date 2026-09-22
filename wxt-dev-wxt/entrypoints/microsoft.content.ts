import {oncePerPageRun} from "@/entrypoints/utils/oncePerPageRun.ts";
import {closeCurrentTab} from "@/entrypoints/utils/contentMessaging.ts";
import {getStorageItem, setStorageItem} from "@/entrypoints/hooks/useStorage.ts";
import {
    extractRedeemCodeParam,
    extractRedeemTitleParam,
    findButtonByAnyText,
    findInputByHint,
    setControlledInputValue,
    submitRedeemCode,
} from "@/entrypoints/utils/redeemCode.ts";
import {recordRedeemFallback, removePendingRedemption} from "@/entrypoints/utils/pendingRedemptions.ts";
import {incrementCounter, realClick, wait, waitForMatch, waitForPageLoad} from "@/entrypoints/utils/helpers.ts";

const PENDING_CODE_STORAGE_KEY = "pendingMicrosoftRedeemCode";

interface StashedRedeemCode {
    code: string;
    title: string;
    // The top frame's own URL (account.microsoft.com/billing/redeem?...) —
    // the iframe has no access to it (cross-origin), but it's what the
    // pending-redemption fallback UI needs as a "try again" link, since
    // re-opening it re-triggers this whole flow.
    redeemUrl: string;
}

// A Windows/Xbox-linked Prime Gaming claim (see primegaming.content.ts) lands
// on account.microsoft.com/billing/redeem with the code appended as our own
// extCode param. Confirmed live: the actual redeem form isn't on that page at
// all — it's rendered inside a cross-origin iframe
// (www.microsoft.com/store/purchase/buynowui/redeemnow), which can't read the
// parent frame's URL (or vice versa) due to the browser's same-origin policy.
// So this one script plays two different roles depending on which of the two
// matched origins it's actually running in: the account.microsoft.com
// instance (top frame) just stashes the code in extension storage — shared
// across frames, unlike page state — and the www.microsoft.com instance
// (inside the iframe, hence allFrames below) polls for it and does the
// actual fill-and-submit.
export default defineContentScript({
    matches: [
        'https://account.microsoft.com/billing/redeem*',
        'https://www.microsoft.com/store/purchase/buynowui/*',
    ],
    allFrames: true,
    main(_: any) {
        if (!oncePerPageRun('_myMicrosoftContentScriptInjected' as keyof Window)) {
            return;
        }

        if (location.hostname === 'account.microsoft.com') {
            void stashCodeFromUrl();
        } else {
            void redeemStashedCode();
        }

        async function stashCodeFromUrl() {
            const code = extractRedeemCodeParam(location.search);
            if (!code) return;
            const title = extractRedeemTitleParam(location.search) ?? "Windows game";
            const stashed: StashedRedeemCode = { code, title, redeemUrl: location.href };
            await setStorageItem(PENDING_CODE_STORAGE_KEY, stashed);
        }

        // The two frames load independently, so the iframe's script can easily
        // start (and finish checking) before the top frame has stashed
        // anything — polls rather than reading storage once.
        async function waitForStashedCode(timeoutMs = 10000, pollIntervalMs = 250): Promise<StashedRedeemCode | null> {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                const stashed = await getStorageItem<StashedRedeemCode>(PENDING_CODE_STORAGE_KEY);
                if (stashed) return stashed;
                await wait(pollIntervalMs);
            }
            return null;
        }

        async function redeemStashedCode() {
            const stashed = await waitForStashedCode();
            if (!stashed) return;
            const { code, title, redeemUrl } = stashed;
            // Consumed immediately so a later, unrelated visit to this same
            // Microsoft Store checkout frame never picks up a stale code.
            await setStorageItem(PENDING_CODE_STORAGE_KEY, null);

            try {
                await waitForPageLoad();
                const input = await waitForMatch(() => findInputByHint(document, /code/i));
                if (!input) {
                    // No signal either way on WHY (signed out, a slow load, the
                    // iframe's markup having changed, ...) — whatever the
                    // cause, the code itself must not be lost.
                    await recordRedeemFallback(code, "Windows", title, redeemUrl);
                    return;
                }

                const outcome = await submitRedeemCode(
                    code,
                    input,
                    () => findButtonByAnyText(document, ['Next', 'Redeem', 'Confirm', 'Submit', 'Continue']),
                    setControlledInputValue,
                    realClick,
                    wait,
                );

                if (outcome === "redeemed") {
                    await incrementCounter();
                    // Clears any earlier failed attempt's leftover entry for
                    // this same code, now that it's actually been redeemed.
                    await removePendingRedemption(code);
                    await closeCurrentTab();
                    return;
                }

                // "not-redeemed": leave the tab open so the user can finish it
                // themselves — same fallback as the GOG redeem flow.
                await recordRedeemFallback(code, "Windows", title, redeemUrl);
            } catch (error: unknown) {
                console.error("[microsoft] redeem attempt failed:", error);
                await recordRedeemFallback(code, "Windows", title, redeemUrl);
            }
        }
    },
});
