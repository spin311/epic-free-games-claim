import {useEffect, useState} from "react";
import {browser} from '#imports';
import {getStorageItem} from "@/entrypoints/hooks/useStorage.ts";
import {
    getReviewUrl,
    isReviewPromptAnswer,
    rateAndOpenReviewPage,
    REVIEW_PROMPT_KEY,
    saveReviewAnswer,
    shouldShowReviewPrompt,
    type ReviewPromptAnswer,
} from "@/entrypoints/utils/reviewPrompt.ts";

const ISSUES_URL = "https://github.com/spin311/epic-free-games-claim/issues/new";

interface Props {
    claimedCount: number;
    // Lets the parent hide other promos while this card is up.
    onVisibleChange?: (isVisible: boolean) => void;
}

function ReviewPrompt({claimedCount, onVisibleChange}: Props) {
    // undefined = still reading storage, so an answered card never flashes.
    const [answer, setAnswer] = useState<ReviewPromptAnswer | null | undefined>(undefined);
    const env = {isFirefox: import.meta.env.FIREFOX === true, extensionId: browser.runtime.id};

    useEffect(() => {
        void getStorageItem<unknown>(REVIEW_PROMPT_KEY).then((stored) =>
            setAnswer(isReviewPromptAnswer(stored) ? stored : null));
    }, []);

    const isVisible = answer !== undefined && shouldShowReviewPrompt(claimedCount, answer, env);

    useEffect(() => {
        onVisibleChange?.(isVisible);
    }, [isVisible, onVisibleChange]);

    if (!isVisible) return null;

    const dismiss = () => {
        setAnswer('dismissed');
        void saveReviewAnswer('dismissed');
    };

    const rate = () => {
        const url = getReviewUrl(env);
        setAnswer('rated');
        if (url) void rateAndOpenReviewPage(url, (target) => browser.tabs.create({url: target}));
        else void saveReviewAnswer('rated');
    };

    return <div className="review-prompt">
        <p className="review-prompt-title">Enjoying Free Game Claimer?</p>
        <p className="review-prompt-text">
            It has claimed {claimedCount} games for you. A quick rating helps other players find it.
        </p>
        <div className="review-prompt-actions">
            <button className="review-prompt-primary" onClick={rate}>Rate it</button>
            <button className="review-prompt-secondary" onClick={dismiss}>Not now</button>
        </div>
        <a href={ISSUES_URL} className="review-prompt-report" target="_blank" rel="noopener noreferrer">
            Something not working? Report it
        </a>
    </div>;
}

export default ReviewPrompt;
