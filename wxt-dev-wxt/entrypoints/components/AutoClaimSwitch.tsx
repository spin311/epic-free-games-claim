import {setStorageItem, useStorage} from "@/entrypoints/hooks/useStorage.ts";
import {MessageRequest} from "@/entrypoints/types/messageRequest.ts";
import {ManualClaimBtn} from "@/entrypoints/components/ManualClaimBtn.tsx";
import {t} from "@/entrypoints/utils/i18n.ts";

// The extension's on/off: off pauses scheduled checks (Claim now still works,
// so it sits on the same row).
function AutoClaimSwitch() {
    const [active, setActive] = useStorage<boolean>("active", true);

    // Saved before messaging, not just by useStorage's own (later) effect:
    // the background reads `active` straight away to decide whether to check.
    async function toggleActive(next: boolean) {
        setActive(next);
        try {
            await setStorageItem("active", next);
        } catch (e) {
            console.error("Saving the auto-claim state failed:", e);
        }
        sendMessage({action: "updateActive", target: "background"});
    }

    function sendMessage(request: MessageRequest) {
        browser.runtime.sendMessage(request);
    }

    return (
        <div className="setting-row">
            <div className="switch-label">
                <label className="setting-label">
                    <input type="checkbox" role="switch" className="switch" checked={active}
                           onChange={e => void toggleActive(e.target.checked)}/>
                    {t("autoClaimSwitch")}
                </label>
                {/* Outside the label: the switch's own off state already says it. */}
                {!active && <span className="setting-note" aria-hidden="true">· {t("autoClaimPaused")}</span>}
            </div>
            <ManualClaimBtn/>
        </div>
    );
}

export default AutoClaimSwitch;
