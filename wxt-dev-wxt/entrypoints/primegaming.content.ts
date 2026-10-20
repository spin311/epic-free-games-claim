import { oncePerPageRun } from "@/entrypoints/utils/oncePerPageRun.ts";
import { browser } from "wxt/browser";
import { FreeGamesResponse } from "@/entrypoints/types/freeGamesResponse.ts";
import { FreeGame } from "@/entrypoints/types/freeGame.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";
import { getStorageItem, getStorageItems, setStorageItem } from "@/entrypoints/hooks/useStorage.ts";
import { closeCurrentTab, onClaimMessage } from "@/entrypoints/utils/contentMessaging.ts";
import { detectAndRecordLoginState, recordPrimeMembership } from "@/entrypoints/utils/loginState.ts";
import {
    claimExternalOfferPage,
    claimOfferCard,
    detectExternalPlatform,
    EXTERNAL_PLATFORM_STORAGE_KEYS,
    excludeCollectedOffers,
    ExternalPlatform,
    extractRedeemCode,
    findGetGameButton,
    hasPrimeMembership,
    isInternalOfferCard,
    markPrimeGameClaimed,
    isOfferDetailsPage,
    parseExternalOffers,
    parseInternalOffers,
    pollFor,
    readAllowedExternalPlatforms,
    readOfferTitle,
} from "@/entrypoints/utils/primeGamingGiveaway.ts";
import { recordMissingCode, recordRedeemFallback } from "@/entrypoints/utils/pendingRedemptions.ts";
import { buildRedeemUrl } from "@/entrypoints/utils/gogGiveaway.ts";
import { buildMicrosoftRedeemUrl } from "@/entrypoints/utils/microsoftRedeem.ts";
import { buildLegacyRedeemUrl, findLegacyRedeemUrl } from "@/entrypoints/utils/legacyGamesRedeem.ts";
import { getRndInteger, incrementCounter, realClick, wait, waitForElement, waitForPageLoad } from "@/entrypoints/utils/helpers.ts";
import { runtimeContentScriptOptions } from "@/entrypoints/utils/runtimeContentScripts.ts";

const { matches, runAt, allFrames, registration } = runtimeContentScriptOptions('primegaming');

export default defineContentScript({
    // Matches both gaming.amazon.com and luna.amazon.com — see its entry in
    // RUNTIME_CONTENT_SCRIPTS.
    matches, runAt, allFrames, registration,
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
            return readAllowedExternalPlatforms(await getStorageItems(Object.values(EXTERNAL_PLATFORM_STORAGE_KEYS)));
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
                await recordPrimeMembership(false);
                await closeCurrentTab();
                return;
            }
            await recordPrimeMembership(true);

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

            // Same rule as the background lookup (selectClaimableOffers): claim
            // whatever Amazon doesn't show as collected yet, so a claim that
            // failed on an earlier run is retried rather than skipped as "seen".
            const claimableGames = excludeCollectedOffers(gamesArr, offerList);

            // Persisted regardless of whether anything is claimable, same as
            // Epic/Steam, so the popup's Free Games tab reflects what's listed.
            await setStorageItem("primeGamingGames", gamesArr);

            if (claimableGames.length === 0) {
                await closeCurrentTab();
                return;
            }

            const freeGamesResponse: FreeGamesResponse = {
                freeGames: claimableGames,
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
            // Backstop for the background's own no-Prime check: on a non-Prime
            // account "Get game" only leads to Prime sign-up, and that tab
            // would otherwise be left open as if it were account linking.
            if (!hasPrimeMembership(document)) {
                console.warn("[primegaming] no Prime membership detected; not claiming");
                await recordPrimeMembership(false);
                await closeCurrentTab();
                return;
            }

            // Confirmed live: this "claimed" signal (the Get game button
            // disappearing on the same page) only means a real library claim for
            // Epic's account-linking flow and the Amazon Games App. GOG,
            // Windows Store and Legacy Games instead show a one-time redeem
            // code on this same page once clicked — counting that click here
            // would be a false positive, since nothing is actually redeemed
            // until the code is submitted on gog.com/redeem,
            // account.microsoft.com/billing/redeem or promo.legacygames.com
            // (handled by those sites' own content scripts, which do their
            // own incrementCounter on success). The click still happens here (it surfaces the code
            // without the user having to find the offer manually).
            const platform = detectExternalPlatform(location.pathname);
            let title: string | undefined;
            const outcome = await claimExternalOfferPage(
                () => findGetGameButton(document),
                (button) => {
                    // The last moment this is still the offer's own page — see readOfferTitle.
                    title = readOfferTitle(document);
                    realClick(button);
                },
                wait,
                () => location.href,
            );

            if (outcome === "claimed" || outcome === "already-claimed") await markClaimedInPopupList();

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

            // Both claim straight into a library (Epic's, or Amazon's own
            // Amazon Games App one) — nothing left to redeem.
            if (platform === "Epic" || platform === "AmazonGames") {
                await incrementCounter();
                await closeCurrentTab();
                return;
            }

            // GOG, Windows Store and Legacy Games redeem via a one-time code
            // shown on this same page rather than an in-library claim — hand it,
            // with the game's title, straight to the platform's own redeem page,
            // which attempts to finish the redemption itself (see gog.content.ts /
            // microsoft.content.ts / legacygames.content.ts) and only falls back
            // to the pending list if that doesn't go through.
            if (platform === "GOG" || platform === "Windows" || platform === "Legacy") {
                // The /details success page renders after its route change,
                // so the code may not be in the DOM the instant we get here.
                const code = await pollFor(() => extractRedeemCode(document), wait, 5000, 250);
                const pendingTitle = title ?? "Prime Gaming offer";
                // Either way the tab stays open on the code's page, and the
                // pending list keeps it findable: Amazon now counts the offer
                // as claimed, so no later run will ever reopen it.
                if (!code) {
                    await recordMissingCode(platform, pendingTitle, location.href);
                    return;
                }
                const redeemUrl = buildCodeRedeemUrl(platform, code, title);
                if (!redeemUrl) {
                    await recordRedeemFallback(code, platform, pendingTitle, location.href);
                    return;
                }
                location.href = redeemUrl;
            }
        }

        // Cosmetic only (the popup's "Claimed" badge), so it never gets in
        // the way of the claim itself.
        async function markClaimedInPopupList() {
            try {
                const games = (await getStorageItem<FreeGame[]>("primeGamingGames")) ?? [];
                await setStorageItem("primeGamingGames", markPrimeGameClaimed(games, location.href));
            } catch (error: unknown) {
                console.warn("[primegaming] couldn't mark the claimed offer in the popup list:", error);
            }
        }

        function buildCodeRedeemUrl(platform: "GOG" | "Windows" | "Legacy", code: string, title?: string): string | null {
            if (platform === "GOG") return buildRedeemUrl(code, title);
            if (platform === "Windows") return buildMicrosoftRedeemUrl(code, title);
            const promoUrl = findLegacyRedeemUrl(document, location.href);
            return promoUrl ? buildLegacyRedeemUrl(promoUrl, code, title) : null;
        }
    },
});
