import Checkbox from "@/entrypoints/components/Checkbox.tsx";
import LoginStatus from "@/entrypoints/components/LoginStatus.tsx";
import { useStorage } from "@/entrypoints/hooks/useStorage.ts";
import { LOGIN_STATE_KEYS, LoginState } from "@/entrypoints/utils/loginState.ts";
import { Platforms } from "@/entrypoints/enums/platforms.ts";

function GogSettings() {
    const [gogCheck, setGogCheck] = useStorage<boolean>("gogCheck", true);
    const [gogLoggedIn] = useStorage<LoginState>(LOGIN_STATE_KEYS[Platforms.GOG], null);

    return (
        <div className="platform-group">
            <Checkbox name="GOG" checked={gogCheck} onChange={e => setGogCheck(e.target.checked)}
                      trailing={gogCheck && <LoginStatus state={gogLoggedIn} loginUrl="https://www.gog.com/en" platform={Platforms.GOG}/>}/>
        </div>
    );
}

export default GogSettings;
