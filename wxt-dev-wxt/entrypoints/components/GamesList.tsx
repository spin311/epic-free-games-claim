import GameCard from "@/entrypoints/components/GameCard.tsx";
import {ManualClaimBtn} from "@/entrypoints/components/ManualClaimBtn.tsx";
import PendingRedemptions from "@/entrypoints/components/PendingRedemptions.tsx";
import {useStorage} from "@/entrypoints/hooks/useStorage.ts";
import {FreeGame} from "@/entrypoints/types/freeGame.ts";
import Checkbox from "@/entrypoints/components/Checkbox.tsx";
import PlatformFilter, {ALL_PLATFORMS} from "@/entrypoints/components/PlatformFilter.tsx";
import {Platforms} from "@/entrypoints/enums/platforms.ts";

function freeGamesList() {
    const [steamGames] = useStorage<FreeGame[]>("steamGames", []);
    const [EpicGames] = useStorage<FreeGame[]>("epicGames", []);
    const [gogGames] = useStorage<FreeGame[]>("gogGames", []);
    const [indieGalaGames] = useStorage<FreeGame[]>("indieGalaGames", []);
    const [primeGamingGames] = useStorage<FreeGame[]>("primeGamingGames", []);
    const freeGames = [...EpicGames, ...primeGamingGames, ...steamGames, ...gogGames, ...indieGalaGames];
    const [futureGames] = useStorage<FreeGame[]>("futureGames", []);
    const [showFutureGames, setShowFutureGames] = useStorage<boolean>("showFutureGames", true);
    const [showDesc, setShowDesc] = useStorage<boolean>("showDesc", true);
    // Defaults to every platform so existing users see no change until they
    // actually touch the filter.
    const [visiblePlatforms, setVisiblePlatforms] = useStorage<Platforms[]>("visiblePlatforms", ALL_PLATFORMS);
    const allGames = showFutureGames ? [...freeGames, ...futureGames] : freeGames;
    const filteredGames = allGames.filter(game => visiblePlatforms.includes(game.platform));

    return (
        <div>
            <PendingRedemptions/>

            {!allGames || allGames.length === 0 ? (
                <div className="no-games">
                    <p>No free games right now.</p>
                    <span className="center">
                        <ManualClaimBtn />
                    </span>
                </div>
            ) : (
                <div>
                    <div className="checkboxes checkboxes-row mb-2">
                        <Checkbox checked={showFutureGames} onChange={e => setShowFutureGames(e.target.checked)} name="Future Games"/>
                        <Checkbox checked={showDesc} onChange={e => setShowDesc(e.target.checked)} name="Descriptions"/>
                    </div>
                    <PlatformFilter visiblePlatforms={visiblePlatforms} onChange={setVisiblePlatforms}/>
                    {filteredGames.length === 0 ? (
                        <p>No games match this filter.</p>
                    ) : (
                        filteredGames.map((game, index) => (
                            <GameCard game={game} showDesc={showDesc} key={index} />
                        ))
                    )}
                </div>
            )}
        </div>
    );
}

export default freeGamesList;