export type ReviewPromptAnswer = 'rated' | 'dismissed';

export const REVIEW_PROMPT_KEY = 'reviewPrompt';
export const REVIEW_PROMPT_MIN_CLAIMED = 3;

const CHROME_STORE_ID = 'mndghaafpgiinfecbbbcppppiblmjepk';
const FIREFOX_REVIEW_URL = 'https://addons.mozilla.org/firefox/addon/free-game-claime-steam-epic/reviews/';
const CHROME_REVIEW_URL = `https://chromewebstore.google.com/detail/free-game-claimer-for-ste/${CHROME_STORE_ID}/reviews`;

const PROLIFIC_FIREFOX_URL = 'https://addons.mozilla.org/firefox/addon/prolific-studies-notifier/';
const PROLIFIC_CHROME_URL = 'https://chromewebstore.google.com/detail/prolific-studies-notifier/mlicfddkgjkeajfgkihplfbgpmbonbao';
const CROSS_PROMO_UTM = '?utm_source=epic-free-games-claim-popup&utm_medium=cross-promo';

export interface ReviewEnv {
    isFirefox: boolean;
    extensionId: string;
}

/**
 * Review page of the store this copy was installed from, or null when we can't
 * tell (unpacked dev build, a listing that has no review URL here yet).
 */
export function getReviewUrl({ isFirefox, extensionId }: ReviewEnv): string | null {
    if (isFirefox) return FIREFOX_REVIEW_URL;
    return extensionId === CHROME_STORE_ID ? CHROME_REVIEW_URL : null;
}

export function isReviewPromptAnswer(value: unknown): value is ReviewPromptAnswer {
    return value === 'rated' || value === 'dismissed';
}

/** Ask once: any stored answer hides the card for good. */
export function shouldShowReviewPrompt(claimedCount: number, answer: unknown, env: ReviewEnv): boolean {
    if (isReviewPromptAnswer(answer)) return false;
    if (!Number.isFinite(claimedCount) || claimedCount < REVIEW_PROMPT_MIN_CLAIMED) return false;
    return getReviewUrl(env) !== null;
}

export function getCrossPromoUrl(isFirefox: boolean): string {
    return (isFirefox ? PROLIFIC_FIREFOX_URL : PROLIFIC_CHROME_URL) + CROSS_PROMO_UTM;
}
