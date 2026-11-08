import {setStorageItem, useStorage} from "@/entrypoints/hooks/useStorage.ts";
import {MessageRequest} from "@/entrypoints/types/messageRequest.ts";
import {ManualClaimBtn} from "@/entrypoints/components/ManualClaimBtn.tsx";

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
            <label className="switch-label">
                <input type="checkbox" role="switch" className="switch" checked={active}
                       onChange={e => void toggleActive(e.target.checked)}/>
                <span className="setting-label">
                    Auto-claim
                    {!active && <span className="setting-note"> · paused</span>}
                </span>
            </label>
            <ManualClaimBtn/>
        </div>
    );
}

export default AutoClaimSwitch;
