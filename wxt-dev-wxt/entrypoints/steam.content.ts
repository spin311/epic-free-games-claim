import {oncePerPageRun} from "@/entrypoints/utils/oncePerPageRun.ts";
import {browser} from "wxt/browser";
import {MessageRequest} from "@/entrypoints/types/messageRequest.ts";
import {FreeGame} from "@/entrypoints/types/freeGame.ts";
import {Platforms} from "@/entrypoints/enums/platforms.ts";
import {FreeGamesResponse} from "@/entrypoints/types/freeGamesResponse.ts";
import {mergeIntoStorageItem} from "@/entrypoints/hooks/useStorage.ts";
import {
    clickWhenVisible,
    incrementCounter,
    waitForElement,
    waitForPageLoad
} from "@/entrypoints/utils/helpers.ts";

export default defineContentScript({
    matches: ['https://store.steampowered.com/*'],
    main(_) {
        if (!oncePerPageRun('_mySteamContentScriptInjected')) {
            return;
        }
        browser.runtime.onMessage.addListener((request: MessageRequest) => handleMessage(request));

        function handleMessage(request) {
            if (request.target !== 'content') return;
            if (request.action === 'getFreeGames') {
                void getFreeGamesList();
            } else if (request.action === "claimGames") {
                void claimCurrentFreeGame();
            }
        }

        async function getFreeGamesList() {
            await waitForPageLoad();
            const games = document.querySelector('div#search_result_container');
            const freeGames = games?.querySelectorAll('a.search_result_row:not(.ds_owned)');
            const isLoggedIn: boolean = !!document.querySelector('div#global_actions #account_pulldown');
            let gamesArr: FreeGame[] = [];
            freeGames.forEach((freeGame) => {
                const newFreeGame = {
                    link: freeGame.href ?? '',
                    img: freeGame.getElementsByTagName('img')[0]?.src ?? '',
                    title: freeGame.querySelector('span.title')?.innerHTML ?? '',
                    platform: Platforms.Steam
                };
                gamesArr.push(newFreeGame);
            });
            await mergeIntoStorageItem("freeGames", gamesArr);
            if (gamesArr.length === 0) return;
            const freeGamesResponse: FreeGamesResponse = {
                freeGames: gamesArr,
                loggedIn: isLoggedIn
            };
            console.log(freeGamesResponse);
            await browser.runtime.sendMessage({
                target: 'background',
                action: 'claimFreeGames',
                data: freeGamesResponse
            });
        }

        async function claimCurrentFreeGame() {
            await waitForPageLoad();
            const buyOptions = await waitForElement(document, "div.game_area_purchase_game", true);
            if (!buyOptions) return;

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
        }

        function isCurrentGameFree(el): boolean {
            let gamePrice = el?.querySelector('div.game_purchase_action_bg');
            const shouldReturn = gamePrice?.querySelector('div.discount_pct')?.innerHTML === '-100%';
            return gamePrice?.querySelector('div.discount_pct')?.innerHTML === '-100%';
        }
    },
});
