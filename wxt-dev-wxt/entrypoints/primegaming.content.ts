import { oncePerPageRun } from "@/entrypoints/utils/oncePerPageRun.ts";
import { browser } from "wxt/browser";
import { FreeGamesResponse } from "@/entrypoints/types/freeGamesResponse.ts";
import { FreeGame } from "@/entrypoints/types/freeGame.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";
import { getStorageItem, getStorageItems, setStorageItem } from "@/entrypoints/hooks/useStorage.ts";
import { closeCurrentTab, onClaimMessage } from "@/entrypoints/utils/contentMessaging.ts";
import { detectAndRecordLoginState } from "@/entrypoints/utils/loginState.ts";
import {
    claimExternalOfferPage,
    claimOfferCard,
    detectExternalPlatform,
    EXTERNAL_PLATFORM_STORAGE_KEYS,
    ExternalPlatform,
    extractRedeemCode,
    filterNewOffers,
    hasPrimeMembership,
    isInternalOfferCard,
    isOfferDetailsPage,
    parseExternalOffers,
    parseInternalOffers,
    pollFor,
} from "@/entrypoints/utils/primeGamingGiveaway.ts";
import { buildRedeemUrl } from "@/entrypoints/utils/gogGiveaway.ts";
import { buildMicrosoftRedeemUrl } from "@/entrypoints/utils/microsoftRedeem.ts";
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
            const offerList = await waitForElement(document, 'div[data-a-target="offer-list-FGWP_FULL"]', 500, 20);
            if (!offerList) return null;

            // Confirmed live: the container div can render before its card
            // children actually stream in, so reading offerList's children
            // immediately after finding it can race an empty shell. Wait for at
            // least one card to exist before treating the list as ready.
            const hasCards = await waitForElement(offerList, '.item-card__action', 500, 20);
            return hasCards ? offerList : null;
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
            if (loginState === false) {
                console.warn("[primegaming] not signed in; skipping");
                await closeCurrentTab();
                return;
            }
            if (!hasPrimeMembership(document)) {
                console.warn("[primegaming] no Prime membership detected; skipping");
                await closeCurrentTab();
                return;
            }

            const offerList = await openGamesTabAndGetOfferList();
            if (!offerList) {
                console.warn("[primegaming] offer list never rendered; skipping");
                await closeCurrentTab();
                return;
            }

            const allowedExternalPlatforms = await getAllowedExternalPlatforms();
            const internalGames = parseInternalOffers(offerList, location.href);
            const externalGames = parseExternalOffers(offerList, allowedExternalPlatforms, location.href);
            const gamesArr: FreeGame[] = [...internalGames, ...externalGames];
            if (gamesArr.length === 0) {
                console.warn(
                    `[primegaming] nothing to claim — internal: ${internalGames.length}, ` +
                    `external: ${externalGames.length}, allowed external platforms: ` +
                    `${[...allowedExternalPlatforms].join(', ') || 'none'}`
                );
                await closeCurrentTab();
                return;
            }

            // Unlike Epic/Steam/GOG/IndieGala, Prime's own claim step re-scrapes
            // and re-evaluates every listed card regardless of what's sent here
            // (see claimCurrentGames) — but skipping the message entirely when
            // nothing is new avoids opening a second tab, every check, purely to
            // find that claimOfferCard's already-claimed check has nothing to do.
            const previouslySeen: FreeGame[] = (await getStorageItem("primeGamingGames")) || [];
            const newGames = filterNewOffers(gamesArr, previouslySeen);

            // Persisted regardless of whether anything is new, same as Epic/Steam,
            // so the popup's Free Games tab always reflects what's currently listed.
            await setStorageItem("primeGamingGames", gamesArr);

            if (newGames.length === 0) {
                await closeCurrentTab();
                return;
            }

            const freeGamesResponse: FreeGamesResponse = {
                freeGames: newGames,
                loggedIn: true,
            };
            await browser.runtime.sendMessage({
                target: 'background',
                action: 'claimFreeGames',
                data: freeGamesResponse,
            });
            // Nothing further needed from this tab — background opens its own
            // claim tab(s) for whatever this reported.
            await closeCurrentTab();
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
            if (loginState === false) {
                await closeCurrentTab();
                return;
            }
            if (!hasPrimeMembership(document)) {
                await closeCurrentTab();
                return;
            }

            const offerList = await openGamesTabAndGetOfferList();
            if (!offerList) {
                await closeCurrentTab();
                return;
            }

            const cards = Array.from(
                offerList.querySelectorAll<HTMLElement>('.item-card__action')
            ).filter(isInternalOfferCard);

            for (const card of cards) {
                await wait(getRndInteger(300, 700));
                const outcome = await claimOfferCard(card, realClick, wait);
                if (outcome === "claimed") await incrementCounter();
                await wait(getRndInteger(800, 1500));
            }
            await closeCurrentTab();
        }

        async function claimCurrentExternalOffer() {
            try {
                await claimCurrentExternalOfferUnsafe();
            } catch (error: unknown) {
                // Whatever broke, this tab is now a dead end — leaving it open
                // wouldn't give the user anything actionable (unlike the
                // deliberate "not-redeemed"/"link-required" cases below), so
                // it's closed rather than accumulating as an unexplained zombie
                // tab. One offer's tab failing this way can't affect any other
                // game either way — every claim runs in its own isolated tab.
                console.error("[primegaming] claiming an external offer failed:", error);
                await closeCurrentTab();
            }
        }

        async function claimCurrentExternalOfferUnsafe() {
            const loginState = await detectAndRecordLoginState(Platforms.PrimeGaming);
            if (loginState === false) {
                await closeCurrentTab();
                return;
            }

            // Confirmed live: this "claimed" signal (the Get game button
            // disappearing on the same page) only means a real library claim for
            // Epic's account-linking flow. GOG and Windows Store instead show a
            // one-time redeem code on this same page once clicked — counting
            // that click here would be a false positive, since nothing is
            // actually redeemed until the code is submitted on gog.com/redeem
            // or account.microsoft.com/billing/redeem (handled by those sites'
            // own content scripts, which do their own incrementCounter on
            // success). The click still happens here (it surfaces the code
            // without the user having to find the offer manually).
            const platform = detectExternalPlatform(location.pathname);
            const outcome = await claimExternalOfferPage(
                () => findButtonByText(document, 'Get game'),
                realClick,
                wait,
                () => location.href,
            );

            // Both are silent no-ops by design — never thrown, so one unlinked
            // platform can't block the rest of the claim run.
            if (outcome === "failed" || outcome === "already-claimed") {
                await closeCurrentTab();
                return;
            }
            if (outcome === "link-required") {
                // Left open: this tab now IS Amazon's account-linking page, and
                // closing it would take away the exact page the user would need
                // to finish linking their account, if they want to.
                return;
            }

            if (platform === "Epic") {
                await incrementCounter();
                await closeCurrentTab();
                return;
            }

            // GOG and Windows Store both redeem via a one-time code shown on
            // this same page rather than an in-library claim — hand it,
            // together with the game's title (best-effort, purely for the
            // pending-redemption fallback UI — a missing h1 just means a
            // slightly less friendly popup entry, never a broken claim),
            // straight to the platform's own redeem page, which attempts to
            // finish the redemption itself (see gog.content.ts /
            // microsoft.content.ts) and only falls back to leaving the tab
            // open if that doesn't go through.
            if (platform === "GOG" || platform === "Windows") {
                // The /details success page renders after its route change,
                // so the code may not be in the DOM the instant we get here.
                const code = await pollFor(() => extractRedeemCode(document), wait, 5000, 250);
                if (!code) return;
                const title = document.querySelector('h1')?.textContent?.trim();
                location.href = platform === "GOG"
                    ? buildRedeemUrl(code, title)
                    : buildMicrosoftRedeemUrl(code, title);
            }
        }
    },
});
