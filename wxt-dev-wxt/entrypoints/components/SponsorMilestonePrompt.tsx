import {browser} from '#imports';
import {saveSponsorAnswer, sponsorAndOpen} from "@/entrypoints/utils/sponsorPrompt.ts";
import {SLOT, splitAtSlot, t, tPlural} from "@/entrypoints/utils/i18n.ts";

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

    // The count is bold wherever the translation puts it.
    const [titleBefore, titleAfter] = splitAtSlot(tPlural("sponsorCardTitle", claimedCount, [SLOT]));

    return <section className="prompt-card sponsor-card" aria-labelledby="sponsor-prompt-title">
        <span className="prompt-badge" aria-hidden="true">♥</span>
        <h2 id="sponsor-prompt-title">
            {titleBefore}<strong className="prompt-count">{claimedCount}</strong>{titleAfter}
        </h2>
        <p>{t("sponsorCardBody")}</p>
        <div className="prompt-actions">
            <button type="button" className="btn btn-sponsor" onClick={sponsor} title={t("sponsorCardButtonTooltip")}>
                <span aria-hidden="true">♥</span> {t("sponsorCardButton")}
            </button>
            <button type="button" className="btn btn-quiet" onClick={dismiss}>{t("promptNotNow")}</button>
        </div>
    </section>;
}

export default SponsorMilestonePrompt;
