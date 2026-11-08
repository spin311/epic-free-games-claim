import {FreeGame} from "@/entrypoints/types/freeGame.ts";
import {Platforms} from "@/entrypoints/enums/platforms.ts";
import {gameDateLabel, platformLabel} from "@/entrypoints/utils/popupText.ts";

const FALLBACK_IMAGE = "/icon/128.png";

// Prime Gaming's mark is Amazon's "collected" (a code may still need
// redeeming); everywhere else it means the game is on the account.
function claimedLabel(game: FreeGame): string {
    return game.platform === Platforms.PrimeGaming ? "✓ Claimed" : "✓ In library";
}

interface GameCardProps {
    game: FreeGame;
}

function GameCard({game}: GameCardProps) {
    const dateLabel = gameDateLabel(game);
    const isFallbackImage = !game.img || game.img === FALLBACK_IMAGE;

    return (
        <a className={`game-card${game.future ? " future" : ""}${game.claimed ? " claimed" : ""}`}
           href={game.link} target="_blank" rel="noopener noreferrer">
            <img className={isFallbackImage ? "is-fallback" : undefined} src={game.img || FALLBACK_IMAGE}
                 alt="" loading="lazy"/>
            <div className="game-body">
                <p className="game-title">{game.title}</p>
                <p className="game-meta">
                    {platformLabel(game)}
                    {!game.future && dateLabel && <> · {dateLabel}</>}
                </p>
                {game.future && <p className="game-upcoming">Upcoming{dateLabel && ` · ${dateLabel}`}</p>}
                {game.claimed && <p className="game-claimed">{claimedLabel(game)}</p>}
                {game.description && <p className="game-description">{game.description}</p>}
            </div>
        </a>
    );
}

export default GameCard;
