import './App.css';
import {useEffect, useState} from "react";
import {setBadgeText} from "@/entrypoints/utils/badge.ts";
import {useStorage, useStorageValue} from "@/entrypoints/hooks/useStorage.ts";
import GamesList from "@/entrypoints/components/GamesList.tsx";
import {ActiveTabs} from "@/entrypoints/enums/activeTabs.ts";
import Settings from "@/entrypoints/components/Settings.tsx";
import Footer from "@/entrypoints/components/Footer.tsx";
import SponsorPromo from "@/entrypoints/components/SponsorPromo.tsx";
import ReviewPrompt from "@/entrypoints/components/ReviewPrompt.tsx";

function App() {
    const [activeTab, setActiveTab] = useStorage<ActiveTabs>("activeTab", ActiveTabs.MAIN);
    const claimedCount = useStorageValue<number>("counter") ?? 0;
    const [isReviewPromptVisible, setIsReviewPromptVisible] = useState(false);

    // In an effect, not the render body: a throw here used to take the whole
    // popup down with it, and clearing the badge is a side effect either way.
    useEffect(() => {
        void setBadgeText("");
    }, []);

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
            <ReviewPrompt claimedCount={claimedCount} onVisibleChange={setIsReviewPromptVisible}/>
            {/* One ask at a time. */}
            {!isReviewPromptVisible && <SponsorPromo/>}
            <Footer/>
        </div>
    );
}

export default App;
