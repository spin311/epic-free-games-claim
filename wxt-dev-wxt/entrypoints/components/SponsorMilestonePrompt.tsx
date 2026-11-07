import {browser} from '#imports';
import {saveSponsorAnswer, sponsorAndOpen} from "@/entrypoints/utils/sponsorPrompt.ts";

interface Props {
    claimedCount: number;
    onAnswered: () => void;
}

// Rendered only when usePromptChoice picked 'sponsor'. Shares the review
// card's look (review-prompt-* classes).
function SponsorMilestonePrompt({claimedCount, onAnswered}: Props) {
    const sponsor = () => {
        onAnswered();
        void sponsorAndOpen((url) => browser.tabs.create({url}));
    };

    const dismiss = () => {
        onAnswered();
        void saveSponsorAnswer('dismissed');
    };

    return <div className="review-prompt">
        <p className="review-prompt-title">It has claimed {claimedCount} games for you</p>
        <p className="review-prompt-text">
            Free Game Claimer is free and built in my spare time. If it's saved you some money,
            sponsoring on GitHub (monthly from $2, or one-time) keeps it working when stores change.
        </p>
        <div className="review-prompt-actions">
            <button className="review-prompt-primary" onClick={sponsor}>Sponsor on GitHub</button>
            <button className="review-prompt-secondary" onClick={dismiss}>Not now</button>
        </div>
    </div>;
}

export default SponsorMilestonePrompt;
