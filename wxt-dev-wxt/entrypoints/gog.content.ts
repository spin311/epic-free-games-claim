import {oncePerPageRun} from "@/entrypoints/utils/oncePerPageRun.ts";
import {browser} from "wxt/browser";
import {FreeGamesResponse} from "@/entrypoints/types/freeGamesResponse.ts";
import {Platforms} from "@/entrypoints/enums/platforms.ts";
import {setStorageItem} from "@/entrypoints/hooks/useStorage.ts";
import {onClaimMessage} from "@/entrypoints/utils/contentMessaging.ts";
import {recordLoginState} from "@/entrypoints/utils/loginState.ts";
import {claimGiveaway, fetchGiveaway} from "@/entrypoints/utils/gogGiveaway.ts";
import {incrementCounter, waitForPageLoad} from "@/entrypoints/utils/helpers.ts";

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
        onClaimMessage({getFreeGames: getFreeGamesList, claimGames: claimCurrentGiveaway});

        async function getFreeGamesList() {
            await waitForPageLoad();

            let lookup;
            try {
                lookup = await fetchGiveaway();
            } catch (error: unknown) {
                console.error("[gog] giveaway status lookup failed:", error);
                return;
            }

            // Here a 401 is authoritative: the request went out from gog.com
            // itself, so a rejected session really is a signed-out user.
            await recordLoginState(Platforms.GOG, !lookup.unauthorized);
            if (lookup.unauthorized || !lookup.game) return;

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
        }

        async function claimCurrentGiveaway() {
            await waitForPageLoad();

            const outcome = await claimGiveaway();
            if (outcome === "unauthorized") {
                await recordLoginState(Platforms.GOG, false);
                return;
            }

            await recordLoginState(Platforms.GOG, true);
            // "already-claimed" is a success for the user but not a new game, so
            // it must not inflate the claimed counter.
            if (outcome === "claimed") await incrementCounter();
        }
    },
});
