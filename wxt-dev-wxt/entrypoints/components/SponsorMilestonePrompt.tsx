import {browser} from '#imports';
import {saveSponsorAnswer, sponsorAndOpen} from "@/entrypoints/utils/sponsorPrompt.ts";

interface Props {
    claimedCount: number;
    onAnswered: () => void;
}

// Rendered only when usePromptChoice picked 'sponsor'. The header's Sponsor
// pink, as a tint, a heart badge and a pink button, so the milestone reads as
// a thank-you rather than another settings box.
function SponsorMilestonePrompt({claimedCount, onAnswered}: Props) {
    const sponsor = () => {
        onAnswered();
        void sponsorAndOpen((url) => browser.tabs.create({url}));
    };

    const dismiss = () => {
        onAnswered();
        void saveSponsorAnswer('dismissed');
    };

    return <section className="prompt-card sponsor-card" aria-labelledby="sponsor-prompt-title">
        <span className="prompt-badge" aria-hidden="true">♥</span>
        <h2 id="sponsor-prompt-title">
            It has claimed <strong className="prompt-count">{claimedCount}</strong> games for you
        </h2>
        <p>Free and built in my spare time. Sponsoring keeps it working when stores change.</p>
        <div className="prompt-actions">
            <button type="button" className="btn btn-sponsor" onClick={sponsor} title="On GitHub, monthly or one-time">
                <span aria-hidden="true">♥</span> Sponsor from $2
            </button>
            <button type="button" className="btn btn-quiet" onClick={dismiss}>Not now</button>
        </div>
    </section>;
}

export default SponsorMilestonePrompt;
