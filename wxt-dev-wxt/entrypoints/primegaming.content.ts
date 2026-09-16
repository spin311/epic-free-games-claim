import { oncePerPageRun } from "@/entrypoints/utils/oncePerPageRun.ts";
import { browser } from "wxt/browser";
import { FreeGamesResponse } from "@/entrypoints/types/freeGamesResponse.ts";
import { FreeGame } from "@/entrypoints/types/freeGame.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";
import { setStorageItem } from "@/entrypoints/hooks/useStorage.ts";
import { onClaimMessage } from "@/entrypoints/utils/contentMessaging.ts";
import { detectAndRecordLoginState } from "@/entrypoints/utils/loginState.ts";
import { claimOfferCard, hasPrimeMembership, isInternalOfferCard, parseInternalOffers } from "@/entrypoints/utils/primeGamingGiveaway.ts";
import { getRndInteger, incrementCounter, realClick, wait, waitForElement, waitForPageLoad } from "@/entrypoints/utils/helpers.ts";

export default defineContentScript({
    matches: ['https://gaming.amazon.com/*'],
    main(_: any) {
        if (!oncePerPageRun('_myPrimeGamingContentScriptInjected' as keyof Window)) {
            return;
        }
        onClaimMessage({ getFreeGames: getFreeGamesList, claimGames: claimCurrentGames });

        // The "Games" tab must be selected before the offer list renders; it's
        // the default tab on most loads but not guaranteed (e.g. deep links).
        async function openGamesTabAndGetOfferList(): Promise<Element | null> {
            const gameTab = await waitForElement(document, 'button[data-type="Game"]');
            if (gameTab) realClick(gameTab);
            return waitForElement(document, 'div[data-a-target="offer-list-FGWP_FULL"]', 500, 20);
        }

        async function getFreeGamesList() {
            await waitForPageLoad();
            const loginState = await detectAndRecordLoginState(Platforms.PrimeGaming);
            if (loginState === false) return;
            if (!hasPrimeMembership(document)) return;

            const offerList = await openGamesTabAndGetOfferList();
            if (!offerList) return;

            const gamesArr: FreeGame[] = parseInternalOffers(offerList);
            if (gamesArr.length === 0) return;

            await setStorageItem("primeGamingGames", gamesArr);

            const freeGamesResponse: FreeGamesResponse = {
                freeGames: gamesArr,
                loggedIn: true,
            };
            await browser.runtime.sendMessage({
                target: 'background',
                action: 'claimFreeGames',
                data: freeGamesResponse,
            });
        }

        // All internal offers share one claim page, so this claims every
        // currently-unclaimed internal card found in a single visit rather than
        // being told which one game to claim.
        async function claimCurrentGames() {
            await waitForPageLoad();
            const loginState = await detectAndRecordLoginState(Platforms.PrimeGaming);
            if (loginState === false) return;
            if (!hasPrimeMembership(document)) return;

            const offerList = await openGamesTabAndGetOfferList();
            if (!offerList) return;

            const cards = Array.from(
                offerList.querySelectorAll<HTMLElement>('.item-card__action')
            ).filter(isInternalOfferCard);

            for (const card of cards) {
                await wait(getRndInteger(300, 700));
                const outcome = await claimOfferCard(card, realClick, wait);
                if (outcome === "claimed") await incrementCounter();
                await wait(getRndInteger(800, 1500));
            }
        }
    },
});
