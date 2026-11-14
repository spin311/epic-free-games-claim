import { ClaimFrequency, ClaimFrequencyLabelKeys } from "@/entrypoints/enums/claimFrequency.ts";
import { t, uiLocale } from "@/entrypoints/utils/i18n.ts";

interface FrequencySelectProps {
    value: ClaimFrequency;
    onChange: (value: ClaimFrequency) => void;
    // Once a day only: the hour (0-23, local time) the day's check waits for,
    // or null for whenever the browser first gets to it.
    claimHour: number | null;
    onClaimHourChange: (hour: number | null) => void;
}

const ANY_TIME = "any";
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

// In the browser's own clock format: "18:00" or "6:00 PM".
function hourLabel(hour: number): string {
    return new Date(2000, 0, 1, hour).toLocaleTimeString(uiLocale(), { hour: "numeric", minute: "2-digit" });
}

// One row: "Check [Once a day] at [Any time]". Each label and its dropdown
// form a pair, which moves to a line of its own when a translation is too
// long for one row (see .schedule-pair).
function FrequencySelect({ value, onChange, claimHour, onClaimHourChange }: FrequencySelectProps) {
    return (
        <div className="schedule-row">
            <span className="schedule-pair">
                <label htmlFor="frequency-select">{t("scheduleCheckLabel")}</label>
                <select
                    id="frequency-select"
                    value={value}
                    onChange={(e) => onChange(e.target.value as ClaimFrequency)}
                >
                    {Object.values(ClaimFrequency).map((frequency) => (
                        <option key={frequency} value={frequency}>
                            {t(ClaimFrequencyLabelKeys[frequency])}
                        </option>
                    ))}
                </select>
            </span>
            {value === ClaimFrequency.DAILY && (
                <span className="schedule-pair">
                    <label htmlFor="claim-hour-select">{t("scheduleAtLabel")}</label>
                    <select
                        id="claim-hour-select"
                        value={claimHour ?? ANY_TIME}
                        onChange={(e) => onClaimHourChange(e.target.value === ANY_TIME ? null : Number(e.target.value))}
                        title={t("scheduleHourTooltip")}
                    >
                        <option value={ANY_TIME}>{t("scheduleAnyTime")}</option>
                        {HOURS.map((hour) => (
                            <option key={hour} value={hour}>{hourLabel(hour)}</option>
                        ))}
                    </select>
                </span>
            )}
        </div>
    );
}

export default FrequencySelect;
