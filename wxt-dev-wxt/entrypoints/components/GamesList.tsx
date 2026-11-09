import GameCard from "@/entrypoints/components/GameCard.tsx";
import {ManualClaimBtn} from "@/entrypoints/components/ManualClaimBtn.tsx";
import PendingRedemptions from "@/entrypoints/components/PendingRedemptions.tsx";
import {useStorage, useStorageValue} from "@/entrypoints/hooks/useStorage.ts";
import {FreeGame} from "@/entrypoints/types/freeGame.ts";
import PlatformFilter, {ALL_PLATFORMS} from "@/entrypoints/components/PlatformFilter.tsx";
import {Platforms} from "@/entrypoints/enums/platforms.ts";
import {EPIC_CLAIMED_KEY, withEpicClaimStatus} from "@/entrypoints/utils/epicGames.ts";
import {withoutEnded} from "@/entrypoints/utils/gameDates.ts";

function GamesList() {
    const [steamGames] = useStorage<FreeGame[]>("steamGames", []);
    const [listedEpicGames] = useStorage<FreeGame[]>("epicGames", []);
    // Read-only and live: a claim tab records its game after the list was
    // written, and useStorage's write-back could clobber that record.
    const epicClaimed = useStorageValue<string[]>(EPIC_CLAIMED_KEY);
    const epicGames = withEpicClaimStatus(listedEpicGames, epicClaimed ?? []);
    const [gogGames] = useStorage<FreeGame[]>("gogGames", []);
    const [indieGalaGames] = useStorage<FreeGame[]>("indieGalaGames", []);
    const [primeGamingGames] = useStorage<FreeGame[]>("primeGamingGames", []);
    // Only what is free now or soon: a stored list can still hold giveaways
    // that have ended (see withoutEnded).
    const freeGames = withoutEnded([...epicGames, ...primeGamingGames, ...steamGames, ...gogGames, ...indieGalaGames]);
    const [storedFutureGames] = useStorage<FreeGame[]>("futureGames", []);
    const futureGames = withoutEnded(storedFutureGames);
    const [showFutureGames, setShowFutureGames] = useStorage<boolean>("showFutureGames", true);
    // Defaults to every platform so existing users see no change until they
    // actually touch the filter.
    const [visiblePlatforms, setVisiblePlatforms] = useStorage<Platforms[]>("visiblePlatforms", ALL_PLATFORMS);
    const allGames = showFutureGames ? [...freeGames, ...futureGames] : freeGames;
    const filteredGames = allGames.filter(game => visiblePlatforms.includes(game.platform));

    return (
        <div className="tab-content">
            <PendingRedemptions/>

            {allGames.length === 0 ? (
                <div className="empty-state">
                    <p>No free games right now.</p>
                    <ManualClaimBtn/>
                </div>
            ) : (
                <>
                    <div className="filter-bar">
                        <PlatformFilter visiblePlatforms={visiblePlatforms} onChange={setVisiblePlatforms}/>
                        <button type="button" className={`chip chip-upcoming${showFutureGames ? ' active' : ''}`}
                                aria-pressed={showFutureGames} onClick={() => setShowFutureGames(!showFutureGames)}
                                title="Show games that become free soon">
                            Upcoming
                        </button>
                    </div>
                    {filteredGames.length === 0 ? (
                        <p className="empty-state">No games match this filter.</p>
                    ) : (
                        <div className="game-list">
                            {filteredGames.map((game) => (
                                <GameCard game={game} key={`${game.platform}|${game.store ?? ''}|${game.link}|${game.title}`}/>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export default GamesList;
