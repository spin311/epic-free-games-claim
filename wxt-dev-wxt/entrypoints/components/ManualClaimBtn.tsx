import {useStorageValue} from "@/entrypoints/hooks/useStorage.ts";
import {MessageRequest} from "@/entrypoints/types/messageRequest.ts";
import {t} from "@/entrypoints/utils/i18n.ts";

export function ManualClaimBtn() {
    // Live and read-only: only background.ts writes it, for automatic
    // (alarm-triggered) runs too. useStorage never saw the run start while the
    // popup was open, so the button stayed clickable during it.
    const isClaiming = useStorageValue<boolean>("isClaiming") === true;

    return (
        <button type="button" className="btn btn-secondary claim-now" onClick={claimGames} disabled={isClaiming}>
            {isClaiming ? t("claimNowButtonBusy") : t("claimNowButton")}
        </button>
    );

    function claimGames() {
        sendMessage({action: 'claim', target: 'background'});
    }

    function sendMessage(request: MessageRequest) {
        browser.runtime.sendMessage(request);
    }
}
