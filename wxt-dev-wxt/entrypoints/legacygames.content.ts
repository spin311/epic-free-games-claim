import {oncePerPageRun} from "@/entrypoints/utils/oncePerPageRun.ts";
import {closeCurrentTab} from "@/entrypoints/utils/contentMessaging.ts";
import {getStorageItem, setStorageItem} from "@/entrypoints/hooks/useStorage.ts";
import {extractRedeemCodeParam, extractRedeemTitleParam} from "@/entrypoints/utils/redeemCode.ts";
import {addPendingRedemption, recordRedeemFallback, removePendingRedemption} from "@/entrypoints/utils/pendingRedemptions.ts";
import {
    fillLegacyRedeemForm,
    findLegacyRedeemForm,
    isFreshLegacySubmission,
    LEGACY_EMAIL_STORAGE_KEY,
    LEGACY_SUBMISSION_STORAGE_KEY,
    LegacySubmission,
    matchLegacySubmission,
    normalizeEmail,
    readLegacyRedeemResult,
} from "@/entrypoints/utils/legacyGamesRedeem.ts";
import {incrementCounter, waitForPageLoad} from "@/entrypoints/utils/helpers.ts";

const DEFAULT_TITLE = "Legacy Games game";

// A Legacy-Games-linked Prime Gaming claim (see primegaming.content.ts) lands
// on the game's promo page with the code in our extCode param. Confirmed
// live: that page is a plain POST form (code + email twice + a pre-checked
// newsletter box), so this plays two roles: on the promo page it fills and
// submits the form; on whatever page the POST lands on, it reads the outcome
// back via the submission stashed in extension storage, since the code param
// doesn't survive the POST. Confirmed live: success lands on a per-game
// legacygames.com/amazon-luna-x-legacy-games-{game}/ page, an error back on
// the promo page — hence both patterns.
export default defineContentScript({
    matches: ['https://promo.legacygames.com/*', 'https://legacygames.com/amazon-luna-x-legacy-games-*'],
    main(_: any) {
        if (!oncePerPageRun('_myLegacyGamesContentScriptInjected' as keyof Window)) {
            return;
        }

        // Only the promo page has the form; our param anywhere else is ignored.
        const code = location.hostname === 'promo.legacygames.com' ? extractRedeemCodeParam(location.search) : null;
        void (code ? redeemCode(code) : resolveSubmission());

        async function redeemCode(code: string) {
            const title = extractRedeemTitleParam(location.search) ?? DEFAULT_TITLE;
            // Re-opening this exact URL re-runs the whole flow, so it's the
            // pending-redemption entry's "try again" link.
            const redeemUrl = location.href;

            try {
                await waitForPageLoad();
                const fields = findLegacyRedeemForm(document);
                if (!fields) {
                    await recordRedeemFallback(code, "Legacy", title, redeemUrl);
                    return;
                }

                const email = normalizeEmail(await getStorageItem<string>(LEGACY_EMAIL_STORAGE_KEY));
                fillLegacyRedeemForm(fields, code, email);
                // No email set (or one the page itself won't accept, which
                // would make requestSubmit a silent no-op): the code is filled
                // in and the tab stays open, one email + Submit away.
                if (!email || !fields.form.checkValidity()) {
                    await recordRedeemFallback(code, "Legacy", title, redeemUrl);
                    return;
                }

                // Pending until Legacy Games confirms it: the POST may land on
                // a page this script doesn't recognize (or doesn't run on),
                // and the code must never be lost either way.
                const submittedAt = new Date().toISOString();
                await addPendingRedemption({code, platform: "Legacy", title, redeemUrl, addedAt: submittedAt});
                const submission: LegacySubmission = {code, title, redeemUrl, submittedAt};
                const others = (await readSubmissions()).filter((pending) => pending.code !== code);
                await setStorageItem(LEGACY_SUBMISSION_STORAGE_KEY, [...others, submission]);
                fields.form.requestSubmit();
            } catch (error: unknown) {
                console.error("[legacygames] redeem attempt failed:", error);
                await recordRedeemFallback(code, "Legacy", title, redeemUrl);
            }
        }

        async function readSubmissions(): Promise<LegacySubmission[]> {
            const stored = await getStorageItem<LegacySubmission[]>(LEGACY_SUBMISSION_STORAGE_KEY);
            return Array.isArray(stored) ? stored : [];
        }

        async function resolveSubmission() {
            const stored = await readSubmissions();
            if (stored.length === 0) return;
            // Stale entries are dropped here, so one can never be matched to
            // some unrelated later visit.
            const fresh = stored.filter((pending) => isFreshLegacySubmission(pending, new Date()));
            const submission = matchLegacySubmission(fresh, location.href);
            if (!submission) {
                if (fresh.length !== stored.length) await setStorageItem(LEGACY_SUBMISSION_STORAGE_KEY, fresh);
                return;
            }

            try {
                await waitForPageLoad();
                const outcome = readLegacyRedeemResult(location.href, document);
                if (outcome.result === "unconfirmed") {
                    // Not a page we recognize: left for its real landing page
                    // (or expiry). The code is pending from before the submit,
                    // and the tab stays open so the user can see where it went.
                    console.warn("[legacygames] couldn't confirm the redeem; keeping the code pending");
                    return;
                }
                const remaining = (await readSubmissions()).filter((pending) => pending.code !== submission.code);
                await setStorageItem(LEGACY_SUBMISSION_STORAGE_KEY, remaining);
                if (outcome.result === "redeemed") {
                    await incrementCounter();
                    await removePendingRedemption(submission.code);
                    await closeCurrentTab();
                    return;
                }
                console.warn(`[legacygames] code rejected: ${outcome.message}`);
                // Copies the code too; the tab stays open on the error.
                await recordRedeemFallback(submission.code, "Legacy", submission.title, submission.redeemUrl);
            } catch (error: unknown) {
                console.error("[legacygames] reading the redeem outcome failed:", error);
            }
        }
    },
});
