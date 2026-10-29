import Checkbox from "@/entrypoints/components/Checkbox.tsx";
import LoginStatus from "@/entrypoints/components/LoginStatus.tsx";
import HealthStatus from "@/entrypoints/components/HealthStatus.tsx";
import { useStorage } from "@/entrypoints/hooks/useStorage.ts";
import { useOptionalAccess } from "@/entrypoints/hooks/useOptionalAccess.ts";
import { LOGIN_STATE_KEYS, LoginState } from "@/entrypoints/utils/loginState.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";
import { StoredWheelPrize } from "@/entrypoints/utils/indieGalaWheel.ts";

function IndieGalaSettings() {
    // Off by default (see spec: IndieGala and Prime Gaming both start disabled
    // on install) — existing installs keep whatever they already had stored.
    const [indieGalaCheck, setIndieGalaCheck] = useStorage<boolean>("indieGalaCheck", false);
    // Off by default, but turning IndieGala on also turns this on (see
    // handleIndieGalaCheckChange) — the user can still opt back out afterward.
    const [indieGalaWheelCheck, setIndieGalaWheelCheck] = useStorage<boolean>("indieGalaWheelCheck", false);
    const [indieGalaWheelLastPrize] = useStorage<StoredWheelPrize | null>("indieGalaWheelLastPrize", null);
    const [indieGalaLoggedIn] = useStorage<LoginState>(LOGIN_STATE_KEYS[Platforms.IndieGala], null);
    const access = useOptionalAccess();
    const isIndieGalaOn = access.isOn("indieGalaCheck", indieGalaCheck);
    const isWheelOn = access.isOn("indieGalaWheelCheck", indieGalaWheelCheck);

    // Turning IndieGala on also turns the wheel sub-setting on, so most users
    // never have to find and enable it separately; turning IndieGala off does
    // not clear it, so re-enabling IndieGala later remembers the choice.
    // The wheel needs the same hosts, so this one request covers both, and
    // it follows only once that access is actually granted.
    function handleIndieGalaCheckChange(checked: boolean) {
        access.setWithAccess("indieGalaCheck", checked, (isOn) => {
            setIndieGalaCheck(isOn);
            if (isOn) setIndieGalaWheelCheck(true);
        });
    }

    return (
        <div className="platform-group">
            <Checkbox name="IndieGala" checked={isIndieGalaOn} onChange={e => handleIndieGalaCheckChange(e.target.checked)}
                      trailing={isIndieGalaOn && <><HealthStatus platform={Platforms.IndieGala}/><LoginStatus state={indieGalaLoggedIn} loginUrl="https://www.indiegala.com/login" platform={Platforms.IndieGala}/></>}/>
            {isIndieGalaOn && (
                <div className="sub-options">
                    <Checkbox name="Wheel of Fortune" checked={isWheelOn}
                              onChange={e => access.setWithAccess("indieGalaWheelCheck", e.target.checked, setIndieGalaWheelCheck)}/>
                    {indieGalaWheelLastPrize && (
                        <p className="hint">
                            Last prize: {indieGalaWheelLastPrize.label}
                            {' '}({new Date(indieGalaWheelLastPrize.wonAt).toLocaleDateString()})
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

export default IndieGalaSettings;
