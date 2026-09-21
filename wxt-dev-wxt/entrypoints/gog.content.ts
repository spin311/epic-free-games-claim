import {oncePerPageRun} from "@/entrypoints/utils/oncePerPageRun.ts";
import {browser} from "wxt/browser";
import {FreeGamesResponse} from "@/entrypoints/types/freeGamesResponse.ts";
import {Platforms} from "@/entrypoints/enums/platforms.ts";
import {setStorageItem} from "@/entrypoints/hooks/useStorage.ts";
import {closeCurrentTab, onClaimMessage} from "@/entrypoints/utils/contentMessaging.ts";
import {recordLoginState} from "@/entrypoints/utils/loginState.ts";
import {claimGiveaway, fetchGiveaway} from "@/entrypoints/utils/gogGiveaway.ts";
import {extractRedeemCodeParam, setControlledInputValue, submitRedeemCode} from "@/entrypoints/utils/redeemCode.ts";
import {findButtonByText, incrementCounter, realClick, wait, waitForElement, waitForPageLoad} from "@/entrypoints/utils/helpers.ts";

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

            await waitForPageLoad();
            const input = await waitForElement(document, '#codeInput') as HTMLInputElement | null;
            if (!input) return;

            const outcome = await submitRedeemCode(
                code,
                input,
                () => findButtonByText(document, 'Continue'),
                setControlledInputValue,
                realClick,
                wait,
            );

            if (outcome === "redeemed") {
                await incrementCounter();
                await closeCurrentTab();
            }
            // "not-redeemed": leave the tab exactly where it is so the user
            // can see whatever's blocking it and finish redeeming themselves.
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
