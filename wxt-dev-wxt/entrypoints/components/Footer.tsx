import {getCrossPromoUrl} from "@/entrypoints/utils/reviewPrompt.ts";

function Footer() {
    return <>
        <div className="footer">
            <span><a href="https://github.com/spin311/epic-free-games-claim" target="_blank">GitHub</a></span>
            <span><a href="https://svitspindler.com/contact" target="_blank">Contact me</a></span>
            <span><a href="https://svitspindler.com/donate" target="_blank">Donate</a></span>
        </div>
        <p className="cross-promo">
            More free tools by the same developer:{" "}
            <a href={getCrossPromoUrl(import.meta.env.FIREFOX === true)} target="_blank" rel="noopener noreferrer">
                Prolific Studies Notifier — alerts for paid studies
            </a>
        </p>
    </>;
}

export default Footer;
