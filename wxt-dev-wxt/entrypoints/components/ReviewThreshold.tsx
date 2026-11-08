import { ChangeEvent } from "react";
import { STEAM_REVIEW_TIERS, findTierLabelForThreshold } from "@/entrypoints/utils/steamReviews.ts";

// Sentinel for a stored number that matches no Steam tier (set by the number
// field older versions had). Shown so the dropdown never reads "Any" while a
// threshold is actually in force.
const CUSTOM_OPTION = "__custom";

interface ReviewThresholdProps {
    value: number | null;
    onChange: (value: number | null) => void;
}

function ReviewThreshold({ value, onChange }: ReviewThresholdProps) {
    const isCustom = value !== null && findTierLabelForThreshold(value) === '';

    function handleTierChange(e: ChangeEvent<HTMLSelectElement>) {
        // The blank "Any" option clears the gate; every other value is a number.
        const raw = e.target.value;
        onChange(raw === '' ? null : Number(raw));
    }

    return (
        <div className="sub-row">
            <label htmlFor="steam-review-threshold">Min. rating</label>
            <select
                id="steam-review-threshold"
                value={isCustom ? CUSTOM_OPTION : (value === null ? '' : String(value))}
                onChange={handleTierChange}
                title="Skip free Steam games whose reviews are less positive than this."
            >
                <option value="">Any</option>
                {STEAM_REVIEW_TIERS.map(tier => (
                    <option key={tier.threshold} value={tier.threshold}>
                        {tier.threshold}%+ · {tier.label}
                    </option>
                ))}
                {isCustom && (
                    <option value={CUSTOM_OPTION} disabled>
                        {value}%+ · Custom
                    </option>
                )}
            </select>
        </div>
    );
}

export default ReviewThreshold;
