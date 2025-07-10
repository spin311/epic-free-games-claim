import GameCard from "@/entrypoints/components/GameCard.tsx";

function GamesList({ games }: { games: FreeGame[] }): JSX.Element {
    return (
        <div>
            {games.map((game, index) => (
                <GameCard game={game} key={index} />
            ))}
        </div>
    );
}

export default GamesList;