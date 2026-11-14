import { useStorageValue } from "@/entrypoints/hooks/useStorage.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";
import { activeProblem, HealthError, healthKey, HealthProblem, PlatformHealth } from "@/entrypoints/utils/health.ts";
import { MessageKey, formatLocale, t } from "@/entrypoints/utils/i18n.ts";

const LABEL_KEYS: Record<HealthProblem, MessageKey> = {
    network: "healthNetwork",
    changed: "healthChanged",
    captcha: "healthCaptcha",
    unfinished: "healthUnfinished",
};

const ISSUES_URL = "https://github.com/spin311/epic-free-games-claim/issues";

interface HealthStatusProps {
    platform: Platforms;
}

// Shown next to a store's login status only while its list check or its
// latest claim failed (see health.ts), the newer problem first. "Store
// changed" needs an extension update, so it links to the issue tracker; the
// others clear by themselves once a check or claim works again.
function HealthStatus({ platform }: HealthStatusProps) {
    const check = useStorageValue<PlatformHealth>(healthKey(platform, "check"));
    const claim = useStorageValue<PlatformHealth>(healthKey(platform, "claim"));
    const problem = newer(activeProblem(check), activeProblem(claim));
    if (!problem) return null;

    // An explanation a claim tab gave is a key; a check's own error stays as it was.
    const detail = (problem.detailKey && t(problem.detailKey)) || problem.detail;
    const tooltipParts = [detail, new Date(problem.at).toLocaleString(formatLocale())];
    if (problem.problem === "changed") {
        return (
            <a className="health-status" href={ISSUES_URL} target="_blank" rel="noopener noreferrer"
               title={t("healthChangedTooltip", tooltipParts)}>
                ⚠ {t(LABEL_KEYS.changed)}
            </a>
        );
    }
    return <span className="health-status" title={t("healthTooltip", tooltipParts)}>⚠ {t(LABEL_KEYS[problem.problem])}</span>;
}

function newer(a: HealthError | null, b: HealthError | null): HealthError | null {
    if (!a || !b) return a ?? b;
    return a.at >= b.at ? a : b;
}

export default HealthStatus;
