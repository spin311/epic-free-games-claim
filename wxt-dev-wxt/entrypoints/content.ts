import {MessageRequest} from "@/entrypoints/types/messageRequest.ts";
import {FreeGame} from "@/entrypoints/types/freeGame.ts";
import { browser } from 'wxt/browser';
import {setStorageItem, getStorageItem} from "@/entrypoints/hooks/useStorage.ts";

export default defineContentScript({
    matches: ['https://store.epicgames.com/*'],
    main(ctx) {
        browser.runtime.onMessage.addListener((request: MessageRequest) => handleMessage(request));

        function handleMessage(request) {
            if (request.target !== 'content') return;
            if (request.action === 'claim') {
                void claimGames();
            }
        }
        async function claimGames() {
            console.log("claiming games");
            if (!isDocumentReady) {
                await new Promise<void>(resolve => {
                    document.addEventListener('DOMContentLoaded', () => resolve(), {once: true});
                });
            }
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
            });
            console.log(gamesArr);
            void setStorageItem("freeGames", gamesArr);

            const freeGamesStorage = await getStorageItem("freeGames");
            console.log(freeGamesStorage);
        }

        function isDocumentReady() {
            const state = document.readyState;
            return state === 'complete' || state === 'interactive';
        }
    },
});