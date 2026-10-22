import { ChangeEvent } from "react";
import {
    STEAM_REVIEW_TIERS,
    findTierLabelForThreshold,
    parseThresholdInput,
} from "@/entrypoints/utils/steamReviews.ts";

// Sentinel for a hand-typed number that matches no Steam tier. Shown so the
// dropdown never reads "Any" while a threshold is actually in force.
const CUSTOM_OPTION = "__custom";

interface ReviewThresholdProps {
    value: number | null;
    onChange: (value: number | null) => void;
}

function ReviewThreshold({ value, onChange }: ReviewThresholdProps) {
    const tierLabel = findTierLabelForThreshold(value);
    const isCustom = value !== null && tierLabel === '';

    function handleTierChange(e: ChangeEvent<HTMLSelectElement>) {
        // The blank "Any" option clears the gate; every other value is a number.
        const raw = e.target.value;
        onChange(raw === '' ? null : Number(raw));
    }

    return (
        <div className="review-threshold">
            <div className="threshold-row">
                <label htmlFor="steam-review-threshold">Positive review % needed</label>
                <input
                    id="steam-review-threshold"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    placeholder="any"
                    value={value ?? ''}
                    onChange={e => onChange(parseThresholdInput(e.target.value))}
                />
            </div>
            <select
                className="tier-select"
                aria-label="Steam rating preset"
                value={isCustom ? CUSTOM_OPTION : (value === null ? '' : String(value))}
                onChange={handleTierChange}
            >
                <option value="">Any: claim every free game</option>
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
