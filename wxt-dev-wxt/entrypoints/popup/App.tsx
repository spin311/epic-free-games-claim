import './App.css';
import {useStorage} from "@/entrypoints/hooks/useStorage.ts";
import GamesList from "@/entrypoints/components/GamesList.tsx";
import {ActiveTabs} from "@/entrypoints/enums/activeTabs.ts";
import Settings from "@/entrypoints/components/Settings.tsx";
import Footer from "@/entrypoints/components/Footer.tsx";

function App() {
    clearBadge();
    const [activeTab, setActiveTab] = useStorage<ActiveTabs>("activeTab", ActiveTabs.MAIN);

    return (
        <div className="App">
            <div className="tabs">
                <button onClick={() => setActiveTab(ActiveTabs.MAIN)}
                        className={activeTab === ActiveTabs.MAIN ? 'active' : ''}>Settings
                </button>
                <button onClick={() => setActiveTab(ActiveTabs.FREE_GAMES)}
                        className={activeTab === ActiveTabs.FREE_GAMES ? 'active' : ''}>Free Games
                </button>
            </div>
            {activeTab === ActiveTabs.MAIN && (
                <Settings/>
            )}

            {activeTab === ActiveTabs.FREE_GAMES && (
                <div className="tab-content">
                    <GamesList/>
                </div>
            )}
            <Footer/>
        </div>
    );

    function clearBadge() {
        browser.action.setBadgeText({ text: "" });
    }
}

export default App;
