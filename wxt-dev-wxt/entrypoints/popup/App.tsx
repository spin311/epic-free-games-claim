import './App.css';
import OnButton from "@/entrypoints/components/OnButton.tsx";
import {useStorage} from "@/entrypoints/hooks/useStorage.ts";
import GamesList from "@/entrypoints/components/GamesList.tsx";
import {ManualClaimBtn} from "@/entrypoints/components/ManualClaimBtn.tsx";
import {ActiveTabs} from "@/entrypoints/enums/activeTabs.ts";
import Checkbox from "@/entrypoints/components/Checkbox.tsx";


function App() {
    clearBadge();
    const [activeTab, setActiveTab] = useStorage<ActiveTabs>("activeTab", ActiveTabs.MAIN);
    const [counter] = useStorage<number>("counter", 0);
    const [steamCheck, setSteamCheck] = useStorage<boolean>("steamCheck", true);
    const [epicCheck, setEpicCheck] = useStorage<boolean>("epicCheck", true);

    return (
        <div className="App">
            <div className="tabs">
                <button onClick={() => setActiveTab(ActiveTabs.MAIN)} className={activeTab === ActiveTabs.MAIN ? 'active' : ''}>Settings</button>
                <button onClick={() => setActiveTab(ActiveTabs.FREE_GAMES)} className={activeTab === ActiveTabs.FREE_GAMES ? 'active' : ''}>Free Games</button>
            </div>

            {activeTab === ActiveTabs.MAIN && (
                <div className="tab-content">
                    <h1>Free Games for Steam & Epic</h1>
                    <p>Games claimed: {counter}</p>
                    <OnButton/>

                    <div className="inputs">
                        <ManualClaimBtn/>
                        <span>Log in on <a href="https://store.steampowered.com/login/" target="_blank">Steam</a> and <a
                            href="https://www.epicgames.com/id/login"
                            target="_blank">Epic games</a> to get free games</span>
                        <div className="checkboxes">
                            <Checkbox name="Steam" checked={steamCheck} onChange={e => setSteamCheck(e.target.checked)}/>
                            <Checkbox checked={epicCheck} onChange={e => setEpicCheck(e.target.checked)} name="Epic Games"/>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === ActiveTabs.FREE_GAMES && (
                <div className="tab-content">
                    <GamesList />
                </div>
            )}
        </div>
    );

    function clearBadge() {
        browser.action.setBadgeText({ text: "" });
    }
}

export default App;
