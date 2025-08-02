import './App.css';
import OnButton from "@/entrypoints/components/OnButton.tsx";
import {Days, daysArray} from "@/entrypoints/enums/days.ts";
import {useStorage} from "@/entrypoints/hooks/useStorage.ts";
import {MessageRequest} from "@/entrypoints/types/messageRequest.ts"
import GamesList from "@/entrypoints/components/GamesList.tsx";

function App() {
    const [day, setDay] = useStorage<Days>("day" ,Days.Friday);
    const [counter, setCounter] = useStorage<number>("counter", 0);
    const [freeGames, setFreeGames] = useStorage<FreeGame[]>("freeGames", []);
    const [steamCheck, setSteamCheck] = useStorage<boolean>("steamCheck", true);
    const [epicCheck, setEpicCheck] = useStorage<boolean>("epicCheck", true);

    console.log("freeGames from storage:", freeGames);

    return (
        <div className="App">
            <h1>Epic Free games claim</h1>
            <p>Games claimed counter: {counter}</p>
            <OnButton/>

            {/*<GamesList games={freeGames}/>*/}

            <div className="inputs">
                <button
                    className="manual-btn"
                    onClick={claimGames}
                >Manually claim</button>
                
                <div className="platform-select">
                    <span>
                        <input
                            type="checkbox"
                            id="steam-checkbox"
                            checked={steamCheck}
                            onChange={e => setSteamCheck(e.target.checked)}
                        />
                        <label htmlFor="steam-checkbox">Get games from <a href=""></a>Steam</label>
                    </span>
                    <span>
                        <input
                            type="checkbox"
                            id='epic-checkbox'
                            checked={epicCheck}
                            onChange={e => setEpicCheck(e.target.checked)}
                        />
                        <label htmlFor="epic-checkbox">Get games from Epic Games</label>
                    </span>
                </div>
                <span className="day-select">
                <label htmlFor="day">Claim free games every: </label>
                <select
                    id="day"
                    value={day}
                    onChange={e => setDay(e.target.value)}
                >
                    {daysArray.map(day => {
                        return <option value={day} key={day}>{day}</option>
                    })}
                </select>
            </span>
            </div>
        </div>
    );

    function sendMessage(request: MessageRequest) {
        browser.runtime.sendMessage(request);
    }

    function claimGames() {
        sendMessage({action: 'claim', target: 'background'});
    }


}

export default App;