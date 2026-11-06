import {FreeGame} from "@/entrypoints/types/freeGame.ts";
import {Platforms} from "@/entrypoints/enums/platforms.ts";

// Prime Gaming's mark is Amazon's "collected" (a code may still need
// redeeming); everywhere else it means the game is on the account.
function claimedLabel(game: FreeGame): string {
    return game.platform === Platforms.PrimeGaming ? "✓ Claimed" : "✓ In library";
}

function GameCard({game, showDesc}: {game: FreeGame, showDesc: boolean}) {
    return (
        <div className={`card${game.future ? " future" : ""}${game.claimed ? " claimed" : ""}`}>
            <a href={game.link} target="_blank" rel="noopener noreferrer">
                <img src={game.img} alt="game"/>
                <p className="game-title">{game.title}</p>
                <p className="game-platform">Platform: {game.platform}{game.store && ` · ${game.store}`}</p>
                {game.claimed && <p className="game-claimed">{claimedLabel(game)}</p>}
                {(game.description && showDesc) && (
                    <p className="game-description">{game.description}</p>
                )}
                    {game.startDate && (
                        <p className="game-date date-start">
                            Start: {new Date(game.startDate).toLocaleDateString()}
                        </p>
                    )}
                {game.endDate && (
                    <p className="game-date date-end">
                        End: {new Date(game.endDate).toLocaleDateString()}
                    </p>
                )}
            </a>
        </div>
    )
}

export default GameCard;