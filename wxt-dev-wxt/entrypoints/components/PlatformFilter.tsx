import { Platforms } from "@/entrypoints/enums/platforms.ts";

// Matches the Free Games tab's own list order (see GamesList.tsx).
const ALL_PLATFORMS: Platforms[] = [
    Platforms.Epic,
    Platforms.PrimeGaming,
    Platforms.Steam,
    Platforms.GOG,
    Platforms.IndieGala,
];

// Short chip labels only — the underlying Platforms values (used for storage
// and matching game.platform) are left untouched.
const CHIP_LABELS: Record<Platforms, string> = {
    [Platforms.Steam]: "Steam",
    [Platforms.Epic]: "Epic",
    [Platforms.GOG]: "GOG",
    [Platforms.IndieGala]: "IndieGala",
    [Platforms.PrimeGaming]: "Prime",
};

interface PlatformFilterProps {
    visiblePlatforms: Platforms[];
    onChange: (platforms: Platforms[]) => void;
}

function PlatformFilter({ visiblePlatforms, onChange }: PlatformFilterProps) {
    function toggle(platform: Platforms) {
        const isVisible = visiblePlatforms.includes(platform);
        onChange(
            isVisible
                ? visiblePlatforms.filter(p => p !== platform)
                : [...visiblePlatforms, platform]
        );
    }

    return (
        <div className="platform-filter" role="group" aria-label="Filter by platform">
            {ALL_PLATFORMS.map(platform => {
                const isActive = visiblePlatforms.includes(platform);
                return (
                    <button
                        key={platform}
                        type="button"
                        className={`platform-chip${isActive ? ' active' : ''}`}
                        aria-pressed={isActive}
                        onClick={() => toggle(platform)}
                    >
                        {CHIP_LABELS[platform]}
                    </button>
                );
            })}
        </div>
    );
}

export default PlatformFilter;
export { ALL_PLATFORMS };
