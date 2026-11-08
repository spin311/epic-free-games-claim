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

    return <section className="prompt-card" aria-labelledby="review-prompt-title">
        <h2 id="review-prompt-title">Enjoying Free Game Claimer?</h2>
        <p>It has claimed {claimedCount} games for you. A quick rating helps other players find it.</p>
        <div className="prompt-actions">
            <button type="button" className="btn btn-primary" onClick={rate}>Rate it</button>
            <button type="button" className="btn btn-quiet" onClick={dismiss}>Not now</button>
            {/* Beside the buttons rather than under them: a line less in a popup with no height to spare. */}
            <a href={ISSUES_URL} className="prompt-report" target="_blank" rel="noopener noreferrer">
                Not working? Report it
            </a>
        </div>
    </section>;
}

export default ReviewPrompt;
