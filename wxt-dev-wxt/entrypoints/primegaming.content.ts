import { oncePerPageRun } from "@/entrypoints/utils/oncePerPageRun.ts";
import { browser } from "wxt/browser";
import { FreeGamesResponse } from "@/entrypoints/types/freeGamesResponse.ts";
import { FreeGame } from "@/entrypoints/types/freeGame.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";
import { getStorageItems, setStorageItem } from "@/entrypoints/hooks/useStorage.ts";
import { onClaimMessage } from "@/entrypoints/utils/contentMessaging.ts";
import { detectAndRecordLoginState } from "@/entrypoints/utils/loginState.ts";
import {
    claimExternalOfferPage,
    claimOfferCard,
    EXTERNAL_PLATFORM_STORAGE_KEYS,
    ExternalPlatform,
    hasPrimeMembership,
    isInternalOfferCard,
    isOfferDetailsPage,
    parseExternalOffers,
    parseInternalOffers,
} from "@/entrypoints/utils/primeGamingGiveaway.ts";
import { findButtonByText, getRndInteger, incrementCounter, realClick, wait, waitForElement, waitForPageLoad } from "@/entrypoints/utils/helpers.ts";

export default defineContentScript({
    // gaming.amazon.com/home now redirects to luna.amazon.com/claims/home — the
    // page that actually renders the offer list and per-game claim links lives
    // on luna.amazon.com, so both hosts must be matched for the script to ever
    // get injected (same reasoning as epic.content.ts matching both of Epic's
    // product-page hosts).
    matches: ['https://gaming.amazon.com/*', 'https://luna.amazon.com/*'],
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

        // Off by default per platform — claiming an external offer means
        // navigating away to that store's own account (and possibly its
        // account-linking flow), a bigger step than an internal in-place claim.
        async function getAllowedExternalPlatforms(): Promise<Set<ExternalPlatform>> {
            const keys = Object.values(EXTERNAL_PLATFORM_STORAGE_KEYS);
            const stored = await getStorageItems(keys);
            const allowed = new Set<ExternalPlatform>();
            for (const [platform, key] of Object.entries(EXTERNAL_PLATFORM_STORAGE_KEYS)) {
                if (stored[key] === true) allowed.add(platform as ExternalPlatform);
            }
            return allowed;
        }

        async function getFreeGamesList() {
            await waitForPageLoad();
            const loginState = await detectAndRecordLoginState(Platforms.PrimeGaming);
            if (loginState === false) return;
            if (!hasPrimeMembership(document)) return;

            const offerList = await openGamesTabAndGetOfferList();
            if (!offerList) return;

            const allowedExternalPlatforms = await getAllowedExternalPlatforms();
            const gamesArr: FreeGame[] = [
                ...parseInternalOffers(offerList),
                ...parseExternalOffers(offerList, allowedExternalPlatforms, location.href),
            ];
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

            // Each external offer has its own claims-page link (unlike internal
            // offers, which all share PRIME_GAMING_HOME_URL), so background.ts's
            // per-link tab-open loop lands here for each one individually.
            if (isOfferDetailsPage(location.pathname)) {
                await claimCurrentExternalOffer();
                return;
            }

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

        async function claimCurrentExternalOffer() {
            const loginState = await detectAndRecordLoginState(Platforms.PrimeGaming);
            if (loginState === false) return;

            const outcome = await claimExternalOfferPage(
                () => findButtonByText(document, 'Get game'),
                realClick,
                wait,
                () => location.href,
            );
            if (outcome === "claimed") await incrementCounter();
            // "link-required" (redirected to Amazon's account-linking flow) and
            // "failed" are both silent no-ops by design — never thrown, so one
            // unlinked platform can't block the rest of the claim run.
        }
    },
});
