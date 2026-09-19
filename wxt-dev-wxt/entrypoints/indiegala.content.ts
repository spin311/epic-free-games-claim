import { oncePerPageRun } from "@/entrypoints/utils/oncePerPageRun.ts";
import { browser } from "wxt/browser";
import { FreeGamesResponse } from "@/entrypoints/types/freeGamesResponse.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";
import { setStorageItem } from "@/entrypoints/hooks/useStorage.ts";
import { closeCurrentTab, onClaimMessage } from "@/entrypoints/utils/contentMessaging.ts";
import { detectAndRecordLoginState } from "@/entrypoints/utils/loginState.ts";
import { claimFreebie, extractProductId, fetchFreebies } from "@/entrypoints/utils/indieGalaGiveaway.ts";
import { findAdultCheckConfirm, getRndInteger, incrementCounter, realClick, wait, waitForPageLoad } from "@/entrypoints/utils/helpers.ts";

// Listing is public and normally satisfied by background.ts's direct fetch; this
// script exists as the fallback path (guaranteed cookies for claiming, and a
// backup listing path if the background fetch ever fails) — the same role
// gog.content.ts plays for GOG.
export default defineContentScript({
    matches: ['https://freebies.indiegala.com/*'],
    main(_: any) {
        if (!oncePerPageRun('_myIndieGalaContentScriptInjected' as keyof Window)) {
            return;
        }
        onClaimMessage({ getFreeGames: getFreeGamesList, claimGames: claimCurrentFreebie });

        async function getFreeGamesList() {
            await waitForPageLoad();
            const loginState = await detectAndRecordLoginState(Platforms.IndieGala);

            let freebies;
            try {
                freebies = await fetchFreebies();
            } catch (error: unknown) {
                console.error("[indiegala] freebies list fetch failed:", error);
                await closeCurrentTab();
                return;
            }
            if (freebies.length === 0) {
                await closeCurrentTab();
                return;
            }

            const gamesArr = freebies.map((f) => f.game);
            await setStorageItem("indieGalaGames", gamesArr);

            const freeGamesResponse: FreeGamesResponse = {
                freeGames: gamesArr,
                loggedIn: loginState !== false,
            };
            await browser.runtime.sendMessage({
                target: 'background',
                action: 'claimFreeGames',
                data: freeGamesResponse,
            });
            // Nothing further needed from this tab — background opens its own
            // claim tab per freebie for whatever this reported.
            await closeCurrentTab();
        }

        // Runs on the individual product page background.ts opened (game.link),
        // so the product id and CSRF token are read straight from the live DOM —
        // no extra fetch needed.
        async function claimCurrentFreebie() {
            await waitForPageLoad();
            void detectAndRecordLoginState(Platforms.IndieGala);
            await dismissAdultCheck();

            const csrfToken = document.querySelector('input[name="csrfmiddlewaretoken"]')?.getAttribute('value');
            const productId = extractProductId(document.documentElement.outerHTML);
            const slug = location.pathname.replace(/^\/+|\/+$/g, '');

            if (!csrfToken || !productId || !slug) {
                console.error("[indiegala] could not determine product identity from the current page");
                await closeCurrentTab();
                return;
            }

            const outcome = await claimFreebie(productId, slug, csrfToken);
            if (outcome === "claimed") await incrementCounter();
            await closeCurrentTab();
        }

        // Mature-content freebies cover the page with a click-blocking overlay
        // until dismissed. The claim itself is a plain fetch() and doesn't need
        // this — CSRF token/product id are already in the DOM either way — but
        // dismissing it matches what a human visitor would do and keeps a
        // manually-opened tab from sitting on the gate indefinitely.
        async function dismissAdultCheck() {
            const confirm = findAdultCheckConfirm(document);
            if (!confirm) return;
            await wait(getRndInteger(100, 500));
            realClick(confirm);
        }
    },
});
