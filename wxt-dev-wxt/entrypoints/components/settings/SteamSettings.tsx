import Checkbox from "@/entrypoints/components/Checkbox.tsx";
import LoginStatus from "@/entrypoints/components/LoginStatus.tsx";
import HealthStatus from "@/entrypoints/components/HealthStatus.tsx";
import ReviewThreshold from "@/entrypoints/components/ReviewThreshold.tsx";
import { useStorage, useStorageValue } from "@/entrypoints/hooks/useStorage.ts";
import { LOGIN_STATE_KEYS, LoginState } from "@/entrypoints/utils/loginState.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";

function SteamSettings() {
    const [steamCheck, setSteamCheck] = useStorage<boolean>("steamCheck", true);
    // Live and read-only: a store visit can record it while the popup is open.
    const steamLoggedIn = useStorageValue<LoginState>(LOGIN_STATE_KEYS[Platforms.Steam]);
    // Blank (null) means no review gate — claim every free Steam game.
    const [minPositivePercent, setMinPositivePercent] = useStorage<number | null>("steamMinPositivePercent", null);

    return (
        <div className="platform-group">
            <Checkbox name="Steam" checked={steamCheck} onChange={e => setSteamCheck(e.target.checked)}
                      trailing={steamCheck && <><HealthStatus platform={Platforms.Steam}/><LoginStatus state={steamLoggedIn} loginUrl="https://store.steampowered.com/login/" platform={Platforms.Steam}/></>}/>
            {steamCheck && (
                <div className="sub-options">
                    <ReviewThreshold value={minPositivePercent} onChange={setMinPositivePercent}/>
                </div>
            )}
        </div>
    );
}

export default SteamSettings;
