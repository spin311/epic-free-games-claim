import { useStorageValue } from "@/entrypoints/hooks/useStorage.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";
import { activeProblem, HealthError, healthKey, HealthProblem, PlatformHealth } from "@/entrypoints/utils/health.ts";

const LABELS: Record<HealthProblem, string> = {
    network: "Can't reach store",
    changed: "Store changed",
    captcha: "Needs captcha",
    unfinished: "Claim unfinished",
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

    const title = `${problem.detail} (${new Date(problem.at).toLocaleString()})`;
    if (problem.problem === "changed") {
        return (
            <a className="health-status" href={ISSUES_URL} target="_blank" rel="noopener noreferrer"
               title={`${title}. The extension needs an update; click to report it.`}>
                ⚠ {LABELS.changed}
            </a>
        );
    }
    return <span className="health-status" title={title}>⚠ {LABELS[problem.problem]}</span>;
}

function newer(a: HealthError | null, b: HealthError | null): HealthError | null {
    if (!a || !b) return a ?? b;
    return a.at >= b.at ? a : b;
}

export default HealthStatus;
