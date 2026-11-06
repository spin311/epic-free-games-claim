import {setStorageItem, useStorage, useStorageValue} from "@/entrypoints/hooks/useStorage.ts";
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

    // Read-only: claim tabs count up while the popup is open, and a write-back
    // of what the popup read could undo that.
    const counter = useStorageValue<number>("counter") ?? 0;
    const [isClaiming] = useStorage<boolean>("isClaiming", false);
    const [claimFrequency, setClaimFrequency] = useStorage<ClaimFrequency>("claimFrequency", ClaimFrequency.DAILY);
    const [claimHour, setClaimHour] = useStorage<number | null>("claimHour", null);

    // Stored before the background is told, so it reschedules from the new
    // value rather than the one the popup hasn't written yet.
    async function handleFrequencyChange(frequency: ClaimFrequency) {
        setClaimFrequency(frequency);
        await setStorageItem("claimFrequency", frequency);
        sendMessage({ action: "updateFrequency", target: "background" });
    }

    async function handleClaimHourChange(hour: number | null) {
        setClaimHour(hour);
        await setStorageItem("claimHour", hour);
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
                <FrequencySelect value={claimFrequency} onChange={handleFrequencyChange}
                                 claimHour={claimHour} onClaimHourChange={handleClaimHourChange} />
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
