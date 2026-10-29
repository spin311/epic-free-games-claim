import Checkbox from "@/entrypoints/components/Checkbox.tsx";
import LoginStatus from "@/entrypoints/components/LoginStatus.tsx";
import HealthStatus from "@/entrypoints/components/HealthStatus.tsx";
import { useStorage } from "@/entrypoints/hooks/useStorage.ts";
import { LOGIN_STATE_KEYS, LoginState } from "@/entrypoints/utils/loginState.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";

// Confirmed live: the plain login page sends an already signed-in user to
// their account page, where no content script runs. Redirected to the store,
// epic.content.ts sees the session and records it (which also lifts the
// background's "signed out" pause on claiming).
const EPIC_LOGIN_URL = "https://www.epicgames.com/id/login?redirectUrl=https%3A%2F%2Fstore.epicgames.com%2Fen-US%2F";

function EpicSettings() {
    const [epicCheck, setEpicCheck] = useStorage<boolean>("epicCheck", true);
    const [epicLoggedIn] = useStorage<LoginState>(LOGIN_STATE_KEYS[Platforms.Epic], null);

    return (
        <div className="platform-group">
            <Checkbox name="Epic Games" checked={epicCheck} onChange={e => setEpicCheck(e.target.checked)}
                      trailing={epicCheck && <><HealthStatus platform={Platforms.Epic}/><LoginStatus state={epicLoggedIn} loginUrl={EPIC_LOGIN_URL} platform={Platforms.Epic}/></>}/>
        </div>
    );
}

export default EpicSettings;
