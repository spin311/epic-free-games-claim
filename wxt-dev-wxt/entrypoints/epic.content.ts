import {FreeGame} from "@/entrypoints/types/freeGame.ts";
import { browser } from 'wxt/browser';
import {setStorageItem} from "@/entrypoints/hooks/useStorage.ts";
import { oncePerPageRun } from "@/entrypoints/utils/oncePerPageRun";
import {Platforms} from "@/entrypoints/enums/platforms.ts";
import {FreeGamesResponse} from "@/entrypoints/types/freeGamesResponse.ts";
import {onClaimMessage} from "@/entrypoints/utils/contentMessaging.ts";
import {
    getRndInteger,
    wait,
    clickWhenVisible,
    waitForPageLoad,
    incrementCounter,
    realClick,
    findButtonByText,
    findDeviceNotSupportedContinue,
    findAgeGateContinue
} from "@/entrypoints/utils/helpers.ts";
import {defineContentScript} from "wxt/utils/define-content-script";

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
        onClaimMessage({ getFreeGames: getFreeGamesList, claimGames: claimCurrentFreeGame });

        async function getFreeGamesList() {
            await waitForPageLoad();
            const games = document.querySelector('section.css-2u323');
            const freeGames = games?.querySelectorAll('a.css-g3jcms:has(div.css-82y1uz)') as NodeListOf<HTMLAnchorElement>;
            const isLoggedIn: boolean = (document.querySelector('egs-navigation') as HTMLElement | null)?.getAttribute('isloggedin') === 'true';
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
                const freeGamesResponse: FreeGamesResponse = {
                    freeGames: gamesArr,
                    loggedIn: isLoggedIn
                }
                await setStorageItem("epicGames", gamesArr);
                await browser.runtime.sendMessage({
                    target: 'background',
                    action: 'claimFreeGames',
                    data: freeGamesResponse
                });
            }
        }

        async function claimCurrentFreeGame() {
            await waitForPageLoad();
            await wait(getRndInteger(100, 500));
            await dismissAgeGate();
            await clickWhenVisible('[data-testid="purchase-cta-button"]');
            console.log('[claimer] Clicked "Get"; completing claim');

            const claimed = await completePurchase(40_000);
            if (claimed) {
                await incrementCounter();
                console.log('[claimer] Claim completed');
            } else {
                console.warn('[claimer] Could not complete claim within timeout');
                logClaimDiagnostics();
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

        // The purchase flow can render in the top document OR inside the (same-origin)
        // #webPurchaseContainer iframe, so callers search both.
        function getPurchaseIframeDoc(): Document | null {
            const iframe = document.querySelector<HTMLIFrameElement>('#webPurchaseContainer iframe');
            if (!iframe) return null;
            try {
                return iframe.contentDocument || iframe.contentWindow?.document || null;
            } catch {
                return null; // cross-origin — unreachable from here
            }
        }

        function getSearchRoots(): Document[] {
            const iframeDoc = getPurchaseIframeDoc();
            return iframeDoc ? [iframeDoc, document] : [document];
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

            while (Date.now() < deadline) {
                const roots = getSearchRoots();

                // Done once the confirmation screen renders in any reachable frame.
                if (roots.some((root) => SUCCESS_RE.test(getRenderedText(root)))) {
                    return true;
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