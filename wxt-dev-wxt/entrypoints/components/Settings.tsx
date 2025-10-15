import {useStorage} from "@/entrypoints/hooks/useStorage.ts";
import OnButton from "@/entrypoints/components/OnButton.tsx";
import {ManualClaimBtn} from "@/entrypoints/components/ManualClaimBtn.tsx";
import Checkbox from "@/entrypoints/components/Checkbox.tsx";

function Settings() {

    const [counter] = useStorage<number>("counter", 0);
    const [steamCheck, setSteamCheck] = useStorage<boolean>("steamCheck", true);
    const [epicCheck, setEpicCheck] = useStorage<boolean>("epicCheck", true);

    return (
        <div className="tab-content">
            <h1>Free Games for Steam & Epic</h1>
            <p>Games claimed: {counter}</p>
            <OnButton/>

            <div className="inputs">
                <ManualClaimBtn/>
                <span>Log in on <a href="https://store.steampowered.com/login/" target="_blank">Steam</a> and <a
                    href="https://www.epicgames.com/id/login"
                    target="_blank">Epic games</a> to get free games</span>
                <div className="checkboxes">
                    <Checkbox name="Steam" checked={steamCheck} onChange={e => setSteamCheck(e.target.checked)}/>
                    <Checkbox checked={epicCheck} onChange={e => setEpicCheck(e.target.checked)} name="Epic Games"/>
                </div>
            </div>
            <span>Free games are claimed every day on browser start</span>
        </div>
    );
}

export default Settings;