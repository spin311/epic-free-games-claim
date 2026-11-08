import {setStorageItem, useStorage} from "@/entrypoints/hooks/useStorage.ts";
import AutoClaimSwitch from "@/entrypoints/components/AutoClaimSwitch.tsx";
import FrequencySelect from "@/entrypoints/components/FrequencySelect.tsx";
import SteamSettings from "@/entrypoints/components/settings/SteamSettings.tsx";
import EpicSettings from "@/entrypoints/components/settings/EpicSettings.tsx";
import GogSettings from "@/entrypoints/components/settings/GogSettings.tsx";
import IndieGalaSettings from "@/entrypoints/components/settings/IndieGalaSettings.tsx";
import PrimeGamingSettings from "@/entrypoints/components/settings/PrimeGamingSettings.tsx";
import { ClaimFrequency } from "@/entrypoints/enums/claimFrequency.ts";
import { MessageRequest } from "@/entrypoints/types/messageRequest.ts";

function Settings() {
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
            <section className="group">
                <AutoClaimSwitch/>
                <FrequencySelect value={claimFrequency} onChange={handleFrequencyChange}
                                 claimHour={claimHour} onClaimHourChange={handleClaimHourChange} />
            </section>

            <section className="group" aria-label="Stores">
                <SteamSettings/>
                <EpicSettings/>
                <GogSettings/>
                <IndieGalaSettings/>
                <PrimeGamingSettings/>
            </section>
        </div>
    );
}

export default Settings;
