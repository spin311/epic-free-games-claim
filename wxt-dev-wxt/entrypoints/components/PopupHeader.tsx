import {useStorageValue} from "@/entrypoints/hooks/useStorage.ts";
import {claimedCountLabel} from "@/entrypoints/utils/popupText.ts";

// metadata_source shows up in GitHub Sponsors exports, so sponsorships that start
// in this popup can be told apart from the README and website ones.
const SPONSOR_URL = "https://github.com/sponsors/spin311?metadata_source=epic-free-games-claim-popup";

interface PopupHeaderProps {
    // False until the popup's first storage read is back: the count stays
    // blank until then, rather than opening on "0 games claimed".
    isReady: boolean;
    // Off while a review or sponsor card shows: one ask at a time.
    showSponsor: boolean;
}

function PopupHeader({isReady, showSponsor}: PopupHeaderProps) {
    // Read-only and live: claim tabs count up while the popup is open. Unset
    // until the first claim.
    const counter = useStorageValue<number>("counter") ?? 0;
    // Shared with background.ts: also true during an alarm-triggered run.
    const isClaiming = useStorageValue<boolean>("isClaiming") === true;

    return (
        <header className="app-header">
            <img className="app-logo" src="/icon/48.png" alt=""/>
            <div className="app-title">
                <h1>Free Game Claimer</h1>
                <p>
                    {isReady && claimedCountLabel(counter)}
                    {isClaiming && <span className="app-claiming"> · Claiming…</span>}
                </p>
            </div>
            {showSponsor && (
                <a href={SPONSOR_URL} className="sponsor-pill" target="_blank" rel="noopener noreferrer"
                   title="Sponsor from $5/month and get your name in the README">
                    <span aria-hidden="true">♥</span> Sponsor
                </a>
            )}
        </header>
    );
}

export default PopupHeader;
