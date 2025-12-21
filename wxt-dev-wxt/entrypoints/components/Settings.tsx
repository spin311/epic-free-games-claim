import {useStorage} from "@/entrypoints/hooks/useStorage.ts";
import OnButton from "@/entrypoints/components/OnButton.tsx";
import {ManualClaimBtn} from "@/entrypoints/components/ManualClaimBtn.tsx";
import Checkbox from "@/entrypoints/components/Checkbox.tsx";
import FrequencySelect from "@/entrypoints/components/FrequencySelect.tsx";
import { ClaimFrequency } from "@/entrypoints/enums/claimFrequency.ts";
import { MessageRequest } from "@/entrypoints/types/messageRequest.ts";

function Settings() {

    const [counter] = useStorage<number>("counter", 0);
    const [steamCheck, setSteamCheck] = useStorage<boolean>("steamCheck", true);
    const [epicCheck, setEpicCheck] = useStorage<boolean>("epicCheck", true);
    const [claimFrequency, setClaimFrequency] = useStorage<ClaimFrequency>("claimFrequency", ClaimFrequency.DAILY);

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
                    <Checkbox name="Steam" checked={steamCheck} onChange={e => setSteamCheck(e.target.checked)}/>
                    <Checkbox checked={epicCheck} onChange={e => setEpicCheck(e.target.checked)} name="Epic Games"/>
                </div>
            </div>
            <span>Free games are automatically claimed based on your selected frequency</span>
        </div>
    );
}

export default Settings;