import './App.css';
import { useState } from 'react';
import OnButton from "@/entrypoints/components/OnButton.tsx";
import { Days, daysArray } from "@/entrypoints/enums/days.ts";
import { useStorage } from "@/entrypoints/hooks/useStorage.ts";
import { MessageRequest } from "@/entrypoints/types/messageRequest.ts";
import GamesList from "@/entrypoints/components/GamesList.tsx";

function App() {
    const [activeTab, setActiveTab] = useState<'main' | 'games'>('main');
    const [day, setDay] = useStorage<Days>("day", Days.Friday);
    const [counter] = useStorage<number>("counter", 0);
    const [freeGames] = useStorage<FreeGame[]>("freeGames", []);
    const [steamCheck, setSteamCheck] = useStorage<boolean>("steamCheck", true);
    const [epicCheck, setEpicCheck] = useStorage<boolean>("epicCheck", true);

    return (
        <div className="App">
            <div className="tabs">
                <button onClick={() => setActiveTab('main')} className={activeTab === 'main' ? 'active' : ''}>Settings</button>
                <button onClick={() => setActiveTab('games')} className={activeTab === 'games' ? 'active' : ''}>Free Games</button>
            </div>

            {activeTab === 'main' && (
                <div className="tab-content">
                    <h1>Free Games for Steam & Epic</h1>
                    <p>Games claimed: {counter}</p>
                    <OnButton />

                    <div className="inputs">
                        <button className="manual-btn" onClick={claimGames}>Manually claim</button>
                            <span>Log in on <a href="https://store.steampowered.com/login/" target="_blank">Steam</a> and <a
                                href="https://www.epicgames.com/id/login" target="_blank">Epic games</a> to get free games</span>
                        <div className="platform-select">
                            <span>
                                <input
                                    type="checkbox"
                                    id="steam-checkbox"
                                    checked={steamCheck}
                                    onChange={e => setSteamCheck(e.target.checked)}
                                />
                                <label htmlFor="steam-checkbox">Steam</label>
                            </span>
                            <span>
                                <input
                                    type="checkbox"
                                    id="epic-checkbox"
                                    checked={epicCheck}
                                    onChange={e => setEpicCheck(e.target.checked)}
                                />
                                <label htmlFor="epic-checkbox">Epic Games</label>
                            </span>
                        </div>
                        <span className="day-select">
                            <label htmlFor="day">Claim games automatically every: </label>
                            <select
                                id="day"
                                value={day}
                                onChange={e => setDay(e.target.value as Days)}
                            >
                                {daysArray.map(day => (
                                    <option value={day} key={day}>{day}</option>
                                ))}
                            </select>
                        </span>
                    </div>
                </div>
            )}

            {activeTab === 'games' && (
                <div className="tab-content">
                    <GamesList games={freeGames} />
                </div>
            )}
        </div>
    );

    function sendMessage(request: MessageRequest) {
        browser.runtime.sendMessage(request);
    }

    function claimGames() {
        sendMessage({ action: 'claim', target: 'background' });
    }
}

export default App;
