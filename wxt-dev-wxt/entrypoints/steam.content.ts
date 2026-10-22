import {oncePerPageRun} from "@/entrypoints/utils/oncePerPageRun.ts";
import {browser} from "wxt/browser";
import {FreeGame} from "@/entrypoints/types/freeGame.ts";
import {Platforms} from "@/entrypoints/enums/platforms.ts";
import {FreeGamesResponse} from "@/entrypoints/types/freeGamesResponse.ts";
import {setStorageItem} from "@/entrypoints/hooks/useStorage.ts";
import {closeCurrentTab, onClaimMessage} from "@/entrypoints/utils/contentMessaging.ts";
import {detectAndRecordLoginState} from "@/entrypoints/utils/loginState.ts";
import {
    clickWhenVisible,
    incrementCounter,
    waitForAllElements,
    waitForElement,
    waitForPageLoad
} from "@/entrypoints/utils/helpers.ts";

export default defineContentScript({
    matches: ['https://store.steampowered.com/*'],
    main(_: any) {
        if (!oncePerPageRun('_mySteamContentScriptInjected' as keyof Window)) {
            return;
        }
        onClaimMessage({ getFreeGames: getFreeGamesList, claimGames: claimCurrentFreeGame });

        async function getFreeGamesList() {
            await waitForPageLoad();
            const games = document.querySelector('div#search_result_container');
            const freeGames = games?.querySelectorAll('a.search_result_row:not(.ds_owned)') as NodeListOf<HTMLAnchorElement>;
            const loginState = await detectAndRecordLoginState(Platforms.Steam);
            let gamesArr: FreeGame[] = [];
            freeGames?.forEach((freeGame) => {
                const newFreeGame = {
                    link: freeGame.href ?? '',
                    img: freeGame.getElementsByTagName('img')[0]?.src ?? '',
                    title: freeGame.querySelector('span.title')?.innerHTML ?? '',
                    platform: Platforms.Steam
                };
                gamesArr.push(newFreeGame);
            });
            if (gamesArr.length === 0) {
                await closeCurrentTab();
                return;
            }
            await setStorageItem("steamGames", gamesArr);
            // An inconclusive read must not block claiming, so only a definite
            // "signed out" reports loggedIn: false upstream.
            const freeGamesResponse: FreeGamesResponse = {
                freeGames: gamesArr,
                loggedIn: loginState !== false
            };
            await browser.runtime.sendMessage({
                target: 'background',
                action: 'claimFreeGames',
                data: freeGamesResponse
            });
            // Nothing further needed from this tab — background opens its own
            // claim tab(s) for whatever this reported.
            await closeCurrentTab();
        }

        async function claimCurrentFreeGame() {
            await waitForPageLoad();
            // Refresh the popup's login indicator off the page we already have
            // open. Deliberately not awaited so it can't delay the claim.
            void detectAndRecordLoginState(Platforms.Steam);
            const buyOptions = await waitForAllElements(document, "div.game_area_purchase_game");
            if (!buyOptions) {
                await closeCurrentTab();
                return;
            }

            for (const buyOption of buyOptions) {
                if (buyOption && isCurrentGameFree(buyOption)) {
                    // Find the "Add to Account" anchor
                    const anchor = await waitForElement(buyOption, "div.btn_addtocart a");
                    if (!anchor) continue;

                    const href = (anchor as HTMLAnchorElement).getAttribute("href") || "";

                    // Special-case Steam's javascript: URL to avoid CSP violation
                    const m = href.match(/^javascript:\s*addToCart\(\s*(\d+)\s*\)\s*;?\s*$/i);
                    if (m) {
                        const appid = parseInt(m[1], 10);
                        await browser.runtime.sendMessage({
                            target: "background",
                            action: "steamAddToCart",
                            data: { appid }
                        });
                    } else {
                        await clickWhenVisible("div.btn_addtocart a", buyOption);
                    }

                    await incrementCounter();
                    break;
                }
            }
            await closeCurrentTab();
        }

        function isCurrentGameFree(el: { querySelector: (arg0: string) => any; }): boolean {
            let gamePrice = el?.querySelector('div.game_purchase_action_bg');
            return gamePrice?.querySelector('div.discount_pct')?.innerHTML === '-100%';
        }
    },
});
