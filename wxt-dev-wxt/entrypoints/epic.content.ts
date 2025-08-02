import {MessageRequest} from "@/entrypoints/types/messageRequest.ts";
import {FreeGame} from "@/entrypoints/types/freeGame.ts";
import { browser } from 'wxt/browser';
import {setStorageItem} from "@/entrypoints/hooks/useStorage.ts";
import { oncePerPageRun } from "@/entrypoints/utils/oncePerPageRun";

export default defineContentScript({
    matches: ['https://store.epicgames.com/*'],
    main(_) {
        if (!oncePerPageRun('_myEpicContentScriptInjected')) {
            return;
        }
        browser.runtime.onMessage.addListener((request: MessageRequest) => handleMessage(request));

        function handleMessage(request) {
            if (request.target !== 'content') return;
            if (request.action === 'getFreeGames') {
                void getFreeGamesList();
            } else if (request.action === "claimGames") {
                void claimFreeGames();
            }
        }

        async function waitForPageLoad() {
            if (!isDocumentReady) {
                await new Promise<void>(resolve => {
                    document.addEventListener('DOMContentLoaded', () => resolve(), {once: true});
                });
            }
        }

        async function getFreeGamesList() {
            await waitForPageLoad();
            const games = document.querySelector('section.css-2u323');
            const freeGames = games?.querySelectorAll('a.css-g3jcms:has(div.css-82y1uz)');
            let gamesArr: FreeGame[] = [];
            freeGames.forEach((freeGame) => {
                const newFreeGame = {
                    link: freeGame.href ?? '',
                    img: freeGame.getElementsByTagName('img')[0]?.dataset.image ?? '',
                    title: freeGame.getElementsByTagName('h6')[0]?.innerHTML ?? ''
                };
                gamesArr.push(newFreeGame);
                console.log(gamesArr);
            });
            await setStorageItem("freeGames", gamesArr);
            await browser.runtime.sendMessage({
                target: 'background',
                action: 'freeGamesListCompleted',
                data: gamesArr
            });
        }
        async function claimFreeGames() {
            await waitForPageLoad();
            await wait(getRndInteger(100, 500));
            await clickWhenVisible('[data-testid="purchase-cta-button"]');
            await wait(getRndInteger(100, 500));
            await clickWhenVisibleIframe('#webPurchaseContainer iframe', 'button.payment-btn.payment-order-confirm__btn');
            await wait(getRndInteger(100, 500));
            await clickWhenVisibleIframe('#webPurchaseContainer iframe', 'button.payment-confirm__btn.payment-btn--primary');
        }

        function wait(ms: number) {
            return new Promise((r) => setTimeout(r, ms));
        }

        function realClick(el) {
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }

        async function clickWhenVisible(selector: string, element = document) {
            const el = await waitForElement(element, selector);
            await wait(getRndInteger(100, 500));
            realClick(el);
        }

        async function clickWhenVisibleIframe(iframeSelector: string, buttonSelector: string) {
            const iframe = await waitForElement(document, iframeSelector);
            await new Promise<void>((resolve) => {
                if (iframe.contentDocument?.readyState === 'complete') {
                    resolve();
                } else {
                    iframe.addEventListener('load', () => resolve(), { once: true });
                }
            });
            await wait(2000);
            const iframeDoc = iframe?.contentDocument || iframe?.contentWindow?.document;
            await clickWhenVisible(buttonSelector, iframeDoc);
        }

        async function waitForElement(element, selector: string, timeout = 500, maxRetry = 10) {
            let retry = 0;
            while (retry < maxRetry) {
                const el = element.querySelector(selector) as HTMLElement | null;
                console.log("waiting for element", el);
                console.log(element);
                if (el && isVisible(el)) {
                    return el;
                }
                await wait(timeout);
                retry++;
                console.log(`Retry: ${retry}`);
            }
        }

        function isVisible(el: HTMLElement) {
            return el.style.visibility !== 'hidden' && el.style.display !== 'none';
        }

        function isDocumentReady() {
            const state = document.readyState;
            return state === 'complete' || state === 'interactive';
        }

        function getRndInteger(min, max) {
            return Math.floor(Math.random() * (max - min + 1) ) + min;
        }
    },
});