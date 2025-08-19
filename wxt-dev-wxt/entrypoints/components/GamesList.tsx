import GameCard from "@/entrypoints/components/GameCard.tsx";

function GamesList({ games }: { games: FreeGame[] }): JSX.Element {
    return (
        <div>
            {!games || games.length === 0 ? (
                <div className="no-games">
                    <p>No free games available at the moment. Manually claim games so they appear here.</p>
                </div>
            ) : (
                <div>
                    {games.map((game, index) => (
                        <GameCard game={game} key={index} />
                    ))}
                </div>
            )}
        </div>
    );
}

export default GamesList;