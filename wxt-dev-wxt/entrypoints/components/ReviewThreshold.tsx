import { ChangeEvent } from "react";
import { STEAM_REVIEW_TIERS, findTierLabelForThreshold, isCustomThreshold } from "@/entrypoints/utils/steamReviews.ts";
import { t } from "@/entrypoints/utils/i18n.ts";

// Sentinel for a stored number that matches no Steam tier (set by the number
// field older versions had). Shown so the dropdown never reads "Any" while a
// threshold is actually in force.
const CUSTOM_OPTION = "__custom";

interface ReviewThresholdProps {
    value: number | null;
    onChange: (value: number | null) => void;
}

function ReviewThreshold({ value, onChange }: ReviewThresholdProps) {
    const isCustom = isCustomThreshold(value);

    function handleTierChange(e: ChangeEvent<HTMLSelectElement>) {
        // The blank "Any" option clears the gate; every other value is a number.
        const raw = e.target.value;
        onChange(raw === '' ? null : Number(raw));
    }

    return (
        <div className="sub-row">
            <label htmlFor="steam-review-threshold">{t("steamMinRatingLabel")}</label>
            <select
                id="steam-review-threshold"
                value={isCustom ? CUSTOM_OPTION : (value === null ? '' : String(value))}
                onChange={handleTierChange}
                title={t("steamMinRatingTooltip")}
            >
                <option value="">{t("steamMinRatingAny")}</option>
                {STEAM_REVIEW_TIERS.map(tier => (
                    <option key={tier.threshold} value={tier.threshold}>
                        {t("steamMinRatingOption", [String(tier.threshold), findTierLabelForThreshold(tier.threshold)])}
                    </option>
                ))}
                {isCustom && (
                    <option value={CUSTOM_OPTION} disabled>
                        {t("steamMinRatingCustom", String(value))}
                    </option>
                )}
            </select>
        </div>
    );
}

export default ReviewThreshold;
