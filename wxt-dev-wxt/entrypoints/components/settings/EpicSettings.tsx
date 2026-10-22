import Checkbox from "@/entrypoints/components/Checkbox.tsx";
import LoginStatus from "@/entrypoints/components/LoginStatus.tsx";
import { useStorage } from "@/entrypoints/hooks/useStorage.ts";
import { LOGIN_STATE_KEYS, LoginState } from "@/entrypoints/utils/loginState.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";

function EpicSettings() {
    const [epicCheck, setEpicCheck] = useStorage<boolean>("epicCheck", true);
    const [epicLoggedIn] = useStorage<LoginState>(LOGIN_STATE_KEYS[Platforms.Epic], null);

    return (
        <div className="platform-group">
            <Checkbox name="Epic Games" checked={epicCheck} onChange={e => setEpicCheck(e.target.checked)}
                      trailing={epicCheck && <LoginStatus state={epicLoggedIn} loginUrl="https://www.epicgames.com/id/login" platform={Platforms.Epic}/>}/>
        </div>
    );
}

export default EpicSettings;
