import {setStorageItem} from "@/entrypoints/hooks/useStorage.ts";
import {
    isReviewPromptAnswer,
    shouldShowReviewPrompt,
    getReviewUrl,
    type ReviewEnv,
} from "@/entrypoints/utils/reviewPrompt.ts";

export type SponsorPromptAnswer = 'clicked' | 'dismissed';
export type PromptChoice = 'review' | 'sponsor' | null;

export const SPONSOR_PROMPT_KEY = 'sponsorPrompt';
export const SPONSOR_PROMPT_MIN_CLAIMED = 20;
export const SPONSOR_PROMPT_REVIEW_GAP_MS = 7 * 24 * 60 * 60 * 1000;
export const SPONSOR_MILESTONE_URL =
    "https://github.com/sponsors/spin311?metadata_source=epic-free-games-claim-milestone";

export interface PromptState {
    claimedCount: number;
    reviewAnswer: unknown;
    reviewAnsweredAt: unknown;
    sponsorAnswer: unknown;
    now: number;
    env: ReviewEnv;
}

export function isSponsorPromptAnswer(value: unknown): value is SponsorPromptAnswer {
    return value === 'clicked' || value === 'dismissed';
}

/**
 * Which card, if any, the popup shows. One answer, so both cards can never
 * show together. The sponsor card waits 7 days after the review answer when
 * this build has a review card at all; a review answered before the timestamp
 * was recorded has no date and counts as old enough.
 */
export function choosePrompt(state: PromptState): PromptChoice {
    const {claimedCount, reviewAnswer, reviewAnsweredAt, sponsorAnswer, now, env} = state;
    if (shouldShowReviewPrompt(claimedCount, reviewAnswer, env)) return 'review';
    if (isSponsorPromptAnswer(sponsorAnswer)) return null;
    if (!Number.isFinite(claimedCount) || claimedCount < SPONSOR_PROMPT_MIN_CLAIMED) return null;
    if (getReviewUrl(env) === null) return 'sponsor';
    if (!isReviewPromptAnswer(reviewAnswer)) return null;
    if (typeof reviewAnsweredAt !== 'number') return 'sponsor';
    return now - reviewAnsweredAt >= SPONSOR_PROMPT_REVIEW_GAP_MS ? 'sponsor' : null;
}

export async function saveSponsorAnswer(answer: SponsorPromptAnswer): Promise<void> {
    await setStorageItem(SPONSOR_PROMPT_KEY, answer);
}

/** Stores 'clicked' BEFORE opening the tab: the popup can close as it opens. */
export async function sponsorAndOpen(openTab: (url: string) => Promise<unknown>): Promise<void> {
    try {
        await saveSponsorAnswer('clicked');
    } catch (error) {
        console.error('Could not store the sponsor answer', error);
    }
    await openTab(SPONSOR_MILESTONE_URL);
}
