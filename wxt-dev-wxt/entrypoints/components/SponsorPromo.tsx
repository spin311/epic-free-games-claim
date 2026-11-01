// metadata_source shows up in GitHub Sponsors exports, so sponsorships that start
// in this popup can be told apart from the README and website ones.
const SPONSOR_URL = "https://github.com/sponsors/spin311?metadata_source=epic-free-games-claim-popup";

function SponsorPromo() {
    return <div className="sponsor-promo">
        <p className="sponsor-promo-text">
            Enjoying the free games? Sponsor from <b>$5/month</b> and get your name featured in the README.
        </p>
        <a href={SPONSOR_URL} className="sponsor-button" target="_blank" rel="noopener noreferrer">
            <span className="sponsor-heart" aria-hidden="true">♥</span> Sponsor
        </a>
    </div>;
}

export default SponsorPromo;
