import {oncePerPageRun} from "@/entrypoints/utils/oncePerPageRun.ts";
import {browser} from "wxt/browser";
import {FreeGamesResponse} from "@/entrypoints/types/freeGamesResponse.ts";
import {Platforms} from "@/entrypoints/enums/platforms.ts";
import {setStorageItem} from "@/entrypoints/hooks/useStorage.ts";
import {closeCurrentTab, onClaimMessage} from "@/entrypoints/utils/contentMessaging.ts";
import {recordLoginState} from "@/entrypoints/utils/loginState.ts";
import {claimGiveaway, fetchGiveaway, fetchOwnedGameIds, hasRedeemSuccessScreen, waitForRedeemConfirmation} from "@/entrypoints/utils/gogGiveaway.ts";
import {extractRedeemCodeParam, extractRedeemTitleParam, findButtonByAnyText, setControlledInputValue, submitRedeemCode} from "@/entrypoints/utils/redeemCode.ts";
import {recordRedeemFallback, removePendingRedemption} from "@/entrypoints/utils/pendingRedemptions.ts";
import {incrementCounter, realClick, wait, waitForElement, waitForPageLoad} from "@/entrypoints/utils/helpers.ts";

// Confirmed live: redeeming is two steps — "Continue" previews the code's
// product, then a separate "Redeem" button actually adds it to the library.
const GOG_SUBMIT_LABELS = ['Continue', 'Redeem'];
const REDEEM_CONFIRM_TIMEOUT_MS = 15_000;

// Unlike the Epic and Steam scripts this one never touches the page's DOM — GOG
// exposes the giveaway as JSON. It exists purely so the requests run in a
// first-party gog.com context, where the session cookie is guaranteed to be
// attached; the background service worker cannot promise that.
export default defineContentScript({
    matches: ['https://www.gog.com/*'],
    main(_: any) {
        if (!oncePerPageRun('_myGogContentScriptInjected' as keyof Window)) {
            return;
        }

        // A GOG-linked Prime Gaming claim (see primegaming.content.ts) lands
        // here with the code in the URL. Confirmed live: a normal signed-in
        // browser session redeems here without the Cloudflare Turnstile
        // widget ever presenting an interactive challenge, so this fills the
        // code and clicks Continue itself — but if Continue never becomes
        // clickable (an interactive challenge did show up, or anything else
        // is blocking it), it just stops and leaves the tab open rather than
        // trying to solve that itself.
        void redeemCurrentCode();

        onClaimMessage({getFreeGames: getFreeGamesList, claimGames: claimCurrentGiveaway});

        async function redeemCurrentCode() {
            const code = extractRedeemCodeParam(location.search);
            if (!code) return;
            const title = extractRedeemTitleParam(location.search) ?? "GOG game";
            // Captured before submitRedeemCode runs: GOG's SPA rewrites the URL
            // once Continue is clicked (the code becomes part of the path), so
            // this is the one point where location.href is still the clean,
            // directly-reusable retry link.
            const retryUrl = location.href;

            try {
                await waitForPageLoad();
                const input = await waitForElement(document, '#codeInput') as HTMLInputElement | null;
                if (!input) {
                    // No signal either way on WHY — could be signed out (GOG's
                    // own sign-in state can't be read reliably from this page's
                    // DOM; see loginState.ts's comment on the same problem), a
                    // slow load, or the page's markup having changed. Whatever
                    // the cause, the code itself must not be lost.
                    await recordRedeemFallback(code, "GOG", title, retryUrl);
                    return;
                }

                // Snapshot taken before submitting: the button flow alone can't
                // tell a real redeem from GOG's UI just moving between steps.
                const ownedBefore = await fetchOwnedGameIds();
                if (!ownedBefore) {
                    console.warn("[gog] couldn't snapshot owned games; only GOG's success screen can confirm this redeem");
                }
                const outcome = await submitRedeemCode(
                    code,
                    input,
                    () => findButtonByAnyText(document, GOG_SUBMIT_LABELS),
                    setControlledInputValue,
                    realClick,
                    wait,
                );
                // The button flow is only a hint either way: a "redeemed" one
                // gets the full wait for GOG to confirm, a "not-redeemed" one
                // still gets a single look in case GOG's success screen is up
                // anyway.
                const isRedeemed = await waitForRedeemConfirmation(
                    ownedBefore,
                    () => fetchOwnedGameIds(),
                    () => hasRedeemSuccessScreen(document),
                    wait,
                    outcome === "redeemed" ? REDEEM_CONFIRM_TIMEOUT_MS : 0,
                );

                if (isRedeemed) {
                    await incrementCounter();
                    // Clears any earlier failed attempt's leftover entry for
                    // this same code, now that it's actually been redeemed.
                    await removePendingRedemption(code);
                    await closeCurrentTab();
                    return;
                }

                if (outcome === "redeemed") {
                    console.warn("[gog] redeem flow finished without GOG confirming it; keeping the code");
                }
                // Not confirmed redeemed: leave the tab exactly where it is so
                // the user can see whatever's blocking it (captcha, already
                // used, ...) and finish redeeming themselves — the fallback
                // record and clipboard copy are extra safety, not a
                // replacement for that.
                await recordRedeemFallback(code, "GOG", title, retryUrl);
            } catch (error: unknown) {
                console.error("[gog] redeem attempt failed:", error);
                await recordRedeemFallback(code, "GOG", title, retryUrl);
            }
        }

        async function getFreeGamesList() {
            await waitForPageLoad();

            let lookup;
            try {
                lookup = await fetchGiveaway();
            } catch (error: unknown) {
                console.error("[gog] giveaway status lookup failed:", error);
                await closeCurrentTab();
                return;
            }

            // Here a 401 is authoritative: the request went out from gog.com
            // itself, so a rejected session really is a signed-out user.
            await recordLoginState(Platforms.GOG, !lookup.unauthorized);
            if (lookup.unauthorized || !lookup.game) {
                await closeCurrentTab();
                return;
            }

            const gamesArr = [lookup.game];
            await setStorageItem("gogGames", gamesArr);

            const freeGamesResponse: FreeGamesResponse = {
                freeGames: gamesArr,
                loggedIn: true
            };

            await browser.runtime.sendMessage({
                target: 'background',
                action: 'claimFreeGames',
                data: freeGamesResponse
            });
            // Nothing further needed from this tab — background opens its own
            // claim tab for whatever this reported.
            await closeCurrentTab();
        }

        async function claimCurrentGiveaway() {
            await waitForPageLoad();

            const outcome = await claimGiveaway();
            if (outcome === "unauthorized") {
                await recordLoginState(Platforms.GOG, false);
                await closeCurrentTab();
                return;
            }

            await recordLoginState(Platforms.GOG, true);
            // "already-claimed" is a success for the user but not a new game, so
            // it must not inflate the claimed counter.
            if (outcome === "claimed") await incrementCounter();
            await closeCurrentTab();
        }
    },
});
