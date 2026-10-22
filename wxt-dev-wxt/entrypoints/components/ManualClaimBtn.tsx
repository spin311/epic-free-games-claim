import {useStorage} from "@/entrypoints/hooks/useStorage.ts";
import {MessageRequest} from "@/entrypoints/types/messageRequest.ts";

export function ManualClaimBtn() {
    // Shared with background.ts's getFreeGamesList, so this also reflects an
    // automatic (alarm-triggered) run, not just one started from this button.
    const [isClaiming] = useStorage<boolean>("isClaiming", false);

    return (
        <button className="manual-btn" onClick={claimGames} disabled={isClaiming}>
            {isClaiming ? 'Claiming…' : 'Manually claim'}
        </button>
    );

    function claimGames() {
        sendMessage({action: 'claim', target: 'background'});
    }

    function sendMessage(request: MessageRequest) {
        browser.runtime.sendMessage(request);
    }
}