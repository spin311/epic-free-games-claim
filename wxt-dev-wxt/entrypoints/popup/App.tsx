import './App.css';
import {useEffect} from "react";
import {setBadgeText} from "@/entrypoints/utils/badge.ts";
import {useStorage} from "@/entrypoints/hooks/useStorage.ts";
import GamesList from "@/entrypoints/components/GamesList.tsx";
import {ActiveTabs} from "@/entrypoints/enums/activeTabs.ts";
import Settings from "@/entrypoints/components/Settings.tsx";
import Footer from "@/entrypoints/components/Footer.tsx";
import PopupHeader from "@/entrypoints/components/PopupHeader.tsx";
import ReviewPrompt from "@/entrypoints/components/ReviewPrompt.tsx";
import SponsorMilestonePrompt from "@/entrypoints/components/SponsorMilestonePrompt.tsx";
import {usePromptChoice} from "@/entrypoints/hooks/usePromptChoice.ts";
import {t} from "@/entrypoints/utils/i18n.ts";

function App() {
    const [activeTab, setActiveTab] = useStorage<ActiveTabs>("activeTab", ActiveTabs.MAIN);
    const {choice, claimedCount, answered} = usePromptChoice();

    // In an effect, not the render body: a throw here used to take the whole
    // popup down with it, and clearing the badge is a side effect either way.
    useEffect(() => {
        void setBadgeText("");
    }, []);

    return (
        <div className="App">
            {/* choice is undefined until storage is read. One ask at a time: no
                Sponsor pill while a card shows or before the choice is known. */}
            <PopupHeader isReady={choice !== undefined} showSponsor={choice === null}/>
            {choice === 'review' && <ReviewPrompt claimedCount={claimedCount} onAnswered={answered}/>}
            {choice === 'sponsor' && <SponsorMilestonePrompt claimedCount={claimedCount} onAnswered={answered}/>}
            <nav className="tabs" aria-label={t("tabsLabel")}>
                <button type="button" onClick={() => setActiveTab(ActiveTabs.MAIN)}
                        className={activeTab === ActiveTabs.MAIN ? 'active' : ''}
                        aria-current={activeTab === ActiveTabs.MAIN ? 'page' : undefined}>{t("settingsTab")}
                </button>
                <button type="button" onClick={() => setActiveTab(ActiveTabs.FREE_GAMES)}
                        className={activeTab === ActiveTabs.FREE_GAMES ? 'active' : ''}
                        aria-current={activeTab === ActiveTabs.FREE_GAMES ? 'page' : undefined}>{t("freeGamesTab")}
                </button>
            </nav>
            {activeTab === ActiveTabs.MAIN && <Settings/>}
            {activeTab === ActiveTabs.FREE_GAMES && <GamesList/>}
            <Footer/>
        </div>
    );
}

export default App;
