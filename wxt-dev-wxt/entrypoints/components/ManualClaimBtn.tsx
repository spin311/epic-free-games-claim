import {MessageRequest} from "@/entrypoints/types/messageRequest.ts";

export function ManualClaimBtn() {
    return <button className="manual-btn" onClick={claimGames}>Manually claim</button>;

    function claimGames() {
        sendMessage({action: 'claim', target: 'background'});
    }

    function sendMessage(request: MessageRequest) {
        browser.runtime.sendMessage(request);
    }
}