import {oncePerPageRun} from "@/entrypoints/utils/oncePerPageRun.ts";
import {closeCurrentTab} from "@/entrypoints/utils/contentMessaging.ts";
import {getStorageItem, setStorageItem} from "@/entrypoints/hooks/useStorage.ts";
import {
    extractRedeemCodeParam,
    findButtonByAnyText,
    findInputByHint,
    setControlledInputValue,
    submitRedeemCode,
} from "@/entrypoints/utils/redeemCode.ts";
import {incrementCounter, realClick, wait, waitForMatch, waitForPageLoad} from "@/entrypoints/utils/helpers.ts";

const PENDING_CODE_STORAGE_KEY = "pendingMicrosoftRedeemCode";

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
            await setStorageItem(PENDING_CODE_STORAGE_KEY, code);
        }

        // The two frames load independently, so the iframe's script can easily
        // start (and finish checking) before the top frame has stashed
        // anything — polls rather than reading storage once.
        async function waitForStashedCode(timeoutMs = 10000, pollIntervalMs = 250): Promise<string | null> {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                const code = await getStorageItem<string>(PENDING_CODE_STORAGE_KEY);
                if (code) return code;
                await wait(pollIntervalMs);
            }
            return null;
        }

        async function redeemStashedCode() {
            const code = await waitForStashedCode();
            if (!code) return;
            // Consumed immediately so a later, unrelated visit to this same
            // Microsoft Store checkout frame never picks up a stale code.
            await setStorageItem(PENDING_CODE_STORAGE_KEY, null);

            await waitForPageLoad();
            const input = await waitForMatch(() => findInputByHint(document, /code/i));
            if (!input) return;

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
                await closeCurrentTab();
            }
            // "not-redeemed": leave the tab open so the user can finish it
            // themselves — same fallback as the GOG redeem flow.
        }
    },
});
