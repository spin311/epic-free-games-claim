import {browser} from '#imports';
import {
    getReviewUrl,
    rateAndOpenReviewPage,
    saveReviewAnswer,
} from "@/entrypoints/utils/reviewPrompt.ts";
import {t, tPlural} from "@/entrypoints/utils/i18n.ts";

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
        <h2 id="review-prompt-title">{t("reviewPromptTitle")}</h2>
        <p>{tPlural("reviewPromptBody", claimedCount)}</p>
        <div className="prompt-actions">
            <button type="button" className="btn btn-primary" onClick={rate}>{t("reviewPromptRate")}</button>
            <button type="button" className="btn btn-quiet" onClick={dismiss}>{t("promptNotNow")}</button>
            {/* Beside the buttons rather than under them: a line less in a popup with no height to spare. */}
            <a href={ISSUES_URL} className="prompt-report" target="_blank" rel="noopener noreferrer">
                {t("reviewPromptReport")}
            </a>
        </div>
    </section>;
}

export default ReviewPrompt;
