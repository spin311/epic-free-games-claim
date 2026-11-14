import {t} from "@/entrypoints/utils/i18n.ts";

function Footer() {
    return (
        <footer className="app-footer">
            <a href="https://github.com/spin311/epic-free-games-claim" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href="https://svitspindler.com/contact" target="_blank" rel="noopener noreferrer">{t("footerContact")}</a>
            <a href="https://svitspindler.com/donate" target="_blank" rel="noopener noreferrer">{t("footerDonate")}</a>
        </footer>
    );
}

export default Footer;
