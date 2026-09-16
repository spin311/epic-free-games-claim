import {useStorage} from "@/entrypoints/hooks/useStorage.ts";
import OnButton from "@/entrypoints/components/OnButton.tsx";
import {ManualClaimBtn} from "@/entrypoints/components/ManualClaimBtn.tsx";
import Checkbox from "@/entrypoints/components/Checkbox.tsx";
import LoginStatus from "@/entrypoints/components/LoginStatus.tsx";
import ReviewThreshold from "@/entrypoints/components/ReviewThreshold.tsx";
import FrequencySelect from "@/entrypoints/components/FrequencySelect.tsx";
import { ClaimFrequency } from "@/entrypoints/enums/claimFrequency.ts";
import { MessageRequest } from "@/entrypoints/types/messageRequest.ts";
import { LOGIN_STATE_KEYS, LoginState } from "@/entrypoints/utils/loginState.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";

function Settings() {

    const [counter] = useStorage<number>("counter", 0);
    const [steamCheck, setSteamCheck] = useStorage<boolean>("steamCheck", true);
    const [epicCheck, setEpicCheck] = useStorage<boolean>("epicCheck", true);
    const [gogCheck, setGogCheck] = useStorage<boolean>("gogCheck", true);
    const [indieGalaCheck, setIndieGalaCheck] = useStorage<boolean>("indieGalaCheck", true);
    const [primeGamingCheck, setPrimeGamingCheck] = useStorage<boolean>("primeGamingCheck", true);
    const [claimFrequency, setClaimFrequency] = useStorage<ClaimFrequency>("claimFrequency", ClaimFrequency.DAILY);
    // Written by the store content scripts on each claim run; null until one has run.
    const [steamLoggedIn] = useStorage<LoginState>(LOGIN_STATE_KEYS[Platforms.Steam], null);
    const [epicLoggedIn] = useStorage<LoginState>(LOGIN_STATE_KEYS[Platforms.Epic], null);
    const [gogLoggedIn] = useStorage<LoginState>(LOGIN_STATE_KEYS[Platforms.GOG], null);
    const [indieGalaLoggedIn] = useStorage<LoginState>(LOGIN_STATE_KEYS[Platforms.IndieGala], null);
    const [primeGamingLoggedIn] = useStorage<LoginState>(LOGIN_STATE_KEYS[Platforms.PrimeGaming], null);
    // Blank (null) means no review gate — claim every free Steam game.
    const [minPositivePercent, setMinPositivePercent] = useStorage<number | null>("steamMinPositivePercent", null);

    function handleFrequencyChange(frequency: ClaimFrequency) {
        setClaimFrequency(frequency);
        sendMessage({ action: "updateFrequency", target: "background" });
    }

    function sendMessage(request: MessageRequest) {
        browser.runtime.sendMessage(request);
    }

    return (
        <div className="tab-content">
            <h1>Free Games for Steam, Epic & GOG</h1>
            <p>Games claimed: {counter}</p>
            <OnButton/>

            <div className="inputs">
                <ManualClaimBtn/>
                <span>Log in on <a href="https://store.steampowered.com/login/" target="_blank">Steam</a>, <a
                    href="https://www.epicgames.com/id/login"
                    target="_blank">Epic games</a>, <a href="https://www.gog.com/en"
                    target="_blank">GOG</a>, <a href="https://www.indiegala.com/login"
                    target="_blank">IndieGala</a> and <a href="https://www.amazon.com/ap/signin"
                    target="_blank">Amazon</a> to get free games</span>
                <FrequencySelect value={claimFrequency} onChange={handleFrequencyChange} />
                <div className="checkboxes">
                    <Checkbox name="Steam" checked={steamCheck} onChange={e => setSteamCheck(e.target.checked)}
                              trailing={<LoginStatus state={steamLoggedIn}/>}/>
                    <ReviewThreshold value={minPositivePercent} onChange={setMinPositivePercent}
                                     disabled={!steamCheck}/>
                    <Checkbox name="Epic Games" checked={epicCheck} onChange={e => setEpicCheck(e.target.checked)}
                              trailing={<LoginStatus state={epicLoggedIn}/>}/>
                    <Checkbox name="GOG" checked={gogCheck} onChange={e => setGogCheck(e.target.checked)}
                              trailing={<LoginStatus state={gogLoggedIn}/>}/>
                    <Checkbox name="IndieGala" checked={indieGalaCheck} onChange={e => setIndieGalaCheck(e.target.checked)}
                              trailing={<LoginStatus state={indieGalaLoggedIn}/>}/>
                    <Checkbox name="Prime Gaming" checked={primeGamingCheck} onChange={e => setPrimeGamingCheck(e.target.checked)}
                              trailing={<LoginStatus state={primeGamingLoggedIn}/>}/>
                </div>
            </div>
            <span>Free games are automatically claimed based on your selected frequency</span>
        </div>
    );
}

export default Settings;