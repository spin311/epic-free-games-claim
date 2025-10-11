import GameCard from "@/entrypoints/components/GameCard.tsx";
import {ManualClaimBtn} from "@/entrypoints/components/ManualClaimBtn.tsx";
import {useStorage} from "@/entrypoints/hooks/useStorage.ts";
import {FreeGame} from "@/entrypoints/types/freeGame.ts";
import Checkbox from "@/entrypoints/components/Checkbox.tsx";

function freeGamesList() {
    const [freeGames] = useStorage<FreeGame[]>("freeGames", []);
    const [futureGames] = useStorage<FreeGame[]>("futureGames", []);
    const [showFutureGames, setShowFutureGames] = useStorage<boolean>("showFutureGames", true);
    const [showDesc, setShowDesc] = useStorage<boolean>("showDesc", true);
    const allGames = showFutureGames ? [...freeGames, ...futureGames] : freeGames;
    
    
    return (
        <div>
            <div className="checkboxes checkboxes-row mb-2">
            <Checkbox checked={showFutureGames} onChange={e => setShowFutureGames(e.target.checked)} name="Future Games"/>
            <Checkbox checked={showDesc} onChange={e => setShowDesc(e.target.checked)} name="Descriptions"/>
            </div>
            {!allGames || allGames.length === 0 ? (
                <div className="no-games">
                    <p>No free games available at the moment. Manually claim games so they appear here.</p>
                    <span className="center">
                        <ManualClaimBtn />
                    </span>
                </div>
            ) : (
                <div>
                    {allGames.map((game, index) => (
                        <GameCard game={game} showDesc={showDesc} key={index} />
                    ))}
                </div>
            )}
        </div>
    );
}

export default freeGamesList;