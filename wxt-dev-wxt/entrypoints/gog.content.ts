import {oncePerPageRun} from "@/entrypoints/utils/oncePerPageRun.ts";
import {browser} from "wxt/browser";
import {FreeGamesResponse} from "@/entrypoints/types/freeGamesResponse.ts";
import {Platforms} from "@/entrypoints/enums/platforms.ts";
import {setStorageItem} from "@/entrypoints/hooks/useStorage.ts";
import {closeCurrentTab, onClaimMessage} from "@/entrypoints/utils/contentMessaging.ts";
import {recordLoginState} from "@/entrypoints/utils/loginState.ts";
import {claimGiveaway, extractRedeemCodeParam, fetchGiveaway} from "@/entrypoints/utils/gogGiveaway.ts";
import {incrementCounter, waitForElement, waitForPageLoad} from "@/entrypoints/utils/helpers.ts";

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
        // here with the code in the URL. Prefilling it and stopping there — the
        // redeem page's own Cloudflare Turnstile captcha gates its Continue
        // button, and solving that is intentionally left to the user, never
        // automated.
        void prefillRedeemCodeIfPresent();

        onClaimMessage({getFreeGames: getFreeGamesList, claimGames: claimCurrentGiveaway});

        async function prefillRedeemCodeIfPresent() {
            const code = extractRedeemCodeParam(location.search);
            if (!code) return;

            await waitForPageLoad();
            const input = await waitForElement(document, '#codeInput');
            if (!input) return;

            (input as HTMLInputElement).value = code;
            // The redeem page is a Vue app whose v-model only syncs on a real
            // 'input' event — setting .value alone leaves its internal state
            // (and the Continue button's validation) unaware anything changed.
            input.dispatchEvent(new Event('input', {bubbles: true}));
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
