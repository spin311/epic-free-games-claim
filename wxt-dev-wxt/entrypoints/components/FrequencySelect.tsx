import { ClaimFrequency, ClaimFrequencyLabels } from "@/entrypoints/enums/claimFrequency.ts";

function FrequencySelect(props: { 
    value: ClaimFrequency, 
    onChange: (value: ClaimFrequency) => void 
}) {
    return (
        <div className="day-select">
            <label htmlFor="frequency-select" style={{ fontWeight: 500, color: "#c0bbbb" }}>
                Check Frequency:
            </label>
            <select
                id="frequency-select"
                value={props.value}
                onChange={(e) => props.onChange(e.target.value as ClaimFrequency)}
                style={{ 
                    flex: 1, 
                    cursor: "pointer",
                    outline: "none"
                }}
            >
                {Object.values(ClaimFrequency).map((frequency) => (
                    <option key={frequency} value={frequency}>
                        {ClaimFrequencyLabels[frequency]}
                    </option>
                ))}
            </select>
        </div>
    );
}

export default FrequencySelect;

