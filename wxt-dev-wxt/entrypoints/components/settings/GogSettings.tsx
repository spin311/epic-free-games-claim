import Checkbox from "@/entrypoints/components/Checkbox.tsx";
import LoginStatus from "@/entrypoints/components/LoginStatus.tsx";
import HealthStatus from "@/entrypoints/components/HealthStatus.tsx";
import { useStorage, useStorageValue } from "@/entrypoints/hooks/useStorage.ts";
import { useOptionalAccess } from "@/entrypoints/hooks/useOptionalAccess.ts";
import { LOGIN_STATE_KEYS, LoginState } from "@/entrypoints/utils/loginState.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";

function GogSettings() {
    // Off by default, and shows (and runs) only once gog.com access is granted.
    const [gogCheck, setGogCheck] = useStorage<boolean>("gogCheck", false);
    // Live and read-only: a store visit can record it while the popup is open.
    const gogLoggedIn = useStorageValue<LoginState>(LOGIN_STATE_KEYS[Platforms.GOG]);
    const access = useOptionalAccess();
    const isGogOn = access.isOn("gogCheck", gogCheck);

    return (
        <div className="platform-group">
            <Checkbox name="GOG" checked={isGogOn} onChange={e => access.setWithAccess("gogCheck", e.target.checked, setGogCheck)}
                      trailing={isGogOn && <><HealthStatus platform={Platforms.GOG}/><LoginStatus state={gogLoggedIn} loginUrl="https://www.gog.com/en" platform={Platforms.GOG}/></>}/>
        </div>
    );
}

export default GogSettings;
