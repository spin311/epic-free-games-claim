import {FreeGame} from "@/entrypoints/types/freeGame.ts";

function GameCard({game}: {game: FreeGame}) {
    return (
        <div className="card">
            <a href={game.link} target="_blank" rel="noopener noreferrer">
                <img src={game.img} alt="game"/>
                <p className="game-title">{game.title}</p>
                <p className="game-platform">Platform: {game.platform}</p>
            </a>

        </div>
    )

}

export default GameCard;