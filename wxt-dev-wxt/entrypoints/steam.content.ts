import {oncePerPageRun} from "@/entrypoints/utils/oncePerPageRun.ts";
import {browser} from "wxt/browser";
import {FreeGame} from "@/entrypoints/types/freeGame.ts";
import {Platforms} from "@/entrypoints/enums/platforms.ts";
import {FreeGamesResponse} from "@/entrypoints/types/freeGamesResponse.ts";
import {setStorageItem} from "@/entrypoints/hooks/useStorage.ts";
import {closeCurrentTab, onClaimMessage} from "@/entrypoints/utils/contentMessaging.ts";
import {detectAndRecordLoginState} from "@/entrypoints/utils/loginState.ts";
import {MessageRequest} from "@/entrypoints/types/messageRequest.ts";
import {readSteamKeyResult, SteamKeyResult} from "@/entrypoints/utils/steamKeyActivation.ts";
import {
    clickWhenVisible,
    incrementCounter,
    waitForAllElements,
    waitForElement,
    waitForPageLoad
} from "@/entrypoints/utils/helpers.ts";

const KEY_RESULT_TIMEOUT_MS = 20_000;

export default defineContentScript({
    matches: ['https://store.steampowered.com/*'],
    main(_: any) {
        if (!oncePerPageRun('_mySteamContentScriptInjected' as keyof Window)) {
            return;
        }
        // On every Steam store page, not just the extension's own tabs: the
        // popup's "Log in" link lands a signed-in user on the store, and that
        // visit alone should settle the indicator. Never awaited here, so it
        // can't delay (or fail) a claim.
        const loginStateDetected = detectAndRecordLoginState(Platforms.Steam);
        onClaimMessage({ getFreeGames: getFreeGamesList, claimGames: claimCurrentFreeGame });
        browser.runtime.onMessage.addListener((request: MessageRequest) => {
            if (request.target === "content" && request.action === "activateSteamKey") {
                void activateKey(typeof request.data?.title === "string" ? request.data.title : "");
            }
        });

        // On Steam's activation page the background opened with a key from an
        // IndieGala gift (see handleGiftKeys): agree, submit, and report what
        // Steam answered. The background kept the key before opening this tab,
        // so a report that never arrives loses nothing; the tab closes anyway.
        async function activateKey(title: string) {
            try {
                await waitForPageLoad();
                const key = document.querySelector<HTMLInputElement>("#product_key")?.value.trim() ?? "";
                const result = key ? await submitKey() : notOnActivationPage();
                await browser.runtime.sendMessage({
                    target: "background",
                    action: "steamKeyResult",
                    data: { key: key || keyFromUrl(), title, ...result },
                });
            } catch (error: unknown) {
                console.error("[steam] key activation couldn't finish:", error);
            } finally {
                await closeCurrentTab();
            }
        }

        // Steam's Continue is a javascript: link a content script's click
        // can't run, so the background calls RegisterProductKey in the page.
        async function submitKey(): Promise<SteamKeyResult> {
            let isSubmitted = false;
            try {
                isSubmitted = await browser.runtime.sendMessage({ target: "background", action: "steamRegisterKey" }) === true;
            } catch (error: unknown) {
                console.error("[steam] couldn't submit the key:", error);
            }
            if (!isSubmitted) return { outcome: "failed", products: [], message: "Steam's activation form changed" };
            const deadline = Date.now() + KEY_RESULT_TIMEOUT_MS;
            while (Date.now() < deadline) {
                const result = readSteamKeyResult(document);
                if (result) return result;
                await new Promise((resolve) => setTimeout(resolve, 250));
            }
            return { outcome: "failed", products: [], message: "Steam didn't answer" };
        }

        // Signed out, Steam sends the activation link to its login page.
        function notOnActivationPage(): SteamKeyResult {
            return location.pathname.startsWith("/login")
                ? { outcome: "signed-out", products: [], message: "" }
                : { outcome: "failed", products: [], message: "Steam's activation page changed" };
        }

        // The login page keeps the activation link in its redir parameter.
        function keyFromUrl(): string {
            try {
                const redir = new URLSearchParams(location.search).get("redir") ?? location.href;
                return new URL(redir, location.origin).searchParams.get("key") ?? "";
            } catch {
                return "";
            }
        }

        async function getFreeGamesList() {
            await waitForPageLoad();
            const games = document.querySelector('div#search_result_container');
            const freeGames = games?.querySelectorAll('a.search_result_row:not(.ds_owned)') as NodeListOf<HTMLAnchorElement>;
            const loginState = await loginStateDetected;
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
