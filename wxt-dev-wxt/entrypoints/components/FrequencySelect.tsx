import { ClaimFrequency, ClaimFrequencyLabels } from "@/entrypoints/enums/claimFrequency.ts";

interface FrequencySelectProps {
    value: ClaimFrequency;
    onChange: (value: ClaimFrequency) => void;
    // Once Daily only: the hour (0-23, local time) the day's check waits for,
    // or null for whenever the browser first gets to it.
    claimHour: number | null;
    onClaimHourChange: (hour: number | null) => void;
}

const ANY_TIME = "any";
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

// In the browser's own clock format: "18:00" or "6:00 PM".
function hourLabel(hour: number): string {
    return new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function FrequencySelect({ value, onChange, claimHour, onClaimHourChange }: FrequencySelectProps) {
    return (
        <>
            <div className="day-select">
                <label htmlFor="frequency-select" style={{ fontWeight: 500, color: "#c0bbbb" }}>
                    Check Frequency:
                </label>
                <select
                    id="frequency-select"
                    value={value}
                    onChange={(e) => onChange(e.target.value as ClaimFrequency)}
                    style={{ flex: 1, cursor: "pointer", outline: "none" }}
                >
                    {Object.values(ClaimFrequency).map((frequency) => (
                        <option key={frequency} value={frequency}>
                            {ClaimFrequencyLabels[frequency]}
                        </option>
                    ))}
                </select>
            </div>
            {value === ClaimFrequency.DAILY && (
                <div className="day-select">
                    <label htmlFor="claim-hour-select" style={{ fontWeight: 500, color: "#c0bbbb" }}>
                        At:
                    </label>
                    <select
                        id="claim-hour-select"
                        value={claimHour ?? ANY_TIME}
                        onChange={(e) => onClaimHourChange(e.target.value === ANY_TIME ? null : Number(e.target.value))}
                        style={{ flex: 1, cursor: "pointer", outline: "none" }}
                        title="The day's check waits for this hour; if the browser is closed then, it runs when you next open it that day."
                    >
                        <option value={ANY_TIME}>Any time</option>
                        {HOURS.map((hour) => (
                            <option key={hour} value={hour}>{hourLabel(hour)}</option>
                        ))}
                    </select>
                </div>
            )}
        </>
    );
}

export default FrequencySelect;
