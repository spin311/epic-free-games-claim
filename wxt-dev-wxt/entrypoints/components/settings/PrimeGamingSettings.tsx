import Checkbox from "@/entrypoints/components/Checkbox.tsx";
import LoginStatus from "@/entrypoints/components/LoginStatus.tsx";
import { useStorage } from "@/entrypoints/hooks/useStorage.ts";
import { LOGIN_STATE_KEYS, LoginState } from "@/entrypoints/utils/loginState.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";
import { EXTERNAL_PLATFORM_STORAGE_KEYS } from "@/entrypoints/utils/primeGamingGiveaway.ts";

function PrimeGamingSettings() {
    // Off by default (see spec: IndieGala and Prime Gaming both start disabled
    // on install) — existing installs keep whatever they already had stored.
    const [primeGamingCheck, setPrimeGamingCheck] = useStorage<boolean>("primeGamingCheck", false);
    // Off by default and not auto-cascaded from primeGamingCheck (unlike the
    // IndieGala wheel) — claiming these means navigating to that store's own
    // account and possibly its account-linking flow, so it's a deliberate opt-in.
    const [claimEpic, setClaimEpic] = useStorage<boolean>(EXTERNAL_PLATFORM_STORAGE_KEYS.Epic, false);
    const [claimGog, setClaimGog] = useStorage<boolean>(EXTERNAL_PLATFORM_STORAGE_KEYS.GOG, false);
    const [claimWindows, setClaimWindows] = useStorage<boolean>(EXTERNAL_PLATFORM_STORAGE_KEYS.Windows, false);
    const [primeGamingLoggedIn] = useStorage<LoginState>(LOGIN_STATE_KEYS[Platforms.PrimeGaming], null);

    return (
        <div className="platform-group">
            <Checkbox name="Prime Gaming" checked={primeGamingCheck} onChange={e => setPrimeGamingCheck(e.target.checked)}
                      trailing={primeGamingCheck && <LoginStatus state={primeGamingLoggedIn} loginUrl="https://gaming.amazon.com/home" platform={Platforms.PrimeGaming}/>}/>
            {primeGamingCheck && (
                <div className="sub-options">
                    <p className="hint">Also claim offers linked to:</p>
                    <Checkbox name="Epic-linked offers" checked={claimEpic}
                              onChange={e => setClaimEpic(e.target.checked)}/>
                    <Checkbox name="GOG-linked offers" checked={claimGog}
                              onChange={e => setClaimGog(e.target.checked)}/>
                    <Checkbox name="Windows-linked offers" checked={claimWindows}
                              onChange={e => setClaimWindows(e.target.checked)}/>
                </div>
            )}
        </div>
    );
}

export default PrimeGamingSettings;
