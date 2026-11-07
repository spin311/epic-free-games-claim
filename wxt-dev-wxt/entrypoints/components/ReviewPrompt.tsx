import {browser} from '#imports';
import {
    getReviewUrl,
    rateAndOpenReviewPage,
    saveReviewAnswer,
} from "@/entrypoints/utils/reviewPrompt.ts";

const ISSUES_URL = "https://github.com/spin311/epic-free-games-claim/issues/new";

interface Props {
    claimedCount: number;
    onAnswered: () => void;
}

// Rendered only when usePromptChoice picked 'review'.
function ReviewPrompt({claimedCount, onAnswered}: Props) {
    const dismiss = () => {
        onAnswered();
        void saveReviewAnswer('dismissed');
    };

    const rate = () => {
        const url = getReviewUrl({isFirefox: import.meta.env.FIREFOX === true, extensionId: browser.runtime.id});
        onAnswered();
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
