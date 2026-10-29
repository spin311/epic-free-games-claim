import {FreeGame} from "@/entrypoints/types/freeGame.ts";
import { browser } from 'wxt/browser';
import {mergeIntoStorageItem, setStorageItem} from "@/entrypoints/hooks/useStorage.ts";
import { oncePerPageRun } from "@/entrypoints/utils/oncePerPageRun";
import {Platforms} from "@/entrypoints/enums/platforms.ts";
import {FreeGamesResponse} from "@/entrypoints/types/freeGamesResponse.ts";
import {closeCurrentTab, onClaimMessage} from "@/entrypoints/utils/contentMessaging.ts";
import {detectAndRecordLoginState} from "@/entrypoints/utils/loginState.ts";
import {EPIC_CLAIMED_KEY, epicProductKey} from "@/entrypoints/utils/epicGames.ts";
import {
    getRndInteger,
    wait,
    waitForPageLoad,
    incrementCounter,
    realClick,
    findButtonByText,
    findDeviceNotSupportedContinue,
    findAgeGateContinue,
    findEpicGetButton,
    isCaptchaShown,
    isEpicGameOwned,
    sameOriginFrameDocuments
} from "@/entrypoints/utils/helpers.ts";
import {defineContentScript} from "wxt/utils/define-content-script";

// The store page hydrates its buy button client-side, which can take a while
// in a background tab.
const BUY_BUTTON_TIMEOUT_MS = 15_000;
// How long a captcha left for the user is watched before the script gives up
// on finishing the order itself (the tab stays open either way).
const CAPTCHA_WAIT_MS = 10 * 60_000;

