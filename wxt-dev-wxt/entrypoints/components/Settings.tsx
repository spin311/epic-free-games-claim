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
    const [claimFrequency, setClaimFrequency] = useStorage<ClaimFrequency>("claimFrequency", ClaimFrequency.DAILY);
    // Written by the store content scripts on each claim run; null until one has run.
    const [steamLoggedIn] = useStorage<LoginState>(LOGIN_STATE_KEYS[Platforms.Steam], null);
    const [epicLoggedIn] = useStorage<LoginState>(LOGIN_STATE_KEYS[Platforms.Epic], null);
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
            <h1>Free Games for Steam & Epic</h1>
            <p>Games claimed: {counter}</p>
            <OnButton/>

            <div className="inputs">
                <ManualClaimBtn/>
                <span>Log in on <a href="https://store.steampowered.com/login/" target="_blank">Steam</a> and <a
                    href="https://www.epicgames.com/id/login"
                    target="_blank">Epic games</a> to get free games</span>
                <FrequencySelect value={claimFrequency} onChange={handleFrequencyChange} />
                <div className="checkboxes">
                    <Checkbox name="Steam" checked={steamCheck} onChange={e => setSteamCheck(e.target.checked)}
                              trailing={<LoginStatus state={steamLoggedIn}/>}/>
                    <ReviewThreshold value={minPositivePercent} onChange={setMinPositivePercent}
                                     disabled={!steamCheck}/>
                    <Checkbox name="Epic Games" checked={epicCheck} onChange={e => setEpicCheck(e.target.checked)}
                              trailing={<LoginStatus state={epicLoggedIn}/>}/>
                </div>
            </div>
            <span>Free games are automatically claimed based on your selected frequency</span>
        </div>
    );
}

export default Settings;