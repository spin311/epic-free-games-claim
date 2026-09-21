import {useStorage} from "@/entrypoints/hooks/useStorage.ts";
import OnButton from "@/entrypoints/components/OnButton.tsx";
import {ManualClaimBtn} from "@/entrypoints/components/ManualClaimBtn.tsx";
import FrequencySelect from "@/entrypoints/components/FrequencySelect.tsx";
import SteamSettings from "@/entrypoints/components/settings/SteamSettings.tsx";
import EpicSettings from "@/entrypoints/components/settings/EpicSettings.tsx";
import GogSettings from "@/entrypoints/components/settings/GogSettings.tsx";
import IndieGalaSettings from "@/entrypoints/components/settings/IndieGalaSettings.tsx";
import PrimeGamingSettings from "@/entrypoints/components/settings/PrimeGamingSettings.tsx";
import { ClaimFrequency } from "@/entrypoints/enums/claimFrequency.ts";
import { MessageRequest } from "@/entrypoints/types/messageRequest.ts";

function Settings() {

    const [counter] = useStorage<number>("counter", 0);
    const [isClaiming] = useStorage<boolean>("isClaiming", false);
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
            <p>Games claimed: {counter}</p>
            {isClaiming && <p className="claiming-status">⏳ Claiming free games…</p>}
            <OnButton/>

            <div className="inputs">
                <ManualClaimBtn/>
                <FrequencySelect value={claimFrequency} onChange={handleFrequencyChange} />
                <div className="checkboxes">
                    <SteamSettings/>
                    <EpicSettings/>
                    <GogSettings/>
                    <IndieGalaSettings/>
                    <PrimeGamingSettings/>
                </div>
            </div>
        </div>
    );
}

export default Settings;