export default defineContentScript({
    // Must cover both hosts Epic uses for product pages: the store homepage/scrape
    // path (store.epicgames.com) AND the canonical product links that the API-based
    // claim opens (www.epicgames.com/store/...). Missing the www host meant the
    // content script was never injected on claim pages → "Receiving end does not exist".
    matches: ['https://store.epicgames.com/*', 'https://www.epicgames.com/store/*'],
    main(_: any) {
        if (!oncePerPageRun('_myEpicContentScriptInjected')) {
            return;
        }
        // On every Epic page, not just the extension's own tabs: signing in on
        // the store is what lifts the background's "signed out" pause on
        // claiming. Never awaited here, so it can't delay (or fail) a claim.
        const loginStateDetected = detectAndRecordLoginState(Platforms.Epic);
        onClaimMessage({ getFreeGames: getFreeGamesList, claimGames: claimCurrentFreeGame });

        async function getFreeGamesList() {
            await waitForPageLoad();
            const games = document.querySelector('section.css-2u323');
            const freeGames = games?.querySelectorAll('a.css-g3jcms:has(div.css-82y1uz)') as NodeListOf<HTMLAnchorElement>;
            const loginState = await loginStateDetected;
            let gamesArr: FreeGame[] = [];
            freeGames?.forEach((freeGame) => {
                const newFreeGame = {
                    link: freeGame.href ?? '',
                    img: freeGame.getElementsByTagName('img')[0]?.dataset.image ?? '',
                    title: freeGame.getElementsByTagName('h6')[0]?.innerHTML ?? '',
                    platform: Platforms.Epic
                };
                gamesArr.push(newFreeGame);
            });
            if (gamesArr.length > 0) {
                // An inconclusive read must not block claiming, so only a
                // definite "signed out" reports loggedIn: false upstream.
                const freeGamesResponse: FreeGamesResponse = {
                    freeGames: gamesArr,
                    loggedIn: loginState !== false
                }
                await setStorageItem("epicGames", gamesArr);
                await browser.runtime.sendMessage({
                    target: 'background',
                    action: 'claimFreeGames',
                    data: freeGamesResponse
                });
            }
            // Nothing further needed from this tab — background opens its own
            // claim tab(s) for whatever this reported.
            await closeCurrentTab();
        }

        async function claimCurrentFreeGame() {
            await waitForPageLoad();
            await wait(getRndInteger(100, 500));
            await dismissAgeGate();
            const buyButton = await waitForBuyButton(BUY_BUTTON_TIMEOUT_MS);
            if (buyButton === 'owned') {
                console.log('[claimer] Already in library');
                await markClaimed();
                await closeCurrentTab();
                return;
            }
            if (!buyButton) {
                // Not marked claimed, so the background retries it tomorrow.
                console.warn('[claimer] No "Get" button on this page; it may have changed');
                logClaimDiagnostics();
                await closeCurrentTab();
                return;
            }
            await wait(getRndInteger(100, 500));
            realClick(buyButton);
            console.log('[claimer] Clicked "Get"; completing claim');

            let claimed = await completePurchase(40_000);
            if (!claimed && isCaptchaUp()) {
                // Only the user can pass this, so the tab stays for them (as
                // GOG's redeem page does), and the order is still completed and
                // counted once they have.
                console.warn('[claimer] Epic wants a captcha solved; waiting for the user');
                claimed = await completePurchase(CAPTCHA_WAIT_MS);
            }
            if (claimed) {
                await incrementCounter();
                await markClaimed();
                console.log('[claimer] Claim completed');
            } else if (isCaptchaUp()) {
                // Still unsolved: the tab stays open, and the background won't
                // open another for this game while it is.
                return;
            } else {
                console.warn('[claimer] Could not complete claim within timeout');
                logClaimDiagnostics();
            }
            await closeCurrentTab();
        }

        // Waits for a buy button label we can act on: "Get", or "In Library"
        // for a game the account already owns. Null if neither shows up.
        async function waitForBuyButton(timeoutMs: number): Promise<HTMLButtonElement | 'owned' | null> {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                const getButton = findEpicGetButton(document);
                if (getButton) return getButton;
                if (isEpicGameOwned(document)) return 'owned';
                await wait(500);
            }
            return null;
        }

        // Tells the background to stop retrying this game (see
        // EPIC_CLAIMED_KEY). Claim tabs can finish at the same moment and this
        // read-modify-write isn't atomic, so one record can get lost: that only
        // costs a retry, whose tab then finds the game "In Library".
        // Never throws: the tab must still close after it.
        async function markClaimed() {
            const key = epicProductKey(location.href);
            if (!key) return;
            try {
                await mergeIntoStorageItem(EPIC_CLAIMED_KEY, key);
            } catch (error: unknown) {
                console.error('[claimer] Could not record the claim:', error);
            }
        }

        // Mature-content games open behind an age-gate modal that blocks the
        // purchase flow. Click its (enabled) "Continue" button before starting
        // the claim. No-op when the game has no gate, so it's safe to always run.
        async function dismissAgeGate(timeoutMs = 2500): Promise<void> {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                const button = findAgeGateContinue(document);
                // getClientRects() is a reliable visibility check that also works
                // for the modal's position:fixed layout (offsetParent would be null).
                if (button && button.getClientRects().length > 0) {
                    console.log('[claimer] Dismissing age-gate modal');
                    await wait(getRndInteger(200, 400));
                    realClick(button);
                    return;
                }
                await wait(250);
            }
        }

        // The purchase flow renders partly in the top document and partly in
        // a same-origin checkout iframe (confirmed live, Oct 2026: inside a
        // dialog, no longer under #webPurchaseContainer), so search them all.
        function getSearchRoots(): Document[] {
            return [...sameOriginFrameDocuments(document), document];
        }

        function isCaptchaUp(): boolean {
            return getSearchRoots().some((root) => isCaptchaShown(root));
        }

        // Drive the free-game claim to completion after "Get" is clicked by
        // resolving whatever modal is in front of us each pass, until the
        // order-confirmation screen renders. Epic shows a variable chain of
        // blocking dialogs; the flow is NOT done just because we clicked the
        // confirmation button:
        //  - "Device not supported": platform-restriction modal → "Continue"
        //  - "Add to library" / "Place Order": the free-purchase confirmation
        //  - "I accept": the EU "Right of Withdrawal" consent shown AFTER the
        //    confirmation for accounts in the EU (e.g. AT/DE). Without it the
        //    order never completes and the flow hangs.
        // All matched by text since Epic's hashed classes churn; locale is
        // forced to en-US upstream so these English labels always apply.
        async function completePurchase(timeoutMs: number): Promise<boolean> {
            // Checked in priority order so a newly-shown blocking consent
            // ("I accept") wins over re-clicking an already-handled button.
            const CONFIRM_LABELS = ['i accept', 'add to library', 'place order'];
            // Order-confirmation screen strings — the only reliable "done" signal.
            const SUCCESS_RE = /thanks for your order|it['’]s all yours|has been added to your library/i;
            const deadline = Date.now() + timeoutMs;
            // Each confirmation/consent label is clicked at most once: Epic keeps
            // the button in the DOM through the modal transition, so re-clicking
            // it mid-transition cancels the purchase and wedges the flow. One
            // click + a generous wait is what actually advances it.
            const clickedLabels = new Set<string>();
            let sawCaptcha = false;

            while (Date.now() < deadline) {
                const roots = getSearchRoots();

                // Done once the confirmation screen renders in any reachable frame.
                if (roots.some((root) => SUCCESS_RE.test(getRenderedText(root)))) {
                    return true;
                }

                // A captcha blocks whatever is under it, so click nothing while
                // it's up. Once it's gone, Epic may move on by itself or want
                // the interrupted step again: give it a moment, then let the
                // confirmation labels be clicked once more.
                if (roots.some((root) => isCaptchaShown(root))) {
                    sawCaptcha = true;
                    await wait(1000);
                    continue;
                }
                if (sawCaptcha) {
                    sawCaptcha = false;
                    clickedLabels.clear();
                    await wait(3000);
                    continue;
                }

                // Device-not-supported takes precedence; safe to re-dismiss since
                // its Continue button vanishes once clicked.
                const dismiss = findDeviceNotSupported(roots);
                if (dismiss) {
                    console.log('[claimer] Dismissing "Device not supported" modal');
                    await wait(getRndInteger(200, 400)); // let the modal settle before clicking
                    realClick(dismiss);
                    await wait(getRndInteger(300, 600));
                    continue;
                }

                // Confirmation/consent: only try labels we haven't already clicked.
                const pending = CONFIRM_LABELS.filter((label) => !clickedLabels.has(label));
                const confirm = findConfirmButton(roots, pending);
                if (confirm) {
                    const label = (confirm.textContent ?? '').trim().toLowerCase();
                    clickedLabels.add(label);
                    console.log(`[claimer] Clicking: "${confirm.textContent?.trim()}"`);
                    await wait(getRndInteger(200, 400)); // let the modal settle before clicking
                    realClick(confirm);
                    await wait(getRndInteger(800, 1200)); // let the modal transition finish before re-scanning
                    continue;
                }

                await wait(250);
            }
            return false;
        }

        // Use innerText, NOT textContent: the store page embeds a large
        // localization JSON dictionary inside a <script> tag that contains the
        // confirmation strings ("Thanks for your order", etc.) verbatim, so
        // textContent would match SUCCESS_RE before anything is claimed.
        // innerText excludes <script>/<style> and returns only rendered text.
        function getRenderedText(doc: Document): string {
            return doc.body?.innerText ?? '';
        }

        function findDeviceNotSupported(roots: Document[]): HTMLButtonElement | null {
            for (const root of roots) {
                const button = findDeviceNotSupportedContinue(root);
                if (button && !button.disabled) return button;
            }
            return null;
        }

        function findConfirmButton(roots: Document[], labels: string[]): HTMLButtonElement | null {
            for (const root of roots) {
                for (const label of labels) {
                    const button = findButtonByText(root, label);
                    if (button && !button.disabled) return button;
                }
            }
            return null;
        }

        // Diagnostic: dump the frame/iframe/modal picture so we can see WHERE the
        // modal actually lives when the watcher can't reach it (e.g. a cross-origin
        // purchase iframe our content script can't read or inject into).
        function logClaimDiagnostics() {
            const iframes: Array<Record<string, unknown>> = [];
            document.querySelectorAll('iframe').forEach((f) => {
                let access = 'null (likely cross-origin)';
                let innerDialogs = -1;
                let innerHasText = false;
                try {
                    const d = f.contentDocument || f.contentWindow?.document;
                    if (d) {
                        access = 'same-origin';
                        innerDialogs = d.querySelectorAll('[role="dialog"]').length;
                        innerHasText = /device not supported|not compatible/i.test(d.body?.innerText ?? '');
                    }
                } catch {
                    access = 'cross-origin (blocked)';
                }
                iframes.push({ id: f.id, src: f.src, access, innerDialogs, innerHasText });
            });
            console.log('[claimer][diag]', JSON.stringify({
                isTopFrame: window.top === window,
                href: location.href,
                dialogsInThisDoc: document.querySelectorAll('[role="dialog"]').length,
                thisDocHasNotSupportedText: /device not supported|not compatible/i.test(document.body?.innerText ?? ''),
                iframes,
            }, null, 2));
        }
    },
});