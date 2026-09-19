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
import { StoredWheelPrize } from "@/entrypoints/utils/indieGalaWheel.ts";
import { EXTERNAL_PLATFORM_STORAGE_KEYS } from "@/entrypoints/utils/primeGamingGiveaway.ts";

function Settings() {

    const [counter] = useStorage<number>("counter", 0);
    const [steamCheck, setSteamCheck] = useStorage<boolean>("steamCheck", true);
    const [epicCheck, setEpicCheck] = useStorage<boolean>("epicCheck", true);
    const [gogCheck, setGogCheck] = useStorage<boolean>("gogCheck", true);
    const [indieGalaCheck, setIndieGalaCheck] = useStorage<boolean>("indieGalaCheck", true);
    // Off by default, but turning IndieGala on also turns this on (see
    // handleIndieGalaCheckChange) — the user can still opt back out afterward.
    const [indieGalaWheelCheck, setIndieGalaWheelCheck] = useStorage<boolean>("indieGalaWheelCheck", false);
    const [indieGalaWheelLastPrize] = useStorage<StoredWheelPrize | null>("indieGalaWheelLastPrize", null);
    const [primeGamingCheck, setPrimeGamingCheck] = useStorage<boolean>("primeGamingCheck", true);
    // Off by default and not auto-cascaded from primeGamingCheck (unlike the
    // IndieGala wheel) — claiming these means navigating to that store's own
    // account and possibly its account-linking flow, so it's a deliberate opt-in.
    const [claimEpic, setClaimEpic] = useStorage<boolean>(EXTERNAL_PLATFORM_STORAGE_KEYS.Epic, false);
    const [claimGog, setClaimGog] = useStorage<boolean>(EXTERNAL_PLATFORM_STORAGE_KEYS.GOG, false);
    const [claimWindows, setClaimWindows] = useStorage<boolean>(EXTERNAL_PLATFORM_STORAGE_KEYS.Windows, false);
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

    // Turning IndieGala on also turns the wheel sub-setting on, so most users
    // never have to find and enable it separately; turning IndieGala off does
    // not clear it, so re-enabling IndieGala later remembers the choice.
    function handleIndieGalaCheckChange(checked: boolean) {
        setIndieGalaCheck(checked);
        if (checked) setIndieGalaWheelCheck(true);
    }

    function sendMessage(request: MessageRequest) {
        browser.runtime.sendMessage(request);
    }

    return (
        <div className="tab-content">
            <h1>Free Games for Steam, Epic, GOG, IndieGala & Prime Gaming</h1>
            <p>Games claimed: {counter}</p>
            {indieGalaWheelLastPrize && (
                <p>
                    IndieGala wheel last prize: {indieGalaWheelLastPrize.label}
                    {' '}({new Date(indieGalaWheelLastPrize.wonAt).toLocaleDateString()})
                </p>
            )}
            <OnButton/>

            <div className="inputs">
                <ManualClaimBtn/>
                <span>Log in on <a href="https://store.steampowered.com/login/" target="_blank">Steam</a>, <a
                    href="https://www.epicgames.com/id/login"
                    target="_blank">Epic games</a>, <a href="https://www.gog.com/en"
                    target="_blank">GOG</a>, <a href="https://www.indiegala.com/login"
                    target="_blank">IndieGala</a> and <a href="https://gaming.amazon.com/home"
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
                    <Checkbox name="IndieGala" checked={indieGalaCheck} onChange={e => handleIndieGalaCheckChange(e.target.checked)}
                              trailing={<LoginStatus state={indieGalaLoggedIn}/>}/>
                    <div className="nested-checkbox">
                        <Checkbox name="Wheel of Fortune" checked={indieGalaWheelCheck}
                                  onChange={e => setIndieGalaWheelCheck(e.target.checked)}
                                  disabled={!indieGalaCheck}/>
                    </div>
                    <Checkbox name="Prime Gaming" checked={primeGamingCheck} onChange={e => setPrimeGamingCheck(e.target.checked)}
                              trailing={<LoginStatus state={primeGamingLoggedIn}/>}/>
                    <div className="nested-checkbox">
                        <Checkbox name="Claim Epic-linked offers" checked={claimEpic}
                                  onChange={e => setClaimEpic(e.target.checked)}
                                  disabled={!primeGamingCheck}/>
                    </div>
                    <div className="nested-checkbox">
                        <Checkbox name="Claim GOG-linked offers" checked={claimGog}
                                  onChange={e => setClaimGog(e.target.checked)}
                                  disabled={!primeGamingCheck}/>
                    </div>
                    <div className="nested-checkbox">
                        <Checkbox name="Claim Windows-linked offers" checked={claimWindows}
                                  onChange={e => setClaimWindows(e.target.checked)}
                                  disabled={!primeGamingCheck}/>
                    </div>
                </div>
            </div>
            <span>Free games are automatically claimed based on your selected frequency</span>
        </div>
    );
}

export default Settings;