import {FreeGame} from "@/entrypoints/types/freeGame.ts";

function GameCard({game, showDesc}: {game: FreeGame, showDesc: boolean}) {
    return (
        <div className={`card${game.future ? " future" : ""}`}>
            <a href={game.link} target="_blank" rel="noopener noreferrer">
                <img src={game.img} alt="game"/>
                <p className="game-title">{game.title}</p>
                <p className="game-platform">Platform: {game.platform}</p>
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