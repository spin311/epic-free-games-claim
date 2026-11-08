import {useStorageValue} from "@/entrypoints/hooks/useStorage.ts";
import {claimedCountLabel} from "@/entrypoints/utils/popupText.ts";

// metadata_source shows up in GitHub Sponsors exports, so sponsorships that start
// in this popup can be told apart from the README and website ones.
const SPONSOR_URL = "https://github.com/sponsors/spin311?metadata_source=epic-free-games-claim-popup";

interface PopupHeaderProps {
    // Off while a review or sponsor card shows: one ask at a time.
    showSponsor: boolean;
}

function PopupHeader({showSponsor}: PopupHeaderProps) {
    // Read-only and live: claim tabs count up while the popup is open.
    const counter = useStorageValue<number>("counter") ?? 0;

    return (
        <header className="app-header">
            <img className="app-logo" src="/icon/48.png" alt=""/>
            <div className="app-title">
                <h1>Free Game Claimer</h1>
                <p>{claimedCountLabel(counter)}</p>
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
